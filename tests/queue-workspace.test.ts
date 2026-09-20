import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueWorkspace } from "../components/queue/queue-workspace";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

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
