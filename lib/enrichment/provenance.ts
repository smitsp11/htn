export interface Provenance {
  /** Which source produced the value (e.g. "canonical", "inference", "FEMA NRI"). */
  source: string;
  /** 0–1 confidence the source reported. */
  confidence: number;
  /** ISO date the value was captured/derived. */
  asOf: string;
}

export interface ResolvedValue<T> {
  value: T;
  provenance: Provenance;
}
