import assert from "node:assert/strict";
import test from "node:test";
import { buildSchemaIndex } from "../lib/federato/schema-index";
import {
  applyLlmSelections,
  candidatesFor,
  chooseRootResource,
  findQueueLink,
  planFromSchema,
} from "../lib/federato/schema-planner";
import { buildExpandStage, buildRootQuery, buildTivCheckQuery } from "../lib/federato/query-compiler";
import { createTrace } from "../lib/federato/query-trace";
import { REQUIREMENTS_BY_KEY } from "../lib/federato/requirements";

const schema = {
  output: [
    {
      data: {
        Policy: {
          type: "object",
          fields: {
            id: { type: "number" },
            premium: { type: "number" },
            target_premium: { type: "number" },
            business_type: { type: "string" },
            line_of_business: { type: "string" },
            policy_number: { type: "string" },
            dates: {
              type: "object",
              fields: { effective: { type: "string" }, expiration: { type: "string" } },
            },
            submission: { type: "reference", resource: "Submission", cardinality: "one" },
            claims: { type: "reference", resource: "Claim", cardinality: "many" },
            exposure_units: { type: "reference", resource: "ExposureUnit", cardinality: "many" },
            insured: { type: "reference", resource: "Insured", cardinality: "one" },
          },
        },
        Submission: {
          type: "object",
          fields: {
            id: { type: "number" },
            submission_number: { type: "string" },
            received_date: { type: "string" },
            requested_limit: { type: "number" },
            line_of_business: { type: "string" },
            insured: { type: "reference", resource: "Insured", cardinality: "one" },
          },
        },
        Insured: {
          type: "object",
          fields: {
            id: { type: "number" },
            name: { type: "string" },
            hq: { type: "reference", resource: "Location", cardinality: "one" },
          },
        },
        ExposureUnit: {
          type: "object",
          fields: {
            id: { type: "number" },
            kind: { type: "string" },
            basis: { type: "string" },
            basis_amount: { type: "number" },
            driver: { type: "object", fields: { license_state: { type: "string" } } },
            location: { type: "reference", resource: "Location", cardinality: "one" },
          },
        },
        Location: {
          type: "object",
          fields: {
            id: { type: "number" },
            state: { type: "string" },
            hazard_tags: { type: "array", itemSchema: { type: "string" } },
            buildings: { type: "reference", resource: "Building", cardinality: "many" },
          },
        },
        Building: {
          type: "object",
          fields: {
            id: { type: "number" },
            tiv: { type: "number" },
            year_built: { type: "number" },
            roof_year: { type: "number" },
            construction_type: { type: "string" },
          },
        },
        Claim: {
          type: "object",
          fields: {
            id: { type: "number" },
            date_of_loss: { type: "string" },
            paid_indemnity: { type: "number" },
            paid_expense: { type: "number" },
            reserve_indemnity: { type: "number" },
          },
        },
      },
    },
  ],
};

const index = buildSchemaIndex(schema);

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

test("the root resource is the one that answers the most appetite requirements", () => {
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

  const [loss] = candidatesFor(index, "Policy", REQUIREMENTS_BY_KEY.get("lossAmount")!);
  assert.match(loss.path, /^claims\.(paid|reserve)_indemnity$/);
});

test("the plan covers every appetite factor", () => {
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
});

test("references are hydrated in the expand stage, nested to the depth they need", () => {
  const plan = planFromSchema(index, createTrace());
  const expand = buildExpandStage(plan.choices);
  assert.deepEqual(expand?.exposure_units, { location: { buildings: true } });
  assert.equal(expand?.claims, true);
  assert.equal(expand?.insured, true);
});

test("the root query projects the planned fields and pages", () => {
  const plan = planFromSchema(index, createTrace());
  const { payload, fallbacks } = buildRootQuery(plan, 100);
  assert.equal(payload.resource, "Policy");
  assert.equal(payload.pagination?.offset, 100);
  assert.deepEqual(payload.select?.dates, { effective: true, expiration: true });
  assert.ok(fallbacks.length > 0, "a rejected projection must have something simpler to fall back to");
  assert.equal(fallbacks[0].select, undefined);
});

test("the TIV cross-check unwinds the arrays it aggregates over", () => {
  const plan = planFromSchema(index, createTrace());
  const compiled = buildTivCheckQuery(plan, index);
  assert.ok(compiled);
  assert.ok(compiled.payload.unwind?.includes("exposure_units"));
  assert.deepEqual(compiled.payload.over, ["id"]);
});

test("a model field choice is applied only when the schema can resolve it", () => {
  const trace = createTrace();
  const plan = planFromSchema(index, trace);
  const updated = applyLlmSelections(
    plan,
    index,
    [
      { key: "tiv", path: "exposure_units.location.buildings.tiv", reason: "Per-building values." },
      { key: "totalPremium", path: "premium_amount", reason: "Hallucinated field." },
    ],
    trace,
  );

  const tiv = updated.choices.find((choice) => choice.key === "tiv");
  assert.equal(tiv?.path, "exposure_units.location.buildings.tiv");
  assert.equal(tiv?.chosenBy, "llm");

  const premium = updated.choices.find((choice) => choice.key === "totalPremium");
  assert.equal(premium?.path, "premium", "an unresolvable path must not reach the API");
  assert.equal(premium?.chosenBy, "heuristic");
  assert.ok(trace.steps.some((step) => step.stage === "repair"));
});
