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
  /** Why no factor change helps, when `changes` is empty. */
  note?: string;
}

/**
 * The minimal set of factor changes that raises status one tier. Deterministic
 * and derived from the engine's own verdicts (mirrors deriveStatus precedence:
 * not_acceptable gates first, then unknown). Returns null when the submission
 * is already in appetite. Out-of-scope lines get an explicit no-path answer
 * rather than being mistaken for in-appetite. The LLM only phrases this.
 */
export function whatWouldFlip(submission: RankedSubmission): FlipResult | null {
  if (submission.status === "out_of_scope") {
    const line = submission.lineOfBusiness?.trim() || "This line";
    return {
      targetStatus: "out_of_scope",
      changes: [],
      note: `${line} is not written under the 2025 commercial-property guidelines; no factor change brings it into appetite.`,
    };
  }
  const toChange = (f: RankedSubmission["factors"][number]): FlipChange => ({ key: f.key, label: f.label, from: f.verdict, to: "acceptable", hint: f.reason });
  const blockers = submission.factors.filter((f) => f.verdict === "not_acceptable");
  const unknowns = submission.factors.filter((f) => f.verdict === "unknown");
  if (blockers.length > 0) {
    // Clearing the hard gates lifts it off out_of_appetite; whether it lands
    // in appetite or in needs_investigation depends on what is still unknown.
    return { targetStatus: unknowns.length > 0 ? "needs_investigation" : "in_appetite", changes: blockers.map(toChange) };
  }
  if (unknowns.length > 0) {
    return { targetStatus: "in_appetite", changes: unknowns.map(toChange) };
  }
  return null;
}
