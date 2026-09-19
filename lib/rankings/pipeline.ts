import { demoSubmissions } from "@/lib/demo/submissions";
import { rankSubmissions } from "@/lib/domain/appetite";
import type { CanonicalSubmission, RankedSubmission, RankingsResponse } from "@/lib/domain/types";
import { buildQueryPayload, normalizeQueryResponse } from "@/lib/federato/adapter";
import { FederatoClient } from "@/lib/federato/client";
import { summarize } from "./presentation";

/** Every upstream capability is injected so the pipeline is testable offline. */
export interface RankingsPipelineDeps {
  useDemoData: boolean;
  demoSubmissions: CanonicalSubmission[];
  getSchema: () => Promise<unknown>;
  buildQueryPayload: (schema: unknown) => unknown;
  query: (payload: unknown) => Promise<unknown>;
  normalize: (raw: unknown) => CanonicalSubmission[];
  rank: (submissions: CanonicalSubmission[]) => RankedSubmission[];
  now: () => Date;
}

export function defaultPipelineDeps(): RankingsPipelineDeps {
  const client = new FederatoClient();
  return {
    useDemoData: process.env.FEDERATO_USE_DEMO_DATA !== "false",
    demoSubmissions,
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
