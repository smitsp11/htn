import assert from "node:assert/strict";
import test from "node:test";
import { ALL_SOURCES, emailSource, portalSource, sovSource } from "../lib/consolidation/channel-source";
import { consolidateSubmission } from "../lib/consolidation/consolidate";
import { SCENARIO } from "../lib/consolidation/scenario";

test("scenario hides at least one field per seeded submission in a channel", () => {
  assert.ok(SCENARIO.length > 0);
  for (const entry of SCENARIO) {
    assert.equal(typeof entry.submissionId, "string");
    assert.ok(entry.channels.length >= 1);
  }
});

test("a channel source returns a value + confidence for a field it holds, else null", () => {
  const entry = SCENARIO[0];
  const held = entry.channels[0];
  const sources = { email: emailSource, sov: sovSource, portal: portalSource };
  const source = sources[held.channel];
  const hit = source.lookup(entry.submissionId, held.field);
  assert.ok(hit, "the holding channel should return a value");
  assert.ok(hit!.confidence > 0 && hit!.confidence <= 1);
  assert.equal(source.lookup("does-not-exist", held.field), null);
});

test("consolidate resolves a held field with channel provenance", () => {
  const entry = SCENARIO[0];
  const held = entry.channels[0];
  const map = consolidateSubmission(entry.submissionId, [held.field], ALL_SOURCES, "2026-09-20");
  const resolved = map[held.field];
  assert.ok(resolved, "held field should resolve");
  assert.equal(resolved!.provenance.source, `broker ${held.channel}`);
  assert.equal(resolved!.value, held.value);
});

test("consolidate leaves a truly-absent field unresolved", () => {
  const map = consolidateSubmission(SCENARIO[0].submissionId, ["primaryRiskState"], ALL_SOURCES);
  assert.equal(map.primaryRiskState, undefined);
});
