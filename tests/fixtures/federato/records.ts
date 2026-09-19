/**
 * EXPANDED Federato submission fixtures using the REAL field names. These mirror
 * what `lib/federato/offline-data` builds per submission (nested insured, policy,
 * risk locations with buildings, and policy claims) and exercise every documented
 * join/aggregation/missing-data rule the normalizer applies.
 */

/**
 * Full record: policy present, two risk locations with buildings, dated claims
 * (one inside the 5-year window, one in the future, one too old). Exercises TIV
 * sum, primary-state selection, oldest building year, TIV-weighted approved
 * construction, and the trailing-5-year loss window.
 */
export const expandedRecord = {
  id: 1,
  submission_number: "SUB-2025-00001",
  line_of_business: "property",
  target_effective_date: "2025-09-15",
  status: "bound",
  insured: { name: "Harbor Point Retail LLC" },
  policy: {
    premium: 619_900,
    business_type: "new",
    line_of_business: "property",
    dates: { effective: "2025-10-01", expiration: "2026-10-01" },
  },
  locations: [
    {
      state: "FL",
      buildings: [
        { tiv: 30_000_000, year_built: 2011, construction_type: "Frame", building_value: 18_000_000 },
        { tiv: 6_000_000, year_built: 1974, construction_type: "Joisted Masonry", building_value: 3_000_000 },
      ],
    },
    {
      state: "AZ",
      buildings: [{ tiv: 4_000_000, year_built: 1984, construction_type: "Non-Combustible", building_value: 2_000_000 }],
    },
  ],
  claims: [
    { date_of_loss: "2025-11-21", paid_indemnity: 187_500, paid_expense: 41_200 }, // inside window
    { date_of_loss: "2026-01-26", paid_indemnity: 105_700, paid_expense: 23_200 }, // future -> excluded
    { date_of_loss: "2019-05-01", paid_indemnity: 500_000, paid_expense: 0 }, // older than 5y -> excluded
  ],
};

/** No policy: submission-only fields survive; policy-derived fields stay unknown. */
export const noPolicyRecord = {
  id: 2,
  submission_number: "SUB-2025-00002",
  line_of_business: "property",
  target_effective_date: "2025-08-01",
  insured: { name: "No Policy Co" },
  locations: [
    { state: "TX", buildings: [{ tiv: 5_000_000, year_built: 2000, construction_type: "Fire Resistive" }] },
  ],
};

/** Policy present but zero claims: five-year losses must be 0, not undefined. */
export const policyNoClaimsRecord = {
  id: 3,
  submission_number: "SUB-2025-00003",
  insured: { name: "Empty Claims Inc" },
  policy: {
    premium: 90_000,
    business_type: "renewal",
    dates: { effective: "2025-01-01", expiration: "2026-01-01" },
  },
  locations: [{ state: "CA", buildings: [{ tiv: 8_000_000, year_built: 1988, construction_type: "Wood Frame" }] }],
  claims: [],
};

/** Missing insured and no buildings: unknown account, undefined aggregates. */
export const missingInsuredRecord = {
  id: 4,
  submission_number: "SUB-2025-00004",
  locations: [],
};

/** Buildings without TIV: approved-construction share falls back to equal weight. */
export const equalWeightConstructionRecord = {
  id: 5,
  submission_number: "SUB-2025-00005",
  insured: { name: "Equal Weight Co" },
  policy: { premium: 70_000, business_type: "new", dates: { effective: "2024-01-01" } },
  locations: [
    {
      state: "NY",
      buildings: [
        { construction_type: "Masonry Non-Combustible" }, // approved
        { construction_type: "Frame" }, // combustible
        { construction_type: "Steel Frame" }, // approved
        { construction_type: "Frame" }, // combustible
      ],
    },
  ],
  claims: [],
};

/** Malformed record: wrong types everywhere. Must not throw; yields unknowns. */
export const malformedRecord = {
  id: { nope: true },
  insured: "not-an-object",
  policy: "not-an-object",
  locations: "should-be-an-array",
  claims: { amount: 5 },
};

/** Out-of-appetite record with real values. Must be RETAINED, never dropped. */
export const outOfAppetiteRecord = {
  id: 9,
  submission_number: "SUB-2025-00009",
  insured: { name: "Risky Renewals LLC" },
  policy: {
    premium: 5_000,
    business_type: "renewal",
    dates: { effective: "2025-06-01", expiration: "2026-06-01" },
  },
  locations: [{ state: "XX", buildings: [{ tiv: 500_000_000, year_built: 1965, construction_type: "Frame" }] }],
  claims: [{ date_of_loss: "2024-01-01", paid_indemnity: 900_000, paid_expense: 0 }],
};

/**
 * Flat record: canonical field names as top-level scalars. Proves the
 * `FEDERATO_FIELD_MAP_JSON` seam / flat-response fallback still works.
 */
export const flatRecord = {
  id: "flat-1",
  accountName: "Flat Co",
  submissionType: "new",
  lineOfBusiness: "property",
  primaryRiskState: "CA",
  effectiveDate: "2026-01-01",
  expirationDate: "2027-01-01",
  tiv: 60_000_000,
  totalPremium: 80_000,
  buildingYear: 2015,
  approvedConstructionPercentage: 0.8,
  constructionDescription: "Masonry",
  fiveYearLossValue: 20_000,
};

/** A response envelope wrapping several expanded records under `data`. */
export const responseEnvelope = {
  data: [expandedRecord, noPolicyRecord, policyNoClaimsRecord, outOfAppetiteRecord],
};
