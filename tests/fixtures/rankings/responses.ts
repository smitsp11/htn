import { evaluateAppetite, rankSubmissions } from "../../../lib/domain/appetite";
import type { CanonicalSubmission, RankedSubmission, RankingsResponse } from "../../../lib/domain/types";
import { allAcceptable, contradictory, empty, fullTarget, missingLosses, multipleFailures } from "../domain/submissions";

export const rankedFixtures: RankedSubmission[] = rankSubmissions([
  fullTarget,
  allAcceptable,
  contradictory,
  missingLosses,
  empty,
  multipleFailures,
]);

export const rankedTarget = evaluateAppetite(fullTarget);
export const rankedContradictory = evaluateAppetite(contradictory);
export const rankedEmpty = evaluateAppetite(empty);

export function response(overrides: Partial<RankingsResponse> = {}): RankingsResponse {
  return {
    source: "demo",
    generatedAt: "2026-09-19T12:00:00.000Z",
    schemaDiscovered: false,
    trace: ["Using local demo fixtures; no Federato call was made."],
    submissions: rankedFixtures,
    ...overrides,
  };
}

const states = ["OH", "PA", "MD", "CO", "CA", "FL", "NC", "SC", "GA", "VA", "UT", "TX", "NY"];

/** 55 deterministic submissions spanning every status, for large-queue rendering tests. */
export function largeQueue(): CanonicalSubmission[] {
  return Array.from({ length: 55 }, (_, index) => ({
    id: `SUB-${1000 + index}`,
    accountName: `Account ${String(index + 1).padStart(2, "0")}`,
    submissionType: index % 9 === 0 ? "Renewal business" : "New business",
    lineOfBusiness: "Property",
    primaryRiskState: states[index % states.length],
    effectiveDate: "2026-11-01",
    expirationDate: "2027-11-01",
    tiv: 20_000_000 + index * 3_000_000,
    totalPremium: 45_000 + index * 3_000,
    buildingYear: index % 7 === 0 ? undefined : 1985 + index,
    approvedConstructionPercentage: 0.4 + (index % 6) * 0.1,
    fiveYearLossValue: index % 11 === 0 ? 100_000 : (index * 9_000) % 140_000,
  }));
}
