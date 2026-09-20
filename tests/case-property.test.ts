import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewTab } from "../components/case/review-tab";
import { PropertyTab } from "../components/case/property-tab";
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
