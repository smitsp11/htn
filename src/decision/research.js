import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { openBrowserbase } from '../browserbase.js';
import { collectTargets, enabledProviders, enrichSites, loadEnrichmentConfig } from '../enrichment/runner.js';
import { applyEnrichment } from '../enrichment/apply.js';
import { briefInput, generateBriefs, needsContext } from './brief.js';

/**
 * Research uses server-held locations, never an arbitrary URL from the browser.
 * @param {Record<string, any>} row
 * @param {{config?: any, openBrowser?: () => Promise<{page: any, release: () => Promise<void>}>, lookup?: typeof enrichSites, makeBriefs?: typeof generateBriefs}} [options]
 */
export async function researchSubmission(row, {
  config = null, openBrowser = openBrowserbase, lookup = enrichSites, makeBriefs = generateBriefs,
} = {}) {
  config ??= await loadEnrichmentConfig();
  let browser;
  let browserStatus = 'not-needed';
  let enrichment;
  const targets = collectTargets([row]);
  try {
    if (targets.some(site => site.geocodable) && enabledProviders(config).some(p => p.transport === 'browser' || p.via === 'browser')) {
      try { browser = await openBrowser(); browserStatus = 'connected'; }
      catch { browserStatus = 'unavailable'; }
    }
    enrichment = await lookup(targets, config, { page: browser?.page });
  } finally {
    if (browser) await browser.release().catch(() => {});
  }
  // Never reuse notes or external flags from a previous research run.
  const clean = { ...row, briefs: [], external: null, tasks: (row.tasks ?? []).filter(t => t.factorKey !== 'external') };
  const enriched = applyEnrichment([clean], enrichment, config)[0];
  let briefs = [];
  let aiStatus = 'not-needed';
  if (row.verdict !== 'not-property' && briefInput(enriched)) {
    try {
      briefs = (await makeBriefs(enriched)).briefs;
      aiStatus = briefs.length ? 'completed' : 'empty';
    } catch { aiStatus = 'unavailable'; }
  }
  return {
    version: 2, submissionId: String(row.id), generatedAt: new Date().toISOString(),
    browserStatus, aiStatus, briefs,
    uncertainFactors: row.factors.filter(f => needsContext(f) && f.status !== 'fail').map(f => f.label),
    external: enriched.external,
    sites: enrichment.sites.map(site => ({
      siteId: site.siteId,
      address: [site.resolved.address, site.resolved.city, site.resolved.state].filter(Boolean).join(', '),
      coordinateBasis: site.evidence.some(e => e.provider === 'census-geocode' && e.status === 'ok')
        ? 'Census address match' : 'Federato coordinates; address match unconfirmed',
      evidence: site.evidence,
    })),
  };
}

/** Report-specific durable cache. Duplicate clicks share a job; recent successes are reused. */
export function createResearchService({ directory = 'artifacts/research', run = researchSubmission, now = Date.now } = {}) {
  const inflight = new Map();
  const keyFor = (report, row) => createHash('sha256').update(JSON.stringify({ version: 4, report: report.generatedAt, row })).digest('hex');
  const read = async (report, row) => {
    try { return JSON.parse(await readFile(join(directory, `${keyFor(report, row)}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  return {
    read,
    async run(report, row, { refresh = false } = {}) {
      const key = keyFor(report, row);
      if (inflight.has(key)) return inflight.get(key);
      const job = (async () => {
        const cached = await read(report, row);
        if (!refresh && cached && now() - Date.parse(cached.generatedAt) < 5 * 60_000 &&
          ['completed', 'not-needed'].includes(cached.aiStatus) && cached.browserStatus !== 'unavailable' &&
          !cached.sites.some(site => site.evidence.some(e => e.status === 'failed'))) return cached;
        const result = await run(row);
        await mkdir(directory, { recursive: true });
        const file = join(directory, `${key}.json`);
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(result, null, 2));
        await rename(temporary, file);
        return result;
      })();
      inflight.set(key, job);
      try { return await job; } finally { inflight.delete(key); }
    },
  };
}
