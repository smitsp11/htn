import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { buildResolution } from "../lib/enrichment/resolution-result";
import type { ConsolidationIndex } from "../lib/enrichment/resolve-submission";
import { missingLosses } from "./fixtures/domain/submissions";

test("resolving the one missing field flips needs_investigation → in_appetite", () => {
  const ranked = evaluateAppetite(missingLosses);
  assert.equal(ranked.status, "needs_investigation");
  const index: ConsolidationIndex = {
    [ranked.id]: { fiveYearLossValue: { value: 40000, provenance: { source: "broker email", confidence: 0.9, asOf: "2026-09-20" } } },
  };
  const r = buildResolution(ranked, index, false);
  assert.ok(r, "resolution present");
  assert.equal(r!.before.status, "needs_investigation");
  assert.equal(r!.after.status, "in_appetite");
  assert.equal(r!.fields.length, 1);
  assert.equal(r!.fields[0].key, "fiveYearLossValue");
  assert.match(r!.fields[0].display, /\$40/);
  assert.equal(r!.fields[0].source, "broker email");
});

test("returns null when nothing resolves", () => {
  const ranked = evaluateAppetite(missingLosses);
  assert.equal(buildResolution(ranked, {}, false), null);
});
