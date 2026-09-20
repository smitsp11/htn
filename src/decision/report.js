const money = value => value == null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const md = value => String(value ?? '').replace(/[\r\n|]/g, ' ').replace(/[<>]/g, '');
const laneLabels = { 'work-now': 'Ready to work', 'chase-evidence': 'Chase evidence', declined: 'Declined', 'not-property': 'Not property' };

export function markdownReport(report) {
  const summary = report.summary;
  const lanes = summary ? Object.entries(summary.lanes).map(([lane, count]) => `- ${laneLabels[lane] ?? lane}: ${count}`).join('\n') : '';
  const chase = report.rows.filter(r => r.verdict === 'chase-evidence').sort((a, b) => b.reviewPriority - a.reviewPriority);
  return `# Commercial property submission ranking\n\nGenerated: ${report.generatedAt} · ${report.mode} · ${report.rows.length} submissions\n\n` +
    `Rules: ${report.rules.version}. Scores are triage priorities, not probabilities or binding decisions.\n\n` +
    (summary ? `## Triage\n\n${lanes}\n\n${summary.totalUpside} score points are recoverable across ${summary.lanes['chase-evidence']} submissions holding ${money(summary.premiumInReview)} in premium.\n\n` : '') +
    (report.taskGroups?.length ? `## Outstanding requests\n\n${report.taskGroups.map(g => `### ${g.party} (${g.count} across ${g.submissions.length} submissions)\n\n${g.submissions.map(entry => `**${md(entry.accountName)}** (${md(entry.submissionNumber)})\n${entry.tasks.map(t => `  - ${md(t.question)}`).join('\n')}`).join('\n\n')}`).join('\n\n')}\n\n` : '') +
    `## Scoring assumptions\n\n${report.rules.assumptions.map(a => `- ${a}`).join('\n')}\n\n` +
    (chase.length ? `## Review priority\n\n| Priority | Submission | Account | Score | Ceiling | Open requests |\n|---|---|---|---|---|---|\n` +
      chase.map(r => `| ${r.reviewPriority} | ${md(r.submissionNumber)} | ${md(r.accountName)} | ${r.score} | ${r.unlockableScore} | ${(r.tasks ?? []).length} |`).join('\n') + '\n\n' : '') +
    `## Ranked queue\n\n| Rank | Submission | Account | Score | Lane | State | Premium | TIV |\n|---|---|---|---|---|---|---|---|\n` +
    report.rows.map(r => `| ${r.rank} | ${md(r.submissionNumber)} | ${md(r.accountName)} | ${r.score} | ${laneLabels[r.verdict] ?? r.decision} | ${r.primaryState ?? 'Unknown'} | ${money(r.premium)} | ${money(r.tiv)} |`).join('\n') + '\n\n' +
    report.rows.map(r => `## ${r.rank}. ${md(r.submissionNumber)} — ${md(r.accountName)}\n\n${r.score}/100 · ${laneLabels[r.verdict] ?? r.decision} · Queue status: ${md(r.queueStatus)}\n\n${md(r.explanation)}\n\n` +
      `Raw factor points ${r.rawScore}; decision cap ${r.scoreCap}. Evaluated factors ${r.evidenceCoverage}%.\n\n` +
      r.factors.map(f => `- **${f.label}: ${f.status} (${f.points}/${f.maxPoints})** [${f.confidence}] — ${md(f.reason)}`).join('\n') +
      ((r.tasks ?? []).length ? `\n\nOpen requests:\n${r.tasks.map(t => `- [${t.severity}] ${md(t.question)} (ask: ${t.askOf.join(', ') || 'unassigned'})`).join('\n')}` : '') +
      `\n\nSource records: ${md(Object.values(r.sources).flat().join(', '))}\n`).join('\n');
}

export { htmlReport } from './dashboard.js';
