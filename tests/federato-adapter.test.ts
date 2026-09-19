import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalSubmission } from "../lib/domain/types";
import { buildQueryPayload, normalizeQueryResponse } from "../lib/federato/adapter";
import { schemaWithSubmissions } from "./fixtures/federato/schema";
import {
  countWeightedConstructionRecord,
  flatRecord,
  malformedRecord,
  missingAndUnexpandedRecord,
  nestedRecord,
  outOfAppetiteRecord,
  responseEnvelope,
  undatedLossesRecord,
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

test("normalizes a flat record straight into the canonical contract", () => {
  const submission = one([flatRecord]);
  assert.equal(submission.id, "sub-1");
  assert.equal(submission.accountName, "Flat Co");
  assert.equal(submission.tiv, 60_000_000);
  assert.equal(submission.totalPremium, 80_000);
  assert.equal(submission.buildingYear, 2015);
  assert.equal(submission.fiveYearLossValue, 20_000);
});

test("aggregates nested locations, buildings, references, layers, and dated losses", () => {
  const submission = one([nestedRecord]);
  // Reference expanded to a value, not a bare id.
  assert.equal(submission.accountName, "Nested Holdings");
  // TIV: sum of building values across both locations (10M + 5M + 8M).
  assert.equal(submission.tiv, 23_000_000);
  // Premium: sum of layer premiums (60K + 30K).
  assert.equal(submission.totalPremium, 90_000);
  // Primary risk state: the isPrimary location (PA).
  assert.equal(submission.primaryRiskState, "PA");
  // Building year: oldest across all buildings (1995).
  assert.equal(submission.buildingYear, 1995);
  // Approved construction: value-weighted share (15M approved / 23M total = 65%).
  assert.equal(submission.approvedConstructionPercentage, 65);
  // Construction description: sorted distinct types.
  assert.equal(submission.constructionDescription, "Frame, Joisted Masonry, Masonry");
  // Five-year losses: only within the trailing window (15K + 10K); 2015 excluded.
  assert.equal(submission.fiveYearLossValue, 25_000);
});

test("preserves missing data as undefined and does not invent unexpanded references", () => {
  const submission = one([missingAndUnexpandedRecord]);
  assert.equal(submission.accountName, "Unknown account"); // bare id, never guessed
  assert.equal(submission.lineOfBusiness, undefined);
  assert.equal(submission.tiv, undefined);
  assert.equal(submission.totalPremium, undefined);
  assert.equal(submission.buildingYear, undefined);
  assert.equal(submission.approvedConstructionPercentage, undefined);
  assert.equal(submission.fiveYearLossValue, undefined);
});

test("handles malformed records without throwing and yields unknowns, not garbage", () => {
  const submission = one([malformedRecord]);
  assert.equal(submission.id, "submission-1"); // object id -> synthetic fallback
  assert.equal(submission.accountName, "Unknown account"); // array name -> unknown
  assert.equal(submission.tiv, undefined);
  assert.equal(submission.totalPremium, undefined);
  assert.equal(submission.buildingYear, undefined);
  assert.equal(submission.primaryRiskState, undefined);
  assert.equal(submission.fiveYearLossValue, undefined);
});

test("sums undated losses in full per the documented fallback rule", () => {
  const submission = one([undatedLossesRecord]);
  assert.equal(submission.fiveYearLossValue, 20_000);
});

test("falls back to count-weighted construction share when building values are absent", () => {
  const submission = one([countWeightedConstructionRecord]);
  // 3 of 4 buildings approved -> 75%.
  assert.equal(submission.approvedConstructionPercentage, 75);
  assert.equal(submission.constructionDescription, "Frame, Masonry, Steel");
});

test("retains out-of-appetite records instead of dropping them", () => {
  const raw = { data: [flatRecord, outOfAppetiteRecord] };
  const submissions = normalizeQueryResponse(raw);
  assert.equal(submissions.length, 2, "no record may be dropped for being out of appetite");
  const risky = submissions.find((submission) => submission.id === "sub-4");
  assert.ok(risky, "out-of-appetite record must survive normalization");
  assert.equal(risky.submissionType, "Renewal business");
  assert.equal(risky.tiv, 500_000_000);
  assert.equal(risky.fiveYearLossValue, 900_000);
});

test("unwraps a response envelope and normalizes every record", () => {
  const submissions = normalizeQueryResponse(responseEnvelope);
  assert.equal(submissions.length, 4);
});

test("never leaks raw API shapes downstream (only canonical keys are emitted)", () => {
  const submissions = normalizeQueryResponse([nestedRecord, flatRecord]);
  for (const submission of submissions) {
    assert.deepEqual(Object.keys(submission).sort(), [...CANONICAL_KEYS].sort());
    // Raw nested containers must not appear on the canonical object.
    for (const leaked of ["locations", "buildings", "lossHistory", "layers", "account"]) {
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
  const payload = buildQueryPayload(schemaWithSubmissions) as Record<string, unknown>;
  assert.equal(payload.resource, "submissions");
  assert.ok(payload.select, "a projection should be generated");
});

test("buildQueryPayload honors the FEDERATO_QUERY_PAYLOAD_JSON override seam", () => {
  process.env.FEDERATO_QUERY_PAYLOAD_JSON = JSON.stringify({ resource: "pinned" });
  try {
    const payload = buildQueryPayload(schemaWithSubmissions) as Record<string, unknown>;
    assert.equal(payload.resource, "pinned");
  } finally {
    delete process.env.FEDERATO_QUERY_PAYLOAD_JSON;
  }
});
