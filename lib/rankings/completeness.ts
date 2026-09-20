import type { CanonicalSubmission, FactorKey, RankedSubmission } from "@/lib/domain/types";

export interface CompletenessProfile {
  /** Required fields with a non-unknown verdict. */
  resolved: number;
  /** Required fields evaluated: the eight appetite factors for a property
   *  submission, zero for an out-of-scope line that was never evaluated. */
  total: number;
  /** Factor keys still unresolved (verdict === "unknown"), in table order. */
  missing: FactorKey[];
  /** Human labels for the missing factors, for UI copy. */
  missingLabels: string[];
  /** Subset of `missing` where the source value is absent or invalid — the
   *  fields a broker can supply. */
  absent: FactorKey[];
  absentLabels: string[];
  /** Subset of `missing` where a value exists but the guidelines do not
   *  classify it (e.g. built exactly 1990, a 50/50 construction split, an
   *  unrecognised submission type). Underwriter judgement, not a broker chase. */
  ambiguous: FactorKey[];
  ambiguousLabels: string[];
  /** True when nothing is left to chase or decide (missing.length === 0). */
  inGoodOrder: boolean;
  /** Count of unresolved required fields — the work between here and a
   *  confident verdict. 0 = ready to decide. W6's quadrant consumes this. */
  effortToDecision: number;
}

/** The canonical input each appetite factor reads. */
const FACTOR_INPUT: Record<FactorKey, keyof CanonicalSubmission> = {
  submissionType: "submissionType",
  lineOfBusiness: "lineOfBusiness",
  primaryRiskState: "primaryRiskState",
  tiv: "tiv",
  totalPremium: "totalPremium",
  buildingYear: "buildingYear",
  construction: "approvedConstructionPercentage",
  fiveYearLossValue: "fiveYearLossValue",
};

/** A value the engine could not have read anything from. Mirrors the
 *  engine's own "missing or invalid" guards without re-running the rules. */
export function isAbsent(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return !Number.isFinite(value);
  return false;
}

export function completenessOf(submission: RankedSubmission): CompletenessProfile {
  const missingFactors = submission.factors.filter((factor) => factor.verdict === "unknown");
  const absentFactors = missingFactors.filter((factor) => isAbsent(submission[FACTOR_INPUT[factor.key]]));
  const ambiguousFactors = missingFactors.filter((factor) => !absentFactors.includes(factor));
  const total = submission.factors.length;
  return {
    resolved: total - missingFactors.length,
    total,
    missing: missingFactors.map((factor) => factor.key),
    missingLabels: missingFactors.map((factor) => factor.label),
    absent: absentFactors.map((factor) => factor.key),
    absentLabels: absentFactors.map((factor) => factor.label),
    ambiguous: ambiguousFactors.map((factor) => factor.key),
    ambiguousLabels: ambiguousFactors.map((factor) => factor.label),
    inGoodOrder: missingFactors.length === 0,
    effortToDecision: missingFactors.length,
  };
}
