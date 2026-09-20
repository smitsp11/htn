// Confidence describes how well a fact is established, independent of whether it passes appetite.
// Scoring only awards points at or above `minimumScoringConfidence`; anything weaker escalates.
export const CONFIDENCE = {
  VERIFIED: 'verified',          // complete structured Federato records
  CORROBORATED: 'corroborated',  // Federato plus an agreeing external source
  INFERRED: 'inferred',          // derived from complete records via a documented assumption
  EXTERNAL: 'external',          // external capture only; never underwritten without a human
  ABSENT: 'absent',              // no evidence at all
  CONFLICTED: 'conflicted',      // sources disagree
};

const RANK = { verified: 4, corroborated: 3, inferred: 2, external: 1, absent: 0, conflicted: 0 };

export const confidenceRank = value => RANK[value] ?? 0;
export const atLeast = (value, floor) => confidenceRank(value) >= confidenceRank(floor);
export const weakest = (...values) => values.filter(Boolean).sort((a, b) => confidenceRank(a) - confidenceRank(b))[0] ?? CONFIDENCE.ABSENT;

export const CONFIDENCE_LABELS = {
  confirmed: 'Confirmed by the underwriter from cited evidence',
  verified: 'Verified in Federato',
  corroborated: 'Corroborated externally',
  inferred: 'Inferred from complete records',
  external: 'External source only',
  absent: 'No evidence',
  conflicted: 'Sources disagree',
};

/** A single traceable fact: what it says, where it came from, and when it was read. */
export function source(sourceType, reference, { retrievedAt = null, detail = null } = {}) {
  return { sourceType, reference, retrievedAt, detail };
}

export const federatoSource = (resource, id, detail) => source('federato', `${resource}:${id}`, { detail });
export const derivedSource = detail => source('derived', 'local-computation', { detail });
export const externalSource = (provider, reference, retrievedAt, detail) =>
  source('external', reference, { retrievedAt, detail });

/**
 * External evidence is advisory. It can raise `absent` to `external`, or confirm an existing
 * Federato value to `corroborated`, but it can never by itself reach a scoring-grade confidence.
 */
export function mergeExternal(current, externalValue, { equals = Object.is } = {}) {
  if (externalValue == null) return current;
  if (current.value == null) {
    return { ...current, proposedValue: externalValue, confidence: CONFIDENCE.EXTERNAL };
  }
  return equals(current.value, externalValue)
    ? { ...current, confidence: atLeast(current.confidence, CONFIDENCE.VERIFIED) ? CONFIDENCE.CORROBORATED : current.confidence }
    : { ...current, confidence: CONFIDENCE.CONFLICTED, conflictWith: externalValue };
}
