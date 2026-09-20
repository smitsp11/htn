import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FactorBreakdown } from "../components/factor-breakdown/factor-breakdown";
import { evaluateAppetite } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

function render(submission: Parameters<typeof evaluateAppetite>[0]) {
  return renderToStaticMarkup(createElement(FactorBreakdown, { submission: evaluateAppetite(submission) }));
}

test("renders all eight factor labels with human verdict wording", () => {
  const html = render(fullTarget);
  for (const label of [
    "Submission type",
    "Line of business",
    "Primary risk state",
    "Total insured value",
    "Total premium",
    "Building year",
    "Construction type",
    "Five-year losses",
  ]) {
    assert.ok(html.includes(label), `missing label ${label}`);
  }
  assert.match(html, />Target</);
  assert.match(html, />Acceptable</);
  const visibleText = html.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(visibleText, /not_acceptable|in_appetite/, "raw enum values must not be shown as text");
});

test("shows status ahead of score and marks the failing factor", () => {
  const html = render(contradictory);
  const statusIndex = html.indexOf("Out of appetite");
  const scoreIndex = html.indexOf("92");
  assert.ok(statusIndex >= 0 && scoreIndex > statusIndex, "status must render before the score");
  assert.match(html, /data-verdict="not_acceptable"[^>]*>[\s\S]*?Submission type[\s\S]*?Not acceptable/);
  assert.match(html, /Review for likely decline/);
});

test("surfaces unknowns and a tally for an empty submission", () => {
  const html = render(empty);
  assert.match(html, /Needs investigation/);
  assert.match(html, /8 unknown/);
  assert.match(html, /Investigate missing or ambiguous data/);
});
