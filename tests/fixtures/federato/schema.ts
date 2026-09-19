/**
 * ASSUMED Federato schema fixtures. The real schema is undocumented; these model
 * realistic shapes the schema endpoint might return so the planner tests can
 * prove it resolves fields, emits a projection, and degrades gracefully when the
 * schema is renamed or alien.
 */

/** Array-of-resources shape with typed fields, references, and arrays. */
export const schemaWithSubmissions = {
  resources: [
    {
      name: "submissions",
      fields: [
        { name: "id", type: "string" },
        { name: "account", type: "reference", ref: "accounts" },
        { name: "submissionType", type: "string" },
        { name: "lineOfBusiness", type: "string" },
        { name: "effectiveDate", type: "date" },
        { name: "expirationDate", type: "date" },
        { name: "totalPremium", type: "number" },
        { name: "locations", type: "array" },
        { name: "lossHistory", type: "array" },
        { name: "producer", type: "reference", ref: "producers" },
      ],
    },
    {
      name: "accounts",
      fields: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
      ],
    },
  ],
};

/** Map-of-resources shape (fields as an object map) — a different valid form. */
export const schemaAsMap = {
  schema: {
    submissions: {
      fields: {
        id: "string",
        accountName: "string",
        submissionType: "string",
        lineOfBusiness: "string",
        primaryRiskState: "string",
        tiv: "number",
        totalPremium: "number",
        buildingYear: "number",
        approvedConstructionPercentage: "number",
        constructionDescription: "string",
        fiveYearLossValue: "number",
      },
    },
  },
};

/**
 * Renamed schema: the queue resource and several fields use alternate but still
 * recognisable names (`accounts` resource, `type`, `lob`). The planner should
 * fall back to the first resource and resolve via alternate candidate paths.
 */
export const renamedSchema = {
  resources: [
    {
      name: "accounts",
      fields: [
        { name: "accountId", type: "string" },
        { name: "name", type: "string" },
        { name: "type", type: "string" },
        { name: "lob", type: "string" },
        { name: "riskState", type: "string" },
      ],
    },
  ],
};

/** Completely alien schema: nothing the planner knows how to map. */
export const alienSchema = {
  resources: [
    {
      name: "widgets",
      fields: [
        { name: "sku", type: "string" },
        { name: "color", type: "string" },
      ],
    },
  ],
};

/** Malformed / empty schema inputs the planner must tolerate without throwing. */
export const emptySchema = {};
export const nullSchema = null;
