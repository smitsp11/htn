import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { resolveSubmissionFields, type ChainRegistry } from "../lib/enrichment/resolve-submission";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("a complete submission has nothing to resolve", () => {
  const map = resolveSubmissionFields(evaluateAppetite(fullTarget));
  assert.equal(Object.keys(map).length, 0);
});

test("with no registered sources every absent field is an honest broker chase", () => {
  const ranked = evaluateAppetite(empty);
  const map = resolveSubmissionFields(ranked);
  const unresolvedKeys = ranked.factors.filter((f) => f.verdict === "unknown").map((f) => f.key);
  assert.deepEqual(Object.keys(map).sort(), [...unresolvedKeys].sort());
  assert.ok(Object.values(map).every((entry) => entry === null));
});

test("an ambiguous boundary value is not sent through the waterfall", () => {
  // Built exactly 1990 is unknown to the engine but the broker did supply it.
  const map = resolveSubmissionFields(evaluateAppetite({ ...fullTarget, id: "fx-1990", buildingYear: 1990 }));
  assert.equal(Object.keys(map).length, 0);
});

test("a registered chain fills an absent field with provenance", () => {
  const chains: ChainRegistry = {
    totalPremium: () => [{ name: "broker email", asOf: "2026-09-19", lookup: () => ({ value: 80_000, confidence: 0.9 }) }],
  };
  const ranked = evaluateAppetite({ ...fullTarget, id: "fx-nopremium", totalPremium: undefined });
  const map = resolveSubmissionFields(ranked, chains);
  assert.deepEqual(Object.keys(map), ["totalPremium"]);
  assert.equal(map.totalPremium?.value, 80_000);
  assert.equal(map.totalPremium?.provenance.source, "broker email");
  // Resolution is context only: the engine's verdict is untouched.
  assert.equal(ranked.factors.find((f) => f.key === "totalPremium")?.verdict, "unknown");
});

test("a low-confidence source does not clear the threshold", () => {
  const chains: ChainRegistry = {
    totalPremium: () => [{ name: "guess", asOf: "2026-09-19", lookup: () => ({ value: 1, confidence: 0.1 }) }],
  };
  const map = resolveSubmissionFields(evaluateAppetite({ ...fullTarget, id: "fx-lowconf", totalPremium: undefined }), chains);
  assert.equal(map.totalPremium, null);
});

test("consolidation cache beats the waterfall for the same absent field", () => {
  const ranked = evaluateAppetite({ ...fullTarget, id: "fx-consolidated", totalPremium: undefined });
  const chains: ChainRegistry = {
    totalPremium: () => [{ name: "inference", asOf: "2026-09-19", lookup: () => ({ value: 1, confidence: 0.99 }) }],
  };
  const consolidation = {
    "fx-consolidated": {
      totalPremium: {
        value: 92_000,
        provenance: { source: "broker email", confidence: 0.9, asOf: "2026-09-20" },
      },
    },
  };
  const map = resolveSubmissionFields(ranked, chains, 0.6, consolidation);
  assert.equal(map.totalPremium?.value, 92_000);
  assert.equal(map.totalPremium?.provenance.source, "broker email");
});
