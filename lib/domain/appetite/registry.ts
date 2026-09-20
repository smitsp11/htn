import type {
  AppetiteVerdict,
  CanonicalSubmission,
  FactorEvaluation,
  FactorKey,
  LineOfBusiness,
} from "@/lib/domain/types";
import { evaluatePropertyFactors } from "./lines/property";
import { CGL_TABLE, AUTO_TABLE, EXCESS_TABLE, LPL_TABLE } from "./lines/casualty";
import { CYBER_TABLE, HEALTH_TABLE } from "./lines/specialty";

export type AppetiteProvenance = "provided-pdf" | "synthesized-for-demo";

export interface AppetiteTable {
  line: LineOfBusiness;
  displayName: string;
  provenance: AppetiteProvenance;
  evaluate(submission: CanonicalSubmission): FactorEvaluation[];
}

/**
 * Shared, pure verdict helpers reused by every non-property line table.
 * Property keeps its own bespoke evaluators (published PDF semantics); these
 * mirror those semantics for the synthesized-for-demo multi-line tables.
 */

/** Scalar band with an optional inner target tier (premium-style). */
export function bandVerdict(
  value: number | undefined,
  opts: { min: number; max: number; targetMin?: number; targetMax?: number },
): AppetiteVerdict {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  if (value === opts.min || value === opts.max) return "unknown";
  if (value < opts.min || value > opts.max) return "not_acceptable";
  if (opts.targetMin !== undefined && value >= opts.targetMin && value <= opts.targetMax!) return "target";
  return "acceptable";
}

/**
 * Upper-bound-only field (tiv/exposure, losses): acceptable when strictly under
 * `max`, not_acceptable when over, unknown at exactly `max` or when
 * missing/invalid. `zeroAcceptable` mirrors property's loss handling (0 is a
 * clean risk); leave it false for exposure where a non-positive basis is
 * treated as unknown.
 */
export function upperBoundVerdict(
  value: number | undefined,
  max: number,
  opts?: { zeroAcceptable?: boolean },
): AppetiteVerdict {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  if (opts?.zeroAcceptable ? value < 0 : value <= 0) return "unknown";
  if (value === max) return "unknown";
  if (value > max) return "not_acceptable";
  return "acceptable";
}

export function stateVerdict(
  value: string | undefined,
  target: Set<string>,
  acceptable: Set<string> | "any",
): AppetiteVerdict {
  const s = value?.trim().toUpperCase();
  if (!s) return "unknown";
  if (target.has(s)) return "target";
  if (acceptable === "any" || acceptable.has(s)) return "acceptable";
  return "not_acceptable";
}

export function submissionTypeVerdict(value: string | undefined, renewalAcceptable: boolean): AppetiteVerdict {
  const s = value?.trim().toLowerCase();
  if (!s) return "unknown";
  if (s.includes("renew")) return renewalAcceptable ? "acceptable" : "not_acceptable";
  if (s.includes("new")) return "acceptable";
  return "unknown";
}

export function mk(key: FactorKey, label: string, verdict: AppetiteVerdict, reason: string): FactorEvaluation {
  return { key, label, verdict, reason };
}

const PROPERTY_TABLE: AppetiteTable = {
  line: "property",
  displayName: "Commercial Property",
  provenance: "provided-pdf",
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
