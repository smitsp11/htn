import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSubmissions } from '../src/decision/normalize.js';
import { rankSubmissions } from '../src/decision/scoring.js';
import { applyEscalations } from '../src/decision/escalation.js';
import { buildCasefiles, caseSignals } from '../src/decision/casefile.js';

const rules = JSON.parse(await readFile(new URL('../config/appetite.json', import.meta.url), 'utf8'));

/**
 * Two insureds in NAICS 452. Account 1 is an existing customer with three lines in force,
 * a cancelled excess policy, a declined sibling submission and a live property claim.
 * Account 2 is a clean peer, which gives the rate comparison something to compare against.
 */
function dataset() {
  return {
    Submission: [
      { id: 1, submission_number: 'SUB-1', insured: 1, broker: 9, line_of_business: 'property', status: 'received', target_effective_date: '2025-01-01', requested_limit: 90e6 },
      { id: 2, submission_number: 'SUB-2', insured: 1, broker: 9, line_of_business: 'health', status: 'declined' },
      { id: 3, submission_number: 'SUB-3', insured: 2, broker: 9, line_of_business: 'property', status: 'bound', target_effective_date: '2025-01-01' },
      { id: 4, submission_number: 'SUB-4', insured: 2, broker: 9, line_of_business: 'cyber', status: 'bound' },
    ],
    Insured: [
      { id: 1, name: 'Harbor Retail LLC', naics_code: '452319', sic_code: '5311' },
      { id: 2, name: 'Willow Stores Inc', naics_code: '452990', sic_code: '5311' },
    ],
    Policy: [
      { id: 101, submission: 1, insured: 1, business_type: 'new', line_of_business: 'property', status: 'active', premium: 80000, currency: 'USD', dates: { effective: '2025-01-01', expiration: '2026-01-01' }, exposure_units: [1, 2], claims: [201, 202] },
      { id: 102, submission: null, insured: 1, business_type: 'new', line_of_business: 'cyber', status: 'active', premium: 20000, currency: 'USD', dates: { effective: '2024-01-01', expiration: '2025-01-01' }, exposure_units: [], claims: [203] },
      { id: 103, submission: null, insured: 1, business_type: 'new', line_of_business: 'excess', status: 'cancelled', premium: 5000, currency: 'USD', dates: { effective: '2024-01-01', expiration: '2025-01-01' }, exposure_units: [], claims: [] },
      { id: 104, submission: 3, insured: 2, business_type: 'new', line_of_business: 'property', status: 'active', premium: 60000, currency: 'USD', dates: { effective: '2025-01-01', expiration: '2026-01-01' }, exposure_units: [3], claims: [] },
    ],
    ExposureUnit: [
      { id: 1, kind: 'location', location: 11 }, { id: 2, kind: 'location', location: 12 }, { id: 3, kind: 'location', location: 13 },
    ],
    Location: [
      { id: 11, state: 'OH', city: 'Columbus', address: '1 Main St', buildings: [301] },
      { id: 12, state: 'TX', city: 'Austin', address: '2 Oak Ave', buildings: [302] },
      { id: 13, state: 'OH', city: 'Akron', address: '3 Elm Rd', buildings: [303] },
    ],
    Building: [
      { id: 301, tiv: 60e6, year_built: 2015, construction_type: 'Joisted Masonry', sprinklered: true },
      { id: 302, tiv: 15e6, year_built: 2016, construction_type: 'Steel Frame', sprinklered: false },
      { id: 303, tiv: 50e6, year_built: 2014, construction_type: 'Joisted Masonry', sprinklered: true },
    ],
    Claim: [
      { id: 201, policy: 101, date_of_loss: '2024-06-01', cause_of_loss: 'theft', status: 'open', paid_indemnity: 40000, paid_expense: 0, reserve_indemnity: 30000, reserve_expense: 0 },
      { id: 202, policy: 101, date_of_loss: '2023-02-01', cause_of_loss: 'hail', status: 'closed', paid_indemnity: 5000, paid_expense: 0, reserve_indemnity: 0, reserve_expense: 0 },
      { id: 203, policy: 102, date_of_loss: '2024-09-01', cause_of_loss: 'ransomware', status: 'litigation', paid_indemnity: 10000, paid_expense: 5000, reserve_indemnity: 0, reserve_expense: 0 },
    ],
    Broker: [{ id: 9, name: 'Northline Brokers', tier: 'A', region: 'Midwest' }],
    Underwriter: [],
  };
}

function build(data = dataset()) {
  const rows = applyEscalations(rankSubmissions(normalizeSubmissions(data, rules), rules), rules);
  return buildCasefiles(rows, data, rules);
}
const find = (rows, number) => rows.find(r => r.submissionNumber === number);

test('relationship counts what is in force and what we already lost or turned away', () => {
  const row = find(build(), 'SUB-1');
  const rel = row.casefile.relationship;
  assert.equal(rel.inForceCount, 2);
  assert.equal(rel.inForcePremium, 100000);
  assert.equal(rel.isNewAccount, false);
  assert.deepEqual(rel.byLine.map(l => l.line), ['property', 'cyber']);
  assert.equal(rel.lapsed.length, 1);
  assert.equal(rel.lapsed[0].line, 'excess');
  assert.deepEqual(rel.declinedSubmissions.map(s => s.number), ['SUB-2']);
  // The cancelled policy is excluded from in-force premium but still counted on the account.
  assert.equal(rel.policyCount, 3);
});

test('loss experience spans every line on the account, not just property', () => {
  const loss = find(build(), 'SUB-1').casefile.lossExperience;
  assert.equal(loss.claimCount, 3);
  assert.equal(loss.totalIncurred, 90000);
  assert.equal(loss.openCount, 2, 'open and litigation both count as open');
  assert.equal(loss.openIncurred, 85000);
  assert.equal(loss.litigationCount, 1);
  assert.equal(loss.largest.id, 201);
  assert.ok(loss.byLine.some(l => l.line === 'cyber'), 'a cyber claim belongs in the account picture');
  // 90,000 incurred over 105,000 written premium across all lines.
  assert.equal(loss.lossRatio, 86);
  assert.deepEqual(loss.claims.map(c => c.id), [203, 201, 202], 'most recent first');
});

test('a brand new account reports no relationship rather than a zeroed one', () => {
  const data = dataset();
  data.Policy = data.Policy.filter(p => String(p.insured) !== '1');
  const rel = find(build(data), 'SUB-1').casefile.relationship;
  assert.equal(rel.isNewAccount, true);
  assert.equal(rel.inForceCount, 0);
  assert.equal(find(build(data), 'SUB-1').casefile.lossExperience.claimCount, 0);
});

test('exposure reports concentration and TIV-weighted construction mix', () => {
  const exposure = find(build(), 'SUB-1').casefile.exposure;
  assert.equal(exposure.siteCount, 2);
  assert.equal(exposure.buildingCount, 2);
  assert.equal(exposure.totalTiv, 75e6);
  assert.equal(exposure.topSite.state, 'OH');
  assert.equal(Math.round(exposure.concentration * 100), 80);
  assert.equal(exposure.constructionMix[0].type, 'Joisted Masonry');
  assert.equal(Math.round(exposure.constructionMix[0].share * 100), 80);
  assert.equal(exposure.sprinkleredShare, 0.5);
});

test('broker statistics come from the whole book, not this submission', () => {
  const broker = find(build(), 'SUB-1').casefile.broker;
  assert.equal(broker.name, 'Northline Brokers');
  assert.equal(broker.tier, 'A');
  assert.equal(broker.submissionCount, 4);
  assert.equal(broker.bound, 2);
  assert.equal(broker.lost, 1);
  // Two bound against one declined; the still-open submission is not yet decided.
  assert.equal(broker.hitRate, 67);
});

test('peers exclude the account itself and place its rate against the group', () => {
  const rows = build();
  const peers = find(rows, 'SUB-1').casefile.comparables;
  assert.equal(peers.industryKey, '452');
  assert.equal(peers.peerCount, 1);
  assert.equal(peers.peers[0].accountName, 'Willow Stores Inc');
  assert.ok(peers.peers.every(p => String(p.insuredId) !== '1'), 'the subject account is never its own peer');
  // 80,000 over 75M TIV is $1.07 per $1,000; the peer writes 60,000 over 50M, or $1.20.
  assert.equal(peers.thisRate, 1.07);
  assert.equal(peers.medianRate, 1.2);
  assert.equal(peers.ratePosition, -11);
});

test('signals surface live losses, out-of-appetite value and duplicate account names', () => {
  const rows = build();
  const row = find(rows, 'SUB-1');
  const signals = caseSignals(row, rules);
  const key = k => signals.find(s => s.key === k);

  assert.ok(key('open-claims'), 'two open claims must be raised');
  assert.match(key('open-claims').detail, /litigation/);
  assert.ok(key('loss-ratio'), '86% loss ratio is above the 70% threshold');
  assert.ok(key('relationship'), 'existing premium in force must be raised');
  assert.ok(key('lapsed'), 'a cancelled policy must be raised');
  assert.ok(key('prior-declines'));

  // TX holds 15M of 75M and is not an acceptable state, though OH still leads on TIV.
  const spread = key('state-spread');
  assert.ok(spread);
  assert.match(spread.headline, /20% of insured value/);
  assert.equal(row.factors.find(f => f.key === 'state').status, 'target', 'the spread signal must not change the state factor');
});

test('a second insured record with the same name is raised as a possible duplicate', () => {
  const data = dataset();
  data.Insured.push({ id: 3, name: 'Harbor Retail LLC', naics_code: '452319', sic_code: '5311' });
  const row = find(build(data), 'SUB-1');
  const signal = caseSignals(row, rules).find(s => s.key === 'same-name');
  assert.ok(signal);
  assert.match(signal.headline, /1 other insured record shares/);
  assert.match(signal.detail, /Insured 3/);
});

test('case context never changes the appetite score', () => {
  const plain = applyEscalations(rankSubmissions(normalizeSubmissions(dataset(), rules), rules), rules);
  const enriched = build();
  for (const row of plain) {
    const match = enriched.find(r => r.id === row.id);
    assert.equal(match.score, row.score, `score moved for ${row.submissionNumber}`);
    assert.equal(match.decision, row.decision);
    assert.deepEqual(match.factors.map(f => f.points), row.factors.map(f => f.points));
  }
});

test('casefiles survive a dataset with no broker or underwriter records', () => {
  const data = dataset();
  delete data.Broker;
  delete data.Underwriter;
  const row = find(build(data), 'SUB-1');
  assert.equal(row.casefile.broker.resolved, false);
  assert.equal(row.casefile.broker.name, null);
  assert.equal(row.casefile.broker.submissionCount, 4, 'book statistics still work without the broker record');
  assert.doesNotThrow(() => caseSignals(row, rules));
});
