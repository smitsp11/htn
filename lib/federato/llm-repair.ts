/**
 * Optional model pass that rewrites a query the local validator rejected.
 *
 * Off unless a planner provider is configured (the same switch as the field
 * mapping pass). The model sees the schema, the rejected payload and the
 * validator's messages, and returns a corrected payload; that payload is
 * validated again before anything is sent, so the model cannot get a malformed
 * query past the schema. Without a provider the executor simply moves on to
 * the next, simpler fallback payload.
 */

import { askModel, extractJson, resolvePlannerModel } from "./llm-planner";
import type { QueryPayload } from "./query-compiler";
import { formatValidationErrors, type ValidationError } from "./query-validator";
import type { QueryTrace } from "./query-trace";
import { isRecord } from "./response";
import type { SchemaIndex } from "./schema-index";

const SYSTEM = `You repair a query for an insurance data API so that it passes schema validation.

The query language has these stages, run in this order: where → expand → unwind → filter → over → select → sort → pagination.
- "where" filters raw records BEFORE references are expanded; "filter" runs AFTER expansion and may read expanded fields.
- A dot-path never crosses an array. To match inside an array use {"<array>": {"$elemMatch": {"<field>": …}}}.
- A reference field holds only an id until it is listed in "expand" (nested objects, e.g. {"exposure_units": {"location": true}}) or projected with {"<ref>": {"$expand": {"select": [...]}}}.
- Operators: $eq $ne $exists $gt $gte $lt $lte $in $nin $contains $elemMatch; combinators $and $or $not.
- "select" is a list of paths or a projection tree; aggregation leaves are {"$sum"|"$avg"|"$min"|"$max"|"$countDistinct": "<path>"} or {"$count": true}.

Fix only what the validation errors name. Keep the same resource and the same intent, and never add "where" or "filter" conditions that would drop records. Reply with JSON only, no prose and no code fences: {"payload": { ... }}`;

export async function repairQueryWithModel(
  index: SchemaIndex,
  payload: QueryPayload,
  errors: ValidationError[],
  trace: QueryTrace,
): Promise<QueryPayload | undefined> {
  const target = resolvePlannerModel();
  if (!target) return undefined;

  const prompt = [
    "Schema:",
    index.describeAll(),
    "",
    "Rejected payload:",
    JSON.stringify(payload, null, 2),
    "",
    "Validation errors:",
    formatValidationErrors(errors),
  ].join("\n");

  try {
    const parsed = extractJson(await askModel(target, SYSTEM, prompt));
    const candidate = isRecord(parsed) ? parsed.payload : undefined;
    if (!isRecord(candidate) || typeof candidate.resource !== "string") {
      trace.add("warning", "The model's rewrite was not a query payload", `${target.model} did not return {"payload": {...}}; using the deterministic fallback instead.`);
      return undefined;
    }
    trace.add(
      "repair",
      "Asked the model to rewrite the rejected query",
      `${target.model} proposed a rewrite for ${errors.length} validation problem(s). It is validated again before it is sent.`,
      { provider: target.provider, model: target.model, problems: errors.length },
    );
    return candidate as unknown as QueryPayload;
  } catch (error) {
    trace.add(
      "warning",
      "Model repair failed; continuing with the deterministic fallback",
      `${target.model}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
