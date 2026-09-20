import { isAmount } from './normalize.js';

/**
 * The underwriting workflow: review the application, assess the risk, then decide and price it.
 *
 * The analysis engine produces findings; this module produces the *state of the work*. It is
 * deliberately separate: an appetite score is a fact about the submission, whereas a decision
 * is an act by a named person at a point in time, and the two must not be conflated.
 *
 * Nothing here is derived from the score alone. The engine never decides — it establishes what
 * is known, and records what the underwriter concluded.
 */

export const REQUEST_STATES = ['open', 'sent', 'answered', 'waived'];
export const DECISIONS = ['approve', 'decline', 'refer', 'request-info'];

export const DECISION_LABELS = {
  approve: 'Approve',
  decline: 'Decline',
  refer: 'Refer to senior underwriter',
  'request-info': 'Request more information',
};

/** A blank record. Persisted per submission; absent means the case has not been opened. */
export const emptyRecord = submissionId => ({
  submissionId: String(submissionId),
  requests: {},
  decision: null,
  updatedAt: null,
});

const requestState = (record, taskId) => record?.requests?.[taskId] ?? 'open';
const isClosed = state => state === 'answered' || state === 'waived';

/**
 * Step 1 — application review. Complete when every outstanding request has been answered or
 * consciously waived. Marking a request sent does not complete it: a sent request is still an
 * open question.
 */
export function reviewStage(row, record) {
  const tasks = (row.tasks ?? []).map(task => ({ ...task, state: requestState(record, task.id) }));
  const outstanding = tasks.filter(task => !isClosed(task.state));
  return {
    tasks,
    total: tasks.length,
    outstanding: outstanding.length,
    sent: tasks.filter(task => task.state === 'sent').length,
    answered: tasks.filter(task => task.state === 'answered').length,
    waived: tasks.filter(task => task.state === 'waived').length,
    blocking: outstanding.filter(task => task.severity === 'blocking').length,
    complete: outstanding.length === 0,
    issues: row.issues ?? [],
  };
}

/** Step 2 — risk assessment. Always available; it is what the engine already computed. */
export function assessStage(row) {
  const failed = row.factors.filter(f => f.status === 'fail');
  const unresolved = row.factors.filter(f => f.status === 'unknown');
  return {
    score: row.score,
    verdict: row.verdict,
    decision: row.decision,
    failed: failed.map(f => ({ key: f.key, label: f.label, reason: f.reason })),
    unresolved: unresolved.map(f => ({ key: f.key, label: f.label })),
    evidenceCoverage: row.evidenceCoverage,
    weakestConfidence: row.evidenceConfidence,
    usesInterpretation: row.usesInterpretation,
  };
}

/**
 * Indicated premium from the peer rate, against the appetite band and whatever is quoted.
 * This is guidance for the underwriter to price against, not a rate.
 */
export function pricingGuidance(row, rules) {
  const peers = row.casefile?.comparables;
  const tiv = isAmount(row.tiv) ? row.tiv : null;
  const indicated = peers?.medianRate && tiv ? Math.round(peers.medianRate * tiv / 1000) : null;
  const quoted = isAmount(row.premium) ? row.premium : null;
  return {
    quoted,
    indicated,
    indicatedBasis: indicated == null ? null
      : `$${peers.medianRate} per $1,000 TIV, the median of ${peers.peerCount} peer risk(s) in NAICS ${peers.industryKey}`,
    peerCount: peers?.peerCount ?? 0,
    acceptableBand: rules.premiumRange,
    targetBand: rules.targetPremium,
    // Where the quote sits against the indication, when both exist.
    varianceToIndicated: quoted != null && indicated ? Math.round((quoted / indicated - 1) * 100) : null,
    withinAcceptable: quoted != null ? quoted >= rules.premiumRange[0] && quoted <= rules.premiumRange[1] : null,
    withinTarget: quoted != null ? quoted >= rules.targetPremium[0] && quoted <= rules.targetPremium[1] : null,
    tiv,
  };
}

/**
 * Which decisions are available, and what each one requires first.
 *
 * Nothing is forbidden. Approving a risk that fails appetite is a real underwriting act — it is
 * an exception — so it is allowed but requires a written rationale, and the rationale is stored
 * with the decision. A gate that cannot be overridden just gets worked around outside the tool.
 */
export function decisionOptions(row, review) {
  const failed = row.factors.filter(f => f.status === 'fail');
  const options = [];

  options.push({
    value: 'approve',
    label: DECISION_LABELS.approve,
    available: true,
    requiresRationale: failed.length > 0 || !review.complete,
    warning: failed.length
      ? `Outside appetite on ${failed.map(f => f.label.toLowerCase()).join(', ')}. Approving is an exception and needs a written rationale.`
      : !review.complete
        ? `${review.outstanding} request(s) are still open. Approving now means deciding without that evidence.`
        : null,
  });

  options.push({
    value: 'decline', label: DECISION_LABELS.decline, available: true,
    requiresRationale: failed.length === 0,
    warning: failed.length ? null : 'Nothing has failed appetite, so a decline needs a stated reason.',
  });

  options.push({
    value: 'refer', label: DECISION_LABELS.refer, available: true,
    requiresRationale: true,
    warning: 'Say what the senior underwriter needs to weigh.',
  });

  options.push({
    value: 'request-info', label: DECISION_LABELS['request-info'],
    available: review.outstanding > 0,
    requiresRationale: false,
    warning: review.outstanding > 0 ? null : 'There are no open requests to chase.',
  });

  return options;
}

/** Validate a decision before it is stored. Returns an error string, or null when acceptable. */
export function validateDecision(submitted, row, review) {
  if (!submitted || typeof submitted !== 'object') return 'A decision is required.';
  if (!DECISIONS.includes(submitted.decision)) return 'Unrecognised decision.';
  const option = decisionOptions(row, review).find(o => o.value === submitted.decision);
  if (!option?.available) return `${DECISION_LABELS[submitted.decision]} is not available on this submission.`;
  const rationale = typeof submitted.rationale === 'string' ? submitted.rationale.trim() : '';
  if (option.requiresRationale && rationale.length < 10) {
    return `${DECISION_LABELS[submitted.decision]} needs a written rationale of at least 10 characters.`;
  }
  if (submitted.pricing?.premium != null) {
    const premium = Number(submitted.pricing.premium);
    if (!Number.isFinite(premium) || premium < 0) return 'Premium must be a positive number.';
  }
  if (typeof submitted.decidedBy !== 'string' || !submitted.decidedBy.trim()) return 'A decision must be attributed to someone.';
  return null;
}

/** The stage the case is actually in, derived from state rather than manually advanced. */
export function workflowState(row, record, rules) {
  const review = reviewStage(row, record);
  const assess = assessStage(row);
  const pricing = pricingGuidance(row, rules);
  const decision = record?.decision ?? null;
  const stage = decision ? 'closed' : review.complete ? 'decide' : 'review';
  return {
    stage,
    review,
    assess,
    pricing,
    decision,
    options: decisionOptions(row, review),
    steps: [
      { key: 'review', label: 'Application review', done: review.complete, detail: review.total ? `${review.total - review.outstanding} of ${review.total} requests closed` : 'Nothing outstanding' },
      { key: 'assess', label: 'Risk assessment', done: true, detail: `${row.score}/100 · ${assess.evidenceCoverage}% of factors established` },
      { key: 'decide', label: 'Decision and pricing', done: Boolean(decision), detail: decision ? `${DECISION_LABELS[decision.decision]} by ${decision.decidedBy}` : 'Not yet decided' },
    ],
  };
}

/** Queue-level roll-up of where the book actually stands, as opposed to what the engine scored. */
export function workflowSummary(rows, records, rules) {
  const counts = { untouched: 0, review: 0, decide: 0, closed: 0 };
  const decisions = Object.fromEntries(DECISIONS.map(d => [d, 0]));
  for (const row of rows) {
    const record = records[String(row.id)];
    if (!record) { counts.untouched++; continue; }
    const state = workflowState(row, record, rules);
    counts[state.stage === 'closed' ? 'closed' : state.stage]++;
    if (state.decision) decisions[state.decision.decision]++;
  }
  return { counts, decisions };
}
