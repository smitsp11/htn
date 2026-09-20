import { buildTable } from "./helpers";

/**
 * Specialty appetite tables (cyber, health).
 *
 * provenance: synthesized-for-demo — plausible, documented bands for the
 * Extended-mode demo, NOT a real carrier filing. Reuses the shared `buildTable`
 * helper so verdict semantics stay identical across every non-property line.
 * Group Health omits the exposure (`tiv`) factor entirely.
 */

export const CYBER_TABLE = buildTable({
  line: "cyber",
  displayName: "Cyber",
  renewalAcceptable: true,
  targetStates: ["CA", "WA", "NY", "TX", "MA"],
  acceptableStates: "any",
  premium: { min: 20_000, max: 200_000, targetMin: 50_000, targetMax: 120_000 },
  exposureMax: 60_000_000,
  lossMax: 100_000,
});

export const HEALTH_TABLE = buildTable({
  line: "health",
  displayName: "Group Health",
  renewalAcceptable: false,
  targetStates: ["OH", "PA", "MD", "CO", "CA", "FL"],
  acceptableStates: ["NC", "SC", "GA", "VA", "UT"],
  premium: { min: 50_000, max: 500_000, targetMin: 100_000, targetMax: 300_000 },
  // exposureMax intentionally omitted: Group Health carries no exposure factor.
  lossMax: 300_000,
});
