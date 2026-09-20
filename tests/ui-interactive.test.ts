import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Tabs } from "../components/ui/tabs";
import { Dialog } from "../components/ui/dialog";

test("tabs render an ARIA tablist with the active tab selected", () => {
  const html = renderToStaticMarkup(
    createElement(Tabs, {
      tabs: [
        { id: "a", label: "Review", count: 3 },
        { id: "b", label: "Property" },
      ],
      active: "a",
      onChange: () => {},
    }),
  );
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true"[^>]*>\s*Review/);
  assert.match(html, /3/);
});

test("closed dialog renders nothing", () => {
  const html = renderToStaticMarkup(
    createElement(Dialog, { open: false, onClose: () => {}, children: "hi" }),
  );
  assert.equal(html, "");
});

test("open dialog renders its children and a backdrop", () => {
  const html = renderToStaticMarkup(
    createElement(Dialog, { open: true, onClose: () => {}, children: "hello world" }),
  );
  assert.match(html, /hello world/);
  assert.match(html, /dialog-backdrop/);
});
