import type { FactorKey } from "@/lib/domain/types";
import type { ResolvedValue } from "@/lib/enrichment/provenance";
import type { ScenarioEntry } from "./scenario";
import { scenarioEntry } from "./scenario/pages";
import { synthesizeScenario } from "./synthesize";
import { CHANNEL_READING, foundMessage, type LiveConsolidationStep } from "./steps";

export type LiveConsolidationMode = "browserbase" | "fixture";
export type { LiveConsolidationStep };

export interface LiveConsolidationResult {
  submissionId: string;
  mode: LiveConsolidationMode;
  resolved: Partial<Record<FactorKey, ResolvedValue<number | string>>>;
  steps: LiveConsolidationStep[];
  liveViewUrl?: string;
  sessionId?: string;
  configured: boolean;
}

export function isBrowserbaseConfigured(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY?.trim() && process.env.BROWSERBASE_PROJECT_ID?.trim());
}

/** A curated scenario if one exists, otherwise deterministic synthetic channel data
 *  for the requested (unknown) fields. Either way the values are staged, never invented live. */
function resolveEntry(submissionId: string, requestedFields: FactorKey[]): ScenarioEntry | null {
  return scenarioEntry(submissionId) ?? synthesizeScenario(submissionId, requestedFields);
}

/** The offline path: replay the entry's channels as a browser-like trace with provenance. */
function fixtureResult(entry: ScenarioEntry, configured: boolean): LiveConsolidationResult {
  const asOf = new Date().toISOString().slice(0, 10);
  const resolved: Partial<Record<FactorKey, ResolvedValue<number | string>>> = {};
  const steps: LiveConsolidationStep[] = [{ channel: "summary", message: "Opening browser…", ok: true }];
  const seen = new Set<string>();
  for (const c of entry.channels) {
    if (!seen.has(c.channel)) {
      seen.add(c.channel);
      steps.push({ channel: c.channel, message: CHANNEL_READING[c.channel], ok: true });
    }
    resolved[c.field] = { value: c.value, provenance: { source: `broker ${c.channel}`, confidence: c.confidence, asOf } };
    steps.push({ channel: c.channel, message: foundMessage(c.field, c.value), ok: true });
  }
  return { submissionId: entry.submissionId, mode: "fixture", configured, resolved, steps };
}

/**
 * Consolidate a submission's scattered broker channels. When Browserbase credentials
 * exist, drives a real cloud browser (heavy deps loaded on demand so the default demo
 * path never bundles or evaluates them). Otherwise replays deterministic staged data —
 * curated where a scenario exists, synthesized from the unknown fields otherwise — so a
 * needs-evidence submission always produces a result instead of erroring.
 */
export async function runLiveConsolidation(
  submissionId: string,
  requestedFields: FactorKey[] = [],
): Promise<LiveConsolidationResult> {
  const entry = resolveEntry(submissionId, requestedFields);
  if (!entry) {
    return {
      submissionId,
      mode: "fixture",
      configured: isBrowserbaseConfigured(),
      resolved: {},
      steps: [{ channel: "summary", message: "No recoverable broker channels for this submission.", ok: false }],
    };
  }

  if (!isBrowserbaseConfigured()) return fixtureResult(entry, false);

  const { runBrowserbaseDriver } = await import("./browserbase-driver");
  return runBrowserbaseDriver(entry);
}
