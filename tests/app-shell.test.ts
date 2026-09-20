import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "../components/app-shell";

test("initial render shows a loading state before data arrives", () => {
  const html = renderToStaticMarkup(createElement(AppShell, {}));
  assert.match(html, /Evaluating|Loading|queue/i);
});
