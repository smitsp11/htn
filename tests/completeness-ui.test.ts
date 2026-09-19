import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionDetail } from "../components/dashboard/submission-detail";
import { evaluateAppetite } from "../lib/domain/appetite";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("a complete submission reads 'In good order'", () => {
  const html = renderToStaticMarkup(
    createElement(SubmissionDetail, { submission: evaluateAppetite(fullTarget) }),
  );
  assert.match(html, /In good order/);
  assert.match(html, /8 of 8 required fields resolved/);
});

test("an incomplete submission shows a checklist of missing fields", () => {
  const html = renderToStaticMarkup(
    createElement(SubmissionDetail, { submission: evaluateAppetite(empty) }),
  );
  assert.match(html, /to resolve/);
  assert.match(html, /igo-checklist/);
  assert.match(html, /Confirm /);
});
