import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { flipAnalysisFor } from "../lib/domain/flip";
import { contradictory, empty, fullTarget, multipleFailures } from "./fixtures/domain/submissions";

test("a fully in-appetite submission has nothing to flip", () => {
  const result = evaluateAppetite(fullTarget);
  assert.deepEqual(flipAnalysisFor(result), []);
});

test("a single hard-gate failure is reported as immovable", () => {
  const result = evaluateAppetite(contradictory);
  const flips = flipAnalysisFor(result);
  assert.equal(flips.length, 1);
  assert.equal(flips[0].key, "submissionType");
  assert.equal(flips[0].movable, false);
  assert.match(flips[0].action, /can't become/);
});

test("fixed-fact failures (state, TIV) are immovable; time-based and missing-data gaps are actionable", () => {
  const result = evaluateAppetite(multipleFailures);
  const flips = flipAnalysisFor(result);
  const byKey = new Map(flips.map((flip) => [flip.key, flip]));

  assert.equal(byKey.get("primaryRiskState")?.movable, false);
  assert.match(byKey.get("primaryRiskState")!.action, /TX/);

  assert.equal(byKey.get("tiv")?.movable, false);
  assert.match(byKey.get("tiv")!.action, /\$50M over/);

  assert.equal(byKey.get("fiveYearLossValue")?.movable, true);
  assert.match(byKey.get("fiveYearLossValue")!.action, /\$150K over/);

  assert.equal(byKey.get("buildingYear")?.movable, true, "missing data is always actionable");
  assert.match(byKey.get("buildingYear")!.action, /Confirm the year built/);
});

test("missing evidence is always actionable regardless of factor", () => {
  const result = evaluateAppetite(empty);
  const flips = flipAnalysisFor(result);
  assert.ok(flips.length > 0);
  assert.ok(flips.every((flip) => flip.movable === true));
});
