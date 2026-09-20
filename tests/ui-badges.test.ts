import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "../components/ui/badge";
import { LaneBadge } from "../components/ui/lane-badge";
import { FlagChips } from "../components/ui/flag-chips";
import { Track } from "../components/ui/track";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("badge renders tone class and label", () => {
  const html = renderToStaticMarkup(createElement(Badge, { tone: "mint", children: "In good order" }));
  assert.match(html, /badge/);
  assert.match(html, /In good order/);
});

test("lane badge shows the lane label", () => {
  const html = renderToStaticMarkup(createElement(LaneBadge, { status: "needs_investigation" }));
  assert.match(html, /Needs evidence/);
  assert.match(html, /lane-chase-evidence/);
});

test("flag chips summarise factor tones", () => {
  const [submission] = rankSubmissions([empty]);
  const html = renderToStaticMarkup(createElement(FlagChips, { submission }));
  assert.match(html, /flag-chip/);
});

test("track renders a fill width", () => {
  const html = renderToStaticMarkup(createElement(Track, { value: 72, tone: "mint" }));
  assert.match(html, /width:\s*72%/);
});
