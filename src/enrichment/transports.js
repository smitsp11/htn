import { assertAllowedUrl, extractFields, readPath, resolveQuery, fillTemplate } from './recipe.js';

const BROWSER_ACTIONS = new Set(['goto', 'fill', 'click', 'waitFor', 'select', 'press']);

/**
 * Retrieve a URL, optionally through the cloud browser.
 *
 * Some public sources refuse or drop direct server-to-server requests while serving a real
 * browser normally — FEMA's hazard services behave this way from many networks. A provider can
 * set `"via": "browser"` to route its request through the Browserbase session instead, which is
 * the difference between having flood-zone data and not having it.
 */
async function retrieveJson(url, provider, { fetchImpl, signal, page }) {
  if (provider.via === 'browser') {
    if (!page) return { unavailable: 'no browser session' };
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new Error(`${provider.name} responded HTTP ${response?.status()}.`);
    const text = await page.locator('body').innerText();
    try { return { body: JSON.parse(text) }; } catch { throw new Error(`${provider.name} returned a non-JSON body.`); }
  }
  const response = await fetchImpl(url.href, {
    redirect: 'follow', signal,
    headers: { Accept: 'application/json', ...(provider.headers ?? {}) },
  });
  return { body: await readJson(response, provider.name) };
}


async function readJson(response, provider) {
  if (!response.ok) throw new Error(`${provider} responded HTTP ${response.status}.`);
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`${provider} returned a non-JSON body.`); }
}

export async function httpTransport(provider, target, { fetchImpl, signal = undefined, page = null }) {
  const resolved = resolveQuery(provider.query, target);
  if (resolved.missing) return { skipped: `missing ${resolved.missing}` };
  // Some services take their parameters in the path rather than the query string.
  const filled = fillTemplate(provider.url, target);
  if (filled && typeof filled === 'object') return { skipped: `missing ${filled.missing}` };
  const url = assertAllowedUrl(filled, provider.hostAllowlist);
  for (const [key, value] of Object.entries(resolved.query)) url.searchParams.set(key, value);
  const retrieved = await retrieveJson(url, provider, { fetchImpl, signal, page });
  if (retrieved.unavailable) return { skipped: retrieved.unavailable };
  // Keep all alerts in the count while presenting the most severe one first.
  if (provider.featurePriority && Array.isArray(retrieved.body.features)) {
    const priority = provider.featurePriority;
    const rank = feature => {
      const index = priority.values.indexOf(readPath(feature, priority.path));
      return index < 0 ? priority.values.length : index;
    };
    retrieved.body.features = [...retrieved.body.features].sort((a, b) => rank(a) - rank(b));
  }
  return { fields: extractFields(retrieved.body, provider.extract, (source, definition) => readPath(source, definition.path)), reference: url.href };
}

/** ArcGIS point-intersection query: the standard shape every public Esri feature service accepts. */
export async function arcgisTransport(provider, target, { fetchImpl, signal = undefined, page = null }) {
  const x = target[provider.geometryFrom?.x ?? 'longitude'];
  const y = target[provider.geometryFrom?.y ?? 'latitude'];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { skipped: 'missing coordinates' };
  const url = assertAllowedUrl(provider.url, provider.hostAllowlist);
  const params = {
    geometry: `${x},${y}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: (provider.outFields ?? ['*']).join(','),
    returnGeometry: 'false', f: 'json',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const retrieved = await retrieveJson(url, provider, { fetchImpl, signal, page });
  if (retrieved.unavailable) return { skipped: retrieved.unavailable };
  if (retrieved.body.error) throw new Error(`${provider.name} service error.`);
  return { fields: extractFields(retrieved.body, provider.extract, (source, definition) => readPath(source, definition.path)), reference: url.href };
}

/**
 * Executes a declarative portal recipe on an existing Browserbase page. Selectors come only
 * from the recipe; record data is passed to Playwright's `fill`, which treats it as literal text.
 */
export async function browserTransport(provider, target, { page = null }) {
  const jurisdiction = provider.jurisdictions?.[target.countyFips]
    ?? provider.jurisdictions?.[`_example_${target.countyFips}`];
  if (!jurisdiction) return { skipped: `no recipe for county ${target.countyFips ?? 'unknown'}` };
  let reference = null;
  for (const step of jurisdiction.steps ?? []) {
    if (!BROWSER_ACTIONS.has(step.action)) throw new Error(`Recipe uses unsupported action ${step.action}.`);
    if (step.action === 'goto') {
      const url = assertAllowedUrl(fillTemplate(step.url, target), jurisdiction.hostAllowlist);
      const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      if (!response?.ok()) throw new Error('Portal returned an unsuccessful response.');
      reference = page.url();
      continue;
    }
    const locator = page.locator(step.selector).first();
    if (step.action === 'fill') {
      const value = fillTemplate(step.value, target);
      if (value && typeof value === 'object') return { skipped: `missing ${value.missing}` };
      await locator.fill(value);
    } else if (step.action === 'click') await locator.click();
    else if (step.action === 'waitFor') await locator.waitFor({ state: 'visible' });
    else if (step.action === 'select') await locator.selectOption(fillTemplate(step.value, target));
    else if (step.action === 'press') await locator.press(step.key ?? 'Enter');
  }
  const spec = jurisdiction.extract ?? provider.extract;
  const texts = {};
  for (const [name, definition] of Object.entries(spec ?? {})) {
    const locator = page.locator(definition.selector).first();
    texts[name] = await locator.count() ? (await locator.innerText()).trim() : null;
  }
  return {
    fields: extractFields(texts, spec, (source, _definition, name) => source[name]),
    reference: reference ?? page.url(),
    jurisdiction: jurisdiction.label ?? target.countyFips,
  };
}

export const TRANSPORTS = { http: httpTransport, arcgis: arcgisTransport, browser: browserTransport };
