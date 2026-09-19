/**
 * Federato schema fixtures mirroring the REAL captured shape
 * (`{ output: [ { data: { <Resource>: { type, fields: { <field>: { type,
 * optional, resource?, cardinality? } } } } } ] }`). Hand-built subsets are
 * enough to prove the planner resolves the appetite paths across the reference
 * graph, emits a `$expand` projection, and degrades gracefully on alien input.
 */

/** The real capture envelope with the resources/fields the planner traverses. */
export const realSchema = {
  output: [
    {
      data: {
        Submission: {
          type: "object",
          optional: false,
          fields: {
            id: { type: "number", optional: false },
            status: { type: "string", optional: false },
            insured: { type: "reference", optional: false, resource: "Insured", cardinality: "one" },
            line_of_business: { type: "string", optional: false },
            submission_number: { type: "string", optional: false },
            target_effective_date: { type: "string", optional: false },
          },
        },
        Policy: {
          type: "object",
          optional: false,
          fields: {
            id: { type: "number", optional: false },
            dates: { type: "object", optional: false },
            premium: { type: "number", optional: false },
            status: { type: "string", optional: false },
            claims: { type: "reference", optional: false, resource: "Claim", cardinality: "many" },
            business_type: { type: "string", optional: false },
            line_of_business: { type: "string", optional: false },
            submission: { type: "reference", optional: false, resource: "Submission", cardinality: "one" },
            exposure_units: { type: "reference", optional: false, resource: "ExposureUnit", cardinality: "many" },
          },
        },
        Insured: {
          type: "object",
          optional: false,
          fields: {
            id: { type: "number", optional: false },
            name: { type: "string", optional: false },
            hq: { type: "reference", optional: false, resource: "Location", cardinality: "one" },
          },
        },
        ExposureUnit: {
          type: "object",
          optional: false,
          fields: {
            id: { type: "number", optional: false },
            location: { type: "reference", optional: false, resource: "Location", cardinality: "one" },
          },
        },
        Location: {
          type: "object",
          optional: false,
          fields: {
            id: { type: "number", optional: false },
            state: { type: "string", optional: false },
            buildings: { type: "reference", optional: false, resource: "Building", cardinality: "many" },
          },
        },
        Building: {
          type: "object",
          optional: false,
          fields: {
            id: { type: "number", optional: false },
            tiv: { type: "number", optional: false },
            year_built: { type: "number", optional: false },
            building_value: { type: "number", optional: false },
            construction_type: { type: "string", optional: false },
          },
        },
        Claim: {
          type: "object",
          optional: false,
          fields: {
            id: { type: "number", optional: false },
            policy: { type: "reference", optional: false, resource: "Policy", cardinality: "one" },
            date_of_loss: { type: "string", optional: false },
            paid_expense: { type: "number", optional: false },
            paid_indemnity: { type: "number", optional: false },
          },
        },
      },
    },
  ],
};

/** Map-of-resources form (no envelope) — a different valid shape the parser accepts. */
export const schemaAsMap = {
  Submission: {
    fields: {
      id: { type: "number" },
      insured: { type: "reference", resource: "Insured", cardinality: "one" },
      line_of_business: { type: "string" },
      submission_number: { type: "string" },
    },
  },
  Insured: {
    fields: {
      id: { type: "number" },
      name: { type: "string" },
    },
  },
};

/** Completely alien schema: nothing the planner knows how to map. */
export const alienSchema = {
  output: [
    {
      data: {
        Widget: {
          type: "object",
          fields: {
            sku: { type: "string" },
            color: { type: "string" },
          },
        },
      },
    },
  ],
};

/** Malformed / empty schema inputs the planner must tolerate without throwing. */
export const emptySchema = {};
export const nullSchema = null;
