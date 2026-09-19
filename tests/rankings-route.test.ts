import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import type { CanonicalSubmission } from "../lib/domain/types";
import { categorizeError, httpStatusFor } from "../lib/rankings/errors";
import { buildRankings, type RankingsPipelineDeps } from "../lib/rankings/pipeline";
import { primaryReason, summarize } from "../lib/rankings/presentation";
import { contradictory, empty, fullTarget, missingLosses } from "./fixtures/domain/submissions";
import { rankedContradictory, rankedEmpty, rankedFixtures, rankedTarget } from "./fixtures/rankings/responses";

function deps(overrides: Partial<RankingsPipelineDeps> = {}) {
  const calls: string[] = [];
  const base: RankingsPipelineDeps = {
    useDemoData: false,
    demoSubmissions: [fullTarget],
    getSchema: async () => {
      calls.push("schema");
      return { resources: ["submission"] };
    },
    buildQueryPayload: (schema) => {
      calls.push("plan");
      return { schema };
    },
    query: async () => {
      calls.push("query");
      return { data: [{ id: "raw-1" }, { id: "raw-2" }] };
    },
    normalize: () => {
      calls.push("normalize");
      return [contradictory, fullTarget];
    },
    rank: (submissions: CanonicalSubmission[]) => {
      calls.push("rank");
      return rankSubmissions(submissions);
    },
    now: () => new Date("2026-09-19T12:00:00.000Z"),
    ...overrides,
  };
  return { deps: base, calls };
}

test("pipeline: demo mode ranks fixtures without calling Federato", async () => {
  const { deps: d, calls } = deps({ useDemoData: true, demoSubmissions: [contradictory, fullTarget] });
  const result = await buildRankings(d);
  assert.equal(result.source, "demo");
  assert.equal(result.schemaDiscovered, false);
  assert.equal(result.generatedAt, "2026-09-19T12:00:00.000Z");
  assert.deepEqual(result.submissions.map((item) => item.id), ["fx-target", "fx-contradictory"]);
  assert.deepEqual(calls, ["rank"]);
  assert.ok(result.trace.some((line) => /demo fixtures/i.test(line)));
});

test("pipeline: live mode discovers schema before planning and querying", async () => {
  const { deps: d, calls } = deps();
  const result = await buildRankings(d);
  assert.deepEqual(calls, ["schema", "plan", "query", "normalize", "rank"]);
  assert.equal(result.source, "federato");
  assert.equal(result.schemaDiscovered, true);
  assert.equal(result.submissions.length, 2);
});

test("pipeline: trace reports counts and unresolved-data diagnostics", async () => {
  const { deps: d } = deps({ normalize: () => [contradictory, fullTarget, missingLosses] });
  const result = await buildRankings(d);
  assert.ok(result.trace.some((line) => /3 canonical submissions/.test(line)), result.trace.join("\n"));
  assert.ok(result.trace.some((line) => /1 in appetite, 1 needs investigation, 1 out of appetite/.test(line)), result.trace.join("\n"));
  assert.ok(result.trace.some((line) => /1 of 3 submissions ha(s|ve) unresolved appetite fields/.test(line)), result.trace.join("\n"));
});

test("pipeline: empty live result is returned, not treated as an error", async () => {
  const { deps: d } = deps({ query: async () => ({ data: [] }), normalize: () => [] });
  const result = await buildRankings(d);
  assert.deepEqual(result.submissions, []);
  assert.ok(result.trace.some((line) => /0 canonical submissions/.test(line)));
});

test("pipeline: upstream failures propagate to the caller", async () => {
  const { deps: d } = deps({ getSchema: async () => { throw new Error("Federato authentication failed (401)."); } });
  await assert.rejects(buildRankings(d), /authentication failed/);
});

test("errors: authentication problems are categorised as auth", () => {
  assert.equal(categorizeError(new Error("Federato authentication failed (401). Check the Auth0 domain.")).category, "auth");
  assert.equal(categorizeError(new Error("FEDERATO_CLIENT_SECRET is required when demo mode is disabled.")).category, "auth");
  assert.equal(categorizeError(new Error("Federato authentication returned no access token.")).category, "auth");
});

test("errors: missing or malformed configuration is categorised as configuration", () => {
  assert.equal(categorizeError(new Error("FEDERATO_QUERY_PAYLOAD_JSON is required for live mode.")).category, "configuration");
  assert.equal(categorizeError(new Error("FEDERATO_FIELD_MAP_JSON is not valid JSON.")).category, "configuration");
});

test("errors: API request failures are categorised as query", () => {
  assert.equal(categorizeError(new Error("Federato API request failed (500): boom")).category, "query");
});

test("errors: non-Error values become an unknown category with a safe message", () => {
  const body = categorizeError("weird");
  assert.equal(body.category, "unknown");
  assert.equal(body.error, "Unknown ranking failure");
});

test("errors: HTTP status follows the category", () => {
  assert.equal(httpStatusFor("auth"), 401);
  assert.equal(httpStatusFor("configuration"), 500);
  assert.equal(httpStatusFor("query"), 502);
  assert.equal(httpStatusFor("unknown"), 500);
});

test("presentation: primary reason surfaces the failing factor first", () => {
  assert.equal(primaryReason(rankedContradictory), "Renewal business is not acceptable.");
});

test("presentation: primary reason falls back to unknown, then target, then acceptable", () => {
  assert.match(primaryReason(rankedEmpty), /Submission type is missing/);
  assert.equal(primaryReason(rankedTarget), "CA is a target state.");
  const acceptable = rankSubmissions([{ ...fullTarget, primaryRiskState: "UT", tiv: 10_000_000, totalPremium: 60_000, buildingYear: 2000 }])[0];
  assert.equal(primaryReason(acceptable), "All eight factors are acceptable.");
});

test("presentation: summary counts statuses and unresolved submissions", () => {
  const summary = summarize(rankedFixtures);
  assert.deepEqual(summary, {
    total: 6,
    in_appetite: 2,
    needs_investigation: 2,
    out_of_appetite: 2,
    unresolved: 3,
  });
  assert.deepEqual(summarize([]), { total: 0, in_appetite: 0, needs_investigation: 0, out_of_appetite: 0, unresolved: 0 });
});

test("route: GET returns ranked demo submissions", async () => {
  process.env.FEDERATO_USE_DEMO_DATA = "true";
  const { GET } = await import("../app/api/rankings/route");
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, "demo");
  assert.ok(Array.isArray(body.submissions) && body.submissions.length > 0);
  assert.ok(body.submissions.every((item: { factors: unknown[] }) => item.factors.length === 8));
});

test("route: GET maps live-mode failures to a categorised error body", async () => {
  process.env.FEDERATO_USE_DEMO_DATA = "false";
  delete process.env.FEDERATO_CLIENT_ID;
  delete process.env.FEDERATO_CLIENT_SECRET;
  const { GET } = await import("../app/api/rankings/route");
  const res = await GET();
  process.env.FEDERATO_USE_DEMO_DATA = "true";
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.category, "auth");
  assert.match(body.error, /FEDERATO_CLIENT_ID/);
  assert.doesNotMatch(JSON.stringify(body), /secret/i);
});

void empty;
