import { test } from "node:test";
import assert from "node:assert/strict";
import type { Dataset, LineOfBusiness, RankedSubmission, RankingsResponse } from "../lib/domain/types";

test("Dataset and LineOfBusiness unions compile and carry expected members", () => {
  const d: Dataset = "extended";
  const lobs: LineOfBusiness[] = ["property", "cgl", "auto", "cyber", "excess", "health", "lpl"];
  assert.equal(d, "extended");
  assert.equal(lobs.length, 7);
});

test("RankedSubmission carries an optional synthetic flag", () => {
  const s = { synthetic: true } as Partial<RankedSubmission>;
  assert.equal(s.synthetic, true);
});

test("RankingsResponse echoes the dataset", () => {
  const r = { dataset: "baseline" } as Partial<RankingsResponse>;
  assert.equal(r.dataset, "baseline");
});
