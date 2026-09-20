import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioStrip } from "../components/queue/portfolio-strip";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget, empty } from "./fixtures/domain/submissions";

test("portfolio strip shows total, TIV and state metrics", () => {
  const subs = rankSubmissions([fullTarget, empty]);
  const html = renderToStaticMarkup(createElement(PortfolioStrip, { submissions: subs }));
  assert.match(html, /Submissions/);
  assert.match(html, /Property TIV/);
  assert.match(html, /In-appetite property TIV/);
  assert.match(html, /Top property states/);
});
