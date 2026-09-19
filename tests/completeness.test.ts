import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { completenessOf } from "../lib/rankings/completeness";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("a fully-specified submission is in good order with zero effort", () => {
  const c = completenessOf(evaluateAppetite(fullTarget));
  assert.equal(c.total, 8);
  assert.equal(c.resolved, 8);
  assert.equal(c.missing.length, 0);
  assert.equal(c.inGoodOrder, true);
  assert.equal(c.effortToDecision, 0);
});

test("an empty submission is not in good order and lists its missing fields", () => {
  const c = completenessOf(evaluateAppetite(empty));
  assert.equal(c.inGoodOrder, false);
  assert.ok(c.missing.length > 0);
  assert.equal(c.resolved + c.missing.length, c.total);
  assert.equal(c.effortToDecision, c.missing.length);
  assert.ok(c.missingLabels.every((label) => !label.includes("_")));
});

test("a resolved-but-failing submission is still in good order", () => {
  // contradictory = fullTarget with a Renewal submission type: all fields present
  // (nothing to chase) but one factor fails. inGoodOrder is about data, not verdict.
  const c = completenessOf(evaluateAppetite(contradictory));
  assert.equal(c.inGoodOrder, true);
  assert.equal(c.missing.length, 0);
});

test("an unclassified boundary value is ambiguous, not absent", () => {
  // Built exactly 1990: the guidelines say nothing, so the verdict is unknown,
  // but the broker already supplied the value — it is an underwriter call.
  const c = completenessOf(evaluateAppetite({ ...fullTarget, id: "fx-1990", buildingYear: 1990 }));
  assert.deepEqual(c.missing, ["buildingYear"]);
  assert.deepEqual(c.ambiguous, ["buildingYear"]);
  assert.deepEqual(c.absent, []);
  assert.equal(c.inGoodOrder, false);
  assert.equal(c.effortToDecision, 1);
});

test("absent and ambiguous partition the missing fields", () => {
  const c = completenessOf(evaluateAppetite({ ...fullTarget, id: "fx-mix", buildingYear: 1990, totalPremium: undefined }));
  assert.deepEqual([...c.absent, ...c.ambiguous].sort(), [...c.missing].sort());
  assert.deepEqual(c.absent, ["totalPremium"]);
  assert.deepEqual(c.ambiguous, ["buildingYear"]);
  assert.deepEqual(c.absentLabels, ["Total premium"]);
});

test("an out-of-scope line has no evaluated fields", () => {
  const c = completenessOf(evaluateAppetite({ id: "fx-cyber", accountName: "Cyber Co", lineOfBusiness: "Cyber" }));
  assert.equal(c.total, 0);
  assert.equal(c.resolved, 0);
  assert.equal(c.missing.length, 0);
});
