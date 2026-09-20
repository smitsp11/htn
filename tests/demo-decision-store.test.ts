import assert from "node:assert/strict";
import test from "node:test";
import { validateDecision } from "../lib/demo/decision-store";

test("approve with author and non-negative premium is valid", () => {
  const r = validateDecision({ kind: "approve", author: "A. Underwriter", premium: 12000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("author is no longer required (the 'Decided by' field was removed)", () => {
  const r = validateDecision({ kind: "approve", author: "", premium: 100 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("decline requires rationale of at least 10 chars", () => {
  const short = validateDecision({ kind: "decline", author: "A", rationale: "too short" });
  assert.equal(short.ok, false);
  assert.match(short.errors.join(" "), /rationale/i);
  const ok = validateDecision({ kind: "decline", author: "A", rationale: "Outside appetite: coastal wind exposure." });
  assert.equal(ok.ok, true);
});

test("request_info requires rationale", () => {
  const r = validateDecision({ kind: "request_info", author: "A" });
  assert.equal(r.ok, false);
});

test("approve with negative premium fails", () => {
  const r = validateDecision({ kind: "approve", author: "A", premium: -5 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /premium/i);
});
