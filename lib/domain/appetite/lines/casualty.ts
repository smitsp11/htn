import { buildTable } from "./helpers";

/**
 * Casualty appetite tables (cgl, auto, excess, lpl).
 *
 * provenance: synthesized-for-demo. These bands are plausible and internally
 * documented for the Extended-mode demo; they are NOT a real carrier filing.
 * Only the shared FactorKeys carry over from property — property-only keys
 * (buildingYear, construction, lineOfBusiness) are intentionally omitted.
 * `tiv` is reused as the line's exposure/limit basis.
 */

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
