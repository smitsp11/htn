import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import type { RankedSubmission } from "../lib/domain/types";
import { runQueryAgent } from "../lib/federato/adapter";
import { assembleSubmissions } from "../lib/federato/assemble";
import {
  buildConfirmLossesQuery,
  buildPriorTermQuery,
  confirmLosses,
  explainUnaddressed,
  groupGaps,
  insuredIdsFor,
  mergePriorTermLosses,
  planPriorTermRoute,
} from "../lib/federato/follow-up";
import { createTrace } from "../lib/federato/query-trace";
import { validateQuery } from "../lib/federato/query-validator";
import { createReplaySource } from "../lib/federato/replay";
import { buildSchemaIndex } from "../lib/federato/schema-index";
import { planFromSchema, planQueueResource } from "../lib/federato/schema-planner";
import { diffRankings, selectFollowUpTargets } from "../lib/rankings/follow-up-targets";
import { agentSchema } from "./fixtures/federato/agent-schema";
import { unboundQueueRow, bareQueueRow } from "./fixtures/federato/agent-records";

/* ---------------------------------------------------------------------- */
/* Route planning: everything is resolved from the schema, nothing assumed. */
/* ---------------------------------------------------------------------- */

const index = buildSchemaIndex(agentSchema);
const plan = planFromSchema(index, createTrace());
const queuePlan = planQueueResource(index, plan, createTrace());

test("follow-up: the route from the queue to prior terms and claims is discovered from the schema", () => {
  const trace = createTrace();
  const route = planPriorTermRoute(index, plan, queuePlan, trace);
  assert.ok(route);
  assert.equal(route.rootResource, "Policy");
  assert.equal(route.rootInsuredPath, "insured");
  assert.equal(route.queueInsuredPath, "insured");
  assert.equal(route.insuredResource, "Insured");
  assert.equal(route.claimsPath, "claims");
  assert.ok(route.claimLeaves.includes("claims.paid_indemnity"));
  assert.ok(route.claimLeaves.includes("claims.date_of_loss"));
  assert.ok(route.claimLeaves.includes("claims.reserve_indemnity"), "reserves are read so a borderline figure can be qualified");
  assert.ok(route.termPaths.includes("line_of_business"), "the line is projected so the note can say which lines were counted");
  assert.ok(trace.steps.some((step) => step.stage === "plan" && /prior-term losses/.test(step.title)));
});

test("follow-up: both follow-up payloads validate against the schema, with where on ids only", () => {
  const route = planPriorTermRoute(index, plan, queuePlan, createTrace())!;
  const prior = buildPriorTermQuery(route, [3, 4]);
  assert.deepEqual(validateQuery(index, prior.payload), { ok: true, errors: [] });
  assert.deepEqual(prior.payload.where, { insured: { $in: [3, 4] } });
  assert.deepEqual(prior.payload.expand, { claims: true });
  assert.ok(prior.fallbacks.length >= 1, "a rejected projection falls back to whole records");
  for (const fallback of prior.fallbacks) assert.deepEqual(validateQuery(index, fallback), { ok: true, errors: [] });

  const confirm = buildConfirmLossesQuery(route, [1001]);
  assert.deepEqual(validateQuery(index, confirm.payload), { ok: true, errors: [] });
  assert.deepEqual(confirm.payload.where, { id: { $in: [1001] } });
});

test("follow-up: a schema with no insured link yields no route and says so, instead of inventing one", () => {
  const alien = buildSchemaIndex({
    Deal: {
      type: "object",
      fields: {
        id: { type: "number" },
        premium: { type: "number" },
        business_type: { type: "string" },
        line_of_business: { type: "string" },
        policy_number: { type: "string" },
        dates: { type: "object", fields: { effective: { type: "string" } } },
        account_name: { type: "string" },
        claims: { type: "reference", resource: "Loss", cardinality: "many" },
        submission: { type: "reference", resource: "Intake", cardinality: "one" },
      },
    },
    Intake: { type: "object", fields: { id: { type: "number" }, submission_number: { type: "string" }, received_date: { type: "string" } } },
    Loss: { type: "object", fields: { id: { type: "number" }, date_of_loss: { type: "string" }, paid_indemnity: { type: "number" } } },
  });
  const alienPlan = planFromSchema(alien, createTrace());
  const alienQueue = planQueueResource(alien, alienPlan, createTrace());
  const trace = createTrace();
  assert.equal(planPriorTermRoute(alien, alienPlan, alienQueue, trace), undefined);
  const warning = trace.steps.find((step) => step.stage === "warning");
  assert.match(warning?.detail ?? "", /keep their loss history unknown/);
});

/* ---------------------------------------------------------------------- */
/* Merging: every line counts, the note says so, and nothing is guessed.    */
/* ---------------------------------------------------------------------- */

const route = planPriorTermRoute(index, plan, queuePlan, createTrace())!;

function unboundTargets() {
  // Queue rows as the queue query now projects them: the insured carries its id.
  const queueRows = [
    { ...unboundQueueRow, insured: { ...unboundQueueRow.insured } },
    { ...bareQueueRow, insured: { ...bareQueueRow.insured } },
  ];
  const assembled = assembleSubmissions({ plan, queuePlan, rootRows: [], queueRows });
  return { assembled, queueRows };
}

test("follow-up: prior-term claims across every line resolve an unbound submission's losses, inside the window", () => {
  const { assembled, queueRows } = unboundTargets();
  const target = assembled.find((entry) => entry.submission.id === "SUB-2025-00003")!;
  assert.equal(target.submission.fiveYearLossValue, undefined, "the first pass leaves it unknown");

  const terms = [
    {
      id: 900,
      insured: 3,
      line_of_business: "cyber",
      business_type: "new",
      dates: { effective: "2024-01-01" },
      claims: [
        { id: 1, date_of_loss: "2024-03-01", paid_indemnity: 30_000, paid_expense: 5_000, reserve_indemnity: 0 },
        { id: 2, date_of_loss: "2018-03-01", paid_indemnity: 900_000, paid_expense: 0, reserve_indemnity: 0 }, // outside the window
      ],
    },
    {
      id: 901,
      insured: 3,
      line_of_business: "cgl",
      business_type: "renewal",
      dates: { effective: "2023-01-01" },
      claims: [{ id: 3, date_of_loss: "2023-07-01", paid_indemnity: 20_000, paid_expense: 1_000, reserve_indemnity: 50_000 }],
    },
  ];
  const merged = mergePriorTermLosses([target], insuredIdsFor(queueRows, route), terms, route, plan);
  assert.deepEqual(merged.resolved, ["SUB-2025-00003"]);
  assert.deepEqual(merged.unresolved, []);
  // Effective 2025-08-01 → years 2021–2025: claims 1 and 3 count, claim 2 does not.
  assert.equal(target.submission.fiveYearLossValue, 56_000);
  const note = target.notes.filter((item) => item.field === "fiveYearLossValue").at(-1)!;
  assert.match(note.method, /^Follow-up:/);
  assert.match(note.method, /every line of business \(cyber, cgl\)/);
  assert.match(note.method, /bound the loss history by time, not by line/);
  assert.equal(note.confidence, "medium");
});

test("follow-up: an insured with no prior term stays unknown, with a note that says the lookup happened", () => {
  const { assembled, queueRows } = unboundTargets();
  const target = assembled.find((entry) => entry.submission.id === "SUB-2025-00004")!;
  const merged = mergePriorTermLosses([target], insuredIdsFor(queueRows, route), [], route, plan);
  assert.deepEqual(merged.resolved, []);
  assert.equal(merged.unresolved.length, 1);
  assert.match(merged.unresolved[0].reason, /no prior term/);
  assert.equal(target.submission.fiveYearLossValue, undefined);
  assert.ok(target.notes.some((note) => /found none/.test(note.method)));
});

test("follow-up: a queue row whose projection lacks the insured is reported, not guessed", () => {
  const { assembled } = unboundTargets();
  const target = assembled.find((entry) => entry.submission.id === "SUB-2025-00003")!;
  const merged = mergePriorTermLosses([target], new Map(), [], route, plan);
  assert.equal(merged.unresolved[0].reason, "The queue record names no insured to look prior terms up for.");
});

test("follow-up: confirming a borderline loss re-derives it and reports open reserves", () => {
  const root = {
    id: 1001,
    policy_number: "PR-2025-1001",
    submission: { id: 1 },
    insured: { id: 1, name: "Harbor Point Retail LLC" },
    business_type: "new",
    line_of_business: "property",
    dates: { effective: "2025-10-01", expiration: "2026-10-01" },
    premium: 90_000,
    exposure_units: [],
    claims: [{ id: 1, date_of_loss: "2025-11-21", paid_indemnity: 100_000, paid_expense: 21_800, reserve_indemnity: 400_000 }],
  };
  const [entry] = assembleSubmissions({ plan, queuePlan, rootRows: [root], queueRows: [] });
  assert.equal(entry.submission.fiveYearLossValue, 121_800);

  const fresh = { id: 1001, claims: [{ id: 1, date_of_loss: "2025-11-21", paid_indemnity: 100_000, paid_expense: 21_800, reserve_indemnity: 400_000 }] };
  const [confirmation] = confirmLosses([entry], [fresh], route, plan);
  assert.deepEqual(confirmation, { submissionId: "SUB-2025-1001".replace("SUB-2025-1001", entry.submission.id), paid: 121_800, reserved: 400_000, claims: 1, changed: false });
  assert.match(entry.notes.at(-1)!.method, /matches the first pass/);
  assert.match(entry.notes.at(-1)!.ambiguity ?? "", /can only grow/);

  // A fresh read that disagrees replaces the figure and says so.
  const disagreeing = { id: 1001, claims: [{ id: 1, date_of_loss: "2025-11-21", paid_indemnity: 50_000, paid_expense: 0, reserve_indemnity: 0 }] };
  const [again] = confirmLosses([entry], [disagreeing], route, plan);
  assert.equal(again.changed, true);
  assert.equal(entry.submission.fiveYearLossValue, 50_000);
});

/* ---------------------------------------------------------------------- */
/* Selection and grouping: who gets a second look, and what can be done.    */
/* ---------------------------------------------------------------------- */

function ranked(overrides: Record<string, unknown>[]): RankedSubmission[] {
  return rankSubmissions(
    overrides.map((extra, position) => ({
      id: `row-${position}`,
      accountName: `Row ${position}`,
      submissionType: "new",
      lineOfBusiness: "property",
      primaryRiskState: "OH",
      tiv: 60_000_000,
      totalPremium: 80_000,
      buildingYear: 2015,
      approvedConstructionPercentage: 1,
      fiveYearLossValue: 0,
      ...extra,
    })),
  );
}

test("targets: rows with unknown factors and single-factor near misses are selected; decided and out-of-scope rows are not", () => {
  const rows = ranked([
    {}, // in appetite: nothing to do
    { fiveYearLossValue: undefined, totalPremium: undefined }, // two unknowns
    { fiveYearLossValue: 150_000 }, // near miss: one hard failure on a strong row
    { fiveYearLossValue: 150_000, submissionType: "renewal" }, // two failures: not a near miss
    { lineOfBusiness: "auto" }, // out of scope: never targeted
  ]);
  const gaps = selectFollowUpTargets(rows);
  const byRow = new Map<string, string[]>();
  for (const gap of gaps) byRow.set(gap.submissionId, [...(byRow.get(gap.submissionId) ?? []), `${gap.factor}:${gap.reason}`]);
  assert.deepEqual([...byRow.keys()].sort(), ["row-1", "row-2"]);
  assert.deepEqual(byRow.get("row-1")?.sort(), ["fiveYearLossValue:unknown", "totalPremium:unknown"]);
  assert.deepEqual(byRow.get("row-2"), ["fiveYearLossValue:near_miss"]);
});

test("targets: the diff reports status changes separately from score-only changes", () => {
  const before = ranked([{ fiveYearLossValue: undefined }, { fiveYearLossValue: undefined, totalPremium: undefined }]);
  const after = ranked([{ fiveYearLossValue: 0 }, { fiveYearLossValue: 0, totalPremium: undefined }]);
  assert.deepEqual(diffRankings(before, after), { statusChanged: ["row-0"], scoreChanged: ["row-1"] });
});

test("grouping: loss gaps map to a follow-up kind; premium and type are explained as unanswerable before a quote", () => {
  const grouped = groupGaps([
    { submissionId: "a", factor: "fiveYearLossValue", reason: "unknown" },
    { submissionId: "a", factor: "fiveYearLossValue", reason: "unknown" },
    { submissionId: "b", factor: "fiveYearLossValue", reason: "near_miss" },
    { submissionId: "a", factor: "totalPremium", reason: "unknown" },
    { submissionId: "a", factor: "submissionType", reason: "unknown" },
    { submissionId: "c", factor: "primaryRiskState", reason: "near_miss" },
  ]);
  assert.deepEqual(grouped.priorTermLosses, ["a"]);
  assert.deepEqual(grouped.confirmLosses, ["b"]);
  assert.equal(grouped.unaddressed.length, 3);
  assert.match(explainUnaddressed(grouped.unaddressed[0]), /before a quote/);
  assert.match(explainUnaddressed(grouped.unaddressed[1]), /recorded on the policy/);
  assert.match(explainUnaddressed(grouped.unaddressed[2]), /no follow-up query/);
});

/* ---------------------------------------------------------------------- */
/* End to end on the captured snapshot, through the replay executor.        */
/* ---------------------------------------------------------------------- */

test("replay: the adaptive pass resolves losses for every unbound submission from prior terms and logs each query", async () => {
  const source = createReplaySource();
  const agent = await runQueryAgent({ discoverSchema: source.discoverSchema, execute: source.execute, useModel: false });
  const first = rankSubmissions(agent.submissions);
  const gaps = selectFollowUpTargets(first);
  assert.ok(gaps.some((gap) => gap.submissionId === "SUB-2025-00138" && gap.factor === "fiveYearLossValue" && gap.reason === "unknown"));
  assert.ok(gaps.some((gap) => gap.submissionId === "SUB-2026-00081" && gap.reason === "near_miss"));

  const round = await agent.followUp(gaps);
  const byId = new Map(round.submissions.map((submission) => [submission.id, submission]));
  // Lumen Data Works: 3 claims on prior health terms in 2021–2025 → $84,400, acceptable.
  assert.equal(byId.get("SUB-2025-00138")?.fiveYearLossValue, 84_400);
  // Harbor Point Retail: prior terms carry $673,000 in the window → not acceptable.
  assert.equal(byId.get("SUB-2025-00132")?.fiveYearLossValue, 673_000);
  // An insured with prior terms but no claims in the window resolves to 0, not unknown.
  assert.equal(byId.get("SUB-2025-00143")?.fiveYearLossValue, 0);
  assert.equal(round.updated.length, 11);
  assert.equal(round.queries, 2, "one batched prior-term query and one confirmation");

  const second = rankSubmissions(round.submissions);
  const delta = diffRankings(first, second);
  assert.deepEqual(delta.statusChanged, ["SUB-2025-00132"]);
  assert.equal(second.find((row) => row.id === "SUB-2025-00132")?.status, "out_of_appetite");
  assert.equal(second.find((row) => row.id === "SUB-2025-00138")?.status, "needs_investigation", "premium and type are still unknown");

  const steps = round.reasoning.steps;
  assert.ok(steps.some((step) => step.stage === "follow-up" && /Selected rows/.test(step.title)));
  assert.ok(steps.some((step) => step.stage === "query" && /prior terms and claims/.test(step.title)));
  assert.ok(steps.some((step) => /Confirmed borderline losses/.test(step.title) && /still reserved/.test(step.detail)));
  assert.ok(steps.some((step) => /no follow-up available/.test(step.title) && /before a quote/.test(step.detail)));
  assert.doesNotMatch(JSON.stringify(round.reasoning), /Bearer|client_secret|access_token/i);

  const again = await agent.followUp(gaps);
  assert.equal(again.queries, 0, "the pass runs once per agent run");
  assert.ok(again.traceSummary.some((line) => /already ran/.test(line)));
});
