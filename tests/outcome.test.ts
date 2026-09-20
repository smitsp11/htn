import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import type { RankedSubmission } from "../lib/domain/types";
import { buildRankings, type RankingsPipelineDeps } from "../lib/rankings/pipeline";
import { loadOfflineOutcomes } from "../lib/federato/offline-data";
import {
  formatDeclineReason,
  isOffStrategyBind,
  outcomeChipText,
  outcomeLabel,
  outcomeTone,
} from "../lib/rankings/outcome";
import { contradictory, fullTarget } from "./fixtures/domain/submissions";

function ranked(partial: Partial<RankedSubmission>): RankedSubmission {
  return {
    id: "SUB-1",
    accountName: "Test",
    status: "in_appetite",
    score: 50,
    factors: [],
    recommendation: "",
    explanation: "",
    ...partial,
  } as RankedSubmission;
}

test("outcomeLabel humanizes known and unknown lifecycle statuses", () => {
  assert.equal(outcomeLabel("bound"), "Bound");
  assert.equal(outcomeLabel("declined"), "Declined");
  assert.equal(outcomeLabel("somethingelse"), "Somethingelse");
  assert.equal(outcomeLabel(""), "Unknown");
});

test("formatDeclineReason turns raw tokens into prose", () => {
  assert.equal(formatDeclineReason("loss_history"), "Loss history");
  assert.equal(formatDeclineReason("broker_withdrew"), "Broker withdrew");
});

test("outcomeChipText inlines the decline reason only for declined", () => {
  assert.equal(outcomeChipText({ status: "bound" }), "Actual: Bound");
  assert.equal(
    outcomeChipText({ status: "declined", declineReason: "insufficient_controls" }),
    "Actual: Declined — Insufficient controls",
  );
  // A non-declined status never surfaces a reason, even if one is present.
  assert.equal(outcomeChipText({ status: "lost", declineReason: "whatever" }), "Actual: Lost");
});

test("outcomeTone marks bound positive and other dispositions neutral", () => {
  assert.equal(outcomeTone("bound"), "mint");
  assert.equal(outcomeTone("declined"), "neutral");
  assert.equal(outcomeTone("lost"), "neutral");
});

test("isOffStrategyBind is true only for bound AND out_of_appetite", () => {
  assert.equal(isOffStrategyBind(ranked({ status: "out_of_appetite", actualOutcome: { status: "bound" } })), true);
  assert.equal(isOffStrategyBind(ranked({ status: "in_appetite", actualOutcome: { status: "bound" } })), false);
  assert.equal(isOffStrategyBind(ranked({ status: "out_of_appetite", actualOutcome: { status: "declined" } })), false);
  assert.equal(isOffStrategyBind(ranked({ status: "out_of_appetite" })), false);
});

test("loadOfflineOutcomes maps submissions to their raw lifecycle disposition", async () => {
  const map = await loadOfflineOutcomes();
  assert.ok(map.size >= 150, `expected ~158 entries, got ${map.size}`);
  const statuses = new Set([...map.values()].map((o) => o.status));
  assert.ok(statuses.has("bound"), "some submissions are bound");
  assert.ok(statuses.has("declined"), "some submissions are declined");
  // Every declined submission carries a decline reason; nothing else needs one.
  const declined = [...map.values()].filter((o) => o.status === "declined");
  assert.ok(declined.length > 0);
  assert.ok(declined.every((o) => Boolean(o.declineReason)), "declined outcomes carry a reason");
});

test("pipeline attaches actualOutcome after ranking without changing the appetite verdict", async () => {
  const outcomes = new Map([
    [fullTarget.id, { status: "declined", declineReason: "broker_withdrew" }],
    [contradictory.id, { status: "bound" }],
  ]);
  const deps: RankingsPipelineDeps = {
    useDemoData: false,
    demoSubmissions: [],
    dataSource: "offline",
    runAgent: async () => ({ submissions: [fullTarget, contradictory], traceSummary: [] }),
    loadOutcomes: async () => outcomes,
    rank: rankSubmissions,
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  };

  const withOutcomes = await buildRankings(deps);
  const baseline = await buildRankings({ ...deps, loadOutcomes: undefined });
  const byId = (r: Awaited<ReturnType<typeof buildRankings>>) =>
    Object.fromEntries(r.submissions.map((s) => [s.id, s]));
  const w = byId(withOutcomes);
  const b = byId(baseline);

  // The outcome layer is attached...
  assert.equal(w[contradictory.id].actualOutcome?.status, "bound");
  assert.equal(w[fullTarget.id].actualOutcome?.declineReason, "broker_withdrew");
  // ...and absent when no loader is provided.
  assert.equal(b[contradictory.id].actualOutcome, undefined);

  // The appetite verdict and score are identical with or without the outcome layer:
  // the engine only ever sees CanonicalSubmission, so this can never move a score.
  for (const id of [fullTarget.id, contradictory.id]) {
    assert.equal(w[id].status, b[id].status, `${id} appetite status unchanged`);
    assert.equal(w[id].score, b[id].score, `${id} score unchanged`);
  }

  // The contradictory fixture is out of appetite, yet it was bound -> off-strategy.
  assert.equal(w[contradictory.id].status, "out_of_appetite");
  assert.equal(isOffStrategyBind(w[contradictory.id]), true);
  // The target fixture is in appetite and was declined -> not an off-strategy bind.
  assert.equal(isOffStrategyBind(w[fullTarget.id]), false);
});
