import type { HazardRating, RankedSubmission } from "@/lib/domain/types";
import { classifyScope } from "@/lib/domain/appetite";

export interface StateConcentration {
  state: string;
  count: number;
}

const HIGH_HAZARD: ReadonlySet<HazardRating> = new Set<HazardRating>(["relatively high", "very high"]);

export interface PortfolioSummary {
  /** Every submission in the queue, in scope or not. */
  total: number;
  /** Property-book submissions, including records whose line is unresolved. */
  propertyCount: number;
  /** Non-property lines. Excluded from every figure below. */
  nonProperty: number;
  /** Sum of TIV across property submissions with a numeric TIV. */
  totalTiv: number;
  /** Sum of TIV across in-appetite property submissions with a numeric TIV. */
  inAppetiteTiv: number;
  /** Property submissions with no numeric TIV (not counted in the sums). */
  tivUnknown: number;
  /** States by property submission count, most concentrated first. */
  topStates: StateConcentration[];
  /** Property submission counts bucketed by composite hazard rating (incl. "unknown"). */
  hazardCounts: Partial<Record<HazardRating, number>>;
  /** Property submissions rated relatively high or very high. */
  highHazard: number;
}

/** Queue-level aggregation over already-ranked submissions. Read-only; it
 *  never feeds back into any verdict or score. */
export function portfolioSummary(submissions: RankedSubmission[]): PortfolioSummary {
  const states = new Map<string, number>();
  const hazardCounts: Partial<Record<HazardRating, number>> = {};
  let propertyCount = 0;
  let totalTiv = 0;
  let inAppetiteTiv = 0;
  let tivUnknown = 0;
  let highHazard = 0;

  for (const s of submissions) {
    const scope = classifyScope(s.lineOfBusiness, true);
    if (scope === "in_scope_line" || scope === "out_of_scope") continue;
    propertyCount += 1;
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
    propertyCount,
    nonProperty: submissions.length - propertyCount,
    totalTiv,
    inAppetiteTiv,
    tivUnknown,
    topStates,
    hazardCounts,
    highHazard,
  };
}
