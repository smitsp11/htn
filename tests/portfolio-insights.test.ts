import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioInsights } from "../components/queue/portfolio-insights";
import { rankSubmissions } from "../lib/domain/appetite";
import type { CanonicalSubmission, RankedSubmission } from "../lib/domain/types";
import { runQueryAgent } from "../lib/federato/adapter";
import { createReplaySource } from "../lib/federato/replay";
import { loadOfflineOutcomes } from "../lib/federato/offline-data";
import { buildRankings } from "../lib/rankings/pipeline";
import { failureLeaderboard, portfolioInsights, portfolioTrace } from "../lib/rankings/portfolio-insights";
import { contradictory, fullTarget, multipleFailures } from "./fixtures/domain/submissions";

const book: CanonicalSubmission[] = [
  fullTarget,
  contradictory,
  multipleFailures,
  { ...fullTarget, id: "cyber", accountName: "Cyber Co", lineOfBusiness: "Cyber" },
  { ...fullTarget, id: "gl", accountName: "GL Co", lineOfBusiness: "General Liability" },
  { ...fullTarget, id: "pricey", accountName: "Pricey Co", totalPremium: 300_000 },
  { ...fullTarget, id: "near", accountName: "Near Co", totalPremium: 176_000 },
];

function byId(insights: ReturnType<typeof portfolioInsights>, id: string) {
  const insight = insights.find((item) => item.id === id);
  assert.ok(insight, `insight ${id} missing`);
  return insight;
}

test("portfolio: book shape counts property versus out-of-scope rows", () => {
  const insights = portfolioInsights(rankSubmissions(book));
  const shape = byId(insights, "book-shape");
  assert.equal(shape.kind, "shape");
  assert.equal(shape.headline, "5 of 7 submissions are commercial property");
  assert.match(shape.detail, /2 submissions on other lines were routed out of scope/);
});

test("portfolio: the failure leaderboard names the most common reasons and their counts", () => {
  const ranked = rankSubmissions(book);
  const leaders = failureLeaderboard(ranked.filter((item) => item.status !== "out_of_scope"));
  assert.equal(leaders[0].key, "totalPremium");
  assert.equal(leaders[0].count, 2);
  const drift = byId(portfolioInsights(ranked), "failure-leaders");
  assert.equal(drift.headline, "Total premium fails 2 of 5 property submissions");
  assert.match(drift.detail, /total premium \(2\)/);
});

test("portfolio: the premium band insight reports the share outside the band and the median", () => {
  const insight = byId(portfolioInsights(rankSubmissions(book)), "premium-band");
  assert.equal(insight.headline, "2 of 5 priced submissions sit outside the premium band");
  assert.match(insight.detail, /median premium on the property book is \$90K/);
  assert.match(insight.detail, /inside the guideline's acceptable range/);
});

test("portfolio: a book priced mostly outside the band questions the band, not the submissions", () => {
  const expensive = book.map((item) => ({ ...item, totalPremium: 400_000 }));
  const insight = byId(portfolioInsights(rankSubmissions(expensive)), "premium-band");
  assert.match(insight.detail, /the band, not the submissions, deserves a second look/);
});

test("portfolio: one-fix-away counts rows one factor from appetite and how many are near misses", () => {
  const insight = byId(portfolioInsights(rankSubmissions(book)), "one-fix-away");
  assert.equal(insight.kind, "opportunity");
  assert.equal(insight.headline, "3 submissions are one factor from appetite");
  assert.match(insight.detail, /1 of them is a near miss/);
});

test("portfolio: appetite drift appears only when actual outcomes are attached", () => {
  const ranked = rankSubmissions(book);
  assert.equal(portfolioInsights(ranked).find((item) => item.id === "appetite-drift"), undefined);
  const withOutcomes: RankedSubmission[] = ranked.map((item) => ({
    ...item,
    actualOutcome: item.status === "out_of_appetite" || item.status === "in_appetite" ? { status: "bound" } : undefined,
  }));
  const drift = byId(portfolioInsights(withOutcomes), "appetite-drift");
  assert.equal(drift.headline, "4 of 5 bound accounts fall outside the stated appetite");
  assert.match(drift.detail, /bound 4 risks the 2025 guideline would not have written/);
});

test("portfolio: an empty queue yields no insights and a property-free queue only the shape", () => {
  assert.deepEqual(portfolioInsights([]), []);
  const onlyOther = portfolioInsights(rankSubmissions([{ ...fullTarget, lineOfBusiness: "Cyber" }]));
  assert.deepEqual(onlyOther.map((item) => item.id), ["book-shape"]);
});

test("portfolio: insights never change any verdict, score, or order", () => {
  const ranked = rankSubmissions(book);
  const before = JSON.stringify(ranked);
  portfolioInsights(ranked);
  portfolioTrace(ranked);
  assert.equal(JSON.stringify(ranked), before);
});

test("pipeline: the decision trace carries the portfolio lines", async () => {
  const result = await buildRankings({
    useDemoData: false,
    demoSubmissions: [],
    dataSource: "live",
    runAgent: async () => ({ submissions: book, traceSummary: [] }),
    rank: rankSubmissions,
    now: () => new Date("2026-09-20T12:00:00.000Z"),
  });
  assert.ok(result.trace.some((line) => line.startsWith("Portfolio: 5 of 7 submissions are commercial property")));
  assert.ok(result.trace.some((line) => /Portfolio: 3 submissions are one factor from appetite/.test(line)));
});

test("portfolio insights: renders one card per insight with its kind and headline", () => {
  const html = renderToStaticMarkup(createElement(PortfolioInsights, { submissions: rankSubmissions(book) }));
  assert.match(html, /portfolio-insights/);
  const cards = html.match(/data-insight="/g) ?? [];
  assert.equal(cards.length, 4);
  assert.match(html, /Appetite drift/);
  assert.match(html, /Opportunity/);
  assert.match(html, /3 submissions are one factor from appetite/);
  assert.equal(renderToStaticMarkup(createElement(PortfolioInsights, { submissions: [] })), "");
});

/* ---------------------------------------------------------------------- */
/* On the real snapshot: the insights an underwriter will actually see.     */
/* ---------------------------------------------------------------------- */

test("portfolio on the captured book: says the premium band and building-year rule shape the queue", async () => {
  const source = createReplaySource();
  const agent = await runQueryAgent({ discoverSchema: source.discoverSchema, execute: source.execute, useModel: false });
  const ranked = rankSubmissions(agent.submissions);
  const outcomes = await loadOfflineOutcomes();
  for (const submission of ranked) {
    const outcome = outcomes.get(submission.id);
    if (outcome) submission.actualOutcome = outcome;
  }
  const insights = portfolioInsights(ranked);
  assert.match(byId(insights, "book-shape").headline, /^38 of 158 submissions are commercial property$/);
  assert.match(byId(insights, "failure-leaders").headline, /^Building year fails 26 of 38 property submissions$/);
  assert.match(byId(insights, "failure-leaders").detail, /value-weighted reading/);
  const premium = byId(insights, "premium-band");
  assert.match(premium.headline, /^19 of 27 priced submissions sit outside the premium band$/);
  assert.match(premium.detail, /median premium on the property book is \$262K/);
  assert.match(premium.detail, /the band, not the submissions/);
  const drift = byId(insights, "appetite-drift");
  assert.match(drift.headline, /^\d+ of \d+ bound accounts? fall outside the stated appetite$/);
  const oneFix = byId(insights, "one-fix-away");
  assert.match(oneFix.headline, /^\d+ submissions are one factor from appetite$/);
});
