import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "./completeness";

export type QuadrantCell = "work-now" | "worth-effort" | "selective" | "deprioritize";

const APPETITE_HIGH_SCORE = 60;
const EFFORT_LOW_MAX = 1;

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

/**
 * Appetite axis: in_appetite is always high; needs_investigation is high only
 * when its score is strong (missing data on an otherwise-good risk). out_of_appetite
 * is never high — a hard-gate failure is low appetite regardless of score.
 * Effort axis: from W2's effortToDecision (count of unresolved required fields).
 */
export function quadrantOf(submission: RankedSubmission): QuadrantPosition {
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
