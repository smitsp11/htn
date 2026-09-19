/**
 * ASSUMED raw Federato record fixtures for the adapter tests. These are the
 * kind of nested/array/reference shapes the normalizer must fold into a single
 * CanonicalSubmission. They are guesses at the live shape, used only to prove
 * the documented aggregation and missing-data rules.
 */

/** Flat record: every canonical field present as a top-level scalar. */
export const flatRecord = {
  id: "sub-1",
  accountName: "Flat Co",
  submissionType: "New business",
  lineOfBusiness: "Property",
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

/**
 * Nested record: multiple locations (each with buildings), an expanded account
 * reference, layered premium, and a dated loss history. Exercises every
 * aggregation rule.
 */
export const nestedRecord = {
  id: "sub-2",
  account: { id: 7, name: "Nested Holdings" },
  submissionType: "New business",
  lineOfBusiness: "Property",
  effectiveDate: "2026-06-01",
  layers: [{ premium: 60_000 }, { premium: 30_000 }],
  locations: [
    {
      state: "OH",
      isPrimary: false,
      buildings: [
        { yearBuilt: 2001, constructionType: "Frame", value: 10_000_000, approvedConstruction: true },
        { yearBuilt: 1998, constructionType: "Masonry", value: 5_000_000, approvedConstruction: true },
      ],
    },
    {
      state: "PA",
      isPrimary: true,
      buildings: [{ yearBuilt: 1995, constructionType: "Joisted Masonry", value: 8_000_000, approvedConstruction: false }],
    },
  ],
  lossHistory: [
    { year: 2024, amount: 15_000 },
    { year: 2023, amount: 10_000 },
    { year: 2015, amount: 500_000 }, // Older than the 5-year window; must be excluded.
  ],
};

/**
 * Record with an UNEXPANDED reference (account is a bare id) and missing appetite
 * inputs. Proves references that were not expanded stay unknown and missing data
 * is preserved as undefined rather than invented.
 */
export const missingAndUnexpandedRecord = {
  id: "sub-3",
  account: 42, // Not expanded: no name available -> "Unknown account".
  submissionType: "New business",
  // lineOfBusiness, locations, premium, losses all absent.
};

/** Malformed record: wrong types everywhere. Must not throw; must yield unknowns. */
export const malformedRecord = {
  id: { nope: true },
  accountName: ["still", "wrong"],
  tiv: "not-a-number",
  totalPremium: {},
  buildingYear: "MCMXC",
  locations: "should-be-an-array",
  lossHistory: { amount: 5 },
};

/** Out-of-appetite record: real values that fail appetite. Must be RETAINED. */
export const outOfAppetiteRecord = {
  id: "sub-4",
  accountName: "Risky Renewals LLC",
  submissionType: "Renewal business",
  lineOfBusiness: "Property",
  primaryRiskState: "TX",
  tiv: 500_000_000,
  totalPremium: 5_000,
  buildingYear: 1965,
  approvedConstructionPercentage: 0.1,
  fiveYearLossValue: 900_000,
};

/** Record whose losses are undated: rule says sum them all. */
export const undatedLossesRecord = {
  id: "sub-5",
  accountName: "Undated Losses Inc",
  losses: [{ amount: 12_000 }, { amount: 8_000 }],
};

/** Buildings carry approval flags but no values: count-weighted construction share. */
export const countWeightedConstructionRecord = {
  id: "sub-6",
  accountName: "Count Weighted Co",
  locations: [
    {
      state: "FL",
      buildings: [
        { constructionType: "Masonry", approvedConstruction: true },
        { constructionType: "Frame", approvedConstruction: true },
        { constructionType: "Frame", approvedConstruction: false },
        { constructionType: "Steel", approvedConstruction: true },
      ],
    },
  ],
};

/** A full response envelope wrapping several records under `data`. */
export const responseEnvelope = {
  data: [flatRecord, nestedRecord, missingAndUnexpandedRecord, outOfAppetiteRecord],
};
