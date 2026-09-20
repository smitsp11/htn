import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertAllowedUrl, coerce, fillTemplate, readPath, resolveQuery, unmetRequirements } from '../src/enrichment/recipe.js';
import { arcgisTransport, browserTransport, httpTransport } from '../src/enrichment/transports.js';
import { collectTargets, enrichSites, loadEnrichmentConfig } from '../src/enrichment/runner.js';
import { applyEnrichment } from '../src/enrichment/apply.js';

const config = await loadEnrichmentConfig();
const json = data => new Response(JSON.stringify(data), { status: 200 });

test('concurrent sites and runs cannot read each other\'s Browserbase page', async () => {
  let currentUrl;
  let active = 0;
  let overlap = false;
  const page = {
    async goto(url) {
      active++;
      if (active > 1) overlap = true;
      currentUrl = url;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { ok: () => true };
    },
    locator() { return { innerText: async () => {
      const marker = new URL(currentUrl).searchParams.get('site');
      active--;
      return JSON.stringify({ marker });
    } }; },
  };
  const provider = { name: 'browser-test', enabled: true, transport: 'http', via: 'browser', requires: ['address'], url: 'https://example.gov', query: { site: '{{address}}' }, extract: { marker: { path: 'marker', type: 'string' } } };
  const recipe = { concurrency: 3, providers: { test: provider } };
  const results = await Promise.all([
    enrichSites([{ siteId: 'A', address: 'A' }, { siteId: 'B', address: 'B' }], recipe, { page }),
    enrichSites([{ siteId: 'C', address: 'C' }], recipe, { page }),
  ]);
  for (const site of results.flatMap(r => r.sites)) assert.equal(site.evidence[0].fields.marker, site.siteId);
  assert.equal(overlap, false);
});

test('a failed browser lookup releases the page for the next site', async () => {
  let attempts = 0;
  const page = {
    async goto() { if (++attempts === 1) throw new Error('navigation failed'); return { ok: () => true }; },
    locator() { return { innerText: async () => '{"value":"second"}' }; },
  };
  const provider = { name: 'browser-test', enabled: true, transport: 'http', via: 'browser', requires: ['address'], url: 'https://example.gov', query: {}, extract: { value: { path: 'value', type: 'string' } } };
  const result = await enrichSites([{ siteId: 1, address: 'first' }, { siteId: 2, address: 'second' }], { concurrency: 2, providers: { test: provider } }, { page });
  assert.equal(result.sites[0].evidence[0].status, 'failed');
  assert.equal(result.sites[1].evidence[0].fields.value, 'second');
});

test('the shipped enrichment config only enables providers that were verified', async () => {
  for (const [name, provider] of Object.entries(config.providers)) {
    if (provider.enabled) assert.equal(provider.verified, true, `${name} is enabled but not verified`);
    assert.ok(Array.isArray(provider.resolves) && provider.resolves.length, `${name} must declare what it resolves`);
  }
});

test('templates fill from the target and report the first missing field', () => {
  assert.equal(fillTemplate('{{address}}, {{city}}', { address: '1 Main St', city: 'Columbus' }), '1 Main St, Columbus');
  assert.deepEqual(fillTemplate('{{address}}', {}), { missing: 'address' });
  assert.deepEqual(resolveQuery({ street: '{{address}}' }, {}), { missing: 'address' });
  assert.deepEqual(resolveQuery({ street: '{{address}}', f: 'json' }, { address: '1 Main St' }), { query: { street: '1 Main St', f: 'json' } });
});

test('recipe URLs must be https, credential-free and inside the allowlist', () => {
  assert.ok(assertAllowedUrl('https://example.gov/search', ['example.gov']));
  assert.throws(() => assertAllowedUrl('http://example.gov', ['example.gov']), /https/);
  assert.throws(() => assertAllowedUrl('https://user:pw@example.gov', ['example.gov']), /credentials/);
  assert.throws(() => assertAllowedUrl('https://evil.test', ['example.gov']), /allowlist/);
});

test('extraction reads nested paths and coerces declared types', () => {
  const body = { result: { matches: [{ coords: { y: '38.9' }, name: 'Franklin' }] } };
  assert.equal(readPath(body, 'result.matches.0.coords.y'), '38.9');
  assert.equal(readPath(body, 'result.matches.5.name'), undefined);
  assert.equal(coerce('1,250 sq ft', 'integer'), 1250);
  assert.equal(coerce('38.9', 'number'), 38.9);
  assert.equal(coerce('  Frame  ', 'string'), 'Frame');
  assert.equal(coerce('', 'string'), null);
  assert.equal(coerce('not a number', 'integer'), null);
});

test('a provider is skipped rather than guessed when a required field is absent', () => {
  const provider = config.providers['census-geocode'];
  assert.deepEqual(unmetRequirements(provider, { address: '1 Main St', city: 'Columbus', state: 'OH' }), []);
  assert.deepEqual(unmetRequirements(provider, { address: '1 Main St' }), ['city', 'state']);
});

test('http transport builds an encoded query and maps declared paths', async () => {
  let requested;
  const outcome = await httpTransport(config.providers['census-geocode'],
    { address: '1 Main St & Co', city: 'Columbus', state: 'OH' },
    { fetchImpl: async url => { requested = url; return json({ result: { addressMatches: [{ coordinates: { x: -83, y: 40 }, matchedAddress: '1 MAIN ST', geographies: { Counties: [{ NAME: 'Franklin', GEOID: '39049' }] } }] } }); } });
  assert.match(requested, /street=1\+Main\+St\+%26\+Co/);
  assert.equal(outcome.fields.latitude, 40);
  assert.equal(outcome.fields.countyFips, '39049');
  assert.equal(outcome.fields.county, 'Franklin');
});

test('weather context surfaces a severe alert even if a minor alert was returned first', async () => {
  const outcome = await httpTransport(config.providers['nws-alerts'], { latitude: 40, longitude: -83 }, {
    fetchImpl: async () => json({ features: [
      { properties: { severity: 'Minor', event: 'Minor advisory' } },
      { properties: { severity: 'Severe', event: 'Severe storm warning' } },
    ] }),
  });
  assert.equal(outcome.fields.alertCount, 2);
  assert.equal(outcome.fields.topAlert, 'Severe storm warning');
  assert.equal(outcome.fields.topAlertSeverity, 'Severe');
});

test('arcgis transport refuses to run without coordinates', async () => {
  const direct = { ...config.providers['fema-nfhl'], name: 'fema-nfhl', via: undefined };
  assert.deepEqual(await arcgisTransport(direct, { latitude: null }, { fetchImpl: async () => json({}) }), { skipped: 'missing coordinates' });
  let requested;
  const outcome = await arcgisTransport(direct, { latitude: 40, longitude: -83 },
    { fetchImpl: async url => { requested = url; return json({ features: [{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T' } }] }); } });
  assert.match(requested, /geometry=-83%2C40/);
  assert.equal(outcome.fields.floodZone, 'AE');
});

test('a via:browser provider routes through the session and skips without one', async () => {
  // FEMA's hazard services drop direct server-to-server requests from many networks, so the
  // shipped provider retrieves through Browserbase instead.
  const provider = { ...config.providers['fema-nfhl'], name: 'fema-nfhl' };
  assert.equal(provider.via, 'browser', 'the shipped flood provider must retrieve via the browser');

  const noSession = await arcgisTransport(provider, { latitude: 40, longitude: -83 }, { fetchImpl: async () => json({}) });
  assert.deepEqual(noSession, { skipped: 'no browser session' }, 'without a session it degrades, it does not fall back to a blocked fetch');

  let visited;
  const page = {
    goto: async url => { visited = url; return { ok: () => true, status: () => 200 }; },
    locator: () => ({ innerText: async () => JSON.stringify({ features: [{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T' } }] }) }),
  };
  const outcome = await arcgisTransport(provider, { latitude: 40, longitude: -83 }, { page, fetchImpl: async () => { throw new Error('direct fetch must not be used'); } });
  assert.match(visited, /hazards\.fema\.gov/);
  assert.equal(outcome.fields.floodZone, 'AE');
  assert.equal(outcome.fields.specialFloodHazardArea, 'T');
});

test('browser recipes only run allowlisted actions and skip unknown jurisdictions', async () => {
  const provider = {
    name: 'assessor', transport: 'browser',
    jurisdictions: { 39049: { label: 'Franklin', hostAllowlist: ['portal.test'],
      steps: [{ action: 'goto', url: 'https://portal.test/search' }, { action: 'fill', selector: '#q', value: '{{address}}' }],
      extract: { yearBuilt: { selector: '.year', type: 'integer' } } } },
  };
  assert.match((await browserTransport(provider, { countyFips: '00000' }, {})).skipped, /no recipe/);

  const filled = [];
  const page = {
    goto: async () => ({ ok: () => true }),
    url: () => 'https://portal.test/search',
    locator: selector => ({
      first: () => ({
        fill: async value => filled.push([selector, value]),
        count: async () => 1,
        innerText: async () => '1974',
      }),
    }),
  };
  const outcome = await browserTransport(provider, { countyFips: '39049', address: '1 Main St' }, { page });
  assert.deepEqual(filled, [['#q', '1 Main St']]);
  assert.equal(outcome.fields.yearBuilt, 1974);

  const unsafe = { ...provider, jurisdictions: { 39049: { ...provider.jurisdictions[39049], steps: [{ action: 'evaluate', script: 'x' }] } } };
  await assert.rejects(browserTransport(unsafe, { countyFips: '39049' }, { page }), /unsupported action/);
});

test('a failing provider degrades that lookup instead of aborting the run', async () => {
  const providers = { good: { name: 'good', transport: 'http', enabled: true, resolves: ['site.x'], requires: ['address'], url: 'https://ok.test/a', query: {}, extract: { county: { path: 'county', type: 'string' } } },
    bad: { name: 'bad', transport: 'http', enabled: true, resolves: ['site.y'], requires: ['address'], url: 'https://ok.test/b', query: {}, extract: {} } };
  const result = await enrichSites([{ siteId: 1, address: '1 Main St', submissions: [7] }],
    { ...config, providers, concurrency: 1 },
    { fetchImpl: async url => url.includes('/b') ? new Response('boom', { status: 500 }) : json({ county: 'Franklin' }), now: () => 'T' });
  const [site] = result.sites;
  assert.equal(site.evidence.find(e => e.provider === 'good').status, 'ok');
  const failure = site.evidence.find(e => e.provider === 'bad');
  assert.equal(failure.status, 'failed');
  assert.doesNotMatch(failure.detail, /boom/);
});

test('repeat lookups for the same key reuse the first result', async () => {
  let calls = 0;
  const providers = { geo: { name: 'geo', transport: 'http', enabled: true, resolves: ['site.county'], requires: ['zip'], url: 'https://ok.test/a', query: {}, extract: { county: { path: 'county', type: 'string' } } } };
  const targets = [{ siteId: 1, zip: '43004', submissions: [1] }, { siteId: 2, zip: '43004', submissions: [2] }];
  const result = await enrichSites(targets, { ...config, providers, concurrency: 1 },
    { fetchImpl: async () => { calls++; return json({ county: 'Franklin' }); }, now: () => 'T' });
  assert.equal(calls, 1);
  assert.equal(result.sites[1].evidence[0].cached, true);
});

test('sites are collected once across the submissions that share them', () => {
  const rows = [{ id: 1, sites: [{ id: 10, address: 'A' }] }, { id: 2, sites: [{ id: 10, address: 'A' }, { id: 11, address: 'B' }] }];
  const targets = collectTargets(rows);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.find(t => t.siteId === 10).submissions, [1, 2]);
});

test('external evidence raises tasks but never changes a score', () => {
  const row = {
    id: 1, submissionNumber: 'SUB-1', accountName: 'Example', score: 88, tasks: [],
    sites: [{ id: 10 }], buildings: [{ id: 5, locationId: 10, yearBuilt: 2005, squareFootage: null }],
  };
  const enrichment = { generatedAt: 'T', providerNames: ['assessor', 'fema-nfhl'], sites: [{ siteId: 10, evidence: [
    { provider: 'assessor', status: 'ok', retrievedAt: 'T', reference: 'https://portal.test', fields: { yearBuilt: 1974, squareFootage: 1200 } },
    { provider: 'fema-nfhl', status: 'ok', retrievedAt: 'T', reference: 'https://fema.test', fields: { floodZone: 'AE' } },
  ] }] };
  const [enriched] = applyEnrichment([row], enrichment, config);
  assert.equal(enriched.score, 88, 'external evidence must not move the score');
  assert.equal(enriched.external.verificationStatus, 'unreviewed');

  const conflict = enriched.tasks.find(t => t.status === 'conflict');
  assert.ok(conflict);
  assert.equal(conflict.severity, 'blocking');
  assert.match(conflict.question, /1974.*2005/);

  assert.ok(enriched.tasks.some(t => t.status === 'proposed' && t.external.field === 'squareFootage'));
  const flag = enriched.tasks.find(t => t.status === 'advisory');
  assert.ok(flag, 'an SFHA flood zone must raise an advisory');
  assert.match(flag.question, /Special Flood Hazard Area/);
});

test('keying fields and equivalent county spellings raise no questions', () => {
  const row = {
    id: 1, submissionNumber: 'S', accountName: 'A', score: 70, tasks: [],
    sites: [{ id: 10, county: 'Miami-Dade' }], buildings: [],
  };
  const enrichment = { generatedAt: 'T', providerNames: ['census-geocode'], sites: [{ siteId: 10, evidence: [
    { provider: 'census-geocode', status: 'ok', retrievedAt: 'T', fields: {
      latitude: 25.68, longitude: -80.16, matchedAddress: '425 HARBOR LN', countyFips: '12086',
      county: 'Miami-Dade County',
    } },
  ] }] };
  const [enriched] = applyEnrichment([row], enrichment, config);
  // Coordinates and FIPS are plumbing; the county names agree apart from the suffix.
  assert.deepEqual(enriched.tasks, []);
  assert.equal(enriched.external.conflicts.length, 0);
  assert.equal(enriched.external.proposals.length, 0);
  assert.equal(enriched.external.evidence.length, 1, 'evidence is still recorded for audit');
});

test('an unmatched flood zone raises no advisory', () => {
  const row = { id: 1, submissionNumber: 'S', accountName: 'A', score: 50, tasks: [], sites: [{ id: 10 }], buildings: [] };
  const enrichment = { generatedAt: 'T', providerNames: ['fema-nfhl'], sites: [{ siteId: 10, evidence: [
    { provider: 'fema-nfhl', status: 'ok', retrievedAt: 'T', fields: { floodZone: 'X' } },
  ] }] };
  const [enriched] = applyEnrichment([row], enrichment, config);
  assert.equal(enriched.tasks.filter(t => t.status === 'advisory').length, 0);
});

test('the documented probe script is wired up', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['enrich:probe'], /enrich-probe\.js/);
});
