import type { HazardRating, RankedSubmission } from "@/lib/domain/types";

export interface StateConcentration {
  state: string;
  count: number;
}

const HIGH_HAZARD: ReadonlySet<HazardRating> = new Set<HazardRating>(["relatively high", "very high"]);

export interface PortfolioSummary {
  /** Every submission in the queue, in scope or not. */
  total: number;
  /** Property submissions evaluated against the appetite factors. */
  inScope: number;
  /** Non-property lines (out_of_scope). Excluded from every figure below. */
  outOfScope: number;
  /** Sum of TIV across in-scope submissions with a numeric TIV. */
  totalTiv: number;
  /** Sum of TIV across in-appetite submissions with a numeric TIV. */
  inAppetiteTiv: number;
  /** In-scope submissions with no numeric TIV (not counted in the sums). */
  tivUnknown: number;
  /** States by in-scope submission count, most concentrated first. */
  topStates: StateConcentration[];
  /** In-scope submission counts bucketed by composite hazard rating (incl. "unknown"). */
  hazardCounts: Partial<Record<HazardRating, number>>;
  /** In-scope submissions rated relatively high or very high. */
  highHazard: number;
}

/** Queue-level aggregation over already-ranked submissions. Read-only; it
 *  never feeds back into any verdict or score. */
export function portfolioSummary(submissions: RankedSubmission[]): PortfolioSummary {
  const states = new Map<string, number>();
  const hazardCounts: Partial<Record<HazardRating, number>> = {};
  let inScope = 0;
  let totalTiv = 0;
  let inAppetiteTiv = 0;
  let tivUnknown = 0;
  let highHazard = 0;

  for (const s of submissions) {
    if (s.status === "out_of_scope") continue;
    inScope += 1;
    if (typeof s.tiv === "number" && Number.isFinite(s.tiv)) {
      totalTiv += s.tiv;
      if (s.status === "in_appetite") inAppetiteTiv += s.tiv;
    } else {
      tivUnknown += 1;
    }
    const state = s.primaryRiskState?.trim().toUpperCase();
    if (state) states.set(state, (states.get(state) ?? 0) + 1);
    const rating: HazardRating = s.enrichment?.compositeRating ?? "unknown";
    hazardCounts[rating] = (hazardCounts[rating] ?? 0) + 1;
    if (HIGH_HAZARD.has(rating)) highHazard += 1;
  }

  const topStates = [...states.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));

  return {
    total: submissions.length,
    inScope,
    outOfScope: submissions.length - inScope,
    totalTiv,
    inAppetiteTiv,
    tivUnknown,
    topStates,
    hazardCounts,
    highHazard,
  };
}
