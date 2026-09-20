import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchBar } from "../components/queue/search-bar";

test("renders a search input and the Ask action, with no Clear button at rest", () => {
  const html = renderToStaticMarkup(createElement(SearchBar, { onResult: () => {} }));
  assert.match(html, /<input/);
  assert.match(html, /Ask/);
  // Clear only appears once there is a query or answer, so it is absent at rest.
  assert.doesNotMatch(html, /search-clear/);
});
