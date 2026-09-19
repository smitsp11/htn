import type { CanonicalSubmission, FactorKey } from "@/lib/domain/types";

/**
 * Schema-driven query planner (Person 2).
 *
 * This planner targets the REAL Federato schema captured under `raw/schema.json`
 * (shape: `{ output: [ { data: { <Resource>: { fields: { <field>: { type,
 * optional, resource?, cardinality? } } } } } ] }`). The root queue resource is
 * `Submission`; references are joined by numeric id.
 *
 * Each canonical field declares WHY it is needed plus candidate schema paths in
 * real Federato field names (dot-notation across reference joins, including the
 * reverse `Submission <- Policy.submission` relation surfaced as `policy`). The
 * planner resolves each path against the discovered schema, records unresolved
 * fields (never invents them), and emits a `$expand` projection covering insured,
 * policy, policy.exposure_units.location.buildings and policy.claims. `where` /
 * `filter` stay empty so all 158 submissions are retained and appetite is judged
 * client-side. Everything stays overridable via the adapter's env seams.
 */

type UnknownRecord = Record<string, unknown>;

export type FieldContainer = "scalar" | "array" | "reference";

/** One discovered schema field, normalized from the real schema shape. */
export interface DiscoveredField {
  name: string;
  type?: string;
  isArray: boolean;
  isReference: boolean;
  /** Target resource name for references. */
  resource?: string;
}

export interface DiscoveredResource {
  name: string;
  fields: DiscoveredField[];
}

export interface ParsedSchema {
  resources: DiscoveredResource[];
}

/** A single appetite/display data requirement the query must satisfy. */
export interface FieldRequirement {
  canonicalField: keyof CanonicalSubmission;
  /** Set when this requirement backs one of the eight appetite factors. */
  factor?: FactorKey;
  appetiteReason: string;
  container: FieldContainer;
  /** Candidate schema paths, in preference order (real Federato field names). */
  candidatePaths: string[];
  /** Documented aggregation rule when the source is an array of records. */
  aggregation?: string;
  /** Documented `$expand` behavior when the source is a reference. */
  expansionNote?: string;
  /** Documented `$elemMatch` behavior when the source is an array. */
  arrayNote?: string;
}

/** Result of resolving one requirement against the discovered schema. */
export interface PlannedField {
  canonicalField: keyof CanonicalSubmission;
  factor?: FactorKey;
  appetiteReason: string;
  container: FieldContainer;
  candidatePaths: string[];
  /** The candidate path matched in the schema, or undefined when unresolved. */
  matchedPath?: string;
  resolved: boolean;
  unresolvedReason?: string;
  aggregation?: string;
  expansionNote?: string;
  arrayNote?: string;
  /** Developer-facing `$elemMatch` template for targeted array drill-downs. */
  elemMatchExample?: UnknownRecord;
}

export interface QueryPlan {
  resource: string;
  resourceResolved: boolean;
  fields: PlannedField[];
  /** The generated Federato-style query payload (the projection). */
  projection: unknown;
  assumptions: string[];
}

/**
 * Queue resource names, in preference order. `Submission` is the real root; the
 * rest are conservative fallbacks. The first present in the discovered schema
 * wins (matched case-insensitively; the real resource name is preserved).
 */
export const QUEUE_RESOURCE_CANDIDATES = ["submission", "policy", "insured"] as const;

/**
 * The requirements catalogue: display fields plus all eight appetite factors,
 * expressed against the real Submission -> Policy -> ExposureUnit -> Location ->
 * Building / Claim / Insured reference graph.
 */
export const FIELD_REQUIREMENTS: FieldRequirement[] = [
  {
    canonicalField: "id",
    appetiteReason: "Stable identity for de-duplication and linking back to Federato.",
    container: "scalar",
    candidatePaths: ["submission_number", "id"],
  },
  {
    canonicalField: "accountName",
    appetiteReason: "Human-readable label shown to the underwriter.",
    container: "reference",
    candidatePaths: ["insured.name"],
    expansionNote: "$expand Submission.insured -> Insured.name; a bare id stays unknown.",
  },
  {
    canonicalField: "submissionType",
    factor: "submissionType",
    appetiteReason: "Appetite accepts new business and declines renewals.",
    container: "reference",
    candidatePaths: ["policy.business_type"],
    expansionNote: "$expand the policy bound to this submission for Policy.business_type (new/renewal).",
  },
  {
    canonicalField: "lineOfBusiness",
    factor: "lineOfBusiness",
    appetiteReason: "Appetite is scoped to commercial property.",
    container: "scalar",
    candidatePaths: ["line_of_business", "policy.line_of_business"],
  },
  {
    canonicalField: "primaryRiskState",
    factor: "primaryRiskState",
    appetiteReason: "Target/acceptable state list is a hard appetite gate.",
    container: "array",
    candidatePaths: ["policy.exposure_units.location.state"],
    aggregation: "State of the risk location with the greatest summed Building.tiv; fallback the HQ location's state.",
    arrayNote: "Reference joins across exposure_units[] -> location; a targeted state query would need $elemMatch on exposure_units.",
  },
  {
    canonicalField: "effectiveDate",
    appetiteReason: "Policy period context and the trailing-5-year loss window anchor.",
    container: "reference",
    candidatePaths: ["policy.dates.effective", "target_effective_date"],
    expansionNote: "Prefer Policy.dates.effective; fall back to Submission.target_effective_date.",
  },
  {
    canonicalField: "expirationDate",
    appetiteReason: "Policy period context.",
    container: "reference",
    candidatePaths: ["policy.dates.expiration"],
    expansionNote: "$expand the bound policy for Policy.dates.expiration.",
  },
  {
    canonicalField: "tiv",
    factor: "tiv",
    appetiteReason: "Total insured value drives the $50M-$150M appetite band.",
    container: "array",
    candidatePaths: ["policy.exposure_units.location.buildings.tiv"],
    aggregation: "SUM of Building.tiv (fallback Building.building_value) across all risk buildings.",
    arrayNote: "Sums every building across every risk location; no $elemMatch filter so no building is dropped.",
  },
  {
    canonicalField: "totalPremium",
    factor: "totalPremium",
    appetiteReason: "Premium drives the $50K-$175K appetite band.",
    container: "reference",
    candidatePaths: ["policy.premium"],
    expansionNote: "$expand the bound policy for Policy.premium; no policy -> unknown.",
  },
  {
    canonicalField: "buildingYear",
    factor: "buildingYear",
    appetiteReason: "Construction year gates on 1990/2010 thresholds.",
    container: "array",
    candidatePaths: ["policy.exposure_units.location.buildings.year_built"],
    aggregation: "MIN (oldest) Building.year_built across all risk buildings — the conservative worst case.",
    arrayNote: "Reads every building across every risk location; the oldest year governs the verdict.",
  },
  {
    canonicalField: "approvedConstructionPercentage",
    factor: "construction",
    appetiteReason: "More than 50% approved (non-combustible) construction is required.",
    container: "array",
    candidatePaths: ["policy.exposure_units.location.buildings.construction_type"],
    aggregation:
      "TIV-weighted share (0..1) of buildings whose construction_type is approved (JM/non-combustible/steel/fire resistive); equal-weight fallback. The >50% threshold itself is applied in lib/domain/appetite.",
    arrayNote: "Classifies each building's construction_type against the approved set; never infers approval otherwise.",
  },
  {
    canonicalField: "constructionDescription",
    appetiteReason: "Context for the construction verdict shown to the underwriter.",
    container: "array",
    candidatePaths: ["policy.exposure_units.location.buildings.construction_type"],
    aggregation: "Sorted distinct construction_type values across all risk buildings, joined by ', '.",
  },
  {
    canonicalField: "fiveYearLossValue",
    factor: "fiveYearLossValue",
    appetiteReason: "Trailing five-year losses must be under $100K.",
    container: "array",
    candidatePaths: ["policy.claims.paid_indemnity"],
    aggregation:
      "SUM of (Claim.paid_indemnity + Claim.paid_expense) within the trailing 5 years ending at the effective-date year (else newest claim year); undated claims included. 0 when a policy has no qualifying claims; undefined when there is no policy.",
    arrayNote: "Reads every claim on the bound policy; no $elemMatch filter so no claim is dropped.",
  },
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the `fields` map of one resource ({ name: { type, resource?, cardinality? } }). */
function parseFields(rawFields: unknown): DiscoveredField[] {
  if (!isRecord(rawFields)) return [];
  return Object.entries(rawFields).map(([name, value]) => {
    const descriptor = isRecord(value) ? value : {};
    const type = typeof value === "string" ? value : typeof descriptor.type === "string" ? descriptor.type : undefined;
    const lowered = (type ?? "").toLowerCase();
    const isReference = lowered === "reference" || typeof descriptor.resource === "string";
    const isArray = lowered === "array" || descriptor.cardinality === "many";
    const resource = typeof descriptor.resource === "string" ? descriptor.resource : undefined;
    return { name, type, isArray, isReference, resource };
  });
}

function parseResource(name: string, value: unknown): DiscoveredResource {
  if (isRecord(value)) {
    const rawFields = value.fields ?? value.properties ?? value;
    return { name, fields: parseFields(rawFields) };
  }
  return { name, fields: [] };
}

/**
 * Normalize the discovered schema into a flat resource/field list. Unwraps the
 * real `{ output: [ { data: { ... } } ] }` envelope (and a few common wrappers)
 * and tolerates empty/alien inputs without throwing.
 */
export function parseSchema(schema: unknown): ParsedSchema {
  let root: unknown = schema;

  // Unwrap the real capture envelope: output[0].data.
  if (isRecord(root) && Array.isArray(root.output)) {
    const first = root.output[0];
    root = isRecord(first) ? first.data : undefined;
  }
  // Unwrap a few common alternative wrappers.
  if (isRecord(root)) {
    for (const key of ["schema", "data", "result"]) {
      if (root[key] !== undefined) {
        root = root[key];
        break;
      }
    }
  }

  // Array-of-resources shape: [{ name, fields }, ...].
  if (Array.isArray(root)) {
    return {
      resources: root.filter(isRecord).flatMap((entry) => {
        const name = typeof entry.name === "string" ? entry.name : undefined;
        return name ? [parseResource(name, entry)] : [];
      }),
    };
  }

  // Map-of-resources shape: { Submission: { fields: {...} }, ... }.
  if (isRecord(root)) {
    return { resources: Object.entries(root).map(([name, value]) => parseResource(name, value)) };
  }

  return { resources: [] };
}

function resourceByName(parsed: ParsedSchema, name: string | undefined): DiscoveredResource | undefined {
  if (!name) return undefined;
  return parsed.resources.find((resource) => resource.name.toLowerCase() === name.toLowerCase());
}

function fieldByName(resource: DiscoveredResource | undefined, name: string): DiscoveredField | undefined {
  return resource?.fields.find((field) => field.name.toLowerCase() === name.toLowerCase());
}

/**
 * Reverse relations: any resource whose reference field targets the root implies
 * a reverse accessor on the root (Policy.submission -> Submission surfaces as
 * `Submission.policy`). Maps accessor name (lowercased) -> target resource name.
 */
function reverseRelations(parsed: ParsedSchema, rootName: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const resource of parsed.resources) {
    for (const field of resource.fields) {
      if (field.isReference && field.resource && field.resource.toLowerCase() === rootName.toLowerCase()) {
        map.set(resource.name.toLowerCase(), resource.name);
      }
    }
  }
  return map;
}

interface ResolvedSegment {
  name: string;
  isReference: boolean;
  isArray: boolean;
}

interface PathResolution {
  resolved: boolean;
  segments: ResolvedSegment[];
  matchedPath?: string;
  unresolvedReason?: string;
}

/**
 * Resolve a dotted candidate path across the reference graph. Reference segments
 * descend into their target resource; a mid-path `object` field (e.g. Policy.dates)
 * resolves at that object because the schema does not enumerate its interior.
 */
function resolvePath(
  parsed: ParsedSchema,
  rootName: string,
  reverse: Map<string, string>,
  path: string,
): PathResolution {
  const parts = path.split(".");
  const segments: ResolvedSegment[] = [];
  let current = resourceByName(parsed, rootName);

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isLast = index === parts.length - 1;
    const field = fieldByName(current, part);
    const reverseTarget = current ? reverse.get(part.toLowerCase()) : undefined;

    let isReference: boolean;
    let isArray: boolean;
    let target: string | undefined;
    if (field) {
      isReference = field.isReference;
      isArray = field.isArray;
      target = field.resource;
    } else if (reverseTarget) {
      isReference = true;
      isArray = false;
      target = reverseTarget;
    } else {
      return {
        resolved: false,
        segments,
        unresolvedReason: `"${part}" is not a field on ${current?.name ?? "the root resource"}.`,
      };
    }

    segments.push({ name: field?.name ?? part, isReference, isArray });
    if (isLast) return { resolved: true, segments, matchedPath: path };

    if (isReference && target) {
      current = resourceByName(parsed, target);
      if (!current) {
        return { resolved: false, segments, unresolvedReason: `Reference target "${target}" is not in the schema.` };
      }
      continue;
    }
    if (field?.type === "object") {
      // Opaque object: the rest of the path lives inside it; resolve here.
      return { resolved: true, segments, matchedPath: parts.slice(0, index + 1).join(".") };
    }
    return { resolved: false, segments, unresolvedReason: `Cannot traverse into scalar "${part}".` };
  }

  return { resolved: false, segments, unresolvedReason: "Empty path." };
}

function pickResource(parsed: ParsedSchema): { resource: string; resolved: boolean } {
  for (const candidate of QUEUE_RESOURCE_CANDIDATES) {
    const match = parsed.resources.find((resource) => resource.name.toLowerCase() === candidate);
    if (match) return { resource: match.name, resolved: true };
  }
  if (parsed.resources.length > 0) return { resource: parsed.resources[0].name, resolved: false };
  return { resource: "Submission", resolved: false };
}

function elemMatchTemplate(segments: ResolvedSegment[]): UnknownRecord | undefined {
  const arraySegment = segments.find((segment) => segment.isArray);
  if (!arraySegment) return undefined;
  const leaf = segments[segments.length - 1]?.name ?? "value";
  // Demonstrative only: the clause a developer would add to `filter` to drill
  // into a specific array element. It is NOT part of the live projection because
  // filtering here would drop records we must retain for evaluation.
  return { [arraySegment.name]: { $elemMatch: { [leaf]: "<value>" } } };
}

function planField(
  requirement: FieldRequirement,
  parsed: ParsedSchema,
  rootName: string,
  reverse: Map<string, string>,
): PlannedField {
  const base: PlannedField = {
    canonicalField: requirement.canonicalField,
    factor: requirement.factor,
    appetiteReason: requirement.appetiteReason,
    container: requirement.container,
    candidatePaths: requirement.candidatePaths,
    resolved: false,
    aggregation: requirement.aggregation,
    expansionNote: requirement.container === "reference" ? requirement.expansionNote : undefined,
    arrayNote: requirement.container === "array" ? requirement.arrayNote : undefined,
  };

  for (const path of requirement.candidatePaths) {
    const resolution = resolvePath(parsed, rootName, reverse, path);
    if (resolution.resolved) {
      base.resolved = true;
      base.matchedPath = resolution.matchedPath;
      if (requirement.container === "array") base.elemMatchExample = elemMatchTemplate(resolution.segments);
      return base;
    }
  }

  base.unresolvedReason = `No discovered field matched any of: ${requirement.candidatePaths.join(", ")}.`;
  return base;
}

/**
 * Add one resolved reference path to a nested `$expand` select tree. Every
 * non-terminal reference segment becomes `{ $expand: { select: {...} } }`; the
 * terminal leaf is selected with `true`.
 */
function addProjectionPath(select: UnknownRecord, path: string): void {
  const parts = path.split(".");
  let node = select;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      if (!isRecord(node[part])) node[part] = true;
      return;
    }
    const existing = node[part];
    let entry: UnknownRecord;
    if (isRecord(existing) && isRecord(existing.$expand)) {
      entry = existing;
    } else {
      entry = { $expand: { select: {} } };
      node[part] = entry;
    }
    const expand = entry.$expand as UnknownRecord;
    node = expand.select as UnknownRecord;
  });
}

/**
 * Build the query projection from resolved requirements.
 *
 * - Scalars are selected directly (`true`).
 * - References (including the reverse `policy` join and deep chains through
 *   exposure_units -> location -> buildings and policy -> claims) use `$expand`.
 * - `where` (pre-expansion) and `filter` (post-expansion) are intentionally
 *   empty: every submission is retained and appetite is judged client-side.
 */
function buildProjection(resource: string, fields: PlannedField[]): unknown {
  const select: UnknownRecord = {};
  for (const field of fields) {
    if (field.matchedPath) addProjectionPath(select, field.matchedPath);
  }
  return {
    resource,
    select,
    where: {},
    filter: {},
  };
}

/** Turn the discovered schema into a full query plan (projection + trace inputs). */
export function planQuery(schema: unknown): QueryPlan {
  const parsed = parseSchema(schema);
  const { resource, resolved } = pickResource(parsed);
  const reverse = reverseRelations(parsed, resource);
  const fields = FIELD_REQUIREMENTS.map((requirement) => planField(requirement, parsed, resource, reverse));

  const unresolved = fields.filter((field) => !field.resolved).map((field) => field.canonicalField);
  const assumptions = [
    `Root queue resource "${resource}"${resolved ? "" : " (not found in schema; using a fallback)"}.`,
    "References are joined by numeric id; the reverse Policy.submission relation is surfaced as Submission.policy.",
    "Projection $expands insured, policy, policy.exposure_units.location.buildings, and policy.claims.",
    "Projection retains ALL submissions: where/filter are empty by design; appetite is evaluated client-side.",
    "$elemMatch templates are provided for developers but never applied as a live filter.",
    unresolved.length > 0
      ? `Unresolved against the discovered schema (kept visible as unknown): ${unresolved.join(", ")}.`
      : "Every canonical field resolved against the discovered schema.",
  ];

  return {
    resource,
    resourceResolved: resolved,
    fields,
    projection: buildProjection(resource, fields),
    assumptions,
  };
}
