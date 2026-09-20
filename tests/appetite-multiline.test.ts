import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAppetite, pricingBandsFor } from "../lib/domain/appetite";
import { tableFor } from "../lib/domain/appetite/registry";
import type { CanonicalSubmission } from "../lib/domain/types";
import { fullTarget } from "./fixtures/domain/submissions";

const base: CanonicalSubmission = { id: "x", accountName: "Acme", submissionType: "new" };
function verdict(line: string, patch: Partial<CanonicalSubmission>, key: string) {
  const f = tableFor(line)!.evaluate({ ...base, lineOfBusiness: line, ...patch });
  return f.find((x) => x.key === key)?.verdict;
}

test("cgl premium bands", () => {
  assert.equal(verdict("cgl", { primaryRiskState: "CA", totalPremium: 60000 }, "totalPremium"), "target");
  assert.equal(verdict("cgl", { primaryRiskState: "CA", totalPremium: 300000 }, "totalPremium"), "not_acceptable");
});
test("auto is loss-tolerant to 250k", () => {
  assert.equal(verdict("auto", { fiveYearLossValue: 200000 }, "fiveYearLossValue"), "acceptable");
});
test("cyber accepts any state", () => {
  assert.equal(verdict("cyber", { primaryRiskState: "WA" }, "primaryRiskState"), "target");
});
test("health rejects renewals", () => {
  assert.equal(verdict("health", { submissionType: "renewal" }, "submissionType"), "not_acceptable");
});
test("excess low-premium band", () => {
  assert.equal(verdict("excess", { totalPremium: 27600 }, "totalPremium"), "target");
});
test("lpl target states", () => {
  assert.equal(verdict("lpl", { primaryRiskState: "NY" }, "primaryRiskState"), "target");
});
test("missing value is unknown for every line", () => {
  for (const line of ["cgl", "auto", "cyber", "excess", "health", "lpl"]) {
    assert.equal(verdict(line, {}, "totalPremium"), "unknown");
  }
});

test("each line normalizes its score against only its applicable factors", () => {
  const cgl = evaluateAppetite({
    ...base,
    lineOfBusiness: "cgl",
    primaryRiskState: "CA",
    totalPremium: 60_000,
    tiv: 1_000_000,
    fiveYearLossValue: 0,
  }, true);
  const health = evaluateAppetite({
    ...base,
    lineOfBusiness: "health",
    primaryRiskState: "CA",
    totalPremium: 150_000,
    fiveYearLossValue: 0,
  }, true);
  assert.equal(cgl.score, 100);
  assert.equal(health.score, 100);
});

test("line-aware scoring does not change property scoring", () => {
  assert.deepEqual(evaluateAppetite(fullTarget, true), evaluateAppetite(fullTarget));
});

test("pricing uses each line's own guideline bands without changing property", () => {
  const acceptableBand = (lineOfBusiness: string) =>
    pricingBandsFor({ ...base, lineOfBusiness }).find((band) => band.label === "Acceptable band")?.value;

  assert.equal(acceptableBand("property"), "$50K – $175K");
  assert.equal(acceptableBand("cgl"), "$25K – $250K");
  assert.equal(acceptableBand("auto"), "$30K – $300K");
  assert.equal(acceptableBand("cyber"), "$20K – $200K");
  assert.equal(acceptableBand("excess"), "$10K – $150K");
  assert.equal(acceptableBand("health"), "$50K – $500K");
  assert.equal(acceptableBand("lpl"), "$15K – $180K");
});
