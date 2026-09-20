/**
 * Compiles a `DataPlan` into Query Request Body payloads.
 *
 * Stage order is the documented one: where → expand → unwind → filter → over →
 * select → sort → pagination. References are hydrated in the `expand` stage
 * (not with a `$expand` select leaf) because the derivations downstream need to
 * read through them, and array boundaries are never crossed with a dot-path.
 *
 * `where` and `filter` are deliberately empty: every submission is retained and
 * appetite is judged client-side, so nothing is dropped for being out of
 * appetite. `$elemMatch` would be the right tool for a targeted drill-down
 * (for example "locations in FL"), but the queue must be complete.
 */

import type { DataPlan, FallbackLocation, FieldChoice, QueuePlan } from "./schema-planner";

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

/**
 * Adds a dot path to a nested tree. In a `select` tree, narrowing a field that
 * was selected whole keeps its id, or a reference link would come back without
 * the one value that joins it; an `expand` tree lists references only.
 */
function nest(target: Record<string, unknown>, path: string, value: unknown, keepId = false): void {
  const segments = path.split(".").filter(Boolean);
  let cursor = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      const existing = cursor[segment];
      cursor[segment] = existing && typeof existing === "object" ? existing : value;
      return;
    }
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object") cursor[segment] = keepId && existing === true ? { id: true } : {};
    cursor = cursor[segment] as Record<string, unknown>;
  });
}

export function buildExpandStage(
  choices: FieldChoice[],
  fallback?: FallbackLocation,
): Record<string, unknown> | undefined {
  const chains = new Set<string>();
  for (const choice of choices) {
    for (const hop of choice.expandChain) chains.add(hop);
  }
  for (const hop of fallback?.expandChain ?? []) chains.add(hop);
  if (chains.size === 0) return undefined;

  const expand: Record<string, unknown> = {};
  for (const chain of [...chains].sort((left, right) => left.length - right.length)) {
    nest(expand, chain, true);
  }
  return expand;
}

/** Every path a query must project: chosen fields, their supporting siblings, and the fallback. */
export function projectedPaths(
  choices: FieldChoice[],
  fallback?: FallbackLocation,
  extraPaths: string[] = [],
): string[] {
  const paths = new Set<string>(["id", ...extraPaths]);
  for (const choice of choices) {
    if (!choice.path) continue;
    paths.add(choice.path);
    for (const path of choice.supporting) paths.add(path);
  }
  for (const path of fallback?.projectPaths ?? []) paths.add(path);
  return [...paths];
}

export function buildSelectStage(
  choices: FieldChoice[],
  fallback?: FallbackLocation,
  extraPaths: string[] = [],
): Record<string, unknown> {
  const select: Record<string, unknown> = {};
  // Shorter paths first so a reference selected whole (`submission: true`) is
  // not later turned into a nested projection by a longer path under it.
  for (const path of projectedPaths(choices, fallback, extraPaths).sort(
    (left, right) => left.length - right.length,
  )) {
    nest(select, path, true, true);
  }
  return select;
}

const PAGE_LIMIT = 100;

export function buildRootQuery(plan: DataPlan, offset = 0, limit = PAGE_LIMIT): CompiledQuery {
  const expand = buildExpandStage(plan.choices, plan.fallback);
  // The link to the queue record is selected as its id only: an unexpanded
  // reference is an id, and an expanded one keeps its id under this projection.
  const extras = plan.queueLinkPath ? [`${plan.queueLinkPath}.id`] : [];
  const payload: QueryPayload = {
    resource: plan.rootResource,
    ...(expand ? { expand } : {}),
    select: buildSelectStage(plan.choices, plan.fallback, extras),
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

/**
 * Submissions that never became a policy still belong in the queue — they are
 * the ones an underwriter has not acted on yet. They carry fewer fields, so
 * this query asks the queue resource directly and lets the rest stay unknown.
 */
export function buildQueueQuery(
  queuePlan: QueuePlan,
  offset = 0,
  limit = PAGE_LIMIT,
  extraPaths: string[] = [],
): CompiledQuery {
  const expand = buildExpandStage(queuePlan.choices, queuePlan.fallback);

  const payload: QueryPayload = {
    resource: queuePlan.resource,
    ...(expand ? { expand } : {}),
    select: buildSelectStage(queuePlan.choices, queuePlan.fallback, extraPaths),
    pagination: { limit, offset },
  };
  const withoutSelect: QueryPayload = { ...payload };
  delete withoutSelect.select;

  return {
    purpose: `Fetch every ${queuePlan.resource} so unbound submissions stay in the queue`,
    payload,
    fallbacks: [withoutSelect, { resource: queuePlan.resource, pagination: { limit, offset } }],
  };
}

/**
 * Cross-checks the TIV we derive per record against a server-side `$sum`.
 * Disagreement means our array handling is wrong, which is exactly the failure
 * mode the API documentation warns about. The server sums every traversal, so
 * the client compares its pre-deduplication total.
 */
export function buildTivCheckQuery(plan: DataPlan, limit = 500): CompiledQuery | undefined {
  const tiv = plan.choices.find((choice) => choice.key === "tiv" && choice.path);
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
