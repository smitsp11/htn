import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchBar } from "../components/queue/search-bar";

test("renders a search input with the slash hint", () => {
  const html = renderToStaticMarkup(createElement(SearchBar, { onResult: () => {} }));
  assert.match(html, /<input/);
  assert.match(html, /<kbd[^>]*>\/<\/kbd>/);
});
