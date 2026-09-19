/**
 * Transport-level pagination that retrieves ALL pages and proves completeness.
 *
 * IMPORTANT — ASSUMED CONTRACT: the live Federato pagination response shape is
 * UNDOCUMENTED. This helper is written against a *clearly assumed* envelope and
 * keeps the extraction/advance logic injectable so Person 2 can override it once
 * the real shape is known. The field names used by `defaultExtractPage` /
 * `defaultWithCursor` below (`data`, `pagination.nextCursor`, `hasMore`, `cursor`)
 * are ASSUMPTIONS, not authoritative Federato names.
 *
 * Completeness guarantees regardless of the concrete shape:
 *  - We do NOT assume the first page holds the full 50+ queue; we follow the
 *    cursor/next pointer until it is exhausted.
 *  - We guard against a looping cursor (a page returning a cursor we already
 *    used) and against runaway pagination (a `maxPages` ceiling). Either throws
 *    a `pagination` error rather than looping forever.
 *  - An optional `dedupeKey` drops duplicate records if the same page is served
 *    twice and flags it via `duplicatePagesDetected`.
 */
import { FederatoTransportError } from "./transport";

export type Cursor = string | number | undefined;

export interface PageShape<T> {
  records: T[];
  /** null/undefined/empty means "no more pages". */
  nextCursor: string | number | null | undefined;
}

export interface PaginationOptions<T> {
  /** Fetch one page for the given cursor (undefined for the first page). */
  fetchPage: (cursor: Cursor) => Promise<unknown>;
  /** Pull records + next cursor out of one raw page (defaults to the assumed shape). */
  extract?: (raw: unknown) => PageShape<T>;
  /** Safety ceiling; exceeding it throws rather than looping. */
  maxPages?: number;
  /** Stable identity per record; enables duplicate-page detection. */
  dedupeKey?: (record: T) => string;
}

export interface PaginationResult<T> {
  records: T[];
  pageCount: number;
  duplicatePagesDetected: boolean;
}

const DEFAULT_MAX_PAGES = 200;

function firstArray(obj: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function readNextCursor(raw: Record<string, unknown>): string | number | null | undefined {
  const meta = (raw.pagination ?? raw.meta ?? raw.page) as Record<string, unknown> | undefined;
  const source = meta && typeof meta === "object" ? meta : raw;
  // An explicit "no more pages" signal wins.
  if (source.hasMore === false || source.has_more === false) return null;
  for (const key of ["nextCursor", "next_cursor", "nextPage", "next", "cursor", "offset"]) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

/**
 * Default extractor for the ASSUMED envelope. Handles a bare array, or an object
 * with a records array under a common key plus an optional pagination block.
 */
export function defaultExtractPage(raw: unknown): PageShape<unknown> {
  if (Array.isArray(raw)) return { records: raw, nextCursor: null };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const records = firstArray(obj, ["data", "results", "items", "records"]) ?? [];
    return { records, nextCursor: readNextCursor(obj) };
  }
  return { records: [], nextCursor: null };
}

/**
 * Default cursor injector for the ASSUMED envelope: merge a `cursor` field into
 * the opaque query payload. Person 2 owns the real payload semantics and can
 * override this once the pagination request contract is known.
 */
export function defaultWithCursor(payload: unknown, cursor: Cursor): unknown {
  if (cursor === undefined) return payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>), cursor };
  }
  return payload;
}

export async function fetchAllPages<T>(options: PaginationOptions<T>): Promise<PaginationResult<T>> {
  const { fetchPage, maxPages = DEFAULT_MAX_PAGES, dedupeKey } = options;
  const extract = (options.extract ?? (defaultExtractPage as (raw: unknown) => PageShape<T>));

  const records: T[] = [];
  const seenKeys = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: Cursor = undefined;
  let pageCount = 0;
  let duplicatePagesDetected = false;

  for (;;) {
    if (pageCount >= maxPages) {
      throw new FederatoTransportError(
        "pagination",
        `Federato query pagination did not terminate within ${maxPages} pages; aborting to avoid a loop and prevent an incomplete queue.`,
      );
    }

    const page = extract(await fetchPage(cursor));
    pageCount += 1;

    for (const record of page.records) {
      if (dedupeKey) {
        const key = dedupeKey(record);
        if (seenKeys.has(key)) {
          duplicatePagesDetected = true;
          continue;
        }
        seenKeys.add(key);
      }
      records.push(record);
    }

    const next = page.nextCursor;
    if (next === null || next === undefined || next === "") break;

    const nextKey = String(next);
    if (seenCursors.has(nextKey)) {
      throw new FederatoTransportError(
        "pagination",
        "Federato query pagination returned a cursor it had already used; aborting to avoid a loop.",
      );
    }
    seenCursors.add(nextKey);
    cursor = next;
  }

  return { records, pageCount, duplicatePagesDetected };
}
