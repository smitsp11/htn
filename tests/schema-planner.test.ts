import assert from "node:assert/strict";
import test from "node:test";
import {
  FIELD_REQUIREMENTS,
  parseSchema,
  planQuery,
} from "../lib/federato/schema-planner";
import { buildQueryTrace, traceToLines } from "../lib/federato/query-trace";
import {
  alienSchema,
  emptySchema,
  nullSchema,
  renamedSchema,
  schemaAsMap,
  schemaWithSubmissions,
} from "./fixtures/federato/schema";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "expected a record");
  return value as Json;
}

test("parseSchema normalizes an array-of-resources shape", () => {
  const parsed = parseSchema(schemaWithSubmissions);
  const submissions = parsed.resources.find((resource) => resource.name === "submissions");
  assert.ok(submissions, "submissions resource should be discovered");
  const account = submissions.fields.find((field) => field.name === "account");
  assert.equal(account?.isReference, true, "account should be classified as a reference");
  const locations = submissions.fields.find((field) => field.name === "locations");
  assert.equal(locations?.isArray, true, "locations should be classified as an array");
});

test("parseSchema also handles a map-of-resources shape", () => {
  const parsed = parseSchema(schemaAsMap);
  const submissions = parsed.resources.find((resource) => resource.name === "submissions");
  assert.ok(submissions, "submissions resource should be discovered from the map form");
  assert.ok(submissions.fields.some((field) => field.name === "tiv"));
});

test("planQuery maps every appetite concept to a schema path and builds a projection", () => {
  const plan = planQuery(schemaWithSubmissions);
  assert.equal(plan.resource, "submissions");
  assert.equal(plan.resourceResolved, true);

  // Every one of the eight appetite factors resolves to a concrete path.
  const factorFields = plan.fields.filter((field) => field.factor);
  assert.equal(factorFields.length, 8, "all eight appetite factors should be planned");
  for (const field of factorFields) {
    assert.ok(field.resolved, `factor ${field.factor} should resolve`);
    assert.ok(field.matchedPath, `factor ${field.factor} should have a matched path`);
  }

  const projection = asRecord(plan.projection);
  assert.equal(projection.resource, "submissions");
  // where/filter are intentionally empty so no submission is dropped.
  assert.deepEqual(projection.where, {});
  assert.deepEqual(projection.filter, {});

  const select = asRecord(projection.select);
  // Reference uses $expand.
  const account = asRecord(select.account);
  assert.ok("$expand" in account, "account reference should be expanded");
  // Array selects its leaves and aggregates client-side.
  const locations = asRecord(select.locations);
  assert.ok(Array.isArray(locations.select));
  assert.ok((locations.select as string[]).includes("state"));
  assert.ok((locations.select as string[]).includes("tiv"));
  // Scalar is selected directly.
  assert.equal(select.submissionType, true);
});

test("planned array factors carry a documented $elemMatch template for developers", () => {
  const plan = planQuery(schemaWithSubmissions);
  const primaryState = plan.fields.find((field) => field.canonicalField === "primaryRiskState");
  assert.ok(primaryState?.elemMatchExample, "array field should expose an $elemMatch template");
  const template = asRecord(primaryState.elemMatchExample);
  const locations = asRecord(template.locations);
  assert.ok("$elemMatch" in locations, "$elemMatch should target the array root");
});

test("planQuery handles a renamed schema gracefully (resolves what it can, surfaces the rest)", () => {
  const plan = planQuery(renamedSchema);
  assert.equal(plan.resource, "accounts");
  const resolved = plan.fields.filter((field) => field.resolved).map((field) => field.canonicalField);
  const unresolved = plan.fields.filter((field) => !field.resolved).map((field) => field.canonicalField);
  // Recognisable renames still resolve.
  assert.ok(resolved.includes("submissionType"), "type -> submissionType should resolve");
  assert.ok(resolved.includes("lineOfBusiness"), "lob -> lineOfBusiness should resolve");
  assert.ok(resolved.includes("primaryRiskState"), "riskState -> primaryRiskState should resolve");
  // Unmappable fields surface as unresolved rather than being invented.
  assert.ok(unresolved.includes("tiv"));
  assert.ok(unresolved.length > 0);
});

test("planQuery flags a fallback resource and unresolved fields for an alien schema", () => {
  const plan = planQuery(alienSchema);
  assert.equal(plan.resourceResolved, false, "alien resource is a fallback, not a confirmed match");
  const unresolved = plan.fields.filter((field) => !field.resolved);
  assert.equal(unresolved.length, FIELD_REQUIREMENTS.length, "nothing should resolve against an alien schema");
});

test("planQuery does not throw on empty or null schema input", () => {
  for (const schema of [emptySchema, nullSchema]) {
    const plan = planQuery(schema);
    assert.equal(plan.resource, "submissions", "falls back to the assumed queue resource");
    assert.equal(plan.resourceResolved, false);
    assert.ok(plan.fields.every((field) => !field.resolved));
  }
});

test("buildQueryTrace produces a credential-free, serializable trace", () => {
  const plan = planQuery(schemaWithSubmissions);
  const trace = buildQueryTrace(plan, { generatedFromSchema: true });

  assert.equal(trace.resource, "submissions");
  assert.equal(trace.fields.length, FIELD_REQUIREMENTS.length);
  assert.equal(trace.unresolvedFields.length, 0);
  for (const field of trace.fields) {
    assert.ok(field.appetiteReason.length > 0, `field ${field.field} needs an appetite reason`);
    assert.ok(field.schemaMatch.length > 0);
  }

  // Serializable and free of anything sensitive.
  const serialized = JSON.stringify(trace);
  assert.doesNotMatch(serialized, /token|secret|authorization|bearer|client_secret/i);
  const roundTripped = JSON.parse(serialized) as typeof trace;
  assert.equal(roundTripped.resource, trace.resource);
  assert.equal(roundTripped.fields.length, trace.fields.length);
});

test("traceToLines summarizes resolution for the existing string[] trace", () => {
  const plan = planQuery(renamedSchema);
  const lines = traceToLines(buildQueryTrace(plan));
  assert.ok(lines.some((line) => line.includes("accounts")));
  assert.ok(lines.some((line) => line.includes("Unresolved fields")));
});
