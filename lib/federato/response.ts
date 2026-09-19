/** Shapes of the `{ "action": "query" }` response, and how to get rows out of it. */

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * With `outputOnly=true` the handler still wraps results as
 * `{ output: [ { data: { total, results: [...] } } ] }`, and grouped queries
 * return `groups` instead of `results`. This accepts every shape we have seen
 * and returns the records.
 */
export function extractRows(raw: unknown): UnknownRecord[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (!isRecord(raw)) return [];
  if (Array.isArray(raw.output)) return raw.output.flatMap(extractRows);

  for (const key of ["results", "groups", "data", "items", "records"]) {
    const candidate = raw[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
    if (isRecord(candidate)) {
      const nested = extractRows(candidate);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

/** `total` counts every matching record, regardless of pagination. */
export function extractTotal(raw: unknown): number | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.total === "number") return raw.total;
  if (Array.isArray(raw.output)) {
    for (const entry of raw.output) {
      const total = extractTotal(entry);
      if (total !== undefined) return total;
    }
  }
  for (const key of ["data", "results"]) {
    const candidate = raw[key];
    if (isRecord(candidate)) {
      const total = extractTotal(candidate);
      if (total !== undefined) return total;
    }
  }
  return undefined;
}

export function getPath(record: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (Array.isArray(value)) {
      const index = Number(segment);
      if (Number.isInteger(index)) return value[index];
      return value.map((entry) => getPath(entry, segment)).filter((entry) => entry !== undefined);
    }
    if (isRecord(value)) return value[segment];
    return undefined;
  }, record);
}

/** Collects every value at a path, fanning out through arrays on the way. */
export function collectPath(record: unknown, path: string): unknown[] {
  const value = getPath(record, path);
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.flat(Infinity).filter((entry) => entry != null) : [value];
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[$,%\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
