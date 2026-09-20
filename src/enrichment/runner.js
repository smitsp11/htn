import { readFile } from 'node:fs/promises';
import { TRANSPORTS } from './transports.js';
import { unmetRequirements } from './recipe.js';

// A navigation and its extraction must be one transaction. HTTP lookups may run in
// parallel, but two sites must never navigate the same Browserbase page together.
const pageQueues = new WeakMap();
function onPage(page, task) {
  const previous = pageQueues.get(page) ?? Promise.resolve();
  const next = previous.then(task, task);
  pageQueues.set(page, next.catch(() => {}));
  return next;
}

export async function loadEnrichmentConfig(path = new URL('../../config/enrichment.json', import.meta.url)) {
  const config = JSON.parse(await readFile(path, 'utf8'));
  for (const [name, provider] of Object.entries(config.providers)) {
    provider.name = name;
    if (!TRANSPORTS[provider.transport]) throw new Error(`Provider ${name} uses unknown transport ${provider.transport}.`);
  }
  return config;
}

export const enabledProviders = config => Object.values(config.providers).filter(p => p.enabled);

/** Distinct physical places across the queue; enrichment is per-site, not per-submission. */
export function collectTargets(rows) {
  const targets = new Map();
  for (const row of rows) {
    for (const site of row.sites ?? []) {
      const key = String(site.id);
      if (!targets.has(key)) targets.set(key, { ...site, siteId: site.id, submissions: [] });
      targets.get(key).submissions.push(row.id);
    }
  }
  return [...targets.values()];
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

/**
 * Runs every enabled provider over every site. Providers are chained in declaration order so
 * later ones can key on earlier output (geocoding feeds the geographic lookups).
 * A provider failure degrades that one field to unavailable; it never aborts the run.
 */
export async function enrichSites(targets, config, { fetchImpl = globalThis.fetch, page = null, now = () => new Date().toISOString() } = {}) {
  const providers = enabledProviders(config);
  const cache = new Map();
  const results = await pool(targets, config.concurrency ?? 3, async target => {
    const working = { ...target };
    const evidence = [];
    for (const provider of providers) {
      if ((provider.transport === 'browser' || provider.via === 'browser') && !page) {
        evidence.push({ provider: provider.name, status: 'skipped', detail: 'no browser session', retrievedAt: now() });
        continue;
      }
      const unmet = unmetRequirements(provider, working);
      if (unmet.length) {
        evidence.push({ provider: provider.name, status: 'skipped', detail: `missing ${unmet.join(', ')}`, retrievedAt: now() });
        continue;
      }
      const cacheKey = `${provider.name}|${(provider.requires ?? []).map(k => working[k]).join('|')}`;
      if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        Object.assign(working, cached.fields ?? {});
        evidence.push({ ...cached, cached: true });
        continue;
      }
      const record = { provider: provider.name, retrievedAt: now(), resolves: provider.resolves ?? [] };
      try {
        const lookup = () => TRANSPORTS[provider.transport](provider, working, {
          fetchImpl, page, signal: AbortSignal.timeout(config.timeoutMs ?? 45_000),
        });
        const outcome = provider.transport === 'browser' || provider.via === 'browser'
          ? await onPage(page, lookup) : await lookup();
        if (outcome.skipped) Object.assign(record, { status: 'skipped', detail: outcome.skipped });
        else {
          const fields = Object.fromEntries(Object.entries(outcome.fields ?? {}).filter(([, v]) => v != null));
          Object.assign(working, fields);
          Object.assign(record, {
            status: Object.keys(fields).length ? 'ok' : 'empty',
            fields, reference: outcome.reference, jurisdiction: outcome.jurisdiction,
            verificationStatus: 'unreviewed',
          });
        }
      } catch (error) {
        // Never surface remote bodies or signed URLs; enrichment failure is not a run failure.
        Object.assign(record, { status: 'failed', detail: `${provider.name} lookup failed (${error.name}).` });
      }
      cache.set(cacheKey, record);
      evidence.push(record);
    }
    return { siteId: target.siteId, submissions: target.submissions, resolved: working, evidence };
  });
  return { version: 2, generatedAt: now(), providerNames: providers.map(p => p.name), sites: results };
}
