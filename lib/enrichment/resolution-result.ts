import { evaluateAppetite } from "@/lib/domain/appetite";
import { formatMoney } from "@/lib/domain/format";
import type { CanonicalSubmission, FactorKey, RankedSubmission, ResolutionResult, ResolvedField } from "@/lib/domain/types";
import { FACTOR_INPUT } from "@/lib/rankings/completeness";
import { CONFIDENCE_THRESHOLD, DEFAULT_CHAINS, resolveSubmissionFields, type ConsolidationIndex } from "./resolve-submission";

const MONEY_KEYS = new Set<FactorKey>(["tiv", "totalPremium", "fiveYearLossValue"]);

/** Present a resolved value the way the rest of the UI shows that factor. */
export function formatResolvedValue(key: FactorKey, value: number | string): string {
  if (typeof value !== "number") return value;
  if (MONEY_KEYS.has(key)) return formatMoney(value);
  if (key === "construction") return `${Math.round((value > 1 ? value / 100 : value) * 100)}% approved construction`;
  return String(value);
}

/**
 * Resolve a submission's absent required fields from the consolidation index,
 * patch the canonical inputs, and re-run the deterministic engine. Returns the
 * resolved fields + before/after verdict, or null when nothing resolved.
 * `extended` must match the mode the submission was ranked in so the re-score
 * uses the same appetite table.
 */
export function buildResolution(
  submission: RankedSubmission,
  index: ConsolidationIndex,
  extended: boolean,
): ResolutionResult | null {
  const map = resolveSubmissionFields(submission, DEFAULT_CHAINS, CONFIDENCE_THRESHOLD, index);
  const resolved = Object.entries(map).filter(([, v]) => v) as [FactorKey, NonNullable<(typeof map)[FactorKey]>][];
  if (resolved.length === 0) return null;

  const patched: CanonicalSubmission = { ...submission };
  for (const [key, rv] of resolved) (patched as unknown as Record<string, unknown>)[FACTOR_INPUT[key]] = rv.value;
  const after = evaluateAppetite(patched, extended);

  const labelFor = new Map(submission.factors.map((f) => [f.key, f.label]));
  const fields: ResolvedField[] = resolved.map(([key, rv]) => ({
    key,
    label: labelFor.get(key) ?? key,
    value: rv.value,
    display: formatResolvedValue(key, rv.value),
    source: rv.provenance.source,
    confidence: rv.provenance.confidence,
    asOf: rv.provenance.asOf,
  }));

  return {
    fields,
    before: { status: submission.status, score: submission.score },
    after: { status: after.status, score: after.score },
  };
}
