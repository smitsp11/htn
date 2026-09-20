import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBookConcentration } from '../src/decision/concentration.js';
import { investigateSubmission } from '../src/decision/investigate.js';

const property = (overrides = {}) => ({
  id: 1,
  accountName: 'Coastal Freight Systems LLC',
  submissionNumber: 'SUB-1',
  lineOfBusiness: 'property',
  verdict: 'chase-evidence',
  score: 69,
  primaryState: 'CA',
  tiv: 20_000_000,
  premium: 60_000,
  brokerId: 5,
  factors: [
    { key: 'lineOfBusiness', label: 'Line of business', status: 'pass', reason: 'Property.' },
    { key: 'primaryRiskState', label: 'Primary risk state', status: 'target', reason: 'CA is target.' },
  ],
  sites: [{ id: 1, address: '1 Pier', city: 'Sacramento', state: 'CA' }],
  ...overrides,
});

test('clear book when no other open files share the state', () => {
  const result = assessBookConcentration(property(), [
    property({ id: 2, primaryState: 'TX', verdict: 'chase-evidence' }),
  ]);
  assert.equal(result.level, 'clear');
  assert.match(result.summary, /clear in this queue/i);
});

test('caution when declined peers already load the same state', () => {
  const result = assessBookConcentration(property(), [
    property({ id: 2, primaryState: 'CA', verdict: 'declined', tiv: 80_000_000 }),
    property({ id: 3, primaryState: 'CA', verdict: 'declined', tiv: 90_000_000 }),
  ]);
  assert.equal(result.level, 'caution');
  assert.match(result.summary, /declined CA/i);
});

test('caution when another open CA file shares the state', () => {
  const result = assessBookConcentration(property(), [
    property({ id: 2, accountName: 'Bay Logistics', primaryState: 'CA', verdict: 'chase-evidence', tiv: 90_000_000 }),
  ]);
  assert.equal(result.level, 'caution');
  assert.match(result.summary, /Bay Logistics/);
  assert.match(result.summary, /Binding this/);
});

test('heavy when three-plus open peers stack the state', () => {
  const queue = [
    property({ id: 2, accountName: 'A', primaryState: 'CA', verdict: 'work-now', tiv: 50_000_000 }),
    property({ id: 3, accountName: 'B', primaryState: 'CA', verdict: 'chase-evidence', tiv: 50_000_000 }),
    property({ id: 4, accountName: 'C', primaryState: 'CA', verdict: 'chase-evidence', tiv: 50_000_000 }),
  ];
  const result = assessBookConcentration(property(), queue);
  assert.equal(result.level, 'heavy');
  assert.match(result.summary, /Heavy CA concentration/i);
});

test('investigate includes if-we-bind step from the queue', async () => {
  const result = await investigateSubmission(property({
    verdict: 'declined',
    factors: [{ key: 'businessType', label: 'Submission type', status: 'fail', reason: 'Renewal.' }],
  }), {
    queue: [property({ id: 2, accountName: 'Peer Co', primaryState: 'CA', verdict: 'chase-evidence', tiv: 120_000_000 })],
    runBrowser: async () => { throw new Error('should not open Browserbase on declined files'); },
  });
  assert.ok(result.steps.some(step => /If we bind this/i.test(step.message)));
  assert.equal(result.concentration.level, 'caution');
  assert.equal(result.browserDecision, 'refused');
});
