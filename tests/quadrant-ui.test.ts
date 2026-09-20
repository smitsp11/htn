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

test("quadrant labels both axes, explains each cell, and says why every row landed there", () => {
  const subs = rankSubmissions([fullTarget, empty]);
  const html = renderToStaticMarkup(createElement(QuadrantBoard, { submissions: subs, onOpen: () => {} }));
  assert.match(html, /High appetite/);
  assert.match(html, /Low appetite/);
  assert.match(html, /Low effort/);
  assert.match(html, /High effort/);
  assert.match(html, /Decide now\./, "each cell states what landing there means");
  assert.match(html, /Lowest return on effort\./);
  assert.match(html, /to resolve: /, "a row with gaps says how many fields are left and which");
  assert.match(html, /placed by appetite \(rows\) and effort left to decide/);
});
