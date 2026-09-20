/**
 * Turns a discovered schema into a data plan: which resource holds the queue,
 * which path answers each appetite requirement, what fetching it costs
 * (expansion, array traversal), and where to look when the risk schedule is
 * empty.
 *
 * The plan is produced from the schema every run. Nothing here hardcodes
 * Federato field names; `requirements.ts` supplies name fragments to search
 * for, and every chosen path is validated back against the live schema.
 */

import {
  REQUIREMENTS,
  REQUIREMENTS_BY_KEY,
  type RequirementKey,
  type RequirementSpec,
} from "./requirements";
import { objectFields, referenceTarget, type LeafPath, type SchemaIndex } from "./schema-index";
import type { QueryTrace } from "./query-trace";

export interface PathCandidate {
  path: string;
  terminalType: string;
  expandChain: string[];
  manyAt: string[];
  score: number;
}

export interface FieldChoice {
  key: RequirementKey;
  label: string;
  appetiteReason: string;
  path?: string;
  terminalType?: string;
  expandChain: string[];
  manyAt: string[];
  /** Sibling paths the derivation reads; already confirmed to exist. */
  supporting: string[];
  reason: string;
  chosenBy: "heuristic" | "llm";
  alternatives: string[];
}

/**
 * Where to look for a location when the risk schedule is empty: a single
 * (non-array) reference from the root to the same resource that holds the
 * risk state — in practice the insured's headquarters.
 */
export interface FallbackLocation {
  /** Path to the location record itself, e.g. `insured.hq`. */
  locationPath: string;
  statePath: string;
  /** Path to the buildings under it, when the schema has any. */
  buildingsPath?: string;
  /** Every leaf the query must project so the fallback can be derived. */
  projectPaths: string[];
  expandChain: string[];
  reason: string;
}

export interface DataPlan {
  rootResource: string;
  /** Resource that represents the queue itself, when the root is not it. */
  queueResource?: string;
  /** Reference field on the root resource that points at the queue resource. */
  queueLinkPath?: string;
  choices: FieldChoice[];
  unresolved: Array<{ key: RequirementKey; label: string; reason: string }>;
  fallback?: FallbackLocation;
  plannedBy: "heuristic" | "llm";
}

/** The plan for the queue resource itself, used for submissions with no policy. */
export interface QueuePlan {
  resource: string;
  choices: FieldChoice[];
  fallback?: FallbackLocation;
}

const MIN_SCORE = 30;

/**
 * Reference hops that lead away from the insured risk. A building at the
 * insured's head office, a broker's region or an underlying carrier's limit all
 * match the same field names as the risk itself and must lose to it.
 */
const OFF_RISK_SEGMENTS = [
  "hq",
  "parent",
  "underlying_layer",
  "producer",
  "broker",
  "contact",
  "underwriter",
];

function scoreCandidate(spec: RequirementSpec, leaf: LeafPath): number {
  const path = leaf.path.toLowerCase();
  const name = leaf.leaf.toLowerCase();

  let best = 0;
  spec.synonyms.forEach((synonym, index) => {
    // Earlier synonyms are the better answer when several match.
    const priority = (spec.synonyms.length - index) * 5;
    const needle = synonym.toLowerCase();
    if (needle.includes(".")) {
      if (path === needle || path.endsWith(`.${needle}`)) best = Math.max(best, 110 + priority);
      return;
    }
    if (name === needle) best = Math.max(best, 100 + priority);
    else if (name.includes(needle)) best = Math.max(best, 65 + priority);
    else if (path.includes(needle)) best = Math.max(best, 45 + priority);
  });
  if (best === 0) return 0;

  let score = best;
  const segments = path.split(".");
  for (const segment of OFF_RISK_SEGMENTS) {
    if (segments.includes(segment)) score -= 45;
  }
  const numeric = leaf.terminalType === "number";
  const textual = leaf.terminalType === "string";
  if (spec.expectedType === "number") score += numeric ? 20 : -60;
  if (spec.expectedType === "string") score += textual ? 20 : -60;

  for (const token of spec.avoid ?? []) {
    if (path.includes(token.toLowerCase())) score -= 70;
  }

  score -= 4 * (leaf.path.split(".").length - 1);
  return score;
}

export function candidatesFor(
  index: SchemaIndex,
  resource: string,
  spec: RequirementSpec,
  limit = 5,
): PathCandidate[] {
  return index
    .leaves(resource)
    .map((leaf) => ({
      path: leaf.path,
      terminalType: leaf.terminalType,
      expandChain: leaf.expandChain,
      manyAt: leaf.manyAt,
      score: scoreCandidate(spec, leaf),
    }))
    .filter((candidate) => candidate.score >= MIN_SCORE)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

/**
 * Picks the resource that answers the most appetite requirements with the
 * fewest reference hops. Depth matters more here than when choosing a field:
 * a claim can reach every policy fact through `claim.policy`, but the policy
 * is the record the queue is made of, not the claim.
 */
export function chooseRootResource(index: SchemaIndex): string {
  const ROOT_DEPTH_PENALTY = 15;
  let best = { resource: index.resources[0] ?? "", coverage: -Infinity };
  for (const resource of index.resources) {
    const coverage = REQUIREMENTS.filter((spec) => spec.required).reduce((total, spec) => {
      const [top] = candidatesFor(index, resource, spec, 1);
      if (!top) return total;
      const depth = top.path.split(".").length - 1;
      return total + Math.min(top.score, 120) - ROOT_DEPTH_PENALTY * depth;
    }, 0);
    if (coverage > best.coverage) best = { resource, coverage };
  }
  return best.resource;
}

/**
 * Finds the resource that represents the submission queue: a single-cardinality
 * reference off the root whose target carries a "received"-style date.
 */
export function findQueueLink(
  index: SchemaIndex,
  rootResource: string,
): { queueResource: string; queueLinkPath: string } | undefined {
  const fields = objectFields(index.raw[rootResource]);
  if (!fields) return undefined;

  for (const [name, node] of Object.entries(fields)) {
    const reference = referenceTarget(node);
    if (!reference || reference.cardinality !== "one") continue;
    const target = reference.resource;
    const looksLikeQueue = index
      .leaves(target, 1)
      .some((leaf) => /received|submitted/.test(leaf.leaf) || /submission/i.test(leaf.leaf));
    if (looksLikeQueue || /submission/i.test(target)) {
      return { queueResource: target, queueLinkPath: name };
    }
  }
  return undefined;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf(".");
  return cut === -1 ? "" : path.slice(0, cut);
}

function leafOf(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1);
}

/** Sibling paths named by the spec that actually exist next to the chosen path. */
export function supportingPaths(
  index: SchemaIndex,
  resource: string,
  path: string,
  spec: RequirementSpec | undefined,
): string[] {
  if (!spec?.supporting) return [];
  const parent = parentOf(path);
  return spec.supporting
    .map((name) => (parent ? `${parent}.${name}` : name))
    .filter((candidate) => candidate !== path && index.resolve(resource, candidate));
}

/** Matches a set of requirements against one resource and its references. */
export function choicesForResource(
  index: SchemaIndex,
  resource: string,
  specs: RequirementSpec[],
): { choices: FieldChoice[]; unresolved: DataPlan["unresolved"] } {
  const choices: FieldChoice[] = [];
  const unresolved: DataPlan["unresolved"] = [];

  for (const spec of specs) {
    const [top, ...rest] = candidatesFor(index, resource, spec);
    if (!top) {
      if (spec.required) {
        unresolved.push({
          key: spec.key,
          label: spec.label,
          reason: `No field in ${resource} or its references matched ${spec.synonyms.join(", ")}.`,
        });
      }
      continue;
    }
    choices.push({
      key: spec.key,
      label: spec.label,
      appetiteReason: spec.appetiteReason,
      path: top.path,
      terminalType: top.terminalType,
      expandChain: top.expandChain,
      manyAt: top.manyAt,
      supporting: supportingPaths(index, resource, top.path, spec),
      reason: `Matched ${resource}.${top.path} (${top.terminalType}).`,
      chosenBy: "heuristic",
      alternatives: rest.map((candidate) => candidate.path),
    });
  }

  return { choices, unresolved };
}

/**
 * Looks for a location reachable from the resource without crossing an array:
 * the place to read a state and buildings from when the risk schedule is
 * empty. The building leaf names come from the plan (or the requirement
 * synonyms), so nothing here assumes a field name either.
 */
export function findFallbackLocation(
  index: SchemaIndex,
  resource: string,
  riskChoices: FieldChoice[],
): FallbackLocation | undefined {
  const riskStatePath = riskChoices.find((choice) => choice.key === "riskState")?.path;
  const stateSpec = REQUIREMENTS_BY_KEY.get("riskState")!;
  const stateLeaf = riskStatePath ? leafOf(riskStatePath) : stateSpec.synonyms[0];

  const candidate = index
    .leaves(resource)
    .filter(
      (leaf) =>
        leaf.leaf === stateLeaf &&
        leaf.terminalType === "string" &&
        leaf.manyAt.length === 0 &&
        leaf.path !== riskStatePath &&
        !(stateSpec.avoid ?? [])
          .filter((token) => token !== "hq")
          .some((token) => leaf.path.includes(token)),
    )
    .sort((left, right) => left.path.split(".").length - right.path.split(".").length)[0];
  if (!candidate) return undefined;

  const locationPath = parentOf(candidate.path);
  if (!locationPath) return undefined;

  const projectPaths = [candidate.path];
  const supportingState = supportingPaths(index, resource, candidate.path, stateSpec);
  projectPaths.push(...supportingState);

  // Buildings under the fallback location: the collection that carries the
  // same leaf the plan uses for building year (or the requirement's synonyms).
  const yearChoice = riskChoices.find((choice) => choice.key === "buildingYear");
  const yearSpec = REQUIREMENTS_BY_KEY.get("buildingYear")!;
  const yearLeaves = yearChoice?.path ? [leafOf(yearChoice.path)] : yearSpec.synonyms;
  const yearLeaf = index
    .leaves(resource)
    .find(
      (leaf) =>
        leaf.path.startsWith(`${locationPath}.`) &&
        yearLeaves.includes(leaf.leaf) &&
        leaf.terminalType === "number",
    );

  let buildingsPath: string | undefined;
  const expandChain = new Set<string>(candidate.expandChain);
  if (yearLeaf) {
    buildingsPath = [...yearLeaf.manyAt].sort((left, right) => right.length - left.length)[0];
    projectPaths.push(yearLeaf.path, ...supportingPaths(index, resource, yearLeaf.path, yearSpec));
    yearLeaf.expandChain.forEach((hop) => expandChain.add(hop));

    const constructionChoice = riskChoices.find((choice) => choice.key === "constructionType");
    const constructionSpec = REQUIREMENTS_BY_KEY.get("constructionType")!;
    const constructionLeaves = constructionChoice?.path
      ? [leafOf(constructionChoice.path)]
      : constructionSpec.synonyms;
    const construction = index
      .leaves(resource)
      .find(
        (leaf) =>
          buildingsPath !== undefined &&
          leaf.path.startsWith(`${buildingsPath}.`) &&
          constructionLeaves.includes(leaf.leaf),
      );
    if (construction) projectPaths.push(construction.path);
  }

  return {
    locationPath,
    statePath: candidate.path,
    buildingsPath,
    projectPaths: [...new Set(projectPaths)],
    expandChain: [...expandChain],
    reason: `${resource}.${locationPath} is the only location reachable without a risk schedule${
      buildingsPath ? ` and carries buildings at ${buildingsPath}` : ""
    }; it stands in, at low confidence, when a submission has no risk locations.`,
  };
}

export function planFromSchema(index: SchemaIndex, trace: QueryTrace): DataPlan {
  const rootResource = chooseRootResource(index);
  const queueLink = findQueueLink(index, rootResource);

  trace.add(
    "plan",
    "Selected the root resource",
    `${rootResource} answers more appetite requirements than any other resource in the schema.`,
    { resources: index.resources.length, root: rootResource },
  );
  if (queueLink) {
    trace.add(
      "plan",
      "Identified the submission queue",
      `${rootResource}.${queueLink.queueLinkPath} points at ${queueLink.queueResource}, which holds the queue itself; submissions without a ${rootResource} are fetched separately so they stay in the queue.`,
    );
  }

  const { choices, unresolved } = choicesForResource(
    index,
    rootResource,
    REQUIREMENTS.filter((spec) => spec.scope !== "queue"),
  );
  const fallback = findFallbackLocation(index, rootResource, choices);
  if (fallback) {
    trace.add("plan", "Planned a fallback location", fallback.reason);
  }

  return { rootResource, ...queueLink, choices, unresolved, fallback, plannedBy: "heuristic" };
}

/** Requirements a submission can answer before it becomes a policy. */
const QUEUE_KEYS: RequirementKey[] = [
  "submissionIdentifier",
  "accountName",
  "lineOfBusiness",
  "effectiveDate",
  "requestedLimit",
];

/**
 * Plans the queue resource on its own terms: the few fields a submission
 * carries before it is bound, plus the same kind of fallback location so an
 * unbound submission is not stateless.
 */
export function planQueueResource(index: SchemaIndex, plan: DataPlan, trace: QueryTrace): QueuePlan | undefined {
  if (!plan.queueResource) return undefined;
  const { choices } = choicesForResource(
    index,
    plan.queueResource,
    REQUIREMENTS.filter((spec) => QUEUE_KEYS.includes(spec.key)),
  );
  const fallback = findFallbackLocation(index, plan.queueResource, plan.choices);
  if (fallback) {
    trace.add(
      "plan",
      "Planned a fallback location for unbound submissions",
      `${plan.queueResource}.${fallback.locationPath} is the only location on a submission with no policy. It is used at low confidence and flagged on every submission that relies on it.`,
    );
  }
  return { resource: plan.queueResource, choices, fallback };
}

export interface LlmSelection {
  key: string;
  path: string | null;
  reason: string;
}

/**
 * Applies the model's field selections on top of the heuristic plan. Any path
 * the schema cannot resolve is rejected and the heuristic choice is kept, so a
 * hallucinated field name can never reach the API.
 */
export function applyLlmSelections(
  plan: DataPlan,
  index: SchemaIndex,
  selections: LlmSelection[],
  trace: QueryTrace,
): DataPlan {
  const byKey = new Map(selections.map((selection) => [selection.key, selection]));
  let accepted = 0;
  let rejected = 0;

  const choices = plan.choices.map((choice) => {
    const selection = byKey.get(choice.key);
    if (!selection?.path || selection.path === choice.path) return choice;

    const resolved = index.resolve(plan.rootResource, selection.path);
    if (!resolved) {
      rejected += 1;
      trace.add(
        "repair",
        `Rejected a model field choice for ${choice.label}`,
        `${plan.rootResource}.${selection.path} does not exist in the discovered schema, so the schema-matched path ${choice.path} was kept.`,
      );
      return choice;
    }

    accepted += 1;
    return {
      ...choice,
      path: resolved.path,
      terminalType: resolved.terminalType,
      expandChain: resolved.expandChain,
      manyAt: resolved.manyAt,
      supporting: supportingPaths(index, plan.rootResource, resolved.path, REQUIREMENTS_BY_KEY.get(choice.key)),
      reason: selection.reason || `Model selected ${plan.rootResource}.${resolved.path}.`,
      chosenBy: "llm" as const,
      alternatives: choice.path ? [choice.path, ...choice.alternatives] : choice.alternatives,
    };
  });

  trace.add(
    "plan",
    "Applied the model's field mapping",
    `${accepted} field choice(s) came from the model and were validated against the schema; ${rejected} were rejected as unresolvable.`,
    { accepted, rejected },
  );

  return { ...plan, choices, plannedBy: accepted > 0 ? "llm" : plan.plannedBy };
}

/** Compact prompt view: every requirement with its schema-matched shortlist. */
export function describePlanForPrompt(index: SchemaIndex, plan: DataPlan): string {
  return REQUIREMENTS.filter((spec) => spec.scope !== "queue").map((spec) => {
    const candidates = candidatesFor(index, plan.rootResource, spec, 6);
    const rendered = candidates.length
      ? candidates.map((candidate) => `${candidate.path} (${candidate.terminalType})`).join(", ")
      : "no schema match";
    return `- ${spec.key} — ${spec.appetiteReason}\n  candidates: ${rendered}`;
  }).join("\n");
}
