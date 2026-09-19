import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { quadrantOf, QUADRANT_CELLS } from "../lib/rankings/quadrant";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("in-appetite + complete submission is 'work-now'", () => {
  const q = quadrantOf(evaluateAppetite(fullTarget));
  assert.equal(q.appetite, "high");
  assert.equal(q.effort, "low");
  assert.equal(q.cell, "work-now");
});

test("all-missing, low-score submission is 'deprioritize'", () => {
  const q = quadrantOf(evaluateAppetite(empty));
  assert.equal(q.appetite, "low");
  assert.equal(q.effort, "high");
  assert.equal(q.cell, "deprioritize");
});

test("out-of-appetite is never high appetite, even with a strong score", () => {
  const ranked = evaluateAppetite(contradictory);
  assert.equal(ranked.status, "out_of_appetite");
  assert.ok(ranked.score >= 60, "contradictory fixture scores high despite the hard gate");
  assert.equal(quadrantOf(ranked).appetite, "low");
});

test("QUADRANT_CELLS lists the four cells", () => {
  assert.deepEqual(
    QUADRANT_CELLS.map((c) => c.cell).sort(),
    ["deprioritize", "selective", "work-now", "worth-effort"],
  );
});
