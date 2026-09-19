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
export type AppetiteStatus = "in_appetite" | "needs_investigation" | "out_of_appetite";

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

export interface RankedSubmission extends CanonicalSubmission {
  status: AppetiteStatus;
  score: number;
  factors: FactorEvaluation[];
  recommendation: string;
  explanation: string;
}

export interface RankingsResponse {
  source: "demo" | "federato";
  generatedAt: string;
  schemaDiscovered: boolean;
  trace: string[];
  submissions: RankedSubmission[];
}
