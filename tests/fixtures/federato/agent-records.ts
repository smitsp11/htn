/**
 * Hydrated rows in the shape the agent's root query returns for `agentSchema`
 * (references expanded in place). They exercise every aggregation rule the
 * assembler documents: shared locations, value-weighted state, oldest
 * building, value-weighted construction, the five-year loss window, HQ
 * fallback, and malformed input.
 */

const harborFl = {
  id: 7,
  state: "FL",
  county: "Miami-Dade",
  buildings: [
    { id: 1, tiv: 30_000_000, year_built: 2011, construction_type: "Frame" },
    { id: 2, tiv: 6_000_000, year_built: 1974, construction_type: "Joisted Masonry" },
  ],
};

const harborAz = {
  id: 8,
  state: "AZ",
  county: "Maricopa",
  buildings: [{ id: 3, tiv: 4_000_000, year_built: 1984, construction_type: "Non-Combustible" }],
};

const harborHq = {
  id: 9,
  state: "NY",
  county: "New York",
  buildings: [{ id: 4, tiv: 99_000_000, year_built: 1920, construction_type: "Frame" }],
};

/**
 * Two exposure units share the FL location, and the AZ unit carries a larger
 * receipts basis than the FL units' insured value. Correct handling counts
 * FL's buildings once, weights the state by building value (FL), and ignores
 * the HQ buildings entirely.
 */
export const boundPolicyRow = {
  id: 1001,
  policy_number: "PR-2025-1001",
  submission: { id: 1 },
  insured: { id: 1, name: "Harbor Point Retail LLC", hq: harborHq },
  business_type: "new",
  line_of_business: "property",
  dates: { effective: "2025-10-01", expiration: "2026-10-01" },
  premium: 619_900,
  target_premium: 700_000,
  exposure_units: [
    { id: 1, kind: "location", basis: "tiv", basis_amount: 36_000_000, location: harborFl },
    { id: 2, kind: "location", basis: "tiv", basis_amount: 36_000_000, location: harborFl },
    { id: 3, kind: "location", basis: "receipts", basis_amount: 50_000_000, location: harborAz },
  ],
  claims: [
    { id: 1, date_of_loss: "2025-11-21", paid_indemnity: 187_500, paid_expense: 41_200, reserve_indemnity: 1_000_000 },
    { id: 2, date_of_loss: "2026-01-26", paid_indemnity: 105_700, paid_expense: 23_200, reserve_indemnity: 0 },
    { id: 3, date_of_loss: "2019-05-01", paid_indemnity: 500_000, paid_expense: 0, reserve_indemnity: 0 },
  ],
};

/** The queue record the bound policy links to. */
export const boundQueueRow = {
  id: 1,
  submission_number: "SUB-2025-00001",
  line_of_business: "property",
  target_effective_date: "2025-09-15",
  requested_limit: 40_000_000,
  insured: { id: 1, name: "Harbor Point Retail LLC", hq: harborHq },
};

/** A policy whose only exposure is a fleet: no risk location, so HQ stands in. */
export const fleetPolicyRow = {
  id: 1002,
  policy_number: "AU-2025-1002",
  submission: { id: 2 },
  insured: { id: 2, name: "Fleet Co", hq: { id: 10, state: "TX", buildings: [{ id: 5, tiv: 5_000_000, year_built: 2000, construction_type: "Fire Resistive" }] } },
  business_type: "renewal",
  line_of_business: "auto",
  dates: { effective: "2025-06-01", expiration: "2026-06-01" },
  premium: 80_000,
  exposure_units: [{ id: 4, kind: "vehicle", basis: "cost_new", basis_amount: 100_000 }],
  claims: [],
};

export const fleetQueueRow = {
  id: 2,
  submission_number: "SUB-2025-00002",
  line_of_business: "auto",
  target_effective_date: "2025-06-01",
  requested_limit: 1_000_000,
  insured: { id: 2, name: "Fleet Co", hq: { id: 10, state: "TX", buildings: [{ id: 5, tiv: 5_000_000, year_built: 2000, construction_type: "Fire Resistive" }] } },
};

/** A submission that has no policy at all. */
export const unboundQueueRow = {
  id: 3,
  submission_number: "SUB-2025-00003",
  line_of_business: "property",
  target_effective_date: "2025-08-01",
  requested_limit: 5_000_000,
  insured: { id: 3, name: "No Policy Co", hq: { id: 11, state: "TX", county: "Travis", buildings: [{ id: 6, tiv: 7_000_000, year_built: 2005, construction_type: "Steel Frame" }] } },
};

/** A submission with no policy, no HQ buildings and a requested limit only. */
export const bareQueueRow = {
  id: 4,
  submission_number: "SUB-2025-00004",
  line_of_business: "property",
  target_effective_date: "2025-08-01",
  requested_limit: 2_000_000,
  insured: { id: 4, name: "Bare Co", hq: { id: 12, state: "OH" } },
};

/** Garbage where records should be; nothing here may throw or be invented. */
export const malformedPolicyRow = {
  id: { nested: true },
  policy_number: null,
  submission: "not-an-id",
  insured: 5,
  business_type: 12,
  dates: "2025",
  premium: "lots",
  exposure_units: "nope",
  claims: null,
};
