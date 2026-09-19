import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView, type DashboardViewProps } from "../components/dashboard/dashboard-view";
import { rankSubmissions } from "../lib/domain/appetite";
import { largeQueue, rankedContradictory, rankedEmpty, response } from "./fixtures/rankings/responses";

function render(overrides: Partial<DashboardViewProps> = {}) {
  const props: DashboardViewProps = {
    data: null,
    error: null,
    loading: false,
    expandedId: null,
    onToggle: () => undefined,
    onRefresh: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(DashboardView, props));
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("initial loading state", () => {
  const html = render({ loading: true });
  assert.match(html, /Evaluating the submission queue/);
  assert.doesNotMatch(html, /<table/);
});

test("authentication failure state names the category and offers retry", () => {
  const html = render({ error: { category: "auth", error: "Federato authentication failed (401)." } });
  assert.match(html, /Federato authentication failed/);
  assert.match(html, /credentials/i);
  assert.match(html, /<button[^>]*>Try again<\/button>/);
});

test("query failure state is distinct from authentication failure", () => {
  const html = render({ error: { category: "query", error: "Federato API request failed (502): upstream" } });
  assert.match(html, /query failed/i);
  assert.match(html, /upstream/);
  assert.doesNotMatch(html, /credentials/i);
});

test("configuration failure state points at live-mode setup", () => {
  const html = render({ error: { category: "configuration", error: "FEDERATO_QUERY_PAYLOAD_JSON is required for live mode." } });
  assert.match(html, /not configured/i);
  assert.match(html, /FEDERATO_QUERY_PAYLOAD_JSON/);
});

test("empty queue state", () => {
  const html = render({ data: response({ submissions: [] }) });
  assert.match(html, /No submissions were returned/);
  assert.doesNotMatch(html, /<table/);
});

test("populated queue shows rank, status before score, primary reason, and recommendation", () => {
  const html = render({ data: response() });
  const plain = text(html);
  assert.match(html, /<table/);
  assert.match(plain, /Target Account/);
  const row = html.slice(html.indexOf("Contradictory Account"), html.indexOf("Contradictory Account") + 1500);
  assert.ok(row.indexOf("Out of appetite") < row.indexOf("92"), "status badge must precede the score");
  assert.match(row, /Renewal business is not acceptable\./);
  assert.match(row, /Review for likely decline/);
});

test("source status reports origin, schema discovery, timestamp, and unresolved-data diagnostics", () => {
  const plain = text(render({ data: response() }));
  assert.match(plain, /Demo fixtures/);
  assert.match(plain, /Schema discovered: No/);
  assert.match(plain, /6 submissions ranked/);
  assert.match(plain, /3 with unresolved fields/);
  assert.match(plain, /2026-09-19/);
});

test("live source status shows Federato and schema discovered", () => {
  const plain = text(render({ data: response({ source: "federato", schemaDiscovered: true }) }));
  assert.match(plain, /Federato API/);
  assert.match(plain, /Schema discovered: Yes/);
});

test("renders 55 submissions with sequential ranks", () => {
  const html = render({ data: response({ submissions: rankSubmissions(largeQueue()) }) });
  const bodyRows = (html.match(/<tr class="queue-row"/g) ?? []).length;
  assert.equal(bodyRows, 55);
  assert.match(html, /<td class="rank-cell">55<\/td>/);
});

test("expanded detail composes explanation, dates, unresolved callout, and factor breakdown", () => {
  const html = render({ data: response(), expandedId: rankedEmpty.id });
  assert.match(html, /aria-label="Appetite factor breakdown"/);
  assert.match(html, /Empty Account scores 0\/100/);
  assert.match(text(html), /Effective Unknown/);
  assert.match(text(html), /Unresolved fields: submission type, line of business/);
});

test("expanded detail for a clean submission has no unresolved callout", () => {
  const html = render({ data: response(), expandedId: rankedContradictory.id });
  assert.match(html, /aria-label="Appetite factor breakdown"/);
  assert.doesNotMatch(html, /Unresolved fields:/);
  assert.match(text(html), /Effective 2026-10-01/);
});

test("refresh failure keeps the stale queue visible with a banner", () => {
  const html = render({ data: response(), error: { category: "query", error: "Federato API request failed (502)" } });
  assert.match(html, /<table/);
  assert.match(text(html), /Showing results from 2026-09-19/);
  assert.match(text(html), /Refresh failed/);
});

test("refreshing state disables the refresh button but keeps data", () => {
  const html = render({ data: response(), loading: true });
  assert.match(html, /<button[^>]*disabled[^>]*>Refreshing/);
  assert.match(html, /<table/);
});

test("no write-back or binding action exists anywhere in the UI", () => {
  const html = render({ data: response(), expandedId: rankedContradictory.id });
  const buttons = html.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
  assert.ok(buttons.length > 0);
  for (const button of buttons) assert.doesNotMatch(button, /accept|bind|reject|decline|approve/i);
  assert.doesNotMatch(html, /<form|method="post"/i);
});

test("out-of-scope submissions render in a collapsed section, not the main table", () => {
  const mixed = rankSubmissions([
    {
      id: "P1",
      accountName: "Prop Co",
      lineOfBusiness: "Property",
      submissionType: "New business",
      primaryRiskState: "FL",
      tiv: 60_000_000,
      totalPremium: 80_000,
      buildingYear: 2015,
      approvedConstructionPercentage: 0.9,
      fiveYearLossValue: 0,
    },
    { id: "C1", accountName: "Cyber Co", lineOfBusiness: "Cyber", primaryRiskState: "TX" },
  ]);
  const html = render({ data: response({ submissions: mixed }) });
  const bodyRows = (html.match(/<tr class="queue-row"/g) ?? []).length;
  assert.equal(bodyRows, 1); // only the property submission is in the ranked table
  const plain = text(html);
  assert.match(plain, /Out of scope \(1\)/);
  assert.match(plain, /Cyber Co/);
  assert.match(html, /out-of-scope-panel/);
});

test("no out-of-scope section renders when every submission is in scope", () => {
  const html = render({ data: response() });
  assert.doesNotMatch(html, /out-of-scope-panel/);
});
