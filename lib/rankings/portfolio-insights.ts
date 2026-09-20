import type { FactorKey, RankedSubmission } from "@/lib/domain/types";
import { formatMoney } from "@/lib/domain/format";
import { isOffStrategyBind } from "./outcome";
import { failingFactors, isOneFixAway, nearMissFactors } from "./flags";

export type InsightKind = "shape" | "drift" | "opportunity";

/**
 * A portfolio-level observation about the ranked queue. Every number is a
 * count over verdicts the engine already assigned or over raw canonical
 * values; nothing here re-applies an appetite rule.
 */
export interface PortfolioInsight {
  id: string;
  kind: InsightKind;
  headline: string;
  detail: string;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Failure counts per factor over the evaluated (property) rows, most frequent first. */
export function failureLeaderboard(property: RankedSubmission[]): Array<{ key: FactorKey; label: string; count: number }> {
  const counts = new Map<FactorKey, { label: string; count: number }>();
  for (const submission of property) {
    for (const factor of failingFactors(submission)) {
      const entry = counts.get(factor.key) ?? { label: factor.label, count: 0 };
      entry.count += 1;
      counts.set(factor.key, entry);
    }
  }
  return [...counts.entries()]
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

/**
 * What the queue says about the appetite itself. An underwriter reading the
 * ranked list sees one row at a time; these insights say whether the 2025
 * guideline fits the book that is actually arriving, which is the question a
 * portfolio manager asks before trusting any single verdict.
 */
export function portfolioInsights(ranked: RankedSubmission[]): PortfolioInsight[] {
  const insights: PortfolioInsight[] = [];
  const property = ranked.filter((submission) => submission.status !== "out_of_scope");
  const outOfScope = ranked.length - property.length;

  if (ranked.length === 0) return insights;

  insights.push({
    id: "book-shape",
    kind: "shape",
    headline: `${property.length} of ${ranked.length} submissions are commercial property`,
    detail:
      outOfScope > 0
        ? `${plural(outOfScope, "submission")} on other lines were routed out of scope and never scored; the 2025 table covers property only.`
        : "Every submission in the queue is a property line and was evaluated on all eight factors.",
  });

  if (property.length === 0) return insights;

  const leaders = failureLeaderboard(property).slice(0, 3);
  if (leaders.length > 0) {
    const [top] = leaders;
    insights.push({
      id: "failure-leaders",
      kind: "drift",
      headline: `${top.label} fails ${top.count} of ${property.length} property submissions`,
      detail:
        `Most common reasons the book falls outside appetite: ${leaders.map((item) => `${item.label.toLowerCase()} (${item.count})`).join(", ")}. ` +
        (top.key === "buildingYear"
          ? "Building year follows the oldest building on the schedule; each row states how a value-weighted reading would differ."
          : "Each row names the observed value and how far it sits from the boundary."),
    });
  }

  const priced = property.filter((submission) => typeof submission.totalPremium === "number" && submission.totalPremium > 0);
  const premiumFailures = priced.filter((submission) =>
    submission.factors.some((factor) => factor.key === "totalPremium" && factor.verdict === "not_acceptable"),
  );
  const medianPremium = median(priced.map((submission) => submission.totalPremium!));
  if (priced.length > 0 && medianPremium !== undefined) {
    const share = Math.round((premiumFailures.length / priced.length) * 100);
    insights.push({
      id: "premium-band",
      kind: "drift",
      headline: `${premiumFailures.length} of ${priced.length} priced submissions sit outside the premium band`,
      detail:
        `The median premium on the property book is ${formatMoney(medianPremium)}. ` +
        (share >= 50
          ? "Most of the book is priced outside the guideline's acceptable range, which suggests the band, not the submissions, deserves a second look."
          : "Most of the book is priced inside the guideline's acceptable range."),
    });
  }

  const withOutcome = property.filter((submission) => submission.actualOutcome);
  if (withOutcome.length > 0) {
    const bound = withOutcome.filter((submission) => submission.actualOutcome?.status === "bound");
    const offStrategy = bound.filter(isOffStrategyBind);
    insights.push({
      id: "appetite-drift",
      kind: "drift",
      headline: `${offStrategy.length} of ${plural(bound.length, "bound account")} fall outside the stated appetite`,
      detail:
        offStrategy.length > 0
          ? `The carrier bound ${offStrategy.length} risk${offStrategy.length === 1 ? "" : "s"} the 2025 guideline would not have written. Either the appetite has drifted or exceptions are being made; both are worth a portfolio conversation.`
          : "Every bound account is consistent with the stated appetite.",
    });
  }

  const oneFix = property.filter(isOneFixAway);
  const nearMisses = oneFix.filter((submission) => nearMissFactors(submission).length > 0);
  insights.push({
    id: "one-fix-away",
    kind: "opportunity",
    headline: `${plural(oneFix.length, "submission")} ${oneFix.length === 1 ? "is" : "are"} one factor from appetite`,
    detail:
      oneFix.length > 0
        ? `${nearMisses.length} of them ${nearMisses.length === 1 ? "is" : "are"} a near miss, within a few percent or a couple of years of the boundary. These rank first inside the out-of-appetite lane so a single confirmed figure can be chased before the row is written off.`
        : "No out-of-appetite submission is a single factor away; the failures come in clusters.",
  });

  return insights;
}

/** The same insights as trace lines, so the decision trace reads them too. */
export function portfolioTrace(ranked: RankedSubmission[]): string[] {
  return portfolioInsights(ranked).map((insight) => `Portfolio: ${insight.headline}. ${insight.detail}`);
}
