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

test("extended methodology explains per-line normalization without changing property rules", () => {
  const html = renderToStaticMarkup(
    createElement(MethodologyDialog, { dataset: "extended", open: true, onClose: () => {} }),
  );
  assert.match(html, /Line-specific tables/);
  assert.match(html, /Group Health/);
  assert.match(html, /Property remains the original eight-factor, 12-point model/);
  assert.doesNotMatch(html, /every other recognized line is out of scope/);
});
