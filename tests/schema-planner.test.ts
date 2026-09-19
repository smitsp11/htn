import assert from "node:assert/strict";
import test from "node:test";
import { FIELD_REQUIREMENTS, parseSchema, planQuery } from "../lib/federato/schema-planner";
import { buildQueryTrace, traceToLines } from "../lib/federato/query-trace";
import { alienSchema, emptySchema, nullSchema, realSchema, schemaAsMap } from "./fixtures/federato/schema";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "expected a record");
  return value as Json;
}

test("parseSchema unwraps the real output[0].data envelope and classifies fields", () => {
  const parsed = parseSchema(realSchema);
  const submission = parsed.resources.find((resource) => resource.name === "Submission");
  assert.ok(submission, "Submission resource should be discovered");
  const insured = submission.fields.find((field) => field.name === "insured");
  assert.equal(insured?.isReference, true, "insured should be a reference");
  assert.equal(insured?.resource, "Insured", "insured should target the Insured resource");
  const policy = parsed.resources.find((resource) => resource.name === "Policy");
  const exposureUnits = policy?.fields.find((field) => field.name === "exposure_units");
  assert.equal(exposureUnits?.isArray, true, "exposure_units (cardinality many) should be an array");
  assert.equal(exposureUnits?.isReference, true, "exposure_units should also be a reference");
});

test("parseSchema also handles a map-of-resources shape", () => {
  const parsed = parseSchema(schemaAsMap);
  const submission = parsed.resources.find((resource) => resource.name === "Submission");
  assert.ok(submission, "Submission resource should be discovered from the map form");
  assert.ok(submission.fields.some((field) => field.name === "submission_number"));
});

test("planQuery resolves every appetite factor across the real reference graph", () => {
  const plan = planQuery(realSchema);
  assert.equal(plan.resource, "Submission");
  assert.equal(plan.resourceResolved, true);

  const factorFields = plan.fields.filter((field) => field.factor);
  assert.equal(factorFields.length, 8, "all eight appetite factors should be planned");
  for (const field of factorFields) {
    assert.ok(field.resolved, `factor ${field.factor} should resolve`);
    assert.ok(field.matchedPath, `factor ${field.factor} should have a matched path`);
  }
});

test("planQuery builds a nested $expand projection with empty where/filter", () => {
  const plan = planQuery(realSchema);
  const projection = asRecord(plan.projection);
  assert.equal(projection.resource, "Submission");
  assert.deepEqual(projection.where, {});
  assert.deepEqual(projection.filter, {});

  const select = asRecord(projection.select);
  // Scalars selected directly.
  assert.equal(select.submission_number, true);
  assert.equal(select.line_of_business, true);
  // insured reference is expanded to its name.
  const insured = asRecord(select.insured);
  const insuredExpand = asRecord(insured.$expand);
  assert.equal(asRecord(insuredExpand.select).name, true);
  // policy (reverse relation) expands, and the deep chain reaches building.tiv.
  const policy = asRecord(select.policy);
  const policySelect = asRecord(asRecord(policy.$expand).select);
  const exposure = asRecord(policySelect.exposure_units);
  const exposureSelect = asRecord(asRecord(exposure.$expand).select);
  const location = asRecord(exposureSelect.location);
  const locationSelect = asRecord(asRecord(location.$expand).select);
  const buildings = asRecord(locationSelect.buildings);
  const buildingsSelect = asRecord(asRecord(buildings.$expand).select);
  assert.equal(buildingsSelect.tiv, true);
  assert.equal(buildingsSelect.year_built, true);
  assert.equal(buildingsSelect.construction_type, true);
  // policy.claims is expanded for the loss run.
  assert.ok("claims" in policySelect, "policy.claims should be part of the projection");
});

test("planned array factors carry a documented $elemMatch template for developers", () => {
  const plan = planQuery(realSchema);
  const tiv = plan.fields.find((field) => field.canonicalField === "tiv");
  assert.ok(tiv?.elemMatchExample, "array field should expose an $elemMatch template");
  const template = asRecord(tiv.elemMatchExample);
  const arrayRoot = asRecord(template.exposure_units);
  assert.ok("$elemMatch" in arrayRoot, "$elemMatch should target the array root (exposure_units)");
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
    assert.equal(plan.resource, "Submission", "falls back to the assumed queue resource");
    assert.equal(plan.resourceResolved, false);
    assert.ok(plan.fields.every((field) => !field.resolved));
  }
});

test("buildQueryTrace produces a credential-free, serializable trace", () => {
  const plan = planQuery(realSchema);
  const trace = buildQueryTrace(plan, { generatedFromSchema: true });

  assert.equal(trace.resource, "Submission");
  assert.equal(trace.fields.length, FIELD_REQUIREMENTS.length);
  assert.equal(trace.unresolvedFields.length, 0);
  for (const field of trace.fields) {
    assert.ok(field.appetiteReason.length > 0, `field ${field.field} needs an appetite reason`);
    assert.ok(field.schemaMatch.length > 0);
  }

  const serialized = JSON.stringify(trace);
  assert.doesNotMatch(serialized, /token|secret|authorization|bearer|client_secret/i);
  const roundTripped = JSON.parse(serialized) as typeof trace;
  assert.equal(roundTripped.resource, trace.resource);
  assert.equal(roundTripped.fields.length, trace.fields.length);
});

test("traceToLines summarizes resolution for the existing string[] trace", () => {
  const plan = planQuery(alienSchema);
  const lines = traceToLines(buildQueryTrace(plan));
  assert.ok(lines.some((line) => line.includes("Unresolved fields")));
});
