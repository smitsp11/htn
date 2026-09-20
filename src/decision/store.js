import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DECISIONS, REQUEST_STATES, emptyRecord, reviewStage, validateDecision } from './workflow.js';
import { isPropertyCase, isHistoricalCase } from './review.js';

/** Validate the actual report and saved requests, not just values from the form. */
export function validateCaseAction(action, store, report) {
  if (action.reportVersion !== report.generatedAt) return 'Refresh the dashboard: the source report changed.';
  const row = report.rows.find(r => String(r.id) === String(action.submissionId));
  if (!row) return 'Submission not found in the current report.';
  if (!isPropertyCase(row)) return 'This line is context only; commercial property decisions do not apply.';
  if (isHistoricalCase(row)) return 'This submission is already bound or closed in Federato. It is available for reference only.';
  if (action.type === 'request' && !(row.tasks ?? []).some(t => t.id === action.taskId)) return 'Request not found on this submission.';
  if (action.type === 'decision') return validateDecision(action, row, reviewStage(row, store.records[String(row.id)]));
  return null;
}

/**
 * Durable underwriter state: which requests have been sent or answered, and what was decided.
 *
 * Kept apart from the generated report on purpose. A report is a snapshot of what Federato said
 * at a point in time and is rewritten on every run; this is the record of what people did, and
 * it must survive that. Writes are atomic so a crash mid-save cannot truncate the file.
 */
const MAX_TEXT = 2000;

const clean = (value, limit = MAX_TEXT) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

export async function loadStore(path = 'artifacts/underwriting-state.json') {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.records ? parsed : { version: 1, records: {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, records: {} };
    throw error;
  }
}

export async function saveStore(store, path = 'artifacts/underwriting-state.json') {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2));
  await rename(temporary, path);
  return store;
}

/**
 * Apply one underwriter action. Returns the updated record, or throws with a message safe to
 * show. Validation of *whether* a decision is allowed lives in workflow.js; this checks shape.
 */
export function applyAction(store, action, now = () => new Date().toISOString()) {
  const submissionId = clean(action?.submissionId, 120);
  if (!submissionId) throw new Error('An action must name a submission.');
  const record = store.records[submissionId] ?? emptyRecord(submissionId);

  if (action.type === 'request') {
    const taskId = clean(action.taskId, 200);
    if (!taskId) throw new Error('An action must name a request.');
    if (!REQUEST_STATES.includes(action.state)) throw new Error('Unrecognised request state.');
    record.requests = { ...record.requests, [taskId]: action.state };
    if (action.state === 'open') delete record.requests[taskId];
  } else if (action.type === 'decision') {
    const decidedBy = clean(action.decidedBy, 120);
    if (!DECISIONS.includes(action.decision)) throw new Error('Unrecognised decision.');
    if (!decidedBy) throw new Error('A decision must be attributed to someone.');
    const premium = action.pricing?.premium;
    record.decision = {
      decision: action.decision,
      rationale: clean(action.rationale),
      decidedBy,
      decidedAt: now(),
      pricing: {
        premium: premium == null || premium === '' ? null : Number(premium),
        terms: clean(action.pricing?.terms, 500),
      },
    };
    if (record.decision.pricing.premium != null && !Number.isFinite(record.decision.pricing.premium)) {
      throw new Error('Premium must be a number.');
    }
  } else if (action.type === 'reopen') {
    record.decision = null;
  } else {
    throw new Error('Unrecognised action.');
  }

  record.updatedAt = now();
  store.records[submissionId] = record;
  return record;
}
