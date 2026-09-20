import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { researchSubmission, createResearchService } from '../src/decision/research.js';
import { researchPanel } from '../src/decision/research-panel.js';

const row = () => ({
  id: '1', score: 39, verdict: 'chase-evidence', submissionNumber: 'SUB-1',
  factors: [{ key: 'tiv', label: 'Insured value', confidence: 'absent', status: 'unknown', reason: 'Missing TIV' }],
  sites: [{ id: 10, address: '1 Main Street', city: 'Columbus', state: 'OH', latitude: 40, longitude: -83, geocodable: true }],
  tasks: [{ id: 'old-external', factorKey: 'external' }], briefs: [{ reading: 'stale' }],
});
const config = { providers: { fema: { name: 'fema', enabled: true, transport: 'arcgis', via: 'browser' } } };
const evidence = { provider: 'fema', status: 'ok', reference: 'https://example.gov', fields: { floodZone: 'AE' } };
const lookup = async targets => ({ version: 2, generatedAt: new Date().toISOString(), providerNames: ['fema'], sites: targets.map(t => ({ siteId: t.siteId, resolved: t, evidence: [evidence] })) });

test('research enriches only this submission and sends fresh evidence to AI without changing scores', async () => {
  const original = row();
  const copy = structuredClone(original);
  let released = false;
  const result = await researchSubmission(original, {
    config, openBrowser: async () => ({ page: {}, release: async () => { released = true; } }),
    lookup: async targets => { assert.deepEqual(targets.map(t => t.siteId), [10]); return lookup(targets); },
    makeBriefs: async enriched => {
      assert.equal(released, true, 'release the paid browser before waiting for AI');
      assert.equal(enriched.score, 39);
      assert.equal(enriched.external.evidence[0].fields.floodZone, 'AE');
      assert.equal(enriched.tasks.some(t => t.id === 'old-external'), false);
      assert.deepEqual(enriched.briefs, []);
      return { briefs: [{ factorKey: 'tiv', reading: 'Request the statement of values.' }] };
    },
  });
  assert.deepEqual(original, copy);
  assert.equal(result.aiStatus, 'completed');
  assert.equal(result.browserStatus, 'connected');
  assert.match(result.sites[0].coordinateBasis, /unconfirmed/);
});

test('Browserbase and AI outages leave available evidence visible with explicit statuses', async () => {
  const result = await researchSubmission(row(), {
    config, openBrowser: async () => { throw new Error('private SDK details'); },
    lookup: async (targets, recipe, options) => { assert.equal(options.page, undefined); return lookup(targets); },
    makeBriefs: async () => { throw new Error('private API details'); },
  });
  assert.equal(result.browserStatus, 'unavailable');
  assert.equal(result.aiStatus, 'unavailable');
  assert.equal(result.sites.length, 1);
  assert.deepEqual(result.briefs, []);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('research cache survives a restart, deduplicates clicks, and separates report versions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'federanorth-research-'));
  let calls = 0;
  const run = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { version: 2, submissionId: '1', generatedAt: new Date().toISOString(), aiStatus: 'completed', browserStatus: 'connected', sites: [], briefs: [], uncertainFactors: [], external: null }; };
  const service = createResearchService({ directory, run });
  const report = { generatedAt: 'version-1' };
  await Promise.all([service.run(report, row()), service.run(report, row())]);
  assert.equal(calls, 1);
  const restarted = createResearchService({ directory, run });
  assert.ok(await restarted.read(report, row()));
  await restarted.run(report, row());
  assert.equal(calls, 1);
  await restarted.run({ generatedAt: 'version-2' }, row());
  assert.equal(calls, 2);
  await restarted.run({ generatedAt: 'version-2' }, row(), { refresh: true });
  assert.equal(calls, 3, 'explicit refresh obtains new weather even within the cache window');
});

test('research panel escapes source text and refuses executable source links', () => {
  const result = { generatedAt: new Date().toISOString(), aiStatus: 'unavailable', sites: [{ siteId: 10, address: '<img src=x onerror=alert(1)>', evidence: [{ provider: 'fema-nfhl', status: 'failed', reference: 'javascript:alert(1)' }] }] };
  const html = researchPanel(row(), 'version', result);
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('Source unavailable'));
  assert.ok(html.includes('AI context is unavailable'));
  assert.ok(!html.includes('No active NWS alerts'));
});
