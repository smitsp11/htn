/**
 * The data the 2025 commercial-property appetite guidelines need.
 *
 * These are *data* requirements, not thresholds. Person 3 owns every threshold,
 * verdict, and weighting; this file only says which facts must be fetched and
 * why an underwriter cares about them. Every synonym below is a name fragment
 * to search the discovered schema for; nothing is used until the schema
 * confirms it exists.
 */

export type RequirementKey =
  | "submissionIdentifier"
  | "accountName"
  | "submissionType"
  | "lineOfBusiness"
  | "riskState"
  | "effectiveDate"
  | "expirationDate"
  | "tiv"
  | "exposureValue"
  | "requestedLimit"
  | "totalPremium"
  | "buildingYear"
  | "constructionType"
  | "lossAmount"
  | "lossDate";

export interface RequirementSpec {
  key: RequirementKey;
  label: string;
  /** Shown in the trace so an underwriter can see why the agent asked for it. */
  appetiteReason: string;
  expectedType: "string" | "number";
  /** Field-name fragments that usually carry this fact. */
  synonyms: string[];
  /** Fragments that look similar but mean something else. */
  avoid?: string[];
  /**
   * Sibling fields projected alongside the match because the derivation reads
   * them (a building's value to weight by, a claim's expense to add). Each is
   * resolved against the schema and silently skipped when absent.
   */
  supporting?: string[];
  /** "queue" requirements are only planned against the queue resource. */
  scope?: "queue";
  required: boolean;
}

export const REQUIREMENTS: RequirementSpec[] = [
  {
    key: "submissionIdentifier",
    label: "Submission identifier",
    appetiteReason: "Every ranked row needs a stable identifier an underwriter can quote.",
    expectedType: "string",
    synonyms: ["submission_number", "policy_number", "number"],
    required: true,
  },
  {
    key: "accountName",
    label: "Account name",
    appetiteReason: "Named as a required data point by the appetite guidelines.",
    expectedType: "string",
    synonyms: ["insured.name", "account_name", "name", "dba"],
    avoid: ["broker", "contact", "underwriter", "carrier"],
    required: true,
  },
  {
    key: "submissionType",
    label: "Submission type",
    appetiteReason: "New business is acceptable; renewal business is not acceptable.",
    expectedType: "string",
    synonyms: ["business_type", "submission_type"],
    required: true,
  },
  {
    key: "lineOfBusiness",
    label: "Line of business",
    appetiteReason: "Property is acceptable; every other line is not acceptable.",
    expectedType: "string",
    synonyms: ["line_of_business", "lob"],
    required: true,
  },
  {
    key: "riskState",
    label: "Risk state",
    appetiteReason: "Target states are OH, PA, MD, CO, CA and FL; six more are acceptable.",
    expectedType: "string",
    synonyms: ["state", "risk_state"],
    avoid: ["license_state", "garaging", "census", "classification", "region", "hq"],
    supporting: ["id", "county"],
    required: true,
  },
  {
    key: "effectiveDate",
    label: "Effective date",
    appetiteReason: "Named as a required data point and anchors the five-year loss window.",
    expectedType: "string",
    synonyms: ["dates.effective", "effective", "target_effective_date"],
    avoid: ["retroactive", "edition"],
    required: true,
  },
  {
    key: "expirationDate",
    label: "Expiration date",
    appetiteReason: "Named as a required data point by the appetite guidelines.",
    expectedType: "string",
    synonyms: ["dates.expiration", "expiration"],
    required: false,
  },
  {
    key: "tiv",
    label: "Total insured value",
    appetiteReason: "Target TIV is $50M–$100M; over $150M is not acceptable.",
    expectedType: "number",
    synonyms: ["tiv", "total_insured_value", "building_value"],
    avoid: ["contents_value", "business_interruption", "requested_limit", "basis_amount"],
    supporting: ["id", "building_value"],
    required: true,
  },
  {
    key: "exposureValue",
    label: "Exposure basis amount",
    appetiteReason:
      "Stand-in for TIV when a policy has no building schedule; only units measured on an insured-value basis count.",
    expectedType: "number",
    synonyms: ["basis_amount", "exposure_amount", "insured_value"],
    avoid: ["hq", "claims"],
    supporting: ["id", "kind", "basis"],
    required: false,
  },
  {
    key: "requestedLimit",
    label: "Requested limit",
    appetiteReason:
      "Low-confidence stand-in for TIV on a submission that has no policy or building schedule yet.",
    expectedType: "number",
    synonyms: ["requested_limit", "limit_requested"],
    avoid: ["claims", "underlying"],
    scope: "queue",
    required: false,
  },
  {
    key: "totalPremium",
    label: "Total premium",
    appetiteReason: "Target premium is $75K–$100K; outside $50K–$175K is not acceptable.",
    expectedType: "number",
    synonyms: ["premium"],
    avoid: ["target_premium", "technical_premium", "premium_change", "commission"],
    required: true,
  },
  {
    key: "buildingYear",
    label: "Building year",
    appetiteReason: "Target is newer than 2010; older than 1990 is not acceptable.",
    expectedType: "number",
    synonyms: ["year_built", "building_year", "year_of_construction"],
    avoid: ["roof_year", "year_founded", "bar_admission"],
    supporting: ["id", "tiv", "building_value"],
    required: true,
  },
  {
    key: "constructionType",
    label: "Construction type",
    appetiteReason:
      "Over 50% joisted masonry, non-combustible/steel or masonry non-combustible is acceptable.",
    expectedType: "string",
    synonyms: ["construction_type", "construction"],
    supporting: ["id", "tiv", "building_value"],
    required: true,
  },
  {
    key: "lossAmount",
    label: "Loss amount",
    appetiteReason: "Five-year losses under $100K are acceptable; over $100K is not acceptable.",
    expectedType: "number",
    synonyms: ["paid_indemnity", "incurred", "loss_amount"],
    avoid: ["reserve", "expense"],
    supporting: ["id", "paid_expense", "reserve_indemnity", "status"],
    required: true,
  },
  {
    key: "lossDate",
    label: "Date of loss",
    appetiteReason: "Bounds the loss history to the five-year window the guidelines require.",
    expectedType: "string",
    synonyms: ["date_of_loss", "loss_date", "reported_date"],
    required: false,
  },
];

export const REQUIREMENTS_BY_KEY = new Map(REQUIREMENTS.map((item) => [item.key, item]));
