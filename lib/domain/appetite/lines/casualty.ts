import { formatMoney } from "@/lib/domain/format";
import type { CanonicalSubmission, FactorEvaluation } from "@/lib/domain/types";
import {
  bandVerdict,
  mk,
  stateVerdict,
  submissionTypeVerdict,
  upperBoundVerdict,
  type AppetiteTable,
} from "../registry";

/**
 * Casualty appetite tables (cgl, auto, excess, lpl).
 *
 * provenance: synthesized-for-demo. These bands are plausible and internally
 * documented for the Extended-mode demo; they are NOT a real carrier filing.
 * Only the shared FactorKeys carry over from property — property-only keys
 * (buildingYear, construction, lineOfBusiness) are intentionally omitted.
 * `tiv` is reused as the line's exposure/limit basis.
 */

interface LineConfig {
  line: AppetiteTable["line"];
  displayName: string;
  renewalAcceptable: boolean;
  targetStates: string[];
  /** Extra acceptable states, or "any" when every other US state is acceptable. */
  acceptableStates: string[] | "any";
  premium: { min: number; max: number; targetMin: number; targetMax: number };
  /** Exposure/limit ceiling (reused `tiv` key). Omit to drop the factor. */
  exposureMax?: number;
  lossMax: number;
}

function buildTable(cfg: LineConfig): AppetiteTable {
  const target = new Set(cfg.targetStates);
  const acceptable =
    cfg.acceptableStates === "any" ? ("any" as const) : new Set([...cfg.targetStates, ...cfg.acceptableStates]);
  const stateNote =
    cfg.acceptableStates === "any" ? "any other US state is acceptable" : "states outside the list are not acceptable";

  return {
    line: cfg.line,
    displayName: cfg.displayName,
    provenance: "synthesized-for-demo",
    evaluate(s: CanonicalSubmission): FactorEvaluation[] {
      const factors: FactorEvaluation[] = [];

      factors.push(
        mk(
          "submissionType",
          "Submission type",
          submissionTypeVerdict(s.submissionType, cfg.renewalAcceptable),
          submissionTypeReason(s.submissionType, cfg.renewalAcceptable),
        ),
      );

      factors.push(
        mk(
          "primaryRiskState",
          "Primary risk state",
          stateVerdict(s.primaryRiskState, target, acceptable),
          stateReason(s.primaryRiskState, target, acceptable, stateNote),
        ),
      );

      factors.push(
        mk(
          "totalPremium",
          "Total premium",
          bandVerdict(s.totalPremium, {
            min: cfg.premium.min,
            max: cfg.premium.max,
            targetMin: cfg.premium.targetMin,
            targetMax: cfg.premium.targetMax,
          }),
          bandReason(s.totalPremium, "Premium", cfg.premium),
        ),
      );

      if (cfg.exposureMax !== undefined) {
        factors.push(
          mk(
            "tiv",
            "Exposure basis",
            upperBoundVerdict(s.tiv, cfg.exposureMax),
            upperBoundReason(s.tiv, "Exposure", cfg.exposureMax),
          ),
        );
      }

      factors.push(
        mk(
          "fiveYearLossValue",
          "Five-year losses",
          upperBoundVerdict(s.fiveYearLossValue, cfg.lossMax, { zeroAcceptable: true }),
          upperBoundReason(s.fiveYearLossValue, "Five-year losses", cfg.lossMax),
        ),
      );

      return factors;
    },
  };
}

function submissionTypeReason(value: string | undefined, renewalAcceptable: boolean): string {
  const s = value?.trim().toLowerCase();
  if (!s) return "Submission type is missing.";
  if (s.includes("renew")) {
    return renewalAcceptable ? "Renewal business is acceptable." : "Renewal business is not acceptable.";
  }
  if (s.includes("new")) return "New business is acceptable.";
  return `Unrecognized submission type: ${value?.trim()}.`;
}

function stateReason(
  value: string | undefined,
  target: Set<string>,
  acceptable: Set<string> | "any",
  note: string,
): string {
  const s = value?.trim().toUpperCase();
  if (!s) return "Primary risk state is missing.";
  if (target.has(s)) return `${s} is a target state.`;
  if (acceptable === "any" || acceptable.has(s)) return `${s} is an acceptable state (${note}).`;
  return `${s} is outside the listed states.`;
}

function bandReason(
  value: number | undefined,
  label: string,
  band: { min: number; max: number; targetMin: number; targetMax: number },
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${label} is missing or invalid.`;
  const money = formatMoney(value);
  const range = `${formatMoney(band.min)}–${formatMoney(band.max)}`;
  const targetRange = `${formatMoney(band.targetMin)}–${formatMoney(band.targetMax)}`;
  if (value === band.min || value === band.max) return `${label} ${money} sits exactly on an acceptable-range boundary.`;
  if (value < band.min || value > band.max) return `${label} ${money} is outside the ${range} acceptable range.`;
  if (value >= band.targetMin && value <= band.targetMax) return `${label} ${money} is in the ${targetRange} target range.`;
  return `${label} ${money} is in the ${range} acceptable range.`;
}

function upperBoundReason(value: number | undefined, label: string, max: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${label} value is missing or invalid.`;
  const money = formatMoney(value);
  const cap = formatMoney(max);
  if (value === max) return `${label} of ${money} sits exactly on the ${cap} limit.`;
  if (value > max) return `${label} of ${money} exceeds the ${cap} limit.`;
  return `${label} of ${money} is within the ${cap} limit.`;
}

export const CGL_TABLE = buildTable({
  line: "cgl",
  displayName: "Commercial General Liability",
  renewalAcceptable: true,
  targetStates: ["OH", "PA", "MD", "CO", "CA", "FL"],
  acceptableStates: ["NC", "SC", "GA", "VA", "UT", "TX", "TN"],
  premium: { min: 25_000, max: 250_000, targetMin: 40_000, targetMax: 120_000 },
  exposureMax: 75_000_000,
  lossMax: 150_000,
});

export const AUTO_TABLE = buildTable({
  line: "auto",
  displayName: "Commercial Auto",
  renewalAcceptable: true,
  targetStates: ["OH", "PA", "MD", "CO", "CA", "FL"],
  acceptableStates: ["IL", "MO", "MA", "NJ", "AZ"],
  premium: { min: 30_000, max: 300_000, targetMin: 50_000, targetMax: 150_000 },
  exposureMax: 50_000_000,
  lossMax: 250_000,
});

export const EXCESS_TABLE = buildTable({
  line: "excess",
  displayName: "Commercial Excess/Umbrella",
  renewalAcceptable: true,
  targetStates: ["CA", "FL", "TX", "NY"],
  acceptableStates: "any",
  premium: { min: 10_000, max: 150_000, targetMin: 20_000, targetMax: 80_000 },
  exposureMax: 100_000_000,
  lossMax: 50_000,
});

export const LPL_TABLE = buildTable({
  line: "lpl",
  displayName: "Lawyers Professional Liability",
  renewalAcceptable: true,
  targetStates: ["CA", "NY", "IL", "TX", "FL"],
  acceptableStates: "any",
  premium: { min: 15_000, max: 180_000, targetMin: 30_000, targetMax: 90_000 },
  exposureMax: 40_000_000,
  lossMax: 75_000,
});

export { buildTable, type LineConfig };
