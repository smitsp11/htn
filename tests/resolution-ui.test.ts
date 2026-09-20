import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResolutionPanel } from "../components/case/resolution-panel";
import type { ResolutionResult } from "../lib/domain/types";

const resolution: ResolutionResult = {
  fields: [{ key: "totalPremium", label: "Total premium", value: 88000, display: "$88K", source: "broker email", confidence: 0.9, asOf: "2026-09-20" }],
  before: { status: "needs_investigation", score: 58 },
  after: { status: "in_appetite", score: 92 },
};

test("resolution panel shows chips and a before → after verdict", () => {
  const html = renderToStaticMarkup(createElement(ResolutionPanel, { resolution }));
  assert.match(html, /broker email/);
  assert.match(html, /\$88K/);
  assert.match(html, /Needs investigation/);
  assert.match(html, /In appetite/);
});

test("renders nothing when there is no resolution", () => {
  assert.equal(renderToStaticMarkup(createElement(ResolutionPanel, { resolution: undefined })), "");
});
