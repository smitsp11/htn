import Browserbase from "@browserbasehq/sdk";
import { chromium, type Page } from "playwright-core";
import type { FactorKey } from "@/lib/domain/types";
import type { ResolvedValue } from "@/lib/enrichment/provenance";
import { ALL_SOURCES } from "./channel-source";
import { consolidateSubmission } from "./consolidate";
import type { ChannelName } from "./scenario";
import { buildChannelHtml, scenarioEntry } from "./scenario/pages";

export type LiveConsolidationMode = "browserbase" | "fixture";

export interface LiveConsolidationStep {
  channel: ChannelName | "summary";
  message: string;
  ok: boolean;
}

export interface LiveConsolidationResult {
  submissionId: string;
  mode: LiveConsolidationMode;
  resolved: Partial<Record<FactorKey, ResolvedValue<number | string>>>;
  steps: LiveConsolidationStep[];
  liveViewUrl?: string;
  sessionId?: string;
  configured: boolean;
}

const CHANNEL_READING: Record<ChannelName, string> = {
  email: "Reading email…",
  sov: "Reading SOV…",
  portal: "Reading portal…",
};

const FIELD_LABELS: Partial<Record<FactorKey, string>> = {
  totalPremium: "premium",
  fiveYearLossValue: "five-year losses",
  tiv: "TIV",
  buildingYear: "building year",
  submissionType: "submission type",
  primaryRiskState: "risk state",
  lineOfBusiness: "line of business",
  construction: "construction",
};

function formatFoundValue(value: number | string): string {
  if (typeof value === "number") {
    if (value >= 1000) {
      const compact = value >= 10_000
        ? `$${Math.round(value / 1000)}k`
        : new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(value);
      return compact;
    }
    if (value === 0) return "$0";
    return String(value);
  }
  return value;
}

function foundMessage(field: FactorKey, value: number | string): string {
  const label = FIELD_LABELS[field] ?? field;
  return `Found ${label}: ${formatFoundValue(value)}`;
}

export function isBrowserbaseConfigured(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY?.trim() && process.env.BROWSERBASE_PROJECT_ID?.trim());
}

function parseFieldValue(raw: string): number | string {
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const digits = trimmed.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(digits)) return Number(digits);
  return trimmed;
}

async function extractField(page: Page, field: FactorKey): Promise<number | string | null> {
  const locator = page.locator(`[data-field="${field}"]`);
  if ((await locator.count()) === 0) return null;
  const raw = (await locator.first().getAttribute("data-raw")) ?? (await locator.first().innerText());
  if (!raw?.trim()) return null;
  return parseFieldValue(raw);
}

/**
 * Live Browserbase consolidation: open a real cloud browser, load each seeded
 * channel page (email / SOV / portal), and read the held fields off the DOM.
 * Falls back to fixture sources when Browserbase credentials are absent.
 */
export async function runLiveConsolidation(submissionId: string): Promise<LiveConsolidationResult> {
  const entry = scenarioEntry(submissionId);
  if (!entry) {
    return {
      submissionId,
      mode: "fixture",
      configured: isBrowserbaseConfigured(),
      resolved: {},
      steps: [{ channel: "summary", message: "No broker-channel scenario for this submission.", ok: false }],
    };
  }

  const fields = [...new Set(entry.channels.map((c) => c.field))];
  const asOf = new Date().toISOString().slice(0, 10);

  if (!isBrowserbaseConfigured()) {
    const resolved = consolidateSubmission(submissionId, fields, ALL_SOURCES, asOf);
    const steps: LiveConsolidationStep[] = [
      { channel: "summary", message: "Opening browser…", ok: true },
    ];
    const seen = new Set<ChannelName>();
    for (const c of entry.channels) {
      if (!seen.has(c.channel)) {
        seen.add(c.channel);
        steps.push({ channel: c.channel, message: CHANNEL_READING[c.channel], ok: true });
      }
      steps.push({ channel: c.channel, message: foundMessage(c.field, c.value), ok: true });
    }
    return {
      submissionId,
      mode: "fixture",
      configured: false,
      resolved,
      steps,
    };
  }

  const apiKey = process.env.BROWSERBASE_API_KEY!.trim();
  const projectId = process.env.BROWSERBASE_PROJECT_ID!.trim();
  const client = new Browserbase({ apiKey });
  const session = await client.sessions.create({
    projectId,
    keepAlive: true,
    browserSettings: { viewport: { width: 1100, height: 720 } },
  });

  const steps: LiveConsolidationStep[] = [
    { channel: "summary", message: "Opening browser…", ok: true },
  ];
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
          steps.push({
            channel,
            message: `Could not find ${item.field} in ${channel}.`,
            ok: false,
          });
          continue;
        }
        resolved[item.field] = {
          value,
          provenance: {
            source: `broker ${channel} (live)`,
            confidence: item.confidence,
            asOf,
          },
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
    const fallback = consolidateSubmission(submissionId, fields, ALL_SOURCES, asOf);
    const live = await client.sessions.debug(session.id).catch(() => null);
    await client.sessions
      .update(session.id, { status: "REQUEST_RELEASE", projectId })
      .catch(() => {});
    return {
      submissionId,
      mode: "fixture",
      configured: true,
      resolved: fallback,
      steps: [
        { channel: "summary", message: `Live browser unavailable (${message}). Using channel fixtures.`, ok: false },
      ],
      sessionId: session.id,
      liveViewUrl: live?.debuggerFullscreenUrl ?? live?.debuggerUrl,
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
