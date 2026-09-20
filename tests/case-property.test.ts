import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyTab } from "../components/case/property-tab";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget } from "./fixtures/domain/submissions";

test("property tab lists appetite factor checks and peer pricing", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(PropertyTab, { submission }));
  assert.match(html, /Appetite check|appetite/i);
  const factorRows = html.match(/fb-|factor-row|appetite-check/g) ?? [];
  assert.ok(factorRows.length >= submission.factors.length);
  assert.match(html, /Peer-indicated|Target band/);
});
