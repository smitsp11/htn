import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionSidebar } from "../components/case/decision-sidebar";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget } from "./fixtures/domain/submissions";

test("decision sidebar renders the decision choices and a record button", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(DecisionSidebar, { submission }));
  assert.match(html, /Approve/);
  assert.match(html, /Decline/);
  assert.match(html, /Request info|Request information/i);
  assert.match(html, /Record decision/);
  assert.match(html, /Total insured value/);
  assert.doesNotMatch(html, /Peer-indicated/);
});
