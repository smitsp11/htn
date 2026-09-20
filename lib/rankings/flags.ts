import type { AppetiteVerdict, RankedSubmission } from "@/lib/domain/types";

export type FlagTone = "red" | "yellow" | "preferred";

/** not_acceptable is a hard concern (red), unknown is a data gap (yellow),
 *  target/acceptable are wanted business (preferred). Pure re-presentation of
 *  the verdict the engine already assigned; no appetite logic here. */
export function flagTone(verdict: AppetiteVerdict): FlagTone {
  if (verdict === "not_acceptable") return "red";
  if (verdict === "unknown") return "yellow";
  return "preferred";
}

export interface FlagSummary {
  red: number;
  yellow: number;
  preferred: number;
}

export function flagSummary(submission: RankedSubmission): FlagSummary {
  const summary: FlagSummary = { red: 0, yellow: 0, preferred: 0 };
  for (const factor of submission.factors) summary[flagTone(factor.verdict)] += 1;
  return summary;
}

/** Factor reasons grouped by tone, for chip hover text / tooltips. */
export function reasonsByTone(submission: RankedSubmission): Record<FlagTone, string[]> {
  const grouped: Record<FlagTone, string[]> = { red: [], yellow: [], preferred: [] };
  for (const factor of submission.factors) grouped[flagTone(factor.verdict)].push(`${factor.label}: ${factor.reason}`);
  return grouped;
}
