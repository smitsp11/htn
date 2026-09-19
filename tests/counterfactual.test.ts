import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { whatWouldFlip } from "../lib/domain/counterfactual";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

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

test("an out-of-appetite submission flips by fixing its not-acceptable factors", () => {
  const ranked = evaluateAppetite(contradictory);
  const flip = whatWouldFlip(ranked);
  assert.ok(flip);
  assert.equal(flip.targetStatus, "needs_investigation");
  const blockers = ranked.factors.filter((f) => f.verdict === "not_acceptable").map((f) => f.key);
  assert.deepEqual(flip.changes.map((c) => c.key).sort(), blockers.sort());
  assert.ok(flip.changes.every((c) => c.from === "not_acceptable"));
});
