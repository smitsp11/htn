import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { isTriageCandidate, quadrantOf, QUADRANT_CELLS } from "../lib/rankings/quadrant";
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

test("an out-of-scope line is not a triage candidate and never reads as work-now", () => {
  const cyber = evaluateAppetite({ id: "fx-cyber", accountName: "Cyber Co", lineOfBusiness: "Cyber" });
  assert.equal(isTriageCandidate(cyber), false);
  assert.equal(quadrantOf(cyber).cell, "deprioritize");
});

test("one unresolved field on a strong risk is still low effort / high appetite", () => {
  const q = quadrantOf(evaluateAppetite({ ...fullTarget, id: "fx-one-gap", fiveYearLossValue: undefined }));
  assert.equal(q.cell, "work-now");
});
