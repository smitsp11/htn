import { demoSubmissions } from "@/lib/demo/submissions";
import { rankSubmissions } from "@/lib/domain/appetite";
import type {
  CanonicalSubmission,
  HazardProfile,
  QueryReasoning,
  RankedSubmission,
  RankingsResponse,
} from "@/lib/domain/types";
import { runQueryAgent } from "@/lib/federato/adapter";
import { FederatoClient } from "@/lib/federato/client";
import { loadOfflineEnrichment } from "@/lib/federato/offline-data";
import type { QueryPayload } from "@/lib/federato/query-compiler";
import { createReplaySource } from "@/lib/federato/replay";
import { summarize } from "./presentation";

/** What the pipeline needs back from the query agent, whichever executor ran it. */
export interface AgentOutput {
  submissions: CanonicalSubmission[];
  traceSummary: string[];
  reasoning?: QueryReasoning;
  totals?: { root?: number; queue?: number; assembled: number };
}

/** Every upstream capability is injected so the pipeline is testable offline. */
export interface RankingsPipelineDeps {
  useDemoData: boolean;
  demoSubmissions: CanonicalSubmission[];
  /**
   * "offline" replays the captured raw Federato snapshot through the agent;
   * "live" runs the same agent against Auth0 + the Federato API. Only the
   * executor differs: schema discovery, planning, querying and normalization
   * are the same code either way.
   */
  dataSource: "offline" | "live";
  /** Discover the schema, plan, query and normalize; the query agent. */
  runAgent: () => Promise<AgentOutput>;
  /**
   * When present, the pipeline attaches each submission's primary-location
   * hazard profile (`RankedSubmission.enrichment`) after ranking. Optional so
   * tests that inject their own deps (without enrichment) keep passing.
   */
  loadEnrichment?: () => Promise<Map<string, HazardProfile>>;
  rank: (submissions: CanonicalSubmission[]) => RankedSubmission[];
  now: () => Date;
}

/**
 * Wire the default pipeline. `FEDERATO_USE_DEMO_DATA` selects the data source:
 * - "true"  -> local demo fixtures;
 * - "false" -> explicit LIVE Federato (Auth0 + query API);
 * - unset   -> the captured raw Federato snapshot under raw/, replayed through
 *              the query agent (offline, default).
 */
export function defaultPipelineDeps(): RankingsPipelineDeps {
  const mode = process.env.FEDERATO_USE_DEMO_DATA;
  const useDemoData = mode === "true";
  const explicitLive = mode === "false";

  const runAgent = explicitLive
    ? async () => {
        const client = new FederatoClient();
        return runQueryAgent({
          discoverSchema: () => client.getSchema(),
          execute: (payload: QueryPayload) => client.query(payload),
        });
      }
    : async () => {
        const source = createReplaySource();
        return runQueryAgent({
          discoverSchema: source.discoverSchema,
          execute: source.execute,
        });
      };

  return {
    useDemoData,
    demoSubmissions,
    dataSource: explicitLive ? "live" : "offline",
    runAgent,
    loadEnrichment: useDemoData || explicitLive ? undefined : loadOfflineEnrichment,
    rank: rankSubmissions,
    now: () => new Date(),
  };
}

function rankingTrace(ranked: RankedSubmission[]): string[] {
  const summary = summarize(ranked);
  return [
    `Ranked ${summary.total} submissions: ${summary.in_appetite} in appetite, ${summary.needs_investigation} needs investigation, ${summary.out_of_appetite} out of appetite.`,
    `${summary.unresolved} of ${summary.total} submissions have unresolved appetite fields; unknowns never count as acceptable.`,
  ];
}

/**
 * Thin orchestration: run the query agent (discover schema, plan, query,
 * normalize), rank, attach enrichment. The route calls this and only
 * translates errors. Domain behaviour stays in the injected modules.
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

  const agent = await deps.runAgent();
  const ranked = deps.rank(agent.submissions);

  if (deps.loadEnrichment) {
    const hazards = await deps.loadEnrichment();
    for (const submission of ranked) {
      const hazard = hazards.get(submission.id);
      if (hazard) submission.enrichment = hazard;
    }
  }

  const sourceLine =
    deps.dataSource === "offline"
      ? "Replayed the captured raw Federato snapshot (raw/) through the query agent; no live Federato call was made."
      : "Queried the live Federato API through the query agent.";
  const countLine = `Query agent returned ${agent.submissions.length} canonical submissions${
    agent.totals?.root !== undefined ? ` (${agent.totals.root} with a policy, ${agent.totals.queue ?? "?"} in the queue)` : ""
  }.`;

  return {
    source: "federato",
    generatedAt,
    schemaDiscovered: true,
    trace: [sourceLine, ...agent.traceSummary, countLine, ...rankingTrace(ranked)],
    queryTrace: agent.reasoning,
    submissions: ranked,
  };
}
