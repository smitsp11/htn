import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewTab } from "../components/case/review-tab";
import { ResearchPanel } from "../components/case/research-panel";
import { evaluateAppetite, rankSubmissions } from "../lib/domain/appetite";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("review tab shows the recommendation and research digest", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(ReviewTab, { submission }));
  assert.match(html, /NEXT STEP|Next step/i);
  assert.match(html, new RegExp(submission.recommendation.slice(0, 12)));
  assert.match(html, /Research at a glance|flood zone/i);
});

test("submission with gaps renders evidence task cards and a request draft", () => {
  const [submission] = rankSubmissions([empty]);
  const html = renderToStaticMarkup(createElement(ReviewTab, { submission }));
  assert.match(html, /Evidence gap|Needs/i);
  assert.match(html, /Subject: Information needed/i);
});

test("research distinguishes composite rating from individual hazards and engine context from AI", () => {
  const submission = evaluateAppetite({
    id: "cgl-research",
    accountName: "CGL Research",
    submissionType: "new",
    lineOfBusiness: "cgl",
    primaryRiskState: "CA",
    totalPremium: 60_000,
    fiveYearLossValue: 0,
  }, true);
  submission.enrichment = {
    compositeRating: "relatively low",
    compositeScore: 12,
    topHazards: [{ type: "Flooding", rating: "very high" }],
    source: "FEMA NRI",
    asOf: "2026-09-19",
  };

  const html = renderToStaticMarkup(createElement(ResearchPanel, { submission }));
  assert.match(html, /Commercial General Liability research/);
  assert.match(html, /Composite hazard rating[\s\S]*relatively low/);
  assert.match(html, /Flooding: very high/);
  assert.match(html, /Unresolved factors/);
  assert.doesNotMatch(html, /AI notes|AI context/);
});

test("non-property evidence guidance uses the selected line", () => {
  const submission = evaluateAppetite({
    id: "cgl-evidence",
    accountName: "CGL Evidence",
    submissionType: "new",
    lineOfBusiness: "cgl",
    primaryRiskState: "CA",
    totalPremium: 60_000,
    fiveYearLossValue: 0,
  }, true);

  const html = renderToStaticMarkup(createElement(ReviewTab, { submission }));
  assert.match(html, /commercial general liability review/i);
  assert.match(html, /exposure schedule documenting the exposure basis/i);
  assert.doesNotMatch(html, /complete our commercial property review/i);
});
