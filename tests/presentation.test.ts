import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { primaryReason, statusLabels, summarize } from "../lib/rankings/presentation";

const cyber = evaluateAppetite({ id: "C1", accountName: "Cyber Co", lineOfBusiness: "Cyber", primaryRiskState: "TX" });
const property = evaluateAppetite({
  id: "P1",
  accountName: "Prop Co",
  lineOfBusiness: "Property",
  submissionType: "New business",
  primaryRiskState: "FL",
  tiv: 60_000_000,
  totalPremium: 80_000,
  buildingYear: 2015,
  approvedConstructionPercentage: 0.9,
  fiveYearLossValue: 0,
});

test("statusLabels has an out-of-scope label", () => {
  assert.equal(statusLabels.out_of_scope, "Out of scope");
});

test("summarize counts out_of_scope and does not fold it into out_of_appetite", () => {
  const summary = summarize([cyber, property]);
  assert.equal(summary.out_of_scope, 1);
  assert.equal(summary.out_of_appetite, 0);
  assert.equal(summary.total, 2);
});

test("primaryReason for out-of-scope names the line, not the factor fallback", () => {
  const reason = primaryReason(cyber);
  assert.match(reason, /Cyber/);
  assert.doesNotMatch(reason, /All eight factors/);
});
