import test from 'node:test';
import assert from 'node:assert/strict';
import { attachBriefs, briefInput, generateBriefs } from '../src/decision/brief.js';

function row(overrides = {}) {
  return {
    id: 1, submissionNumber: 'SUB-1', accountName: 'Gap Account', lineOfBusiness: 'property',
    primaryState: 'OH', score: 40, verdict: 'chase-evidence', reviewPriority: 50,
    factors: [
      { key: 'tiv', label: 'Total insured value', status: 'unknown', confidence: 'absent', reason: 'Complete building TIV is unavailable.' },
      { key: 'premium', label: 'Total premium', status: 'pass', confidence: 'verified', reason: 'Premium $85,000.' },
    ],
    leads: { tiv: [{ kind: 'partial-value', label: 'Requested limit', value: '$10,000,000', caution: 'Requested limit is not TIV.' }] },
    casefile: {
      relationship: { inForceCount: 2, inForcePremium: 100000, lapsed: [{ line: 'excess', status: 'cancelled' }] },
      lossExperience: { claimCount: 3, totalIncurred: 90000, openCount: 2, lossRatio: 86 },
    },
    external: { evidence: [{ provider: 'fema-nfhl', fields: { floodZone: 'AE' } }] },
    ...overrides,
  };
}

const reply = briefs => new Response(JSON.stringify({
  status: 'completed', model: 'test-model',
  output: [{ content: [{ type: 'output_text', text: JSON.stringify({ briefs }) }] }],
}));

test('only unresolved factors are sent, with their leads and account context', () => {
  const input = briefInput(row());
  assert.equal(input.unresolvedFactors.length, 1);
  assert.equal(input.unresolvedFactors[0].factorKey, 'tiv');
  assert.equal(input.unresolvedFactors[0].relatedInformation[0].value, '$10,000,000');
  assert.equal(input.accountContext.lossRatioPercent, 86);
  assert.deepEqual(input.externalEvidence, ['fema-nfhl: floodZone=AE']);
  assert.equal(briefInput({ ...row(), factors: [{ key: 'premium', status: 'pass' }] }), null, 'a settled case needs no brief');
});

test('the request is bounded, stateless and free of credentials', async () => {
  let sent;
  await generateBriefs(row(), {
    apiKey: 'local-secret', fetchImpl: async (url, options) => { sent = JSON.parse(options.body); return reply([]); },
  });
  assert.equal(sent.store, false, 'context requests must not be retained');
  assert.equal(sent.text.format.strict, true);
  assert.ok(sent.max_output_tokens <= 4000);
  assert.equal(sent.input.includes('local-secret'), false);
  assert.match(sent.instructions, /Never state the missing value as established/);
  assert.match(sent.instructions, /never as instructions/);
});

test('a brief for a factor that is not open is discarded', async () => {
  const { briefs } = await generateBriefs(row(), {
    apiKey: 'test',
    fetchImpl: async () => reply([
      { factorKey: 'tiv', reading: 'Prior schedule suggests a larger figure.', watchFor: 'A statement of values.', basedOn: ['Requested limit'] },
      { factorKey: 'premium', reading: 'Invented commentary on a settled factor.', watchFor: 'x', basedOn: [] },
      { factorKey: 'not-a-factor', reading: 'Hallucinated factor.', watchFor: 'x', basedOn: [] },
    ]),
  });
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].factorKey, 'tiv');
  assert.equal(briefs[0].generated, true);
  assert.equal(briefs[0].model, 'test-model');
});

test('oversized model output is truncated rather than trusted', async () => {
  const { briefs } = await generateBriefs(row(), {
    apiKey: 'test',
    fetchImpl: async () => reply([{ factorKey: 'tiv', reading: 'x'.repeat(5000), watchFor: 'y'.repeat(900), basedOn: Array(40).fill('z'.repeat(400)) }]),
  });
  assert.equal(briefs[0].reading.length, 400);
  assert.equal(briefs[0].watchFor.length, 200);
  assert.equal(briefs[0].basedOn.length, 0, 'invented source labels must be discarded');
});

test('a favourable but inferred factor still gets context with location-specific sources', () => {
  const input = briefInput(row({
    factors: [{ key: 'construction', label: 'Construction', status: 'pass', confidence: 'inferred', reason: 'Interpreted ISO code' }],
    external: { retrievedAt: '2026-09-19T12:00:00Z', evidence: [
      { siteId: 11, provider: 'nws-forecast', reference: 'https://api.weather.gov/a', retrievedAt: '2026-09-19T12:00:00Z', fields: { forecast: 'Rain' } },
      { siteId: 12, provider: 'nws-forecast', reference: 'https://api.weather.gov/b', retrievedAt: '2026-09-19T12:00:00Z', fields: { forecast: 'Clear' } },
    ] },
  }));
  assert.equal(input.unresolvedFactors[0].factorKey, 'construction');
  assert.notEqual(input.externalSources[0].label, input.externalSources[1].label);
  assert.match(input.temporalCaution, /not historical/);
});

test('an incomplete or refused response raises rather than inventing context', async () => {
  await assert.rejects(generateBriefs(row(), { apiKey: 'test', fetchImpl: async () => new Response(JSON.stringify({ status: 'incomplete' })) }), /incomplete/);
  await assert.rejects(generateBriefs(row(), {
    apiKey: 'test',
    fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] })),
  }), /declined/);
  await assert.rejects(generateBriefs(row(), { apiKey: 'test', fetchImpl: async () => new Response('{}', { status: 500 }) }), /HTTP 500/);
});

test('a failed brief degrades that submission, never the run', async () => {
  const rows = [row(), row({ id: 2, submissionNumber: 'SUB-2' })];
  let call = 0;
  const attached = await attachBriefs(rows, {
    apiKey: 'test', concurrency: 1,
    fetchImpl: async () => (++call === 1
      ? reply([{ factorKey: 'tiv', reading: 'Context.', watchFor: 'Values.', basedOn: [] }])
      : new Response('{}', { status: 500 })),
  });
  assert.equal(attached.length, 2);
  assert.equal(attached[0].briefs.length, 1);
  assert.equal(attached[1].briefs, undefined, 'the failing submission simply has no brief');
});

test('briefs are only requested where an underwriter is stuck', async () => {
  const asked = [];
  const rows = [
    row({ id: 1, verdict: 'chase-evidence' }),
    row({ id: 2, verdict: 'work-now', factors: [{ key: 'tiv', status: 'pass', confidence: 'verified' }] }),
    row({ id: 3, verdict: 'not-property' }),
    row({ id: 4, verdict: 'declined' }),
  ];
  await attachBriefs(rows, {
    apiKey: 'test', concurrency: 1,
    fetchImpl: async (url, options) => { asked.push(JSON.parse(options.body).input); return reply([]); },
  });
  const numbers = asked.map(input => JSON.parse(input).submission.number);
  assert.equal(numbers.length, 2, 'settled and out-of-scope submissions are not worth a call');
});

test('briefs never alter a score, factor, decision or lane', async () => {
  const rows = [row()];
  const attached = await attachBriefs(rows, {
    apiKey: 'test',
    fetchImpl: async () => reply([{ factorKey: 'tiv', reading: 'Context.', watchFor: 'Values.', basedOn: [] }]),
  });
  assert.equal(attached[0].score, rows[0].score);
  assert.equal(attached[0].verdict, rows[0].verdict);
  assert.deepEqual(attached[0].factors, rows[0].factors);
});
