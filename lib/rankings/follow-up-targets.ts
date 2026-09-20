/**
 * Which ranked rows deserve a second query. This is the underwriting-policy
 * half of the adaptive loop: the pipeline decides *who* gets a deeper look,
 * the query agent decides *how* to fetch it.
 *
 * Two kinds of row qualify:
 * - any row with an unknown factor: the check could not decide, so the agent
 *   should try to fill the gap before an underwriter has to;
 * - a near miss: out of appetite on exactly one factor with a strong score,
 *   where confirming that one figure is worth a query before writing it off.
 *
 * Out-of-scope rows (other lines of business) are never targeted: the
 * guidelines rule them out before any data gap matters.
 */

import type { FollowUpGap } from "@/lib/federato/follow-up";
import type { RankedSubmission } from "@/lib/domain/types";

/** A single-factor failure at or above this score is worth confirming. */
export const NEAR_MISS_MIN_SCORE = 58;

export function selectFollowUpTargets(ranked: RankedSubmission[]): FollowUpGap[] {
  const gaps: FollowUpGap[] = [];
  for (const submission of ranked) {
    if (submission.status === "out_of_scope") continue;
    for (const factor of submission.factors) {
      if (factor.verdict === "unknown") gaps.push({ submissionId: submission.id, factor: factor.key, reason: "unknown" });
    }
    const failing = submission.factors.filter((factor) => factor.verdict === "not_acceptable");
    if (submission.status === "out_of_appetite" && failing.length === 1 && submission.score >= NEAR_MISS_MIN_SCORE) {
      gaps.push({ submissionId: submission.id, factor: failing[0].key, reason: "near_miss" });
    }
  }
  return gaps;
}

export interface FollowUpDelta {
  statusChanged: string[];
  scoreChanged: string[];
}

/** What the second ranking changed, by submission id. */
export function diffRankings(before: RankedSubmission[], after: RankedSubmission[]): FollowUpDelta {
  const previous = new Map(before.map((item) => [item.id, item]));
  const delta: FollowUpDelta = { statusChanged: [], scoreChanged: [] };
  for (const item of after) {
    const was = previous.get(item.id);
    if (!was) continue;
    if (was.status !== item.status) delta.statusChanged.push(item.id);
    else if (was.score !== item.score) delta.scoreChanged.push(item.id);
  }
  return delta;
}
