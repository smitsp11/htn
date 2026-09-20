import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueWorkspace } from "../components/queue/queue-workspace";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";
import type { RankedSubmission } from "../lib/domain/types";

test("renders the queue heading and a table of submissions", () => {
  const submissions = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(
    createElement(QueueWorkspace, { submissions, onOpen: () => {}, matchedIds: null }),
  );
  assert.match(html, /queue-table/);
  assert.match(html, /Commercial property/);
});

test("empty result set shows the empty state naming the active scope", () => {
  const html = renderToStaticMarkup(
    createElement(QueueWorkspace, { submissions: [], onOpen: () => {}, matchedIds: null }),
  );
  assert.match(html, /empty-state/);
  // The empty-state copy names which scope produced zero rows. (The "Show all
  // lanes" reset only appears when a specific lane is selected, not at "all".)
  assert.match(html, /No commercial property submissions in view/);
});

test("default property scope slices by line of business, not appetite status", () => {
  // In Extended mode non-property lines are scored too (no longer out_of_scope),
  // so the "Commercial property" scope must slice by lineOfBusiness. A cgl
  // submission with an in-appetite status must NOT leak into the property scope.
  const property: RankedSubmission = {
    id: "prop-1",
    accountName: "PropCo Property LLC",
    lineOfBusiness: "property",
    status: "in_appetite",
    score: 90,
    factors: [],
    recommendation: "",
    explanation: "",
  };
  const cgl: RankedSubmission = {
    id: "cgl-1",
    accountName: "CglCo Liability LLC",
    lineOfBusiness: "cgl",
    status: "in_appetite",
    score: 80,
    factors: [],
    recommendation: "",
    explanation: "",
  };
  const html = renderToStaticMarkup(
    createElement(QueueWorkspace, {
      submissions: [property, cgl],
      onOpen: () => {},
      matchedIds: null,
    }),
  );
  assert.match(html, /PropCo/);
  assert.doesNotMatch(html, /CglCo/);
});
