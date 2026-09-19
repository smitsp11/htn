/**
 * Compiles a `DataPlan` into Query Request Body payloads.
 *
 * Stage order is the documented one: where → expand → unwind → filter → over →
 * select → sort → pagination. References are hydrated in the `expand` stage
 * (not with a `$expand` select leaf) because the derivations downstream need to
 * read through them, and array boundaries are never crossed with a dot-path.
 */

import type { DataPlan, FieldChoice } from "./schema-planner";
import type { RequirementKey } from "./requirements";
import type { SchemaIndex } from "./schema-index";
import { REQUIREMENTS } from "./requirements";
import { choicesForResource } from "./schema-planner";

export interface QueryPayload {
  resource: string;
  where?: Record<string, unknown>;
  expand?: Record<string, unknown>;
  unwind?: string[];
  filter?: Record<string, unknown>;
  over?: string[];
  select?: Record<string, unknown>;
  sort?: Array<{ field: string; direction?: "asc" | "desc" }>;
  pagination?: { limit: number; offset?: number };
}

export interface CompiledQuery {
  /** Human-readable purpose, shown in the trace. */
  purpose: string;
  payload: QueryPayload;
  /** Progressively simpler payloads to retry with if the API rejects this one. */
  fallbacks: QueryPayload[];
}

function nest(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".").filter(Boolean);
  let cursor = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      const existing = cursor[segment];
      cursor[segment] = existing && typeof existing === "object" ? existing : value;
      return;
    }
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object") cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  });
}

export function buildExpandStage(choices: FieldChoice[]): Record<string, unknown> | undefined {
  const chains = new Set<string>();
  for (const choice of choices) {
    for (const hop of choice.expandChain) chains.add(hop);
  }
  if (chains.size === 0) return undefined;

  const expand: Record<string, unknown> = {};
  for (const chain of [...chains].sort((left, right) => left.length - right.length)) {
    nest(expand, chain, true);
  }
  return expand;
}

function buildSelectStage(
  choices: FieldChoice[],
  extraPaths: string[] = [],
): Record<string, unknown> {
  const select: Record<string, unknown> = { id: true };
  for (const path of extraPaths) nest(select, path, true);
  for (const choice of choices) {
    if (choice.path) nest(select, choice.path, true);
  }
  return select;
}

const PAGE_LIMIT = 100;

export function buildRootQuery(plan: DataPlan, offset = 0, limit = PAGE_LIMIT): CompiledQuery {
  const expand = buildExpandStage(plan.choices);
  const extras = plan.queueLinkPath ? [plan.queueLinkPath] : [];
  const payload: QueryPayload = {
    resource: plan.rootResource,
    ...(expand ? { expand } : {}),
    select: buildSelectStage(plan.choices, extras),
    pagination: { limit, offset },
  };

  // If the projection is rejected, ask for whole records rather than give up:
  // correctness of the queue matters more than payload size.
  const withoutSelect: QueryPayload = { ...payload };
  delete withoutSelect.select;
  const withoutExpand: QueryPayload = { resource: plan.rootResource, pagination: { limit, offset } };

  return {
    purpose: `Fetch ${plan.rootResource} records with the fields the appetite guidelines require`,
    payload,
    fallbacks: [withoutSelect, withoutExpand],
  };
}

/** Requirements a submission can answer before it becomes a policy. */
const QUEUE_KEYS: RequirementKey[] = [
  "submissionIdentifier",
  "accountName",
  "lineOfBusiness",
  "riskState",
  "effectiveDate",
  "tiv",
];

export function queueChoicesFor(index: SchemaIndex, queueResource: string): FieldChoice[] {
  return choicesForResource(
    index,
    queueResource,
    REQUIREMENTS.filter((spec) => QUEUE_KEYS.includes(spec.key)),
  ).choices;
}

/**
 * Submissions that never became a policy still belong in the queue — they are
 * the ones an underwriter has not acted on yet. They carry fewer fields, so
 * this query asks the queue resource directly and lets the rest stay unknown.
 */
export function buildQueueQuery(
  plan: DataPlan,
  choices: FieldChoice[],
  offset = 0,
  limit = PAGE_LIMIT,
): CompiledQuery | undefined {
  if (!plan.queueResource) return undefined;

  const expand = buildExpandStage(choices);

  const payload: QueryPayload = {
    resource: plan.queueResource,
    ...(expand ? { expand } : {}),
    select: buildSelectStage(choices),
    pagination: { limit, offset },
  };
  const withoutSelect: QueryPayload = { ...payload };
  delete withoutSelect.select;

  return {
    purpose: `Fetch every ${plan.queueResource} so unbound submissions stay in the queue`,
    payload,
    fallbacks: [withoutSelect, { resource: plan.queueResource, pagination: { limit, offset } }],
  };
}

/**
 * Cross-checks the TIV we derive per record against a server-side `$sum`.
 * Disagreement means our array handling is wrong, which is exactly the failure
 * mode the API documentation warns about.
 */
export function buildTivCheckQuery(
  plan: DataPlan,
  index: SchemaIndex,
  limit = 500,
): CompiledQuery | undefined {
  const tiv = aggregationSourceForTiv(plan, index);
  if (!tiv?.path || tiv.manyAt.length === 0) return undefined;

  const expand = buildExpandStage([tiv]);
  const payload: QueryPayload = {
    resource: plan.rootResource,
    ...(expand ? { expand } : {}),
    unwind: tiv.manyAt,
    over: ["id"],
    select: { id: true, totalTiv: { $sum: tiv.path } },
    pagination: { limit },
  };

  return {
    purpose: "Cross-check derived TIV against a server-side aggregation",
    payload,
    fallbacks: [],
  };
}

/**
 * The cross-check has to aggregate the same values the derivation sums, which
 * is per-building insured value whenever the schedule exposes it.
 */
function aggregationSourceForTiv(
  plan: DataPlan,
  index: SchemaIndex,
): FieldChoice | undefined {
  const tiv = plan.choices.find((choice) => choice.key === "tiv" && choice.path);
  const buildings = plan.choices.find(
    (choice) => (choice.key === "buildingYear" || choice.key === "constructionType") && choice.path,
  );

  const buildingsPrefix = buildings?.path?.replace(/\.[^.]+$/, "");
  if (buildingsPrefix) {
    const resolved = index.resolve(plan.rootResource, `${buildingsPrefix}.tiv`);
    if (resolved?.terminalType === "number") {
      return {
        ...buildings!,
        key: "tiv",
        path: resolved.path,
        terminalType: resolved.terminalType,
        expandChain: resolved.expandChain,
        manyAt: resolved.manyAt,
      };
    }
  }
  return tiv;
}
