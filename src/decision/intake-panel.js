import { EVIDENCE_FIELDS } from './intake.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

export function intakePanel(row, version) {
  if (row.demoScenario) return '';
  return `<section class="evidence-intake" data-evidence-intake data-submission="${esc(row.id)}" data-report-version="${esc(version)}">
    <details><summary>Add evidence &amp; update assessment</summary>
    <p>Paste a broker response or document excerpt. AI proposes cited facts; you choose what to confirm for this submission.</p>
    <p class="factor-caption">Supports quoted USD premium, new/renewal business, complete USD TIV, primary TIV state, and year/construction/roof facts for existing buildings. A partial schedule or loss run remains a review task.</p>
    <label>Source name or URL<input data-evidence-source maxlength="300" placeholder="Broker email / statement of values"></label>
    <label>Source document date<input data-evidence-date type="date"></label>
    <label>Evidence text<textarea data-evidence-text rows="5" maxlength="20000" placeholder="Include the submission reference, relevant facts, units and dates."></textarea></label>
    <label>Or load a text file<input data-evidence-file type="file" accept=".txt,.md,.csv,text/plain,text/csv"></label>
    <button class="button mint" data-extract-evidence>Extract proposed facts</button>
    <p role="status" aria-live="polite" data-evidence-status></p>
    <div data-evidence-proposals></div>
    <div data-evidence-confirm hidden><label>Your name<input data-evidence-author maxlength="120"></label><label>Why these facts apply to this submission<textarea data-evidence-rationale rows="2" maxlength="2000" placeholder="Confirm the submission/building match, dates, completeness and any conflicting values."></textarea></label><button class="button mint" data-confirm-evidence>Confirm selected facts &amp; recalculate</button></div>
    </details>
    ${row.evidenceHistory?.length ? `<details class="evidence-history" open><summary>What changed · ${row.evidenceHistory.length} evidence review(s)</summary>${[...row.evidenceHistory].reverse().map(h => `<article><h4>${esc(h.source)}</h4><p>Appetite points ${h.before.score} → ${h.after.score} · Factors established ${h.before.coverage}% → ${h.after.coverage}%</p><p>${esc(h.before.decision)} → ${esc(h.after.decision)}</p>${h.supersededDecision ? `<p>Previous decision ${esc(h.supersededDecision.decision)} by ${esc(h.supersededDecision.decidedBy)} requires re-review. Previous rationale: ${esc(h.supersededDecision.rationale)}</p>` : ''}<ul>${h.changes.map(c => `<li><b>${esc(c.label)}:</b> ${esc(c.before)} → ${esc(c.after)}. ${esc(c.reason)}</li>`).join('')}</ul><details><summary>Confirmed facts &amp; citations</summary>${h.facts.map(f => `<p><b>${esc(EVIDENCE_FIELDS[f.field])}${f.buildingId ? ` · Building ${esc(f.buildingId)}` : ''}:</b> ${esc(f.previousValue ?? 'Not established')} → ${esc(f.value)}</p><blockquote>${esc(f.quote)}</blockquote>`).join('')}<p>${esc(h.rationale)}</p></details><small>Source dated ${esc(h.sourceDate)} · Confirmed by ${esc(h.confirmedBy)} · ${esc(h.confirmedAt)}</small></article>`).join('')}</details>` : ''}
  </section>`;
}

export function assessmentSummary(row) {
  const passed = row.factors.filter(f => ['pass','target'].includes(f.status));
  const failed = row.factors.filter(f => f.status === 'fail');
  const missing = row.factors.filter(f => f.status === 'unknown');
  return `<section class="assessment-summary"><h3>${failed.length ? `${failed.length} confirmed appetite exception(s)` : missing.length ? 'Incomplete application' : 'Appetite checks established'}</h3><p><b>${row.evidenceCoverage}% of factors established</b> · ${passed.length} match${passed.length === 1 ? '' : 'es'} · ${missing.length} gaps · ${failed.length} exceptions</p><p>${failed.length ? esc(failed.map(f=>f.label).join(', ')) + ' fall outside the guideline.' : missing.length ? 'Missing information reduces the score; it does not establish a poor risk.' : 'Review the source evidence and proposed terms before deciding.'}</p><details><summary>Why this submission ranks here</summary><p>Appetite points: ${row.score}/100. Review priority: ${row.reviewPriority ?? 0}/100, based on established evidence, premium fit and remaining review effort. Neither measures probability of loss. Equal values are tied; submission ID supplies a stable display order.</p><p>${esc(row.explanation)}</p>${row.issues?.length ? `<p>Source record issues remain even where local evidence establishes a fact:</p><ul>${row.issues.map(issue => `<li>${esc(issue)}</li>`).join('')}</ul>` : ''}${row.sourceAssessment ? `<p>Original Federato snapshot: ${row.sourceAssessment.score} points, ${row.sourceAssessment.evidenceCoverage}% established. Current view includes separately confirmed evidence.</p>` : ''}</details></section>`;
}
