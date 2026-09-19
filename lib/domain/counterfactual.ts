import type { AppetiteStatus, AppetiteVerdict, FactorKey, RankedSubmission } from "./types";

export interface FlipChange {
  key: FactorKey;
  label: string;
  from: AppetiteVerdict;
  /** The verdict this factor would need to reach for the status to improve. */
  to: "acceptable";
  hint: string;
}

export interface FlipResult {
  /** The status the submission would reach if every change below were made. */
  targetStatus: AppetiteStatus;
  changes: FlipChange[];
}

/** The minimal set of factor changes that raises status one tier. Deterministic
 *  and derived from the engine's own verdicts (mirrors deriveStatus precedence:
 *  not_acceptable gates first, then unknown). The LLM only phrases this. */
export function whatWouldFlip(submission: RankedSubmission): FlipResult | null {
  const blockers = submission.factors.filter((f) => f.verdict === "not_acceptable");
  if (blockers.length > 0) {
    return {
      targetStatus: "needs_investigation", // removing hard gates lifts it off out_of_appetite
      changes: blockers.map((f) => ({ key: f.key, label: f.label, from: f.verdict, to: "acceptable", hint: f.reason })),
    };
  }
  const unknowns = submission.factors.filter((f) => f.verdict === "unknown");
  if (unknowns.length > 0) {
    return {
      targetStatus: "in_appetite",
      changes: unknowns.map((f) => ({ key: f.key, label: f.label, from: f.verdict, to: "acceptable", hint: f.reason })),
    };
  }
  return null;
}
