import { demoSubmissions } from "@/lib/demo/submissions";
import { rankSubmissions } from "@/lib/domain/appetite";
import type { CanonicalSubmission, HazardProfile, RankedSubmission, RankingsResponse } from "@/lib/domain/types";
import { buildQueryPayload, normalizeQueryResponse } from "@/lib/federato/adapter";
import { FederatoClient } from "@/lib/federato/client";
import { loadOfflineEnrichment, loadOfflineSubmissions } from "@/lib/federato/offline-data";
import { summarize } from "./presentation";

/** Every upstream capability is injected so the pipeline is testable offline. */
export interface RankingsPipelineDeps {
  useDemoData: boolean;
  demoSubmissions: CanonicalSubmission[];
  /**
   * When present (and demo mode is off) the pipeline serves the captured raw
   * Federato snapshot instead of calling the live API. `defaultPipelineDeps`
   * wires this whenever the engineer has not explicitly forced demo or live mode.
   */
  loadOfflineData?: () => Promise<CanonicalSubmission[]>;
  /**
   * When present, the offline branch attaches each submission's primary-location
   * hazard profile (`RankedSubmission.enrichment`) after ranking. Optional so
   * tests that inject their own deps (without enrichment) keep passing.
   */
  loadEnrichment?: () => Promise<Map<string, HazardProfile>>;
  getSchema: () => Promise<unknown>;
  buildQueryPayload: (schema: unknown) => unknown;
  query: (payload: unknown) => Promise<unknown>;
  normalize: (raw: unknown) => CanonicalSubmission[];
  rank: (submissions: CanonicalSubmission[]) => RankedSubmission[];
  now: () => Date;
}

/**
 * Wire the default pipeline. `FEDERATO_USE_DEMO_DATA` selects the data source:
 * - "true"  -> local demo fixtures;
 * - "false" -> explicit LIVE Federato (Auth0 + query API);
 * - unset   -> the captured raw Federato snapshot under raw/ (offline, default).
 */
export function defaultPipelineDeps(): RankingsPipelineDeps {
  const client = new FederatoClient();
  const mode = process.env.FEDERATO_USE_DEMO_DATA;
  const useDemoData = mode === "true";
  const explicitLive = mode === "false";
  return {
    useDemoData,
    demoSubmissions,
    loadOfflineData: useDemoData || explicitLive ? undefined : loadOfflineSubmissions,
    loadEnrichment: useDemoData || explicitLive ? undefined : loadOfflineEnrichment,
    getSchema: () => client.getSchema(),
    buildQueryPayload,
    query: (payload) => client.query(payload),
    normalize: normalizeQueryResponse,
    rank: rankSubmissions,
    now: () => new Date(),
  };
}

function countRows(raw: unknown): number | undefined {
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === "object" && raw !== null) {
    for (const key of ["data", "results", "items", "records"]) {
      const candidate = (raw as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate.length;
    }
  }
  return undefined;
}

function rankingTrace(ranked: RankedSubmission[]): string[] {
  const summary = summarize(ranked);
  return [
    `Ranked ${summary.total} submissions: ${summary.in_appetite} in appetite, ${summary.needs_investigation} needs investigation, ${summary.out_of_appetite} out of appetite.`,
    `${summary.unresolved} of ${summary.total} submissions have unresolved appetite fields; unknowns never count as acceptable.`,
  ];
}

/**
 * Thin orchestration: discover schema, plan, query, normalize, rank. The
 * route calls this and only translates errors. Domain behaviour stays in the
 * injected modules.
 */
export async function buildRankings(deps: RankingsPipelineDeps): Promise<RankingsResponse> {
  const generatedAt = deps.now().toISOString();

  if (deps.useDemoData) {
    const ranked = deps.rank(deps.demoSubmissions);
    return {
      source: "demo",
      generatedAt,
      schemaDiscovered: false,
      trace: [
        "Using local demo fixtures; no Federato call was made.",
        "The scoring and UI paths are the same paths used for live submissions.",
        ...rankingTrace(ranked),
      ],
      submissions: ranked,
    };
  }

  if (deps.loadOfflineData) {
    // Offline: serve the captured raw Federato snapshot (raw/full_*.json). The
    // records are normalized through the same adapter and scored through the same
    // appetite engine as a live query, so the source is reported as "federato".
    const ranked = deps.rank(await deps.loadOfflineData());
    if (deps.loadEnrichment) {
      const hazards = await deps.loadEnrichment();
      for (const s of ranked) {
        const h = hazards.get(s.id);
        if (h) s.enrichment = h;
      }
    }
    return {
      source: "federato",
      generatedAt,
      schemaDiscovered: true,
      trace: [
        "Loaded submissions from the captured raw Federato snapshot (raw/full_*.json); no live Federato call was made.",
        "Schema discovery ran when the snapshot was captured; records use the real Federato resource and field names.",
        ...rankingTrace(ranked),
      ],
      submissions: ranked,
    };
  }

  const trace: string[] = [];
  const schema = await deps.getSchema();
  trace.push("Discovered the schema before constructing the production query.");
  const payload = deps.buildQueryPayload(schema);
  trace.push("Built the query payload for the eight appetite factors from the discovered schema.");
  const raw = await deps.query(payload);
  const submissions = deps.normalize(raw);
  const rawCount = countRows(raw);
  trace.push(
    `Query returned ${rawCount === undefined ? "an unrecognised shape" : `${rawCount} raw records`}; normalized ${submissions.length} canonical submissions.`,
  );
  const ranked = deps.rank(submissions);
  trace.push(...rankingTrace(ranked));

  return {
    source: "federato",
    generatedAt,
    schemaDiscovered: true,
    trace,
    submissions: ranked,
  };
}
