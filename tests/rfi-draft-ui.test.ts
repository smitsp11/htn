import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RfiDraft } from "../components/rfi-draft/rfi-draft";

test("renders subject and body of a draft", () => {
  const html = renderToStaticMarkup(
    createElement(RfiDraft, { draft: { subject: "Information needed: Acme (S1)", body: "Hi,\n  • Total premium\n", missingItems: ["Total premium"] } }),
  );
  assert.match(html, /Information needed: Acme/);
  assert.match(html, /Total premium/);
  assert.match(html, /Copy/);
});
