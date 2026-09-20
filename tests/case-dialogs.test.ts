import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MethodologyDialog } from "../components/case/methodology-dialog";

test("methodology dialog renders scoring weights when open", () => {
  const html = renderToStaticMarkup(
    createElement(MethodologyDialog, { open: true, onClose: () => {} }),
  );
  assert.match(html, /scoring|weight/i);
});
