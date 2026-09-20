import assert from "node:assert/strict";
import test from "node:test";
import { buildSchemaIndex } from "../lib/federato/schema-index";
import {
  applyLlmSelections,
  candidatesFor,
  chooseRootResource,
  findFallbackLocation,
  findQueueLink,
  planFromSchema,
  planQueueResource,
} from "../lib/federato/schema-planner";
import {
  buildExpandStage,
  buildQueueQuery,
  buildRootQuery,
  buildTivCheckQuery,
  projectedPaths,
} from "../lib/federato/query-compiler";
import { createTrace } from "../lib/federato/query-trace";
import { REQUIREMENTS_BY_KEY } from "../lib/federato/requirements";
import { agentSchema } from "./fixtures/federato/agent-schema";

const index = buildSchemaIndex(agentSchema);

test("the schema envelope is unwrapped and every resource is indexed", () => {
  assert.deepEqual(index.resources.sort(), [
    "Building",
    "Claim",
    "ExposureUnit",
    "Insured",
    "Location",
    "Policy",
    "Submission",
  ]);
});

test("resolving a path reports the references to expand and the arrays it crosses", () => {
  const resolved = index.resolve("Policy", "exposure_units.location.buildings.year_built");
  assert.ok(resolved);
  assert.equal(resolved.terminalType, "number");
  assert.deepEqual(resolved.expandChain, [
    "exposure_units",
    "exposure_units.location",
    "exposure_units.location.buildings",
  ]);
  assert.deepEqual(resolved.manyAt, ["exposure_units", "exposure_units.location.buildings"]);
});

test("a path that does not exist resolves to undefined", () => {
  assert.equal(index.resolve("Policy", "exposure_units.location.sprinklered"), undefined);
  assert.equal(index.resolve("Nope", "id"), undefined);
});

test("the root resource is the record the queue is made of, not a resource that merely reaches it", () => {
  // Claim reaches every policy fact through claim.policy; depth must lose.
  assert.equal(chooseRootResource(index), "Policy");
});

test("the queue resource is discovered through its reference", () => {
  assert.deepEqual(findQueueLink(index, "Policy"), {
    queueResource: "Submission",
    queueLinkPath: "submission",
  });
});

test("lookalike fields lose to the field that carries the actual risk", () => {
  const [state] = candidatesFor(index, "Policy", REQUIREMENTS_BY_KEY.get("riskState")!);
  assert.equal(state.path, "exposure_units.location.state");

  const [premium] = candidatesFor(index, "Policy", REQUIREMENTS_BY_KEY.get("totalPremium")!);
  assert.equal(premium.path, "premium");

  const [year] = candidatesFor(index, "Policy", REQUIREMENTS_BY_KEY.get("buildingYear")!);
  assert.equal(year.path, "exposure_units.location.buildings.year_built");

  const [tiv] = candidatesFor(index, "Policy", REQUIREMENTS_BY_KEY.get("tiv")!);
  assert.equal(tiv.path, "exposure_units.location.buildings.tiv", "per-building value beats the exposure basis");

  const [loss] = candidatesFor(index, "Policy", REQUIREMENTS_BY_KEY.get("lossAmount")!);
  assert.equal(loss.path, "claims.paid_indemnity");
});

test("the plan covers every appetite factor and projects the siblings each derivation reads", () => {
  const plan = planFromSchema(index, createTrace());
  const keys = plan.choices.map((choice) => choice.key);
  for (const key of [
    "submissionType",
    "lineOfBusiness",
    "riskState",
    "tiv",
    "totalPremium",
    "buildingYear",
    "constructionType",
    "lossAmount",
  ]) {
    assert.ok(keys.includes(key as never), `${key} is unplanned`);
  }
  assert.deepEqual(plan.unresolved, []);
  assert.ok(!keys.includes("requestedLimit" as never), "queue-only requirements are not planned on the root");

  const year = plan.choices.find((choice) => choice.key === "buildingYear")!;
  assert.deepEqual(year.supporting.sort(), [
    "exposure_units.location.buildings.id",
    "exposure_units.location.buildings.tiv",
  ]);
  const loss = plan.choices.find((choice) => choice.key === "lossAmount")!;
  assert.ok(loss.supporting.includes("claims.paid_expense"));
  assert.ok(loss.supporting.includes("claims.reserve_indemnity"));
  assert.ok(!loss.supporting.includes("claims.status"), "a sibling the schema lacks is skipped, never invented");
});

test("a fallback location is discovered structurally, with its buildings", () => {
  const plan = planFromSchema(index, createTrace());
  assert.ok(plan.fallback);
  assert.equal(plan.fallback.locationPath, "insured.hq");
  assert.equal(plan.fallback.statePath, "insured.hq.state");
  assert.equal(plan.fallback.buildingsPath, "insured.hq.buildings");
  assert.ok(plan.fallback.projectPaths.includes("insured.hq.buildings.year_built"));
  assert.ok(plan.fallback.projectPaths.includes("insured.hq.buildings.construction_type"));
  assert.ok(plan.fallback.projectPaths.includes("insured.hq.buildings.tiv"));
  assert.ok(plan.fallback.projectPaths.includes("insured.hq.county"));

  const queueFallback = findFallbackLocation(index, "Submission", plan.choices);
  assert.equal(queueFallback?.locationPath, "insured.hq");
});

test("references are hydrated in the expand stage, nested to the depth they need", () => {
  const plan = planFromSchema(index, createTrace());
  const expand = buildExpandStage(plan.choices, plan.fallback);
  assert.deepEqual(expand?.exposure_units, { location: { buildings: true } });
  assert.equal(expand?.claims, true);
  assert.deepEqual(expand?.insured, { hq: { buildings: true } });
});

test("the root query projects every path the assembler reads and keeps the queue link id", () => {
  const plan = planFromSchema(index, createTrace());
  const { payload, fallbacks } = buildRootQuery(plan, 100);
  assert.equal(payload.resource, "Policy");
  assert.equal(payload.pagination?.offset, 100);
  assert.deepEqual(payload.select?.dates, { effective: true, expiration: true });
  // The queue link keeps its id even though the identifier narrows the same reference.
  assert.deepEqual(payload.select?.submission, { id: true, submission_number: true });
  assert.equal(
    plan.choices.find((choice) => choice.key === "submissionIdentifier")?.path,
    "submission.submission_number",
    "the queue record's own number identifies a row, one hop away",
  );
  const buildings = (payload.select as any).exposure_units.location.buildings;
  assert.deepEqual(Object.keys(buildings).sort(), ["construction_type", "id", "tiv", "year_built"]);
  const claims = (payload.select as any).claims;
  assert.deepEqual(Object.keys(claims).sort(), ["date_of_loss", "id", "paid_expense", "paid_indemnity", "reserve_indemnity"]);
  const units = (payload.select as any).exposure_units;
  assert.deepEqual(Object.keys(units).sort(), ["basis", "basis_amount", "id", "kind", "location"]);
  assert.ok(projectedPaths(plan.choices, plan.fallback).includes("insured.hq.state"));
  assert.ok(fallbacks.length > 0, "a rejected projection must have something simpler to fall back to");
  assert.equal(fallbacks[0].select, undefined);
});

test("the queue query asks for the few fields a submission carries before it is bound", () => {
  const plan = planFromSchema(index, createTrace());
  const queuePlan = planQueueResource(index, plan, createTrace());
  assert.ok(queuePlan);
  assert.equal(queuePlan.resource, "Submission");
  assert.deepEqual(
    queuePlan.choices.map((choice) => choice.key).sort(),
    ["accountName", "effectiveDate", "lineOfBusiness", "requestedLimit", "submissionIdentifier"],
  );
  const { payload } = buildQueueQuery(queuePlan);
  assert.equal(payload.resource, "Submission");
  assert.equal((payload.select as any).requested_limit, true);
  assert.equal((payload.select as any).insured.hq.state, true);
});

test("the TIV cross-check unwinds the arrays it aggregates over", () => {
  const plan = planFromSchema(index, createTrace());
  const compiled = buildTivCheckQuery(plan);
  assert.ok(compiled);
  assert.deepEqual(compiled.payload.unwind, ["exposure_units", "exposure_units.location.buildings"]);
  assert.deepEqual(compiled.payload.over, ["id"]);
  assert.deepEqual(compiled.payload.select, {
    id: true,
    totalTiv: { $sum: "exposure_units.location.buildings.tiv" },
  });
});

test("a model field choice is applied only when the schema can resolve it", () => {
  const trace = createTrace();
  const plan = planFromSchema(index, trace);
  const updated = applyLlmSelections(
    plan,
    index,
    [
      { key: "riskState", path: "exposure_units.driver.license_state", reason: "A real but wrong path." },
      { key: "totalPremium", path: "premium_amount", reason: "Hallucinated field." },
    ],
    trace,
  );

  const state = updated.choices.find((choice) => choice.key === "riskState");
  assert.equal(state?.path, "exposure_units.driver.license_state");
  assert.equal(state?.chosenBy, "llm");
  assert.deepEqual(state?.supporting, [], "supporting siblings are recomputed for the new path");

  const premium = updated.choices.find((choice) => choice.key === "totalPremium");
  assert.equal(premium?.path, "premium", "an unresolvable path must not reach the API");
  assert.equal(premium?.chosenBy, "heuristic");
  assert.ok(trace.steps.some((step) => step.stage === "repair"));
});

test("an alien schema degrades to unresolved requirements instead of inventing fields", () => {
  const alien = buildSchemaIndex({
    output: [{ data: { Widget: { type: "object", fields: { id: { type: "number" }, colour: { type: "string" } } } } }],
  });
  const plan = planFromSchema(alien, createTrace());
  assert.equal(plan.rootResource, "Widget");
  assert.ok(plan.unresolved.length >= 8, "every required appetite input is reported missing");
  assert.equal(plan.fallback, undefined);
  const { payload } = buildRootQuery(plan);
  assert.deepEqual(payload.select, { id: true });
});
