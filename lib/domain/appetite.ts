import type {
  AppetiteStatus,
  CanonicalSubmission,
  FactorEvaluation,
  RankedSubmission,
} from "./types";

const TARGET_STATES = new Set(["OH", "PA", "MD", "CO", "CA", "FL"]);
const ACCEPTABLE_STATES = new Set([
  ...TARGET_STATES,
  "NC",
  "SC",
  "GA",
  "VA",
  "UT",
]);

const labels = {
  submissionType: "Submission type",
  lineOfBusiness: "Line of business",
  primaryRiskState: "Primary risk state",
  tiv: "Total insured value",
  totalPremium: "Total premium",
  buildingYear: "Building year",
  construction: "Construction type",
  fiveYearLossValue: "Five-year losses",
} as const;

function text(value?: string) {
  return value?.trim().toLowerCase();
}

function factor(
  key: FactorEvaluation["key"],
  verdict: FactorEvaluation["verdict"],
  reason: string,
): FactorEvaluation {
  return { key, label: labels[key], verdict, reason };
}

function evaluateSubmissionType(value?: string): FactorEvaluation {
  const normalized = text(value);
  if (!normalized) return factor("submissionType", "unknown", "Submission type is missing.");
  if (normalized.includes("renew")) return factor("submissionType", "not_acceptable", "Renewal business is not acceptable.");
  if (normalized.includes("new")) return factor("submissionType", "acceptable", "New business is acceptable.");
  return factor("submissionType", "unknown", `Unrecognized submission type: ${value}.`);
}

function evaluateLine(value?: string): FactorEvaluation {
  const normalized = text(value);
  if (!normalized) return factor("lineOfBusiness", "unknown", "Line of business is missing.");
  if (normalized.includes("property")) return factor("lineOfBusiness", "acceptable", "Property business is acceptable.");
  return factor("lineOfBusiness", "not_acceptable", `${value} is outside the property appetite.`);
}

function evaluateState(value?: string): FactorEvaluation {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return factor("primaryRiskState", "unknown", "Primary risk state is missing.");
  if (TARGET_STATES.has(normalized)) return factor("primaryRiskState", "target", `${normalized} is a target state.`);
  if (ACCEPTABLE_STATES.has(normalized)) return factor("primaryRiskState", "acceptable", `${normalized} is acceptable.`);
  return factor("primaryRiskState", "not_acceptable", `${normalized} is outside the listed states.`);
}

function evaluateTiv(value?: number): FactorEvaluation {
  if (value === undefined || value < 0) return factor("tiv", "unknown", "TIV is missing or invalid.");
  if (value > 150_000_000) return factor("tiv", "not_acceptable", "TIV exceeds $150M.");
  if (value >= 50_000_000 && value <= 100_000_000) return factor("tiv", "target", "TIV is in the $50M–$100M target range.");
  return factor("tiv", "acceptable", "TIV is within the $150M acceptable limit.");
}

function evaluatePremium(value?: number): FactorEvaluation {
  if (value === undefined || value < 0) return factor("totalPremium", "unknown", "Premium is missing or invalid.");
  if (value < 50_000 || value > 175_000) return factor("totalPremium", "not_acceptable", "Premium is outside $50K–$175K.");
  if (value >= 75_000 && value <= 100_000) return factor("totalPremium", "target", "Premium is in the $75K–$100K target range.");
  return factor("totalPremium", "acceptable", "Premium is in the acceptable range.");
}

function evaluateBuildingYear(value?: number): FactorEvaluation {
  if (value === undefined) return factor("buildingYear", "unknown", "Building year is missing.");
  if (value > 2010) return factor("buildingYear", "target", "Building is newer than 2010.");
  if (value > 1990) return factor("buildingYear", "acceptable", "Building is newer than 1990.");
  if (value < 1990) return factor("buildingYear", "not_acceptable", "Building is older than 1990.");
  return factor("buildingYear", "unknown", "The guidelines do not classify a building from exactly 1990.");
}

function evaluateConstruction(value?: number): FactorEvaluation {
  if (value === undefined) return factor("construction", "unknown", "Approved construction percentage is missing.");
  const ratio = value > 1 && value <= 100 ? value / 100 : value;
  if (ratio > 0.5) return factor("construction", "acceptable", "More than 50% uses an approved construction type.");
  if (ratio < 0.5) return factor("construction", "not_acceptable", "More than 50% uses another construction type.");
  return factor("construction", "unknown", "The guidelines do not classify an exact 50/50 construction split.");
}

function evaluateLosses(value?: number): FactorEvaluation {
  if (value === undefined || value < 0) return factor("fiveYearLossValue", "unknown", "Five-year loss value is missing or invalid.");
  if (value < 100_000) return factor("fiveYearLossValue", "acceptable", "Five-year losses are below $100K.");
  if (value > 100_000) return factor("fiveYearLossValue", "not_acceptable", "Five-year losses exceed $100K.");
  return factor("fiveYearLossValue", "unknown", "The guidelines do not classify losses of exactly $100K.");
}

export function evaluateAppetite(submission: CanonicalSubmission): RankedSubmission {
  const factors = [
    evaluateSubmissionType(submission.submissionType),
    evaluateLine(submission.lineOfBusiness),
    evaluateState(submission.primaryRiskState),
    evaluateTiv(submission.tiv),
    evaluatePremium(submission.totalPremium),
    evaluateBuildingYear(submission.buildingYear),
    evaluateConstruction(submission.approvedConstructionPercentage),
    evaluateLosses(submission.fiveYearLossValue),
  ];

  const unacceptable = factors.filter((item) => item.verdict === "not_acceptable");
  const unknown = factors.filter((item) => item.verdict === "unknown");
  const targets = factors.filter((item) => item.verdict === "target");
  const accepted = factors.filter((item) => item.verdict === "target" || item.verdict === "acceptable");
  const score = Math.round(((accepted.length + targets.length) / 12) * 100);

  let status: AppetiteStatus = "in_appetite";
  if (unacceptable.length > 0) status = "out_of_appetite";
  else if (unknown.length > 0) status = "needs_investigation";

  const recommendation = status === "in_appetite"
    ? "Review for acceptance"
    : status === "needs_investigation"
      ? "Investigate missing or ambiguous data"
      : "Underwriter review; likely reject";

  const positiveText = targets.length > 0
    ? `Target matches include ${targets.map((item) => item.label.toLowerCase()).join(", ")}.`
    : `${accepted.length} of 8 factors are acceptable.`;
  const concernText = unacceptable.length > 0
    ? `Outside appetite: ${unacceptable.map((item) => item.label.toLowerCase()).join(", ")}.`
    : unknown.length > 0
      ? `More information is needed for ${unknown.map((item) => item.label.toLowerCase()).join(", ")}.`
      : "No out-of-appetite factors were found.";

  return {
    ...submission,
    status,
    score,
    factors,
    recommendation,
    explanation: `${submission.accountName} scored ${score}/100 against the published appetite. ${positiveText} ${concernText} Recommendation: ${recommendation}.`,
  };
}

const statusOrder: Record<AppetiteStatus, number> = {
  in_appetite: 0,
  needs_investigation: 1,
  out_of_appetite: 2,
};

export function rankSubmissions(submissions: CanonicalSubmission[]) {
  return submissions
    .map(evaluateAppetite)
    .sort((left, right) => statusOrder[left.status] - statusOrder[right.status] || right.score - left.score || left.accountName.localeCompare(right.accountName));
}
