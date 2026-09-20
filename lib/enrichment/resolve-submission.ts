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

/** The MVP ships no live inference chains: every remaining gap is a broker chase
 *  once consolidation has been consulted. */
export const DEFAULT_CHAINS: ChainRegistry = {};

export type ResolutionMap = Partial<Record<FactorKey, ResolvedValue<ResolvedField> | null>>;

export type ConsolidationIndex = Record<
  string,
  Partial<Record<FactorKey, ResolvedValue<ResolvedField>>>
>;

/**
 * Attempt to fill each *absent* required field from the registered sources.
 * Consolidation (scattered broker channels) is the highest-priority source —
 * if a channel already held the value, we surface it with provenance and never
 * invent. Pass the cache explicitly (client imports JSON; server may load via
 * `loadConsolidationIndex`). Default `{}` keeps this module browser-safe.
 */
export function resolveSubmissionFields(
  submission: RankedSubmission,
  chains: ChainRegistry = DEFAULT_CHAINS,
  threshold = CONFIDENCE_THRESHOLD,
  consolidation: ConsolidationIndex = {},
): ResolutionMap {
  const map: ResolutionMap = {};
  const cached = consolidation[submission.id] ?? {};
  for (const key of completenessOf(submission).absent) {
    map[key] = cached[key] ?? runWaterfall(chains[key]?.(submission) ?? [], threshold);
  }
  return map;
}
