/**
 * Runs compiled queries: pages until the queue is complete, retries with a
 * simpler payload when the API rejects one, and records every attempt.
 *
 * Transport, authentication and retry-on-401 belong to Person 1; this module
 * only receives an `execute` function and never sees a credential.
 */

import type { CompiledQuery, QueryPayload } from "./query-compiler";
import { extractRows, extractTotal, type UnknownRecord } from "./response";
import { parseApiError, type QueryTrace } from "./query-trace";

export type QueryExecutor = (payload: QueryPayload) => Promise<unknown>;

export interface PageResult {
  rows: UnknownRecord[];
  total?: number;
  payload: QueryPayload;
}

export async function runQuery(
  execute: QueryExecutor,
  compiled: CompiledQuery,
  trace: QueryTrace,
): Promise<PageResult> {
  const attempts = [compiled.payload, ...compiled.fallbacks];
  let lastError: unknown;

  for (let index = 0; index < attempts.length; index += 1) {
    const payload = attempts[index];
    try {
      const raw = await execute(payload);
      const rows = extractRows(raw);
      const total = extractTotal(raw);

      if (rows.length === 0 && index < attempts.length - 1 && total === 0) {
        trace.add(
          "repair",
          "A query validated but returned nothing",
          `${compiled.purpose} returned zero rows. Retrying with a simpler projection, because a dot-path through an array is the usual cause.`,
        );
        continue;
      }

      trace.add("query", compiled.purpose, describePayload(payload), {
        rows: rows.length,
        ...(total === undefined ? {} : { total }),
        attempt: index + 1,
      });
      return { rows, total, payload };
    } catch (error) {
      lastError = error;
      const parsed = parseApiError(error);
      const isLast = index === attempts.length - 1;
      trace.add(
        isLast ? "warning" : "repair",
        isLast ? `Query failed: ${compiled.purpose}` : "Query rejected; simplifying it",
        `${parsed.code ? `[${parsed.code}] ` : ""}${parsed.message}`,
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Query failed: ${compiled.purpose}`);
}

export async function runPaged(
  execute: QueryExecutor,
  build: (offset: number) => CompiledQuery,
  trace: QueryTrace,
  maxPages = 20,
): Promise<PageResult> {
  const rows: UnknownRecord[] = [];
  let total: number | undefined;
  let offset = 0;
  let firstPayload: QueryPayload | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const compiled = build(offset);
    const limit = compiled.payload.pagination?.limit ?? rows.length;
    const result = await runQuery(execute, compiled, trace);
    firstPayload ??= result.payload;
    rows.push(...result.rows);
    total ??= result.total;

    if (result.rows.length < limit) break;
    if (total !== undefined && rows.length >= total) break;
    offset += limit;
  }

  if (total !== undefined && rows.length < total) {
    trace.add(
      "warning",
      "Pagination stopped early",
      `The API reported ${total} matching records but only ${rows.length} were retrieved.`,
      { retrieved: rows.length, total },
    );
  }

  return { rows, total, payload: firstPayload ?? build(0).payload };
}

function describePayload(payload: QueryPayload): string {
  const parts = [`resource ${payload.resource}`];
  if (payload.expand) parts.push(`expand ${Object.keys(payload.expand).join(", ")}`);
  if (payload.unwind?.length) parts.push(`unwind ${payload.unwind.join(", ")}`);
  if (payload.over?.length) parts.push(`grouped over ${payload.over.join(", ")}`);
  parts.push(payload.select ? "projected fields" : "whole records");
  if (payload.pagination) {
    parts.push(`limit ${payload.pagination.limit}, offset ${payload.pagination.offset ?? 0}`);
  }
  return parts.join("; ");
}
