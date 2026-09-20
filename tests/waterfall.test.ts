import assert from "node:assert/strict";
import test from "node:test";
import { runWaterfall, type Source } from "../lib/enrichment/waterfall";

const asOf = "2026-09-19";

test("stops at the first source clearing the confidence threshold", () => {
  const calls: string[] = [];
  const sources: Source<number>[] = [
    { name: "canonical", asOf, lookup: () => { calls.push("canonical"); return null; } },
    { name: "inference", asOf, lookup: () => { calls.push("inference"); return { value: 42, confidence: 0.8 }; } },
    { name: "external", asOf, lookup: () => { calls.push("external"); return { value: 99, confidence: 1 }; } },
  ];
  const result = runWaterfall(sources, 0.5);
  assert.deepEqual(calls, ["canonical", "inference"], "must not call sources after a confident hit");
  assert.equal(result?.value, 42);
  assert.equal(result?.provenance.source, "inference");
  assert.equal(result?.provenance.confidence, 0.8);
});

test("returns null when no source clears the threshold", () => {
  const sources: Source<number>[] = [
    { name: "canonical", asOf, lookup: () => null },
    { name: "inference", asOf, lookup: () => ({ value: 1, confidence: 0.2 }) },
  ];
  assert.equal(runWaterfall(sources, 0.5), null);
});
