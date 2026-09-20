/**
 * The query agent.
 *
 * Schema discovery → plan (name matching, optionally refined by a model) →
 * compiled queries → paged execution with repair → canonical submissions.
 *
 * Nothing here knows a Federato field name ahead of time, and nothing here
 * filters records for being out of appetite: the whole queue is returned and
 * Person 3 decides what it means.
 */

import type { CanonicalSubmission, QueryReasoning } from "@/lib/domain/types";
import { assembleSubmissions, type AssembledSubmission, refreshDerivations } from "./assemble";
import {
  buildConfirmLossesQuery,
  buildPriorTermQuery,
  confirmLosses,
  explainUnaddressed,
  groupGaps,
  insuredIdsFor,
  mergePriorTermLosses,
  MAX_FOLLOW_UP_QUERIES,
  pickTargets,
  planPriorTermRoute,
  type FollowUpGap,
  type PriorTermRoute,
} from "./follow-up";
import { selectFieldsWithModel } from "./llm-planner";
import { repairQueryWithModel } from "./llm-repair";
import { buildQueueQuery, buildRootQuery, buildTivCheckQuery } from "./query-compiler";
import { runPaged, runQuery, type QueryExecutor, type RunQueryOptions } from "./query-executor";
import { buildQueryReasoning, createTrace, type QueryTrace, type TraceStep } from "./query-trace";
import { validateQuery } from "./query-validator";
import { asNumber, asString, type UnknownRecord } from "./response";
import { buildSchemaIndex } from "./schema-index";
import {
  applyLlmSelections,
  planFromSchema,
  planQueueResource,
  type DataPlan,
  type QueuePlan,
} from "./schema-planner";

export interface QueryAgentDependencies {
  discoverSchema: () => Promise<unknown>;
  execute: QueryExecutor;
  /** Set false to skip the model pass even when a planner provider is configured. */
  useModel?: boolean;
}

/** What one adaptive pass did: the patched queue and everything it logged. */
export interface FollowUpResult {
  submissions: CanonicalSubmission[];
  /** Submission ids whose canonical values changed. */
  updated: string[];
  /** Follow-up queries actually sent (validated payloads, pages counted once). */
  queries: number;
  /** Flat sentences for `RankingsResponse.trace`, this pass only. */
  traceSummary: string[];
  /** The full reasoning, first pass plus this one. */
  reasoning: QueryReasoning;
}

export interface QueryAgentResult {
  submissions: CanonicalSubmission[];
  assembled: AssembledSubmission[];
  plan: DataPlan;
  queuePlan?: QueuePlan;
  trace: TraceStep[];
  traceSummary: string[];
  /** Serializable, credential-free view of the plan and steps for the UI. */
  reasoning: QueryReasoning;
  /** Records the API reported for the root resource, before assembly. */
  totals: { root?: number; queue?: number; assembled: number };
  /**
   * The adaptive second pass. Given the factors the ranking could not settle,
   * plans and runs focused follow-up queries, patches the affected
   * submissions and reports what it did. Runs at most once per agent run;
   * a second call is a no-op with a warning on the trace.
   */
  followUp: (gaps: FollowUpGap[]) => Promise<FollowUpResult>;
}

export async function runQueryAgent({
  discoverSchema,
  execute,
  useModel = true,
}: QueryAgentDependencies): Promise<QueryAgentResult> {
  const trace = createTrace();

  const rawSchema = await discoverSchema();
  const index = buildSchemaIndex(rawSchema);
  trace.add(
    "schema",
    "Discovered the schema before querying",
    `The data layer described ${index.resources.length} resources: ${index.resources.join(", ")}.`,
    { resources: index.resources.length },
  );

  let plan = planFromSchema(index, trace);
  if (useModel) {
    const selections = await selectFieldsWithModel(index, plan, trace);
    if (selections?.length) plan = applyLlmSelections(plan, index, selections, trace);
  }
  describePlan(plan, trace);

  // Every payload is checked against the discovered schema before it is sent.
  // A rejected payload costs no API call: the model may rewrite it (when a
  // planner provider is configured), otherwise the next simpler fallback runs.
  const options: RunQueryOptions = {
    validate: (payload) => validateQuery(index, payload),
    repair: useModel ? (payload, errors) => repairQueryWithModel(index, payload, errors, trace) : undefined,
  };
  trace.add(
    "plan",
    "Validating every query locally before it is sent",
    "Each payload is checked against the discovered schema: fields must exist, references must be expanded before they are read through, arrays are never crossed by a dot-path, and only documented operators are used.",
  );

  const root = await runPaged(execute, (offset) => buildRootQuery(plan, offset), trace, options);

  const queuePlan = planQueueResource(index, plan, trace);
  // The queue projection also carries the insured's id, so a later follow-up
  // can look up prior terms without a second read of the queue.
  const route = planPriorTermRoute(index, plan, queuePlan, trace);
  const queueExtras = route ? [`${route.queueInsuredPath}.id`] : [];
  const queue = queuePlan
    ? await runPaged(execute, (offset) => buildQueueQuery(queuePlan, offset, undefined, queueExtras), trace, options)
    : undefined;

  const assembled = assembleSubmissions({
    plan,
    rootRows: root.rows,
    queuePlan,
    queueRows: queue?.rows,
  });

  if (queue) {
    const unbound = assembled.length - root.rows.length;
    trace.add(
      "derive",
      "Kept submissions that have no policy yet",
      `${Math.max(unbound, 0)} submission(s) in the queue have no bound policy, so premium and loss history are unavailable. They stay in the queue with those factors unknown${
        queuePlan?.fallback ? ` and their location read from ${queuePlan.resource}.${queuePlan.fallback.locationPath} at low confidence` : ""
      }.`,
      { unbound: Math.max(unbound, 0) },
    );
  }

  await crossCheckTiv(execute, plan, assembled, trace, options);
  reportUnresolved(plan, trace);

  let followUpRan = false;
  const followUp = async (gaps: FollowUpGap[]): Promise<FollowUpResult> => {
    const before = trace.steps.length;
    let outcome: FollowUpOutcome = { updated: [], queries: 0 };
    if (followUpRan) {
      trace.add("warning", "Follow-up already ran", "The adaptive pass runs once per agent run; a second request was ignored.");
    } else {
      followUpRan = true;
      outcome = await runFollowUp({ gaps, route, plan, assembled, queueRows: queue?.rows ?? [], execute, trace, options });
      for (const entry of assembled) refreshDerivations(entry);
    }
    const added = trace.steps.slice(before);
    return {
      submissions: assembled.map((entry) => entry.submission),
      updated: [...new Set(outcome.updated)],
      queries: outcome.queries,
      traceSummary: added.map((step) => `${step.title}: ${step.detail}`),
      reasoning: buildQueryReasoning(plan, queuePlan, trace.steps),
    };
  };

  return {
    submissions: assembled.map((entry) => entry.submission),
    assembled,
    plan,
    queuePlan,
    trace: trace.steps,
    traceSummary: trace.summarize(),
    reasoning: buildQueryReasoning(plan, queuePlan, trace.steps),
    totals: { root: root.total, queue: queue?.total, assembled: assembled.length },
    followUp,
  };
}

interface FollowUpOutcome {
  /** Submission ids whose canonical values changed. */
  updated: string[];
  /** Follow-up queries sent. */
  queries: number;
}

interface FollowUpContext {
  gaps: FollowUpGap[];
  route: PriorTermRoute | undefined;
  plan: DataPlan;
  assembled: AssembledSubmission[];
  queueRows: UnknownRecord[];
  execute: QueryExecutor;
  trace: QueryTrace;
  options: RunQueryOptions;
}

/**
 * The adaptive pass. Each follow-up kind runs at most once, batched over
 * every row that needs it, and every payload goes through the same
 * validator and fallback chain as the first pass.
 */
async function runFollowUp({ gaps, route, plan, assembled, queueRows, execute, trace, options }: FollowUpContext): Promise<FollowUpOutcome> {
  const outcome: FollowUpOutcome = { updated: [], queries: 0 };
  const grouped = groupGaps(gaps);
  const rows = new Set(gaps.map((gap) => gap.submissionId));
  trace.add(
    "follow-up",
    "Selected rows for a second look",
    `${rows.size} submission(s) were left undecided or narrowly out of appetite after the first ranking: ${grouped.priorTermLosses.length} with no loss history, ${grouped.confirmLosses.length} borderline on losses, ${grouped.unaddressed.length} gap(s) with no follow-up available.`,
    { rows: rows.size },
  );
  if (rows.size === 0) return outcome;

  const budget = () => {
    if (outcome.queries >= MAX_FOLLOW_UP_QUERIES) {
      trace.add("warning", "Follow-up budget exhausted", `Stopped after ${MAX_FOLLOW_UP_QUERIES} follow-up queries.`);
      return false;
    }
    return true;
  };

  if (!route && (grouped.priorTermLosses.length || grouped.confirmLosses.length)) {
    trace.add("warning", "No follow-up route for losses", "The schema gave no route from the queue to prior terms, so loss gaps stay unknown.");
  }

  if (route && grouped.priorTermLosses.length && budget()) {
    const targets = pickTargets(assembled, grouped.priorTermLosses);
    const insuredByQueueId = insuredIdsFor(queueRows, route);
    const insuredIds = [...new Set(targets.map((entry) => (entry.sourceRecordId ? insuredByQueueId.get(entry.sourceRecordId) : undefined)).filter((id) => id !== undefined && id !== null))];
    trace.add(
      "follow-up",
      "Follow-up: prior-term losses for unbound submissions",
      `Purpose: resolve five-year losses for ${targets.length} submission(s) that have no policy. Asking ${route.rootResource} for every term held by their ${insuredIds.length} insured(s), with claims expanded, instead of assuming zero.`,
      { targets: targets.length, insureds: insuredIds.length },
    );
    if (insuredIds.length) {
      try {
        const result = await runPaged(execute, (offset) => buildPriorTermQuery(route, insuredIds, offset), trace, options);
        outcome.queries += 1;
        const merged = mergePriorTermLosses(targets, insuredByQueueId, result.rows, route, plan);
        outcome.updated.push(...merged.resolved);
        trace.add(
          "follow-up",
          "Merged prior-term losses",
          `${result.rows.length} prior term(s) returned. Five-year losses resolved for ${merged.resolved.length} submission(s), counting claims on every line the insured holds; ${merged.unresolved.length} still unknown${
            merged.unresolved.length ? ` (${merged.unresolved.map((item) => `${item.submissionId}: ${item.reason}`).join("; ")})` : ""
          }.`,
          { resolved: merged.resolved.length, unresolved: merged.unresolved.length },
        );
      } catch (error) {
        trace.add("warning", "Prior-term follow-up failed", `${error instanceof Error ? error.message : String(error)} Loss history stays unknown for these submissions.`);
      }
    } else {
      trace.add("warning", "No insured on the queue rows", "The queue projection carried no insured id, so prior terms could not be looked up.");
    }
  }

  if (route && grouped.confirmLosses.length && budget()) {
    const targets = pickTargets(assembled, grouped.confirmLosses);
    const recordIds = targets.map((entry) => entry.sourceRecordId).filter((id): id is string => Boolean(id)).map((id) => (Number.isFinite(Number(id)) ? Number(id) : id));
    trace.add(
      "follow-up",
      "Follow-up: confirm a borderline loss figure",
      `Purpose: ${targets.length} submission(s) fail only on five-year losses with a strong score. Re-reading their claims with reserves before the row is written off.`,
      { targets: targets.length },
    );
    if (recordIds.length) {
      try {
        const result = await runPaged(execute, (offset) => buildConfirmLossesQuery(route, recordIds, offset), trace, options);
        outcome.queries += 1;
        const confirmations = confirmLosses(targets, result.rows, route, plan);
        const changed = confirmations.filter((item) => item.changed);
        outcome.updated.push(...changed.map((item) => item.submissionId));
        trace.add(
          changed.length ? "warning" : "follow-up",
          changed.length ? "Borderline losses disagreed with the first pass" : "Confirmed borderline losses",
          confirmations
            .map((item) => `${item.submissionId}: $${item.paid.toLocaleString("en-US")} paid on ${item.claims} claim(s) in the window, $${item.reserved.toLocaleString("en-US")} still reserved${item.changed ? " (replaced the first-pass figure)" : ""}`)
            .join("; ") || "No matching records were returned.",
          { confirmed: confirmations.length, changed: changed.length },
        );
      } catch (error) {
        trace.add("warning", "Loss confirmation failed", `${error instanceof Error ? error.message : String(error)} The first-pass figure stands.`);
      }
    }
  }

  if (grouped.unaddressed.length) {
    const byFactor = new Map<string, FollowUpGap[]>();
    for (const gap of grouped.unaddressed) byFactor.set(gap.factor, [...(byFactor.get(gap.factor) ?? []), gap]);
    trace.add(
      "follow-up",
      "Gaps with no follow-up available",
      [...byFactor.entries()].map(([factor, list]) => `${factor} on ${list.length} submission(s): ${explainUnaddressed(list[0])}`).join("; ") + ". These stay unknown and are flagged for the underwriter.",
      { gaps: grouped.unaddressed.length },
    );
  }
  return outcome;
}

function describePlan(plan: DataPlan, trace: QueryTrace): void {
  for (const choice of plan.choices) {
    const needs: string[] = [];
    if (choice.expandChain.length) needs.push(`expand ${choice.expandChain.join(" → ")}`);
    if (choice.manyAt.length) needs.push(`fans out at ${choice.manyAt.join(", ")}`);
    if (choice.supporting.length) needs.push(`also projects ${choice.supporting.map((path) => path.slice(path.lastIndexOf(".") + 1)).join(", ")}`);
    trace.add(
      "plan",
      `${choice.label} ← ${plan.rootResource}.${choice.path}`,
      `${choice.appetiteReason} ${choice.reason}${needs.length ? ` Requires ${needs.join("; ")}.` : ""}`,
      { chosenBy: choice.chosenBy },
    );
  }
}

function reportUnresolved(plan: DataPlan, trace: QueryTrace): void {
  for (const missing of plan.unresolved) {
    trace.add(
      "warning",
      `No schema field for ${missing.label}`,
      `${missing.reason} Submissions will carry this factor as unknown rather than assumed.`,
    );
  }
}

/**
 * Asks the API to aggregate TIV server-side and compares it with the value we
 * derived client-side. A mismatch means our array traversal is wrong — the
 * documented failure mode of dot-paths through arrays. The server sums every
 * traversal, so the comparison uses the client's pre-deduplication total.
 */
async function crossCheckTiv(
  execute: QueryExecutor,
  plan: DataPlan,
  assembled: AssembledSubmission[],
  trace: QueryTrace,
  options: RunQueryOptions,
): Promise<void> {
  const compiled = buildTivCheckQuery(plan);
  if (!compiled) return;

  try {
    const result = await runQuery(execute, compiled, trace, options);
    const serverTotals = new Map<string, number>();
    for (const row of result.rows as UnknownRecord[]) {
      const id = asString(row.id);
      const total = asNumber(row.totalTiv);
      if (id && total !== undefined) serverTotals.set(id, total);
    }
    if (serverTotals.size === 0) return;

    // Compare per record, and only where the aggregation found values: a
    // policy with no building schedule legitimately sums to zero server-side.
    let compared = 0;
    let disagreed = 0;
    let worst = 0;
    for (const entry of assembled) {
      const serverTotal = entry.sourceRecordId ? serverTotals.get(entry.sourceRecordId) : undefined;
      if (!serverTotal || entry.undedupedTiv === undefined) continue;
      compared += 1;
      const drift = Math.abs(entry.undedupedTiv - serverTotal) / serverTotal;
      worst = Math.max(worst, drift);
      if (drift > 0.01) disagreed += 1;
    }
    if (compared === 0) return;

    trace.add(
      disagreed > 0 ? "warning" : "derive",
      "Cross-checked TIV against a server-side aggregation",
      disagreed > 0
        ? `${disagreed} of ${compared} records disagree with the API's own $sum by up to ${(worst * 100).toFixed(1)}%, which usually means an array was traversed incorrectly.`
        : `All ${compared} records with a building schedule match the API's own $sum.`,
      { compared, disagreed },
    );
  } catch {
    // The cross-check is diagnostic; runQuery has already recorded the failure.
  }
}
