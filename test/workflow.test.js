import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSubmissions } from '../src/decision/normalize.js';
import { rankSubmissions } from '../src/decision/scoring.js';
import { applyEscalations } from '../src/decision/escalation.js';
import { buildCasefiles } from '../src/decision/casefile.js';
import {
  decisionOptions, pricingGuidance, reviewStage, validateDecision, workflowState, workflowSummary,
} from '../src/decision/workflow.js';
import { applyAction, loadStore, saveStore } from '../src/decision/store.js';

const rules = JSON.parse(await readFile(new URL('../config/appetite.json', import.meta.url), 'utf8'));

/** One clean property risk and one that fails appetite on premium. */
function dataset() {
  return {
    Submission: [
      { id: 1, submission_number: 'SUB-OK', insured: 1, line_of_business: 'property', status: 'received', target_effective_date: '2025-01-01' },
      { id: 2, submission_number: 'SUB-FAIL', insured: 2, line_of_business: 'property', status: 'received', target_effective_date: '2025-01-01' },
    ],
    Insured: [{ id: 1, name: 'Clean Co', naics_code: '452319' }, { id: 2, name: 'Pricey Co', naics_code: '452319' }],
    Policy: [
      { id: 100, submission: null, insured: 1, business_type: 'new', line_of_business: 'property', status: 'expired', premium: 80000, currency: 'USD', dates: { effective: '2020-01-01', expiration: '2025-01-01' }, exposure_units: [1], claims: [] },
      { id: 101, submission: 1, insured: 1, business_type: 'new', line_of_business: 'property', status: 'active', premium: 85000, currency: 'USD', dates: { effective: '2025-01-01', expiration: '2026-01-01' }, exposure_units: [1], claims: [] },
      { id: 102, submission: 2, insured: 2, business_type: 'new', line_of_business: 'property', status: 'active', premium: 900000, currency: 'USD', dates: { effective: '2025-01-01', expiration: '2026-01-01' }, exposure_units: [2], claims: [] },
    ],
    ExposureUnit: [{ id: 1, kind: 'location', location: 11 }, { id: 2, kind: 'location', location: 12 }],
    Location: [
      { id: 11, state: 'OH', buildings: [301] }, { id: 12, state: 'OH', buildings: [302] },
    ],
    Building: [
      { id: 301, tiv: 75e6, year_built: 2015, construction_type: 'Joisted Masonry' },
      { id: 302, tiv: 75e6, year_built: 2015, construction_type: 'Joisted Masonry' },
    ],
    Claim: [], Broker: [], Underwriter: [],
  };
}

function build() {
  const data = dataset();
  return buildCasefiles(applyEscalations(rankSubmissions(normalizeSubmissions(data, rules), rules), rules), data, rules);
}
const clean = () => build().find(r => r.submissionNumber === 'SUB-OK');
const failing = () => build().find(r => r.submissionNumber === 'SUB-FAIL');

test('the case advances through review, assessment, then decision', () => {
  const row = failing();
  assert.ok(row.tasks.length > 0, 'fixture should leave a request open');
  let state = workflowState(row, null, rules);
  assert.equal(state.stage, 'review');
  assert.equal(state.steps[1].done, true, 'assessment is always available');
  assert.equal(state.steps[2].done, false);

  const store = { version: 1, records: {} };
  for (const task of row.tasks) {
    applyAction(store, { type: 'request', submissionId: String(row.id), taskId: task.id, state: 'answered' });
  }
  state = workflowState(row, store.records[String(row.id)], rules);
  assert.equal(state.stage, 'decide');
  assert.equal(state.review.complete, true);
  assert.equal(state.review.answered, row.tasks.length);
});

test('a sent request is still open; only answered or waived closes it', () => {
  const row = failing();
  const store = { version: 1, records: {} };
  const taskId = row.tasks[0].id;
  applyAction(store, { type: 'request', submissionId: '2', taskId, state: 'sent' });
  let review = reviewStage(row, store.records['2']);
  assert.equal(review.sent, 1);
  assert.equal(review.complete, false, 'sending a request does not answer it');

  applyAction(store, { type: 'request', submissionId: '2', taskId, state: 'waived' });
  review = reviewStage(row, store.records['2']);
  assert.equal(review.waived, 1);
  assert.equal(review.outstanding, row.tasks.length - 1);
});

test('approving a risk that fails appetite is allowed but demands a rationale', () => {
  const row = failing();
  assert.ok(row.factors.some(f => f.status === 'fail'), 'fixture should fail appetite');
  const review = reviewStage(row, null);
  const approve = decisionOptions(row, review).find(o => o.value === 'approve');
  assert.equal(approve.available, true, 'an exception is a real underwriting act, not a blocked one');
  assert.equal(approve.requiresRationale, true);
  assert.match(approve.warning, /exception/);

  assert.match(validateDecision({ decision: 'approve', decidedBy: 'A. Reader', rationale: 'ok' }, row, review), /rationale/);
  assert.equal(validateDecision({ decision: 'approve', decidedBy: 'A. Reader', rationale: 'Priced as an exception at the account level.' }, row, review), null);
});

test('a decision must be attributed and its premium must be a number', () => {
  const row = clean();
  const review = reviewStage(row, null);
  assert.match(validateDecision({ decision: 'decline', decidedBy: '', rationale: 'Outside our plan for the year.' }, row, review), /attributed/);
  assert.match(validateDecision({ decision: 'nope', decidedBy: 'A' }, row, review), /Unrecognised/);
  assert.match(validateDecision({ decision: 'approve', decidedBy: 'A', pricing: { premium: 'lots' } }, row, review), /positive number/);
});

test('request-info is unavailable once nothing is outstanding', () => {
  const row = clean();
  const review = reviewStage(row, null);
  const option = decisionOptions(row, review).find(o => o.value === 'request-info');
  assert.equal(option.available, review.outstanding > 0);
});

test('pricing guidance places the quote against peers and the appetite bands', () => {
  const row = failing();
  const pricing = pricingGuidance(row, rules);
  assert.equal(pricing.quoted, 900000);
  assert.deepEqual(pricing.acceptableBand, rules.premiumRange);
  assert.equal(pricing.withinAcceptable, false, '900k is outside the 50k-175k band');
  assert.equal(pricing.withinTarget, false);
  assert.equal(pricing.tiv, 75e6);
  if (pricing.indicated != null) assert.ok(pricing.indicatedBasis.includes('per $1,000 TIV'));
});

test('actions persist across a reload and a bad action is refused', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'federanorth-state-'));
  const path = join(directory, 'state.json');
  try {
    assert.deepEqual(await loadStore(path), { version: 1, records: {} }, 'a missing file is an empty store');

    const store = await loadStore(path);
    applyAction(store, {
      type: 'decision', submissionId: '1', decision: 'approve',
      rationale: 'Clean risk, priced at the peer median.', decidedBy: 'A. Reader',
      pricing: { premium: 85000, terms: '$25k deductible' },
    });
    await saveStore(store, path);

    const reloaded = await loadStore(path);
    assert.equal(reloaded.records['1'].decision.decision, 'approve');
    assert.equal(reloaded.records['1'].decision.pricing.premium, 85000);
    assert.equal(reloaded.records['1'].decision.decidedBy, 'A. Reader');

    assert.throws(() => applyAction(reloaded, { type: 'decision', submissionId: '1', decision: 'maybe', decidedBy: 'A' }), /Unrecognised decision/);
    assert.throws(() => applyAction(reloaded, { type: 'request', submissionId: '1', taskId: 't', state: 'invented' }), /Unrecognised request state/);
    assert.throws(() => applyAction(reloaded, { type: 'decision', submissionId: '', decision: 'approve', decidedBy: 'A' }), /name a submission/);
    assert.throws(() => applyAction(reloaded, { type: 'decision', submissionId: '1', decision: 'approve', decidedBy: '' }), /attributed/);

    applyAction(reloaded, { type: 'reopen', submissionId: '1' });
    assert.equal(reloaded.records['1'].decision, null, 'reopening clears the decision but keeps the record');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('free text is bounded so a pasted document cannot bloat the store', () => {
  const store = { version: 1, records: {} };
  applyAction(store, {
    type: 'decision', submissionId: '1', decision: 'decline',
    rationale: 'x'.repeat(9000), decidedBy: 'y'.repeat(400),
    pricing: { terms: 'z'.repeat(9000) },
  });
  const decision = store.records['1'].decision;
  assert.equal(decision.rationale.length, 2000);
  assert.equal(decision.decidedBy.length, 120);
  assert.equal(decision.pricing.terms.length, 500);
});

test('the queue roll-up separates untouched work from decided work', () => {
  const rows = build();
  const store = { version: 1, records: {} };
  assert.deepEqual(workflowSummary(rows, store.records, rules).counts, { untouched: 2, review: 0, decide: 0, closed: 0 });

  applyAction(store, {
    type: 'decision', submissionId: String(rows[0].id), decision: 'decline',
    rationale: 'Premium well outside the band.', decidedBy: 'A. Reader',
  });
  const summary = workflowSummary(rows, store.records, rules);
  assert.equal(summary.counts.closed, 1);
  assert.equal(summary.counts.untouched, 1);
  assert.equal(summary.decisions.decline, 1);
});
