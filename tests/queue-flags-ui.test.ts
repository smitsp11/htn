import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueTable } from "../components/dashboard/queue-table";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("queue rows render flag chips with reason tooltips", () => {
  const submissions = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(
    createElement(QueueTable, { submissions, expandedId: null, onToggle: () => {} }),
  );
  assert.match(html, /flag-chip/, "expected at least one flag chip");
  assert.match(html, /flag-yellow/, "empty submission should produce a yellow chip");
  assert.match(html, /title="[^"]+:/, "chips carry factor-reason tooltips");
});
