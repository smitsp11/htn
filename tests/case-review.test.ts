import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewTab } from "../components/case/review-tab";
import { rankSubmissions } from "../lib/domain/appetite";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("review tab shows the research digest", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(ReviewTab, { submission }));
  assert.match(html, /Research at a glance|flood zone/i);
  assert.doesNotMatch(html, /Flip analysis/, "a fully in-appetite submission has nothing to flip");
});

test("submission with gaps renders evidence task cards, a request draft, and flip analysis", () => {
  const [submission] = rankSubmissions([empty]);
  const html = renderToStaticMarkup(createElement(ReviewTab, { submission }));
  assert.match(html, /Evidence gap|Needs/i);
  assert.match(html, /Subject: Information needed/i);
  assert.match(html, /Flip analysis/);
  assert.match(html, /Actionable/);
});
