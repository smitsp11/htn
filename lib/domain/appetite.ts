import { APPETITE_TABLES, tableFor } from "./appetite/registry";
import { buildExplanation, recommendationFor } from "./explanation";
import { formatMoney } from "./format";
import type {
  AppetiteStatus,
  AppetiteVerdict,
  CanonicalSubmission,
  FactorEvaluation,
  RankedSubmission,
} from "./types";

// Property-specific near-miss bands and the building-year sensitivity note
// live with the property table; re-exported here so callers keep one import.
export {
  buildingYearSensitivity,
  NEAR_MISS_CONSTRUCTION_POINTS,
  NEAR_MISS_MONEY_SHARE,
  NEAR_MISS_YEARS,
} from "./appetite/lines/property";

export type LineScope = "property" | "in_scope_line" | "out_of_scope" | "unknown_line";

/**
 * Route a submission by its line of business. Property lines get the full
 * eight-factor appetite evaluation; known non-property lines are out of scope
 * (no property appetite is defined for them); a missing line stays in the
 * property pipeline so its unknown line factor drives needs_investigation.
 *
 * When `extended` is true, any line registered in the appetite registry counts
 * as in scope (its own table drives the evaluation).
 */
export function classifyScope(lineOfBusiness?: string, extended = false): LineScope {
  const normalized = lineOfBusiness?.trim().toLowerCase();
  if (!normalized) return "unknown_line";
  if (normalized.includes("property")) return "property";
  if (extended && tableFor(normalized)) return "in_scope_line";
  return "out_of_scope";
}

// Shared guideline cutoffs used by the flip-analysis presentation layer.
export const TIV_MAX = 150_000_000;
export const PREMIUM_MIN = 50_000;
export const PREMIUM_MAX = 175_000;
export const YEAR_ACCEPTABLE_AFTER = 1990;
export const LOSS_MAX = 100_000;

/**
 * Naive additive score. A target verdict earns 2 points, acceptable earns 1,
 * unknown and not acceptable earn 0. Four factors have a target tier (state,
 * TIV, premium, building year) and four do not, so the maximum is 4*2 + 4*1.
 * The score is subordinate to status: it never overrides a hard-gate failure.
 */
export const SCORE_POINTS: Record<AppetiteVerdict, number> = {
  target: 2,
  acceptable: 1,
  unknown: 0,
  not_acceptable: 0,
};
export const MAX_SCORE_POINTS = 12;

/**
 * Copy the query agent's provenance onto the matching factor. Evidence never
 * influences a verdict; it exists so an underwriter can see where each number
 * came from.
 */
function attachEvidence(factors: FactorEvaluation[], submission: CanonicalSubmission): FactorEvaluation[] {
  for (const item of factors) {
    const evidence = submission.derivations?.[item.key];
    if (evidence) item.evidence = { ...evidence };
  }
  return factors;
}

/** All of the line's factor verdicts, always in the order of the published table, each carrying its provenance when the input had one. */
export function evaluateFactors(
  submission: CanonicalSubmission,
  extended = false,
): FactorEvaluation[] {
  const table = extended ? tableFor(submission.lineOfBusiness) : APPETITE_TABLES.property;
  return attachEvidence((table ?? APPETITE_TABLES.property).evaluate(submission), submission);
}

export function computeScore(
  factors: FactorEvaluation[],
  maxScorePoints = MAX_SCORE_POINTS,
): number {
  const points = factors.reduce((sum, item) => sum + SCORE_POINTS[item.verdict], 0);
  return Math.round((points / maxScorePoints) * 100);
}

/** How many factors are not acceptable: the distance, in fixes, from appetite. */
export function failureCount(factors: FactorEvaluation[]): number {
  return factors.filter((item) => item.verdict === "not_acceptable").length;
}

/**
 * Status precedence: any not-acceptable factor is a hard gate to
 * out_of_appetite; otherwise any unknown means needs_investigation.
 */
export function deriveStatus(factors: FactorEvaluation[]): AppetiteStatus {
  if (factors.some((item) => item.verdict === "not_acceptable")) return "out_of_appetite";
  if (factors.some((item) => item.verdict === "unknown")) return "needs_investigation";
  return "in_appetite";
}

/** The canonical fields carried onto the ranked row; provenance inputs stay behind. */
function stripInputs(submission: CanonicalSubmission): CanonicalSubmission {
  const { derivations: _derivations, ...rest } = submission;
  return rest;
}

export function evaluateAppetite(
  submission: CanonicalSubmission,
  extended = false,
): RankedSubmission {
  if (classifyScope(submission.lineOfBusiness, extended) === "out_of_scope") {
    const recommendation = recommendationFor("out_of_scope");
    return {
      ...stripInputs(submission),
      status: "out_of_scope",
      score: 0,
      factors: [],
      recommendation,
      explanation: buildExplanation({
        accountName: submission.accountName,
        status: "out_of_scope",
        score: 0,
        factors: [],
        recommendation,
        lineOfBusiness: submission.lineOfBusiness,
      }),
    };
  }

  const table = extended ? tableFor(submission.lineOfBusiness) : APPETITE_TABLES.property;
  const selectedTable = table ?? APPETITE_TABLES.property;
  const factors = attachEvidence(selectedTable.evaluate(submission), submission);
  const status = deriveStatus(factors);
  const score = computeScore(factors, selectedTable.maxScorePoints);
  const recommendation = recommendationFor(status);
  return {
    ...stripInputs(submission),
    status,
    score,
    factors,
    recommendation,
    explanation: buildExplanation({
      accountName: submission.accountName,
      status,
      score,
      factors,
      recommendation,
      lineOfBusiness: submission.lineOfBusiness,
      submissionType: submission.submissionType,
      primaryRiskState: submission.primaryRiskState,
      tiv: submission.tiv,
    }),
  };
}

const statusOrder: Record<AppetiteStatus, number> = {
  in_appetite: 0,
  needs_investigation: 1,
  out_of_appetite: 2,
  out_of_scope: 3,
};

/**
 * Stable ordering: status, then fewest not-acceptable factors, then score
 * descending, then account name, then id. Failure count sits before score so
 * a row that is one fix from appetite outranks one that is three fixes away
 * even when both count the same number of good factors.
 */
export function rankSubmissions(
  submissions: CanonicalSubmission[],
  opts?: { extended?: boolean },
): RankedSubmission[] {
  const extended = opts?.extended ?? false;
  return submissions.map((submission) => evaluateAppetite(submission, extended)).sort(
    (left, right) =>
      statusOrder[left.status] - statusOrder[right.status] ||
      failureCount(left.factors) - failureCount(right.factors) ||
      right.score - left.score ||
      left.accountName.localeCompare(right.accountName) ||
      left.id.localeCompare(right.id),
  );
}

/** Actual quoted premium alongside the selected line's own guideline bands. */
export function pricingBandsFor(submission: CanonicalSubmission): { label: string; value: string }[] {
  const table = tableFor(submission.lineOfBusiness) ?? APPETITE_TABLES.property;
  const bands = table.premiumBands;
  const quoted =
    typeof submission.totalPremium === "number" && Number.isFinite(submission.totalPremium)
      ? formatMoney(submission.totalPremium)
      : "—";

  return [
    { label: "This submission", value: quoted },
    { label: "Acceptable band", value: `${formatMoney(bands.min)} – ${formatMoney(bands.max)}` },
    { label: "Target band", value: `${formatMoney(bands.targetMin)} – ${formatMoney(bands.targetMax)}` },
  ];
}
