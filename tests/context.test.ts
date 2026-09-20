import assert from "node:assert/strict";
import test from "node:test";
import { contextForSubmission, loadContextIndex } from "../lib/enrichment/context";

test("loadContextIndex returns {} when the cache is absent", () => {
  const index = loadContextIndex("/nonexistent-dir");
  assert.deepEqual(index, {});
});

test("contextForSubmission returns the signals for a known key, else []", () => {
  const index = {
    "SUB-1": [
      {
        source: "Census ACS",
        label: "Median income",
        value: "$68,400",
        url: "https://data.census.gov/x",
        asOf: "2026-09-19",
      },
    ],
  };
  assert.equal(contextForSubmission(index, "SUB-1").length, 1);
  assert.deepEqual(contextForSubmission(index, "SUB-404"), []);
});
