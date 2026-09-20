import type { ActualOutcome, RankedSubmission } from "@/lib/domain/types";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * Actual historical disposition helpers. The lifecycle status is raw Federato
 * data (`Submission.status`), never an appetite verdict; these functions only
 * format it and compare it against the engine's independent appetite call.
 */

/** Human labels for the raw lifecycle dispositions seen in the dataset. */
const OUTCOME_LABELS: Record<string, string> = {
  bound: "Bound",
  declined: "Declined",
  lost: "Lost",
  cleared: "Cleared",
  received: "Received",
  quoted: "Quoted",
};

export function outcomeLabel(status: string): string {
  return OUTCOME_LABELS[status] ?? (status ? status[0].toUpperCase() + status.slice(1) : "Unknown");
}

/** Humanize a raw decline-reason token, e.g. "loss_history" -> "Loss history". */
export function formatDeclineReason(reason: string): string {
  const words = reason.trim().replace(/[_-]+/g, " ");
  return words ? words[0].toUpperCase() + words.slice(1) : reason;
}

/** Short "Actual: Bound" style chip text; declined carries its reason inline. */
export function outcomeChipText(outcome: ActualOutcome): string {
  const label = outcomeLabel(outcome.status);
  if (outcome.status === "declined" && outcome.declineReason) {
    return `Actual: ${label} — ${formatDeclineReason(outcome.declineReason)}`;
  }
  return `Actual: ${label}`;
}

/** Badge tone for the actual outcome: bound reads positive, declined/lost muted-negative. */
export function outcomeTone(status: string): BadgeTone {
  switch (status) {
    case "bound":
      return "mint";
    case "declined":
    case "lost":
      return "neutral";
    default:
      return "neutral";
  }
}

/**
 * An off-strategy bind: the account was actually bound, yet the appetite engine
 * independently flags it out of appetite. This is Federato's "appetite drift"
 * signal — a risk already on the books that the carrier's own stated appetite
 * would not have written. It reads two independent axes and never mutates either.
 */
export function isOffStrategyBind(submission: RankedSubmission): boolean {
  return submission.actualOutcome?.status === "bound" && submission.status === "out_of_appetite";
}
