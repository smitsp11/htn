import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "./completeness";

export type QuadrantCell = "work-now" | "worth-effort" | "selective" | "deprioritize";

/** A needs_investigation submission counts as high appetite when the factors
 *  it *has* resolved score at least this well (0–100). */
export const APPETITE_HIGH_SCORE = 60;
/** At most this many unresolved required fields still counts as low effort. */
export const EFFORT_LOW_MAX = 1;

export interface QuadrantPosition {
  appetite: "high" | "low";
  effort: "low" | "high";
  cell: QuadrantCell;
}

export const QUADRANT_CELLS: { cell: QuadrantCell; label: string; appetite: "high" | "low"; effort: "low" | "high" }[] = [
  { cell: "work-now", label: "Work now", appetite: "high", effort: "low" },
  { cell: "worth-effort", label: "Worth the effort", appetite: "high", effort: "high" },
  { cell: "selective", label: "Selective", appetite: "low", effort: "low" },
  { cell: "deprioritize", label: "Deprioritize", appetite: "low", effort: "high" },
];

/** Out-of-scope lines were never evaluated against the property factors, so
 *  they have no place on an appetite × completeness board. */
export function isTriageCandidate(submission: RankedSubmission): boolean {
  return submission.status !== "out_of_scope";
}

/**
 * Appetite axis: in_appetite is always high; needs_investigation is high only
 * when its score is strong (missing data on an otherwise-good risk). out_of_appetite
 * is never high — a hard-gate failure is low appetite regardless of score.
 * Effort axis: from W2's effortToDecision (count of unresolved required fields).
 * Callers should filter with isTriageCandidate first; an out-of-scope line
 * falls through to "deprioritize" so it can never read as work-now.
 */
export function quadrantOf(submission: RankedSubmission): QuadrantPosition {
  if (!isTriageCandidate(submission)) return { appetite: "low", effort: "high", cell: "deprioritize" };
  const appetite =
    submission.status === "in_appetite" ||
    (submission.status === "needs_investigation" && submission.score >= APPETITE_HIGH_SCORE)
      ? "high"
      : "low";
  const effort = completenessOf(submission).effortToDecision <= EFFORT_LOW_MAX ? "low" : "high";
  const cell =
    appetite === "high"
      ? effort === "low" ? "work-now" : "worth-effort"
      : effort === "low" ? "selective" : "deprioritize";
  return { appetite, effort, cell };
}
