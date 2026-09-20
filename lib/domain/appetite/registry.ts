import type { LineOfBusiness } from "@/lib/domain/types";
import type { AppetiteTable } from "./lines/helpers";
import { evaluatePropertyFactors, PROPERTY_PREMIUM_BANDS } from "./lines/property";
import { CGL_TABLE, AUTO_TABLE, EXCESS_TABLE, LPL_TABLE } from "./lines/casualty";
import { CYBER_TABLE, HEALTH_TABLE } from "./lines/specialty";

// Re-export the table types so existing import paths keep working.
export type { AppetiteTable, AppetiteProvenance } from "./lines/helpers";

const PROPERTY_TABLE: AppetiteTable = {
  line: "property",
  displayName: "Commercial Property",
  provenance: "provided-pdf",
  premiumBands: PROPERTY_PREMIUM_BANDS,
  maxScorePoints: 12,
  evaluate: evaluatePropertyFactors,
};

export const APPETITE_TABLES: Record<LineOfBusiness, AppetiteTable> = {
  property: PROPERTY_TABLE,
  cgl: CGL_TABLE,
  auto: AUTO_TABLE,
  cyber: CYBER_TABLE,
  excess: EXCESS_TABLE,
  health: HEALTH_TABLE,
  lpl: LPL_TABLE,
};

export function tableFor(line?: string): AppetiteTable | undefined {
  const key = line?.trim().toLowerCase();
  if (!key) return undefined;
  if (key.includes("property")) return APPETITE_TABLES.property;
  return APPETITE_TABLES[key as LineOfBusiness];
}
