import { APPETITE_TABLES, tableFor } from "./appetite/registry";
import { buildExplanation, recommendationFor } from "./explanation";
import type {
  AppetiteStatus,
  AppetiteVerdict,
  CanonicalSubmission,
  FactorEvaluation,
  RankedSubmission,
} from "./types";

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

/** All eight factor verdicts, always in the order of the published table. */
export function evaluateFactors(
  submission: CanonicalSubmission,
  extended = false,
): FactorEvaluation[] {
  const table = extended ? tableFor(submission.lineOfBusiness) : APPETITE_TABLES.property;
  return (table ?? APPETITE_TABLES.property).evaluate(submission);
}

export function computeScore(
  factors: FactorEvaluation[],
  maxScorePoints = MAX_SCORE_POINTS,
): number {
  const points = factors.reduce((sum, item) => sum + SCORE_POINTS[item.verdict], 0);
  return Math.round((points / maxScorePoints) * 100);
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

export function evaluateAppetite(
  submission: CanonicalSubmission,
  extended = false,
): RankedSubmission {
  if (classifyScope(submission.lineOfBusiness, extended) === "out_of_scope") {
    const recommendation = recommendationFor("out_of_scope");
    return {
      ...submission,
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
  const factors = selectedTable.evaluate(submission);
  const status = deriveStatus(factors);
  const score = computeScore(factors, selectedTable.maxScorePoints);
  const recommendation = recommendationFor(status);
  return {
    ...submission,
    status,
    score,
    factors,
    recommendation,
    explanation: buildExplanation({ accountName: submission.accountName, status, score, factors, recommendation }),
  };
}

const statusOrder: Record<AppetiteStatus, number> = {
  in_appetite: 0,
  needs_investigation: 1,
  out_of_appetite: 2,
  out_of_scope: 3,
};

/** Stable ordering: status, then score descending, then account name, then id. */
export function rankSubmissions(
  submissions: CanonicalSubmission[],
  opts?: { extended?: boolean },
): RankedSubmission[] {
  const extended = opts?.extended ?? false;
  return submissions.map((submission) => evaluateAppetite(submission, extended)).sort(
    (left, right) =>
      statusOrder[left.status] - statusOrder[right.status] ||
      right.score - left.score ||
      left.accountName.localeCompare(right.accountName) ||
      left.id.localeCompare(right.id),
  );
}
