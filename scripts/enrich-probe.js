import { parseArgs } from 'node:util';
import { loadEnrichmentConfig } from '../src/enrichment/runner.js';
import { TRANSPORTS } from '../src/enrichment/transports.js';
import { unmetRequirements } from '../src/enrichment/recipe.js';
import { openBrowserbase } from '../src/browserbase.js';

// Exercises one provider against one address and prints exactly what it extracted, so a recipe
// can be confirmed before it is enabled for the whole queue.
let handle;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      address: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' },
      zip: { type: 'string' }, county: { type: 'string' }, countyFips: { type: 'string' },
      latitude: { type: 'string' }, longitude: { type: 'string' },
    },
  });
  const name = positionals[0];
  const config = await loadEnrichmentConfig();
  if (!name || !config.providers[name]) {
    throw new Error(`Usage: npm run enrich:probe -- <provider> --address "..." --city "..." --state XX\nProviders: ${Object.keys(config.providers).join(', ')}`);
  }
  const provider = config.providers[name];
  const target = {
    ...values,
    latitude: values.latitude ? Number(values.latitude) : undefined,
    longitude: values.longitude ? Number(values.longitude) : undefined,
  };
  for (const key of Object.keys(target)) if (target[key] === undefined) delete target[key];

  const unmet = unmetRequirements(provider, target);
  if (unmet.length) throw new Error(`Provider ${name} requires: ${unmet.join(', ')}.`);
  if (provider.transport === 'browser' || provider.via === 'browser') handle = await openBrowserbase();

  console.log(`Probing ${name} (${provider.transport}${provider.via === 'browser' ? ' via Browserbase' : ''}, enabled=${provider.enabled}, verified=${provider.verified})`);
  const outcome = await TRANSPORTS[provider.transport](provider, target, {
    fetchImpl: globalThis.fetch, page: handle?.page, signal: AbortSignal.timeout(config.timeoutMs ?? 45_000),
  });
  if (outcome.skipped) {
    console.log(`Skipped: ${outcome.skipped}`);
  } else {
    const populated = Object.entries(outcome.fields ?? {}).filter(([, v]) => v != null);
    console.log(`Source: ${outcome.reference}`);
    console.log(`Extracted ${populated.length}/${Object.keys(outcome.fields ?? {}).length} declared fields:`);
    console.log(JSON.stringify(outcome.fields, null, 2));
    console.log(populated.length
      ? `\nRecipe works. Set providers.${name}.enabled and .verified to true in config/enrichment.json to use it for the queue.`
      : `\nRecipe reached the source but extracted nothing. Check the selectors or paths in config/enrichment.json.`);
  }
} catch (error) {
  const safe = /^(Usage:|Provider |Recipe |Set BROWSERBASE_)/.test(String(error.message));
  console.error(safe ? error.message : `Probe failed (${error.name}: ${error.message}). Check the provider definition, network access, and the address supplied.`);
  process.exitCode = 1;
} finally {
  if (handle) await handle.release().catch(() => {});
}
