import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScopeSwitch } from "../components/queue/scope-switch";
import { LaneTabs } from "../components/queue/lane-tabs";
import { Pagination } from "../components/queue/pagination";

test("scope switch marks the active scope", () => {
  const html = renderToStaticMarkup(
    createElement(ScopeSwitch, { value: "property", onChange: () => {} }),
  );
  assert.match(html, /Commercial property/);
  assert.match(html, /aria-pressed="true"/);
});

test("lane tabs render counts per lane", () => {
  const html = renderToStaticMarkup(
    createElement(LaneTabs, {
      counts: { "work-now": 4, "chase-evidence": 2, declined: 1, "not-property": 0 },
      active: "work-now",
      onChange: () => {},
    }),
  );
  assert.match(html, /Ready for review/);
  assert.match(html, /Needs evidence/);
});

test("pagination shows the page label", () => {
  const html = renderToStaticMarkup(
    createElement(Pagination, { page: 1, pageCount: 3, pageSize: 10, total: 25, onPage: () => {}, onPageSize: () => {} }),
  );
  assert.match(html, /1[^0-9]+3/);
});
