import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExternalRisk } from "../components/external-risk/external-risk";
import type { HazardProfile } from "../lib/domain/types";

const profile: HazardProfile = {
  compositeRating: "very high",
  topHazards: [{ type: "Wildfire", rating: "very high" }],
  source: "FEMA NRI",
  asOf: "2026-09-19",
};

test("renders composite rating, top hazard, and source label", () => {
  const html = renderToStaticMarkup(createElement(ExternalRisk, { profile }));
  assert.match(html, /Very high/i);
  assert.match(html, /Wildfire/);
  assert.match(html, /FEMA National Risk Index/);
});

test("renders nothing meaningful for unknown", () => {
  const html = renderToStaticMarkup(createElement(ExternalRisk, { profile: { compositeRating: "unknown", topHazards: [], source: "FEMA NRI", asOf: "1970-01-01" } }));
  assert.match(html, /No external hazard data/i);
});
