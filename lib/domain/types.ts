export type FactorKey =
  | "submissionType"
  | "lineOfBusiness"
  | "primaryRiskState"
  | "tiv"
  | "totalPremium"
  | "buildingYear"
  | "construction"
  | "fiveYearLossValue";

export type AppetiteVerdict = "target" | "acceptable" | "not_acceptable" | "unknown";
export type AppetiteStatus = "in_appetite" | "needs_investigation" | "out_of_appetite" | "out_of_scope";

export interface CanonicalSubmission {
  id: string;
  accountName: string;
  submissionType?: string;
  lineOfBusiness?: string;
  primaryRiskState?: string;
  effectiveDate?: string;
  expirationDate?: string;
  tiv?: number;
  totalPremium?: number;
  buildingYear?: number;
  approvedConstructionPercentage?: number;
  constructionDescription?: string;
  fiveYearLossValue?: number;
}

export interface FactorEvaluation {
  key: FactorKey;
  label: string;
  verdict: AppetiteVerdict;
  reason: string;
}

/**
 * The submission's actual historical disposition, read straight from the raw
 * Federato `Submission.status` (received → cleared → quoted → bound/declined/lost).
 * This is a workflow/lifecycle outcome, NOT an appetite verdict. Like
 * `enrichment`, it is a read-only decision-support layer attached AFTER ranking:
 * the appetite engine only ever sees `CanonicalSubmission`, so this can never
 * influence a score or status. It exists so the UI can contrast what the carrier
 * actually did with what the appetite engine independently recommends.
 */
export interface ActualOutcome {
  /** Raw `Submission.status` lifecycle disposition (e.g. "bound", "declined"). */
  status: string;
  /** Present only on declined submissions (`Submission.decline_reason`). */
  declineReason?: string;
}

export interface RankedSubmission extends CanonicalSubmission {
  status: AppetiteStatus;
  score: number;
  factors: FactorEvaluation[];
  recommendation: string;
  explanation: string;
  enrichment?: HazardProfile;
  actualOutcome?: ActualOutcome;
  /** Public/government context signals — decision support only; never scored. */
  context?: ContextSignal[];
}

/** One appetite requirement and the schema field the query agent chose for it. */
export interface QueryReasoningField {
  field: string;
  label: string;
  appetiteReason: string;
  /** `Resource.path` in the discovered schema, or undefined when unresolved. */
  schemaPath?: string;
  reason: string;
  chosenBy: "heuristic" | "llm";
  /** Expansion/array behaviour the path needs, in plain words. */
  requires?: string;
  alternatives: string[];
}

export interface QueryReasoningStep {
  stage: string;
  title: string;
  detail: string;
}

/**
 * Credential-free, serializable record of how the query agent reasoned:
 * which resource holds the queue, which field answers each requirement and
 * why, what could not be resolved, and every step it took (queries, repairs,
 * derivations, warnings). Rendered by the shared UI.
 */
export interface QueryReasoning {
  rootResource: string;
  queueResource?: string;
  plannedBy: "heuristic" | "llm";
  fields: QueryReasoningField[];
  unresolved: Array<{ field: string; reason: string }>;
  fallbacks: string[];
  steps: QueryReasoningStep[];
}

/** A single public-data signal attached beside (never inside) appetite. */
export interface ContextSignal {
  source: string;
  label: string;
  value: string;
  url: string;
  asOf: string;
}

export interface RankingsResponse {
  source: "demo" | "federato";
  generatedAt: string;
  schemaDiscovered: boolean;
  trace: string[];
  /** Present when the query agent ran (offline replay or live). */
  queryTrace?: QueryReasoning;
  submissions: RankedSubmission[];
}

export type HazardRating =
  | "very low"
  | "relatively low"
  | "relatively moderate"
  | "relatively high"
  | "very high"
  | "unknown";

export interface HazardEntry {
  type: string;        // e.g. "Wildfire", "Coastal Flooding", "Hurricane"
  rating: HazardRating;
}

export interface HazardProfile {
  compositeRating: HazardRating;
  compositeScore?: number;      // 0-100 NRI score when available
  topHazards: HazardEntry[];    // highest-rated hazards, most severe first
  source: "FEMA NRI";
  asOf: string;                 // ISO date the data was captured
}
