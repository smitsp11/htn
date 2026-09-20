import type { FactorKey, RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";
import type { ResolvedValue } from "./provenance";
import { runWaterfall, type Source } from "./waterfall";

export const CONFIDENCE_THRESHOLD = 0.6;

export type ResolvedField = number | string;

/** Builds the cheapest-first source chain for one factor of one submission. */
export type ChainBuilder = (submission: RankedSubmission) => Source<ResolvedField>[];

/** Source chains keyed by the factor they can fill. W8 (multi-channel
 *  consolidation) and W9 (public data) register their sources here; the
 *  runner is source-agnostic. A factor with no chain resolves to null. */
export type ChainRegistry = Partial<Record<FactorKey, ChainBuilder>>;

/** The MVP ships no sources: every gap is an honest broker chase. */
export const DEFAULT_CHAINS: ChainRegistry = {};

export type ResolutionMap = Partial<Record<FactorKey, ResolvedValue<ResolvedField> | null>>;

/**
 * Attempt to fill each *absent* required field from the registered sources.
 * Ambiguous fields (a value the broker supplied but the guidelines do not
 * classify) are deliberately skipped: they need an underwriter's call, not
 * another source. Results are context for the underwriter only — the engine's
 * verdicts are never rescored from a resolved value.
 */
export function resolveSubmissionFields(
  submission: RankedSubmission,
  chains: ChainRegistry = DEFAULT_CHAINS,
  threshold = CONFIDENCE_THRESHOLD,
): ResolutionMap {
  const map: ResolutionMap = {};
  for (const key of completenessOf(submission).absent) {
    map[key] = runWaterfall(chains[key]?.(submission) ?? [], threshold);
  }
  return map;
}
