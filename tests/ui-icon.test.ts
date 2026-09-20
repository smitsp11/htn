import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "../components/ui/icon";

test("renders an svg with the requested icon path", () => {
  const html = renderToStaticMarkup(createElement(Icon, { name: "search" }));
  assert.match(html, /<svg/);
  assert.match(html, /stroke-width="1.6"/);
});

test("renders the north-star brand glyph", () => {
  const html = renderToStaticMarkup(createElement(Icon, { name: "north-star" }));
  assert.match(html, /<svg/);
});
