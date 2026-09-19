import type { HazardRating, RankedSubmission } from "@/lib/domain/types";

export interface StateConcentration {
  state: string;
  count: number;
}

export interface PortfolioSummary {
  total: number;
  /** Sum of TIV across in-appetite submissions with a numeric TIV. */
  inAppetiteTiv: number;
  /** States by submission count, most concentrated first. */
  topStates: StateConcentration[];
  /** Submission counts bucketed by composite hazard rating (incl. "unknown"). */
  hazardCounts: Partial<Record<HazardRating, number>>;
}

export function portfolioSummary(submissions: RankedSubmission[]): PortfolioSummary {
  const states = new Map<string, number>();
  const hazardCounts: Partial<Record<HazardRating, number>> = {};
  let inAppetiteTiv = 0;

  for (const s of submissions) {
    if (s.status === "in_appetite" && typeof s.tiv === "number") inAppetiteTiv += s.tiv;
    if (s.primaryRiskState) states.set(s.primaryRiskState, (states.get(s.primaryRiskState) ?? 0) + 1);
    const rating: HazardRating = s.enrichment?.compositeRating ?? "unknown";
    hazardCounts[rating] = (hazardCounts[rating] ?? 0) + 1;
  }

  const topStates = [...states.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));

  return { total: submissions.length, inAppetiteTiv, topStates, hazardCounts };
}
