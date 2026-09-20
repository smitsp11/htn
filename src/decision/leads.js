import { isAmount, normalizedText, refId, validDate } from './normalize.js';

/**
 * Leads: what we already hold that bears on an unresolved factor.
 *
 * An unknown factor should not dead-end at "ask the broker". Most of the time the account
 * already carries something an underwriter would look at first — an expiring property policy
 * with its own schedule, a requested limit, a sibling policy's business type. None of it is
 * evidence for the appetite test, so none of it changes a score. It is the material an
 * underwriter would pull up anyway, put next to the question instead of three clicks away.
 *
 * Every lead carries a `caution` saying why it is not a substitute.
 */
const MAX_PER_FACTOR = 4;
const money = value => value == null ? 'unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const isProperty = value => ['property', 'commercialproperty'].includes(normalizedText(value));

function lead(kind, label, value, detail, caution, sources = []) {
  return { kind, label, value, detail, caution, sources };
}

/** Buildings reachable from a policy, with their location, using explicit references only. */
function scheduleOf(policy, index) {
  const get = (resource, id) => index[resource]?.get(String(refId(id)));
  const rows = [];
  for (const unitId of policy.exposure_units ?? []) {
    const unit = get('ExposureUnit', unitId);
    if (!unit || unit.kind !== 'location') continue;
    const location = get('Location', unit.location);
    if (!location) continue;
    for (const buildingId of location.buildings ?? []) {
      const building = get('Building', buildingId);
      if (building) rows.push({ building, location });
    }
  }
  return rows;
}

function describePolicy(policy) {
  const period = validDate(policy.dates?.effective) ? `${policy.dates.effective} to ${policy.dates?.expiration ?? '?'}` : 'undated';
  return `${policy.policy_number ?? `Policy ${policy.id}`} (${policy.status ?? 'status unknown'}, ${period})`;
}

export function buildLeads(rows, data, rules) {
  const index = Object.fromEntries(Object.entries(data).map(([resource, records]) =>
    [resource, new Map(records.map(r => [String(r.id), r]))]));
  const policiesByInsured = new Map();
  for (const policy of data.Policy) {
    const key = String(refId(policy.insured));
    if (!policiesByInsured.has(key)) policiesByInsured.set(key, []);
    policiesByInsured.get(key).push(policy);
  }
  const submissions = new Map(data.Submission.map(s => [String(s.id), s]));

  return rows.map(row => {
    const submission = submissions.get(String(row.id));
    if (!submission) return row;
    const insuredKey = String(refId(submission.insured));
    const accountPolicies = policiesByInsured.get(insuredKey) ?? [];
    const thisPolicyIds = new Set((row.policyIds ?? []).map(String));
    // "Other" property policies on the account: the natural place to look for a schedule.
    const otherProperty = accountPolicies
      .filter(p => isProperty(p.line_of_business) && !thisPolicyIds.has(String(p.id)))
      .sort((a, b) => (Date.parse(b.dates?.effective) || 0) - (Date.parse(a.dates?.effective) || 0));
    const profile = row.insuredProfile;

    const leads = {};
    const push = (key, entry) => {
      if (!entry) return;
      leads[key] ??= [];
      if (leads[key].length < MAX_PER_FACTOR) leads[key].push(entry);
    };

    const openFactors = new Set(row.factors.filter(f => f.status === 'unknown' || f.status === 'fail').map(f => f.key));

    // --- Submission type ----------------------------------------------------
    if (openFactors.has('businessType')) {
      for (const policy of accountPolicies.slice(0, 3)) {
        if (!policy.business_type) continue;
        push('businessType', lead('adjacent-policy',
          `${describePolicy(policy)} is ${policy.business_type} business`,
          policy.business_type,
          `A ${policy.line_of_business} policy already on this account.`,
          'A sibling policy does not establish whether this submission is new or a renewal.',
          [`Policy:${policy.id}`]));
      }
    }

    // --- Primary risk state -------------------------------------------------
    if (openFactors.has('state')) {
      if (Object.keys(row.stateTiv ?? {}).length) {
        push('state', lead('partial-value', 'Partial exposure resolved so far',
          Object.entries(row.stateTiv).map(([s, v]) => `${s} ${money(v)}`).join(', '),
          'States already resolved from the exposures we could reach.',
          'Incomplete, or the leading states tie, so it cannot decide the primary state.'));
      }
      for (const policy of otherProperty.slice(0, 2)) {
        const schedule = scheduleOf(policy, index);
        if (!schedule.length) continue;
        const byState = {};
        for (const { building, location } of schedule) {
          if (!location.state) continue;
          byState[location.state] = (byState[location.state] ?? 0) + (isAmount(building.tiv) ? building.tiv : 0);
        }
        if (!Object.keys(byState).length) continue;
        push('state', lead('adjacent-policy',
          `Locations on ${describePolicy(policy)}`,
          Object.entries(byState).sort((a, b) => b[1] - a[1]).map(([s, v]) => `${s} ${money(v)}`).join(', '),
          `${schedule.length} building(s) across ${new Set(schedule.map(s => s.location.id)).size} location(s) on another property policy for this account.`,
          'A prior policy\'s schedule may not match what is being submitted now.',
          [`Policy:${policy.id}`, ...new Set(schedule.map(s => `Location:${s.location.id}`))]));
      }
    }

    // --- Total insured value ------------------------------------------------
    if (openFactors.has('tiv')) {
      if (isAmount(row.requestedLimit) && row.requestedLimit > 0) {
        push('tiv', lead('partial-value', 'Requested limit on this submission', money(row.requestedLimit),
          'The limit the broker asked for, which bounds the size of the risk.',
          'Requested limit is not TIV. It can sit well below total insured value on a sub-limited or layered placement.',
          [`Submission:${row.id}`]));
      }
      for (const policy of otherProperty.slice(0, 2)) {
        const schedule = scheduleOf(policy, index);
        const total = schedule.reduce((sum, s) => sum + (isAmount(s.building.tiv) ? s.building.tiv : 0), 0);
        if (!schedule.length || total <= 0) continue;
        push('tiv', lead('adjacent-policy', `Schedule on ${describePolicy(policy)}`, money(total),
          `${schedule.length} building(s) already scheduled on another property policy for this account.`,
          'Values are as of that policy period and may have been restated since.',
          [`Policy:${policy.id}`, ...new Set(schedule.map(s => `Building:${s.building.id}`))]));
      }
      if (isAmount(profile?.annualRevenue)) {
        push('tiv', lead('account-profile', 'Account annual revenue', money(profile.annualRevenue),
          `${profile.employeeCount ?? 'unknown'} employees, NAICS ${profile.naics ?? 'unknown'}.`,
          'Revenue is an order-of-magnitude sanity check on the size of a schedule, never a TIV figure.',
          [row.sources?.insured].filter(Boolean)));
      }
    }

    // --- Premium ------------------------------------------------------------
    if (openFactors.has('premium')) {
      for (const policy of otherProperty.slice(0, 2)) {
        if (!isAmount(policy.premium) || policy.currency !== 'USD') continue;
        push('premium', lead('adjacent-policy', `Premium on ${describePolicy(policy)}`, money(policy.premium),
          'The expiring or prior property premium for this account.',
          'Prior premium reflects the prior exposure and terms, not this submission.',
          [`Policy:${policy.id}`]));
      }
      if (isAmount(row.targetPremium)) {
        push('premium', lead('partial-value', 'Target premium on this submission', money(row.targetPremium),
          'The target recorded against this submission.',
          'Target premium is an objective, not the quoted premium, and is never scored in its place.'));
      }
      const peers = row.casefile?.comparables;
      if (peers?.medianRate && isAmount(row.tiv) && row.tiv > 0) {
        push('premium', lead('peer', `Peer rate applied to this TIV`,
          money(peers.medianRate * row.tiv / 1000),
          `Median of $${peers.medianRate} per $1,000 TIV across ${peers.peerCount} peer risk(s) in NAICS ${peers.industryKey}.`,
          `An indicative range off ${peers.peerCount} peer(s), not a rating opinion or a quote.`));
      }
    }

    // --- Building year ------------------------------------------------------
    if (openFactors.has('year')) {
      for (const policy of otherProperty.slice(0, 2)) {
        const years = scheduleOf(policy, index).map(s => s.building.year_built).filter(Number.isInteger);
        if (!years.length) continue;
        push('year', lead('adjacent-policy', `Building years on ${describePolicy(policy)}`,
          `oldest ${Math.min(...years)}, newest ${Math.max(...years)}`,
          `${years.length} building(s) with a recorded year on another property policy for this account.`,
          'These may be different buildings from the ones being submitted.',
          [`Policy:${policy.id}`]));
      }
      const external = (row.external?.proposals ?? []).filter(p => p.field === 'yearBuilt');
      for (const proposal of external.slice(0, 2)) {
        push('year', lead('external', `${proposal.provider} reports year built`, String(proposal.value),
          `Captured ${proposal.retrievedAt} for Location:${proposal.siteId}.`,
          'External capture, unreviewed. It cannot satisfy the factor without underwriter confirmation.'));
      }
    }

    // --- Construction -------------------------------------------------------
    if (openFactors.has('construction')) {
      for (const policy of otherProperty.slice(0, 2)) {
        const types = [...new Set(scheduleOf(policy, index).map(s => s.building.construction_type).filter(Boolean))];
        if (!types.length) continue;
        push('construction', lead('adjacent-policy', `Construction on ${describePolicy(policy)}`, types.join(', '),
          'Classes recorded on another property policy for this account.',
          'A prior schedule may cover different buildings.',
          [`Policy:${policy.id}`]));
      }
      const unclassified = row.factors.find(f => f.key === 'construction')?.context?.unclassified ?? [];
      if (unclassified.length) {
        push('construction', lead('record', 'Buildings with an unrecognised class', unclassified.map(id => `Building:${id}`).join(', '),
          'These carry a construction_type the ISO table does not recognise.',
          'An unrecognised class is not the same as an unacceptable one; confirm the value before judging it.'));
      }
    }

    // --- Five-year loss history ---------------------------------------------
    if (openFactors.has('loss')) {
      const loss = row.loss ?? {};
      if (loss.coveredRanges?.length) {
        push('loss', lead('partial-value', 'Periods we can already evidence',
          loss.coveredRanges.map(r => `${r.start} to ${r.end}`).join(', '),
          `${loss.claimIds?.length ?? 0} claim(s) found inside the window on policies we hold.`,
          'Covers only the periods above. Nothing is known about the rest of the window.'));
      }
      const account = row.casefile?.lossExperience;
      if (account?.claimCount) {
        push('loss', lead('adjacent-policy', 'Claims on this account across all lines',
          `${account.claimCount} claim(s), ${money(account.totalIncurred)} incurred, ${account.openCount} open`,
          account.byLine.map(l => `${l.line} ${money(l.incurred)}`).join(', '),
          'Other lines do not count toward the property loss test, but they show how the account runs.'));
      }
      for (const policy of otherProperty.slice(0, 2)) {
        push('loss', lead('adjacent-policy', `Prior property policy: ${describePolicy(policy)}`,
          `${(policy.claims ?? []).length} claim(s) referenced`,
          'A policy period on this account that a loss run could be requested against directly.',
          'Claims recorded here are the carrier\'s own; they are not a substitute for a full loss run.',
          [`Policy:${policy.id}`]));
      }
    }

    return { ...row, leads };
  });
}
