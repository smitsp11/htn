import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import type { FactorKey } from "../lib/domain/types";
import { runQueryAgent } from "../lib/federato/adapter";
import { assembleSubmissions, evidenceFromNotes, refreshDerivations } from "../lib/federato/assemble";
import { createReplaySource } from "../lib/federato/replay";
import { createTrace } from "../lib/federato/query-trace";
import { buildSchemaIndex } from "../lib/federato/schema-index";
import { planFromSchema, planQueueResource } from "../lib/federato/schema-planner";
import { selectFollowUpTargets } from "../lib/rankings/follow-up-targets";
import { agentSchema } from "./fixtures/federato/agent-schema";
import { boundPolicyRow, boundQueueRow, unboundQueueRow } from "./fixtures/federato/agent-records";

const index = buildSchemaIndex(agentSchema);
const plan = planFromSchema(index, createTrace());
const queuePlan = planQueueResource(index, plan, createTrace());

const ALL_FACTORS: FactorKey[] = [
  "submissionType",
  "lineOfBusiness",
  "primaryRiskState",
  "tiv",
  "totalPremium",
  "buildingYear",
  "construction",
  "fiveYearLossValue",
];

test("a bound policy carries a building schedule and provenance for every factor", () => {
  const [entry] = assembleSubmissions({ plan, queuePlan, rootRows: [boundPolicyRow], queueRows: [boundQueueRow] });
  const { submission } = entry;
  assert.ok(submission.buildingSchedule && submission.buildingSchedule.length >= 1, "schedule emitted");
  for (const building of submission.buildingSchedule!) {
    assert.ok(building.year !== undefined || building.value !== undefined || building.constructionType, "each entry holds a fact");
  }
  assert.ok(submission.derivations);
  for (const key of ALL_FACTORS) {
    const evidence = submission.derivations![key];
    assert.ok(evidence, `${key} has evidence`);
    assert.ok(evidence.method.length > 0);
    assert.ok(["high", "medium", "low"].includes(evidence.confidence));
  }
  assert.equal(submission.derivations!.submissionType?.method, "Read directly from the record.");
  assert.match(submission.derivations!.submissionType?.sourcePath ?? "", new RegExp(`^${plan.rootResource}\\.`));
  assert.match(submission.derivations!.buildingYear?.sourcePath ?? "", new RegExp(`^${plan.rootResource}\\..*year`));
  assert.match(submission.derivations!.buildingYear?.method ?? "", /building/i);
});

test("an unbound submission explains its absent premium and losses with the no-policy note", () => {
  const entries = assembleSubmissions({ plan, queuePlan, rootRows: [], queueRows: [unboundQueueRow] });
  const [entry] = entries;
  const derivations = entry.submission.derivations!;
  assert.equal(entry.submission.totalPremium, undefined);
  assert.match(derivations.totalPremium?.method ?? "", /no bound policy/);
  assert.equal(derivations.totalPremium?.confidence, "low");
  assert.match(derivations.fiveYearLossValue?.method ?? "", /no bound policy/);
  assert.match(derivations.submissionType?.method ?? "", /no bound policy/);
  if (entry.submission.lineOfBusiness !== undefined) {
    assert.equal(derivations.lineOfBusiness?.method, "Read directly from the record.");
    assert.match(derivations.lineOfBusiness?.sourcePath ?? "", new RegExp(`^${queuePlan!.resource}\\.`));
  }
  assert.equal(derivations.primaryRiskState?.confidence, "low", "fallback-location state is low confidence");
});

test("a later note for the same field replaces the earlier one, so follow-ups win", () => {
  const [entry] = assembleSubmissions({ plan, queuePlan, rootRows: [boundPolicyRow], queueRows: [boundQueueRow] });
  const before = entry.submission.derivations!.fiveYearLossValue!;
  entry.notes.push({
    field: "fiveYearLossValue",
    method: "Follow-up: re-read 2 claim(s) to confirm the borderline loss figure.",
    sourcePath: "Policy.claims",
    confidence: "high",
    ambiguity: "Open reserves mean the paid figure can only grow.",
  });
  refreshDerivations(entry);
  const after = entry.submission.derivations!.fiveYearLossValue!;
  assert.notEqual(after.method, before.method);
  assert.match(after.method, /^Follow-up/);
  assert.equal(after.sourcePath, "Policy.claims");
  assert.equal(after.ambiguity, "Open reserves mean the paid figure can only grow.");
  assert.equal(entry.submission.derivations!.submissionType?.method, "Read directly from the record.", "direct reads survive a refresh");
});

test("evidenceFromNotes ignores fields that feed no factor and qualifies bare paths with the resource", () => {
  const evidence = evidenceFromNotes({
    resource: "Policy",
    submission: { id: "x", accountName: "X" },
    notes: [
      { field: "somethingElse", method: "n/a", sourcePath: "x", confidence: "high" },
      { field: "tiv", method: "Summed.", sourcePath: "exposure_units.location.buildings.tiv", confidence: "high" },
      { field: "fiveYearLossValue", method: "Follow-up.", sourcePath: "Policy.claims", confidence: "medium" },
    ],
  });
  assert.deepEqual(Object.keys(evidence).sort(), ["fiveYearLossValue", "tiv"]);
  assert.equal(evidence.tiv?.sourcePath, "Policy.exposure_units.location.buildings.tiv");
  assert.equal(evidence.fiveYearLossValue?.sourcePath, "Policy.claims");
});

/* ---------------------------------------------------------------------- */
/* On the captured snapshot: every known factor of every property row has   */
/* provenance, and it survives the adaptive follow-up.                      */
/* ---------------------------------------------------------------------- */

test("on the captured book every non-unknown factor carries evidence, before and after the follow-up", async () => {
  const source = createReplaySource();
  const agent = await runQueryAgent({ discoverSchema: source.discoverSchema, execute: source.execute, useModel: false });
  const check = (ranked: ReturnType<typeof rankSubmissions>, phase: string) => {
    let withEvidence = 0;
    for (const submission of ranked) {
      if (submission.status === "out_of_scope") continue;
      for (const factor of submission.factors) {
        if (factor.verdict === "unknown") continue;
        assert.ok(factor.evidence, `${phase}: ${submission.id} ${factor.key} has no evidence`);
        assert.ok(factor.evidence.sourcePath, `${phase}: ${submission.id} ${factor.key} has no source path`);
        withEvidence += 1;
      }
      assert.ok(!("derivations" in submission), "derivations are not serialized on the ranked row");
    }
    assert.ok(withEvidence > 100, `${phase}: ${withEvidence} evidenced factors`);
  };

  const first = rankSubmissions(agent.submissions);
  check(first, "first pass");
  const oldestMulti = first.find(
    (submission) => submission.factors.find((factor) => factor.key === "buildingYear")?.verdict === "not_acceptable" && (submission.buildingSchedule?.length ?? 0) > 1,
  );
  assert.ok(oldestMulti, "some out-of-appetite row has a multi-building schedule");
  assert.match(oldestMulti!.factors.find((factor) => factor.key === "buildingYear")!.detail ?? "", /value-weighted year is \d{4}/);

  const round = await agent.followUp(selectFollowUpTargets(first));
  const second = rankSubmissions(round.submissions);
  check(second, "second pass");
  for (const id of round.updated) {
    const factor = second.find((submission) => submission.id === id)?.factors.find((item) => item.key === "fiveYearLossValue");
    assert.match(factor?.evidence?.method ?? "", /^Follow-up/, `${id} loss evidence names the follow-up`);
  }
});
