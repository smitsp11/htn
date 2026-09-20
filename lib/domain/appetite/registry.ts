import type { CanonicalSubmission, FactorEvaluation, LineOfBusiness } from "@/lib/domain/types";
import { evaluatePropertyFactors } from "./lines/property";

export type AppetiteProvenance = "provided-pdf" | "synthesized-for-demo";

export interface AppetiteTable {
  line: LineOfBusiness;
  displayName: string;
  provenance: AppetiteProvenance;
  evaluate(submission: CanonicalSubmission): FactorEvaluation[];
}

const PROPERTY_TABLE: AppetiteTable = {
  line: "property",
  displayName: "Commercial Property",
  provenance: "provided-pdf",
  evaluate: evaluatePropertyFactors,
};

export const APPETITE_TABLES: Record<LineOfBusiness, AppetiteTable> = {
  property: PROPERTY_TABLE,
} as Record<LineOfBusiness, AppetiteTable>;

export function tableFor(line?: string): AppetiteTable | undefined {
  const key = line?.trim().toLowerCase();
  if (!key) return undefined;
  if (key.includes("property")) return APPETITE_TABLES.property;
  return APPETITE_TABLES[key as LineOfBusiness];
}
