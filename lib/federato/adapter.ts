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

import type { CanonicalSubmission } from "@/lib/domain/types";
import { assembleSubmissions, type AssembledSubmission } from "./assemble";
import { selectFieldsWithModel } from "./llm-planner";
import {
  buildQueueQuery,
  buildRootQuery,
  buildTivCheckQuery,
  queueChoicesFor,
  type QueryPayload,
} from "./query-compiler";
import { runPaged, runQuery, type QueryExecutor } from "./query-executor";
import { createTrace, type QueryTrace, type TraceStep } from "./query-trace";
import { asNumber, asString, extractRows, type UnknownRecord } from "./response";
import { buildSchemaIndex, type SchemaIndex } from "./schema-index";
import {
  applyLlmSelections,
  planFromSchema,
  type DataPlan,
  type FieldChoice,
} from "./schema-planner";

export interface QueryAgentDependencies {
  discoverSchema: () => Promise<unknown>;
  execute: QueryExecutor;
  /** Set false to skip the model pass even when an API key is present. */
  useModel?: boolean;
}

export interface QueryAgentResult {
  submissions: CanonicalSubmission[];
  assembled: AssembledSubmission[];
  plan: DataPlan;
  trace: TraceStep[];
  traceSummary: string[];
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

  const root = await runPaged(execute, (offset) => buildRootQuery(plan, offset), trace);

  const queueChoices = plan.queueResource ? queueChoicesFor(index, plan.queueResource) : [];
  if (plan.queueResource) addQueueStateFallback(index, plan.queueResource, queueChoices, trace);

  const queue = plan.queueResource
    ? await runPaged(execute, (offset) => buildQueueQuery(plan, queueChoices, offset)!, trace)
    : undefined;

  const assembled = assembleSubmissions({
    plan,
    rootRows: root.rows,
    queueRows: queue?.rows,
    queueChoices,
  });

  if (queue) {
    const unbound = assembled.length - root.rows.length;
    trace.add(
      "derive",
      "Kept submissions that have no policy yet",
      `${unbound} submission(s) in the queue have no bound policy, so premium, building detail and loss history are unavailable. They stay in the queue with those factors unknown.`,
      { unbound: Math.max(unbound, 0) },
    );
  }

  await crossCheckTiv(execute, plan, index, assembled, trace);
  reportUnresolved(plan, trace);

  return {
    submissions: assembled.map((entry) => entry.submission),
    assembled,
    plan,
    trace: trace.steps,
    traceSummary: trace.summarize(),
    totals: { root: root.total, queue: queue?.total, assembled: assembled.length },
  };
}

function describePlan(plan: DataPlan, trace: QueryTrace): void {
  for (const choice of plan.choices) {
    const needs: string[] = [];
    if (choice.expandChain.length) needs.push(`expand ${choice.expandChain.join(" → ")}`);
    if (choice.manyAt.length) needs.push(`fans out at ${choice.manyAt.join(", ")}`);
    trace.add(
      "plan",
      `${choice.label} ← ${plan.rootResource}.${choice.path}`,
      `${choice.appetiteReason} ${choice.reason}${needs.length ? ` Requires ${needs.join("; ")}.` : ""}`,
      { chosenBy: choice.chosenBy },
    );
  }
}

/**
 * An unbound submission has no risk schedule, so the strict risk-state rule
 * finds nothing. The insured's headquarters state is the only locatable state
 * on the record; it is used as an explicitly low-confidence stand-in rather
 * than leaving the whole queue stateless.
 */
function addQueueStateFallback(
  index: SchemaIndex,
  queueResource: string,
  choices: FieldChoice[],
  trace: QueryTrace,
): void {
  if (choices.some((choice) => choice.key === "riskState")) return;
  const candidate = index
    .leaves(queueResource)
    .filter((leaf) => leaf.leaf === "state" && leaf.terminalType === "string")
    .sort((left, right) => left.path.length - right.path.length)[0];
  if (!candidate) return;

  choices.push({
    key: "riskState",
    label: "Risk state",
    appetiteReason: "Target states are OH, PA, MD, CO, CA and FL; six more are acceptable.",
    path: candidate.path,
    terminalType: candidate.terminalType,
    expandChain: candidate.expandChain,
    manyAt: candidate.manyAt,
    reason: `No risk schedule exists on ${queueResource}, so ${candidate.path} stands in.`,
    chosenBy: "heuristic",
    alternatives: [],
  });
  trace.add(
    "plan",
    "Fell back to a proxy risk state for unbound submissions",
    `${queueResource}.${candidate.path} is the only state on a submission with no risk schedule. It is used as a low-confidence stand-in and flagged on every submission that relies on it.`,
  );
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
 * documented failure mode of dot-paths through arrays.
 */
async function crossCheckTiv(
  execute: QueryExecutor,
  plan: DataPlan,
  index: SchemaIndex,
  assembled: AssembledSubmission[],
  trace: QueryTrace,
): Promise<void> {
  const compiled = buildTivCheckQuery(plan, index);
  if (!compiled) return;

  try {
    const result = await runQuery(execute, compiled, trace);
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
      if (!serverTotal || entry.submission.tiv === undefined) continue;
      compared += 1;
      const drift = Math.abs(entry.submission.tiv - serverTotal) / serverTotal;
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

/* ------------------------------------------------------------------------ */
/* Compatibility shims for the current rankings route.                        */
/* `runQueryAgent` is the real entry point; these keep the existing two-call  */
/* route working until Person 4 switches it over.                             */
/* ------------------------------------------------------------------------ */

let lastPlan: { index: SchemaIndex; plan: DataPlan; queueChoices: FieldChoice[] } | undefined;

/** Builds the production query from the discovered schema, with no env-var seam. */
export function buildQueryPayload(schema: unknown): QueryPayload {
  const index = buildSchemaIndex(schema);
  const trace = createTrace();
  const plan = planFromSchema(index, trace);
  lastPlan = { index, plan, queueChoices: [] };
  return buildRootQuery(plan, 0, 500).payload;
}

/** Normalizes a response produced by the payload `buildQueryPayload` returned. */
export function normalizeQueryResponse(raw: unknown): CanonicalSubmission[] {
  if (!lastPlan) {
    throw new Error("Call buildQueryPayload(schema) before normalizeQueryResponse, or use runQueryAgent.");
  }
  return assembleSubmissions({ plan: lastPlan.plan, rootRows: extractRows(raw) }).map(
    (entry) => entry.submission,
  );
}
