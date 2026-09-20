import Browserbase from '@browserbasehq/sdk';
import { chromium } from 'playwright-core';
import { collectTargets, enabledProviders, enrichSites, loadEnrichmentConfig } from '../enrichment/runner.js';
import { applyEnrichment } from '../enrichment/apply.js';
import { briefInput, generateBriefs } from './brief.js';

function siteTarget(row) {
  const fromRow = row.sites?.find(site => site.address) ?? row.sites?.[0];
  if (fromRow?.address) return fromRow;
  if (row.demoLocation?.address) return { ...row.demoLocation, id: 'demo', siteId: 'demo', geocodable: true };
  return null;
}

function searchQueryFor(row, site) {
  const state = site.state ?? row.primaryState ?? '';
  const place = [site.address, site.city, state, site.zip].filter(Boolean).join(', ');
  if (state === 'CA') return `${place} FEMA flood zone wildfire risk commercial property`;
  if (state === 'FL') return `${place} FEMA flood zone hurricane storm surge`;
  return `${place} FEMA flood hazard zone`;
}

/** Browserbase Search API — public web hits before the live tab opens. */
export async function browserbaseSearch(query, { apiKey = process.env.BROWSERBASE_API_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error('Set BROWSERBASE_API_KEY in .env.');
  const response = await fetchImpl('https://api.browserbase.com/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-BB-API-Key': apiKey },
    body: JSON.stringify({ query, numResults: 5 }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`Browserbase search failed (${response.status}): ${detail}`);
  }
  const body = await response.json();
  return {
    query,
    results: (body.results ?? []).map(hit => ({
      title: hit.title ?? hit.name ?? 'Result',
      url: hit.url,
      snippet: hit.snippet ?? hit.description ?? '',
    })).filter(hit => hit.url),
  };
}

/**
 * One keep-alive Browserbase session for Investigate: Maps for the live view, same page for FEMA.
 */
export async function openInvestigateSession(site) {
  if (!process.env.BROWSERBASE_API_KEY) throw new Error('Set BROWSERBASE_API_KEY in .env.');
  const client = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
  const projectId = process.env.BROWSERBASE_PROJECT_ID || undefined;
  const session = await client.sessions.create({ projectId, keepAlive: true });
  let browser;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(60_000);
    const query = [site.address, site.city, site.state, site.zip].filter(Boolean).join(', ');
    if (!query) throw new Error('A linked property address is required.');
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const fema = await context.newPage();
    await fema.goto('https://msc.fema.gov/portal/home', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await page.bringToFront().catch(() => {});
    /** @type {any} */
    const debug = await client.sessions.debug(session.id).catch(() => ({}));
    const liveViewUrl = debug.pages?.[0]?.debuggerFullscreenUrl
      || debug.debuggerFullscreenUrl
      || `https://www.browserbase.com/sessions/${session.id}`;
    return {
      page,
      context,
      browser,
      client,
      projectId,
      sessionId: session.id,
      liveViewUrl,
      async release() {
        try { await browser.close(); }
        finally { await client.sessions.update(session.id, { status: 'REQUEST_RELEASE', projectId }).catch(() => {}); }
      },
    };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    await client.sessions.update(session.id, { status: 'REQUEST_RELEASE', projectId }).catch(() => {});
    throw error;
  }
}

/**
 * Live Browserbase investigate path: search → open tab → enrich flood via browser → keep live view.
 * @param {Record<string, any>} row
 */
export async function runBrowserbaseInvestigate(row, {
  search = browserbaseSearch,
  openSession = openInvestigateSession,
  enrich = enrichSites,
  loadConfig = loadEnrichmentConfig,
  apply = applyEnrichment,
  makeBriefs = generateBriefs,
} = {}) {
  const site = siteTarget(row);
  if (!site?.address) {
    return {
      skipped: true,
      reason: 'No linked property address for Browserbase.',
      browserStatus: 'not-needed',
      research: null,
      liveViewUrl: null,
      handle: null,
      search: null,
      steps: [],
    };
  }

  const steps = [];
  const query = searchQueryFor(row, site);
  let searchResult = null;
  try {
    searchResult = await search(query);
    const top = searchResult.results[0];
    steps.push({
      kind: 'bb-search',
      tone: 'neutral',
      message: top
        ? `Browserbase Search: “${query}” → ${top.title}`
        : `Browserbase Search: “${query}” (no strong public hit)`,
    });
  } catch (error) {
    steps.push({
      kind: 'bb-search',
      tone: 'warn',
      message: `Browserbase Search unavailable (${error instanceof Error ? error.message : 'error'}). Continuing with the live tab.`,
    });
  }

  steps.push({
    kind: 'bb-open',
    tone: 'good',
    message: `Opening a live Browserbase tab on Maps + FEMA for ${[site.address, site.city, site.state].filter(Boolean).join(', ')}.`,
  });

  let handle;
  try {
    handle = await openSession(site);
  } catch (error) {
    steps.push({
      kind: 'bb-fail',
      tone: 'warn',
      message: `Browserbase session failed: ${error instanceof Error ? error.message : 'unavailable'}.`,
    });
    return {
      skipped: false,
      browserStatus: 'unavailable',
      research: null,
      liveViewUrl: null,
      handle: null,
      search: searchResult,
      steps,
    };
  }

  const config = await loadConfig();
  const targets = collectTargets([{ ...row, sites: row.sites?.length ? row.sites : [site] }]);
  const needsBrowser = enabledProviders(config).some(p => p.transport === 'browser' || p.via === 'browser');
  let enrichment = { version: 2, generatedAt: new Date().toISOString(), providerNames: [], sites: [] };
  let browserStatus = 'connected';
  try {
    if (needsBrowser || targets.some(t => t.geocodable)) {
      steps.push({
        kind: 'bb-enrich',
        tone: 'neutral',
        message: 'Pulling Census geocode + FEMA flood zone through the Browserbase session (FEMA blocks plain server calls).',
      });
      enrichment = await enrich(targets, config, { page: handle.page });
    }
  } catch {
    browserStatus = 'unavailable';
    steps.push({
      kind: 'bb-enrich',
      tone: 'warn',
      message: 'Enrichment through Browserbase failed. Live tab stays open for manual review.',
    });
  }

  const clean = { ...row, briefs: [], external: null, tasks: (row.tasks ?? []).filter(t => t.factorKey !== 'external') };
  const enriched = apply([clean], enrichment, config)[0];
  let briefs = [];
  let aiStatus = 'not-needed';
  if (row.verdict !== 'not-property' && briefInput(enriched)) {
    try {
      briefs = (await makeBriefs(enriched)).briefs;
      aiStatus = briefs.length ? 'completed' : 'empty';
    } catch { aiStatus = 'unavailable'; }
  }

  const research = {
    version: 2,
    submissionId: String(row.id),
    generatedAt: new Date().toISOString(),
    browserStatus,
    aiStatus,
    briefs,
    uncertainFactors: (row.factors ?? []).filter(f => f.status === 'unknown').map(f => f.label),
    external: enriched.external,
    sites: (enrichment.sites ?? []).map(entry => ({
      siteId: entry.siteId,
      address: [entry.resolved?.address ?? site.address, entry.resolved?.city ?? site.city, entry.resolved?.state ?? site.state].filter(Boolean).join(', '),
      coordinateBasis: entry.evidence?.some(e => e.provider === 'census-geocode' && e.status === 'ok')
        ? 'Census address match' : 'Federato coordinates; address match unconfirmed',
      evidence: entry.evidence ?? [],
    })),
  };

  return {
    skipped: false,
    browserStatus,
    research,
    liveViewUrl: handle.liveViewUrl,
    handle,
    search: searchResult,
    steps,
  };
}
