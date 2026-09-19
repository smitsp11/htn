import type { CanonicalSubmission } from "../../../lib/domain/types";

/** Every factor is at its target tier (or acceptable where no target tier exists). */
export const fullTarget: CanonicalSubmission = {
  id: "fx-target",
  accountName: "Target Account",
  submissionType: "New business",
  lineOfBusiness: "Property",
  primaryRiskState: "CA",
  effectiveDate: "2026-10-01",
  expirationDate: "2027-10-01",
  tiv: 75_000_000,
  totalPremium: 90_000,
  buildingYear: 2020,
  approvedConstructionPercentage: 0.75,
  fiveYearLossValue: 25_000,
};

/** Every factor is acceptable but none reach the target tier. */
export const allAcceptable: CanonicalSubmission = {
  ...fullTarget,
  id: "fx-acceptable",
  accountName: "Acceptable Account",
  primaryRiskState: "UT",
  tiv: 120_000_000,
  totalPremium: 140_000,
  buildingYear: 2002,
};

/** Strong target matches paired with one hard-gate failure. */
export const contradictory: CanonicalSubmission = {
  ...fullTarget,
  id: "fx-contradictory",
  accountName: "Contradictory Account",
  submissionType: "Renewal business",
};

/** Otherwise on-target but one appetite input is missing entirely. */
export const missingLosses: CanonicalSubmission = {
  ...fullTarget,
  id: "fx-missing",
  accountName: "Missing Losses Account",
  fiveYearLossValue: undefined,
};

/** No appetite inputs at all; only identity fields. */
export const empty: CanonicalSubmission = {
  id: "fx-empty",
  accountName: "Empty Account",
};

/** Several simultaneous unacceptable factors plus an unknown. */
export const multipleFailures: CanonicalSubmission = {
  ...fullTarget,
  id: "fx-multi",
  accountName: "Multiple Failures Account",
  primaryRiskState: "TX",
  tiv: 200_000_000,
  fiveYearLossValue: 250_000,
  buildingYear: undefined,
};
