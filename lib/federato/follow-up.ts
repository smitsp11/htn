/**
 * Adaptive second pass: once the queue has been ranked, the rows the appetite
 * check could not decide are sent back here with the factor that is missing,
 * and the agent plans a focused query for each gap it has a schema route for.
 *
 * Everything is schema-driven and deterministic:
 * - the route from a queue record to the insured's prior terms and their
 *   claims is resolved from the discovered schema, never hardcoded;
 * - each kind of follow-up runs at most once per pass, batched over every
 *   affected row, so the pass is bounded and never re-queries a gap;
 * - a gap that stays open is reported with what was tried, so an "unknown"
 *   downstream reads as "not in the data" rather than "not looked for".
 *
 * Person 3's scorer never sees any of this directly: the follow-up only
 * patches `CanonicalSubmission` values and records how it derived them.
 */

import type { CanonicalSubmission, FactorKey } from "@/lib/domain/types";
import { deriveLosses, type AssembledSubmission, type DerivationNote } from "./assemble";
import type { CompiledQuery, QueryPayload } from "./query-compiler";
import { referenceTarget, objectFields, type SchemaIndex } from "./schema-index";
import type { DataPlan, QueuePlan } from "./schema-planner";
import type { QueryTrace } from "./query-trace";
import { asString, collectPath, getPath, isRecord, type UnknownRecord } from "./response";

/** One factor the ranking could not settle for one submission. */
export interface FollowUpGap {
  submissionId: string;
  factor: FactorKey;
  /** Why the row was selected: the factor is unknown, or it is the only failing factor on a strong row. */
  reason: "unknown" | "near_miss";
}

export type FollowUpKind = "priorTermLosses" | "confirmLosses";

/** The schema route from a queue record to the insured's prior terms and their claims. */
export interface PriorTermRoute {
  rootResource: string;
  /** Reference on the root resource to the insured-like resource, e.g. `insured`. */
  rootInsuredPath: string;
  /** Reference on the queue resource to the same resource, e.g. `insured`. */
  queueInsuredPath: string;
  insuredResource: string;
  /** Reference on the root that fans out to claims, e.g. `claims`. */
  claimsPath: string;
  /** Leaves under the claims reference the loss derivation reads. */
  claimLeaves: string[];
  /** Scalar paths on the root that describe a prior term in the trace. */
  termPaths: string[];
}

export interface FollowUpQuery {
  kind: FollowUpKind;
  compiled: (offset: number) => CompiledQuery;
  /** Submission ids the query is meant to resolve. */
  targets: string[];
}

const PAGE_LIMIT = 100;
export const MAX_FOLLOW_UP_QUERIES = 5;

function parentOf(path: string): string {
  const cut = path.lastIndexOf(".");
  return cut === -1 ? "" : path.slice(0, cut);
}

/**
 * Finds how the queue reaches an insured and how the root reaches its claims.
 * Returns undefined, with the reason on the trace, when the schema has no such
 * route; the follow-up then leaves the factor unknown rather than guessing.
 */
export function planPriorTermRoute(
  index: SchemaIndex,
  plan: DataPlan,
  queuePlan: QueuePlan | undefined,
  trace: QueryTrace,
): PriorTermRoute | undefined {
  const fail = (reason: string) => {
    trace.add("warning", "No route to prior-term losses", `${reason} Submissions without a policy keep their loss history unknown.`);
    return undefined;
  };
  if (!queuePlan) return fail("The schema has no separate queue resource, so every submission already carries its own claims.");

  const account = plan.choices.find((choice) => choice.key === "accountName" && choice.path);
  const rootInsuredPath = account ? parentOf(account.path!) : "";
  const rootInsured = rootInsuredPath ? index.resolve(plan.rootResource, rootInsuredPath) : undefined;
  const rootFields = objectFields(index.raw[plan.rootResource]);
  const rootInsuredNode = rootFields?.[rootInsuredPath];
  const insuredTarget = referenceTarget(rootInsuredNode);
  if (!rootInsured || !insuredTarget || insuredTarget.cardinality !== "one") {
    return fail(`The account name was not read through a single reference on ${plan.rootResource}, so there is no insured to look up prior terms for.`);
  }

  const queueFields = objectFields(index.raw[queuePlan.resource]) ?? {};
  const queueInsuredPath = Object.entries(queueFields).find(([, node]) => {
    const reference = referenceTarget(node);
    return reference?.resource === insuredTarget.resource && reference.cardinality === "one";
  })?.[0];
  if (!queueInsuredPath) return fail(`${queuePlan.resource} has no reference to ${insuredTarget.resource}.`);

  const loss = plan.choices.find((choice) => choice.key === "lossAmount" && choice.path);
  const claimsPath = loss?.manyAt[loss.manyAt.length - 1];
  if (!loss?.path || !claimsPath) return fail(`${plan.rootResource} has no claims collection the loss derivation can read.`);

  const claimLeaves = new Set<string>([loss.path, ...loss.supporting]);
  const lossDate = plan.choices.find((choice) => choice.key === "lossDate" && choice.path);
  if (lossDate?.path) claimLeaves.add(lossDate.path);
  for (const leaf of index.leaves(plan.rootResource)) {
    if (leaf.path.startsWith(`${claimsPath}.`) && leaf.manyAt.length === 1 && /reserve/i.test(leaf.leaf) && leaf.terminalType === "number") {
      claimLeaves.add(leaf.path);
    }
  }

  const termPaths = ["id", rootInsuredPath];
  for (const key of ["lineOfBusiness", "submissionType", "effectiveDate"] as const) {
    const choice = plan.choices.find((item) => item.key === key && item.path && item.manyAt.length === 0);
    if (choice?.path) termPaths.push(choice.path);
  }

  const route: PriorTermRoute = {
    rootResource: plan.rootResource,
    rootInsuredPath,
    queueInsuredPath,
    insuredResource: insuredTarget.resource,
    claimsPath,
    claimLeaves: [...claimLeaves],
    termPaths,
  };
  trace.add(
    "plan",
    "Planned a route to prior-term losses for unbound submissions",
    `${queuePlan.resource}.${queueInsuredPath} names the ${insuredTarget.resource}; ${plan.rootResource}.${rootInsuredPath} links every prior term back to it, and ${plan.rootResource}.${claimsPath} carries their claims. Used only when the first pass leaves a loss history unknown.`,
  );
  return route;
}

function nest(target: Record<string, unknown>, path: string): void {
  const segments = path.split(".");
  let cursor = target;
  segments.forEach((segment, position) => {
    if (position === segments.length - 1) {
      if (!(segment in cursor)) cursor[segment] = true;
      return;
    }
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object") cursor[segment] = existing === true ? { id: true } : {};
    cursor = cursor[segment] as Record<string, unknown>;
  });
}

function selectFor(paths: string[]): Record<string, unknown> {
  const select: Record<string, unknown> = {};
  for (const path of [...paths].sort((left, right) => left.length - right.length)) nest(select, path);
  return select;
}

/** Every term the insureds hold, with their claims: one batched query for all targets. */
export function buildPriorTermQuery(route: PriorTermRoute, insuredIds: unknown[], offset = 0, limit = PAGE_LIMIT): CompiledQuery {
  const payload: QueryPayload = {
    resource: route.rootResource,
    where: { [route.rootInsuredPath]: { $in: insuredIds } },
    expand: { [route.claimsPath]: true },
    select: selectFor([...route.termPaths, ...route.claimLeaves]),
    pagination: { limit, offset },
  };
  const withoutSelect: QueryPayload = { ...payload };
  delete withoutSelect.select;
  return {
    purpose: `Follow-up: prior terms and claims for ${insuredIds.length} insured(s) whose submission has no policy`,
    payload,
    fallbacks: [withoutSelect],
  };
}

/** The claims behind specific root records, re-read with reserves so a borderline loss can be confirmed. */
export function buildConfirmLossesQuery(route: PriorTermRoute, recordIds: unknown[], offset = 0, limit = PAGE_LIMIT): CompiledQuery {
  const payload: QueryPayload = {
    resource: route.rootResource,
    where: { id: { $in: recordIds } },
    expand: { [route.claimsPath]: true },
    select: selectFor(["id", ...route.claimLeaves]),
    pagination: { limit, offset },
  };
  const withoutSelect: QueryPayload = { ...payload };
  delete withoutSelect.select;
  return {
    purpose: `Follow-up: re-read claims with reserves for ${recordIds.length} borderline record(s)`,
    payload,
    fallbacks: [withoutSelect],
  };
}

function referenceId(value: unknown): unknown {
  if (isRecord(value)) return value.id;
  return value;
}

/** The insured behind each unbound queue row, read from the projection the queue query carried. */
export function insuredIdsFor(queueRows: UnknownRecord[], route: PriorTermRoute): Map<string, unknown> {
  const byQueueId = new Map<string, unknown>();
  for (const row of queueRows) {
    const id = asString(row.id);
    const insured = referenceId(getPath(row, route.queueInsuredPath));
    if (id && insured !== undefined && insured !== null) byQueueId.set(id, insured);
  }
  return byQueueId;
}

export interface PriorTermMerge {
  /** Submission ids whose loss value was set. */
  resolved: string[];
  /** Submission ids that still have no loss history, with why. */
  unresolved: Array<{ submissionId: string; reason: string }>;
}

function dedupeById(records: UnknownRecord[]): UnknownRecord[] {
  const seen = new Set<string>();
  const output: UnknownRecord[] = [];
  for (const record of records) {
    const id = asString(record.id);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    output.push(record);
  }
  return output;
}

/**
 * Attaches prior-term losses to the unbound submissions that were targeted.
 * Every line of business the insured holds counts, because the guidelines
 * bound the loss history by time, not by line; the note says so.
 */
export function mergePriorTermLosses(
  targets: AssembledSubmission[],
  insuredByQueueId: Map<string, unknown>,
  termRows: UnknownRecord[],
  route: PriorTermRoute,
  plan: DataPlan,
): PriorTermMerge {
  const termsByInsured = new Map<string, UnknownRecord[]>();
  for (const row of termRows) {
    const insured = asString(referenceId(getPath(row, route.rootInsuredPath)));
    if (!insured) continue;
    const list = termsByInsured.get(insured) ?? [];
    list.push(row);
    termsByInsured.set(insured, list);
  }

  const lineChoice = plan.choices.find((choice) => choice.key === "lineOfBusiness" && choice.path);
  const result: PriorTermMerge = { resolved: [], unresolved: [] };

  for (const entry of targets) {
    const { submission } = entry;
    const insured = entry.sourceRecordId ? insuredByQueueId.get(entry.sourceRecordId) : undefined;
    if (insured === undefined) {
      result.unresolved.push({ submissionId: submission.id, reason: "The queue record names no insured to look prior terms up for." });
      continue;
    }
    const terms = termsByInsured.get(String(insured)) ?? [];
    if (terms.length === 0) {
      entry.notes.push({
        field: "fiveYearLossValue",
        method: "Looked for prior terms held by this insured and found none, so no loss history exists in the data yet.",
        sourcePath: `${route.rootResource}.${route.rootInsuredPath}`,
        confidence: "high",
      });
      result.unresolved.push({ submissionId: submission.id, reason: "This insured holds no prior term with us; the loss history is not in the data." });
      continue;
    }

    const claims = dedupeById(terms.flatMap((term) => collectPath(term, route.claimsPath).filter(isRecord)));
    const notes: DerivationNote[] = [];
    const total = deriveLosses(claims, submission.effectiveDate, plan.choices, notes);
    const lines = [...new Set(terms.map((term) => (lineChoice?.path ? asString(getPath(term, lineChoice.path)) : undefined)).filter(Boolean))];
    const base = notes.find((note) => note.field === "fiveYearLossValue");
    entry.notes.push({
      field: "fiveYearLossValue",
      method: `Follow-up: ${base?.method ?? `Summed ${claims.length} claim(s).`} The claims come from ${terms.length} prior term(s) this insured holds with us${
        lines.length ? ` across every line of business (${lines.join(", ")})` : ""
      }, because the guidelines bound the loss history by time, not by line. This submission itself has no bound policy.`,
      sourcePath: `${route.rootResource}.${route.claimsPath}`,
      confidence: "medium",
      ambiguity: base?.ambiguity ?? "Losses on other lines may not predict property losses; an underwriter should weigh them.",
    });
    submission.fiveYearLossValue = total;
    result.resolved.push(submission.id);
  }
  return result;
}

export interface LossConfirmation {
  submissionId: string;
  paid: number;
  reserved: number;
  claims: number;
  /** True when the re-read disagrees with the value the first pass derived. */
  changed: boolean;
}

/**
 * Re-derives a borderline row's losses from a fresh read of its claims and
 * reports open reserves, so the trace can say whether the figure is settled.
 */
export function confirmLosses(
  targets: AssembledSubmission[],
  rows: UnknownRecord[],
  route: PriorTermRoute,
  plan: DataPlan,
): LossConfirmation[] {
  const byId = new Map(rows.map((row) => [asString(row.id) ?? "", row]));
  const reserveLeaves = route.claimLeaves.filter((path) => /reserve/i.test(path)).map((path) => path.slice(path.lastIndexOf(".") + 1));
  const confirmations: LossConfirmation[] = [];

  for (const entry of targets) {
    const row = entry.sourceRecordId ? byId.get(entry.sourceRecordId) : undefined;
    if (!row) continue;
    const claims = dedupeById(collectPath(row, route.claimsPath).filter(isRecord));
    const notes: DerivationNote[] = [];
    const paid = deriveLosses(claims, entry.submission.effectiveDate, plan.choices, notes);
    let reserved = 0;
    for (const claim of claims) {
      for (const leaf of reserveLeaves) {
        const value = claim[leaf];
        if (typeof value === "number" && Number.isFinite(value)) reserved += value;
      }
    }
    const changed = entry.submission.fiveYearLossValue !== paid;
    if (changed) entry.submission.fiveYearLossValue = paid;
    entry.notes.push({
      field: "fiveYearLossValue",
      method: `Follow-up: re-read ${claims.length} claim(s) to confirm the borderline loss figure${changed ? "; the fresh read differs from the first pass and replaces it" : "; it matches the first pass"}. $${reserved.toLocaleString("en-US")} is still reserved on these claims.`,
      sourcePath: `${route.rootResource}.${route.claimsPath}`,
      confidence: "high",
      ambiguity: reserved > 0 ? "Open reserves mean the paid figure can only grow." : undefined,
    });
    confirmations.push({ submissionId: entry.submission.id, paid, reserved, claims: claims.length, changed });
  }
  return confirmations;
}

/** Which gaps this module can act on, grouped by the follow-up kind that answers them. */
export function groupGaps(gaps: FollowUpGap[]): {
  priorTermLosses: string[];
  confirmLosses: string[];
  unaddressed: FollowUpGap[];
} {
  const priorTermLosses = new Set<string>();
  const confirmLosses = new Set<string>();
  const unaddressed: FollowUpGap[] = [];
  for (const gap of gaps) {
    if (gap.factor === "fiveYearLossValue" && gap.reason === "unknown") priorTermLosses.add(gap.submissionId);
    else if (gap.factor === "fiveYearLossValue" && gap.reason === "near_miss") confirmLosses.add(gap.submissionId);
    else unaddressed.push(gap);
  }
  return { priorTermLosses: [...priorTermLosses], confirmLosses: [...confirmLosses], unaddressed };
}

/** Why a gap has no follow-up, in words an underwriter can act on. */
export function explainUnaddressed(gap: FollowUpGap): string {
  switch (gap.factor) {
    case "totalPremium":
      return "no premium exists before a quote is issued, so nothing in the data can answer it";
    case "submissionType":
      return "new-versus-renewal is recorded on the policy, which does not exist yet";
    default:
      return "no follow-up query is defined for this factor";
  }
}

/** Submissions the follow-up should work on, in queue order, keyed by id. */
export function pickTargets(assembled: AssembledSubmission[], ids: string[]): AssembledSubmission[] {
  const wanted = new Set(ids);
  return assembled.filter((entry) => wanted.has(entry.submission.id));
}
