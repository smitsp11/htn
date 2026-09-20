import { CONFIDENCE } from './evidence.js';

export const refId = value => value && typeof value === 'object' ? value.id : value;
export const isAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const normalizedText = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
const isProperty = value => ['property', 'commercialproperty'].includes(normalizedText(value));
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value));
const DAY = 86_400_000;

/**
 * Building TIV, falling back to building_value when tiv is absent. The fallback is recorded
 * rather than applied silently: building_value excludes contents and business interruption, so
 * it understates TIV, and scoring drops that factor's confidence when it is used.
 */
export function buildingTiv(building) {
  if (isAmount(building.tiv)) return { value: building.tiv, source: 'tiv' };
  if (isAmount(building.building_value)) return { value: building.building_value, source: 'building_value' };
  return { value: null, source: null };
}
const iso = ms => new Date(ms).toISOString().slice(0, 10);

/** Union of [start,end) ranges clipped to a window; returns covered fraction and the uncovered gaps. */
export function coverageOf(ranges, windowStart, windowEnd) {
  const clipped = ranges
    .map(r => [Math.max(r.start, windowStart), Math.min(r.end, windowEnd)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of clipped) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const covered = merged.reduce((sum, [start, end]) => sum + (end - start), 0);
  const gaps = [];
  let cursor = windowStart;
  for (const [start, end] of merged) {
    if (start > cursor) gaps.push({ start: iso(cursor), end: iso(start), days: Math.round((start - cursor) / DAY) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < windowEnd) gaps.push({ start: iso(cursor), end: iso(windowEnd), days: Math.round((windowEnd - cursor) / DAY) });
  const span = windowEnd - windowStart;
  return {
    ratio: span > 0 ? covered / span : 0,
    coveredDays: Math.round(covered / DAY),
    gaps,
    merged: merged.map(([start, end]) => ({ start: iso(start), end: iso(end) })),
  };
}

export function normalizeSubmissions(data, appetite) {
  const index = Object.fromEntries(Object.entries(data).map(([resource, records]) =>
    [resource, new Map(records.map(r => [String(r.id), r]))]));
  const get = (resource, id) => index[resource]?.get(String(refId(id)));
  return data.Submission.map(submission => {
    const issues = [];
    const policies = data.Policy.filter(p => String(refId(p.submission)) === String(submission.id));
    const insured = get('Insured', submission.insured);
    if (!insured?.name) issues.push('Account name is missing or the insured reference is unresolved.');
    if (!policies.length) issues.push('No policy is explicitly linked to this submission; premium, business type, expiration and exposures are unverified.');
    if (policies.some(p => String(refId(p.insured)) !== String(refId(submission.insured)))) issues.push('Submission and policy insured references conflict.');
    if (policies.some(p => normalizedText(p.line_of_business) !== normalizedText(submission.line_of_business))) issues.push('Submission and policy lines of business conflict.');
    const currencies = [...new Set(policies.map(p => p.currency))];
    const usd = policies.length > 0 && policies.every(p => p.currency === 'USD');
    if (!usd) issues.push('USD monetary values are not established for all linked policies.');
    const effective = submission.target_effective_date;
    const datesComplete = validDate(effective) && policies.length > 0 && policies.every(p =>
      validDate(p.dates?.effective) && validDate(p.dates?.expiration) &&
      Date.parse(p.dates.expiration) > Date.parse(p.dates.effective) &&
      Date.parse(p.dates.effective) === Date.parse(effective));
    if (!datesComplete) issues.push('Effective/expiration dates are missing, invalid, or inconsistent with the submission.');

    const locations = new Map();
    let exposuresComplete = policies.length > 0;
    for (const policy of policies) {
      if (!Array.isArray(policy.exposure_units) || !policy.exposure_units.length) exposuresComplete = false;
      for (const id of policy.exposure_units ?? []) {
        const exposure = get('ExposureUnit', id);
        if (!exposure) { exposuresComplete = false; continue; }
        if (exposure.kind !== 'location') continue;
        const location = get('Location', exposure.location);
        if (!location) { exposuresComplete = false; continue; }
        locations.set(String(location.id), location);
      }
    }
    if (!locations.size) exposuresComplete = false;
    const buildings = new Map();
    const buildingState = new Map();
    const buildingLocation = new Map();
    let statesComplete = true;
    for (const location of locations.values()) {
      if (!Array.isArray(location.buildings) || !location.buildings.length) exposuresComplete = false;
      if (typeof location.state !== 'string' || !/^[A-Z]{2}$/.test(location.state)) statesComplete = false;
      for (const id of location.buildings ?? []) {
        const building = get('Building', id);
        if (!building) { exposuresComplete = false; continue; }
        const key = String(building.id);
        if (buildingState.has(key) && buildingState.get(key) !== location.state) statesComplete = false;
        buildingState.set(key, location.state);
        buildingLocation.set(key, location);
        buildings.set(key, building);
      }
    }
    const buildingList = [...buildings.values()];
    if (!exposuresComplete) issues.push('Property exposure locations/buildings are missing or unresolved.');
    const tivOf = new Map(buildingList.map(b => [String(b.id), buildingTiv(b)]));
    const tivSubstituted = [...tivOf.values()].some(t => t.source === 'building_value');
    const tivComplete = exposuresComplete && buildingList.length > 0 && [...tivOf.values()].every(t => t.value != null && t.value > 0);
    const knownTiv = [...tivOf.values()].reduce((sum, t) => sum + (t.value ?? 0), 0);
    const stateTiv = {};
    if (tivComplete && statesComplete) {
      for (const building of buildingList) {
        const state = buildingState.get(String(building.id));
        stateTiv[state] = (stateTiv[state] ?? 0) + (tivOf.get(String(building.id)).value ?? 0);
      }
    }
    const stateOrder = Object.entries(stateTiv).sort((a, b) => b[1] - a[1]);
    const primaryState = stateOrder.length && (stateOrder.length === 1 || stateOrder[0][1] !== stateOrder[1][1]) ? stateOrder[0][0] : null;

    // Addresses are the join key for external enrichment; carry whatever the live schema exposed.
    const sites = [...locations.values()].map(location => ({
      id: location.id,
      address: location.address ?? null, city: location.city ?? null,
      state: location.state ?? null, zip: location.zip ?? null, county: location.county ?? null,
      latitude: Number.isFinite(location.latitude) ? location.latitude : null,
      longitude: Number.isFinite(location.longitude) ? location.longitude : null,
      protectionClass: location.protection_class ?? null,
      hazardTags: Array.isArray(location.hazard_tags) ? location.hazard_tags : [],
      tiv: (location.buildings ?? []).reduce((sum, id) => {
        const building = get('Building', id);
        return sum + (building ? (buildingTiv(building).value ?? 0) : 0);
      }, 0),
      geocodable: Boolean(location.address && location.city && location.state) ||
        (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)),
    }));

    // Account-level property claims, reached through explicit policy references only.
    const historicalPolicies = data.Policy.filter(p => String(refId(p.insured)) === String(refId(submission.insured)) && isProperty(p.line_of_business));
    const historicalIds = new Set(historicalPolicies.map(p => String(p.id)));
    const claimedIds = new Set(historicalPolicies.flatMap(p => Array.isArray(p.claims) ? p.claims.map(id => String(refId(id))) : []));
    const claims = data.Claim.filter(c => historicalIds.has(String(refId(c.policy))) || claimedIds.has(String(c.id)));
    const start = validDate(effective) ? new Date(effective) : null;
    if (start) start.setUTCFullYear(start.getUTCFullYear() - appetite.lossYears);
    let observedLoss = 0;
    let lossValuesComplete = !!start;
    const lossClaimIds = [];
    const lossClaims = [];
    for (const claim of claims) {
      if (!historicalIds.has(String(refId(claim.policy)))) { lossValuesComplete = false; continue; }
      if (!validDate(claim.date_of_loss) || !start) { lossValuesComplete = false; continue; }
      const date = Date.parse(claim.date_of_loss);
      if (date < start.getTime() || date >= Date.parse(effective)) continue;
      if (get('Policy', claim.policy)?.currency !== 'USD') { lossValuesComplete = false; continue; }
      const amounts = ['paid_indemnity', 'paid_expense', 'reserve_indemnity', 'reserve_expense'].map(k => claim[k]);
      if (amounts.some(v => !isAmount(v))) lossValuesComplete = false;
      const incurred = amounts.filter(isAmount).reduce((sum, v) => sum + v, 0);
      observedLoss += incurred;
      lossClaimIds.push(claim.id);
      lossClaims.push({
        id: claim.id, dateOfLoss: claim.date_of_loss, incurred,
        cause: claim.cause_of_loss ?? null, status: claim.status ?? null,
        open: normalizedText(claim.status) === 'open',
      });
    }
    if ([...claimedIds].some(id => !get('Claim', id))) lossValuesComplete = false;

    // Score loss history on how much of the five-year window property policies actually cover.
    // Uncovered periods become explicit ranges to request, never an assumption of loss-free.
    const windowStart = start?.getTime() ?? null;
    const windowEnd = validDate(effective) ? Date.parse(effective) : null;
    const datedHistory = historicalPolicies.filter(p => validDate(p.dates?.effective) && validDate(p.dates?.expiration));
    const coverage = windowStart != null && windowEnd != null
      ? coverageOf(datedHistory.map(p => ({ start: Date.parse(p.dates.effective), end: Date.parse(p.dates.expiration) })), windowStart, windowEnd)
      : { ratio: 0, coveredDays: 0, gaps: [], merged: [] };
    const historyComplete = coverage.ratio >= 0.999 && lossValuesComplete && datedHistory.length === historicalPolicies.length;

    return {
      id: submission.id, submissionNumber: submission.submission_number ?? String(submission.id),
      accountName: insured?.name ?? 'Unknown account', queueStatus: submission.status ?? 'unknown',
      receivedDate: submission.received_date ?? null, lineOfBusiness: submission.line_of_business ?? null,
      requestedLimit: isAmount(submission.requested_limit) ? submission.requested_limit : null,
      brokerId: refId(submission.broker) ?? null, underwriterId: refId(submission.underwriter) ?? null,
      insuredProfile: insured ? {
        naics: insured.naics_code ?? null, sic: insured.sic_code ?? null,
        yearFounded: insured.year_founded ?? null, annualRevenue: insured.annual_revenue ?? null,
        employeeCount: insured.employee_count ?? null,
      } : null,
      policyIds: policies.map(p => p.id), businessTypes: policies.map(p => p.business_type ?? null),
      premium: policies.length && usd && policies.every(p => isAmount(p.premium)) ? policies.reduce((s, p) => s + p.premium, 0) : null,
      targetPremium: policies.length && usd && policies.every(p => isAmount(p.target_premium)) ? policies.reduce((s, p) => s + p.target_premium, 0) : null,
      currencies, usd, effectiveDate: validDate(effective) ? effective : null,
      expirationDates: policies.map(p => p.dates?.expiration ?? null), datesComplete,
      primaryState, stateTiv, tiv: tivComplete && usd ? knownTiv : null, knownTiv: usd ? knownTiv : null,
      exposuresComplete, statesComplete, sites,
      tivSubstituted,
      buildings: buildingList.map(b => ({
        id: b.id, tiv: tivOf.get(String(b.id)).value, tivSource: tivOf.get(String(b.id)).source,
        yearBuilt: b.year_built, constructionType: b.construction_type,
        roofYear: Number.isInteger(b.roof_year) ? b.roof_year : null,
        sprinklered: typeof b.sprinklered === 'boolean' ? b.sprinklered : null,
        stories: Number.isInteger(b.stories) ? b.stories : null,
        squareFootage: isAmount(b.square_footage) ? b.square_footage : null,
        occupancy: b.occupancy ?? null,
        locationId: buildingLocation.get(String(b.id))?.id ?? null,
        state: buildingState.get(String(b.id)) ?? null,
      })),
      loss: {
        observed: start ? observedLoss : null, valuesComplete: lossValuesComplete,
        historyComplete, confidence: windowStart == null ? CONFIDENCE.ABSENT : historyComplete ? CONFIDENCE.INFERRED : CONFIDENCE.ABSENT,
        claimIds: lossClaimIds, claims: lossClaims,
        openClaims: lossClaims.filter(c => c.open).length,
        coverageRatio: coverage.ratio, coveredDays: coverage.coveredDays,
        coveredRanges: coverage.merged, gaps: coverage.gaps,
        policyCount: historicalPolicies.length,
        windowStart: start?.toISOString().slice(0, 10) ?? null,
        windowEndExclusive: validDate(effective) ? effective : null,
      },
      issues,
      sources: {
        submission: `Submission:${submission.id}`, insured: `Insured:${refId(submission.insured)}`,
        policies: policies.map(p => `Policy:${p.id}`), locations: [...locations.keys()].map(id => `Location:${id}`),
        buildings: buildingList.map(b => `Building:${b.id}`), claims: lossClaimIds.map(id => `Claim:${id}`),
      },
    };
  });
}
