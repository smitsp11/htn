import { formatMoney } from "@/lib/domain/format";
import type {
  AppetiteVerdict,
  BuildingFact,
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
export const PROPERTY_PREMIUM_BANDS = {
  min: 50_000,
  max: 175_000,
  targetMin: 75_000,
  targetMax: 100_000,
} as const;
const YEAR_ACCEPTABLE_AFTER = 1990;
const YEAR_TARGET_AFTER = 2010;
const LOSS_MAX = 100_000;

/**
 * Near-miss bands. A not-acceptable value this close to its boundary is
 * flagged so an underwriter (and the adaptive follow-up) can see that one
 * confirmed figure would change the verdict. The verdict itself is unchanged:
 * a near miss is still not acceptable.
 */
export const NEAR_MISS_MONEY_SHARE = 0.05;
export const NEAR_MISS_YEARS = 2;
export const NEAR_MISS_CONSTRUCTION_POINTS = 5;

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

function factor(
  key: FactorKey,
  verdict: AppetiteVerdict,
  reason: string,
  extra: Pick<FactorEvaluation, "detail" | "nearMiss"> = {},
): FactorEvaluation {
  const evaluation: FactorEvaluation = { key, label: labels[key], verdict, reason };
  if (extra.detail) evaluation.detail = extra.detail;
  if (extra.nearMiss) evaluation.nearMiss = true;
  return evaluation;
}

function moneyNearMiss(delta: number, boundary: number): boolean {
  return delta <= boundary * NEAR_MISS_MONEY_SHARE;
}

function years(count: number): string {
  return `${count} year${count === 1 ? "" : "s"}`;
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
  if (value > TIV_MAX) {
    const delta = value - TIV_MAX;
    return factor("tiv", "not_acceptable", `TIV ${money} exceeds the $150M limit by ${formatMoney(delta)}.`, {
      nearMiss: moneyNearMiss(delta, TIV_MAX),
    });
  }
  if (value >= TIV_TARGET_MIN && value <= TIV_TARGET_MAX) {
    return factor("tiv", "target", `TIV ${money} is in the $50M–$100M target range.`);
  }
  return factor("tiv", "acceptable", `TIV ${money} is within the $150M acceptable limit.`);
}

function evaluatePremium(value?: number): FactorEvaluation {
  if (!isFiniteNumber(value) || value <= 0) return factor("totalPremium", "unknown", "Premium is missing or invalid.");
  const money = formatMoney(value);
  if (value < PROPERTY_PREMIUM_BANDS.min) {
    const delta = PROPERTY_PREMIUM_BANDS.min - value;
    return factor("totalPremium", "not_acceptable", `Premium ${money} is ${formatMoney(delta)} below the $50K minimum.`, {
      nearMiss: moneyNearMiss(delta, PROPERTY_PREMIUM_BANDS.min),
    });
  }
  if (value > PROPERTY_PREMIUM_BANDS.max) {
    const delta = value - PROPERTY_PREMIUM_BANDS.max;
    return factor("totalPremium", "not_acceptable", `Premium ${money} is ${formatMoney(delta)} above the $175K maximum.`, {
      nearMiss: moneyNearMiss(delta, PROPERTY_PREMIUM_BANDS.max),
    });
  }
  if (value >= PROPERTY_PREMIUM_BANDS.targetMin && value <= PROPERTY_PREMIUM_BANDS.targetMax) {
    return factor("totalPremium", "target", `Premium ${money} is in the $75K–$100K target range.`);
  }
  return factor("totalPremium", "acceptable", `Premium ${money} is in the $50K–$175K acceptable range.`);
}

function yearVerdict(year: number): AppetiteVerdict {
  if (year > YEAR_TARGET_AFTER) return "target";
  if (year > YEAR_ACCEPTABLE_AFTER) return "acceptable";
  if (year < YEAR_ACCEPTABLE_AFTER) return "not_acceptable";
  return "unknown";
}

const verdictPhrase: Record<AppetiteVerdict, string> = {
  target: "would be a target match",
  acceptable: "would be acceptable",
  not_acceptable: "would still be not acceptable",
  unknown: "would still be unclassified",
};

/**
 * How much the building-year verdict depends on the "oldest building" rule.
 * Reads the schedule the query agent supplied and reports, without changing
 * the verdict, what a value-weighted reading would conclude. Returns nothing
 * for a single building or when no building carries a year.
 */
export function buildingYearSensitivity(oldest: number, buildings: BuildingFact[] | undefined): string | undefined {
  const dated = (buildings ?? []).filter((building): building is BuildingFact & { year: number } =>
    isFiniteNumber(building.year) && Number.isInteger(building.year),
  );
  if (dated.length < 2) return undefined;

  const newerThanCutoff = dated.filter((building) => building.year > YEAR_ACCEPTABLE_AFTER).length;
  const totalValue = dated.reduce((sum, building) => sum + (isFiniteNumber(building.value) ? building.value : 0), 0);
  const parts = [`The verdict follows the oldest of ${dated.length} buildings`];

  if (totalValue > 0) {
    const oldestValue = dated
      .filter((building) => building.year === oldest)
      .reduce((sum, building) => sum + (isFiniteNumber(building.value) ? building.value : 0), 0);
    const oldestShare = Math.round((oldestValue / totalValue) * 100);
    const weightedYear = Math.round(
      dated.reduce((sum, building) => sum + building.year * (isFiniteNumber(building.value) ? building.value : 0), 0) / totalValue,
    );
    parts[0] += `, which holds ${oldestShare}% of the schedule's value`;
    parts.push(
      `${newerThanCutoff} of ${dated.length} were built after ${YEAR_ACCEPTABLE_AFTER}`,
      `the value-weighted year is ${weightedYear}, which ${verdictPhrase[yearVerdict(weightedYear)]}`,
    );
  } else {
    parts.push(`${newerThanCutoff} of ${dated.length} were built after ${YEAR_ACCEPTABLE_AFTER} (no building values to weight by)`);
  }
  return `${parts.join("; ")}.`;
}

function evaluateBuildingYear(value?: number, buildings?: BuildingFact[]): FactorEvaluation {
  if (!isFiniteNumber(value) || !Number.isInteger(value)) {
    return factor("buildingYear", "unknown", "Building year is missing or invalid.");
  }
  if (value > YEAR_TARGET_AFTER) return factor("buildingYear", "target", `Built in ${value}, newer than 2010.`);
  if (value > YEAR_ACCEPTABLE_AFTER) return factor("buildingYear", "acceptable", `Built in ${value}, newer than 1990.`);
  const detail = buildingYearSensitivity(value, buildings);
  if (value < YEAR_ACCEPTABLE_AFTER) {
    const delta = YEAR_ACCEPTABLE_AFTER - value;
    return factor("buildingYear", "not_acceptable", `Built in ${value}, ${years(delta)} before the 1990 cutoff.`, {
      nearMiss: delta <= NEAR_MISS_YEARS,
      detail,
    });
  }
  return factor("buildingYear", "unknown", "The guidelines do not classify a building from exactly 1990.", { detail });
}

function evaluateConstruction(value?: number): FactorEvaluation {
  if (!isFiniteNumber(value) || value < 0 || value > 100) {
    return factor("construction", "unknown", "Approved construction percentage is missing or invalid.");
  }
  // Accept either a 0–1 ratio or a 0–100 percentage; exactly 1 is read as 100%.
  const ratio = value > 1 ? value / 100 : value;
  const percent = Math.round(ratio * 100);
  if (ratio > 0.5) return factor("construction", "acceptable", `${percent}% uses an approved construction type (more than 50%).`);
  if (ratio < 0.5) {
    const shortfall = 50 - percent;
    return factor(
      "construction",
      "not_acceptable",
      `Only ${percent}% uses an approved construction type, ${shortfall} point${shortfall === 1 ? "" : "s"} short of the more-than-50% requirement.`,
      { nearMiss: shortfall <= NEAR_MISS_CONSTRUCTION_POINTS },
    );
  }
  return factor("construction", "unknown", "The guidelines do not classify an exact 50/50 construction split.");
}

function evaluateLosses(value?: number): FactorEvaluation {
  if (!isFiniteNumber(value) || value < 0) return factor("fiveYearLossValue", "unknown", "Five-year loss value is missing or invalid.");
  const money = formatMoney(value);
  if (value < LOSS_MAX) return factor("fiveYearLossValue", "acceptable", `Five-year losses of ${money} are under $100K.`);
  if (value > LOSS_MAX) {
    const delta = value - LOSS_MAX;
    return factor("fiveYearLossValue", "not_acceptable", `Five-year losses of ${money} exceed the $100K limit by ${formatMoney(delta)}.`, {
      nearMiss: moneyNearMiss(delta, LOSS_MAX),
    });
  }
  return factor("fiveYearLossValue", "unknown", "The guidelines do not classify losses of exactly $100K.");
}

/**
 * All eight factor verdicts, always in the order of the published table. Every
 * out-of-range reason states the distance to the boundary, and a value inside
 * the near-miss band carries the flag; neither changes the verdict.
 */
export function evaluatePropertyFactors(submission: CanonicalSubmission): FactorEvaluation[] {
  return [
    evaluateSubmissionType(submission.submissionType),
    evaluateLine(submission.lineOfBusiness),
    evaluateState(submission.primaryRiskState),
    evaluateTiv(submission.tiv),
    evaluatePremium(submission.totalPremium),
    evaluateBuildingYear(submission.buildingYear, submission.buildingSchedule),
    evaluateConstruction(submission.approvedConstructionPercentage),
    evaluateLosses(submission.fiveYearLossValue),
  ];
}
