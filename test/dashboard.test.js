import { reviewedReport, confirmEvidence } from '../src/decision/intake.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSubmissions } from '../src/decision/normalize.js';
import { rankSubmissions } from '../src/decision/scoring.js';
import { applyEscalations, aggregateTasks, queueSummary } from '../src/decision/escalation.js';
import { buildCasefiles } from '../src/decision/casefile.js';
import { htmlReport } from '../src/decision/report.js';
import { researchPanel } from '../src/decision/research-panel.js';
import { applyAction, validateCaseAction } from '../src/decision/store.js';

const rules = JSON.parse(await readFile(new URL('../config/appetite.json', import.meta.url), 'utf8'));

/**
 * Two accounts: one clean and in appetite, one that needs loss runs. Enough to exercise every
 * lane, the case file panels and the chase list in a real browser.
 */
function dataset() {
  return {
    Submission: [
      { id: 1, submission_number: 'SUB-CLEAN', insured: 1, broker: 9, line_of_business: 'property', status: 'received', target_effective_date: '2025-01-01' },
      { id: 2, submission_number: 'SUB-GAP', insured: 2, broker: 9, line_of_business: 'property', status: 'received', target_effective_date: '2025-01-01' },
      { id: 3, submission_number: 'SUB-CYBER', insured: 2, broker: 9, line_of_business: 'cyber', status: 'received' },
    ],
    Insured: [
      { id: 1, name: 'Clean Account LLC', naics_code: '452319' },
      { id: 2, name: '<img src=x onerror=alert(1)>', naics_code: '452319' },
    ],
    Policy: [
      // The rated policy must incept on the submission's target date; the prior policy is what
      // actually evidences the five preceding years, which is why account 1 can reach appetite.
      { id: 100, submission: null, insured: 1, business_type: 'new', line_of_business: 'property', status: 'expired', premium: 80000, currency: 'USD', dates: { effective: '2020-01-01', expiration: '2025-01-01' }, exposure_units: [1], claims: [] },
      { id: 101, submission: 1, insured: 1, business_type: 'new', line_of_business: 'property', status: 'active', premium: 85000, currency: 'USD', dates: { effective: '2025-01-01', expiration: '2026-01-01' }, exposure_units: [1], claims: [] },
      { id: 102, submission: 2, insured: 2, business_type: 'new', line_of_business: 'property', status: 'active', premium: 85000, currency: 'USD', dates: { effective: '2025-01-01', expiration: '2026-01-01' }, exposure_units: [2], claims: [201] },
    ],
    ExposureUnit: [{ id: 1, kind: 'location', location: 11 }, { id: 2, kind: 'location', location: 12 }],
    Location: [
      { id: 11, state: 'OH', city: 'Columbus', address: '1 Main St', buildings: [301] },
      { id: 12, state: 'OH', city: 'Akron', address: '2 Elm Rd', buildings: [302] },
    ],
    Building: [
      { id: 301, tiv: 75e6, year_built: 2015, construction_type: 'Joisted Masonry', sprinklered: true },
      { id: 302, tiv: 75e6, year_built: 2015, construction_type: 'Fire Resistive', sprinklered: true },
    ],
    Claim: [{ id: 201, policy: 102, date_of_loss: '2024-06-01', cause_of_loss: 'hail', status: 'open', paid_indemnity: 5000, paid_expense: 0, reserve_indemnity: 1000, reserve_expense: 0 }],
    Broker: [{ id: 9, name: 'Northline Brokers', tier: 'A', region: 'Midwest' }],
    Underwriter: [],
  };
}

function buildReport() {
  const data = dataset();
  const rows = buildCasefiles(applyEscalations(rankSubmissions(normalizeSubmissions(data, rules), rules), rules), data, rules);
  return {
    generatedAt: '2025-01-01T00:00:00.000Z', mode: 'test', fetchedAt: '2025-01-01T00:00:00.000Z',
    rules, resourceCounts: { Submission: 3 }, enrichment: null,
    summary: queueSummary(rows), taskGroups: aggregateTasks(rows), rows,
  };
}

/** Playwright is present for Browserbase; a local browser binary may not be. */
async function launch() {
  try {
    const { chromium } = await import('playwright-core');
    return await chromium.launch();
  } catch {
    return null;
  }
}

const browser = await launch();
const describe = browser ? test : test.skip;

test('the report renders both lanes, escapes untrusted names, and carries the case file', () => {
  const report = buildReport();
  const html = htmlReport(report);
  assert.deepEqual(report.summary.lanes, { 'work-now': 1, 'chase-evidence': 1, declined: 0, 'not-property': 1 });
  assert.ok(!html.includes('<img src=x'), 'account names must never reach the page unescaped');
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('Account relationship'));
  assert.ok(html.includes('Property exposure'));
});

describe('the dashboard drives in a real browser with no console errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'federanorth-ui-'));
  const file = join(directory, 'dashboard.html');
  await writeFile(file, htmlReport(buildReport()));

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  try {
    await page.goto(pathToFileURL(file).href);
    await page.waitForTimeout(300);

    // Default view: property submissions only, sorted by review priority.
    assert.equal(await page.locator('#sort').inputValue(), 'priority');
    assert.match(await page.locator('#visible-count').innerText(), /of 2 submissions/);

    // Lane tabs filter the queue.
    await page.locator('.tab[data-tab="chase-evidence"]').click();
    await page.waitForTimeout(200);
    assert.match(await page.locator('#visible-count').innerText(), /of 1 submissions/);

    // The case file opens and leads with signals, then the requests.
    await page.locator('.row:not([hidden]) .account-link').first().click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#record-dialog[open]').count(), 1);
    // The case takes the whole screen; a 430px rail is not a case view.
    const width = await page.locator('#record-dialog').evaluate(el => el.getBoundingClientRect().width);
    assert.ok(width >= 1400, `case view should fill the viewport, got ${width}px`);
    assert.equal(await page.locator('#record-dialog .case-side .workflow').count(), 1, 'the decision stays beside the evidence');
    // The case opens on the workflow, then context, then the request.
    assert.match(await page.locator('[data-review-progress]').innerText(), /0 of .* review actions closed/);
    assert.equal(await page.locator('#record-dialog [data-decide-form]').isHidden(), false, 'an undecided case shows the decision form');

    const headings = await page.locator('#record-dialog .section-title h3').evaluateAll(els => els.map(e => e.textContent.trim()));
    assert.ok(headings.includes('Your decision'));
    assert.ok(headings.includes('Pricing'));
    assert.ok(headings.includes('Underwriting signals'));
    assert.ok(headings.includes('Review actions'));
    assert.ok(headings.includes('Account loss history'));
    assert.match(await page.locator('#record-dialog .task p').first().innerText(), /loss runs/);
    assert.ok(await page.locator('#record-dialog .conf').count() >= 8, 'every factor carries a confidence chip');

    // The chase list groups requests by party and then by account.
    await page.locator('#record-dialog [data-close-case]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-open-chase]').first().click();
    await page.waitForTimeout(250);
    const parties = await page.locator('.chase-group h3').evaluateAll(els => els.map(e => e.textContent.trim()));
    assert.ok(parties.length > 0);
    assert.ok(await page.locator('.chase-group li ol li').count() > 0, 'requests are nested under their account');

    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

describe('uncertain cases research automatically, show partial failures, and can retry', async () => {
  const report = buildReport();
  const row = report.rows.find(r => r.id === 2);
  const page = await browser.newPage();
  let posts = 0;
  let cached = null;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://federanorth.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/state') return route.fulfill({ json: { records: {} } });
    if (url.pathname !== '/api/research') return route.fulfill({ contentType: 'text/html', body: htmlReport(report) });
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      assert.equal(input.submissionId, '2');
      assert.equal(input.reportVersion, report.generatedAt);
      posts++;
      await new Promise(resolve => setTimeout(resolve, 100));
      cached = { generatedAt: new Date().toISOString(), aiStatus: posts === 1 ? 'unavailable' : 'completed', browserStatus: 'connected', sites: [],
        briefs: posts === 1 ? [] : [{ factorKey: 'losses', reading: 'Verify the missing loss period.', watchFor: 'Complete loss runs', basedOn: [], model: 'test-model', generatedAt: new Date().toISOString() }] };
    }
    return route.fulfill({ json: { result: cached, html: cached ? researchPanel(row, report.generatedAt, cached) : null } });
  });
  try {
    await page.goto('http://federanorth.test');
    await page.locator('#search').fill('SUB-GAP');
    await page.locator('.row:not([hidden]) .account-link').click();
    await page.getByText('AI context is unavailable.', { exact: false }).waitFor();
    assert.equal(posts, 1);
    await page.locator('[data-run-research]').click();
    await page.locator('.ai-note summary').click();
    await page.getByText('Verify the missing loss period.', { exact: true }).waitFor();
    assert.equal(posts, 2);
    await page.locator('[data-close-case]').click();
    await page.locator('.row:not([hidden]) .account-link').click();
    await page.locator('.ai-note summary').click();
    await page.getByText('Verify the missing loss period.', { exact: true }).waitFor();
    assert.equal(posts, 2, 'reopening uses the saved result, not another paid lookup');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

describe('property and account context stay distinct; requests and decisions survive revisiting', async () => {
  const report = buildReport();
  const row = report.rows.find(r => r.id === 2);
  row.casefile.lossExperience.claims.push({ id: 999, line: 'auto', dateOfLoss: '2024-06-01', cause: 'collision', incurred: 98765 });
  const store = { version: 1, records: {} };
  const page = await browser.newPage();
  const errors = [];
  let rejectDecision = true;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://review.test/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/state') {
      if (request.method() === 'GET') return route.fulfill({ json: store });
      const action = request.postDataJSON();
      if (action.type === 'decision' && rejectDecision) return route.fulfill({ status: 400, json: { error: 'Test save rejected. Please retry.' } });
      const error = validateCaseAction(action, store, report);
      if (error) return route.fulfill({ status: 400, json: { error } });
      return route.fulfill({ json: { record: applyAction(store, action) } });
    }
    if (url.pathname === '/api/research') {
      const result = { generatedAt: new Date().toISOString(), sites: [], aiStatus: 'not-needed' };
      return route.fulfill({ json: { result, html: researchPanel(row, report.generatedAt, result) } });
    }
    return route.fulfill({ contentType: 'text/html', body: htmlReport(report) });
  });
  try {
    await page.goto('http://review.test');
    assert.match(await page.locator('#visible-count').innerText(), /of 2 submissions/);
    await page.locator('[data-scope="other"]').click();
    assert.match(await page.locator('#visible-count').innerText(), /of 1 submissions/);
    assert.equal(await page.locator('.row:not([hidden])').getAttribute('data-score'), '');
    await page.locator('.row:not([hidden]) .account-link').click();
    assert.equal(await page.locator('#record-content [data-workflow]').count(), 0);
    assert.equal(await page.locator('#record-content [data-research]').count(), 0);
    assert.match(await page.locator('#record-content').innerText(), /Not scored/);
    await page.locator('[data-close-case]').click();
    await page.locator('[data-scope="property"]').click();
    await page.locator('#search').fill('SUB-GAP');
    await page.locator('.row:not([hidden]) .account-link').click();
    await page.locator('[data-case-tab="property"]').click();
    assert.match(await page.locator('[data-case-panel="property"]').innerText(), /Property loss evidence/);
    assert.ok(!(await page.locator('[data-case-panel="property"]').innerText()).includes('98,765'));
    await page.locator('[data-case-tab="account"]').click();
    assert.match(await page.locator('[data-case-panel="account"]').innerText(), /98,765/);
    await page.locator('[data-case-tab="review"]').click();
    await page.locator('[data-request-draft]>summary').click();
    assert.match(await page.locator('[data-request-text]').inputValue(), /loss runs/i);
    const answer = page.locator('.task[data-requestable="true"] [data-set-state="answered"]').first();
    await answer.click();
    await page.waitForFunction(() => /** @type {HTMLTextAreaElement} */ (document.querySelector('[data-request-text]')).value === '');
    await answer.click();
    await page.waitForFunction(() => /** @type {HTMLTextAreaElement} */ (document.querySelector('[data-request-text]')).value.includes('loss runs'));
    assert.equal(await page.locator('[data-pricing]').isHidden(), true);
    await page.locator('[data-decision="approve"]').click();
    assert.equal(await page.locator('[data-pricing]').isHidden(), false);
    await page.locator('[data-decision="decline"]').click();
    assert.equal(await page.locator('[data-pricing]').isHidden(), true);
    await page.locator('[data-rationale]').fill('Incomplete property loss records; declining pending further review.');
    await page.locator('[data-decided-by]').fill('Case Reviewer');
    await page.locator('[data-save-decision]').click();
    await page.getByText('Test save rejected. Please retry.').waitFor();
    assert.equal(await page.locator('[data-decided]').isHidden(), true, 'failed saves must not look recorded');
    rejectDecision = false;
    await page.locator('[data-save-decision]').click();
    await page.locator('[data-decided]:visible').waitFor();
    await page.locator('[data-close-case]').click();
    assert.match(await page.locator('.row:not([hidden]) [data-queue-next]').innerText(), /Decline/);
    await page.reload();
    await page.locator('#search').fill('SUB-GAP');
    await page.locator('.row:not([hidden]) .account-link').click();
    await page.locator('[data-decided]:visible').waitFor();
    assert.match(await page.locator('[data-decided-meta]').innerText(), /Case Reviewer/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});


test('evidence intake requires selection, preserves citations, and refreshes the ranked case after confirmation', async () => {
  const report = buildReport(), store = { records: {} };
  const row = report.rows.find(r => r.id === 2);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let extractionCount = 0;
  await page.route('http://federanorth.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/state') return route.fulfill({ json: store });
    if (path === '/api/research') return route.fulfill({ json: { result: null, html: null } });
    if (path === '/api/evidence') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { draft: store.records['2']?.evidenceDraft ?? null } });
      const input = route.request().postDataJSON();
      if (input.action === 'extract') {
        extractionCount++;
        assert.equal(input.source, 'Demo broker response');
        const draft = { id:'demo',reportVersion:report.generatedAt,revision:0,source:input.source,sourceDate:input.sourceDate,text:input.text,model:'test',facts:[{id:'premium-change',field:'premium',value:'250000',buildingId:'',quote:'Total quoted premium USD 250000.',previousValue:85000,conflict:true}] };
        store.records['2'] = { requests:{},decision:null,evidenceDraft:draft };
        return route.fulfill({ json: { draft } });
      }
      try {
        const record=store.records['2'];
        const event=confirmEvidence(record,row,rules,record.evidenceDraft,input.factIds,input.confirmedBy,input.rationale,report.generatedAt);
        return route.fulfill({ json: { event } });
      } catch(error) { return route.fulfill({status:400,json:{error:error.message}}); }
    }
    return route.fulfill({contentType:'text/html',body:htmlReport(reviewedReport(report,store))});
  });
  try {
    await page.goto('http://federanorth.test');
    await page.locator('#search').fill('SUB-GAP');
    await page.locator('.row:not([hidden]) .account-link').click();
    await page.locator('[data-evidence-intake] > details > summary').first().click();
    await page.locator('[data-evidence-source]').fill('Demo broker response');
    await page.locator('[data-evidence-date]').fill('2024-12-01');
    await page.locator('[data-evidence-text]').fill('SUB-GAP: Total quoted premium USD 250000.');
    await page.locator('[data-extract-evidence]').click();
    await page.locator('[data-evidence-fact]').waitFor();
    assert.equal(await page.locator('[data-evidence-fact]').isChecked(),false);
    assert.match(await page.locator('[data-evidence-proposals]').innerText(),/Conflicts with an existing value/);
    assert.equal(store.records['2'].evidenceHistory,undefined);
    await page.locator('[data-evidence-author]').fill('Reviewer');
    await page.locator('[data-evidence-rationale]').fill('Confirmed revised premium against broker quote for this submission.');
    await page.locator('[data-confirm-evidence]').click();
    await page.getByText('Select valid proposed facts to confirm.').waitFor();
    await page.locator('[data-evidence-fact]').check();
    await page.locator('[data-confirm-evidence]').click();
    await page.locator('.evidence-history').waitFor();
    assert.match(await page.locator('.evidence-history').innerText(),/OUT_OF_APPETITE/);
    assert.equal(store.records['2'].evidenceHistory.length,1);
    assert.equal(extractionCount,1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});

test.after(async () => { if (browser) await browser.close(); });
