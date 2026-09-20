import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteShell } from "../components/shell/site-shell";
import { Hero } from "../components/shell/hero";

test("header renders the Federanorth wordmark", () => {
  const html = renderToStaticMarkup(createElement(SiteShell, { children: "content" }));
  assert.match(html, /FEDERANORTH/);
  assert.match(html, /content/);
});

test("hero renders the headline, CTA, and dithered map canvas", () => {
  const html = renderToStaticMarkup(createElement(Hero, {}));
  assert.match(html, /A clearer view/);
  assert.match(html, /Explore your queue/);
  assert.match(html, /hero-map-canvas/);
});
