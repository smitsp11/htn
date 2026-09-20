import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { whatWouldFlip } from "../lib/domain/counterfactual";
import { contradictory, empty, fullTarget, multipleFailures } from "./fixtures/domain/submissions";

test("an in-appetite submission has nothing to flip", () => {
  assert.equal(whatWouldFlip(evaluateAppetite(fullTarget)), null);
});

test("a needs-investigation submission flips by resolving its unknowns", () => {
  const ranked = evaluateAppetite(empty);
  const flip = whatWouldFlip(ranked);
  assert.ok(flip);
  assert.equal(flip.targetStatus, "in_appetite");
  const unknowns = ranked.factors.filter((f) => f.verdict === "unknown").map((f) => f.key);
  assert.deepEqual(flip.changes.map((c) => c.key).sort(), unknowns.sort());
  assert.ok(flip.changes.every((c) => c.from === "unknown"));
});

test("an out-of-appetite submission with everything else resolved flips straight to in appetite", () => {
  const ranked = evaluateAppetite(contradictory);
  const flip = whatWouldFlip(ranked);
  assert.ok(flip);
  assert.equal(flip.targetStatus, "in_appetite");
  const blockers = ranked.factors.filter((f) => f.verdict === "not_acceptable").map((f) => f.key);
  assert.deepEqual(flip.changes.map((c) => c.key).sort(), blockers.sort());
  assert.ok(flip.changes.every((c) => c.from === "not_acceptable"));
});

test("an out-of-appetite submission with unknowns only reaches needs investigation", () => {
  const ranked = evaluateAppetite(multipleFailures);
  const flip = whatWouldFlip(ranked);
  assert.ok(flip);
  assert.equal(flip.targetStatus, "needs_investigation");
  // Only the hard gates are listed; the unknown is the next tier's work.
  assert.ok(flip.changes.every((c) => c.from === "not_acceptable"));
  assert.ok(!flip.changes.some((c) => c.key === "buildingYear"));
});

test("an out-of-scope line is never reported as already in appetite", () => {
  const flip = whatWouldFlip(evaluateAppetite({ id: "fx-cyber", accountName: "Cyber Co", lineOfBusiness: "Cyber" }));
  assert.ok(flip);
  assert.equal(flip.targetStatus, "out_of_scope");
  assert.deepEqual(flip.changes, []);
  assert.match(flip.note ?? "", /Cyber/);
});
