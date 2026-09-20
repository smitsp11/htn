import type { ResolvedValue } from "./provenance";

export interface Source<T> {
  name: string;
  asOf: string;
  /** Return a candidate value with confidence, or null if this source has nothing. */
  lookup: () => { value: T; confidence: number } | null;
}

/** Run sources in order (cheapest first). Return the first hit whose confidence
 *  is >= threshold; stop immediately. Return null if none qualifies. Pure: the
 *  caller supplies whatever the sources need via closures. */
export function runWaterfall<T>(sources: Source<T>[], threshold: number): ResolvedValue<T> | null {
  for (const source of sources) {
    const hit = source.lookup();
    if (hit && hit.confidence >= threshold) {
      return { value: hit.value, provenance: { source: source.name, confidence: hit.confidence, asOf: source.asOf } };
    }
  }
  return null;
}
