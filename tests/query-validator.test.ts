import assert from "node:assert/strict";
import test from "node:test";
import { buildQueueQuery, buildRootQuery, buildTivCheckQuery, type QueryPayload } from "../lib/federato/query-compiler";
import { runQuery } from "../lib/federato/query-executor";
import { createTrace } from "../lib/federato/query-trace";
import { formatValidationErrors, validateQuery, type ValidationCode } from "../lib/federato/query-validator";
import { createReplaySource } from "../lib/federato/replay";
import { buildSchemaIndex } from "../lib/federato/schema-index";
import { planFromSchema, planQueueResource } from "../lib/federato/schema-planner";
import { agentSchema } from "./fixtures/federato/agent-schema";

const index = buildSchemaIndex(agentSchema);

function codes(payload: unknown): ValidationCode[] {
  return validateQuery(index, payload).errors.map((error) => error.code);
}

function expectValid(payload: unknown, label = "payload") {
  const result = validateQuery(index, payload);
  assert.ok(result.ok, `${label} should validate:\n${formatValidationErrors(result.errors)}`);
}

/* The agent's own compiled queries must pass, or the validator would block the queue. */

test("every query the agent compiles from the fixture schema validates", () => {
  const trace = createTrace();
  const plan = planFromSchema(index, trace);
  const root = buildRootQuery(plan);
  expectValid(root.payload, "root query");
  for (const fallback of root.fallbacks) expectValid(fallback, "root fallback");

  const queuePlan = planQueueResource(index, plan, trace);
  assert.ok(queuePlan, "the fixture schema has a queue resource");
  const queue = buildQueueQuery(queuePlan);
  expectValid(queue.payload, "queue query");

  const tiv = buildTivCheckQuery(plan);
  assert.ok(tiv, "the fixture schema supports the TIV cross-check");
  expectValid(tiv.payload, "TIV cross-check (unwind + over + $sum)");
});

test("every query the agent compiles from the captured Federato schema validates", () => {
  const live = createReplaySource().index;
  const trace = createTrace();
  const plan = planFromSchema(live, trace);
  const root = buildRootQuery(plan);
  const result = validateQuery(live, root.payload);
  assert.ok(result.ok, formatValidationErrors(result.errors));
  const queuePlan = planQueueResource(live, plan, trace);
  if (queuePlan) assert.ok(validateQuery(live, buildQueueQuery(queuePlan).payload).ok);
  const tiv = buildTivCheckQuery(plan);
  if (tiv) assert.ok(validateQuery(live, tiv.payload).ok, formatValidationErrors(validateQuery(live, tiv.payload).errors));
});

/* Structure. */

test("an unknown resource, stage key or field is named", () => {
  assert.deepEqual(codes({ resource: "Nope" }), ["UNKNOWN_RESOURCE"]);
  assert.deepEqual(codes({ resource: "Policy", limit: 5 }), ["UNKNOWN_KEY"]);
  const missing = validateQuery(index, { resource: "Policy", where: { premum: 1 } });
  assert.equal(missing.errors[0].code, "UNKNOWN_FIELD");
  assert.match(missing.errors[0].hint ?? "", /premium/);
});

test("documented operators pass and unknown ones are rejected with the list", () => {
  expectValid({
    resource: "Policy",
    where: {
      premium: { $gte: 50_000, $lte: 175_000 },
      $or: [{ business_type: "new" }, { line_of_business: { $in: ["property"] } }],
      $not: { insured: 2 },
    },
  });
  const bad = validateQuery(index, { resource: "Policy", where: { premium: { $grt: 5 } } });
  assert.equal(bad.errors[0].code, "UNKNOWN_OPERATOR");
  assert.match(bad.errors[0].hint ?? "", /\$gte/);
});

/* The pitfalls the API documentation warns about. */

test("a dot-path through an array is rejected with the $elemMatch rewrite", () => {
  const result = validateQuery(index, {
    resource: "Policy",
    expand: { exposure_units: { location: true } },
    filter: { "exposure_units.location.state": "CA" },
  });
  assert.equal(result.errors[0].code, "ARRAY_DOT_PATH");
  assert.match(result.errors[0].hint ?? "", /\$elemMatch/);
  assert.match(result.errors[0].hint ?? "", /location\.state/);
});

test("$elemMatch on an expanded many-reference passes, including nested $elemMatch on scalar arrays", () => {
  expectValid({
    resource: "Policy",
    expand: { exposure_units: { location: true } },
    filter: {
      exposure_units: {
        $elemMatch: {
          kind: "location",
          location: { hazard_tags: { $in: ["earthquake", "wildfire"] } },
        },
      },
    },
  });
  expectValid({
    resource: "Location",
    where: { hazard_tags: { $elemMatch: { $in: ["flood"] } } },
  });
});

test("reading through a reference requires it to be expanded", () => {
  const unexpanded = validateQuery(index, { resource: "Policy", filter: { "insured.name": "A" } });
  assert.equal(unexpanded.errors[0].code, "REFERENCE_NOT_EXPANDED");
  assert.match(unexpanded.errors[0].hint ?? "", /expand/);
  expectValid({ resource: "Policy", expand: { insured: true }, filter: { "insured.name": "A" } });
  expectValid({ resource: "Policy", expand: { insured: true }, filter: { insured: { name: "A" } } });
});

test("where runs before expansion: a reference is only an id there", () => {
  const through = validateQuery(index, { resource: "Policy", expand: { insured: true }, where: { "insured.name": "A" } });
  assert.equal(through.errors[0].code, "REFERENCE_NOT_EXPANDED");
  assert.match(through.errors[0].message, /before references are expanded/);
  // Comparing the id itself is fine.
  expectValid({ resource: "Policy", where: { insured: 2 } });
  expectValid({ resource: "Policy", where: { $not: { insured: 2 } } });
});

test("$elemMatch needs an array: not a scalar, and not an unexpanded or single reference", () => {
  assert.deepEqual(codes({ resource: "Policy", where: { premium: { $elemMatch: { $gt: 1 } } } }), ["ELEM_MATCH_TARGET"]);
  assert.deepEqual(codes({ resource: "Policy", filter: { insured: { $elemMatch: { name: "A" } } } }), ["ELEM_MATCH_TARGET"]);
  assert.deepEqual(codes({ resource: "Policy", where: { exposure_units: { $elemMatch: { kind: "location" } } } }), ["REFERENCE_NOT_EXPANDED"]);
});

test("expand accepts every documented form and rejects non-references", () => {
  expectValid({ resource: "Policy", expand: { insured: true } });
  expectValid({ resource: "Policy", expand: { insured: {} } });
  expectValid({ resource: "Policy", expand: { insured: "hq" } });
  expectValid({ resource: "Policy", expand: { exposure_units: { location: { buildings: true } } } });
  assert.deepEqual(codes({ resource: "Policy", expand: { premium: true } }), ["NOT_EXPANDABLE"]);
  assert.deepEqual(codes({ resource: "Policy", expand: { dates: true } }), ["NOT_EXPANDABLE"]);
  assert.deepEqual(codes({ resource: "Policy", expand: { nope: true } }), ["UNKNOWN_FIELD"]);
});

/* Projection, aggregation, unwind, sort, pagination. */

test("select accepts paths, projection trees, $expand leaves and aggregation aliases", () => {
  expectValid({ resource: "Policy", select: ["id", "premium", "dates.effective"] });
  expectValid({ resource: "Policy", select: { id: true, dates: { effective: true } } });
  expectValid({ resource: "Policy", select: { insured: { $expand: { select: ["name"] } } } });
  expectValid({ resource: "Policy", select: { insured: { $expand: { select: { hq: { $expand: { select: ["state"] } } } } } } });
  expectValid({
    resource: "Policy",
    expand: { exposure_units: { location: { buildings: true } } },
    unwind: ["exposure_units", "exposure_units.location.buildings"],
    over: ["id"],
    select: { id: true, totalTiv: { $sum: "exposure_units.location.buildings.tiv" }, buildings: { $count: true } },
    sort: [{ field: "totalTiv", direction: "desc" }],
  });
});

test("select cannot read through an unexpanded reference or invent a non-aggregate alias", () => {
  const through = validateQuery(index, { resource: "Policy", select: { insured: { name: true } } });
  assert.equal(through.errors[0].code, "REFERENCE_NOT_EXPANDED");
  assert.match(through.errors[0].hint ?? "", /\$expand/);
  expectValid({ resource: "Policy", expand: { insured: true }, select: { insured: { name: true } } });
  assert.deepEqual(codes({ resource: "Policy", select: { totalTiv: true } }), ["UNKNOWN_FIELD"]);
  assert.deepEqual(codes({ resource: "Policy", select: { insured: { $expand: { select: ["hq.state"] } } } }), ["REFERENCE_NOT_EXPANDED"]);
});

test("unwind, sort and pagination shapes are checked", () => {
  assert.deepEqual(codes({ resource: "Policy", unwind: ["premium"] }), ["BAD_SHAPE"]);
  assert.deepEqual(codes({ resource: "Policy", unwind: ["exposure_units"] }), ["REFERENCE_NOT_EXPANDED"]);
  expectValid({ resource: "Policy", expand: { exposure_units: true }, unwind: [{ path: "exposure_units", type: "left" }] });
  assert.deepEqual(codes({ resource: "Policy", sort: [{ field: "premium", direction: "down" }] }), ["BAD_SORT"]);
  assert.deepEqual(codes({ resource: "Policy", sort: [{ field: "nope" }] }), ["UNKNOWN_FIELD"]);
  assert.deepEqual(codes({ resource: "Policy", pagination: { limit: 0 } }), ["BAD_PAGINATION"]);
  assert.deepEqual(codes({ resource: "Policy", pagination: { limit: 10, offset: -1 } }), ["BAD_PAGINATION"]);
  expectValid({ resource: "Policy", pagination: { limit: 100, offset: 200 } });
});

/* The executor: a rejected payload never reaches the API. */

function compiled(payload: QueryPayload, ...fallbacks: QueryPayload[]) {
  return { purpose: "test query", payload, fallbacks };
}

const bad: QueryPayload = { resource: "Policy", filter: { "exposure_units.kind": "location" } };
const good: QueryPayload = { resource: "Policy", pagination: { limit: 5 } };

test("a payload the validator rejects is skipped without an API call and the fallback is sent", async () => {
  const sent: QueryPayload[] = [];
  const execute = async (payload: QueryPayload) => {
    sent.push(payload);
    return { output: [{ data: { total: 1, results: [{ id: 1 }] } }] };
  };
  const trace = createTrace();
  const result = await runQuery(execute, compiled(bad, good), trace, { validate: (payload) => validateQuery(index, payload) });

  assert.deepEqual(sent, [good], "only the valid fallback reached the executor");
  assert.equal(result.rows.length, 1);
  const rejected = trace.steps.find((step) => step.title === "Rejected locally before sending");
  assert.ok(rejected, "the rejection is traced");
  assert.equal(rejected.stage, "repair");
  assert.match(rejected.detail, /\$elemMatch/);
  assert.match(rejected.detail, /No API call was spent/);
});

test("when every payload is rejected locally the error carries the VALIDATION_ERROR code", async () => {
  let calls = 0;
  const execute = async () => {
    calls += 1;
    return {};
  };
  await assert.rejects(
    runQuery(execute, compiled(bad), createTrace(), { validate: (payload) => validateQuery(index, payload) }),
    /\[VALIDATION_ERROR\].*\$elemMatch/s,
  );
  assert.equal(calls, 0);
});

test("a repair hook may rewrite a rejected payload, and the rewrite is validated before it is sent", async () => {
  const sent: QueryPayload[] = [];
  const execute = async (payload: QueryPayload) => {
    sent.push(payload);
    return { output: [{ data: { total: 1, results: [{ id: 1 }] } }] };
  };
  const fixed: QueryPayload = { resource: "Policy", expand: { exposure_units: true }, filter: { exposure_units: { $elemMatch: { kind: "location" } } } };
  const trace = createTrace();
  await runQuery(execute, compiled(bad, good), trace, {
    validate: (payload) => validateQuery(index, payload),
    repair: async () => fixed,
  });
  assert.deepEqual(sent, [fixed], "the validated rewrite was sent instead of the fallback");
  assert.ok(trace.steps.some((step) => step.title === "The rewritten query validates"));
});

test("a rewrite that still fails validation is discarded and the fallback is used", async () => {
  const sent: QueryPayload[] = [];
  const execute = async (payload: QueryPayload) => {
    sent.push(payload);
    return { output: [{ data: { total: 0, results: [] } }] };
  };
  const trace = createTrace();
  await runQuery(execute, compiled(bad, good), trace, {
    validate: (payload) => validateQuery(index, payload),
    repair: async () => ({ resource: "Policy", where: { premum: 1 } }),
  });
  assert.deepEqual(sent, [good]);
  assert.ok(trace.steps.some((step) => step.title === "The rewritten query still fails validation"));
});
