/**
 * Walkthrough-only locations. These are deliberately synthetic. When an underwriter applies
 * the walkthrough, they enter the visible demo scoring view so the reasoning is concrete, but
 * never enter research evidence, citations or durable underwriting state.
 */
const CITIES = [
  ['90 W Broad St', 'Columbus', 'OH', '43215', 39.9612, -82.9988],
  ['121 N LaSalle St', 'Chicago', 'IL', '60602', 41.8830, -87.6320],
  ['315 E Kennedy Blvd', 'Tampa', 'FL', '33602', 27.9475, -82.4572],
  ['901 Bagby St', 'Houston', 'TX', '77002', 29.7604, -95.3698],
  ['1437 Bannock St', 'Denver', 'CO', '80202', 39.7392, -104.9903],
  ['600 E 4th St', 'Charlotte', 'NC', '28202', 35.2271, -80.8431],
  ['200 W Washington St', 'Phoenix', 'AZ', '85003', 33.4484, -112.0740],
  ['600 4th Ave', 'Seattle', 'WA', '98104', 47.6062, -122.3321],
];

export function demoLocationFor(row) {
  const id = Math.abs(Number(row.id) || 0);
  const [address, city, state, zip, latitude, longitude] = CITIES[id % CITIES.length];
  return { address, city, state, zip, latitude, longitude, geocodable: true, synthetic: true, label: `Synthetic demo location for ${row.submissionNumber}` };
}

import { scoreSubmission } from './scoring.js';
import { buildEscalations } from './escalation.js';

/** Populate a walkthrough row with the same deterministic appetite rules. */
export function demoScenarioFor(row, rules) {
  const location = demoLocationFor(row);
  const id = Math.abs(Number(row.id) || 0);
  const tiv = 50_000_000 + (id % 5) * 10_000_000;
  const premium = 75_000 + (id % 3) * 12_500;
  const building = { id: `demo-${id}`, locationId: `demo-location-${id}`, tiv, yearBuilt: 2015 + id % 6, constructionType: 'Steel Frame', roofYear: 2023, occupancy: 'Office', sprinklered: true };
  const facts = {
    ...row, submissionNumber: `${row.submissionNumber} · DEMO`, accountName: `${row.accountName} · Demo scenario`,
    businessTypes: ['new'], premium, targetPremium: premium, usd: true,
    effectiveDate: row.effectiveDate ?? '2025-10-01', expirationDates: ['2026-10-01'], datesComplete: true,
    primaryState: location.state, stateTiv: { [location.state]: tiv }, tiv, knownTiv: tiv, exposuresComplete: true, statesComplete: true,
    sites: [{ id: building.locationId, address: location.address, city: location.city, state: location.state, zip: location.zip, latitude: location.latitude, longitude: location.longitude, geocodable: true }],
    buildings: [building], tivSubstituted: false,
    loss: { observed: id % 4 === 0 ? 25_000 : 0, valuesComplete: true, historyComplete: true, confidence: 'verified', claimIds: [], claims: [], openClaims: 0, coverageRatio: 1, coveredDays: 1826, coveredRanges: [], gaps: [], policyCount: 5, windowStart: '2020-10-01', windowEndExclusive: '2025-10-01' },
    issues: [], sources: { submission: `DemoSubmission:${id}`, policies: ['DemoPolicy'], locations: [building.locationId], buildings: [building.id], claims: [] },
  };
  const scored = scoreSubmission(facts, rules);
  return { ...scored, ...buildEscalations(scored, rules), submissionNumber: row.submissionNumber, accountName: row.accountName, demoScenario: true, demoLocation: location };
}
