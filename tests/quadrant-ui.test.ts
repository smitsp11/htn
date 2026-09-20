import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuadrantBoard } from "../components/queue/quadrant-board";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget, empty } from "./fixtures/domain/submissions";

test("quadrant renders the four cells and marks a work-now entry", () => {
  const subs = rankSubmissions([fullTarget, empty]);
  const html = renderToStaticMarkup(createElement(QuadrantBoard, { submissions: subs, onOpen: () => {} }));
  assert.match(html, /Work now/);
  assert.match(html, /Worth the effort/);
  assert.match(html, /Selective/);
  assert.match(html, /Deprioritize/);
  assert.match(html, /qc-work-now/);
});
