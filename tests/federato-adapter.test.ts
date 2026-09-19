import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalSubmission } from "../lib/domain/types";
import { buildQueryPayload, normalizeQueryResponse } from "../lib/federato/adapter";
import { realSchema } from "./fixtures/federato/schema";
import {
  equalWeightConstructionRecord,
  expandedRecord,
  flatRecord,
  malformedRecord,
  missingInsuredRecord,
  noPolicyRecord,
  outOfAppetiteRecord,
  policyNoClaimsRecord,
  responseEnvelope,
} from "./fixtures/federato/records";

const CANONICAL_KEYS: (keyof CanonicalSubmission)[] = [
  "id",
  "accountName",
  "submissionType",
  "lineOfBusiness",
  "primaryRiskState",
  "effectiveDate",
  "expirationDate",
  "tiv",
  "totalPremium",
  "buildingYear",
  "approvedConstructionPercentage",
  "constructionDescription",
  "fiveYearLossValue",
];

function one(raw: unknown): CanonicalSubmission {
  const [submission] = normalizeQueryResponse(raw);
  assert.ok(submission, "expected exactly one normalized submission");
  return submission;
}

test("normalizes a full expanded record with all joins and aggregations", () => {
  const submission = one([expandedRecord]);
  // id = submission_number; account = expanded insured name.
  assert.equal(submission.id, "SUB-2025-00001");
  assert.equal(submission.accountName, "Harbor Point Retail LLC");
  assert.equal(submission.submissionType, "new"); // policy.business_type
  assert.equal(submission.lineOfBusiness, "property");
  // Primary risk state: FL location (36M) outweighs AZ (4M).
  assert.equal(submission.primaryRiskState, "FL");
  // Policy dates win over the submission target date.
  assert.equal(submission.effectiveDate, "2025-10-01");
  assert.equal(submission.expirationDate, "2026-10-01");
  // TIV: sum of building tiv across both locations (30M + 6M + 4M).
  assert.equal(submission.tiv, 40_000_000);
  assert.equal(submission.totalPremium, 619_900);
  // Building year: oldest across all buildings (1974).
  assert.equal(submission.buildingYear, 1974);
  // Approved construction: TIV-weighted ratio ((6M JM + 4M NC) / 40M = 0.25).
  assert.equal(submission.approvedConstructionPercentage, 0.25);
  assert.equal(submission.constructionDescription, "Frame, Joisted Masonry, Non-Combustible");
  // Five-year losses: only the 2025 claim (228,700); 2026 (future) and 2019 excluded.
  assert.equal(submission.fiveYearLossValue, 228_700);
});

test("no policy leaves policy-derived fields undefined but keeps submission data", () => {
  const submission = one([noPolicyRecord]);
  assert.equal(submission.submissionType, undefined);
  assert.equal(submission.totalPremium, undefined);
  assert.equal(submission.expirationDate, undefined);
  // No policy -> loss history is unknown, not zero.
  assert.equal(submission.fiveYearLossValue, undefined);
  // Falls back to the submission's target effective date.
  assert.equal(submission.effectiveDate, "2025-08-01");
  assert.equal(submission.lineOfBusiness, "property");
  assert.equal(submission.tiv, 5_000_000);
  assert.equal(submission.buildingYear, 2000);
  assert.equal(submission.primaryRiskState, "TX");
  assert.equal(submission.approvedConstructionPercentage, 1); // Fire Resistive is approved
});

test("policy with zero claims reports five-year losses as 0, not undefined", () => {
  const submission = one([policyNoClaimsRecord]);
  assert.equal(submission.fiveYearLossValue, 0);
  assert.equal(submission.submissionType, "renewal");
  assert.equal(submission.approvedConstructionPercentage, 0); // Wood Frame is combustible
});

test("missing insured and no buildings yields unknown account and undefined aggregates", () => {
  const submission = one([missingInsuredRecord]);
  assert.equal(submission.accountName, "Unknown account");
  assert.equal(submission.tiv, undefined);
  assert.equal(submission.buildingYear, undefined);
  assert.equal(submission.approvedConstructionPercentage, undefined);
  assert.equal(submission.primaryRiskState, undefined);
  assert.equal(submission.fiveYearLossValue, undefined);
});

test("falls back to equal-weight construction share when building TIVs are absent", () => {
  const submission = one([equalWeightConstructionRecord]);
  // 2 of 4 buildings approved -> 0.5.
  assert.equal(submission.approvedConstructionPercentage, 0.5);
  assert.equal(submission.constructionDescription, "Frame, Masonry Non-Combustible, Steel Frame");
  assert.equal(submission.tiv, undefined);
  assert.equal(submission.primaryRiskState, "NY");
});

test("handles malformed records without throwing and yields unknowns, not garbage", () => {
  const submission = one([malformedRecord]);
  assert.equal(submission.id, "submission-1"); // object id -> synthetic fallback
  assert.equal(submission.accountName, "Unknown account");
  assert.equal(submission.tiv, undefined);
  assert.equal(submission.totalPremium, undefined);
  assert.equal(submission.buildingYear, undefined);
  assert.equal(submission.primaryRiskState, undefined);
  assert.equal(submission.fiveYearLossValue, undefined); // policy is not an object
});

test("normalizes flat records via the field-map / flat-response fallback", () => {
  const submission = one([flatRecord]);
  assert.equal(submission.id, "flat-1");
  assert.equal(submission.accountName, "Flat Co");
  assert.equal(submission.tiv, 60_000_000);
  assert.equal(submission.totalPremium, 80_000);
  assert.equal(submission.buildingYear, 2015);
  assert.equal(submission.approvedConstructionPercentage, 0.8);
  assert.equal(submission.fiveYearLossValue, 20_000);
});

test("retains out-of-appetite records instead of dropping them", () => {
  const raw = { data: [expandedRecord, outOfAppetiteRecord] };
  const submissions = normalizeQueryResponse(raw);
  assert.equal(submissions.length, 2, "no record may be dropped for being out of appetite");
  const risky = submissions.find((submission) => submission.id === "SUB-2025-00009");
  assert.ok(risky, "out-of-appetite record must survive normalization");
  assert.equal(risky.submissionType, "renewal");
  assert.equal(risky.tiv, 500_000_000);
  assert.equal(risky.fiveYearLossValue, 900_000);
});

test("unwraps a response envelope and normalizes every record", () => {
  const submissions = normalizeQueryResponse(responseEnvelope);
  assert.equal(submissions.length, 4);
});

test("never leaks raw API shapes downstream (only canonical keys are emitted)", () => {
  const submissions = normalizeQueryResponse([expandedRecord, noPolicyRecord]);
  for (const submission of submissions) {
    assert.deepEqual(Object.keys(submission).sort(), [...CANONICAL_KEYS].sort());
    for (const leaked of ["insured", "policy", "locations", "buildings", "claims"]) {
      assert.ok(!(leaked in submission), `canonical output must not leak ${leaked}`);
    }
  }
});

test("returns an empty array for unrecognised shapes", () => {
  assert.deepEqual(normalizeQueryResponse(null), []);
  assert.deepEqual(normalizeQueryResponse({ nothing: true }), []);
});

test("buildQueryPayload generates a projection from the discovered schema", () => {
  delete process.env.FEDERATO_QUERY_PAYLOAD_JSON;
  const payload = buildQueryPayload(realSchema) as Record<string, unknown>;
  assert.equal(payload.resource, "Submission");
  assert.ok(payload.select, "a projection should be generated");
});

test("buildQueryPayload honors the FEDERATO_QUERY_PAYLOAD_JSON override seam", () => {
  process.env.FEDERATO_QUERY_PAYLOAD_JSON = JSON.stringify({ resource: "pinned" });
  try {
    const payload = buildQueryPayload(realSchema) as Record<string, unknown>;
    assert.equal(payload.resource, "pinned");
  } finally {
    delete process.env.FEDERATO_QUERY_PAYLOAD_JSON;
  }
});
