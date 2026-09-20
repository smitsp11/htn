import { syntheticPropertySubmissions } from "@/lib/demo/synthetic-property";
import { demoSubmissions } from "@/lib/demo/submissions";
import { rankSubmissions } from "@/lib/domain/appetite";
import type {
  ActualOutcome,
  CanonicalSubmission,
  ContextSignal,
  Dataset,
  HazardProfile,
  QueryReasoning,
  RankedSubmission,
  RankingsResponse,
} from "@/lib/domain/types";
import { loadOfflineContext } from "@/lib/enrichment/context";
import { loadConsolidationIndex } from "@/lib/enrichment/consolidation-index";
import { buildResolution } from "@/lib/enrichment/resolution-result";
import type { ConsolidationIndex } from "@/lib/enrichment/resolve-submission";
import { runQueryAgent, type FollowUpResult } from "@/lib/federato/adapter";
import type { FollowUpGap } from "@/lib/federato/follow-up";
import { FederatoClient } from "@/lib/federato/client";
import { loadOfflineEnrichment, loadOfflineOutcomes } from "@/lib/federato/offline-data";
import type { QueryPayload } from "@/lib/federato/query-compiler";
import { createReplaySource } from "@/lib/federato/replay";
import { diffRankings, selectFollowUpTargets } from "./follow-up-targets";
import { portfolioTrace } from "./portfolio-insights";
import { summarize } from "./presentation";

/** What the pipeline needs back from the query agent, whichever executor ran it. */
export interface AgentOutput {
  submissions: CanonicalSubmission[];
  traceSummary: string[];
  reasoning?: QueryReasoning;
  totals?: { root?: number; queue?: number; assembled: number };
  /**
   * The adaptive second pass, when the agent offers one. The pipeline hands
   * it the factors the first ranking could not settle and re-ranks whatever
   * comes back. Optional so injected test agents without it keep working.
   */
  followUp?: (gaps: FollowUpGap[]) => Promise<FollowUpResult>;
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
  /**
   * When present, the pipeline attaches each submission's actual historical
   * disposition (`RankedSubmission.actualOutcome`) after ranking. Read-only
   * context only, mirroring `loadEnrichment`; never seen by the appetite engine.
   */
  loadOutcomes?: () => Promise<Map<string, ActualOutcome>>;
  /**
   * When present, attaches public-data context signals (`RankedSubmission.context`)
   * after ranking. Context never enters appetite scoring.
   */
  loadContext?: () => Promise<Map<string, ContextSignal[]>>;
  /**
   * When present, resolves each submission's absent required fields from the
   * consolidation index and attaches a before/after re-score
   * (`RankedSubmission.resolution`). Mirrors the other optional loaders
   * (offline only); it never changes the queue's own status or score.
   */
  loadConsolidation?: () => Promise<ConsolidationIndex>;
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
export function defaultPipelineDeps(dataset: Dataset = "baseline"): RankingsPipelineDeps {
  const mode = process.env.FEDERATO_USE_DEMO_DATA;
  const useDemoData = mode === "true";
  const explicitLive = mode === "false";
  const extended = dataset === "extended";

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
    loadOutcomes: useDemoData || explicitLive ? undefined : loadOfflineOutcomes,
    loadContext: useDemoData || explicitLive ? undefined : async () => loadOfflineContext(),
    loadConsolidation: useDemoData || explicitLive ? undefined : async () => loadConsolidationIndex(),
    rank: (s) => rankSubmissions(s, { extended }),
    now: () => new Date(),
  };
}

function rankingTrace(ranked: RankedSubmission[]): string[] {
  const summary = summarize(ranked);
  return [
    `Ranked ${summary.total} submissions: ${summary.in_appetite} in appetite, ${summary.needs_investigation} needs investigation, ${summary.out_of_appetite} out of appetite.`,
    `${summary.unresolved} of ${summary.total} submissions have unresolved appetite fields; unknowns never count as acceptable.`,
    ...portfolioTrace(ranked),
  ];
}

/**
 * Thin orchestration: run the query agent (discover schema, plan, query,
 * normalize), rank, attach enrichment. The route calls this and only
 * translates errors. Domain behaviour stays in the injected modules.
 */
export async function buildRankings(
  deps: RankingsPipelineDeps,
  options: { dataset?: Dataset } = {},
): Promise<RankingsResponse> {
  const generatedAt = deps.now().toISOString();
  const dataset = options.dataset ?? "baseline";
  const extended = dataset === "extended";
  const synthetic = extended ? syntheticPropertySubmissions() : [];
  const syntheticIds = new Set(synthetic.map((s) => s.id));

  if (deps.useDemoData) {
    const ranked = deps.rank([...deps.demoSubmissions, ...synthetic]);
    for (const submission of ranked) if (syntheticIds.has(submission.id)) submission.synthetic = true;
    return {
      source: "demo",
      dataset,
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
  const firstPass = deps.rank([...agent.submissions, ...synthetic]);

  // Adaptive second pass: the rows the check could not decide, or narrowly
  // rejected, go back to the agent with the factor that is missing. Whatever
  // it resolves is re-ranked by the same deterministic engine; the agent
  // never touches a verdict itself. Synthetic rows never go back to the agent.
  let ranked = firstPass;
  let reasoning = agent.reasoning;
  const followUpLines: string[] = [];
  const gaps = agent.followUp ? selectFollowUpTargets(firstPass.filter((s) => !syntheticIds.has(s.id))) : [];
  if (agent.followUp && gaps.length > 0) {
    const round = await agent.followUp(gaps);
    ranked = deps.rank([...round.submissions, ...synthetic]);
    reasoning = round.reasoning;
    const delta = diffRankings(firstPass, ranked);
    followUpLines.push(
      ...round.traceSummary,
      `Second pass: ${round.queries} follow-up quer${round.queries === 1 ? "y" : "ies"} for ${new Set(gaps.map((gap) => gap.submissionId)).size} undecided or borderline submission(s); ${round.updated.length} updated, ${delta.statusChanged.length} changed status${
        delta.statusChanged.length ? ` (${delta.statusChanged.join(", ")})` : ""
      }, ${delta.scoreChanged.length} changed score only.`,
    );
  } else if (agent.followUp) {
    followUpLines.push("Second pass: every submission was decided by the first query; no follow-up was needed.");
  }
  for (const s of ranked) if (syntheticIds.has(s.id)) s.synthetic = true;

  if (deps.loadEnrichment) {
    const hazards = await deps.loadEnrichment();
    for (const submission of ranked) {
      const hazard = hazards.get(submission.id);
      if (hazard) submission.enrichment = hazard;
    }
  }

  if (deps.loadOutcomes) {
    const outcomes = await deps.loadOutcomes();
    for (const submission of ranked) {
      const outcome = outcomes.get(submission.id);
      if (outcome) submission.actualOutcome = outcome;
    }
  }

  if (deps.loadContext) {
    const context = await deps.loadContext();
    for (const submission of ranked) {
      const signals = context.get(submission.id);
      if (signals && signals.length) submission.context = signals;
    }
  }

  if (deps.loadConsolidation) {
    const index = await deps.loadConsolidation();
    for (const submission of ranked) {
      const resolution = buildResolution(submission, index, extended);
      if (resolution) submission.resolution = resolution;
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
    dataset,
    generatedAt,
    schemaDiscovered: true,
    trace: [sourceLine, ...agent.traceSummary, countLine, ...followUpLines, ...rankingTrace(ranked)],
    queryTrace: reasoning,
    submissions: ranked,
  };
}
