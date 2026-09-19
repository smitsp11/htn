import type { CanonicalSubmission, FactorKey } from "@/lib/domain/types";

/**
 * Schema-driven query planner (Person 2).
 *
 * The live Federato schema and Query Request Body shapes are UNDOCUMENTED in the
 * supplied PDFs (they show the endpoint, actions, and the `$elemMatch` / `$expand`
 * / `where` vs `filter` pitfalls, but not real resource or field names). Everything
 * marked `ASSUMED` below is a realistic, clearly-labelled guess that the planner
 * verifies against the *discovered* schema at runtime and that stays overridable
 * (the adapter's `FEDERATO_QUERY_PAYLOAD_JSON` / `FEDERATO_FIELD_MAP_JSON` seams
 * win over anything generated here). We never present these names as authoritative.
 *
 * The planner turns appetite REQUIREMENTS into a query projection instead of
 * hand-writing a query per submission: each canonical field declares why it is
 * needed and a set of candidate schema paths; the planner resolves each against
 * the discovered schema and emits `$expand` for references and (for developers)
 * the `$elemMatch` clause it would use to drill into an array.
 */

type UnknownRecord = Record<string, unknown>;

export type FieldContainer = "scalar" | "array" | "reference";

/** One discovered schema field, normalized from whatever shape the API returns. */
export interface DiscoveredField {
  name: string;
  type?: string;
  isArray: boolean;
  isReference: boolean;
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
  /** ASSUMED candidate schema paths, in preference order (dot notation). */
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
 * ASSUMED queue resource names, in preference order. The first present in the
 * discovered schema wins; otherwise we fall back to the first discovered
 * resource, then to the literal "submissions".
 */
export const QUEUE_RESOURCE_CANDIDATES = [
  "submissions",
  "submission",
  "accounts",
  "account",
  "policies",
  "policy",
] as const;

/**
 * The requirements catalogue: display fields plus all eight appetite factors.
 * Multiple candidate paths per field mean a renamed-but-recognisable schema
 * still resolves, while a genuinely alien schema surfaces as `unresolved`
 * (never dropped, never invented).
 */
export const FIELD_REQUIREMENTS: FieldRequirement[] = [
  {
    canonicalField: "id",
    appetiteReason: "Stable identity for de-duplication and linking back to Federato.",
    container: "scalar",
    candidatePaths: ["id", "submissionId", "accountId", "uuid"],
  },
  {
    canonicalField: "accountName",
    appetiteReason: "Human-readable label shown to the underwriter.",
    container: "reference",
    candidatePaths: ["accountName", "account.name", "insured.name", "name"],
    expansionNote: "If `account`/`insured` is a reference, $expand its `name`; an unexpanded id stays unknown.",
  },
  {
    canonicalField: "submissionType",
    factor: "submissionType",
    appetiteReason: "Appetite accepts new business and declines renewals.",
    container: "scalar",
    candidatePaths: ["submissionType", "type", "businessType"],
  },
  {
    canonicalField: "lineOfBusiness",
    factor: "lineOfBusiness",
    appetiteReason: "Appetite is scoped to commercial property.",
    container: "scalar",
    candidatePaths: ["lineOfBusiness", "line", "lob", "product"],
  },
  {
    canonicalField: "primaryRiskState",
    factor: "primaryRiskState",
    appetiteReason: "Target/acceptable state list is a hard appetite gate.",
    container: "array",
    candidatePaths: ["primaryRiskState", "locations.state", "riskState", "locations.address.state"],
    aggregation: "Primary location's state: isPrimary===true, else largest-TIV location, else first.",
    arrayNote: "Dot-paths do not traverse arrays; a targeted state query needs $elemMatch on `locations`.",
  },
  {
    canonicalField: "effectiveDate",
    appetiteReason: "Policy period context and the trailing-5-year loss window anchor.",
    container: "scalar",
    candidatePaths: ["effectiveDate", "policyEffectiveDate", "period.effective"],
  },
  {
    canonicalField: "expirationDate",
    appetiteReason: "Policy period context.",
    container: "scalar",
    candidatePaths: ["expirationDate", "policyExpirationDate", "period.expiration"],
  },
  {
    canonicalField: "tiv",
    factor: "tiv",
    appetiteReason: "Total insured value drives the $50M-$150M appetite band.",
    container: "array",
    candidatePaths: ["tiv", "totalInsuredValue", "locations.tiv", "locations.values.totalInsuredValue"],
    aggregation: "SUM of every location's TIV (location.tiv, else its buildings' values).",
    arrayNote: "Sum spans all `locations`; no $elemMatch filter is applied so no location is dropped.",
  },
  {
    canonicalField: "totalPremium",
    factor: "totalPremium",
    appetiteReason: "Premium drives the $50K-$175K appetite band.",
    container: "scalar",
    candidatePaths: ["totalPremium", "premium", "premiumAmount", "layers.premium"],
    aggregation: "Scalar premium; if premium is split across layers, SUM the layer premiums.",
  },
  {
    canonicalField: "buildingYear",
    factor: "buildingYear",
    appetiteReason: "Construction year gates on 1990/2010 thresholds.",
    container: "array",
    candidatePaths: ["buildingYear", "yearBuilt", "locations.buildings.yearBuilt", "locations.yearBuilt"],
    aggregation: "MIN (oldest) yearBuilt across all buildings — the conservative worst case.",
    arrayNote: "Reads every building across every location; oldest year governs the verdict.",
  },
  {
    canonicalField: "approvedConstructionPercentage",
    factor: "construction",
    appetiteReason: "More than 50% approved construction is required.",
    container: "array",
    candidatePaths: [
      "approvedConstructionPercentage",
      "locations.buildings.approvedConstruction",
      "locations.buildings.constructionApproved",
    ],
    aggregation:
      "Value-weighted share of buildings flagged approved by the source (sum(value where approved)/sum(value)); count-weighted fallback. Appetite thresholds are NOT applied here.",
    arrayNote: "Aggregates a source-provided approval flag across buildings; never infers approval itself.",
  },
  {
    canonicalField: "constructionDescription",
    appetiteReason: "Context for the construction verdict shown to the underwriter.",
    container: "array",
    candidatePaths: [
      "constructionDescription",
      "locations.buildings.constructionType",
      "locations.buildings.constructionClass",
    ],
    aggregation: "Sorted distinct construction types across all buildings, joined by ', '.",
  },
  {
    canonicalField: "fiveYearLossValue",
    factor: "fiveYearLossValue",
    appetiteReason: "Trailing five-year losses must be under $100K.",
    container: "array",
    candidatePaths: ["fiveYearLossValue", "lossHistory.amount", "losses.amount", "claims.amount"],
    aggregation:
      "SUM of loss amounts within the trailing 5 years (window anchored on effectiveDate year, else the newest loss year); undated losses are summed in full.",
    arrayNote: "Reads every loss record; no $elemMatch filter is applied so no loss is dropped.",
  },
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifyType(type: string | undefined, hints: { ref?: boolean; array?: boolean }) {
  const lowered = (type ?? "").toLowerCase();
  const isArray = hints.array === true || lowered.includes("array") || lowered.includes("list") || lowered.includes("[]");
  const isReference =
    hints.ref === true || lowered.includes("ref") || lowered.includes("relation") || lowered.includes("foreign");
  return { isArray, isReference };
}

function parseFields(rawFields: unknown): DiscoveredField[] {
  // Array-of-field-objects shape: [{ name, type, ref?, array? }, ...]
  if (Array.isArray(rawFields)) {
    return rawFields.filter(isRecord).flatMap((field) => {
      const name = typeof field.name === "string" ? field.name : undefined;
      if (!name) return [];
      const type = typeof field.type === "string" ? field.type : undefined;
      const { isArray, isReference } = classifyType(type, {
        ref: field.reference === true || typeof field.ref === "string" || typeof field.references === "string",
        array: field.array === true || field.isArray === true || field.repeated === true,
      });
      return [{ name, type, isArray, isReference }];
    });
  }
  // Map-of-fields shape: { fieldName: { type, ... } } or { fieldName: "string" }.
  if (isRecord(rawFields)) {
    return Object.entries(rawFields).map(([name, value]) => {
      const descriptor = isRecord(value) ? value : {};
      const type = typeof value === "string" ? value : typeof descriptor.type === "string" ? descriptor.type : undefined;
      const { isArray, isReference } = classifyType(type, {
        ref: descriptor.reference === true || typeof descriptor.ref === "string",
        array: descriptor.array === true || descriptor.isArray === true,
      });
      return { name, type, isArray, isReference };
    });
  }
  return [];
}

function parseResource(name: string, value: unknown): DiscoveredResource {
  if (isRecord(value)) {
    const rawFields = value.fields ?? value.properties ?? value.columns ?? value.attributes ?? value;
    return { name, fields: parseFields(rawFields) };
  }
  return { name, fields: [] };
}

/**
 * Normalize whatever the schema endpoint returns into a flat resource/field
 * list. Tolerates several plausible shapes because the real one is unknown.
 */
export function parseSchema(schema: unknown): ParsedSchema {
  // Unwrap common envelopes.
  let root: unknown = schema;
  if (isRecord(root)) {
    for (const key of ["schema", "data", "result"]) {
      if (root[key] !== undefined) {
        root = root[key];
        break;
      }
    }
  }

  const container = isRecord(root) && root.resources !== undefined ? root.resources : root;

  // Array-of-resources shape: [{ name, fields }, ...]
  if (Array.isArray(container)) {
    return {
      resources: container.filter(isRecord).flatMap((entry) => {
        const name = typeof entry.name === "string" ? entry.name : undefined;
        if (!name) return [];
        return [parseResource(name, entry)];
      }),
    };
  }

  // Map-of-resources shape: { resourceName: { fields: {...} } }
  if (isRecord(container)) {
    return {
      resources: Object.entries(container).map(([name, value]) => parseResource(name, value)),
    };
  }

  return { resources: [] };
}

function pickResource(parsed: ParsedSchema): { resource: string; resolved: boolean } {
  const names = new Set(parsed.resources.map((resource) => resource.name.toLowerCase()));
  for (const candidate of QUEUE_RESOURCE_CANDIDATES) {
    if (names.has(candidate)) return { resource: candidate, resolved: true };
  }
  if (parsed.resources.length > 0) return { resource: parsed.resources[0].name, resolved: false };
  return { resource: QUEUE_RESOURCE_CANDIDATES[0], resolved: false };
}

/** A candidate path resolves when its root segment names a field on the resource. */
function resolvePath(resource: DiscoveredResource | undefined, candidatePaths: string[]): string | undefined {
  if (!resource) return undefined;
  const fieldNames = new Set(resource.fields.map((field) => field.name.toLowerCase()));
  for (const path of candidatePaths) {
    const root = path.split(".")[0].toLowerCase();
    if (fieldNames.has(root)) return path;
  }
  return undefined;
}

function elemMatchTemplate(requirement: FieldRequirement, matchedPath: string): UnknownRecord | undefined {
  if (requirement.container !== "array") return undefined;
  const [root, ...rest] = matchedPath.split(".");
  const leaf = rest.length > 0 ? rest[rest.length - 1] : "value";
  // Demonstrative only: the clause a developer would add to `filter` to drill
  // into a specific array element. We do NOT include it in the live projection
  // because filtering here would drop records we must keep for evaluation.
  return { [root]: { $elemMatch: { [leaf]: "<value>" } } };
}

function planField(requirement: FieldRequirement, resource: DiscoveredResource | undefined): PlannedField {
  const matchedPath = resolvePath(resource, requirement.candidatePaths);
  const base: PlannedField = {
    canonicalField: requirement.canonicalField,
    factor: requirement.factor,
    appetiteReason: requirement.appetiteReason,
    container: requirement.container,
    candidatePaths: requirement.candidatePaths,
    resolved: matchedPath !== undefined,
    matchedPath,
    aggregation: requirement.aggregation,
    expansionNote: requirement.container === "reference" ? requirement.expansionNote : undefined,
    arrayNote: requirement.container === "array" ? requirement.arrayNote : undefined,
  };
  if (!matchedPath) {
    base.unresolvedReason = `No discovered field matched any of: ${requirement.candidatePaths.join(", ")}.`;
    return base;
  }
  base.elemMatchExample = elemMatchTemplate(requirement, matchedPath);
  return base;
}

/**
 * Build the query projection from resolved requirements.
 *
 * - Scalars are selected directly.
 * - References use `$expand` so we get values, not bare ids.
 * - Arrays are selected in full (their leaf listed) and aggregated client-side.
 * - `where` (pre-expansion) and `filter` (post-expansion) are intentionally
 *   empty: we retain every submission, including out-of-appetite ones, and
 *   evaluate appetite in `lib/domain/appetite`. The comment records the
 *   execution order so a future targeted query uses the right stage.
 */
function buildProjection(resource: string, fields: PlannedField[]): unknown {
  const select: UnknownRecord = {};
  for (const field of fields) {
    if (!field.matchedPath) continue;
    const [root, ...rest] = field.matchedPath.split(".");
    if (field.container === "reference" && rest.length > 0) {
      const existing = isRecord(select[root]) ? (select[root] as UnknownRecord) : {};
      const expand = isRecord(existing.$expand) ? (existing.$expand as UnknownRecord) : { select: [] as string[] };
      const leaves = Array.isArray(expand.select) ? (expand.select as string[]) : [];
      leaves.push(rest.join("."));
      select[root] = { $expand: { select: leaves } };
    } else if (field.container === "array" && rest.length > 0) {
      const existing = isRecord(select[root]) ? (select[root] as UnknownRecord) : { select: [] as string[] };
      const leaves = Array.isArray(existing.select) ? (existing.select as string[]) : [];
      leaves.push(rest.join("."));
      select[root] = { select: leaves };
    } else {
      // Scalar (or an array/reference whose value lives at the root itself).
      select[root] = true;
    }
  }

  return {
    resource,
    select,
    // Pre-expansion filter: empty by design so no submission is excluded.
    where: {},
    // Post-expansion filter: empty by design; appetite is judged client-side.
    filter: {},
    // Pagination is owned by Person 1's transport; the planner leaves it open.
  };
}

/** Turn the discovered schema into a full query plan (projection + trace inputs). */
export function planQuery(schema: unknown): QueryPlan {
  const parsed = parseSchema(schema);
  const { resource, resolved } = pickResource(parsed);
  const discovered = parsed.resources.find((entry) => entry.name.toLowerCase() === resource.toLowerCase());
  const fields = FIELD_REQUIREMENTS.map((requirement) => planField(requirement, discovered));

  const assumptions = [
    `ASSUMED queue resource "${resource}"${resolved ? "" : " (not found in schema; using a fallback)"}.`,
    "ASSUMED nested shapes: locations[] with buildings[], plus lossHistory[]/losses[] and producer/account references.",
    "Projection retains ALL submissions: where/filter are empty by design; appetite is evaluated client-side.",
    "$expand is emitted for references; $elemMatch templates are provided for developers but never applied as a live filter.",
    "All resource/field names are guesses verified against the discovered schema and overridable via env seams.",
  ];

  return {
    resource,
    resourceResolved: resolved,
    fields,
    projection: buildProjection(resource, fields),
    assumptions,
  };
}
