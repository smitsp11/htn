import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_SOURCES } from "../lib/consolidation/channel-source";
import { consolidateSubmission } from "../lib/consolidation/consolidate";
import { rankSubmissions } from "../lib/domain/appetite";
import type { FactorKey } from "../lib/domain/types";
import type { ResolvedValue } from "../lib/enrichment/provenance";
import { runQueryAgent } from "../lib/federato/adapter";
import { createReplaySource } from "../lib/federato/replay";
import { completenessOf } from "../lib/rankings/completeness";

/** The offline canonical submissions, replayed through the query agent — the
 *  same path the pipeline uses in offline mode (loadOfflineSubmissions was
 *  retired in favour of the replay source). */
async function loadOfflineSubmissions() {
  const source = createReplaySource();
  const { submissions } = await runQueryAgent({
    discoverSchema: source.discoverSchema,
    execute: source.execute,
  });
  return submissions;
}

export type ConsolidationIndex = Record<
  string,
  Partial<Record<FactorKey, ResolvedValue<number | string>>>
>;

async function main() {
  const ranked = rankSubmissions(await loadOfflineSubmissions());
  const out: ConsolidationIndex = {};
  const asOf = new Date().toISOString().slice(0, 10);
  for (const s of ranked) {
    const absent = completenessOf(s).absent;
    if (absent.length === 0) continue;
    const resolved = consolidateSubmission(s.id, absent, ALL_SOURCES, asOf);
    if (Object.keys(resolved).length > 0) out[s.id] = resolved;
  }
  const path = join(process.cwd(), "raw", "consolidation.json");
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  console.log(`consolidation.json written for ${Object.keys(out).length} submissions → ${path}`);
}

void main();
