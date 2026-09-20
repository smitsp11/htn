import assert from 'node:assert/strict';
import { withBrowserbase, reportError } from '../src/browserbase.js';

try {
  const result = await withBrowserbase(async ({ page, session }) => {
    const response = await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    assert.equal(await page.title(), 'Example Domain');
    assert.equal(await page.evaluate(() => 2 + 2), 4);
    return { sessionId: session.id, title: await page.title(), javascript: 'passed' };
  });
  console.log(JSON.stringify({ ok: true, ...result, released: true }, null, 2));
} catch (error) {
  reportError(error);
}
