import test from 'node:test';
import assert from 'node:assert/strict';
import { browserDecisionFor, buildInvestigateSteps, investigateSubmission } from '../src/decision/investigate.js';
import { browserbaseSearch, runBrowserbaseInvestigate } from '../src/decision/investigate-browser.js';

const propertyRow = (overrides = {}) => ({
  id: '81',
  accountName: 'Coastal Freight Systems LLC',
  submissionNumber: 'SUB-2026-00081',
  lineOfBusiness: 'property',
  verdict: 'chase-evidence',
  score: 69,
  premium: 88000,
  primaryState: 'FL',
  factors: [
    { key: 'lineOfBusiness', label: 'Line of business', status: 'pass', reason: 'Property business is acceptable.' },
    { key: 'fiveYearLossValue', label: 'Five-year losses', status: 'unknown', reason: 'Loss window incomplete.' },
  ],
  sites: [{ id: 1, address: '100 Pier St', city: 'Tampa', state: 'FL', geocodable: true }],
  buildings: [],
  ...overrides,
});

test('not-property files refuse Browserbase', () => {
  const decision = browserDecisionFor(propertyRow({
    lineOfBusiness: 'cyber',
    verdict: 'not-property',
    factors: [{ key: 'lineOfBusiness', label: 'Line of business', status: 'fail', reason: 'Cyber is outside property appetite.' }],
  }));
  assert.equal(decision.allow, false);
  assert.match(decision.reason, /Not a commercial-property/i);
});

test('hard appetite fails refuse Browserbase', () => {
  const decision = browserDecisionFor(propertyRow({
    verdict: 'declined',
    factors: [
      { key: 'lineOfBusiness', label: 'Line of business', status: 'pass', reason: 'Property.' },
      { key: 'businessType', label: 'Submission type', status: 'fail', reason: 'Renewal is outside appetite.' },
    ],
  }));
  assert.equal(decision.allow, false);
  assert.match(decision.reason, /Hard appetite fail/i);
});

test('chase-evidence with an address allows Browserbase', () => {
  const decision = browserDecisionFor(propertyRow());
  assert.equal(decision.allow, true);
});

test('investigate refused path never calls Browserbase', async () => {
  let called = false;
  const result = await investigateSubmission(propertyRow({
    verdict: 'declined',
    factors: [{ key: 'businessType', label: 'Submission type', status: 'fail', reason: 'Renewal.' }],
  }), {
    runBrowser: async () => { called = true; return {}; },
  });
  assert.equal(called, false);
  assert.equal(result.browserDecision, 'refused');
  assert.equal(result.liveViewRecommended, false);
  assert.ok(result.steps.some(step => /Hard appetite fail/i.test(step.message)));
});

test('investigate allowed path runs Browserbase and attaches flood finding', async () => {
  const result = await investigateSubmission(propertyRow(), {
    runBrowser: async () => ({
      browserStatus: 'connected',
      liveViewUrl: 'https://www.browserbase.com/sessions/test',
      handle: { release: async () => {} },
      search: { query: 'test', results: [{ title: 'FEMA', url: 'https://example.com' }] },
      steps: [{ kind: 'bb-search', tone: 'neutral', message: 'Browserbase Search: ok' }],
      research: {
        browserStatus: 'connected',
        aiStatus: 'not-needed',
        briefs: [],
        sites: [{
          siteId: 1,
          address: '100 Pier St, Tampa, FL',
          evidence: [{ provider: 'fema-nfhl', status: 'ok', fields: { floodZone: 'AE', specialFloodHazardArea: 'Yes' } }],
        }],
      },
    }),
  });
  assert.equal(result.browserDecision, 'opened');
  assert.equal(result.liveViewRecommended, true);
  assert.equal(result.liveViewUrl, 'https://www.browserbase.com/sessions/test');
  assert.equal(result.impact.elevated, true);
  assert.match(result.impact.summary, /flood/i);
  assert.ok(result.steps.some(step => /Browserbase Search/i.test(step.message)));
});

test('reasoning log includes Federato factors before browser decision', () => {
  const steps = buildInvestigateSteps(propertyRow(), { allow: true, reason: 'Opening browser.' });
  assert.ok(steps[0].message.includes('Coastal Freight'));
  assert.ok(steps.some(step => /Five-year losses/i.test(step.message)));
  assert.equal(steps.at(-1).message, 'Opening browser.');
});

test('Browserbase search posts to the Search API', async () => {
  let body;
  const result = await browserbaseSearch('Tampa FEMA flood', {
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      assert.match(url, /\/v1\/search$/);
      assert.equal(init.headers['X-BB-API-Key'], 'test-key');
      body = JSON.parse(init.body);
      return {
        ok: true,
        async json() { return { results: [{ title: 'FEMA MSC', url: 'https://msc.fema.gov', snippet: 'flood' }] }; },
      };
    },
  });
  assert.equal(body.query, 'Tampa FEMA flood');
  assert.equal(result.results[0].title, 'FEMA MSC');
});

test('runBrowserbaseInvestigate opens one live session and enriches through it', async () => {
  let released = false;
  const result = await runBrowserbaseInvestigate(propertyRow(), {
    search: async () => ({ query: 'q', results: [{ title: 'Hit', url: 'https://example.com' }] }),
    openSession: async site => {
      assert.equal(site.address, '100 Pier St');
      return {
        page: {},
        liveViewUrl: 'https://www.browserbase.com/sessions/live',
        sessionId: 'sess',
        async release() { released = true; },
      };
    },
    loadConfig: async () => ({ providers: {}, concurrency: 1 }),
    enrich: async () => ({
      version: 2,
      generatedAt: new Date().toISOString(),
      providerNames: ['fema-nfhl'],
      sites: [{
        siteId: 1,
        resolved: { address: '100 Pier St', city: 'Tampa', state: 'FL' },
        evidence: [{ provider: 'fema-nfhl', status: 'ok', fields: { floodZone: 'X' }, retrievedAt: new Date().toISOString() }],
      }],
    }),
    apply: rows => rows,
    makeBriefs: async () => ({ briefs: [] }),
  });
  assert.equal(result.liveViewUrl, 'https://www.browserbase.com/sessions/live');
  assert.equal(result.browserStatus, 'connected');
  assert.equal(result.research.sites[0].evidence[0].fields.floodZone, 'X');
  assert.equal(released, false, 'Investigate keeps the live session open for the iframe');
  assert.ok(result.steps.some(step => /Browserbase Search/i.test(step.message)));
});
