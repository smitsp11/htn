/**
 * Local validator for Query Request Body payloads.
 *
 * Runs before a payload is sent, so a malformed query is rejected here with a
 * message that says what to change, instead of costing an API round trip that
 * comes back as a bare string error or, worse, as zero rows. Nothing here is
 * specific to Federato's field names: every check reads the discovered schema.
 *
 * The rules are the documented ones (QUERY_REQUEST_BODY, summarized in
 * documents/TRACK_BRIEF.md §6): stages run where → expand → unwind → filter →
 * over → select → sort → pagination; `where` sees raw records and `filter` sees
 * hydrated ones; a dot-path never crosses an array (use `$elemMatch`); a
 * reference is only an id until it is expanded. They have not yet been
 * confirmed against the live API, so a rejection here is advice, and the
 * executor still falls back to a simpler payload rather than giving up.
 */

import type { QueryPayload } from "./query-compiler";
import { isRecord } from "./response";
import { objectFields, referenceTarget, type SchemaIndex, type SchemaNode } from "./schema-index";

export type ValidationCode =
  | "UNKNOWN_KEY"
  | "UNKNOWN_RESOURCE"
  | "UNKNOWN_FIELD"
  | "UNKNOWN_OPERATOR"
  | "ARRAY_DOT_PATH"
  | "REFERENCE_NOT_EXPANDED"
  | "NOT_EXPANDABLE"
  | "ELEM_MATCH_TARGET"
  | "BAD_SHAPE"
  | "BAD_SORT"
  | "BAD_PAGINATION";

export interface ValidationError {
  code: ValidationCode;
  /** Where in the payload, e.g. `filter.exposure_units.$elemMatch.location`. */
  at: string;
  message: string;
  /** What to change, when the fix is mechanical. */
  hint?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

const QUERY_KEYS = new Set(["resource", "where", "expand", "unwind", "filter", "over", "select", "sort", "pagination"]);
const COMBINATORS = new Set(["$and", "$or", "$not"]);
const OPERATORS = new Set(["$eq", "$ne", "$exists", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$contains", "$elemMatch"]);
const AGGREGATIONS = new Set(["$sum", "$avg", "$min", "$max", "$count", "$countDistinct"]);

type Stage = "where" | "filter" | "select" | "unwind" | "over" | "sort" | "aggregate";
type Kind = "scalar" | "object" | "array" | "reference";

interface Step {
  name: string;
  /** Dot path from the query root. */
  prefix: string;
  node: SchemaNode;
  kind: Kind;
  /** Fans out: an array field or a `cardinality: "many"` reference. */
  many: boolean;
  /** Target resource when the step is a reference. */
  resource?: string;
}

/** The fields visible at one point in the payload, and how we got there. */
interface Scope {
  fields: Record<string, SchemaNode> | undefined;
  prefix: string;
  resource: string;
}

function kindOf(node: SchemaNode): Kind {
  if (node.type === "object") return "object";
  if (node.type === "array") return "array";
  if (node.type === "reference") return "reference";
  return "scalar";
}

function join(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

function listFields(fields: Record<string, SchemaNode> | undefined, limit = 12): string {
  const names = Object.keys(fields ?? {});
  return names.length > limit ? `${names.slice(0, limit).join(", ")}, …` : names.join(", ");
}

/** Fields reachable *through* a node: an object's fields, an array's item fields, a reference's target fields. */
function childFields(index: SchemaIndex, node: SchemaNode): Record<string, SchemaNode> | undefined {
  if (node.type === "object") return objectFields(node);
  if (node.type === "array") {
    const item = (node as { itemSchema?: SchemaNode }).itemSchema;
    return item ? childFields(index, item) : undefined;
  }
  const reference = referenceTarget(node);
  return reference ? objectFields(index.raw[reference.resource]) : undefined;
}

function scopeFor(index: SchemaIndex, step: Step, resource: string): Scope {
  return { fields: childFields(index, step.node), prefix: step.prefix, resource: step.resource ?? resource };
}

export function validateQuery(index: SchemaIndex, payload: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const fail = (code: ValidationCode, at: string, message: string, hint?: string) => {
    errors.push({ code, at, message, ...(hint ? { hint } : {}) });
  };

  if (!isRecord(payload)) {
    fail("BAD_SHAPE", "", "The payload must be a JSON object.");
    return { ok: false, errors };
  }

  for (const key of Object.keys(payload)) {
    if (!QUERY_KEYS.has(key)) {
      fail("UNKNOWN_KEY", key, `"${key}" is not a query stage.`, `Stages are ${[...QUERY_KEYS].join(", ")}.`);
    }
  }

  const resource = payload.resource;
  if (typeof resource !== "string" || !index.hasResource(resource)) {
    fail(
      "UNKNOWN_RESOURCE",
      "resource",
      `"${String(resource)}" is not a resource in the discovered schema.`,
      `Resources: ${index.resources.join(", ")}.`,
    );
    return { ok: false, errors };
  }

  const root: Scope = { fields: objectFields(index.raw[resource]), prefix: "", resource };
  const validator = new PayloadValidator(index, root, fail);

  // `expand` first: every later stage needs to know which references are hydrated.
  if (payload.expand !== undefined) validator.expand(payload.expand, root, "expand");
  if (payload.where !== undefined) validator.clause(payload.where, root, "where", "where");
  if (payload.unwind !== undefined) validator.unwind(payload.unwind);
  if (payload.filter !== undefined) validator.clause(payload.filter, root, "filter", "filter");
  if (payload.over !== undefined) validator.paths(payload.over, "over", "over");
  if (payload.select !== undefined) validator.select(payload.select, root, "select", validator.aliases);
  if (payload.sort !== undefined) validator.sort(payload.sort);
  if (payload.pagination !== undefined) validator.pagination(payload.pagination);

  return { ok: errors.length === 0, errors };
}

class PayloadValidator {
  /** Reference paths hydrated by the `expand` stage, e.g. `exposure_units.location`. */
  readonly expanded = new Set<string>();
  /** Aggregation aliases declared in `select`; `sort` may reference them. */
  readonly aliases = new Set<string>();

  constructor(
    private readonly index: SchemaIndex,
    private readonly root: Scope,
    private readonly fail: (code: ValidationCode, at: string, message: string, hint?: string) => void,
  ) {}

  /**
   * Resolves a dot path from a scope, enforcing what each stage may cross:
   * arrays only outside where/filter, references only once expanded (never in
   * `where`, which runs before expansion).
   */
  walk(scope: Scope, path: string, stage: Stage, at: string): Step[] | undefined {
    const segments = path.split(".").filter(Boolean);
    if (segments.length === 0) {
      this.fail("BAD_SHAPE", at, "Empty field path.");
      return undefined;
    }

    let { fields, prefix, resource } = scope;
    const steps: Step[] = [];
    for (let position = 0; position < segments.length; position += 1) {
      const name = segments[position];
      const node = fields?.[name];
      const full = join(prefix, name);
      if (!node) {
        this.fail(
          "UNKNOWN_FIELD",
          at,
          `"${full}" is not a field on ${resource}.`,
          fields ? `Fields on ${resource}: ${listFields(fields)}.` : undefined,
        );
        return undefined;
      }

      const kind = kindOf(node);
      const reference = referenceTarget(node);
      const many = kind === "array" || reference?.cardinality === "many";
      steps.push({ name, prefix: full, node, kind, many, resource: reference?.resource });
      if (position === segments.length - 1) break;

      const rest = segments.slice(position + 1).join(".");
      if (reference && stage === "where") {
        this.fail(
          "REFERENCE_NOT_EXPANDED",
          at,
          `where runs before references are expanded, so "${full}" is only an id there and "${rest}" is unreachable.`,
          `Add {"${full}": true} to expand and move this condition to filter.`,
        );
        return undefined;
      }
      if (many && (stage === "where" || stage === "filter")) {
        this.fail(
          "ARRAY_DOT_PATH",
          at,
          `"${full}" is an array, and a dot-path through an array silently matches nothing.`,
          `Use {"${full}": {"$elemMatch": {"${rest}": …}}} instead of "${path}".`,
        );
        return undefined;
      }
      if (reference && !this.expanded.has(full)) {
        this.fail(
          "REFERENCE_NOT_EXPANDED",
          at,
          `"${full}" is a reference to ${reference.resource} that has not been expanded, so "${rest}" is unreachable.`,
          stage === "select"
            ? `Add {"${full}": true} to expand, or project it as {"${name}": {"$expand": {"select": ["${rest}"]}}}.`
            : `Add {"${full}": true} to the expand stage.`,
        );
        return undefined;
      }

      if (reference) resource = reference.resource;
      fields = childFields(this.index, node);
      if (!fields) {
        this.fail("BAD_SHAPE", at, `"${full}" is a ${node.type} and has no field "${segments[position + 1]}".`);
        return undefined;
      }
      prefix = full;
    }
    return steps;
  }

  /** The `expand` tree: `true`, `{}`, `"child"`, or nested objects, each key a reference (or an object holding one). */
  expand(spec: unknown, scope: Scope, at: string): void {
    if (spec === true || (isRecord(spec) && Object.keys(spec).length === 0)) return;
    const tree = typeof spec === "string" ? { [spec]: true } : spec;
    if (!isRecord(tree)) {
      this.fail("BAD_SHAPE", at, "expand must be an object tree of reference fields (or true).");
      return;
    }
    for (const [key, nested] of Object.entries(tree)) {
      const node = scope.fields?.[key];
      const full = join(scope.prefix, key);
      if (!node) {
        this.fail("UNKNOWN_FIELD", `${at}.${key}`, `"${full}" is not a field on ${scope.resource}.`, `Fields on ${scope.resource}: ${listFields(scope.fields)}.`);
        continue;
      }
      const reference = referenceTarget(node);
      if (reference) {
        this.expanded.add(full);
        this.expand(nested, { fields: objectFields(this.index.raw[reference.resource]), prefix: full, resource: reference.resource }, `${at}.${key}`);
        continue;
      }
      if (node.type === "object") {
        // An object may hold a reference (`producer.broker`); name it, don't expand the object.
        if (nested === true || (isRecord(nested) && Object.keys(nested).length === 0)) {
          this.fail("NOT_EXPANDABLE", `${at}.${key}`, `"${full}" is an object, not a reference.`, `Name the reference inside it, e.g. {"${key}": {"<reference>": true}}.`);
          continue;
        }
        this.expand(nested, { fields: objectFields(node), prefix: full, resource: scope.resource }, `${at}.${key}`);
        continue;
      }
      this.fail("NOT_EXPANDABLE", `${at}.${key}`, `"${full}" is a ${node.type}; only reference fields can be expanded.`);
    }
  }

  /** A `where` or `filter` clause: field conditions and `$and` / `$or` / `$not` combinators. */
  clause(value: unknown, scope: Scope, stage: "where" | "filter", at: string): void {
    if (Array.isArray(value)) {
      value.forEach((entry, position) => this.clause(entry, scope, stage, `${at}[${position}]`));
      return;
    }
    if (!isRecord(value)) {
      this.fail("BAD_SHAPE", at, `${stage} must be an object of field conditions.`);
      return;
    }
    for (const [key, condition] of Object.entries(value)) {
      if (key.startsWith("$")) {
        if (key === "$and" || key === "$or") {
          if (!Array.isArray(condition)) this.fail("BAD_SHAPE", `${at}.${key}`, `${key} takes a list of clauses.`);
          else this.clause(condition, scope, stage, `${at}.${key}`);
        } else if (key === "$not") {
          this.clause(condition, scope, stage, `${at}.${key}`);
        } else {
          this.fail("UNKNOWN_OPERATOR", `${at}.${key}`, `"${key}" cannot stand alone; only $and, $or and $not combine clauses.`, "Operators belong under a field: {\"premium\": {\"$gte\": 50000}}.");
        }
        continue;
      }
      const steps = this.walk(scope, key, stage, `${at}.${key}`);
      if (steps) this.condition(condition, steps, scope, stage, `${at}.${key}`);
    }
  }

  /** The value under a field in a clause: a literal, an operator object, or a nested clause. */
  private condition(value: unknown, steps: Step[], scope: Scope, stage: "where" | "filter", at: string): void {
    const last = steps[steps.length - 1];
    if (!isRecord(value)) return; // literal → implicit $eq; ids compare fine against a reference.

    const keys = Object.keys(value);
    const operators = keys.filter((key) => key.startsWith("$"));
    if (operators.length === 0) {
      // Nested path form: {"dates": {"effective": "…"}} is the same as "dates.effective".
      if (last.kind === "object") {
        this.clause(value, scopeFor(this.index, last, scope.resource), stage, at);
      } else if (last.kind === "array" || last.many) {
        this.fail("ARRAY_DOT_PATH", at, `"${last.prefix}" is an array; a nested condition on it matches nothing.`, `Use {"${last.prefix}": {"$elemMatch": {…}}}.`);
      } else if (last.kind === "reference") {
        this.referenceCondition(value, last, scope, stage, at);
      } else {
        this.fail("BAD_SHAPE", at, `"${last.prefix}" is a ${last.node.type}; give it a value or an operator such as $gte.`);
      }
      return;
    }
    if (operators.length !== keys.length) {
      this.fail("BAD_SHAPE", at, `Do not mix operators and field names under "${last.prefix}".`);
      return;
    }

    for (const operator of operators) {
      const operand = value[operator];
      if (COMBINATORS.has(operator)) {
        if (operator === "$not") this.condition(operand, steps, scope, stage, `${at}.$not`);
        else if (Array.isArray(operand)) operand.forEach((entry, position) => this.condition(entry, steps, scope, stage, `${at}.${operator}[${position}]`));
        else this.fail("BAD_SHAPE", `${at}.${operator}`, `${operator} takes a list.`);
        continue;
      }
      if (!OPERATORS.has(operator)) {
        this.fail("UNKNOWN_OPERATOR", `${at}.${operator}`, `Unknown operator "${operator}".`, `Operators: ${[...OPERATORS].join(", ")}.`);
        continue;
      }
      if (operator === "$elemMatch") this.elemMatch(operand, last, scope, stage, `${at}.$elemMatch`);
    }
  }

  private referenceCondition(value: unknown, last: Step, scope: Scope, stage: "where" | "filter", at: string): void {
    if (stage === "where") {
      this.fail("REFERENCE_NOT_EXPANDED", at, `where runs before references are expanded, so "${last.prefix}" is only an id there.`, `Compare the id directly, or expand "${last.prefix}" and use filter.`);
      return;
    }
    if (!this.expanded.has(last.prefix)) {
      this.fail("REFERENCE_NOT_EXPANDED", at, `"${last.prefix}" has not been expanded, so its fields are unreachable in filter.`, `Add {"${last.prefix}": true} to the expand stage.`);
      return;
    }
    this.clause(value, scopeFor(this.index, last, scope.resource), stage, at);
  }

  /** `$elemMatch` needs an array (or an expanded many-reference) and a sub-clause over its items. */
  private elemMatch(operand: unknown, last: Step, scope: Scope, stage: "where" | "filter", at: string): void {
    if (last.kind === "reference") {
      if (!last.many) {
        this.fail("ELEM_MATCH_TARGET", at, `"${last.prefix}" is a single reference, not an array.`, `Use a dot path: "${last.prefix}.<field>".`);
        return;
      }
      if (stage === "where" || !this.expanded.has(last.prefix)) {
        this.fail("REFERENCE_NOT_EXPANDED", at, `"${last.prefix}" holds only ids until it is expanded, so $elemMatch cannot read its fields${stage === "where" ? " in where" : ""}.`, `Add {"${last.prefix}": true} to expand and use $elemMatch in filter.`);
        return;
      }
      this.clause(operand, scopeFor(this.index, last, scope.resource), stage, at);
      return;
    }
    if (last.kind !== "array") {
      this.fail("ELEM_MATCH_TARGET", at, `"${last.prefix}" is a ${last.node.type}; $elemMatch only applies to arrays.`);
      return;
    }
    const itemFields = childFields(this.index, last.node);
    if (itemFields) {
      this.clause(operand, { fields: itemFields, prefix: last.prefix, resource: scope.resource }, stage, at);
      return;
    }
    // An array of scalars: the sub-clause is operators over each element.
    if (!isRecord(operand) || Object.keys(operand).some((key) => !key.startsWith("$"))) {
      this.fail("BAD_SHAPE", at, `"${last.prefix}" holds scalars, so $elemMatch takes operators only, e.g. {"$in": [...]}.`);
      return;
    }
    for (const operator of Object.keys(operand)) {
      if (!OPERATORS.has(operator) && !COMBINATORS.has(operator)) {
        this.fail("UNKNOWN_OPERATOR", `${at}.${operator}`, `Unknown operator "${operator}".`, `Operators: ${[...OPERATORS].join(", ")}.`);
      }
    }
  }

  unwind(spec: unknown): void {
    if (!Array.isArray(spec)) {
      this.fail("BAD_SHAPE", "unwind", "unwind must be a list of paths or {path, type} objects.");
      return;
    }
    spec.forEach((entry, position) => {
      const at = `unwind[${position}]`;
      const path = typeof entry === "string" ? entry : isRecord(entry) && typeof entry.path === "string" ? entry.path : undefined;
      if (path === undefined) {
        this.fail("BAD_SHAPE", at, "Each unwind entry is a path string or {path, type}.");
        return;
      }
      if (isRecord(entry) && entry.type !== undefined && entry.type !== "inner" && entry.type !== "left") {
        this.fail("BAD_SHAPE", `${at}.type`, `unwind type must be "inner" or "left".`);
      }
      const steps = this.walk(this.root, path, "unwind", at);
      if (!steps) return;
      const last = steps[steps.length - 1];
      if (!last.many) {
        this.fail("BAD_SHAPE", at, `"${path}" is not an array, so there is nothing to unwind.`);
      } else if (last.kind === "reference" && !this.expanded.has(last.prefix)) {
        this.fail("REFERENCE_NOT_EXPANDED", at, `"${path}" holds only ids until it is expanded.`, `Add {"${path}": true} to the expand stage.`);
      }
    });
  }

  /** A list of dot paths (`over`). */
  paths(spec: unknown, stage: Stage, at: string): void {
    if (!Array.isArray(spec)) {
      this.fail("BAD_SHAPE", at, `${at} must be a list of field paths.`);
      return;
    }
    spec.forEach((entry, position) => {
      if (typeof entry !== "string") this.fail("BAD_SHAPE", `${at}[${position}]`, "Each entry must be a field path string.");
      else this.walk(this.root, entry, stage, `${at}[${position}]`);
    });
  }

  /**
   * `select`: a list of paths, or a tree whose leaves are `true`, a nested
   * projection, a `$expand` leaf on a reference, or an aggregation under an alias.
   */
  select(spec: unknown, scope: Scope, at: string, aliases?: Set<string>): void {
    if (Array.isArray(spec)) {
      spec.forEach((entry, position) => {
        if (typeof entry !== "string") this.fail("BAD_SHAPE", `${at}[${position}]`, "Each select entry must be a field path string.");
        else this.walk(scope, entry, "select", `${at}[${position}]`);
      });
      return;
    }
    if (!isRecord(spec)) {
      this.fail("BAD_SHAPE", at, "select must be a list of paths or a projection object.");
      return;
    }
    for (const [key, leaf] of Object.entries(spec)) {
      const here = `${at}.${key}`;
      if (key.startsWith("$")) {
        this.fail("BAD_SHAPE", here, `"${key}" cannot be a projection key; operators belong under a field.`);
        continue;
      }
      if (isRecord(leaf) && this.isAggregation(leaf)) {
        aliases?.add(key);
        this.aggregation(leaf, scope, here);
        continue;
      }
      const node = scope.fields?.[key];
      const full = join(scope.prefix, key);
      if (!node) {
        this.fail("UNKNOWN_FIELD", here, `"${full}" is not a field on ${scope.resource}.`, `Fields on ${scope.resource}: ${listFields(scope.fields)}. A new name is only allowed for an aggregation leaf such as {"$sum": "<path>"}.`);
        continue;
      }
      if (leaf === true) continue;
      if (!isRecord(leaf)) {
        this.fail("BAD_SHAPE", here, `A projection leaf is true, a nested projection, a $expand, or an aggregation.`);
        continue;
      }
      const reference = referenceTarget(node);
      if ("$expand" in leaf) {
        if (!reference) {
          this.fail("NOT_EXPANDABLE", here, `"${full}" is a ${node.type}; $expand only applies to reference fields.`);
          continue;
        }
        const inner = leaf.$expand;
        if (inner === true || (isRecord(inner) && inner.select === undefined)) continue;
        if (!isRecord(inner)) {
          this.fail("BAD_SHAPE", `${here}.$expand`, `$expand takes {"select": [...]} or true.`);
          continue;
        }
        // A $expand leaf resolves the reference in the output only, so anything
        // below it needs its own $expand: validate with no hydrated references.
        const inside = new PayloadValidator(this.index, this.root, this.fail);
        inside.select(inner.select, { fields: objectFields(this.index.raw[reference.resource]), prefix: full, resource: reference.resource }, `${here}.$expand.select`);
        continue;
      }
      if (reference && !this.expanded.has(full)) {
        this.fail("REFERENCE_NOT_EXPANDED", here, `"${full}" is a reference to ${reference.resource} that has not been expanded, so it cannot be projected further.`, `Add {"${full}": true} to expand, or use {"${key}": {"$expand": {"select": [...]}}}.`);
        continue;
      }
      const fields = childFields(this.index, node);
      if (!fields) {
        this.fail("BAD_SHAPE", here, `"${full}" is a ${node.type} and cannot be projected further.`);
        continue;
      }
      this.select(leaf, { fields, prefix: full, resource: reference?.resource ?? scope.resource }, here);
    }
  }

  private isAggregation(leaf: Record<string, unknown>): boolean {
    const keys = Object.keys(leaf);
    return keys.length === 1 && AGGREGATIONS.has(keys[0]);
  }

  private aggregation(leaf: Record<string, unknown>, scope: Scope, at: string): void {
    const [fn] = Object.keys(leaf);
    const argument = leaf[fn];
    if (fn === "$count") {
      if (argument !== true) this.fail("BAD_SHAPE", `${at}.$count`, "$count takes true.");
      return;
    }
    const paths = Array.isArray(argument) ? argument : [argument];
    if (fn !== "$countDistinct" && paths.length !== 1) {
      this.fail("BAD_SHAPE", `${at}.${fn}`, `${fn} takes one field path.`);
      return;
    }
    for (const path of paths) {
      if (typeof path !== "string") this.fail("BAD_SHAPE", `${at}.${fn}`, `${fn} takes a field path string.`);
      else this.walk(scope, path, "aggregate", `${at}.${fn}`);
    }
  }

  sort(spec: unknown): void {
    if (!Array.isArray(spec)) {
      this.fail("BAD_SORT", "sort", "sort must be a list of {field, direction} objects.");
      return;
    }
    spec.forEach((entry, position) => {
      const at = `sort[${position}]`;
      if (!isRecord(entry) || typeof entry.field !== "string") {
        this.fail("BAD_SORT", at, "Each sort entry needs a field path.");
        return;
      }
      if (entry.direction !== undefined && entry.direction !== "asc" && entry.direction !== "desc") {
        this.fail("BAD_SORT", `${at}.direction`, `direction must be "asc" or "desc".`);
      }
      // Sort runs after select, so an aggregation alias is a valid key.
      if (this.aliases.has(entry.field)) return;
      this.walk(this.root, entry.field, "sort", `${at}.field`);
    });
  }

  pagination(spec: unknown): void {
    if (!isRecord(spec)) {
      this.fail("BAD_PAGINATION", "pagination", "pagination must be {limit, offset}.");
      return;
    }
    if (spec.limit !== undefined && !(Number.isInteger(spec.limit) && (spec.limit as number) > 0)) {
      this.fail("BAD_PAGINATION", "pagination.limit", "limit must be a positive integer.");
    }
    if (spec.offset !== undefined && !(Number.isInteger(spec.offset) && (spec.offset as number) >= 0)) {
      this.fail("BAD_PAGINATION", "pagination.offset", "offset must be a non-negative integer.");
    }
  }
}

/** One line per problem, for the trace and for a model asked to repair the payload. */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((error) => `[${error.code}] at ${error.at || "payload"}: ${error.message}${error.hint ? ` ${error.hint}` : ""}`)
    .join("\n");
}

/** A short sentence for the trace. */
export function summarizeValidation(errors: ValidationError[]): string {
  const first = errors[0];
  const rest = errors.length - 1;
  return `${first.message}${first.hint ? ` ${first.hint}` : ""}${rest > 0 ? ` (+${rest} more)` : ""}`;
}

export type { QueryPayload };
