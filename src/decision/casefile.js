import { isAmount, normalizedText, refId, validDate } from './normalize.js';

const IN_FORCE = new Set(['active']);
const LOST_STATUS = new Set(['cancelled', 'non_renewed']);
const OPEN_CLAIM = new Set(['open', 'reopened', 'litigation']);
const WON = new Set(['bound']);
const LOST_SUBMISSION = new Set(['declined', 'lost']);
const YEAR = 365.25 * 86_400_000;

const incurredOf = claim => ['paid_indemnity', 'paid_expense', 'reserve_indemnity', 'reserve_expense']
  .reduce((sum, key) => sum + (isAmount(claim[key]) ? claim[key] : 0), 0);
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const tally = (items, key) => items.reduce((acc, item) => {
  const k = key(item) ?? 'unknown';
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});

function index(data) {
  const policiesByInsured = new Map();
  for (const policy of data.Policy) {
    const key = String(refId(policy.insured));
    if (!policiesByInsured.has(key)) policiesByInsured.set(key, []);
    policiesByInsured.get(key).push(policy);
  }
  const submissionsByInsured = new Map();
  const submissionsByBroker = new Map();
  for (const submission of data.Submission) {
    const insured = String(refId(submission.insured));
    if (!submissionsByInsured.has(insured)) submissionsByInsured.set(insured, []);
    submissionsByInsured.get(insured).push(submission);
    const broker = refId(submission.broker);
    if (broker == null) continue;
    const brokerKey = String(broker);
    if (!submissionsByBroker.has(brokerKey)) submissionsByBroker.set(brokerKey, []);
    submissionsByBroker.get(brokerKey).push(submission);
  }
  const claimsByPolicy = new Map();
  for (const claim of data.Claim) {
    const key = String(refId(claim.policy));
    if (!claimsByPolicy.has(key)) claimsByPolicy.set(key, []);
    claimsByPolicy.get(key).push(claim);
  }
  return {
    policiesByInsured, submissionsByInsured, submissionsByBroker, claimsByPolicy,
    insured: new Map((data.Insured ?? []).map(r => [String(r.id), r])),
    broker: new Map((data.Broker ?? []).map(r => [String(r.id), r])),
    underwriter: new Map((data.Underwriter ?? []).map(r => [String(r.id), r])),
  };
}

/** What this account is already worth to us, and what we have already turned away. */
function relationshipOf(row, submission, idx) {
  const insuredKey = String(refId(submission.insured));
  const self = idx.insured.get(insuredKey);
  const policies = idx.policiesByInsured.get(insuredKey) ?? [];
  const siblings = (idx.submissionsByInsured.get(insuredKey) ?? []).filter(s => String(s.id) !== String(submission.id));
  const inForce = policies.filter(p => IN_FORCE.has(normalizedText(p.status)));
  const usd = p => p.currency === 'USD' && isAmount(p.premium);
  const dates = policies.map(p => p.dates?.effective).filter(validDate).map(Date.parse);
  const received = [submission.received_date, ...siblings.map(s => s.received_date)].filter(validDate).map(Date.parse);
  const firstSeen = Math.min(...[...dates, ...received].filter(Number.isFinite));
  return {
    policyCount: policies.length,
    inForceCount: inForce.length,
    inForcePremium: inForce.filter(usd).reduce((sum, p) => sum + p.premium, 0),
    allPremium: policies.filter(usd).reduce((sum, p) => sum + p.premium, 0),
    byLine: Object.entries(tally(inForce, p => p.line_of_business)).map(([line, count]) => ({
      line, count,
      premium: inForce.filter(p => p.line_of_business === line && usd(p)).reduce((sum, p) => sum + p.premium, 0),
    })).sort((a, b) => b.premium - a.premium),
    lapsed: policies.filter(p => LOST_STATUS.has(normalizedText(p.status)))
      .map(p => ({ id: p.id, number: p.policy_number, line: p.line_of_business, status: p.status, premium: usd(p) ? p.premium : null })),
    declinedSubmissions: siblings.filter(s => LOST_SUBMISSION.has(normalizedText(s.status)))
      .map(s => ({ id: s.id, number: s.submission_number, line: s.line_of_business, status: s.status })),
    otherSubmissions: siblings.length,
    tenureYears: Number.isFinite(firstSeen) ? Math.max(0, Math.round((Date.now() - firstSeen) / YEAR * 10) / 10) : null,
    isNewAccount: policies.length === 0,
    // Separate insured records sharing a name are either duplicates or related entities.
    // Either way the true aggregate exposure is larger than this record alone shows.
    sameName: self?.name
      ? [...idx.insured.values()].filter(other => other.name === self.name && String(other.id) !== insuredKey)
          .map(other => ({ id: other.id, naics: other.naics_code ?? null }))
      : [],
  };
}

/** Every claim on the account, across all lines — a live property loss is not a property-only fact. */
function lossExperienceOf(submission, idx) {
  const insuredKey = String(refId(submission.insured));
  const policies = idx.policiesByInsured.get(insuredKey) ?? [];
  const lineOf = new Map(policies.map(p => [String(p.id), p.line_of_business]));
  const claims = policies.flatMap(p => idx.claimsByPolicy.get(String(p.id)) ?? [])
    .map(claim => ({
      id: claim.id, policyId: refId(claim.policy), line: lineOf.get(String(refId(claim.policy))) ?? 'unknown',
      dateOfLoss: claim.date_of_loss ?? null, cause: claim.cause_of_loss ?? null,
      status: claim.status ?? null, open: OPEN_CLAIM.has(normalizedText(claim.status)),
      incurred: incurredOf(claim),
    }))
    .sort((a, b) => (Date.parse(b.dateOfLoss) || 0) - (Date.parse(a.dateOfLoss) || 0));
  const open = claims.filter(c => c.open);
  const totalIncurred = claims.reduce((sum, c) => sum + c.incurred, 0);
  const premium = policies.filter(p => p.currency === 'USD' && isAmount(p.premium)).reduce((sum, p) => sum + p.premium, 0);
  const byCause = Object.entries(claims.reduce((acc, c) => {
    const key = c.cause ?? 'unknown';
    acc[key] ??= { cause: key, count: 0, incurred: 0 };
    acc[key].count++; acc[key].incurred += c.incurred;
    return acc;
  }, {})).map(([, value]) => value).sort((a, b) => b.incurred - a.incurred);
  return {
    claims, claimCount: claims.length, totalIncurred,
    openCount: open.length, openIncurred: open.reduce((sum, c) => sum + c.incurred, 0),
    litigationCount: claims.filter(c => normalizedText(c.status) === 'litigation').length,
    largest: claims.length ? [...claims].sort((a, b) => b.incurred - a.incurred)[0] : null,
    byCause,
    byLine: Object.entries(claims.reduce((acc, c) => {
      acc[c.line] ??= { line: c.line, count: 0, incurred: 0 };
      acc[c.line].count++; acc[c.line].incurred += c.incurred;
      return acc;
    }, {})).map(([, value]) => value).sort((a, b) => b.incurred - a.incurred),
    // Incurred over written premium on the policies we can price. A blunt ratio, not a rated one.
    lossRatio: premium > 0 ? Math.round(totalIncurred / premium * 100) : null,
    ratedPremium: premium,
  };
}

/** Where the money actually sits, and what protects it. */
export function exposureOf(row) {
  const buildings = row.buildings ?? [];
  const total = buildings.reduce((sum, b) => sum + (isAmount(b.tiv) ? b.tiv : 0), 0);
  const sites = (row.sites ?? []).map(site => {
    const own = buildings.filter(b => String(b.locationId) === String(site.id));
    const tiv = own.reduce((sum, b) => sum + (isAmount(b.tiv) ? b.tiv : 0), 0);
    return {
      id: site.id, address: site.address, city: site.city, state: site.state,
      county: site.county, zip: site.zip, protectionClass: site.protectionClass,
      hazardTags: site.hazardTags ?? [], buildingCount: own.length, tiv,
      share: total > 0 ? tiv / total : null,
      oldestYear: own.map(b => b.yearBuilt).filter(Number.isInteger).length ? Math.min(...own.map(b => b.yearBuilt).filter(Number.isInteger)) : null,
      sprinklered: own.filter(b => b.sprinklered === true).length,
      constructionTypes: [...new Set(own.map(b => b.constructionType).filter(Boolean))],
    };
  }).sort((a, b) => b.tiv - a.tiv);
  const sprinklerKnown = buildings.filter(b => b.sprinklered != null);
  const roofYears = buildings.map(b => b.roofYear).filter(Number.isInteger);
  return {
    totalTiv: total, siteCount: sites.length, buildingCount: buildings.length, sites,
    // Share of value at the single largest location: the cat-accumulation question.
    concentration: sites.length ? sites[0].share : null,
    topSite: sites[0] ?? null,
    constructionMix: Object.entries(buildings.reduce((acc, b) => {
      const key = b.constructionType ?? 'Unknown';
      acc[key] = (acc[key] ?? 0) + (isAmount(b.tiv) ? b.tiv : 0);
      return acc;
    }, {})).map(([type, tiv]) => ({ type, tiv, share: total > 0 ? tiv / total : null })).sort((a, b) => b.tiv - a.tiv),
    sprinkleredShare: sprinklerKnown.length ? sprinklerKnown.filter(b => b.sprinklered).length / sprinklerKnown.length : null,
    sprinklerKnown: sprinklerKnown.length === buildings.length && buildings.length > 0,
    oldestRoof: roofYears.length ? Math.min(...roofYears) : null,
    squareFootage: buildings.reduce((sum, b) => sum + (isAmount(b.squareFootage) ? b.squareFootage : 0), 0) || null,
  };
}

/** How the producer's book has actually performed, so submission quality can be weighed. */
function brokerOf(submission, idx) {
  const brokerId = refId(submission.broker);
  if (brokerId == null) return null;
  const record = idx.broker.get(String(brokerId)) ?? null;
  const submitted = idx.submissionsByBroker.get(String(brokerId)) ?? [];
  const bound = submitted.filter(s => WON.has(normalizedText(s.status))).length;
  const lost = submitted.filter(s => LOST_SUBMISSION.has(normalizedText(s.status))).length;
  const decided = bound + lost;
  return {
    id: brokerId, name: record?.name ?? null, tier: record?.tier ?? null, region: record?.region ?? null,
    submissionCount: submitted.length, bound, lost,
    hitRate: decided ? Math.round(bound / decided * 100) : null,
    byLine: Object.entries(tally(submitted, s => s.line_of_business)).map(([line, count]) => ({ line, count })).sort((a, b) => b.count - a.count),
    resolved: Boolean(record),
  };
}

/**
 * Peers are other insureds in the same NAICS industry group with a priced property risk.
 * The rate comparison is a sanity check on pricing, not a rating opinion.
 */
function comparablesOf(row, submission, idx, priced) {
  const insured = idx.insured.get(String(refId(submission.insured)));
  const naics = String(insured?.naics_code ?? '');
  const key = naics.slice(0, 3);
  if (!key) return null;
  const peers = priced.filter(p => p.key === key && String(p.insuredId) !== String(refId(submission.insured)));
  const rate = isAmount(row.premium) && isAmount(row.tiv) && row.tiv > 0 ? row.premium / row.tiv * 1000 : null;
  const peerRates = peers.map(p => p.rate).filter(Number.isFinite);
  const medianRate = median(peerRates);
  return {
    industryKey: key, naics: insured?.naics_code ?? null, sic: insured?.sic_code ?? null,
    peerCount: peers.length,
    peers: peers.map(p => ({ submissionNumber: p.submissionNumber, accountName: p.accountName, insuredId: p.insuredId, premium: p.premium, tiv: p.tiv, rate: Math.round(p.rate * 100) / 100, lossRatio: p.lossRatio }))
      .sort((a, b) => a.rate - b.rate),
    // Rate per $1,000 of insured value.
    thisRate: rate == null ? null : Math.round(rate * 100) / 100,
    medianRate: medianRate == null ? null : Math.round(medianRate * 100) / 100,
    ratePosition: rate != null && medianRate ? Math.round((rate / medianRate - 1) * 100) : null,
    peerMedianLossRatio: median(peers.map(p => p.lossRatio).filter(Number.isFinite)),
  };
}

export function buildCasefiles(rows, data, rules) {
  const idx = index(data);
  const submissions = new Map(data.Submission.map(s => [String(s.id), s]));

  // Priced property risks form the peer pool; built once and shared across every casefile.
  const priced = [];
  for (const row of rows) {
    const submission = submissions.get(String(row.id));
    if (!submission || row.lineOfBusiness !== 'property') continue;
    if (!isAmount(row.premium) || !isAmount(row.tiv) || row.tiv <= 0) continue;
    const insured = idx.insured.get(String(refId(submission.insured)));
    const key = String(insured?.naics_code ?? '').slice(0, 3);
    if (!key) continue;
    priced.push({
      key, insuredId: refId(submission.insured), submissionNumber: row.submissionNumber,
      accountName: row.accountName, premium: row.premium, tiv: row.tiv,
      rate: row.premium / row.tiv * 1000,
      lossRatio: lossExperienceOf(submission, idx).lossRatio,
    });
  }

  return rows.map(row => {
    const submission = submissions.get(String(row.id));
    if (!submission) return row;
    return {
      ...row,
      casefile: {
        relationship: relationshipOf(row, submission, idx),
        lossExperience: lossExperienceOf(submission, idx),
        exposure: exposureOf(row),
        broker: brokerOf(submission, idx),
        comparables: comparablesOf(row, submission, idx, priced),
        underwriter: idx.underwriter.get(String(refId(submission.underwriter))) ?? null,
        requestedLimit: row.requestedLimit,
        insuredProfile: row.insuredProfile,
      },
    };
  });
}

/**
 * Cross-cutting signals a single-factor appetite score cannot express, such as a live loss on
 * the account or value concentrated in one building. These never change the score; they are
 * what an underwriter would want raised before they price the risk.
 */
export function caseSignals(row, rules) {
  const file = row.casefile;
  if (!file) return [];
  const signals = [];
  const { relationship, lossExperience, exposure, comparables, broker } = file;

  if (lossExperience.openCount) {
    signals.push({
      key: 'open-claims', tone: 'warning',
      headline: `${lossExperience.openCount} open claim${lossExperience.openCount === 1 ? '' : 's'} on this account`,
      detail: `${lossExperience.openIncurred > 0 ? `$${Math.round(lossExperience.openIncurred).toLocaleString('en-US')} incurred and still developing` : 'Reserves are still developing'}${lossExperience.litigationCount ? `, ${lossExperience.litigationCount} in litigation` : ''}. Open reserves can move before this policy incepts.`,
    });
  }
  if (lossExperience.lossRatio != null && lossExperience.lossRatio >= 70) {
    signals.push({
      key: 'loss-ratio', tone: 'warning',
      headline: `Account incurred loss is ${lossExperience.lossRatio}% of written premium`,
      detail: `$${Math.round(lossExperience.totalIncurred).toLocaleString('en-US')} incurred against $${Math.round(lossExperience.ratedPremium).toLocaleString('en-US')} premium across all lines.`,
    });
  }
  if (relationship.inForceCount > 0) {
    signals.push({
      key: 'relationship', tone: 'positive',
      headline: `Existing account: ${relationship.inForceCount} polic${relationship.inForceCount === 1 ? 'y' : 'ies'} in force`,
      detail: `$${Math.round(relationship.inForcePremium).toLocaleString('en-US')} of premium already with us across ${relationship.byLine.map(l => l.line).join(', ')}. Declining this risk puts that relationship in play.`,
    });
  }
  if (relationship.lapsed.length) {
    signals.push({
      key: 'lapsed', tone: 'warning',
      headline: `${relationship.lapsed.length} polic${relationship.lapsed.length === 1 ? 'y' : 'ies'} cancelled or non-renewed`,
      detail: `${relationship.lapsed.map(p => `${p.line} (${p.status})`).join(', ')}. Establish why before extending new capacity.`,
    });
  }
  if (relationship.declinedSubmissions.length) {
    signals.push({
      key: 'prior-declines', tone: 'neutral',
      headline: `We previously turned down ${relationship.declinedSubmissions.length} submission${relationship.declinedSubmissions.length === 1 ? '' : 's'} from this account`,
      detail: relationship.declinedSubmissions.map(s => `${s.number} (${s.line}, ${s.status})`).join(', ') + '.',
    });
  }
  if (exposure.concentration != null && exposure.concentration > 0.5 && exposure.siteCount > 1) {
    signals.push({
      key: 'concentration', tone: 'warning',
      headline: `${Math.round(exposure.concentration * 100)}% of insured value sits at one location`,
      detail: `${exposure.topSite.address ? `${exposure.topSite.address}, ` : ''}${exposure.topSite.city ?? ''} ${exposure.topSite.state ?? ''} carries $${Math.round(exposure.topSite.tiv).toLocaleString('en-US')} across ${exposure.topSite.buildingCount} building(s). A single event reaches most of the schedule.`,
    });
  }
  const stateTiv = row.stateTiv ?? {};
  const totalStateTiv = Object.values(stateTiv).reduce((sum, v) => sum + v, 0);
  const outside = Object.entries(stateTiv).filter(([state]) => rules && !rules.acceptableStates.includes(state));
  if (outside.length && totalStateTiv > 0) {
    const outsideTiv = outside.reduce((sum, [, v]) => sum + v, 0);
    signals.push({
      key: 'state-spread', tone: 'warning',
      headline: `${Math.round(outsideTiv / totalStateTiv * 100)}% of insured value sits in states outside appetite`,
      detail: `${outside.map(([state, v]) => `${state} $${Math.round(v).toLocaleString('en-US')}`).join(', ')}. The appetite test names a single primary risk state, so this exposure does not affect the score, but it is written business the guideline does not cover.`,
    });
  }
  // Reports saved before this field existed still render.
  const sameName = relationship.sameName ?? [];
  if (sameName.length) {
    signals.push({
      key: 'same-name', tone: 'neutral',
      headline: `${sameName.length} other insured record${sameName.length === 1 ? ' shares' : 's share'} this account name`,
      detail: `Insured ${sameName.map(o => o.id).join(', ')} carr${sameName.length === 1 ? 'ies' : 'y'} the same name. Confirm whether these are duplicate records or related entities before aggregating exposure.`,
    });
  }
  if (exposure.sprinkleredShare != null && exposure.sprinkleredShare < 1) {
    signals.push({
      key: 'protection', tone: 'neutral',
      headline: `${Math.round(exposure.sprinkleredShare * 100)}% of buildings are sprinklered`,
      detail: 'Unsprinklered buildings drive the fire loss estimate regardless of construction class.',
    });
  }
  if (comparables?.ratePosition != null && Math.abs(comparables.ratePosition) >= 20) {
    signals.push({
      key: 'rate', tone: comparables.ratePosition < 0 ? 'warning' : 'positive',
      headline: `Rate is ${Math.abs(comparables.ratePosition)}% ${comparables.ratePosition < 0 ? 'below' : 'above'} the industry peer median`,
      detail: `$${comparables.thisRate} per $1,000 TIV against a median of $${comparables.medianRate} across ${comparables.peerCount} peer risk(s) in NAICS ${comparables.industryKey}.`,
    });
  }
  if (broker && broker.hitRate != null && broker.submissionCount >= 5 && broker.hitRate < 60) {
    signals.push({
      key: 'broker', tone: 'neutral',
      headline: `This broker's submissions bind ${broker.hitRate}% of the time`,
      detail: `${broker.bound} bound and ${broker.lost} declined or lost out of ${broker.submissionCount} submissions in the book.`,
    });
  }
  if (isFinite(row.requestedLimit) && row.requestedLimit && rules && row.requestedLimit > rules.maxTiv) {
    signals.push({
      key: 'requested-limit', tone: 'neutral',
      headline: `Requested limit exceeds the TIV ceiling`,
      detail: `$${Math.round(row.requestedLimit).toLocaleString('en-US')} requested against a $${rules.maxTiv.toLocaleString('en-US')} maximum. Requested limit is not TIV, but it signals the size of the risk being shopped.`,
    });
  }
  return signals;
}
