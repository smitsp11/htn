/**
 * Runs compiled queries: checks each payload against the schema before it is
 * sent, pages until the queue is complete, retries with a simpler payload when
 * the validator or the API rejects one, and records every attempt.
 *
 * Transport, authentication and retry-on-401 belong to Person 1; this module
 * only receives an `execute` function and never sees a credential.
 */

import type { CompiledQuery, QueryPayload } from "./query-compiler";
import { extractRows, extractTotal, type UnknownRecord } from "./response";
import { parseApiError, type QueryTrace } from "./query-trace";
import { summarizeValidation, type ValidationError, type ValidationResult } from "./query-validator";

export type QueryExecutor = (payload: QueryPayload) => Promise<unknown>;

export interface RunQueryOptions {
  /** Checks a payload against the discovered schema before it is sent. */
  validate?: (payload: QueryPayload) => ValidationResult;
  /**
   * Asked to rewrite a payload the validator rejected. The rewrite is validated
   * again before use, so a bad rewrite costs nothing but a trace line.
   */
  repair?: (payload: QueryPayload, errors: ValidationError[]) => Promise<QueryPayload | undefined>;
}

export interface PageResult {
  rows: UnknownRecord[];
  total?: number;
  payload: QueryPayload;
}

/**
 * Validates one attempt locally. Returns the payload to send (the original or
 * a validated rewrite), or undefined when it must be skipped. Skipping never
 * spends an API call.
 */
async function preflight(
  payload: QueryPayload,
  compiled: CompiledQuery,
  options: RunQueryOptions,
  trace: QueryTrace,
  attempt: number,
  attempts: number,
): Promise<{ payload?: QueryPayload; summary?: string }> {
  if (!options.validate) return { payload };
  const result = options.validate(payload);
  if (result.ok) return { payload };

  const summary = summarizeValidation(result.errors);
  const isLast = attempt === attempts;
  trace.add(
    "repair",
    "Rejected locally before sending",
    `${compiled.purpose} (attempt ${attempt}): ${summary} ${
      isLast ? "No simpler payload is left." : "No API call was spent; trying the next simpler payload."
    }`,
    { attempt, problems: result.errors.length },
  );

  if (options.repair) {
    const rewritten = await options.repair(payload, result.errors);
    if (rewritten) {
      const again = options.validate(rewritten);
      if (again.ok) {
        trace.add("repair", "The rewritten query validates", `Sending the model's rewrite of attempt ${attempt} instead of a simpler fallback.`, { attempt });
        return { payload: rewritten };
      }
      trace.add(
        "warning",
        "The rewritten query still fails validation",
        `${summarizeValidation(again.errors)} Falling back to the next simpler payload.`,
        { attempt, problems: again.errors.length },
      );
    }
  }
  return { summary };
}

export async function runQuery(
  execute: QueryExecutor,
  compiled: CompiledQuery,
  trace: QueryTrace,
  options: RunQueryOptions = {},
): Promise<PageResult> {
  const attempts = [compiled.payload, ...compiled.fallbacks];
  let lastError: unknown;

  for (let index = 0; index < attempts.length; index += 1) {
    const checked = await preflight(attempts[index], compiled, options, trace, index + 1, attempts.length);
    if (!checked.payload) {
      lastError = new Error(`[VALIDATION_ERROR] ${checked.summary ?? "The query did not match the discovered schema."}`);
      continue;
    }
    const payload = checked.payload;

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
  options: RunQueryOptions = {},
  maxPages = 20,
): Promise<PageResult> {
  const rows: UnknownRecord[] = [];
  let total: number | undefined;
  let offset = 0;
  let firstPayload: QueryPayload | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const compiled = build(offset);
    const limit = compiled.payload.pagination?.limit ?? rows.length;
    const result = await runQuery(execute, compiled, trace, options);
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
