import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import { filterQueue, resolveSubmission } from "../lib/agent/query-tools";
import { allAcceptable, contradictory, fullTarget, multipleFailures } from "./fixtures/domain/submissions";

const ranked = rankSubmissions([fullTarget, allAcceptable, contradictory, multipleFailures]);

test("filterQueue matches structured criteria and counts by status", () => {
  const { matchedIds, counts } = filterQueue(ranked, { submissionType: "new", state: "CA" });
  assert.ok(matchedIds.includes("fx-target"));
  assert.ok(!matchedIds.includes("fx-contradictory"), "renewal excluded by submissionType=new");
  assert.equal(counts.total, matchedIds.length);
});

test("filterQueue applies numeric ranges", () => {
  const { matchedIds } = filterQueue(ranked, { premiumMax: 100000 });
  for (const id of matchedIds) {
    const s = ranked.find((r) => r.id === id)!;
    assert.ok(s.totalPremium === undefined || s.totalPremium <= 100000);
  }
});

test("resolveSubmission finds by id or fuzzy name", () => {
  assert.equal(resolveSubmission(ranked, "fx-target")?.id, "fx-target");
  assert.equal(resolveSubmission(ranked, "target account")?.id, "fx-target");
  assert.equal(resolveSubmission(ranked, "no such account"), undefined);
});
