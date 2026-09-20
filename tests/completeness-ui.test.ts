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

test("a boundary value reads as a decision, not a broker confirmation", () => {
  const html = renderToStaticMarkup(
    createElement(SubmissionDetail, { submission: evaluateAppetite({ ...fullTarget, id: "fx-1990", buildingYear: 1990 }) }),
  );
  assert.match(html, /1 field to resolve/);
  assert.match(html, /Decide building year/);
  assert.match(html, /exactly 1990/);
  assert.doesNotMatch(html, /Confirm building year/);
});

test("an out-of-scope submission shows no completeness checklist", () => {
  const html = renderToStaticMarkup(
    createElement(SubmissionDetail, { submission: evaluateAppetite({ id: "fx-cyber", accountName: "Cyber Co", lineOfBusiness: "Cyber" }) }),
  );
  assert.doesNotMatch(html, /in-good-order/);
  assert.doesNotMatch(html, /0 of 0/);
  assert.match(html, /out of scope/i);
});

test("no provenance list is rendered while no source has resolved anything", () => {
  const html = renderToStaticMarkup(
    createElement(SubmissionDetail, { submission: evaluateAppetite(empty) }),
  );
  assert.doesNotMatch(html, /Request from broker/);
  assert.match(html, /igo-checklist/);
});
