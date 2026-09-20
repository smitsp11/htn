import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalSubmission } from "../lib/domain/types";
import { runQueryAgent } from "../lib/federato/adapter";
import { assembleSubmissions } from "../lib/federato/assemble";
import { createReplaySource } from "../lib/federato/replay";
import { createTrace } from "../lib/federato/query-trace";
import { runQuery } from "../lib/federato/query-executor";
import { extractRows, extractTotal } from "../lib/federato/response";
import { buildSchemaIndex } from "../lib/federato/schema-index";
import { planFromSchema, planQueueResource } from "../lib/federato/schema-planner";
import { agentSchema } from "./fixtures/federato/agent-schema";
import {
  bareQueueRow,
  boundPolicyRow,
  boundQueueRow,
  fleetPolicyRow,
  fleetQueueRow,
  malformedPolicyRow,
  unboundQueueRow,
} from "./fixtures/federato/agent-records";

const CANONICAL_KEYS: (keyof CanonicalSubmission)[] = [
  "id",
  "accountName",
  "submissionType",
  "lineOfBusiness",
  "primaryRiskState",
  "effectiveDate",
  "expirationDate",
  "tiv",
  "totalPremium",
  "buildingYear",
  "approvedConstructionPercentage",
  "constructionDescription",
  "fiveYearLossValue",
  "buildingSchedule",
  "derivations",
];

/* ---------------------------------------------------------------------- */
/* Assembly rules, on hand-built rows in the shape the root query returns.  */
/* ---------------------------------------------------------------------- */

const index = buildSchemaIndex(agentSchema);
const plan = planFromSchema(index, createTrace());
const queuePlan = planQueueResource(index, plan, createTrace());

function assemble(rootRows: unknown[], queueRows: unknown[] = []) {
  return assembleSubmissions({
    plan,
    queuePlan,
    rootRows: rootRows as Record<string, unknown>[],
    queueRows: queueRows as Record<string, unknown>[],
  });
}

test("a bound policy is assembled with every documented aggregation", () => {
  const [entry] = assemble([boundPolicyRow], [boundQueueRow]);
  const submission = entry.submission;
  assert.equal(submission.id, "SUB-2025-00001", "the queue record's number identifies the row");
  assert.equal(submission.accountName, "Harbor Point Retail LLC");
  assert.equal(submission.submissionType, "new");
  assert.equal(submission.lineOfBusiness, "property");
  assert.equal(submission.effectiveDate, "2025-10-01");
  assert.equal(submission.expirationDate, "2026-10-01");
  assert.equal(submission.totalPremium, 619_900, "target premium is a lookalike and must lose");
  // TIV: 30M + 6M (FL, counted once) + 4M (AZ).
  assert.equal(submission.tiv, 40_000_000);
  assert.equal(submission.buildingYear, 1974);
  // Approved construction: (6M JM + 4M NC) / 40M.
  assert.equal(submission.approvedConstructionPercentage, 0.25);
  assert.equal(submission.constructionDescription, "Frame, Joisted Masonry, Non-Combustible");
  // Losses: only the 2025 claim; 2026 is after the window, 2019 is before it; reserves are not paid.
  assert.equal(submission.fiveYearLossValue, 228_700);
});

test("exposure units that share a location do not count its buildings twice", () => {
  const [entry] = assemble([boundPolicyRow]);
  assert.equal(entry.submission.tiv, 40_000_000);
  assert.equal(entry.undedupedTiv, 76_000_000, "the server-side $sum sees every traversal");
  assert.match(entry.notes.find((note) => note.field === "tiv")?.method ?? "", /3 building value\(s\) across 2 location\(s\)/);
});

test("primary risk state is weighted by building value, never by an exposure basis", () => {
  const [entry] = assemble([boundPolicyRow]);
  // AZ carries a 50M receipts basis but only 4M of buildings; FL has 36M of buildings.
  assert.equal(entry.submission.primaryRiskState, "FL");
  assert.deepEqual(entry.primaryLocation, { state: "FL", county: "Miami-Dade" });
  const note = entry.notes.find((note) => note.field === "primaryRiskState");
  assert.match(note?.method ?? "", /FL holds 90% of building value across 2 state\(s\)/);
  assert.equal(note?.confidence, "medium");
});

test("a policy with no risk location falls back to the insured's own location at low confidence", () => {
  const [entry] = assemble([fleetPolicyRow], [fleetQueueRow]);
  const submission = entry.submission;
  assert.equal(submission.id, "SUB-2025-00002");
  assert.equal(submission.primaryRiskState, "TX");
  assert.equal(submission.tiv, 5_000_000, "the fleet's cost_new basis is never added to a property TIV");
  assert.equal(submission.buildingYear, 2000);
  assert.equal(submission.approvedConstructionPercentage, 1, "Fire Resistive is an approved class");
  assert.equal(submission.fiveYearLossValue, 0, "a policy with no claims has zero losses, not unknown");
  for (const field of ["primaryRiskState", "tiv", "buildingYear", "approvedConstructionPercentage"]) {
    const note = entry.notes.find((note) => note.field === field);
    assert.equal(note?.confidence, "low", `${field} must be flagged low confidence`);
  }
  assert.ok(entry.notes.some((note) => /insured's own address/.test(note.method)));
});

test("a submission with no policy keeps its unknowns and reads its location from the fallback", () => {
  const [entry] = assemble([], [unboundQueueRow]);
  const submission = entry.submission;
  assert.equal(submission.id, "SUB-2025-00003");
  assert.equal(submission.accountName, "No Policy Co");
  assert.equal(submission.lineOfBusiness, "property");
  assert.equal(submission.effectiveDate, "2025-08-01");
  assert.equal(submission.submissionType, undefined);
  assert.equal(submission.totalPremium, undefined);
  assert.equal(submission.expirationDate, undefined);
  assert.equal(submission.fiveYearLossValue, undefined, "no policy means loss history is unknown, not zero");
  assert.equal(submission.primaryRiskState, "TX");
  assert.equal(submission.tiv, 7_000_000, "HQ buildings beat the requested limit");
  assert.equal(submission.buildingYear, 2005);
  assert.equal(submission.approvedConstructionPercentage, 1);
  assert.ok(entry.notes.some((note) => /no bound policy/.test(note.method)));
  assert.equal(entry.notes.find((note) => note.field === "tiv")?.confidence, "low");
});

test("the requested limit stands in for TIV only when no building at all is known", () => {
  const [entry] = assemble([], [bareQueueRow]);
  assert.equal(entry.submission.tiv, 2_000_000);
  assert.equal(entry.submission.primaryRiskState, "OH");
  assert.equal(entry.submission.buildingYear, undefined);
  assert.equal(entry.submission.approvedConstructionPercentage, undefined);
  const note = entry.notes.find((note) => note.field === "tiv");
  assert.equal(note?.confidence, "low");
  assert.match(note?.ambiguity ?? "", /requested limit is not a total insured value/);
});

test("malformed rows never throw and yield unknowns, not garbage", () => {
  const [entry] = assemble([malformedPolicyRow]);
  const submission = entry.submission;
  assert.equal(submission.accountName, "Unknown account");
  assert.equal(submission.submissionType, "12", "a numeric string is kept; interpreting it is Person 3's call");
  assert.equal(submission.tiv, undefined);
  assert.equal(submission.totalPremium, undefined);
  assert.equal(submission.buildingYear, undefined);
  assert.equal(submission.primaryRiskState, undefined);
  assert.equal(submission.effectiveDate, undefined);
});

test("only canonical keys are emitted; raw API shapes never leak downstream", () => {
  for (const entry of assemble([boundPolicyRow, fleetPolicyRow], [boundQueueRow, fleetQueueRow, unboundQueueRow])) {
    for (const key of Object.keys(entry.submission)) {
      assert.ok(CANONICAL_KEYS.includes(key as keyof CanonicalSubmission), `unexpected key ${key}`);
    }
    for (const leaked of ["insured", "policy", "exposure_units", "buildings", "claims"]) {
      assert.ok(!(leaked in entry.submission), `canonical output must not leak ${leaked}`);
    }
  }
});

test("a queue record linked to a policy is not duplicated as an unbound submission", () => {
  const entries = assemble([boundPolicyRow], [boundQueueRow, unboundQueueRow]);
  assert.deepEqual(entries.map((entry) => entry.submission.id), ["SUB-2025-00001", "SUB-2025-00003"]);
});

/* ---------------------------------------------------------------------- */
/* The whole agent against the captured API responses in raw/.             */
/* ---------------------------------------------------------------------- */

const source = createReplaySource();
const agentPromise = runQueryAgent({
  discoverSchema: source.discoverSchema,
  execute: source.execute,
  useModel: false,
});

test("the schema is discovered before any query runs", async () => {
  const agent = await agentPromise;
  const stages = agent.trace.map((step) => step.stage);
  assert.equal(stages[0], "schema");
  assert.ok(stages.indexOf("plan") < stages.indexOf("query"));
});

test("every submission is retrieved, not just the bound ones", async () => {
  const agent = await agentPromise;
  assert.equal(agent.totals.root, 113);
  assert.equal(agent.totals.queue, 158);
  assert.equal(agent.submissions.length, 158, "unbound submissions must stay in the queue");
  assert.equal(new Set(agent.submissions.map((submission) => submission.id)).size, 158);
});

test("pagination covers the whole queue", async () => {
  const agent = await agentPromise;
  const pages = agent.trace.filter((step) => step.stage === "query" && /Fetch Policy/.test(step.title));
  assert.ok(pages.length >= 2, "113 records cannot arrive in one page of 100");
  assert.ok(!agent.trace.some((step) => step.title === "Pagination stopped early"));
});

test("out-of-appetite submissions are kept", async () => {
  const agent = await agentPromise;
  const lines = new Set(agent.submissions.map((submission) => submission.lineOfBusiness));
  assert.ok(lines.has("property"));
  assert.ok(lines.size > 1, "non-property lines must survive to be scored and explained");
});

test("the projection the agent sends carries everything the assembler reads", async () => {
  // Same snapshot, but every query returns whole records regardless of `select`.
  const whole = createReplaySource(undefined, { honorSelect: false });
  const [projected, unprojected] = await Promise.all([
    agentPromise,
    runQueryAgent({ discoverSchema: whole.discoverSchema, execute: whole.execute, useModel: false }),
  ]);
  assert.deepEqual(projected.submissions, unprojected.submissions);
});

test("TIV sums the building schedule and agrees with the API's own aggregation", async () => {
  const agent = await agentPromise;
  const entry = agent.assembled.find((item) => item.sourceRecordId === "1001");
  assert.equal(entry?.submission.tiv, 112_568_000);
  const crossCheck = agent.trace.find((step) => step.title.startsWith("Cross-checked TIV"));
  assert.equal(crossCheck?.stage, "derive", "a mismatch would mean the arrays were traversed wrongly");
});

test("every location-derived factor is known for every submission, and says how", async () => {
  const agent = await agentPromise;
  for (const entry of agent.assembled) {
    assert.notEqual(entry.submission.primaryRiskState, undefined, `${entry.submission.id} has no state`);
    assert.notEqual(entry.submission.buildingYear, undefined, `${entry.submission.id} has no building year`);
    assert.ok(entry.notes.some((note) => note.field === "primaryRiskState"), `${entry.submission.id} has no state note`);
  }
  const unbound = agent.assembled.find((entry) => entry.submission.id === "SUB-2025-00114");
  assert.ok(unbound);
  assert.equal(unbound.submission.totalPremium, undefined);
  assert.equal(unbound.submission.fiveYearLossValue, undefined);
  assert.ok(unbound.notes.some((note) => /no bound policy/.test(note.method)));
  assert.equal(unbound.notes.find((note) => note.field === "tiv")?.confidence, "low");
});

test("every planned field resolves against the live schema and the reasoning is serializable", async () => {
  const agent = await agentPromise;
  for (const choice of agent.plan.choices) {
    assert.ok(choice.path, `${choice.key} has no path`);
    assert.ok(source.index.resolve(agent.plan.rootResource, choice.path), `${choice.path} does not exist`);
  }
  assert.deepEqual(agent.plan.unresolved, []);
  const json = JSON.stringify(agent.reasoning);
  assert.equal(agent.reasoning.rootResource, "Policy");
  assert.equal(agent.reasoning.queueResource, "Submission");
  assert.ok(agent.reasoning.fields.length >= 8);
  assert.ok(agent.reasoning.steps.some((step) => step.stage === "query"));
  assert.doesNotMatch(json, /Bearer|client_secret|access_token/i);
});

test("a rejected query is retried with a simpler payload before giving up", async () => {
  const trace = createTrace();
  let attempts = 0;
  const result = await runQuery(
    async (payload) => {
      attempts += 1;
      if (payload.select) {
        throw new Error('[VALIDATION_ERROR] Unknown operator "$grt" {"operator":"$grt"}');
      }
      return { output: [{ data: { total: 1, results: [{ id: 1 }] } }] };
    },
    {
      purpose: "test",
      payload: { resource: "Policy", select: { id: true } },
      fallbacks: [{ resource: "Policy" }],
    },
    trace,
  );

  assert.equal(attempts, 2);
  assert.equal(result.rows.length, 1);
  const repair = trace.steps.find((step) => step.stage === "repair");
  assert.match(repair?.detail ?? "", /VALIDATION_ERROR/);
});

test("the response envelope is unwrapped and totals are read from it", () => {
  const envelope = { output: [{ data: { total: 7, results: [{ id: 1 }, { id: 2 }] } }] };
  assert.equal(extractRows(envelope).length, 2);
  assert.equal(extractTotal(envelope), 7);
  assert.deepEqual(extractRows(null), []);
  assert.deepEqual(extractRows([{ id: 1 }]).length, 1);
});
