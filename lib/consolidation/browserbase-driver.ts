import Browserbase from "@browserbasehq/sdk";
import { chromium, type Page } from "playwright-core";
import type { FactorKey } from "@/lib/domain/types";
import type { ResolvedValue } from "@/lib/enrichment/provenance";
import type { ScenarioEntry } from "./scenario";
import { buildChannelHtml } from "./scenario/pages";
import { CHANNEL_READING, foundMessage, parseFieldValue, type LiveConsolidationStep } from "./steps";
import type { LiveConsolidationResult } from "./browserbase-live";

async function extractField(page: Page, field: FactorKey): Promise<number | string | null> {
  const locator = page.locator(`[data-field="${field}"]`);
  if ((await locator.count()) === 0) return null;
  const raw = (await locator.first().getAttribute("data-raw")) ?? (await locator.first().innerText());
  if (!raw?.trim()) return null;
  return parseFieldValue(raw);
}

/** Build channel provenance straight from the seeded entry — the fixture fallback. */
function resolvedFromEntry(entry: ScenarioEntry, asOf: string): Partial<Record<FactorKey, ResolvedValue<number | string>>> {
  const resolved: Partial<Record<FactorKey, ResolvedValue<number | string>>> = {};
  for (const c of entry.channels) {
    resolved[c.field] = { value: c.value, provenance: { source: `broker ${c.channel}`, confidence: c.confidence, asOf } };
  }
  return resolved;
}

/**
 * Live Browserbase consolidation: open a real cloud browser, load each seeded channel
 * page (email / SOV / portal), and read the held fields off the DOM. Only called when
 * credentials are configured; the heavy playwright/Browserbase imports load with it.
 * Falls back to the entry's own values if the live browser is unavailable.
 */
export async function runBrowserbaseDriver(entry: ScenarioEntry): Promise<LiveConsolidationResult> {
  const submissionId = entry.submissionId;
  const asOf = new Date().toISOString().slice(0, 10);
  const apiKey = process.env.BROWSERBASE_API_KEY!.trim();
  const projectId = process.env.BROWSERBASE_PROJECT_ID!.trim();
  const client = new Browserbase({ apiKey });
  const session = await client.sessions.create({
    projectId,
    keepAlive: true,
    browserSettings: { viewport: { width: 1100, height: 720 } },
  });

  const steps: LiveConsolidationStep[] = [{ channel: "summary", message: "Opening browser…", ok: true }];
  const resolved: Partial<Record<FactorKey, ResolvedValue<number | string>>> = {};
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;

  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    const channels = [...new Set(entry.channels.map((c) => c.channel))];
    for (const channel of channels) {
      const html = buildChannelHtml(entry, channel);
      if (!html) continue;
      steps.push({ channel, message: CHANNEL_READING[channel], ok: true });
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      const held = entry.channels.filter((c) => c.channel === channel);
      for (const item of held) {
        const value = await extractField(page, item.field);
        if (value === null) {
          steps.push({ channel, message: `Could not find ${item.field} in ${channel}.`, ok: false });
          continue;
        }
        resolved[item.field] = {
          value,
          provenance: { source: `broker ${channel} (live)`, confidence: item.confidence, asOf },
        };
        steps.push({ channel, message: foundMessage(item.field, value), ok: true });
      }
    }

    const live = await client.sessions.debug(session.id).catch(() => null);
    return {
      submissionId,
      mode: "browserbase",
      configured: true,
      resolved,
      steps,
      liveViewUrl: live?.debuggerFullscreenUrl ?? live?.debuggerUrl,
      sessionId: session.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browserbase consolidation failed.";
    const live = await client.sessions.debug(session.id).catch(() => null);
    await client.sessions.update(session.id, { status: "REQUEST_RELEASE", projectId }).catch(() => {});
    return {
      submissionId,
      mode: "fixture",
      configured: true,
      resolved: resolvedFromEntry(entry, asOf),
      steps: [{ channel: "summary", message: `Live browser unavailable (${message}). Using channel fixtures.`, ok: false }],
      sessionId: session.id,
      liveViewUrl: live?.debuggerFullscreenUrl ?? live?.debuggerUrl,
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
