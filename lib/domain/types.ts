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

export type Dataset = "baseline" | "extended";

export type LineOfBusiness = "property" | "cgl" | "auto" | "cyber" | "excess" | "health" | "lpl";
export type EvidenceConfidence = "high" | "medium" | "low";

/**
 * Where a factor's input came from and how it was derived. Written by the
 * query agent (Person 2) from its derivation notes, copied verbatim onto the
 * matching `FactorEvaluation` by the appetite engine. Never influences a
 * verdict; it exists so an underwriter can see the provenance of every number.
 */
export interface FactorEvidence {
  /** Plain-language derivation: "Oldest of 5 buildings (1972–2015)." */
  method: string;
  /** Schema path the value was read from, e.g. `Policy.exposure_units.location.buildings.year_built`. */
  sourcePath?: string;
  confidence: EvidenceConfidence;
  /** Anything that makes the value contestable. */
  ambiguity?: string;
}

/** One building on the risk schedule, as the query agent found it. */
export interface BuildingFact {
  year?: number;
  value?: number;
  constructionType?: string;
}

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
  /**
   * The building schedule behind `buildingYear`, `approvedConstructionPercentage`
   * and `tiv`, so the engine can state how sensitive a verdict is to the
   * aggregation rule (oldest building versus value-weighted year). Optional and
   * additive; the verdict itself is always taken from the aggregate fields above.
   */
  buildingSchedule?: BuildingFact[];
  /** Provenance per factor, keyed by the factor it feeds. Optional and additive. */
  derivations?: Partial<Record<FactorKey, FactorEvidence>>;
}

export interface FactorEvaluation {
  key: FactorKey;
  label: string;
  verdict: AppetiteVerdict;
  reason: string;
  /**
   * A longer derivation or sensitivity note the short reason leaves out, e.g.
   * how the verdict would change under a value-weighted building year.
   */
  detail?: string;
  /** True when a not-acceptable value sits within the near-miss band of its boundary. */
  nearMiss?: boolean;
  /** Provenance copied from `CanonicalSubmission.derivations`. */
  evidence?: FactorEvidence;
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
  /** True only for records injected by the Extended synthetic dataset. */
  synthetic?: boolean;
  /** Fields the consolidation waterfall could fill + the re-scored verdict. */
  resolution?: ResolutionResult;
}

/** One required field the consolidation waterfall filled, with provenance. */
export interface ResolvedField {
  key: FactorKey;
  label: string;
  value: number | string;
  /** Formatted for display (money/percent/plain). */
  display: string;
  source: string;
  /** 0–1 confidence the source reported. */
  confidence: number;
  asOf: string;
}

/**
 * Decision-support only: what the appetite verdict WOULD become if the resolved
 * values are accepted. Attached AFTER ranking; the queue's own status/score
 * (`before`) is unchanged. The human underwriter confirms before it counts.
 */
export interface ResolutionResult {
  fields: ResolvedField[];
  before: { status: AppetiteStatus; score: number };
  after: { status: AppetiteStatus; score: number };
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
  /** Which dataset produced this response; absent means baseline. */
  dataset?: Dataset;
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
