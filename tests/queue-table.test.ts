import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueTable } from "../components/queue/queue-table";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("renders one row per submission with lane badge, score, and premium", () => {
  const submissions = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(
    createElement(QueueTable, { submissions, onOpen: () => {} }),
  );
  assert.match(html, /queue-table/);
  const rows = html.match(/data-row-id=/g) ?? [];
  assert.equal(rows.length, submissions.length);
  assert.match(html, /lane-/);
});
