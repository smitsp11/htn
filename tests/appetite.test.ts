import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite, rankSubmissions } from "../lib/domain/appetite";
import type { CanonicalSubmission } from "../lib/domain/types";

const targetSubmission: CanonicalSubmission = {
  id: "target",
  accountName: "Target Account",
  submissionType: "New business",
  lineOfBusiness: "Property",
  primaryRiskState: "CA",
  tiv: 75_000_000,
  totalPremium: 90_000,
  buildingYear: 2020,
  approvedConstructionPercentage: 0.75,
  fiveYearLossValue: 25_000,
};

test("fully target submission receives the maximum score", () => {
  const result = evaluateAppetite(targetSubmission);
  assert.equal(result.status, "in_appetite");
  assert.equal(result.score, 100);
});

test("an explicit unacceptable factor controls status", () => {
  const result = evaluateAppetite({ ...targetSubmission, submissionType: "Renewal business" });
  assert.equal(result.status, "out_of_appetite");
  assert.match(result.explanation, /submission type/i);
});

test("unclassified boundaries require investigation", () => {
  const result = evaluateAppetite({ ...targetSubmission, buildingYear: 1990 });
  assert.equal(result.status, "needs_investigation");
});

test("ranking orders appetite status before score", () => {
  const ranked = rankSubmissions([
    { ...targetSubmission, id: "renewal", submissionType: "Renewal business" },
    { ...targetSubmission, id: "acceptable", primaryRiskState: "UT" },
  ]);
  assert.equal(ranked[0].id, "acceptable");
  assert.equal(ranked[1].id, "renewal");
});
