const SEVERITY_ORDER = { blocking: 3, material: 2, minor: 1 };

/**
 * Triage lane. Non-property submissions are separated from real property declines so the
 * property workspace is not flooded by lines that were never in scope.
 */
export function verdictOf(row) {
  const lineFactor = row.factors.find(f => f.key === 'lineOfBusiness');
  if (lineFactor?.status === 'fail') return 'not-property';
  if (row.decision === 'OUT_OF_APPETITE') return 'declined';
  if (row.decision === 'IN_APPETITE') return 'work-now';
  return 'chase-evidence';
}

/** Best score this submission could reach if every open gap resolved acceptably (never target). */
function unlockableScore(row, rules) {
  if (row.factors.some(f => f.status === 'fail')) return row.score;
  const raw = row.factors.reduce((sum, f) => {
    if (f.status !== 'unknown') return sum + f.points;
    // Assume acceptable-but-not-target: the conservative favourable outcome.
    const weight = rules.weights[f.key];
    return sum + (f.hasTarget ? weight * rules.acceptableCredit : weight);
  }, 0);
  return Math.round(Math.min(raw, 100) * 10) / 10;
}

function premiumSignal(row, rules) {
  if (row.premium == null) return 0.5;
  const [low, high] = rules.premiumRange;
  if (row.premium < low || row.premium > high) return 0.1;
  const [targetLow, targetHigh] = rules.targetPremium;
  return row.premium >= targetLow && row.premium <= targetHigh ? 1 : 0.75;
}

export function buildEscalations(row, rules) {
  const verdict = verdictOf(row);
  const open = row.factors.filter(f => f.gap);
  const tasks = open.map(factor => {
    const weight = rules.weights[factor.key];
    const severity = factor.status === 'fail' ? 'material'
      : weight >= 15 ? 'blocking'
      : weight >= 10 ? 'material' : 'minor';
    return {
      id: `${row.id}:${factor.key}`,
      submissionId: row.id, submissionNumber: row.submissionNumber, accountName: row.accountName,
      factorKey: factor.key, label: factor.label, status: factor.status,
      confidence: factor.confidence, severity,
      question: factor.gap.question,
      needs: factor.gap.needs ?? [],
      askOf: factor.gap.askOf ?? [],
      enrichable: Boolean(factor.gap.enrichable),
      enrichment: factor.gap.enrichment ?? null,
      pointsAtStake: weight,
    };
  }).sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || b.pointsAtStake - a.pointsAtStake);

  const ceiling = unlockableScore(row, rules);
  const upside = Math.max(0, ceiling - row.score);
  const parties = new Set(tasks.flatMap(t => t.askOf));

  // Priority answers "how close is this to a decision, and is it worth closing?" — not "how
  // much score is theoretically missing". A submission with one open question outranks one
  // where nothing is established, even though the latter has far more raw upside.
  const readiness = row.evidenceCoverage / 100;
  const effort = 1 / (1 + 0.15 * Math.max(0, tasks.length - 1) + 0.2 * Math.max(0, parties.size - 1));
  const reviewPriority = verdict === 'chase-evidence' && upside > 0
    ? Math.round(100 * readiness * premiumSignal(row, rules) * effort)
    : 0;

  return {
    verdict, tasks, reviewPriority,
    unlockableScore: ceiling,
    scoreUpside: Math.round(upside * 10) / 10,
    blockingCount: tasks.filter(t => t.severity === 'blocking').length,
    parties: [...parties],
  };
}

export function applyEscalations(rows, rules) {
  return rows.map(row => ({ ...row, ...buildEscalations(row, rules) }));
}

/**
 * Queue-wide view of outstanding requests, grouped by who can answer them and then by
 * submission — an underwriter sends one message per account, not one per missing field.
 */
export function aggregateTasks(rows) {
  const byParty = new Map();
  for (const row of rows) {
    if (row.verdict !== 'chase-evidence') continue;
    for (const task of row.tasks ?? []) {
      for (const party of task.askOf.length ? task.askOf : ['unassigned']) {
        if (!byParty.has(party)) byParty.set(party, new Map());
        const submissions = byParty.get(party);
        if (!submissions.has(row.id)) {
          submissions.set(row.id, {
            submissionId: row.id, submissionNumber: row.submissionNumber,
            accountName: row.accountName, reviewPriority: row.reviewPriority, tasks: [],
          });
        }
        submissions.get(row.id).tasks.push(task);
      }
    }
  }
  return [...byParty.entries()]
    .map(([party, submissions]) => {
      const list = [...submissions.values()]
        .map(entry => ({ ...entry, tasks: entry.tasks.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || b.pointsAtStake - a.pointsAtStake) }))
        .sort((a, b) => b.reviewPriority - a.reviewPriority || a.accountName.localeCompare(b.accountName));
      return { party, submissions: list, count: list.reduce((sum, entry) => sum + entry.tasks.length, 0) };
    })
    .sort((a, b) => b.count - a.count);
}

export function queueSummary(rows) {
  const lanes = { 'work-now': 0, 'chase-evidence': 0, declined: 0, 'not-property': 0 };
  for (const row of rows) lanes[row.verdict] = (lanes[row.verdict] ?? 0) + 1;
  const chase = rows.filter(r => r.verdict === 'chase-evidence');
  return {
    lanes,
    totalUpside: Math.round(chase.reduce((sum, r) => sum + r.scoreUpside, 0)),
    premiumInReview: chase.reduce((sum, r) => sum + (r.premium ?? 0), 0),
    enrichableTasks: chase.flatMap(r => r.tasks ?? []).filter(t => t.enrichable).length,
  };
}
