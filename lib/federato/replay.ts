/**
 * Offline executor backed by the captured API responses in `raw/`.
 *
 * It implements the slice of the query language the agent actually emits —
 * resource, where, expand, unwind + over + $sum, pagination — so the whole
 * pipeline, including reference hydration, can be exercised without
 * credentials. It is a test and demo aid, never a data source in live mode.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { QueryPayload } from "./query-compiler";
import { buildSchemaIndex, objectFields, referenceTarget, type SchemaIndex } from "./schema-index";
import { collectPath, extractRows, getPath, isRecord, asNumber, type UnknownRecord } from "./response";

const DEFAULT_DIR = path.join(process.cwd(), "raw");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function matches(record: UnknownRecord, clause: Record<string, unknown>): boolean {
  return Object.entries(clause).every(([key, expected]) => {
    if (key === "$and") return (expected as Record<string, unknown>[]).every((sub) => matches(record, sub));
    if (key === "$or") return (expected as Record<string, unknown>[]).some((sub) => matches(record, sub));
    if (key === "$not") return !matches(record, expected as Record<string, unknown>);

    const actual = getPath(record, key);
    if (isRecord(expected)) {
      return Object.entries(expected).every(([operator, value]) => {
        const left = asNumber(actual) ?? actual;
        const right = asNumber(value) ?? value;
        switch (operator) {
          case "$eq":
            return actual === value;
          case "$ne":
            return actual !== value;
          case "$exists":
            return (actual !== undefined && actual !== null) === Boolean(value);
          case "$in":
            return Array.isArray(value) && value.includes(actual as never);
          case "$nin":
            return Array.isArray(value) && !value.includes(actual as never);
          case "$gt":
            return typeof left === "number" && typeof right === "number" && left > right;
          case "$gte":
            return typeof left === "number" && typeof right === "number" && left >= right;
          case "$lt":
            return typeof left === "number" && typeof right === "number" && left < right;
          case "$lte":
            return typeof left === "number" && typeof right === "number" && left <= right;
          default:
            throw new Error(`[VALIDATION_ERROR] Unknown operator "${operator}" {"operator":"${operator}"}`);
        }
      });
    }
    return actual === expected;
  });
}

export interface ReplaySource {
  discoverSchema: () => Promise<unknown>;
  execute: (payload: QueryPayload) => Promise<unknown>;
  index: SchemaIndex;
}

export function createReplaySource(directory = DEFAULT_DIR): ReplaySource {
  const rawSchema = readJson(path.join(directory, "schema.json"));
  const index = buildSchemaIndex(rawSchema);
  const tables = new Map<string, Map<string, UnknownRecord>>();

  function table(resource: string): Map<string, UnknownRecord> {
    const cached = tables.get(resource);
    if (cached) return cached;
    if (!index.hasResource(resource)) {
      throw new Error(`[VALIDATION_ERROR] Unknown resource "${resource}" {"resource":"${resource}"}`);
    }
    const rows = extractRows(readJson(path.join(directory, `full_${resource}.json`)));
    const map = new Map(rows.map((row) => [String(row.id), row]));
    tables.set(resource, map);
    return map;
  }

  function hydrate(record: UnknownRecord, resource: string, spec: unknown, depth = 0): UnknownRecord {
    if (!isRecord(spec) || depth > 5) return record;
    const fields = objectFields(index.raw[resource]);
    if (!fields) return record;

    const output: UnknownRecord = { ...record };
    for (const [key, nested] of Object.entries(spec)) {
      const field = fields[key];
      if (!field) continue;

      const reference = referenceTarget(field);
      if (reference) {
        const target = table(reference.resource);
        const value = record[key];
        const resolveOne = (id: unknown) => {
          const found = target.get(String(id));
          return found ? hydrate(found, reference.resource, nested, depth + 1) : undefined;
        };
        output[key] = Array.isArray(value)
          ? value.map(resolveOne).filter(Boolean)
          : (resolveOne(value) ?? null);
        continue;
      }

      if (field.type === "object" && isRecord(record[key])) {
        output[key] = hydrate(record[key] as UnknownRecord, resource, nested, depth);
      }
    }
    return output;
  }

  async function execute(payload: QueryPayload): Promise<unknown> {
    const rows = [...table(payload.resource).values()];
    const filtered = payload.where ? rows.filter((row) => matches(row, payload.where!)) : rows;
    const hydrated = payload.expand
      ? filtered.map((row) => hydrate(row, payload.resource, payload.expand))
      : filtered;

    const aggregated = payload.select ? applyAggregations(hydrated, payload.select) : hydrated;
    const limit = payload.pagination?.limit ?? aggregated.length;
    const offset = payload.pagination?.offset ?? 0;

    return {
      output: [
        {
          data: {
            resource: payload.resource,
            total: aggregated.length,
            results: aggregated.slice(offset, offset + limit),
          },
        },
      ],
    };
  }

  return { discoverSchema: async () => rawSchema, execute, index };
}

/**
 * Only `$sum` is supported, which is all the agent's cross-check query uses.
 * Rows without an aggregation leaf pass through unchanged.
 */
function applyAggregations(rows: UnknownRecord[], select: Record<string, unknown>): UnknownRecord[] {
  const sums = Object.entries(select).filter(
    ([, leaf]) => isRecord(leaf) && typeof leaf.$sum === "string",
  ) as Array<[string, { $sum: string }]>;
  if (sums.length === 0) return rows;

  return rows.map((row) => {
    const aggregated: UnknownRecord = { id: row.id };
    for (const [alias, leaf] of sums) {
      aggregated[alias] = collectPath(row, leaf.$sum)
        .map((value) => asNumber(value) ?? 0)
        .reduce((total, value) => total + value, 0);
    }
    return aggregated;
  });
}
