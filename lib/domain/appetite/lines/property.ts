import { formatMoney } from "@/lib/domain/format";
import type {
  AppetiteVerdict,
  CanonicalSubmission,
  FactorEvaluation,
  FactorKey,
} from "@/lib/domain/types";

// 2025 commercial-property appetite table (documents/APPETITE_GUIDELINES.pdf).
const TARGET_STATES = new Set(["OH", "PA", "MD", "CO", "CA", "FL"]);
const ACCEPTABLE_STATES = new Set([...TARGET_STATES, "NC", "SC", "GA", "VA", "UT"]);
const TIV_TARGET_MIN = 50_000_000;
const TIV_TARGET_MAX = 100_000_000;
const TIV_MAX = 150_000_000;
const PREMIUM_MIN = 50_000;
const PREMIUM_TARGET_MIN = 75_000;
const PREMIUM_TARGET_MAX = 100_000;
const PREMIUM_MAX = 175_000;
const YEAR_ACCEPTABLE_AFTER = 1990;
const YEAR_TARGET_AFTER = 2010;
const LOSS_MAX = 100_000;

const labels: Record<FactorKey, string> = {
  submissionType: "Submission type",
  lineOfBusiness: "Line of business",
  primaryRiskState: "Primary risk state",
  tiv: "Total insured value",
  totalPremium: "Total premium",
  buildingYear: "Building year",
  construction: "Construction type",
  fiveYearLossValue: "Five-year losses",
};

function text(value?: string) {
  return value?.trim().toLowerCase();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function factor(key: FactorKey, verdict: AppetiteVerdict, reason: string): FactorEvaluation {
  return { key, label: labels[key], verdict, reason };
}

function evaluateSubmissionType(value?: string): FactorEvaluation {
  const normalized = text(value);
  if (!normalized) return factor("submissionType", "unknown", "Submission type is missing.");
  if (normalized.includes("renew")) return factor("submissionType", "not_acceptable", "Renewal business is not acceptable.");
  if (normalized.includes("new")) return factor("submissionType", "acceptable", "New business is acceptable.");
  return factor("submissionType", "unknown", `Unrecognized submission type: ${value?.trim()}.`);
}

function evaluateLine(value?: string): FactorEvaluation {
  const normalized = text(value);
  if (!normalized) return factor("lineOfBusiness", "unknown", "Line of business is missing.");
  if (normalized.includes("property")) return factor("lineOfBusiness", "acceptable", "Property business is acceptable.");
  return factor("lineOfBusiness", "not_acceptable", `${value?.trim()} is outside the property appetite.`);
}

function evaluateState(value?: string): FactorEvaluation {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return factor("primaryRiskState", "unknown", "Primary risk state is missing.");
  if (TARGET_STATES.has(normalized)) return factor("primaryRiskState", "target", `${normalized} is a target state.`);
  if (ACCEPTABLE_STATES.has(normalized)) return factor("primaryRiskState", "acceptable", `${normalized} is an acceptable state.`);
  return factor("primaryRiskState", "not_acceptable", `${normalized} is outside the listed states.`);
}

function evaluateTiv(value?: number): FactorEvaluation {
  if (!isFiniteNumber(value) || value <= 0) return factor("tiv", "unknown", "TIV is missing or invalid.");
  const money = formatMoney(value);
  if (value > TIV_MAX) return factor("tiv", "not_acceptable", `TIV ${money} exceeds the $150M limit.`);
  if (value >= TIV_TARGET_MIN && value <= TIV_TARGET_MAX) {
    return factor("tiv", "target", `TIV ${money} is in the $50M–$100M target range.`);
  }
  return factor("tiv", "acceptable", `TIV ${money} is within the $150M acceptable limit.`);
}

function evaluatePremium(value?: number): FactorEvaluation {
  if (!isFiniteNumber(value) || value <= 0) return factor("totalPremium", "unknown", "Premium is missing or invalid.");
  const money = formatMoney(value);
  if (value < PREMIUM_MIN || value > PREMIUM_MAX) {
    return factor("totalPremium", "not_acceptable", `Premium ${money} is outside the $50K–$175K acceptable range.`);
  }
  if (value >= PREMIUM_TARGET_MIN && value <= PREMIUM_TARGET_MAX) {
    return factor("totalPremium", "target", `Premium ${money} is in the $75K–$100K target range.`);
  }
  return factor("totalPremium", "acceptable", `Premium ${money} is in the $50K–$175K acceptable range.`);
}

function evaluateBuildingYear(value?: number): FactorEvaluation {
  if (!isFiniteNumber(value) || !Number.isInteger(value)) {
    return factor("buildingYear", "unknown", "Building year is missing or invalid.");
  }
  if (value > YEAR_TARGET_AFTER) return factor("buildingYear", "target", `Built in ${value}, newer than 2010.`);
  if (value > YEAR_ACCEPTABLE_AFTER) return factor("buildingYear", "acceptable", `Built in ${value}, newer than 1990.`);
  if (value < YEAR_ACCEPTABLE_AFTER) return factor("buildingYear", "not_acceptable", `Built in ${value}, older than 1990.`);
  return factor("buildingYear", "unknown", "The guidelines do not classify a building from exactly 1990.");
}

function evaluateConstruction(value?: number): FactorEvaluation {
  if (!isFiniteNumber(value) || value < 0 || value > 100) {
    return factor("construction", "unknown", "Approved construction percentage is missing or invalid.");
  }
  // Accept either a 0–1 ratio or a 0–100 percentage; exactly 1 is read as 100%.
  const ratio = value > 1 ? value / 100 : value;
  const percent = Math.round(ratio * 100);
  if (ratio > 0.5) return factor("construction", "acceptable", `${percent}% uses an approved construction type (more than 50%).`);
  if (ratio < 0.5) return factor("construction", "not_acceptable", `Only ${percent}% uses an approved construction type; more than 50% is another type.`);
  return factor("construction", "unknown", "The guidelines do not classify an exact 50/50 construction split.");
}

function evaluateLosses(value?: number): FactorEvaluation {
  if (!isFiniteNumber(value) || value < 0) return factor("fiveYearLossValue", "unknown", "Five-year loss value is missing or invalid.");
  const money = formatMoney(value);
  if (value < LOSS_MAX) return factor("fiveYearLossValue", "acceptable", `Five-year losses of ${money} are under $100K.`);
  if (value > LOSS_MAX) return factor("fiveYearLossValue", "not_acceptable", `Five-year losses of ${money} exceed $100K.`);
  return factor("fiveYearLossValue", "unknown", "The guidelines do not classify losses of exactly $100K.");
}

/** All eight factor verdicts, always in the order of the published table. */
export function evaluatePropertyFactors(submission: CanonicalSubmission): FactorEvaluation[] {
  return [
    evaluateSubmissionType(submission.submissionType),
    evaluateLine(submission.lineOfBusiness),
    evaluateState(submission.primaryRiskState),
    evaluateTiv(submission.tiv),
    evaluatePremium(submission.totalPremium),
    evaluateBuildingYear(submission.buildingYear),
    evaluateConstruction(submission.approvedConstructionPercentage),
    evaluateLosses(submission.fiveYearLossValue),
  ];
}
