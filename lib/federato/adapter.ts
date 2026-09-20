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
import { assembleSubmissions, type AssembledSubmission } from "./assemble";
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
  const queue = queuePlan
    ? await runPaged(execute, (offset) => buildQueueQuery(queuePlan, offset), trace, options)
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

  return {
    submissions: assembled.map((entry) => entry.submission),
    assembled,
    plan,
    queuePlan,
    trace: trace.steps,
    traceSummary: trace.summarize(),
    reasoning: buildQueryReasoning(plan, queuePlan, trace.steps),
    totals: { root: root.total, queue: queue?.total, assembled: assembled.length },
  };
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
