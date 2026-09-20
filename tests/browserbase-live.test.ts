import assert from "node:assert/strict";
import test from "node:test";
import { isBrowserbaseConfigured, runLiveConsolidation } from "../lib/consolidation/browserbase-live";
import { buildChannelHtml, scenarioEntry } from "../lib/consolidation/scenario/pages";
import { SCENARIO } from "../lib/consolidation/scenario";

test("scenario pages embed data-field markers for every held value", () => {
  const entry = SCENARIO[0];
  const html = buildChannelHtml(entry, entry.channels[0].channel);
  assert.ok(html);
  assert.match(html!, new RegExp(`data-field="${entry.channels[0].field}"`));
  assert.match(html!, new RegExp(`data-raw="${entry.channels[0].value}"`));
});

test("unknown submission has no scenario entry", () => {
  assert.equal(scenarioEntry("does-not-exist"), undefined);
});

test("fixture path runs without Browserbase credentials", async () => {
  const prevKey = process.env.BROWSERBASE_API_KEY;
  const prevProject = process.env.BROWSERBASE_PROJECT_ID;
  delete process.env.BROWSERBASE_API_KEY;
  delete process.env.BROWSERBASE_PROJECT_ID;
  try {
    assert.equal(isBrowserbaseConfigured(), false);
    const result = await runLiveConsolidation(SCENARIO[0].submissionId);
    assert.equal(result.mode, "fixture");
    assert.ok(Object.keys(result.resolved).length >= 1);
    assert.ok(result.steps.length >= 1);
  } finally {
    if (prevKey !== undefined) process.env.BROWSERBASE_API_KEY = prevKey;
    else delete process.env.BROWSERBASE_API_KEY;
    if (prevProject !== undefined) process.env.BROWSERBASE_PROJECT_ID = prevProject;
    else delete process.env.BROWSERBASE_PROJECT_ID;
  }
});
