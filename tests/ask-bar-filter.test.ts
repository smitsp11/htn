import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView, type DashboardViewProps } from "../components/dashboard/dashboard-view";
import { rankedTarget, response } from "./fixtures/rankings/responses";

function render(overrides: Partial<DashboardViewProps> = {}) {
  const props: DashboardViewProps = {
    data: null,
    error: null,
    loading: false,
    expandedId: null,
    onToggle: () => undefined,
    onRefresh: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(DashboardView, props));
}

test("matchedIds narrows the rendered queue to the matched submission only", () => {
  const html = render({ data: response(), matchedIds: [rankedTarget.id] });
  const rows = (html.match(/<tr class="queue-row"/g) ?? []).length;
  assert.equal(rows, 1);
  assert.match(html, /Target Account/);
  assert.match(html, /Showing 1 of 6/);
});

test("matchedIds of null renders the full unfiltered queue", () => {
  const html = render({ data: response(), matchedIds: null });
  const rows = (html.match(/<tr class="queue-row"/g) ?? []).length;
  assert.equal(rows, 6);
  assert.doesNotMatch(html, /queue-filter-note/);
});
