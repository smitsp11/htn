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

test("empty result set shows the empty state", () => {
  const html = renderToStaticMarkup(
    createElement(QueueWorkspace, { submissions: [], onOpen: () => {}, matchedIds: null }),
  );
  assert.match(html, /No submissions match/);
});
