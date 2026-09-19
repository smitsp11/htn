import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { resolveSubmissionFields } from "../lib/enrichment/resolve-submission";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("a complete submission has nothing to resolve", () => {
  const map = resolveSubmissionFields(evaluateAppetite(fullTarget));
  assert.equal(Object.keys(map).length, 0);
});

test("an incomplete submission yields an entry per unresolved field", () => {
  const ranked = evaluateAppetite(empty);
  const map = resolveSubmissionFields(ranked);
  const unresolvedKeys = ranked.factors.filter((f) => f.verdict === "unknown").map((f) => f.key);
  for (const key of unresolvedKeys) {
    assert.ok(key in map, `missing resolution entry for ${key}`);
    const entry = map[key];
    if (entry) {
      assert.equal(typeof entry.provenance.source, "string");
      assert.ok(entry.provenance.confidence >= 0 && entry.provenance.confidence <= 1);
    }
  }
});
