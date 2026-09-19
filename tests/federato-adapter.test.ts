import assert from "node:assert/strict";
import test from "node:test";
import { runQueryAgent } from "../lib/federato/adapter";
import { createReplaySource } from "../lib/federato/replay";
import { createTrace } from "../lib/federato/query-trace";
import { runQuery } from "../lib/federato/query-executor";
import { extractRows, extractTotal } from "../lib/federato/response";

/**
 * The captured responses in `raw/` are the real API's output, so these run the
 * whole agent — schema discovery, planning, expansion, pagination, assembly —
 * without credentials. The model pass is off: planning must work without it.
 */
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
  assert.ok(agent.submissions.length > 50, "the dataset is documented as 50+ submissions");
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

test("multi-state submissions get the state holding the most insured value", async () => {
  const agent = await agentPromise;
  const entry = agent.assembled.find((item) => item.sourceRecordId === "1001");
  assert.ok(entry);
  assert.equal(entry.submission.primaryRiskState, "FL");
  const note = entry.notes.find((item) => item.field === "primaryRiskState");
  assert.match(note?.method ?? "", /% of insured value across 4 state\(s\)/);
  assert.equal(note?.confidence, "low", "a minority share must be flagged as contestable");
});

test("TIV sums the building schedule and agrees with the API's own aggregation", async () => {
  const agent = await agentPromise;
  const entry = agent.assembled.find((item) => item.sourceRecordId === "1001");
  assert.equal(entry?.submission.tiv, 112_568_000);
  const crossCheck = agent.trace.find((step) =>
    step.title.startsWith("Cross-checked TIV"),
  );
  assert.equal(crossCheck?.stage, "derive", "a mismatch would mean the arrays were traversed wrongly");
});

test("building age uses the oldest building and says so", async () => {
  const agent = await agentPromise;
  const entry = agent.assembled.find((item) => item.sourceRecordId === "1001");
  assert.equal(entry?.submission.buildingYear, 1954);
  assert.match(
    entry?.notes.find((note) => note.field === "buildingYear")?.method ?? "",
    /Oldest of 9 buildings/,
  );
});

test("construction is weighted by value and unlisted classes are surfaced, not hidden", async () => {
  const agent = await agentPromise;
  const entry = agent.assembled.find((item) => item.sourceRecordId === "1001");
  const share = entry?.submission.approvedConstructionPercentage;
  assert.ok(share !== undefined && share > 0.2 && share < 0.21);
  const note = entry?.notes.find((item) => item.field === "approvedConstructionPercentage");
  assert.match(note?.ambiguity ?? "", /fire resistive/i);
});

test("losses are incurred indemnity inside the five-year window", async () => {
  const agent = await agentPromise;
  const entry = agent.assembled.find((item) => item.sourceRecordId === "1001");
  assert.equal(entry?.submission.fiveYearLossValue, 1_332_000);
  assert.match(
    entry?.notes.find((note) => note.field === "fiveYearLossValue")?.method ?? "",
    /paid plus reserved/,
  );
});

test("a submission with no policy keeps its unknowns instead of inventing them", async () => {
  const agent = await agentPromise;
  const unbound = agent.assembled.find((entry) => entry.submission.id === "SUB-2025-00114");
  assert.ok(unbound);
  assert.equal(unbound.submission.totalPremium, undefined);
  assert.equal(unbound.submission.buildingYear, undefined);
  assert.equal(unbound.submission.fiveYearLossValue, undefined);
  assert.ok(unbound.notes.some((note) => /no bound policy/.test(note.method)));
  assert.ok(
    unbound.notes.some((note) => note.field === "tiv" && note.confidence === "low"),
    "a requested limit standing in for TIV must be marked low confidence",
  );
});

test("every planned field resolves against the live schema", async () => {
  const agent = await agentPromise;
  for (const choice of agent.plan.choices) {
    assert.ok(choice.path, `${choice.key} has no path`);
    assert.ok(
      source.index.resolve(agent.plan.rootResource, choice.path),
      `${choice.path} does not exist on ${agent.plan.rootResource}`,
    );
  }
  assert.deepEqual(agent.plan.unresolved, []);
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
