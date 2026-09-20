import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSubmissions } from '../src/decision/normalize.js';
import { rankSubmissions } from '../src/decision/scoring.js';
import { applyEscalations } from '../src/decision/escalation.js';
import { buildCasefiles } from '../src/decision/casefile.js';
import { buildLeads } from '../src/decision/leads.js';

const rules = JSON.parse(await readFile(new URL('../config/appetite.json', import.meta.url), 'utf8'));

/**
 * SUB-1 has no linked policy, so every factor is unresolved — the case where an underwriter
 * most needs something to look at. The account still carries an expiring property policy with
 * a full schedule, which is exactly what they would pull up first.
 */
function dataset() {
  return {
    Submission: [
      { id: 1, submission_number: 'SUB-1', insured: 1, broker: 9, line_of_business: 'property', status: 'received', target_effective_date: '2025-01-01', requested_limit: 10e6 },
      { id: 2, submission_number: 'SUB-2', insured: 2, broker: 9, line_of_business: 'property', status: 'bound', target_effective_date: '2025-01-01' },
    ],
    Insured: [
      { id: 1, name: 'Gap Account LLC', naics_code: '332710', annual_revenue: 253e6, employee_count: 1946 },
      { id: 2, name: 'Peer Co', naics_code: '332999' },
    ],
    Policy: [
      // Expiring property policy on the same account, not linked to SUB-1.
      { id: 90, submission: null, insured: 1, business_type: 'new', line_of_business: 'property', status: 'active', policy_number: 'PR-PRIOR', premium: 703500, currency: 'USD', dates: { effective: '2024-01-01', expiration: '2025-01-01' }, exposure_units: [1], claims: [201] },
      { id: 91, submission: null, insured: 1, business_type: 'renewal', line_of_business: 'cyber', status: 'active', policy_number: 'CY-1', premium: 50000, currency: 'USD', dates: { effective: '2024-01-01', expiration: '2025-01-01' }, exposure_units: [], claims: [] },
      { id: 92, submission: 2, insured: 2, business_type: 'new', line_of_business: 'property', status: 'active', policy_number: 'PR-PEER', premium: 85000, currency: 'USD', dates: { effective: '2025-01-01', expiration: '2026-01-01' }, exposure_units: [2], claims: [] },
    ],
    ExposureUnit: [{ id: 1, kind: 'location', location: 11 }, { id: 2, kind: 'location', location: 12 }],
    Location: [
      { id: 11, state: 'CA', city: 'Oakland', address: '1 Dock St', buildings: [301, 302] },
      { id: 12, state: 'OH', city: 'Columbus', address: '9 Elm', buildings: [303] },
    ],
    Building: [
      { id: 301, tiv: 84e6, year_built: 1961, construction_type: 'Frame' },
      { id: 302, tiv: 40e6, year_built: 2018, construction_type: 'Steel Frame' },
      { id: 303, tiv: 75e6, year_built: 2015, construction_type: 'Joisted Masonry' },
    ],
    Claim: [{ id: 201, policy: 90, date_of_loss: '2024-06-01', cause_of_loss: 'fire', status: 'open', paid_indemnity: 40000, paid_expense: 0, reserve_indemnity: 10000, reserve_expense: 0 }],
    Broker: [{ id: 9, name: 'Northline', tier: 'A' }],
    Underwriter: [],
  };
}

function build() {
  const data = dataset();
  const rows = buildCasefiles(applyEscalations(rankSubmissions(normalizeSubmissions(data, rules), rules), rules), data, rules);
  return buildLeads(rows, data, rules);
}
const subject = () => build().find(r => r.submissionNumber === 'SUB-1');

test('an unresolved factor carries what the account already holds', () => {
  const row = subject();
  assert.ok(row.factors.every(f => f.key === 'lineOfBusiness' || f.status === 'unknown'), 'fixture should leave the factors open');

  const tiv = row.leads.tiv;
  assert.ok(tiv.some(l => l.kind === 'partial-value' && l.value.includes('10,000,000')), 'requested limit is a lead');
  assert.ok(tiv.some(l => l.kind === 'adjacent-policy' && l.value.includes('124,000,000')), 'the prior schedule sums to $124M');
  assert.ok(tiv.some(l => l.kind === 'account-profile' && l.value.includes('253,000,000')), 'revenue gives order of magnitude');

  // The prior schedule says 1961, which would fail the year gate — visible before the broker replies.
  assert.match(row.leads.year[0].value, /oldest 1961/);
  assert.match(row.leads.premium[0].value, /703,500/);
  assert.match(row.leads.state[0].value, /CA/);
  assert.match(row.leads.construction[0].value, /Frame/);
});

test('every lead states why it is not a substitute and cites its records', () => {
  const row = subject();
  for (const [factorKey, list] of Object.entries(row.leads)) {
    assert.ok(list.length <= 4, `${factorKey} must stay readable`);
    for (const item of list) {
      assert.ok(item.caution && item.caution.length > 20, `${factorKey} lead needs a caution`);
      assert.ok(item.label && item.value != null, `${factorKey} lead needs a label and value`);
    }
  }
  assert.ok(row.leads.tiv.some(l => l.sources.some(s => s.startsWith('Building:'))), 'schedule leads cite their buildings');
});

test('a sibling policy of another line is offered for submission type but flagged as not decisive', () => {
  const row = subject();
  const types = row.leads.businessType;
  assert.ok(types.some(l => l.value === 'renewal'), 'the cyber renewal is surfaced');
  assert.ok(types.every(l => /does not establish/.test(l.caution)));
});

test('leads never change a score, a factor or a decision', () => {
  const data = dataset();
  const plain = buildCasefiles(applyEscalations(rankSubmissions(normalizeSubmissions(data, rules), rules), rules), data, rules);
  const withLeads = buildLeads(plain, data, rules);
  for (const before of plain) {
    const after = withLeads.find(r => r.id === before.id);
    assert.equal(after.score, before.score);
    assert.equal(after.decision, before.decision);
    assert.equal(after.verdict, before.verdict);
    assert.deepEqual(after.factors, before.factors);
  }
});

test('a resolved factor gets no leads, and a submission with nothing adjacent degrades quietly', () => {
  const resolved = build().find(r => r.submissionNumber === 'SUB-2');
  assert.equal(resolved.leads.tiv, undefined, 'a scored factor needs no leads');

  const lonely = dataset();
  lonely.Policy = lonely.Policy.filter(p => String(p.insured) !== '1');
  const data = lonely;
  const rows = buildLeads(buildCasefiles(applyEscalations(rankSubmissions(normalizeSubmissions(data, rules), rules), rules), data, rules), data, rules);
  const row = rows.find(r => r.submissionNumber === 'SUB-1');
  assert.deepEqual(row.leads.businessType, undefined, 'no sibling policies means no leads, not an empty card');
  assert.ok(row.leads.tiv.some(l => l.kind === 'partial-value'), 'the requested limit still stands on its own');
});
