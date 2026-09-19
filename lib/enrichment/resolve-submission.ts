import type { FactorKey, RankedSubmission } from "@/lib/domain/types";
import type { ResolvedValue } from "./provenance";
import { runWaterfall, type Source } from "./waterfall";

const CONFIDENCE_THRESHOLD = 0.6;

/** Deterministic MVP source chains keyed by factor. Extend with real sources by
 *  returning `Source<number|string>` entries — the runner is source-agnostic
 *  (W8 multi-channel consolidation and W9 public data plug in here). Chains with
 *  no confident source return null (broker-chase). We never invent a value. */
function chainFor(key: FactorKey, submission: RankedSubmission): Source<number | string>[] {
  void key;
  void submission;
  return [];
}

export type ResolutionMap = Partial<Record<FactorKey, ResolvedValue<number | string> | null>>;

export function resolveSubmissionFields(submission: RankedSubmission): ResolutionMap {
  const map: ResolutionMap = {};
  for (const factor of submission.factors) {
    if (factor.verdict !== "unknown") continue;
    map[factor.key] = runWaterfall(chainFor(factor.key, submission), CONFIDENCE_THRESHOLD);
  }
  return map;
}
