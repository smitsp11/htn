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

test("without a query trace, factors show no provenance line", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(PropertyTab, { submission }));
  assert.doesNotMatch(html, /appetite-check-provenance/);
});

test("with a query trace, each matched factor shows its real schema path and retrieval time", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(
    createElement(PropertyTab, {
      submission,
      retrievedAt: "2026-09-20T10:48:55.152Z",
      queryTrace: {
        rootResource: "Policy",
        plannedBy: "heuristic",
        fields: [
          {
            field: "submissionType",
            label: "Submission type",
            appetiteReason: "New vs. renewal.",
            schemaPath: "Policy.business_type",
            reason: "Matched Policy.business_type.",
            chosenBy: "heuristic",
            alternatives: [],
          },
        ],
        unresolved: [],
        fallbacks: [],
        steps: [],
      },
    }),
  );
  assert.match(html, /Policy\.business_type/);
  assert.match(html, /Retrieved/);
});
