import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuadrantBoard } from "../components/dashboard/quadrant-board";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("renders four labelled cells and places accounts", () => {
  const submissions = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(
    createElement(QuadrantBoard, { submissions, onSelect: () => {} }),
  );
  for (const label of ["Work now", "Worth the effort", "Selective", "Deprioritize"]) {
    assert.ok(html.includes(label), `missing cell ${label}`);
  }
  assert.ok(html.includes(fullTarget.accountName), "places the in-appetite account");
});

test("out-of-scope lines are left off the board and the open item is marked pressed", () => {
  const submissions = rankSubmissions([fullTarget, { id: "C1", accountName: "Cyber Co", lineOfBusiness: "Cyber" }]);
  const html = renderToStaticMarkup(
    createElement(QuadrantBoard, { submissions, onSelect: () => {}, selectedId: fullTarget.id }),
  );
  assert.doesNotMatch(html, /Cyber Co/);
  assert.match(html, /aria-pressed="true"[^>]*>Target Account/);
});
