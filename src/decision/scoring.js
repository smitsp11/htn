import { isAmount, normalizedText } from './normalize.js';
import { CONFIDENCE, atLeast, weakest } from './evidence.js';

const dollars = value => value == null ? 'unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const between = (x, [low, high]) => x >= low && x <= high;
const pct = value => `${(value * 100).toFixed(0)}%`;

const classOf = (rules, type) => rules.constructionClasses?.[normalizedText(type)] ?? null;

export function scoreSubmission(facts, rules) {
  const factors = [];
  const minimum = rules.minimumScoringConfidence ?? CONFIDENCE.INFERRED;

  /**
   * A factor only earns points when its evidence is at least `minimumScoringConfidence`.
   * A favourable reading backed by weaker evidence is demoted to `unknown` and escalated,
   * so the engine never converts a guess into appetite credit.
   */
  function add(key, label, status, confidence, reason, { hasTarget = false, gap = null, basis = 'guideline', context = null } = {}) {
    let finalStatus = status;
    let finalReason = reason;
    if (['pass', 'target'].includes(status) && !atLeast(confidence, minimum)) {
      finalStatus = 'unknown';
      finalReason = `${reason} Evidence is ${confidence}, below the ${minimum} standard required to award credit, so this is escalated rather than assumed.`;
    }
    const weight = rules.weights[key];
    const points = finalStatus === 'target' || (finalStatus === 'pass' && !hasTarget) ? weight
      : finalStatus === 'pass' ? weight * rules.acceptableCredit : 0;
    factors.push({
      key, label, status: finalStatus, confidence, basis, context, hasTarget,
      points: Math.round(points * 10) / 10, maxPoints: weight, reason: finalReason,
      gap: ['pass', 'target'].includes(finalStatus) ? null : gap,
    });
  }

  // --- Submission type -------------------------------------------------------
  const types = facts.businessTypes.map(normalizedText);
  const renewal = types.some(t => ['renewal', 'renewalbusiness'].includes(t));
  const newBusiness = types.length > 0 && types.every(t => ['new', 'newbusiness'].includes(t));
  add('businessType', 'Submission type',
    renewal ? 'fail' : newBusiness ? 'pass' : 'unknown',
    renewal || newBusiness ? CONFIDENCE.VERIFIED : CONFIDENCE.ABSENT,
    renewal ? 'A linked policy is renewal business, which is outside appetite.'
      : newBusiness ? 'All linked policies are new business.'
      : 'No linked policy establishes new versus renewal business.',
    { gap: { question: 'Is this new business or a renewal?', needs: ['Policy.business_type on a linked policy'], askOf: ['broker'], enrichable: false } });

  // --- Line of business ------------------------------------------------------
  const lob = normalizedText(facts.lineOfBusiness);
  add('lineOfBusiness', 'Line of business',
    !lob ? 'unknown' : ['property', 'commercialproperty'].includes(lob) ? 'pass' : 'fail',
    lob ? CONFIDENCE.VERIFIED : CONFIDENCE.ABSENT,
    !lob ? 'Line of business is missing.' : `Submission line is ${facts.lineOfBusiness}; only property is acceptable.`,
    { gap: { question: 'Which line of business is this submission for?', needs: ['Submission.line_of_business'], askOf: ['broker'], enrichable: false } });

  // --- Primary risk state ----------------------------------------------------
  const state = facts.primaryState;
  const stateKnown = Boolean(state);
  add('state', 'Primary risk state',
    !stateKnown ? 'unknown' : rules.targetStates.includes(state) ? 'target' : rules.acceptableStates.includes(state) ? 'pass' : 'fail',
    stateKnown ? CONFIDENCE.INFERRED : CONFIDENCE.ABSENT,
    !stateKnown ? 'Primary risk state cannot be established from complete exposure TIV, or the leading states tie.'
      : `${state} holds the greatest building TIV; ${rules.targetStates.includes(state) ? 'target state' : rules.acceptableStates.includes(state) ? 'acceptable state' : 'state outside appetite'}.`,
    { hasTarget: true, context: facts.stateTiv,
      gap: { question: 'Which state holds the majority of insured value?', needs: ['Complete location schedule with state and per-building TIV'], askOf: ['broker'], enrichable: false } });

  // --- Total insured value ---------------------------------------------------
  const tivFail = isAmount(facts.knownTiv) && facts.knownTiv > rules.maxTiv;
  const substitutedBuildings = facts.buildings.filter(b => b.tivSource === 'building_value');
  add('tiv', 'Total insured value',
    tivFail ? 'fail' : facts.tiv == null ? 'unknown' : between(facts.tiv, rules.targetTiv) ? 'target' : 'pass',
    facts.tiv == null && !tivFail ? CONFIDENCE.ABSENT
      : facts.tivSubstituted ? CONFIDENCE.INFERRED : CONFIDENCE.VERIFIED,
    tivFail ? `Known TIV ${dollars(facts.knownTiv)} already exceeds the ${dollars(rules.maxTiv)} maximum.`
      : facts.tiv == null ? 'Complete building TIV in USD is unavailable; policy limit is not a substitute.'
      : `TIV ${dollars(facts.tiv)}; target ${dollars(rules.targetTiv[0])}-${dollars(rules.targetTiv[1])}, maximum ${dollars(rules.maxTiv)}.` +
        (substitutedBuildings.length ? ` Building value stood in for TIV on ${substitutedBuildings.length} building(s), which excludes contents and business interruption, so the real TIV is higher than stated.` : ''),
    { hasTarget: true,
      gap: { question: 'What is the total insured value across all buildings?', needs: ['Statement of values with per-building TIV in USD'], askOf: ['broker'], enrichable: false } });

  // --- Premium ---------------------------------------------------------------
  const premium = facts.premium;
  add('premium', 'Total premium',
    premium == null ? 'unknown' : !between(premium, rules.premiumRange) ? 'fail' : between(premium, rules.targetPremium) ? 'target' : 'pass',
    premium == null ? CONFIDENCE.ABSENT : CONFIDENCE.VERIFIED,
    premium == null ? 'Actual premium in USD is missing; target premium is not substituted.'
      : `Actual premium ${dollars(premium)}; acceptable ${dollars(rules.premiumRange[0])}-${dollars(rules.premiumRange[1])}, target ${dollars(rules.targetPremium[0])}-${dollars(rules.targetPremium[1])}.`,
    { hasTarget: true,
      gap: { question: 'What is the quoted premium in USD?', needs: ['Policy.premium in USD on a linked policy'], askOf: ['broker', 'underwriter'], enrichable: false } });

  // --- Building year ---------------------------------------------------------
  const proposedYear = facts.effectiveDate ? new Date(facts.effectiveDate).getUTCFullYear() : null;
  const validYears = facts.buildings.map(b => b.yearBuilt).filter(y => Number.isInteger(y) && y > 0 && proposedYear && y <= proposedYear);
  const oldest = validYears.length ? Math.min(...validYears) : null;
  const yearsComplete = facts.exposuresComplete && validYears.length > 0 && validYears.length === facts.buildings.length;
  const missingYears = facts.buildings.filter(b => !Number.isInteger(b.yearBuilt) || b.yearBuilt <= 0 || (proposedYear && b.yearBuilt > proposedYear));
  const oldestBuilding = facts.buildings.find(b => b.yearBuilt === oldest) ?? null;
  const roofUpdated = oldestBuilding?.roofYear && oldest && oldestBuilding.roofYear > oldest ? oldestBuilding.roofYear : null;
  const yearStatus = oldest != null && oldest < rules.yearBoundary ? 'fail'
    : !yearsComplete || oldest === rules.yearBoundary ? 'unknown'
    : oldest > rules.targetYearBoundary ? 'target' : 'pass';
  add('year', 'Building year', yearStatus,
    oldest == null ? CONFIDENCE.ABSENT : yearsComplete ? CONFIDENCE.VERIFIED : CONFIDENCE.INFERRED,
    oldest === rules.yearBoundary ? `Oldest building is ${oldest}; the guideline leaves this exact year unresolved.`
      : !yearsComplete && yearStatus !== 'fail' ? `Year built is missing or invalid for ${missingYears.length} of ${facts.buildings.length || 'the'} buildings.`
      : `Oldest building is ${oldest}; acceptable after ${rules.yearBoundary}, target after ${rules.targetYearBoundary}.${roofUpdated ? ` Roof on that building was replaced in ${roofUpdated}, which mitigates but does not reset age.` : ''}`,
    { hasTarget: true, context: { oldest, roofUpdated, missingYears: missingYears.map(b => b.id) },
      gap: { question: `What year were ${missingYears.length || 'the insured'} building(s) built?`,
        needs: missingYears.map(b => `Building:${b.id} year_built`),
        askOf: ['broker'], enrichable: true, enrichment: 'property-record' } });

  // --- Construction ----------------------------------------------------------
  const classified = facts.buildings.map(b => ({ building: b, klass: classOf(rules, b.constructionType) }));
  const unclassified = classified.filter(c => !c.klass);
  const constructionKnown = facts.buildings.length > 0 && unclassified.length === 0;
  const acceptableTiv = classified.filter(c => c.klass?.acceptable).reduce((sum, c) => sum + (isAmount(c.building.tiv) ? c.building.tiv : 0), 0);
  const fraction = constructionKnown && facts.tiv > 0 ? acceptableTiv / facts.tiv : null;
  const interpreted = classified.filter(c => c.klass?.acceptable && c.klass.basis === 'interpretation');
  const constructionStatus = fraction == null || fraction === 0.5 ? 'unknown' : fraction > 0.5 ? 'pass' : 'fail';
  add('construction', 'Construction mix', constructionStatus,
    fraction == null ? CONFIDENCE.ABSENT : CONFIDENCE.VERIFIED,
    fraction == null ? `Construction class is missing or unrecognised for ${unclassified.length || 'the insured'} building(s), or TIV weights are unavailable.`
      : fraction === 0.5 ? 'Acceptable construction is exactly 50% of TIV; the guideline requires more than 50%.'
      : `${pct(fraction)} of TIV is acceptable construction; more than 50% is required.${interpreted.length ? ` Includes ${interpreted.length} building(s) classed as ${[...new Set(interpreted.map(c => c.klass.label))].join(', ')}, treated as acceptable by interpretation because their ISO class exceeds every class the guideline names.` : ''}`,
    { basis: interpreted.length ? 'interpretation' : 'guideline',
      context: { fraction, interpretedBuildings: interpreted.map(c => c.building.id), unclassified: unclassified.map(c => c.building.id) },
      gap: { question: `What is the construction class of ${unclassified.length || 'the insured'} building(s)?`,
        needs: unclassified.map(c => `Building:${c.building.id} construction_type`),
        askOf: ['broker'], enrichable: true, enrichment: 'property-record' } });

  // --- Five-year loss history ------------------------------------------------
  const loss = facts.loss;
  const lossFail = loss.observed != null && loss.observed > rules.lossBoundary;
  const lossStatus = lossFail ? 'fail'
    : loss.observed == null || !loss.historyComplete || loss.observed === rules.lossBoundary ? 'unknown'
    : 'pass';
  const gapText = loss.gaps?.length ? loss.gaps.map(g => `${g.start} to ${g.end}`).join(', ') : null;
  add('loss', 'Five-year loss value', lossStatus,
    loss.observed == null ? CONFIDENCE.ABSENT : loss.historyComplete || lossFail ? CONFIDENCE.INFERRED : CONFIDENCE.ABSENT,
    loss.observed == null ? 'A valid effective date is required to establish the five-year loss window.'
      : `Observed incurred loss ${dollars(loss.observed)} across ${loss.claimIds.length} claim(s) in [${loss.windowStart}, ${loss.windowEndExclusive}). ` +
        (lossFail ? `Exceeds ${dollars(rules.lossBoundary)}.`
          : loss.observed === rules.lossBoundary ? 'Exactly at the threshold, which the guideline does not resolve.'
          : loss.historyComplete ? `Below ${dollars(rules.lossBoundary)}, with policies on file covering the full window.`
          : `Property policies on file cover ${pct(loss.coverageRatio)} of the window${gapText ? `; no loss data for ${gapText}` : ''}. This is not evidence of a loss-free record.`),
    { context: { coverageRatio: loss.coverageRatio, gaps: loss.gaps, openClaims: loss.openClaims, claims: loss.claims },
      gap: { question: gapText ? `Provide loss runs covering ${gapText}.` : 'Provide a complete five-year loss run.',
        needs: (loss.gaps ?? []).map(g => `Loss run ${g.start} to ${g.end}`),
        askOf: ['broker', 'prior carrier'], enrichable: false } });

  // --- Decision --------------------------------------------------------------
  const failed = factors.filter(f => f.status === 'fail');
  const missing = factors.filter(f => f.status === 'unknown');
  const issues = facts.issues ?? [];
  const decision = failed.length ? 'OUT_OF_APPETITE' : missing.length || issues.length ? 'REVIEW_REQUIRED' : 'IN_APPETITE';

  /**
   * Guideline preferences (state, TIV, premium, building age) each carry a target tier above
   * the acceptable one. An in-appetite submission is only "target" when every preference is
   * actually hit, not merely acceptable — a distinction the score alone does not make explicit.
   */
  const preferenceFactors = factors.filter(f => f.hasTarget);
  const targetMatches = preferenceFactors.filter(f => f.status === 'target').length;
  const appetiteTier = decision !== 'IN_APPETITE' ? null : targetMatches === preferenceFactors.length ? 'target' : 'acceptable';
  const rawScore = Math.round(factors.reduce((s, f) => s + f.points, 0) * 10) / 10;
  const cap = decision === 'OUT_OF_APPETITE' ? rules.outOfAppetiteScoreCap : decision === 'REVIEW_REQUIRED' ? rules.reviewScoreCap : 100;
  const score = Math.min(rawScore, cap);
  const recommendation = decision === 'OUT_OF_APPETITE' ? 'Deprioritize for this appetite; review the listed failures.'
    : decision === 'REVIEW_REQUIRED' ? 'Obtain the missing or ambiguous evidence before progressing.'
    : 'Prioritize for underwriter review.';
  const matches = factors.filter(f => ['pass', 'target'].includes(f.status)).map(f => f.label.toLowerCase());
  // Keep the headline readable; the full gap list lives in the per-factor tasks.
  const outstanding = [...missing.map(f => f.label.toLowerCase()), ...issues];
  const shown = outstanding.slice(0, 3);
  const explanation = `${failed.length ? `Outside appetite on ${failed.map(f => f.label.toLowerCase()).join(', ')}.` : `Matches ${matches.length ? matches.join(', ') : 'no confirmed criteria'}.`}` +
    `${outstanding.length ? ` Outstanding: ${shown.join('; ')}${outstanding.length > shown.length ? ` and ${outstanding.length - shown.length} more` : ''}.` : ''}`;
  const evidenceConfidence = weakest(...factors.map(f => f.confidence));

  return {
    ...facts, score, rawScore, scoreCap: cap, decision, recommendation, explanation, factors,
    evidenceConfidence, appetiteTier, targetMatches, targetEligible: preferenceFactors.length,
    usesInterpretation: factors.some(f => f.basis === 'interpretation'),
    // Share of factors actually evaluated, not a statistical probability.
    evidenceCoverage: Math.round((factors.length - missing.length) / factors.length * 100),
  };
}

/** Sooner effective dates rank first among ties; missing or unparsable dates sort last. */
const effectiveRank = row => { const t = Date.parse(row.effectiveDate); return Number.isFinite(t) ? t : Infinity; };

export function rankSubmissions(facts, rules) {
  return facts.map(f => scoreSubmission(f, rules))
    .sort((a, b) => b.score - a.score || b.rawScore - a.rawScore || effectiveRank(a) - effectiveRank(b) ||
      String(a.id).localeCompare(String(b.id), 'en', { numeric: true }))
    .map((row, index) => ({ rank: index + 1, ...row }));
}
