import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyScope,
  computeScore,
  deriveStatus,
  evaluateAppetite,
  evaluateFactors,
  rankSubmissions,
} from "../lib/domain/appetite";
import { recommendationFor } from "../lib/domain/explanation";
import type { AppetiteVerdict, CanonicalSubmission, FactorKey } from "../lib/domain/types";
import {
  allAcceptable,
  contradictory,
  empty,
  fullTarget,
  missingLosses,
  multipleFailures,
} from "./fixtures/domain/submissions";

function verdictFor(key: FactorKey, patch: Partial<CanonicalSubmission>) {
  const factor = evaluateFactors({ ...fullTarget, ...patch }).find((item) => item.key === key);
  assert.ok(factor, `factor ${key} missing`);
  return factor;
}

interface Case<T> {
  name: string;
  value: T | undefined;
  verdict: AppetiteVerdict;
  reason?: RegExp;
}

function runTable<T>(key: FactorKey, field: keyof CanonicalSubmission, cases: Case<T>[]) {
  for (const item of cases) {
    test(`${key}: ${item.name} -> ${item.verdict}`, () => {
      const factor = verdictFor(key, { [field]: item.value });
      assert.equal(factor.verdict, item.verdict, factor.reason);
      if (item.reason) assert.match(factor.reason, item.reason);
    });
  }
}

runTable<string>("submissionType", "submissionType", [
  { name: "new business", value: "New business", verdict: "acceptable" },
  { name: "lowercase new", value: "new", verdict: "acceptable" },
  { name: "renewal", value: "Renewal business", verdict: "not_acceptable", reason: /renewal/i },
  { name: "missing", value: undefined, verdict: "unknown", reason: /missing/i },
  { name: "blank", value: "   ", verdict: "unknown" },
  { name: "unrecognised", value: "Endorsement", verdict: "unknown", reason: /Endorsement/ },
]);

runTable<string>("lineOfBusiness", "lineOfBusiness", [
  { name: "property", value: "Property", verdict: "acceptable" },
  { name: "commercial property", value: "Commercial Property", verdict: "acceptable" },
  { name: "other line", value: "General Liability", verdict: "not_acceptable", reason: /General Liability/ },
  { name: "missing", value: undefined, verdict: "unknown", reason: /missing/i },
]);

runTable<string>("primaryRiskState", "primaryRiskState", [
  ...["OH", "PA", "MD", "CO", "CA", "FL"].map((state) => ({ name: `target ${state}`, value: state, verdict: "target" as const })),
  ...["NC", "SC", "GA", "VA", "UT"].map((state) => ({ name: `acceptable ${state}`, value: state, verdict: "acceptable" as const })),
  { name: "lowercase target", value: "ca", verdict: "target" },
  { name: "outside list", value: "TX", verdict: "not_acceptable", reason: /TX/ },
  { name: "missing", value: undefined, verdict: "unknown", reason: /missing/i },
]);

runTable<number>("tiv", "tiv", [
  { name: "below target band", value: 10_000_000, verdict: "acceptable" },
  { name: "just under $50M", value: 49_999_999, verdict: "acceptable" },
  { name: "exactly $50M", value: 50_000_000, verdict: "target" },
  { name: "exactly $100M", value: 100_000_000, verdict: "target" },
  { name: "just over $100M", value: 100_000_001, verdict: "acceptable" },
  { name: "exactly $150M", value: 150_000_000, verdict: "acceptable" },
  { name: "over $150M", value: 160_000_000, verdict: "not_acceptable", reason: /\$160M/ },
  { name: "zero", value: 0, verdict: "unknown" },
  { name: "negative", value: -1, verdict: "unknown" },
  { name: "NaN", value: Number.NaN, verdict: "unknown" },
  { name: "missing", value: undefined, verdict: "unknown", reason: /missing/i },
]);

runTable<number>("totalPremium", "totalPremium", [
  { name: "under $50K", value: 40_000, verdict: "not_acceptable", reason: /\$40K/ },
  { name: "exactly $50K", value: 50_000, verdict: "acceptable" },
  { name: "just under $75K", value: 74_999, verdict: "acceptable" },
  { name: "exactly $75K", value: 75_000, verdict: "target" },
  { name: "exactly $100K", value: 100_000, verdict: "target" },
  { name: "just over $100K", value: 100_001, verdict: "acceptable" },
  { name: "exactly $175K", value: 175_000, verdict: "acceptable" },
  { name: "over $175K", value: 175_001, verdict: "not_acceptable" },
  { name: "zero", value: 0, verdict: "unknown" },
  { name: "missing", value: undefined, verdict: "unknown", reason: /missing/i },
]);

runTable<number>("buildingYear", "buildingYear", [
  { name: "old", value: 1975, verdict: "not_acceptable", reason: /1975/ },
  { name: "exactly 1990 (unclassified)", value: 1990, verdict: "unknown", reason: /1990/ },
  { name: "1991", value: 1991, verdict: "acceptable" },
  { name: "exactly 2010", value: 2010, verdict: "acceptable" },
  { name: "2011", value: 2011, verdict: "target" },
  { name: "fractional year", value: 2011.5, verdict: "unknown" },
  { name: "missing", value: undefined, verdict: "unknown", reason: /missing/i },
]);

runTable<number>("construction", "approvedConstructionPercentage", [
  { name: "ratio above half", value: 0.51, verdict: "acceptable" },
  { name: "ratio below half", value: 0.49, verdict: "not_acceptable" },
  { name: "exact 50/50 ratio", value: 0.5, verdict: "unknown", reason: /50/ },
  { name: "percent above half", value: 80, verdict: "acceptable" },
  { name: "percent below half", value: 20, verdict: "not_acceptable" },
  { name: "exact 50 percent", value: 50, verdict: "unknown" },
  { name: "ratio of exactly 1 is 100%", value: 1, verdict: "acceptable" },
  { name: "over 100 percent", value: 150, verdict: "unknown" },
  { name: "negative", value: -0.2, verdict: "unknown" },
  { name: "missing", value: undefined, verdict: "unknown", reason: /missing/i },
]);

runTable<number>("fiveYearLossValue", "fiveYearLossValue", [
  { name: "no losses", value: 0, verdict: "acceptable" },
  { name: "under $100K", value: 99_999, verdict: "acceptable" },
  { name: "exactly $100K (unclassified)", value: 100_000, verdict: "unknown", reason: /\$100K/ },
  { name: "over $100K", value: 125_500, verdict: "not_acceptable", reason: /\$125\.5K/ },
  { name: "negative", value: -5, verdict: "unknown" },
  { name: "missing", value: undefined, verdict: "unknown", reason: /missing/i },
]);

test("evaluateFactors always returns the eight factors in table order", () => {
  const keys = evaluateFactors(empty).map((item) => item.key);
  assert.deepEqual(keys, [
    "submissionType",
    "lineOfBusiness",
    "primaryRiskState",
    "tiv",
    "totalPremium",
    "buildingYear",
    "construction",
    "fiveYearLossValue",
  ]);
});

test("score: target counts 2, acceptable counts 1, out of a maximum of 12", () => {
  assert.equal(computeScore(evaluateFactors(fullTarget)), 100);
  assert.equal(computeScore(evaluateFactors(allAcceptable)), Math.round((8 / 12) * 100));
  assert.equal(computeScore(evaluateFactors(empty)), 0);
});

test("score: unknown and not acceptable both contribute zero", () => {
  const withUnknown = computeScore(evaluateFactors({ ...fullTarget, fiveYearLossValue: undefined }));
  const withFailure = computeScore(evaluateFactors({ ...fullTarget, fiveYearLossValue: 500_000 }));
  assert.equal(withUnknown, withFailure);
  assert.equal(withUnknown, Math.round((11 / 12) * 100));
});

test("status: any not acceptable factor is a hard gate even when unknowns exist", () => {
  assert.equal(deriveStatus(evaluateFactors(multipleFailures)), "out_of_appetite");
});

test("status: unknowns without failures need investigation", () => {
  assert.equal(deriveStatus(evaluateFactors(missingLosses)), "needs_investigation");
  assert.equal(deriveStatus(evaluateFactors(empty)), "needs_investigation");
});

test("status: all acceptable is in appetite even with no targets", () => {
  assert.equal(deriveStatus(evaluateFactors(allAcceptable)), "in_appetite");
});

test("recommendation vocabulary never implies an automatic decision", () => {
  assert.equal(recommendationFor("in_appetite"), "Review for acceptance");
  assert.equal(recommendationFor("needs_investigation"), "Investigate data");
  assert.equal(recommendationFor("out_of_appetite"), "Review for likely decline");
  for (const status of ["in_appetite", "needs_investigation", "out_of_appetite"] as const) {
    assert.doesNotMatch(recommendationFor(status), /\b(bind|bound|accepted|rejected|declined)\b/i);
  }
});

test("explanation: fully target submission names the target matches", () => {
  const result = evaluateAppetite(fullTarget);
  assert.equal(
    result.explanation,
    "Target Account scores 100/100 and is in appetite. Target matches on primary risk state, total insured value, total premium, building year; the remaining factors are acceptable. Recommendation: Review for acceptance.",
  );
});

test("explanation: all acceptable submission says so without listing targets", () => {
  const result = evaluateAppetite(allAcceptable);
  assert.match(result.explanation, /All eight factors are acceptable with no target matches\./);
  assert.match(result.explanation, /Recommendation: Review for acceptance\.$/);
});

test("explanation: contradiction is named and targets do not offset the failure", () => {
  const result = evaluateAppetite(contradictory);
  assert.equal(result.status, "out_of_appetite");
  assert.equal(
    result.explanation,
    "Contradictory Account scores 92/100 but is out of appetite. Not acceptable: submission type (renewal business is not acceptable); this contradicts target matches on primary risk state, total insured value, total premium, building year, which do not offset it. Recommendation: Review for likely decline.",
  );
});

test("explanation: multiple failures and an unknown are all listed", () => {
  const result = evaluateAppetite(multipleFailures);
  assert.match(
    result.explanation,
    /Not acceptable: primary risk state \(TX is outside the listed states\), total insured value \(TIV \$200M exceeds the \$150M limit by \$50M\), five-year losses \(five-year losses of \$250K exceed the \$100K limit by \$150K\)/,
  );
  assert.match(result.explanation, /unresolved: building year/);
  assert.match(result.explanation, /Recommendation: Review for likely decline\.$/);
});

test("explanation: unknown factors are listed as unresolved", () => {
  const result = evaluateAppetite(missingLosses);
  assert.equal(
    result.explanation,
    "Missing Losses Account scores 92/100 and needs investigation. Unresolved: five-year losses; target matches on primary risk state, total insured value, total premium, building year. Recommendation: Investigate data.",
  );
});

test("explanation: empty submission is honest about having nothing to evaluate", () => {
  const result = evaluateAppetite(empty);
  assert.equal(result.score, 0);
  assert.match(result.explanation, /Unresolved: submission type, line of business, primary risk state, total insured value, total premium, building year, construction type, five-year losses\./);
});

test("evaluateAppetite is deterministic for the same input", () => {
  assert.deepEqual(evaluateAppetite(contradictory), evaluateAppetite({ ...contradictory }));
});

test("ranking: status precedes score, then score descending", () => {
  const ranked = rankSubmissions([contradictory, missingLosses, allAcceptable, fullTarget, multipleFailures]);
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["fx-target", "fx-acceptable", "fx-missing", "fx-contradictory", "fx-multi"],
  );
});

test("ranking: a high score never outranks a better status", () => {
  const ranked = rankSubmissions([contradictory, allAcceptable]);
  assert.ok(ranked[0].score < ranked[1].score, "contradictory fixture should have the higher score");
  assert.equal(ranked[0].id, "fx-acceptable");
});

test("ranking: ties break on account name, then id, regardless of input order", () => {
  const a = { ...fullTarget, id: "b-id", accountName: "Same Name" };
  const b = { ...fullTarget, id: "a-id", accountName: "Same Name" };
  const c = { ...fullTarget, id: "c-id", accountName: "Alpha Name" };
  assert.deepEqual(rankSubmissions([a, b, c]).map((item) => item.id), ["c-id", "a-id", "b-id"]);
  assert.deepEqual(rankSubmissions([c, b, a]).map((item) => item.id), ["c-id", "a-id", "b-id"]);
});

test("ranking: does not mutate or drop input", () => {
  const input = [contradictory, fullTarget];
  const ranked = rankSubmissions(input);
  assert.equal(ranked.length, 2);
  assert.equal(input[0].id, "fx-contradictory");
});

test("classifyScope: property, non-property, and missing lines", () => {
  assert.equal(classifyScope("Commercial Property"), "property");
  assert.equal(classifyScope("property"), "property");
  assert.equal(classifyScope("Cyber"), "out_of_scope");
  assert.equal(classifyScope("General Liability"), "out_of_scope");
  assert.equal(classifyScope(undefined), "unknown_line");
  assert.equal(classifyScope("   "), "unknown_line");
});

test("out of scope: a non-property line short-circuits before the property factors", () => {
  const ranked = evaluateAppetite({ ...fullTarget, lineOfBusiness: "Cyber" });
  assert.equal(ranked.status, "out_of_scope");
  assert.equal(ranked.factors.length, 0);
  assert.equal(ranked.score, 0);
  assert.match(ranked.recommendation, /out of scope/i);
  assert.match(ranked.explanation, /commercial property only/i);
  assert.match(ranked.explanation, /Cyber/);
});

test("out of scope: a property line is evaluated on all eight factors", () => {
  const ranked = evaluateAppetite({ ...fullTarget, lineOfBusiness: "Property" });
  assert.notEqual(ranked.status, "out_of_scope");
  assert.equal(ranked.factors.length, 8);
});

test("out of scope: a missing line stays in the property pipeline as needs_investigation", () => {
  const ranked = evaluateAppetite({ ...fullTarget, lineOfBusiness: undefined });
  assert.equal(ranked.status, "needs_investigation");
  assert.equal(ranked.factors.length, 8);
});
