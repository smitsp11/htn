import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResolutionChips } from "../components/enrichment-resolution/resolution-chips";

test("renders a provenance chip for a resolved field", () => {
  const html = renderToStaticMarkup(
    createElement(ResolutionChips, {
      resolutions: { tiv: { value: 75_000_000, provenance: { source: "inference", confidence: 0.8, asOf: "2026-09-19" } } },
      labels: { tiv: "Total insured value" },
    }),
  );
  assert.match(html, /Total insured value/);
  assert.match(html, /inference/);
  assert.match(html, /0\.8|80%/);
});

test("renders a broker-chase pill for an unresolved (null) field", () => {
  const html = renderToStaticMarkup(
    createElement(ResolutionChips, {
      resolutions: { totalPremium: null },
      labels: { totalPremium: "Total premium" },
    }),
  );
  assert.match(html, /Total premium/);
  assert.match(html, /request from broker|chase/i);
});

test("money values are formatted like the rest of the UI", () => {
  const html = renderToStaticMarkup(
    createElement(ResolutionChips, {
      resolutions: { tiv: { value: 75_000_000, provenance: { source: "SOV", confidence: 1, asOf: "2026-09-19" } } },
      labels: { tiv: "Total insured value" },
    }),
  );
  assert.match(html, /\$75M/);
  assert.doesNotMatch(html, /75000000/);
});
