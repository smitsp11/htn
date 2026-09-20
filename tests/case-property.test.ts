import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewTab } from "../components/case/review-tab";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget } from "./fixtures/domain/submissions";

test("review tab shows the appetite breakdown with one row per factor", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(ReviewTab, { submission }));
  assert.match(html, /Appetite breakdown/);
  // One `.appetite-check` row per evaluated factor (each row also carries an
  // `.appetite-check-label`, so the class appears at least once per factor).
  const factorRows = html.match(/appetite-check-label/g) ?? [];
  assert.equal(factorRows.length, submission.factors.length);
});
