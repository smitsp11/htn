import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import { portfolioSummary } from "../lib/rankings/portfolio";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("aggregates count, in-appetite TIV, and state concentration", () => {
  const subs = rankSubmissions([fullTarget, empty, contradictory]);
  const p = portfolioSummary(subs);
  assert.equal(p.total, 3);
  const expectedTiv = subs
    .filter((s) => s.status === "in_appetite" && typeof s.tiv === "number")
    .reduce((sum, s) => sum + (s.tiv ?? 0), 0);
  assert.equal(p.inAppetiteTiv, expectedTiv);
  const withState = subs.filter((s) => s.primaryRiskState).length;
  assert.equal(p.topStates.reduce((n, s) => n + s.count, 0), withState);
  if (p.topStates.length > 1) assert.ok(p.topStates[0].count >= p.topStates[1].count);
});

test("counts hazard exposure by composite rating (every submission buckets)", () => {
  const subs = rankSubmissions([fullTarget, empty, contradictory]);
  const p = portfolioSummary(subs);
  const totalRated = Object.values(p.hazardCounts).reduce((n, c) => n + c, 0);
  assert.equal(totalRated, subs.length);
});
