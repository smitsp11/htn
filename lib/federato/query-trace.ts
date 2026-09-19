import type { FactorKey } from "@/lib/domain/types";
import type { PlannedField, QueryPlan } from "@/lib/federato/schema-planner";

/**
 * Serializable query trace (Person 2 -> Person 4).
 *
 * This is the underwriter- and developer-facing record of WHAT data the agent
 * asked Federato for and WHY. It is intentionally free of credentials, tokens,
 * URLs, or raw API payloads so it is safe to render in the shared UI. It reports,
 * per field: the field requested, the appetite reason, the schema match, the
 * expansion/array behavior, and which fields could not be resolved.
 */

export interface QueryTraceField {
  /** Canonical field the underwriter sees. */
  field: string;
  /** Present when this field backs one of the eight appetite factors. */
  factor?: FactorKey;
  appetiteReason: string;
  /** Matched schema path, or "unresolved" when nothing in the schema matched. */
  schemaMatch: string;
  resolved: boolean;
  /** How arrays are aggregated and/or references expanded, in plain language. */
  behavior?: string;
  unresolvedReason?: string;
}

export interface QueryTrace {
  resource: string;
  resourceResolved: boolean;
  generatedFromSchema: boolean;
  fields: QueryTraceField[];
  /** Canonical field names that had no schema match (surface, never invent). */
  unresolvedFields: string[];
  assumptions: string[];
}

function behaviorLine(field: PlannedField): string | undefined {
  const parts: string[] = [];
  if (field.container === "reference" && field.expansionNote) parts.push(`$expand: ${field.expansionNote}`);
  if (field.container === "array" && field.arrayNote) parts.push(field.arrayNote);
  if (field.aggregation) parts.push(field.aggregation);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function traceField(field: PlannedField): QueryTraceField {
  return {
    field: field.canonicalField,
    factor: field.factor,
    appetiteReason: field.appetiteReason,
    schemaMatch: field.matchedPath ?? "unresolved",
    resolved: field.resolved,
    behavior: behaviorLine(field),
    unresolvedReason: field.unresolvedReason,
  };
}

/** Build the serializable trace from a query plan. Safe to send to the UI. */
export function buildQueryTrace(plan: QueryPlan, options?: { generatedFromSchema?: boolean }): QueryTrace {
  const fields = plan.fields.map(traceField);
  return {
    resource: plan.resource,
    resourceResolved: plan.resourceResolved,
    generatedFromSchema: options?.generatedFromSchema ?? true,
    fields,
    unresolvedFields: fields.filter((field) => !field.resolved).map((field) => field.field),
    assumptions: plan.assumptions,
  };
}

/**
 * Flatten the structured trace into the `string[]` shape that
 * `RankingsResponse.trace` currently carries, so Person 4 can fold planner
 * reasoning into the existing dashboard trace list without a contract change.
 */
export function traceToLines(trace: QueryTrace): string[] {
  const lines = [
    `Planned query against "${trace.resource}"${trace.resourceResolved ? "" : " (fallback resource; not confirmed in schema)"}.`,
    `Resolved ${trace.fields.length - trace.unresolvedFields.length}/${trace.fields.length} canonical fields from the discovered schema.`,
  ];
  if (trace.unresolvedFields.length > 0) {
    lines.push(`Unresolved fields kept visible as unknown: ${trace.unresolvedFields.join(", ")}.`);
  }
  return lines;
}
