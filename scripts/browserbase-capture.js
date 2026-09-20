import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowserbase, reportError } from '../src/browserbase.js';

try {
  const input = process.argv[2];
  if (!input) throw new Error('URL required');
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Provide an HTTP(S) URL without credentials');
  }
  const evidence = await withBrowserbase(async ({ page, session }) => {
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new Error('Target returned an unsuccessful response');
    await page.locator('body').waitFor({ state: 'visible' });
    return {
      requestedUrl: url.href,
      sourceUrl: page.url(),
      retrievedAt: new Date().toISOString(),
      title: await page.title(),
      text: await page.locator('body').innerText(),
      links: await page.locator('a[href]').evaluateAll(elements =>
        elements.map(a => ({ text: a.innerText, url: a.href }))
          .filter(a => /^https?:/.test(a.url))),
      sessionId: session.id,
      verificationStatus: 'unreviewed',
    };
  });
  await mkdir('artifacts', { recursive: true });
  const path = `artifacts/evidence-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(evidence, null, 2));
  console.log(`Saved page evidence to ${path}`);
} catch (error) {
  if (!process.argv[2]) console.error('Usage: npm run browserbase:capture -- https://example.com');
  reportError(error);
}
