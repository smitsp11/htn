import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaseSummary } from "../components/case/case-summary";
import { ReviewTab } from "../components/case/review-tab";
import { QueueTable } from "../components/queue/queue-table";
import { DistanceChips } from "../components/ui/distance-chips";
import {
  buildingYearSensitivity,
  evaluateAppetite,
  evaluateFactors,
  failureCount,
  rankSubmissions,
} from "../lib/domain/appetite";
import type { CanonicalSubmission, FactorKey } from "../lib/domain/types";
import { distanceLabel, failingFactors, isOneFixAway, nearMissFactors } from "../lib/rankings/flags";
import { contradictory, fullTarget, multipleFailures } from "./fixtures/domain/submissions";

function factorFor(key: FactorKey, patch: Partial<CanonicalSubmission>) {
  const factor = evaluateFactors({ ...fullTarget, ...patch }).find((item) => item.key === key);
  assert.ok(factor, `factor ${key} missing`);
  return factor;
}

/* ---------------------------------------------------------------------- */
/* Near-miss deltas: every out-of-range numeric reason states the distance. */
/* ---------------------------------------------------------------------- */

interface DeltaCase {
  name: string;
  key: FactorKey;
  patch: Partial<CanonicalSubmission>;
  reason: RegExp;
  nearMiss: boolean;
}

const deltaCases: DeltaCase[] = [
  { name: "premium $1K over the cap", key: "totalPremium", patch: { totalPremium: 176_000 }, reason: /\$176K is \$1K above the \$175K maximum/, nearMiss: true },
  { name: "premium far over the cap", key: "totalPremium", patch: { totalPremium: 500_000 }, reason: /\$500K is \$325K above the \$175K maximum/, nearMiss: false },
  { name: "premium just under the floor", key: "totalPremium", patch: { totalPremium: 48_000 }, reason: /\$48K is \$2K below the \$50K minimum/, nearMiss: true },
  { name: "premium far under the floor", key: "totalPremium", patch: { totalPremium: 10_000 }, reason: /\$10K is \$40K below the \$50K minimum/, nearMiss: false },
  { name: "TIV just over the limit", key: "tiv", patch: { tiv: 155_000_000 }, reason: /\$155M exceeds the \$150M limit by \$5M/, nearMiss: true },
  { name: "TIV far over the limit", key: "tiv", patch: { tiv: 200_000_000 }, reason: /exceeds the \$150M limit by \$50M/, nearMiss: false },
  { name: "built two years before the cutoff", key: "buildingYear", patch: { buildingYear: 1988 }, reason: /Built in 1988, 2 years before the 1990 cutoff/, nearMiss: true },
  { name: "built one year before the cutoff", key: "buildingYear", patch: { buildingYear: 1989 }, reason: /Built in 1989, 1 year before the 1990 cutoff/, nearMiss: true },
  { name: "built long before the cutoff", key: "buildingYear", patch: { buildingYear: 1972 }, reason: /Built in 1972, 18 years before the 1990 cutoff/, nearMiss: false },
  { name: "construction just short", key: "construction", patch: { approvedConstructionPercentage: 0.46 }, reason: /Only 46% .* 4 points short/, nearMiss: true },
  { name: "construction far short", key: "construction", patch: { approvedConstructionPercentage: 0.2 }, reason: /Only 20% .* 30 points short/, nearMiss: false },
  { name: "losses just over", key: "fiveYearLossValue", patch: { fiveYearLossValue: 104_000 }, reason: /\$104K exceed the \$100K limit by \$4K/, nearMiss: true },
  { name: "losses far over", key: "fiveYearLossValue", patch: { fiveYearLossValue: 250_000 }, reason: /exceed the \$100K limit by \$150K/, nearMiss: false },
];

for (const item of deltaCases) {
  test(`near miss: ${item.name}`, () => {
    const factor = factorFor(item.key, item.patch);
    assert.equal(factor.verdict, "not_acceptable");
    assert.match(factor.reason, item.reason);
    assert.equal(factor.nearMiss === true, item.nearMiss, `nearMiss flag for ${item.name}`);
  });
}

test("near miss: exact boundaries stay at the edge of the band, never flagged on the acceptable side", () => {
  assert.equal(factorFor("totalPremium", { totalPremium: 175_000 }).nearMiss, undefined);
  assert.equal(factorFor("totalPremium", { totalPremium: 183_750 }).nearMiss, true, "5% over is inside the band");
  assert.equal(factorFor("totalPremium", { totalPremium: 183_751 }).nearMiss, undefined, "just past 5% is outside");
  assert.equal(factorFor("buildingYear", { buildingYear: 1987 }).nearMiss, undefined, "three years out is not a near miss");
});

test("near miss: acceptable, target, and unknown verdicts never carry the flag or a delta", () => {
  for (const factor of evaluateFactors(fullTarget)) {
    assert.equal(factor.nearMiss, undefined, factor.key);
    assert.doesNotMatch(factor.reason, /\bby \$|before the|short of/);
  }
  assert.equal(factorFor("fiveYearLossValue", { fiveYearLossValue: undefined }).nearMiss, undefined);
});

/* ---------------------------------------------------------------------- */
/* Building-year sensitivity: the verdict follows the oldest building, the  */
/* detail says what a value-weighted reading would conclude.                */
/* ---------------------------------------------------------------------- */

test("sensitivity: an old building that holds a sliver of value is named, with the weighted year", () => {
  const factor = factorFor("buildingYear", {
    buildingYear: 1972,
    buildingSchedule: [
      { year: 1972, value: 1_000_000 },
      { year: 2004, value: 9_000_000 },
      { year: 2012, value: 10_000_000 },
    ],
  });
  assert.equal(factor.verdict, "not_acceptable", "the verdict still follows the oldest building");
  assert.equal(factor.reason, "Built in 1972, 18 years before the 1990 cutoff.");
  assert.ok(factor.detail);
  assert.match(factor.detail, /oldest of 3 buildings, which holds 5% of the schedule's value/);
  assert.match(factor.detail, /2 of 3 were built after 1990/);
  assert.match(factor.detail, /value-weighted year is 2006, which would be acceptable/);
});

test("sensitivity: a weighted year that also fails says so, instead of implying a rescue", () => {
  const factor = factorFor("buildingYear", {
    buildingYear: 1960,
    buildingSchedule: [
      { year: 1960, value: 8_000_000 },
      { year: 1995, value: 2_000_000 },
    ],
  });
  assert.match(factor.detail ?? "", /would still be not acceptable/);
});

test("sensitivity: a weighted year past 2010 reads as a target match", () => {
  const detail = buildingYearSensitivity(1985, [
    { year: 1985, value: 100 },
    { year: 2020, value: 9_900 },
  ]);
  assert.match(detail ?? "", /value-weighted year is 2020, which would be a target match/);
});

test("sensitivity: without building values the note counts buildings and says it could not weight", () => {
  const detail = buildingYearSensitivity(1980, [{ year: 1980 }, { year: 2000 }, { year: 2015 }]);
  assert.match(detail ?? "", /oldest of 3 buildings; 2 of 3 were built after 1990 \(no building values to weight by\)/);
});

test("sensitivity: a single building, an empty schedule, or an acceptable year produce no note", () => {
  assert.equal(buildingYearSensitivity(1980, [{ year: 1980, value: 5 }]), undefined);
  assert.equal(buildingYearSensitivity(1980, []), undefined);
  assert.equal(buildingYearSensitivity(1980, undefined), undefined);
  assert.equal(factorFor("buildingYear", { buildingYear: 2000, buildingSchedule: [{ year: 2000 }, { year: 2015 }] }).detail, undefined);
});

test("sensitivity: an exact-1990 oldest building keeps its unknown verdict and still carries the note", () => {
  const factor = factorFor("buildingYear", { buildingYear: 1990, buildingSchedule: [{ year: 1990, value: 1 }, { year: 2015, value: 9 }] });
  assert.equal(factor.verdict, "unknown");
  assert.match(factor.detail ?? "", /value-weighted year is 2013/);
});

/* ---------------------------------------------------------------------- */
/* Evidence: provenance is copied verbatim and never touches the verdict.   */
/* ---------------------------------------------------------------------- */

test("evidence: derivations are copied onto the matching factor and stripped from the ranked row", () => {
  const ranked = evaluateAppetite({
    ...fullTarget,
    derivations: {
      buildingYear: { method: "Oldest of 3 buildings.", sourcePath: "Policy.exposure_units.location.buildings.year_built", confidence: "high" },
      tiv: { method: "Summed 3 building values.", sourcePath: "Policy.exposure_units.location.buildings.tiv", confidence: "high", ambiguity: "Two values were missing." },
    },
  });
  const year = ranked.factors.find((factor) => factor.key === "buildingYear");
  const tiv = ranked.factors.find((factor) => factor.key === "tiv");
  assert.deepEqual(year?.evidence, { method: "Oldest of 3 buildings.", sourcePath: "Policy.exposure_units.location.buildings.year_built", confidence: "high" });
  assert.equal(tiv?.evidence?.ambiguity, "Two values were missing.");
  assert.equal(ranked.factors.find((factor) => factor.key === "totalPremium")?.evidence, undefined);
  assert.ok(!("derivations" in ranked), "provenance inputs do not ride along on the ranked row");
  assert.equal(ranked.status, evaluateAppetite(fullTarget).status);
  assert.equal(ranked.score, evaluateAppetite(fullTarget).score);
});

/* ---------------------------------------------------------------------- */
/* Ranking: fewest failures first inside a status, then score.              */
/* ---------------------------------------------------------------------- */

test("ranking: one failure outranks two failures at the same score", () => {
  const oneFailHighValue: CanonicalSubmission = { ...fullTarget, id: "one-fail", accountName: "One Fail", fiveYearLossValue: 500_000 };
  const twoFailsSameScore: CanonicalSubmission = { ...fullTarget, id: "two-fails", accountName: "Two Fails", submissionType: "Renewal", fiveYearLossValue: 500_000, primaryRiskState: "CA" };
  // Both fixtures lose the same points; the two-failure row additionally fails type.
  const [first, second] = rankSubmissions([twoFailsSameScore, oneFailHighValue]);
  assert.equal(first.id, "one-fail");
  assert.equal(failureCount(first.factors), 1);
  assert.equal(failureCount(second.factors), 2);
});

test("ranking: a single failure with a lower score still outranks three failures with a higher score", () => {
  // Single failure (losses) plus an unresolved construction split: 6 of 12 points.
  const single: CanonicalSubmission = { ...fullTarget, id: "single", accountName: "Single", primaryRiskState: "UT", tiv: 10_000_000, totalPremium: 60_000, buildingYear: 2000, approvedConstructionPercentage: 0.5, fiveYearLossValue: 500_000 };
  // Three failures but two target matches: 7 of 12 points.
  const triple: CanonicalSubmission = { ...fullTarget, id: "triple", accountName: "Triple", primaryRiskState: "TX", tiv: 200_000_000, fiveYearLossValue: 500_000 };
  const ranked = rankSubmissions([triple, single]);
  assert.ok(ranked[0].score < ranked[1].score, "the single-failure row has the lower score");
  assert.equal(ranked[0].id, "single");
});

test("ranking: status still precedes failure count", () => {
  const ranked = rankSubmissions([multipleFailures, contradictory, fullTarget]);
  assert.deepEqual(ranked.map((item) => item.id), ["fx-target", "fx-contradictory", "fx-multi"]);
});

/* ---------------------------------------------------------------------- */
/* Distance helpers.                                                        */
/* ---------------------------------------------------------------------- */

test("distance: one fix away, near misses, and the label", () => {
  const oneFix = evaluateAppetite({ ...fullTarget, totalPremium: 176_000 });
  assert.equal(isOneFixAway(oneFix), true);
  assert.equal(distanceLabel(oneFix), "One factor out");
  assert.deepEqual(nearMissFactors(oneFix).map((factor) => factor.key), ["totalPremium"]);

  const three = evaluateAppetite(multipleFailures);
  assert.equal(isOneFixAway(three), false);
  assert.equal(distanceLabel(three), "3 factors out");
  assert.equal(failingFactors(three).length, 3);

  const clean = evaluateAppetite(fullTarget);
  assert.equal(isOneFixAway(clean), false);
  assert.equal(distanceLabel(clean), undefined);
  assert.equal(nearMissFactors(clean).length, 0);
});

/* ---------------------------------------------------------------------- */
/* UI integration: chips, evidence, and sensitivity reach the rendered page. */
/* ---------------------------------------------------------------------- */

test("queue table: an out-of-appetite row shows its distance and near-miss chips", () => {
  const submissions = rankSubmissions([
    { ...fullTarget, id: "near", accountName: "Near Miss Co", totalPremium: 176_000 },
    multipleFailures,
    fullTarget,
  ]);
  const html = renderToStaticMarkup(createElement(QueueTable, { submissions, onOpen: () => {} }));
  assert.match(html, /One fix away/);
  assert.match(html, /Near miss · total premium/);
  assert.match(html, /3 factors out/);
  const chipBlocks = html.match(/distance-chips/g) ?? [];
  assert.equal(chipBlocks.length, 2, "only the two out-of-appetite rows render distance chips");
});

test("distance chips render nothing for in-appetite and needs-investigation rows", () => {
  const [inAppetite] = rankSubmissions([fullTarget]);
  assert.equal(renderToStaticMarkup(createElement(DistanceChips, { submission: inAppetite })), "");
  const [needsInvestigation] = rankSubmissions([{ ...fullTarget, fiveYearLossValue: undefined }]);
  assert.equal(renderToStaticMarkup(createElement(DistanceChips, { submission: needsInvestigation })), "");
});

test("review tab: each factor shows its delta, sensitivity note, near-miss badge, and provenance", () => {
  const [submission] = rankSubmissions([
    {
      ...fullTarget,
      buildingYear: 1989,
      buildingSchedule: [
        { year: 1989, value: 1_000_000 },
        { year: 2015, value: 19_000_000 },
      ],
      derivations: {
        buildingYear: { method: "Oldest of 2 buildings (1989–2015).", sourcePath: "Policy.exposure_units.location.buildings.year_built", confidence: "high" },
        tiv: { method: "Summed 2 building value(s) across 1 location(s).", sourcePath: "Policy.exposure_units.location.buildings.tiv", confidence: "high" },
        primaryRiskState: { method: "Only state on the risk schedule.", sourcePath: "Policy.exposure_units.location.state", confidence: "high" },
      },
    },
  ]);
  const html = renderToStaticMarkup(createElement(ReviewTab, { submission }));
  assert.match(html, /Built in 1989, 1 year before the 1990 cutoff/);
  assert.match(html, /Near miss/);
  assert.match(html, /factor-detail[^>]*>The verdict follows the oldest of 2 buildings, which holds 5% of the schedule/);
  assert.match(html, /value-weighted year is 2014, which would be a target match/);
  assert.match(html, /<code>Policy\.exposure_units\.location\.buildings\.year_built<\/code>/);
  assert.match(html, /Oldest of 2 buildings \(1989–2015\)\. · high confidence/);
  const evidenceLines = html.match(/factor-evidence/g) ?? [];
  assert.equal(evidenceLines.length, 3, "only factors with provenance render a source line");
});

test("case summary: distance and near-miss chips appear under the recommendation", () => {
  const [submission] = rankSubmissions([{ ...fullTarget, totalPremium: 176_000 }]);
  const html = renderToStaticMarkup(createElement(CaseSummary, { submission }));
  assert.match(html, /distance-chips/);
  assert.match(html, /One fix away/);
  assert.match(html, /Near miss · total premium/);
  const [clean] = rankSubmissions([fullTarget]);
  assert.doesNotMatch(renderToStaticMarkup(createElement(CaseSummary, { submission: clean })), /distance-chips|Near miss/);
});
