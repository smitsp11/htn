import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import { portfolioSummary } from "../lib/rankings/portfolio";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("aggregates count, TIV, in-appetite TIV, and state concentration", () => {
  const subs = rankSubmissions([fullTarget, empty, contradictory]);
  const p = portfolioSummary(subs);
  assert.equal(p.total, 3);
  assert.equal(p.inScope, 3);
  assert.equal(p.outOfScope, 0);
  const sumTiv = (list: typeof subs) => list.reduce((sum, s) => sum + (typeof s.tiv === "number" ? s.tiv : 0), 0);
  assert.equal(p.totalTiv, sumTiv(subs));
  assert.equal(p.inAppetiteTiv, sumTiv(subs.filter((s) => s.status === "in_appetite")));
  assert.equal(p.tivUnknown, 1); // the empty fixture
  const withState = subs.filter((s) => s.primaryRiskState).length;
  assert.equal(p.topStates.reduce((n, s) => n + s.count, 0), withState);
  assert.deepEqual(p.topStates, [{ state: "CA", count: 2 }]);
});

test("counts hazard exposure by composite rating (every in-scope submission buckets)", () => {
  const subs = rankSubmissions([fullTarget, empty, contradictory]).map((s, i) =>
    i === 0 ? { ...s, enrichment: { compositeRating: "very high" as const, topHazards: [], source: "FEMA NRI" as const, asOf: "2026-09-19" } } : s,
  );
  const p = portfolioSummary(subs);
  const totalRated = Object.values(p.hazardCounts).reduce((n, c) => n + c, 0);
  assert.equal(totalRated, subs.length);
  assert.equal(p.highHazard, 1);
});

test("out-of-scope lines count toward the total but not the property figures", () => {
  const subs = rankSubmissions([fullTarget, { id: "C1", accountName: "Cyber Co", lineOfBusiness: "Cyber", primaryRiskState: "TX", tiv: 500_000_000 }]);
  const p = portfolioSummary(subs);
  assert.equal(p.total, 2);
  assert.equal(p.outOfScope, 1);
  assert.equal(p.totalTiv, fullTarget.tiv);
  assert.ok(!p.topStates.some((s) => s.state === "TX"));
  assert.equal(Object.values(p.hazardCounts).reduce((n, c) => n + c, 0), 1);
});

test("state ties break alphabetically and codes are normalised", () => {
  const subs = rankSubmissions([
    { ...fullTarget, id: "a", primaryRiskState: "fl" },
    { ...fullTarget, id: "b", primaryRiskState: "CA" },
  ]);
  assert.deepEqual(portfolioSummary(subs).topStates, [{ state: "CA", count: 1 }, { state: "FL", count: 1 }]);
});
