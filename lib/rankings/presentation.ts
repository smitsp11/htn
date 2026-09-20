import type { AppetiteStatus, RankedSubmission } from "@/lib/domain/types";

export const statusLabels: Record<AppetiteStatus, string> = {
  in_appetite: "In appetite",
  needs_investigation: "Needs investigation",
  out_of_appetite: "Out of appetite",
  out_of_scope: "Out of scope",
};

/** The single most decision-relevant factor reason for the at-a-glance row. */
export function primaryReason(submission: RankedSubmission): string {
  if (submission.status === "out_of_scope") {
    const line = submission.lineOfBusiness?.trim() || "This line";
    return `${line} — no property appetite defined for this line.`;
  }
  const byVerdict = (verdict: RankedSubmission["factors"][number]["verdict"]) =>
    submission.factors.find((factor) => factor.verdict === verdict)?.reason;
  return byVerdict("not_acceptable") ?? byVerdict("unknown") ?? byVerdict("target") ?? "All eight factors are acceptable.";
}

export interface QueueSummary {
  total: number;
  in_appetite: number;
  needs_investigation: number;
  out_of_appetite: number;
  out_of_scope: number;
  /** Submissions with at least one unknown factor, regardless of status. */
  unresolved: number;
}

export function summarize(submissions: RankedSubmission[]): QueueSummary {
  const summary: QueueSummary = { total: 0, in_appetite: 0, needs_investigation: 0, out_of_appetite: 0, out_of_scope: 0, unresolved: 0 };
  for (const submission of submissions) {
    summary.total += 1;
    summary[submission.status] += 1;
    if (submission.factors.some((factor) => factor.verdict === "unknown")) summary.unresolved += 1;
  }
  return summary;
}
