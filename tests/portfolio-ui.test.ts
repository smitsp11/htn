import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioStrip } from "../components/dashboard/portfolio-strip";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("renders total, in-appetite TIV, and a top state", () => {
  const subs = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(createElement(PortfolioStrip, { submissions: subs }));
  assert.match(html, /In-appetite TIV/);
  assert.match(html, /Submissions/);
  assert.match(html, /Top states/);
});
