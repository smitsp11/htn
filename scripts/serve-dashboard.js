import { randomUUID } from 'node:crypto';
import { htmlReport, caseTemplate } from '../src/decision/dashboard.js';
import { assertEvidenceCase, extractEvidence, currentValue, confirmEvidence, reviewedReport, reviewedRow } from '../src/decision/intake.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { applyAction, loadStore, saveStore, validateCaseAction } from '../src/decision/store.js';
import { loadEnvFile } from 'node:process';
import { createResearchService } from '../src/decision/research.js';
import { researchPanel } from '../src/decision/research-panel.js';
import { openResearchView } from '../src/browserbase.js';
import { demoLocationFor, demoScenarioFor } from '../src/decision/demo-locations.js';
import { isHistoricalCase } from '../src/decision/review.js';

try { loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const research = createResearchService();
let researchQueue = Promise.resolve();
const researchJobs = new Map();
const liveResearchSessions = new Map();

const port = Number(process.env.DASHBOARD_PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('DASHBOARD_PORT must be an integer between 1 and 65535.');
}
const dashboard = new URL('../artifacts/dashboard.html', import.meta.url);
const STATE_PATH = 'artifacts/underwriting-state.json';
const MAX_BODY = 64 * 1024;

function releaseLiveResearch(id) {
  const handle = liveResearchSessions.get(id);
  if (!handle) return;
  liveResearchSessions.delete(id);
  void handle.browser.close().catch(() => {}).then(() =>
    handle.client.sessions.update(id, { status: 'REQUEST_RELEASE', projectId: handle.projectId }).catch(() => {}));
}

// One writer, serialized: two saves from a double-click must not interleave.
let queue = Promise.resolve();
/** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
const serialize = task => {
  const job = queue.then(task, task);
  queue = job.then(() => {}, () => {});
  return job;
};

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) throw new Error('Request body is empty.');
  try { return JSON.parse(text); } catch { throw new Error('Request body is not valid JSON.'); }
}

const server = createServer(async (request, response) => {
  const pathname = request.url.split('?')[0];

  // The local dashboard is the only caller allowed to trigger paid research or save work.
  if (request.method === 'POST' && (request.headers['sec-fetch-site'] === 'cross-site' ||
    (request.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(request.headers.origin)))) {
    return send(response, 403, { error: 'Use this action from the local dashboard.' });
  }

  if (pathname === '/api/research') {
    if (!['GET', 'POST'].includes(request.method)) return send(response, 405, { error: 'Use GET or POST.' });
    try {
      const parameters = request.method === 'POST' ? await readBody(request) : Object.fromEntries(new URL(request.url, 'http://localhost').searchParams);
      const report = JSON.parse(await readFile(new URL('../artifacts/dashboard-report.json', import.meta.url), 'utf8'));
      if (parameters.reportVersion !== report.generatedAt) return send(response, 409, { error: 'The submission data changed. Refresh the dashboard before researching.' });
      const sourceRow = report.rows.find(r => String(r.id) === String(parameters.submissionId));
      const store = await loadStore(STATE_PATH);
      const source = sourceRow ? reviewedRow(sourceRow, report.rules, store.records[String(sourceRow.id)], report.generatedAt) : null;
      if (!source) return send(response, 404, { error: 'Submission not found in this report.' });
      const row = !isHistoricalCase(source) && source.lineOfBusiness === 'property' && !source.sites?.some(site => site.address)
        ? demoScenarioFor(source, report.rules)
        : source;
      let result;
      if (request.method === 'GET') result = await research.read(report, row);
      else {
        const key = `${report.generatedAt}:${row.id}:${row.evidenceHistory?.at(-1)?.id ?? 'source'}`;
        if (!researchJobs.has(key)) {
          const job = researchQueue.then(() => research.run(report, row, { refresh: true }));
          researchQueue = job.then(() => {}, () => {});
          researchJobs.set(key, job);
          void job.finally(() => researchJobs.delete(key)).catch(() => {});
        }
        result = await researchJobs.get(key);
      }
      return send(response, 200, { result, html: result ? researchPanel(row, report.generatedAt, result) : null });
    } catch {
      return send(response, 500, { error: 'Research could not complete. Check the local server configuration and try again.' });
    }
  }

  if (pathname === '/api/live-research') {
    if (request.method !== 'POST') return send(response, 405, { error: 'Use POST.' });
    try {
      const input = await readBody(request);
      const report = JSON.parse(await readFile(new URL('../artifacts/dashboard-report.json', import.meta.url), 'utf8'));
      const store = await loadStore(STATE_PATH);
      assertEvidenceCase(report, input.submissionId, input.reportVersion);
      const sourceRow = report.rows.find(r => String(r.id) === String(input.submissionId));
      const row = reviewedRow(sourceRow, report.rules, store.records[String(sourceRow.id)], report.generatedAt);
      const site = row.sites?.find(s => s.address);
      const demo = input.mode === 'demo';
      if (!site && !demo) return send(response, 400, { error: 'This submission has no linked property address. Add a property schedule before opening live research, or use the clearly marked demo walkthrough.' });
      releaseLiveResearch(String(row.id));
      const target = site ?? demoLocationFor(row);
      const handle = await openResearchView(target);
      liveResearchSessions.set(String(row.id), handle);
      setTimeout(() => releaseLiveResearch(String(row.id)), 10 * 60_000).unref();
      return send(response, 200, { liveViewUrl: handle.liveViewUrl, expiresInSeconds: 600, demo, address: `${target.address}, ${target.city}, ${target.state} ${target.zip}` });
    } catch (error) {
      const message = String(error.message);
      const safe = /^(Refresh|Evidence|This submission|Set BROWSERBASE|A linked property|connect|Navigation)/.test(message);
      return send(response, safe ? 400 : 502, { error: safe ? message : 'Browserbase live research is unavailable. Check the local Browserbase configuration and retry.' });
    }
  }

  if (pathname === '/api/demo-scenario') {
    if (request.method !== 'POST') return send(response, 405, { error: 'Use POST.' });
    try {
      const input = await readBody(request);
      const report = JSON.parse(await readFile(new URL('../artifacts/dashboard-report.json', import.meta.url), 'utf8'));
      const source = assertEvidenceCase(report, input.submissionId, input.reportVersion);
      const demo = demoScenarioFor(source, report.rules);
      return send(response, 200, { html: caseTemplate(demo, 0, report) });
    } catch (error) {
      const message = String(error.message);
      const safe = /^(Refresh|Evidence|This submission|Request body)/.test(message);
      return send(response, safe ? 400 : 500, { error: safe ? message : 'Demo walkthrough is unavailable. Refresh the dashboard and retry.' });
    }
  }

  if (pathname === '/api/evidence') {
    if (!['GET', 'POST'].includes(request.method)) return send(response, 405, { error: 'Use GET or POST.' });
    try {
      const input = request.method === 'POST' ? await readBody(request) : Object.fromEntries(new URL(request.url, 'http://localhost').searchParams);
      const report = JSON.parse(await readFile(new URL('../artifacts/dashboard-report.json', import.meta.url), 'utf8'));
      const row = assertEvidenceCase(report, input.submissionId, input.reportVersion);
      const id = String(row.id);
      if (request.method === 'GET') {
        const record = (await loadStore(STATE_PATH)).records[id];
        return send(response, 200, { draft: record?.evidenceDraft ?? null, history: record?.evidenceHistory ?? [] });
      }
      if (input.action === 'extract') {
        if (typeof input.text !== 'string' || input.text.trim().length < 10 || input.text.length > 20000) return send(response, 400, { error: 'Paste between 10 and 20,000 characters of evidence.' });
        if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > 300) return send(response, 400, { error: 'Name the evidence source (up to 300 characters).' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sourceDate ?? '') || !Number.isFinite(Date.parse(input.sourceDate))) return send(response, 400, { error: 'Provide the source document date.' });
        const original = (await loadStore(STATE_PATH)).records[id];
        const revision = (original?.evidenceHistory ?? []).length;
        const effective = reviewedRow(row, report.rules, original, report.generatedAt);
        const extracted = await extractEvidence(effective, input.text);
        const draft = { id: randomUUID(), reportVersion: report.generatedAt, revision, source: input.source.trim(), sourceDate: input.sourceDate, text: input.text, model: extracted.model,
          facts: extracted.facts.map(f => ({ ...f, previousValue: currentValue(effective, f), conflict: currentValue(effective, f) != null && String(currentValue(effective, f)) !== f.value })) };
        await serialize(async () => {
          const latest = JSON.parse(await readFile(new URL('../artifacts/dashboard-report.json', import.meta.url), 'utf8'));
          assertEvidenceCase(latest, input.submissionId, input.reportVersion);
          const store = await loadStore(STATE_PATH);
          const record = store.records[id] ?? { submissionId: id, requests: {}, decision: null };
          if ((record.evidenceHistory ?? []).length !== revision) throw new Error('Evidence changed during extraction. Extract again.');
          record.evidenceDraft = draft; store.records[id] = record; await saveStore(store, STATE_PATH);
        });
        return send(response, 200, { draft });
      }
      if (input.action === 'confirm') {
        const event = await serialize(async () => {
          const latest = JSON.parse(await readFile(new URL('../artifacts/dashboard-report.json', import.meta.url), 'utf8'));
          const currentRow = assertEvidenceCase(latest, input.submissionId, input.reportVersion);
          const store = await loadStore(STATE_PATH), record = store.records[id];
          if (!record?.evidenceDraft || record.evidenceDraft.id !== input.draftId) throw new Error('Evidence draft expired. Extract again.');
          if (!Array.isArray(input.factIds)) throw new Error('Select facts to confirm.');
          const event = confirmEvidence(record, currentRow, latest.rules, record.evidenceDraft, input.factIds, input.confirmedBy, input.rationale, latest.generatedAt);
          await saveStore(store, STATE_PATH); return event;
        });
        return send(response, 200, { event });
      }
      return send(response, 400, { error: 'Choose extract or confirm.' });
    } catch (error) {
      const message = String(error.message);
      const safe = /^(Refresh|Evidence|Provide|Select|Each fact|Match the fact|Building years|AI extraction|Use a|Business type|Unsupported)/.test(message);
      return send(response, safe ? 400 : 500, { error: safe ? message : 'Could not process evidence. Please retry.' });
    }
  }

  if (pathname === '/api/state') {
    if (request.method === 'GET') {
      try {
        return send(response, 200, await loadStore(STATE_PATH));
      } catch {
        return send(response, 500, { error: 'Could not read saved underwriting state.' });
      }
    }
    if (request.method === 'POST') {
      try {
        const action = await readBody(request);
        const record = await serialize(async () => {
          const store = await loadStore(STATE_PATH);
          const report = JSON.parse(await readFile(new URL('../artifacts/dashboard-report.json', import.meta.url), 'utf8'));
          const error = validateCaseAction(action, store, reviewedReport(report, store));
          if (error) return { validationError: error };
          const updated = applyAction(store, action);
          await saveStore(store, STATE_PATH);
          return updated;
        });
        if (record.validationError) return send(response, 400, { error: record.validationError });
        return send(response, 200, { ok: true, record });
      } catch (error) {
        // applyAction messages are written for the underwriter; anything else stays generic.
        const safe = /^(An action|Unrecognised|A decision|Premium must|Request body)/.test(String(error.message));
        return send(response, safe ? 400 : 500, { error: safe ? error.message : 'Could not save that action.' });
      }
    }
    return send(response, 405, { error: 'Use GET or POST.' });
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (pathname === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  // Serve only the dashboard, never repository files or local credentials.
  if (!['/', '/dashboard.html'].includes(pathname)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  try {
    const report = JSON.parse(await readFile(new URL('../artifacts/dashboard-report.json', import.meta.url), 'utf8'));
    const html = Buffer.from(htmlReport(reviewedReport(report, await loadStore(STATE_PATH))));
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 503 : 500, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Dashboard unavailable. Run npm run dashboard:render first.');
  }
});
server.on('error', (/** @type {NodeJS.ErrnoException} */ error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Set DASHBOARD_PORT to another port.` : 'Unable to start the dashboard server.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Dashboard running at http://localhost:${port}`);
  console.log(`Underwriter decisions persist to ${STATE_PATH}`);
});
