import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { flagTone, flagSummary, reasonsByTone } from "../lib/rankings/flags";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("flagTone maps each verdict to its display tone", () => {
  assert.equal(flagTone("not_acceptable"), "red");
  assert.equal(flagTone("unknown"), "yellow");
  assert.equal(flagTone("target"), "preferred");
  assert.equal(flagTone("acceptable"), "preferred");
});

test("flagSummary tallies the eight factors into three tones", () => {
  const s = flagSummary(evaluateAppetite(fullTarget));
  assert.equal(s.red + s.yellow + s.preferred, 8);
  assert.equal(s.red, 0);
  assert.equal(s.yellow, 0);
  assert.equal(s.preferred, 8);
});

test("a submission with missing data reports yellow flags", () => {
  const s = flagSummary(evaluateAppetite(empty));
  assert.ok(s.yellow > 0, "empty submission should have unknown/yellow flags");
});

test("reasonsByTone groups the factor reasons under each tone", () => {
  const grouped = reasonsByTone(evaluateAppetite(contradictory));
  assert.ok(Array.isArray(grouped.red));
  assert.ok(grouped.red.length >= 1, "contradictory fixture has a failing factor");
  assert.equal(typeof grouped.red[0], "string");
});
