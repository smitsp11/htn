import { formatMoney } from "@/lib/domain/format";
import type {
  AppetiteVerdict,
  CanonicalSubmission,
  FactorEvaluation,
  FactorKey,
  LineOfBusiness,
} from "@/lib/domain/types";

/**
 * Dependency-free appetite building blocks shared by every non-property line
 * table. Imports ONLY types + `formatMoney` so the dependency flow stays
 * one-way: helpers ← {casualty, specialty, property} ← registry (no cycle).
 *
 * Each factor builder owns its verdict AND its reason in a single branch chain,
 * so the two can never drift. Property keeps its own bespoke evaluators (the
 * published-PDF semantics); these mirror those semantics for the
 * synthesized-for-demo multi-line tables.
 */

export type AppetiteProvenance = "provided-pdf" | "synthesized-for-demo";

export interface PremiumBands {
  min: number;
  max: number;
  targetMin: number;
  targetMax: number;
}

export interface AppetiteTable {
  line: LineOfBusiness;
  displayName: string;
  provenance: AppetiteProvenance;
  premiumBands: PremiumBands;
  /** Maximum points available from this line's applicable factors. */
  maxScorePoints: number;
  evaluate(submission: CanonicalSubmission): FactorEvaluation[];
}

export function factor(
  key: FactorKey,
  label: string,
  verdict: AppetiteVerdict,
  reason: string,
  extra: Pick<FactorEvaluation, "nearMiss"> = {},
): FactorEvaluation {
  const evaluation: FactorEvaluation = { key, label, verdict, reason };
  if (extra.nearMiss) evaluation.nearMiss = true;
  return evaluation;
}

/** A not-acceptable money value within this share of its boundary is flagged as a near miss. */
const NEAR_MISS_MONEY_SHARE = 0.05;

function moneyNearMiss(delta: number, boundary: number): boolean {
  return delta <= boundary * NEAR_MISS_MONEY_SHARE;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `new` → acceptable; `renew*` → acceptable iff the line allows renewals. */
function submissionTypeFactor(value: string | undefined, renewalAcceptable: boolean): FactorEvaluation {
  const s = value?.trim().toLowerCase();
  if (!s) return factor("submissionType", "Submission type", "unknown", "Submission type is missing.");
  if (s.includes("renew")) {
    return renewalAcceptable
      ? factor("submissionType", "Submission type", "acceptable", "Renewal business is acceptable.")
      : factor("submissionType", "Submission type", "not_acceptable", "Renewal business is not acceptable.");
  }
  if (s.includes("new")) return factor("submissionType", "Submission type", "acceptable", "New business is acceptable.");
  return factor("submissionType", "Submission type", "unknown", `Unrecognized submission type: ${value?.trim()}.`);
}

/** Target/acceptable/not_acceptable state, with "any" meaning every other US state is acceptable. */
function stateFactor(
  value: string | undefined,
  target: Set<string>,
  acceptable: Set<string> | "any",
  note: string,
): FactorEvaluation {
  const s = value?.trim().toUpperCase();
  if (!s) return factor("primaryRiskState", "Primary risk state", "unknown", "Primary risk state is missing.");
  if (target.has(s)) return factor("primaryRiskState", "Primary risk state", "target", `${s} is a target state.`);
  if (acceptable === "any" || acceptable.has(s)) {
    return factor("primaryRiskState", "Primary risk state", "acceptable", `${s} is an acceptable state (${note}).`);
  }
  return factor("primaryRiskState", "Primary risk state", "not_acceptable", `${s} is outside the listed states.`);
}

/**
 * Scalar band with an optional inner target tier (premium-style). Value exactly
 * on a min/max boundary → unknown; strictly outside → not_acceptable; inside the
 * target tier → target; otherwise acceptable.
 */
function bandFactor(
  key: FactorKey,
  label: string,
  value: number | undefined,
  band: { min: number; max: number; target?: { min: number; max: number } },
): FactorEvaluation {
  if (!isFiniteNumber(value)) return factor(key, label, "unknown", `${label} is missing or invalid.`);
  const money = formatMoney(value);
  const range = `${formatMoney(band.min)}–${formatMoney(band.max)}`;
  if (value === band.min || value === band.max) {
    return factor(key, label, "unknown", `${label} ${money} sits exactly on an acceptable-range boundary.`);
  }
  if (value < band.min || value > band.max) {
    const delta = value < band.min ? band.min - value : value - band.max;
    return factor(key, label, "not_acceptable", `${label} ${money} is outside the ${range} acceptable range.`, {
      nearMiss: moneyNearMiss(delta, value < band.min ? band.min : band.max),
    });
  }
  if (band.target && value >= band.target.min && value <= band.target.max) {
    const targetRange = `${formatMoney(band.target.min)}–${formatMoney(band.target.max)}`;
    return factor(key, label, "target", `${label} ${money} is in the ${targetRange} target range.`);
  }
  return factor(key, label, "acceptable", `${label} ${money} is in the ${range} acceptable range.`);
}

/**
 * Upper-bound-only field (exposure/limit, losses): acceptable strictly under
 * `max`, not_acceptable over, unknown at exactly `max` or when missing/invalid.
 * `zeroAcceptable` mirrors property's loss handling (a clean $0 history is
 * acceptable); leave it false for exposure where a non-positive basis is unknown.
 */
function upperBoundFactor(
  key: FactorKey,
  label: string,
  value: number | undefined,
  max: number,
  opts?: { zeroAcceptable?: boolean },
): FactorEvaluation {
  if (!isFiniteNumber(value) || (opts?.zeroAcceptable ? value < 0 : value <= 0)) {
    return factor(key, label, "unknown", `${label} value is missing or invalid.`);
  }
  const money = formatMoney(value);
  const cap = formatMoney(max);
  if (value === max) return factor(key, label, "unknown", `${label} of ${money} sits exactly on the ${cap} limit.`);
  if (value > max) {
    return factor(key, label, "not_acceptable", `${label} of ${money} exceeds the ${cap} limit.`, {
      nearMiss: moneyNearMiss(value - max, max),
    });
  }
  return factor(key, label, "acceptable", `${label} of ${money} is within the ${cap} limit.`);
}

interface LineConfig {
  line: LineOfBusiness;
  displayName: string;
  renewalAcceptable: boolean;
  targetStates: string[];
  /** Extra acceptable states, or "any" when every other US state is acceptable. */
  acceptableStates: string[] | "any";
  premium: PremiumBands;
  /** Exposure/limit ceiling (reused `tiv` key). Omit to drop the factor entirely. */
  exposureMax?: number;
  lossMax: number;
}

/**
 * Assemble a synthesized-for-demo appetite table from a config. Factor order is
 * fixed: submissionType, primaryRiskState, totalPremium, tiv (omitted when
 * `exposureMax` is undefined), fiveYearLossValue.
 */
export function buildTable(cfg: LineConfig): AppetiteTable {
  const target = new Set(cfg.targetStates);
  const acceptable =
    cfg.acceptableStates === "any"
      ? ("any" as const)
      : new Set([...cfg.targetStates, ...cfg.acceptableStates]);
  const stateNote =
    cfg.acceptableStates === "any" ? "any other US state is acceptable" : "states outside the list are not acceptable";

  return {
    line: cfg.line,
    displayName: cfg.displayName,
    provenance: "synthesized-for-demo",
    premiumBands: cfg.premium,
    maxScorePoints: 1 + 2 + 2 + (cfg.exposureMax === undefined ? 0 : 1) + 1,
    evaluate(s: CanonicalSubmission): FactorEvaluation[] {
      const factors: FactorEvaluation[] = [
        submissionTypeFactor(s.submissionType, cfg.renewalAcceptable),
        stateFactor(s.primaryRiskState, target, acceptable, stateNote),
        bandFactor("totalPremium", "Total premium", s.totalPremium, {
          min: cfg.premium.min,
          max: cfg.premium.max,
          target: { min: cfg.premium.targetMin, max: cfg.premium.targetMax },
        }),
      ];

      if (cfg.exposureMax !== undefined) {
        factors.push(upperBoundFactor("tiv", "Exposure basis", s.tiv, cfg.exposureMax));
      }

      factors.push(
        upperBoundFactor("fiveYearLossValue", "Five-year losses", s.fiveYearLossValue, cfg.lossMax, {
          zeroAcceptable: true,
        }),
      );

      return factors;
    },
  };
}
