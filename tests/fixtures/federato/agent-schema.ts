/**
 * A hand-built schema in the real capture envelope
 * (`{ output: [ { data: { <Resource>: { type, fields } } } ] }`) with the
 * reference graph the query agent has to reason over: Policy → ExposureUnit →
 * Location → Building, Policy → Claim, Policy → Insured → Location (HQ), and
 * Policy → Submission (the queue). Lookalike fields (a driver's licence state,
 * a roof year, a target premium, HQ buildings) are there to be avoided.
 */
export const agentSchema = {
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
            target_effective_date: { type: "string" },
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
            county: { type: "string" },
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
