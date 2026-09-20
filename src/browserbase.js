import Browserbase from '@browserbasehq/sdk';
import { chromium } from 'playwright-core';

/**
 * Opens one cloud browser session and returns it with an explicit release function.
 * Batch work should open a single session and reuse the page across targets; a session per
 * lookup is the dominant cost and latency in an enrichment run.
 */
export async function openBrowserbase() {
  if (!process.env.BROWSERBASE_API_KEY) throw new Error('Set BROWSERBASE_API_KEY in .env.');
  const client = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
  const projectId = process.env.BROWSERBASE_PROJECT_ID || undefined;
  // This SDK exposes no session-lifetime field on create; releasing in `finally` is the
  // actual control we have over how long a cloud session stays open.
  const session = await client.sessions.create({ projectId, keepAlive: false });
  let browser;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(60_000);
    return {
      page, context, session,
      async release() {
        try {
          await browser.close();
        } finally {
          await client.sessions.update(session.id, { status: 'REQUEST_RELEASE', projectId });
        }
      },
    };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    await client.sessions.update(session.id, { status: 'REQUEST_RELEASE', projectId }).catch(() => {});
    throw error;
  }
}

/** Run browser work and release the cloud session even when navigation fails. */
export async function withBrowserbase(callback) {
  const handle = await openBrowserbase();
  try {
    return await callback(handle);
  } finally {
    await handle.release();
  }
}

/**
 * Open a short lived, read-only research view for an underwriter. The session is intentionally
 * kept alive so the returned Browserbase live-view URL can be opened in a second tab. The server
 * owns the session and releases it after the caller's TTL rather than exposing a CDP URL.
 */
/** @param {{address?: string, city?: string, state?: string, zip?: string}} [target] */
export async function openResearchView({ address, city, state, zip } = /** @type {any} */ ({})) {
  if (!process.env.BROWSERBASE_API_KEY) throw new Error('Set BROWSERBASE_API_KEY in .env.');
  const client = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
  const projectId = process.env.BROWSERBASE_PROJECT_ID || undefined;
  const session = await client.sessions.create({ projectId, keepAlive: true });
  let browser;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    const query = [address, city, state, zip].filter(Boolean).join(', ');
    if (!query) throw new Error('A linked property address is required.');
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const fema = await context.newPage();
    await fema.goto('https://msc.fema.gov/portal/home', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    /** @type {any} */
    const debug = await client.sessions.debug(session.id).catch(() => ({}));
    const liveViewUrl = debug.pages?.[0]?.debuggerFullscreenUrl || debug.debuggerFullscreenUrl || `https://www.browserbase.com/sessions/${session.id}`;
    return { sessionId: session.id, liveViewUrl, browser, client, projectId };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    await client.sessions.update(session.id, { status: 'REQUEST_RELEASE', projectId }).catch(() => {});
    throw error;
  }
}

// Avoid logging SDK errors containing request headers or signed connection URLs.
export function reportError(error) {
  console.error(`Browserbase operation failed (${error?.name ?? 'Error'}${error?.status ? `, HTTP ${error.status}` : ''}). Check configuration, account limits, and the target URL.`);
  process.exitCode = 1;
}
