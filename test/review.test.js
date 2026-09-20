import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionFor, evidenceRequest, reviewTasks, isHistoricalCase } from '../src/decision/review.js';
import { validateCaseAction } from '../src/decision/store.js';
import { briefInput } from '../src/decision/brief.js';

const sample = () => ({
  id: 1, submissionNumber: 'SUB-1', accountName: 'Example', lineOfBusiness: 'property',
  factors: [
    { key: 'year', label: 'Building year', status: 'fail', confidence: 'verified', reason: 'The building was constructed in 1985; appetite requires after 1990.' },
    { key: 'loss', label: 'Property losses', status: 'unknown', reason: 'Loss runs missing' },
  ],
  tasks: [
    { id: '1:year', factorKey: 'year', question: 'What year was it built?' },
    { id: '1:loss', factorKey: 'loss', question: 'Provide property loss runs from 2020 to 2025.' },
  ],
});

test('known failures prompt exception review instead of requesting the known value again', () => {
  const row = sample();
  assert.match(attentionFor(row).title, /exception/);
  const tasks = reviewTasks(row);
  assert.equal(tasks[0].requestable, false);
  assert.match(tasks[0].question, /1985/);
  assert.ok(!tasks[0].question.includes('What year'));
  const request = evidenceRequest(row);
  assert.match(request, /loss runs/);
  assert.ok(!request.includes('1985'));
  assert.equal(evidenceRequest(row, { '1:loss': 'answered' }), '');
  assert.match(evidenceRequest(row, { '1:loss': 'sent' }), /loss runs/, 'sent is still awaiting evidence');
});

test('other insurance lines are context only, with no property requests or decisions', () => {
  const row = { ...sample(), lineOfBusiness: 'cyber' };
  assert.deepEqual(reviewTasks(row), []);
  assert.equal(evidenceRequest(row), '');
  assert.match(attentionFor(row).detail, /do not apply/);
  assert.match(validateCaseAction({ type: 'decision', reportVersion: 'v1', submissionId: 1 }, { records: {} }, { generatedAt: 'v1', rows: [row] }), /context only/);
});

test('already bound or closed submissions remain reference records, not new work', () => {
  const row = { ...sample(), queueStatus: 'bound' };
  assert.equal(isHistoricalCase(row), true);
  assert.equal(isHistoricalCase({ queueStatus: 'quoted' }), false);
  assert.deepEqual(reviewTasks(row), []);
  assert.equal(evidenceRequest(row), '');
  assert.match(attentionFor(row).title, /Historical/);
  assert.match(validateCaseAction({ type: 'decision', reportVersion: 'v1', submissionId: 1 }, { records: {} }, { generatedAt: 'v1', rows: [row] }), /reference only/);
});

test('server validates exception rationale, report version and task membership', () => {
  const row = sample(), report = { generatedAt: 'v1', rows: [row] }, store = { records: {} };
  const action = { type: 'decision', submissionId: 1, reportVersion: 'v1', decision: 'approve', decidedBy: 'Underwriter', rationale: '' };
  assert.match(validateCaseAction(action, store, report), /rationale/);
  assert.equal(validateCaseAction({ ...action, rationale: 'Exception reviewed against the supplied record.' }, store, report), null);
  assert.match(validateCaseAction({ ...action, reportVersion: 'old' }, store, report), /Refresh/);
  assert.match(validateCaseAction({ ...action, type: 'request', taskId: 'other-case:loss' }, store, report), /Request not found/);
});

test('AI receives property loss evidence separately from all-line account totals', () => {
  const row = { ...sample(), loss: { observed: 1000, windowStart: '2020-01-01', windowEndExclusive: '2025-01-01', historyComplete: false, coverageRatio: 0.5, gaps: [], claimIds: [1] },
    casefile: { relationship: { lapsed: [] }, lossExperience: { totalIncurred: 900000, claimCount: 20 } } };
  const input = briefInput(row);
  assert.equal(input.propertyEvidence.observedIncurred, 1000);
  assert.equal(input.accountContext.incurredLoss, 900000);
  assert.match(input.propertyEvidence.scope, /Property policies only/);
  assert.match(input.accountContext.scope, /all lines/);
});
