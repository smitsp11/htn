import type { FactorKey, RankedSubmission } from "@/lib/domain/types";

export interface CompletenessProfile {
  /** Required fields with a non-unknown verdict. */
  resolved: number;
  /** Total required fields evaluated (always the 8 appetite factors). */
  total: number;
  /** Factor keys still unresolved (verdict === "unknown"). */
  missing: FactorKey[];
  /** Human labels for the missing factors, for UI copy. */
  missingLabels: string[];
  /** True when nothing is left to chase (missing.length === 0). */
  inGoodOrder: boolean;
  /** Count of unresolved required fields — the work between here and a
   *  confident verdict. 0 = ready to decide. W6's quadrant consumes this. */
  effortToDecision: number;
}

export function completenessOf(submission: RankedSubmission): CompletenessProfile {
  const missingFactors = submission.factors.filter((factor) => factor.verdict === "unknown");
  const missing = missingFactors.map((factor) => factor.key);
  const total = submission.factors.length;
  return {
    resolved: total - missing.length,
    total,
    missing,
    missingLabels: missingFactors.map((factor) => factor.label),
    inGoodOrder: missing.length === 0,
    effortToDecision: missing.length,
  };
}
