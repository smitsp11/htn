import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioStrip } from "../components/dashboard/portfolio-strip";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("renders total, TIV figures, a top state, and hazard exposure", () => {
  const subs = rankSubmissions([fullTarget, empty, contradictory]);
  const plain = text(renderToStaticMarkup(createElement(PortfolioStrip, { submissions: subs })));
  assert.match(plain, /Submissions 3/);
  assert.match(plain, /Total TIV \$150M 1 without TIV/);
  assert.match(plain, /In-appetite TIV \$75M/);
  assert.match(plain, /Top states CA \(2\)/);
  assert.match(plain, /No hazard data/);
});

test("names the out-of-scope count so the total is not mistaken for property volume", () => {
  const subs = rankSubmissions([fullTarget, { id: "C1", accountName: "Cyber Co", lineOfBusiness: "Cyber" }]);
  const plain = text(renderToStaticMarkup(createElement(PortfolioStrip, { submissions: subs })));
  assert.match(plain, /Submissions 2 1 out of scope/);
});
