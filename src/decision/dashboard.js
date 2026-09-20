import { intakePanel, assessmentSummary } from './intake-panel.js';
import { demoScenarioFor } from './demo-locations.js';
import { readFileSync } from 'node:fs';
import { federanorthShell } from './federanorth-shell.js';
import { CONFIDENCE_LABELS } from './evidence.js';
import { aggregateTasks, buildEscalations, queueSummary } from './escalation.js';
import { caseSignals } from './casefile.js';
import { decisionOptions, pricingGuidance, reviewStage } from './workflow.js';
import { researchPanel, caseSummary, resolveResearch } from './research-panel.js';
import { attentionFor, evidenceRequest, isPropertyCase, isHistoricalCase, reviewTasks } from './review.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = value => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const shortMoney = value => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
const title = value => String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const pct = value => `${Math.round((value ?? 0) * 100)}%`;
const decisionLabels = { IN_APPETITE: 'In appetite', REVIEW_REQUIRED: 'Needs review', OUT_OF_APPETITE: 'Outside appetite' };
const laneLabels = { 'work-now': 'Ready for review', 'chase-evidence': 'Needs evidence', declined: 'Outside appetite', 'not-property': 'Not evaluated' };
const lineLabels = { property: 'Property', cgl: 'General liability', cyber: 'Cyber', health: 'Health', auto: 'Auto', lpl: 'Professional', excess: 'Excess' };
const statusWords = { unknown: 'Needs evidence', pass: 'Acceptable', target: 'Target', fail: 'Outside appetite', conflict: 'Conflict', advisory: 'Advisory', proposed: 'Proposed' };
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  inbox: '<path d="m4 4-2 11v5h20v-5L20 4H4Z"/><path d="M2 15h6l2 3h4l2-3h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  building: '<path d="M4 21V7l8-4v18m0-13h8v13M2 21h20M7 9v2m0 3v2m9-4v2m0 3v2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  ask: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M12 13v.01M12 7v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  alert: '<path d="M12 4 2 20h20L12 4Z"/><path d="M12 10v4m0 3v.01"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.grid}</svg>`;
const group = row => row.businessTypes?.some(t => /renewal/i.test(t)) ? 'renewal' : row.businessTypes?.length && row.businessTypes.every(t => /^new(?:[ _-]?business)?$/i.test(t)) ? 'new' : 'unknown';
const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Not available';

/** Reports saved by an earlier version still render; anything stale is derived on the fly. */
function prepare(report) {
  const rows = report.rows.map(row => row.verdict ? row : { ...row, ...buildEscalations(row, report.rules) });
  return {
    ...report, rows,
    summary: report.summary ?? queueSummary(rows),
    taskGroups: aggregateTasks(rows.filter(row => isPropertyCase(row) && !isHistoricalCase(row)).map(row => ({ ...row, tasks: reviewTasks(row).filter(task => task.requestable) }))),
  };
}

const confidenceChip = value => `<span class="conf conf-${esc(value)}" title="${esc(CONFIDENCE_LABELS[value] ?? value)}">${esc(value)}</span>`;

function taskCard(task, row, open = true) {
  return `<details class="task sev-${esc(task.severity)}" data-task="${esc(task.id)}" data-requestable="${task.requestable}" data-severity="${esc(task.severity)}"${open ? ' open' : ''}>
    <summary><span class="sev-dot"></span><strong>${esc(task.label)}</strong><span class="sev-tag">${task.requestable ? 'Evidence gap' : 'Known exception'}</span><span class="task-state" data-task-state></span></summary>
    <p>${esc(task.question)}</p>
    ${task.needs?.length ? `<ul class="needs">${task.needs.slice(0, 4).map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <footer>${(task.askOf ?? []).map(p => `<span class="chip">${icon('ask')}${esc(title(p))}</span>`).join('')}
      <span class="task-actions">${(task.requestable ? ['sent', 'answered', 'waived'] : ['answered', 'waived']).map(state => `<button class="task-action" data-set-state="${state}" data-task-id="${esc(task.id)}" data-submission="${esc(row.id)}">${state === 'sent' ? 'Mark sent' : state === 'answered' ? task.requestable ? 'Evidence received' : 'Reviewed' : 'Waive'}</button>`).join('')}</span></footer>
    ${leadsPanel(row, task.factorKey)}
  </details>`;
}

const leadKindLabels = {
  'adjacent-policy': 'On this account', 'partial-value': 'Partly resolved',
  'account-profile': 'Account profile', peer: 'Peer benchmark', external: 'External source', record: 'Record',
};

/**
 * What we already hold that bears on an unresolved factor. Shown beside the question so an
 * underwriter can form a view now rather than waiting on a reply. None of it is scored.
 */
function leadsPanel(row, factorKey) {
  const leads = row.leads?.[factorKey];
  if (!leads?.length) return '';
  return `<details class="leads"><summary><span>${icon('book')}Related information we already hold</span><span class="lead-count">${leads.length}</span>${icon('chevron')}</summary>
    <div class="lead-list">${leads.map(l => `<article class="lead"><header><span class="lead-kind">${esc(leadKindLabels[l.kind] ?? l.kind)}</span><strong>${esc(l.label)}</strong></header>
      <b class="lead-value">${esc(l.value)}</b>
      ${l.detail ? `<p>${esc(l.detail)}</p>` : ''}
      <p class="lead-caution">${icon('info')}${esc(l.caution)}</p>
      ${l.sources?.length ? `<p class="lead-sources">${esc(l.sources.slice(0, 6).join(', '))}</p>` : ''}</article>`).join('')}</div>
    <p class="lead-footer">Context only. None of this is scored, and none of it closes the request above.</p></details>`;
}

/**
 * The three steps an underwriter actually works: review the application, assess the risk,
 * decide and price it. Step state is filled in by the client from saved records, because the
 * report is a snapshot of Federato while the work is a separate, durable record.
 */
function workflowPanel(row, rules) {
  const pricing = pricingGuidance(row, rules);
  const review = reviewStage(row, null);
  const options = decisionOptions(row, review);
  const hardFails = row.factors.filter(f => f.status === 'fail');
  const band = ([low, high]) => `${money(low)}–${money(high)}`;
  return `<section class="workflow" data-workflow data-submission="${esc(row.id)}" data-has-fails="${hardFails.length}" data-total-tasks="${(row.tasks ?? []).length}">
<p class="review-progress" data-review-progress></p>

    <div class="decided-banner" data-decided hidden>
      <div><span class="decided-label" data-decided-label></span><p data-decided-rationale></p><small data-decided-meta></small></div>
      <button class="button" data-reopen>Reopen</button>
    </div>

    <div class="decide-form" data-decide-form>
      <div class="section-title"><h3>Your decision</h3><span>Saved to this case</span></div>
      <div class="decision-choices">${options.map(option => `<button class="decision-choice" data-decision="${esc(option.value)}" data-requires-rationale="${option.requiresRationale}" ${option.available ? '' : 'disabled'}>${esc(option.label)}</button>`).join('')}</div>
      <p class="decision-warning" data-decision-warning hidden></p>

      <div class="pricing" data-pricing hidden>
        <div class="section-title"><h3>Pricing</h3><span>${pricing.peerCount ? `${pricing.peerCount} peer${pricing.peerCount === 1 ? '' : 's'}` : 'no peer benchmark'}</span></div>
        <div class="record-metrics">
          
          <div><small>Peer-indicated</small><strong>${money(pricing.indicated)}</strong></div>
          <div><small>Acceptable band</small><strong class="band">${band(pricing.acceptableBand)}</strong></div>
          <div><small>Target band</small><strong class="band">${band(pricing.targetBand)}</strong></div>
        </div>
        ${pricing.indicatedBasis ? `<p class="factor-caption">Indication is ${esc(pricing.indicatedBasis)}${pricing.varianceToIndicated != null ? `. The quote sits ${Math.abs(pricing.varianceToIndicated)}% ${pricing.varianceToIndicated < 0 ? 'below' : 'above'} it.` : '.'} Guidance for pricing against, not a rate.</p>` : '<p class="factor-caption">No comparable property risks in this industry group, so there is no peer indication to price against.</p>'}
        <label class="field"><span>Proposed premium (optional)</span><input type="number" min="0" step="100" data-pricing-premium placeholder="${pricing.quoted ?? ''}"></label>
        <label class="field"><span>Terms or conditions</span><input type="text" maxlength="500" data-pricing-terms placeholder="Deductible, sub-limits, warranties"></label>
      </div>

      <label class="field"><span>Rationale <em data-rationale-hint></em></span><textarea rows="3" maxlength="2000" data-rationale placeholder="Why this decision, on this evidence"></textarea></label>
      <label class="field"><span>Decided by</span><input type="text" maxlength="120" data-decided-by placeholder="Your name"></label>
      <div class="decide-actions"><button class="button mint" data-save-decision disabled>Record decision</button><span class="decide-status" data-decide-status></span></div>
    </div>
  </section>`;
}

function demoWorkflowPanel(row) {
  const decision = row.decision ?? (row.verdict === 'work-now' ? 'approve' : row.verdict === 'declined' ? 'decline' : 'refer');
  const label = decision === 'approve' ? 'Approve' : decision === 'decline' ? 'Decline' : 'Refer to senior underwriter';
  return `<section class="workflow demo-workflow" data-demo-case>
    <div class="demo-active-banner"><span class="eyebrow">DEMO SCORING ACTIVE</span><h3>Decision walkthrough</h3><p>The synthetic address and completed schedule are being run through the same appetite engine as a real submission.</p></div>
    <div class="record-metrics"><div><small>Recommendation</small><strong>${esc(label)}</strong></div><div><small>Appetite score</small><strong>${row.score}/100</strong></div><div><small>Factors established</small><strong>${row.evidenceCoverage}%</strong></div></div>
    <p class="factor-caption">This view demonstrates the underwriting reasoning with generated property facts. It cannot save a real decision, request evidence, or change the Federato record.</p>
  </section>`;
}

function demoReviewPanel(row, research) {
  return `<section class="demo-case-brief">
    <div><span class="eyebrow">DEMO PROPERTY SCHEDULE</span><h3>${esc(row.demoLocation.address)}, ${esc(row.demoLocation.city)}, ${esc(row.demoLocation.state)} ${esc(row.demoLocation.zip)}</h3><p>Generated property facts are driving this score, recommendation, Browserbase research, FEMA lookup, weather check, and AI summary.</p></div>
    <div class="demo-brief-score"><small>Appetite score</small><strong>${row.score}/100</strong><span>${row.evidenceCoverage}% established</span></div>
  </section>${research}
  <details class="case-details"><summary>Why this recommendation <span>${row.factors.length} appetite checks</span></summary><div class="factor-list">${row.factors.map(f => `<details class="factor"><summary><span class="factor-status ${esc(f.status)}">${icon(f.status === 'fail' ? 'x' : f.status === 'unknown' ? 'info' : 'check')}</span><span>${esc(f.label)}<small>${esc(statusWords[f.status] ?? f.status)}</small></span><b>${f.points} / ${f.maxPoints}</b>${icon('chevron')}</summary><p>${esc(f.reason)}</p></details>`).join('')}</div></details>`;
}

function signalsPanel(row, rules) {
  const signals = caseSignals(row, rules);
  if (!signals.length) return '';
  return `<div class="section-title"><h3>What stands out</h3><span>${signals.length} signal${signals.length === 1 ? '' : 's'}</span></div>
    <p class="factor-caption">Cross-cutting context the eight appetite factors cannot express. These do not change the score.</p>
    <div class="signal-list">${signals.map(s => `<article class="signal tone-${esc(s.tone)}"><span class="signal-dot"></span><div><strong>${esc(s.headline)}</strong><p>${esc(s.detail)}</p></div></article>`).join('')}</div>`;
}

function relationshipPanel(row) {
  const rel = row.casefile?.relationship;
  if (!rel) return '';
  return `<div class="section-title"><h3>Our relationship with this account</h3><span>${rel.isNewAccount ? 'New account' : `${rel.tenureYears ?? '—'} yr${rel.tenureYears === 1 ? '' : 's'}`}</span></div>
    ${rel.isNewAccount ? '<p class="factor-caption">No prior policies. Nothing in force to protect, and no internal loss history to lean on.</p>' : `
    <div class="record-metrics"><div><small>Policies in force</small><strong>${rel.inForceCount}</strong></div><div><small>Premium in force</small><strong>${money(rel.inForcePremium)}</strong></div><div><small>Other submissions</small><strong>${rel.otherSubmissions}</strong></div><div><small>Lapsed policies</small><strong>${rel.lapsed.length}</strong></div></div>
    ${rel.byLine.length ? `<div class="line-bars">${rel.byLine.map(l => `<div><span>${esc(lineLabels[l.line] ?? title(l.line))}</span><span class="line-track"><i style="width:${rel.inForcePremium > 0 ? Math.round(l.premium / rel.inForcePremium * 100) : 0}%"></i></span><b>${money(l.premium)}</b></div>`).join('')}</div>` : ''}
    ${rel.lapsed.length ? `<p class="gap-note">${icon('alert')} ${rel.lapsed.map(p => `<b>${esc(lineLabels[p.line] ?? title(p.line))}</b> ${esc(title(p.status))}`).join(', ')}. Establish why before extending new capacity.</p>` : ''}
    ${rel.declinedSubmissions.length ? `<p class="factor-caption">Previously turned away: ${rel.declinedSubmissions.map(s => `${esc(s.number)} (${esc(s.line)}, ${esc(s.status)})`).join(', ')}.</p>` : ''}`}`;
}

function propertyLossPanel(row) {
  const loss = row.loss ?? {};
  return `<div class="section-title"><h3>Property loss evidence</h3><span>Used for appetite</span></div>
    <p class="factor-caption">Property policies only, ${esc(loss.windowStart ?? 'start date unavailable')} to ${esc(loss.windowEndExclusive ?? 'end date unavailable')}. Account-wide losses are shown separately.</p>
    <div class="record-metrics"><div><small>Five-year property loss value</small><strong>${loss.historyComplete && loss.valuesComplete ? money(loss.observed) : 'Not established'}</strong></div><div><small>Recorded incurred in this window</small><strong>${money(loss.observed)}</strong></div></div>
    <p class="factor-caption">Policies on file cover ${pct(loss.coverageRatio)} of the window. A period with no records is not proof of no losses.</p>
    ${(loss.gaps ?? []).length ? `<p class="gap-note">Missing periods: ${(loss.gaps ?? []).map(g => `${esc(g.start)} to ${esc(g.end)}`).join('; ')}.</p>` : ''}
    ${(loss.claims ?? []).length ? `<table class="claims"><thead><tr><th>Claim</th><th>Date</th><th>Cause</th><th>Incurred</th></tr></thead><tbody>${loss.claims.map(c => `<tr><td>${esc(c.id)}</td><td>${esc(c.dateOfLoss)}</td><td>${esc(title(c.cause))}</td><td>${money(c.incurred)}</td></tr>`).join('')}</tbody></table>` : '<p class="factor-caption">No property claims were returned for this window.</p>'}`;
}

function lossPanel(row) {
  const account = row.casefile?.lossExperience;
  if (!account?.claimCount) return '<p class="factor-caption">No account claims on file. This does not establish a loss-free history.</p>';
  return `<div class="section-title"><h3>Account loss history</h3><span>All lines &amp; recorded dates</span></div>
    <p class="scope-note">Background context across this account. These totals are not the five-year property loss value used in appetite.</p>
    <div class="record-metrics"><div><small>Claims on account</small><strong>${account.claimCount}</strong></div><div><small>All-line incurred</small><strong>${money(account.totalIncurred)}</strong></div><div><small>Still open</small><strong>${account.openCount}</strong></div><div><small>Open claim incurred (paid + reserves)</small><strong>${money(account.openIncurred)}</strong></div></div>
    <table class="claims"><thead><tr><th>Date</th><th>Line</th><th>Cause</th><th>Status</th><th class="number">Incurred</th></tr></thead><tbody>${account.claims.slice(0, 25).map(c => `<tr${c.open ? ' class="open-row"' : ''}><td>${esc(c.dateOfLoss ?? '—')}</td><td>${esc(lineLabels[c.line] ?? title(c.line))}</td><td>${esc(title(c.cause ?? 'Not stated'))}</td><td>${c.open ? `<span class="open-tag">${esc(c.status)}</span>` : esc(title(c.status ?? 'closed'))}</td><td class="number">${money(c.incurred)}</td></tr>`).join('')}</tbody></table>
    ${account.claims.length > 25 ? `<p class="factor-caption">Showing the 25 most recent of ${account.claims.length} claims.</p>` : ''}`;
}

function exposurePanel(row) {
  const exposure = row.casefile?.exposure;
  if (!exposure?.siteCount) return '';
  return `<div class="section-title"><h3>Where the value sits</h3><span>${exposure.siteCount} site${exposure.siteCount === 1 ? '' : 's'} · ${exposure.buildingCount} building${exposure.buildingCount === 1 ? '' : 's'}</span></div>
    ${exposure.concentration != null ? `<p class="factor-caption">Largest location holds ${pct(exposure.concentration)} of insured value${exposure.sprinkleredShare != null ? ` · ${pct(exposure.sprinkleredShare)} of buildings sprinklered` : ''}${exposure.oldestRoof ? ` · oldest roof ${exposure.oldestRoof}` : ''}.</p>` : ''}
    <table class="claims"><thead><tr><th>Location</th><th>State</th><th class="number">Buildings</th><th class="number">TIV</th><th>Share</th></tr></thead><tbody>${exposure.sites.map(s => `<tr><td>${esc(s.address ?? `Location ${s.id}`)}${s.city ? `<small>${esc(s.city)}${s.county ? `, ${esc(s.county)}` : ''}</small>` : ''}</td><td>${esc(s.state ?? '—')}</td><td class="number">${s.buildingCount}</td><td class="number">${shortMoney(s.tiv)}</td><td><span class="share-track"><i style="width:${Math.round((s.share ?? 0) * 100)}%"></i></span></td></tr>`).join('')}</tbody></table>
    ${exposure.constructionMix.length ? `<div class="line-bars">${exposure.constructionMix.map(m => `<div><span>${esc(m.type)}</span><span class="line-track"><i style="width:${Math.round((m.share ?? 0) * 100)}%"></i></span><b>${pct(m.share)}</b></div>`).join('')}</div>` : ''}`;
}

function buildingPanel(row) {
  if (!row.buildings?.length) return '<p class="scope-note">No linked building records. Request a statement of values and building schedule.</p>';
  return `<div class="section-title"><h3>Building facts</h3><span>Federato property records</span></div><table class="claims"><thead><tr><th>Building / location</th><th>Year built</th><th>Construction</th><th>Occupancy</th><th>Roof updated</th><th>Sprinklers</th></tr></thead><tbody>${row.buildings.map(b => `<tr><td>${esc(b.id)} / ${esc(b.locationId ?? 'Unlinked')}</td><td>${esc(b.yearBuilt ?? 'Missing')}</td><td>${esc(b.constructionType ?? 'Missing')}</td><td>${esc(b.occupancy ?? 'Missing')}</td><td>${esc(b.roofYear ?? 'Missing')}</td><td>${b.sprinklered == null ? 'Missing' : b.sprinklered ? 'Yes' : 'No'}</td></tr>`).join('')}</tbody></table>`;
}

function reviewPanel(row, research = '', version = '', rules = null) {
  const attention = attentionFor(row);
  const tasks = reviewTasks(row);
  if (isHistoricalCase(row)) return `<section class="recommendation"><span>SOURCE HISTORY</span><p>${esc(attention.title)}</p><small>${esc(attention.detail)}</small></section><p class="scope-note">The property tab shows the recorded buildings and loss evidence. AI can explain gaps for reference; these are not new broker requests.</p>${research}`;
  if (row.demoScenario) return demoReviewPanel(row, research);
  return `<section class="recommendation"><span>${icon('shield')} NEXT STEP</span><p>${esc(attention.title)}</p><small>${esc(attention.detail)}</small>${tasks.some(t => t.requestable) ? '<button class="button mint" data-open-request>Prepare evidence request</button>' : ''}</section>
    ${assessmentSummary(row)}${research}${intakePanel(row, version)}
    <div class="section-title"><h3>Review actions</h3><span data-action-count>${tasks.length} open</span></div>
    <p class="factor-caption">Mark evidence received or exceptions reviewed as you work. These actions do not change the underlying appetite facts.</p>
    <details class="request-draft" data-request-draft><summary>Prepare evidence request</summary><p>Editable draft for missing information. Copying does not send it.</p><textarea data-request-text rows="7" aria-label="Evidence request draft">${esc(evidenceRequest(row))}</textarea><button class="button ghost" data-copy-request>Copy request</button><button class="button ghost" data-reset-request>Rebuild from open requests</button></details>
    <div class="task-list">${tasks.map((t, index) => taskCard(t, row, index < 2)).join('') || '<p class="all-clear">No outstanding evidence requests.</p>'}</div>`;
}

function comparablesPanel(row) {
  const peers = row.casefile?.comparables;
  if (!peers?.peerCount) return '';
  return `<div class="section-title"><h3>How it prices against peers</h3><span>NAICS ${esc(peers.industryKey)} · ${peers.peerCount} peer${peers.peerCount === 1 ? '' : 's'}</span></div>
    <p class="factor-caption">Rate per $1,000 of insured value across property risks in the same industry group. A sanity check on pricing, not a rating opinion.</p>
    ${peers.thisRate != null && peers.medianRate != null ? `<div class="record-metrics"><div><small>This submission</small><strong>$${peers.thisRate}</strong></div><div><small>Peer median</small><strong>$${peers.medianRate}</strong></div><div><small>Position</small><strong class="${peers.ratePosition < -15 ? 'alarm' : ''}">${peers.ratePosition > 0 ? '+' : ''}${peers.ratePosition}%</strong></div><div><small>Peer loss ratio</small><strong>${peers.peerMedianLossRatio != null ? `${Math.round(peers.peerMedianLossRatio)}%` : '—'}</strong></div></div>` : ''}
    <table class="claims"><thead><tr><th>Account</th><th class="number">Premium</th><th class="number">TIV</th><th class="number">Rate</th><th class="number">Loss ratio</th></tr></thead><tbody>${peers.peers.slice(0, 8).map(p => `<tr><td>${esc(p.accountName)}<small>${esc(p.submissionNumber)} · insured ${esc(p.insuredId)}</small></td><td class="number">${money(p.premium)}</td><td class="number">${shortMoney(p.tiv)}</td><td class="number">$${p.rate}</td><td class="number">${p.lossRatio != null ? `${p.lossRatio}%` : '—'}</td></tr>`).join('')}</tbody></table>`;
}

function brokerPanel(row) {
  const broker = row.casefile?.broker;
  if (!broker) return '';
  return `<div class="section-title"><h3>Who sent it</h3><span>${broker.resolved && broker.name ? esc(broker.name) : `Broker ${esc(broker.id)}`}${broker.tier ? ` · Tier ${esc(broker.tier)}` : ''}</span></div>
    <div class="record-metrics"><div><small>Submissions in book</small><strong>${broker.submissionCount}</strong></div><div><small>Bound</small><strong>${broker.bound}</strong></div><div><small>Declined or lost</small><strong>${broker.lost}</strong></div><div><small>Hit rate</small><strong>${broker.hitRate != null ? `${broker.hitRate}%` : '—'}</strong></div></div>
    ${broker.byLine.length ? `<p class="factor-caption">Mostly ${broker.byLine.slice(0, 3).map(l => `${esc(lineLabels[l.line] ?? title(l.line))} (${l.count})`).join(', ')}.${broker.resolved ? '' : ' Broker record was not returned by the schema, so tier and region are unavailable.'}</p>` : ''}`;
}

function queueRow(r, i) {
  const property = isPropertyCase(r);
  const next = attentionFor(r).title;
  return `<tr class="row" data-index="${i}" data-id="${esc(r.id)}" data-historical="${isHistoricalCase(r)}" data-verdict="${esc(r.verdict)}" data-group="${group(r)}" data-line="${esc(r.lineOfBusiness)}" data-state="${esc(r.primaryState)}" data-score="${property ? r.score : ''}" data-priority="${property ? r.reviewPriority ?? 0 : 0}" data-tasks="${property ? (r.tasks ?? []).length : 0}" data-premium="${r.premium ?? -1}" data-rank="${r.rank}" data-account="${esc(r.accountName)}" data-submission="${esc(r.submissionNumber)}" data-tiv="${property ? r.tiv ?? '' : ''}" data-next-title="${esc(next)}" data-search="${esc(`${r.submissionNumber} ${r.accountName} ${r.primaryState ?? ''} ${r.lineOfBusiness} ${r.queueStatus}`.toLowerCase())}">
    <td><button class="account-link" data-detail="${i}" aria-label="View ${esc(r.accountName)} submission ${esc(r.submissionNumber)}"><span><strong>${esc(r.accountName)}</strong><small>${esc(r.submissionNumber)}</small><small data-display-rank></small></span></button></td>
    <td>${esc(lineLabels[r.lineOfBusiness] ?? title(r.lineOfBusiness))}<small>Federato: ${esc(title(r.queueStatus))}</small></td>
    <td>${esc(dateLabel(r.effectiveDate))}</td><td class="number">${money(r.premium)}</td>
    <td>${property ? `<span class="badge lane-${esc(r.verdict)}">${esc(laneLabels[r.verdict])}</span><small>${r.evidenceCoverage}% established · ${r.factors.filter(f => f.status === 'fail').length} exceptions</small><small>Appetite points ${r.score}/100</small>` : '<span class="muted-cell">Not evaluated</span><small>Property rules do not apply</small>'}</td>
    <td class="next-action"><span data-queue-next>${esc(next)}</span><small data-queue-work>Not yet reviewed here</small></td>
    <td><button class="icon-button open-record" data-detail="${i}" aria-label="Open ${esc(r.submissionNumber)}">${icon('chevron')}</button></td></tr>`;
}

export function caseTemplate(r, i, report) {
  const property = isPropertyCase(r);
  const hasAddress = r.sites?.some(site => site.address);
  if (property && !isHistoricalCase(r) && !r.demoScenario && !hasAddress) r = demoScenarioFor(r, report.rules);
  return `<template id="record-${i}"><header class="case-bar" data-case-id="${esc(r.id)}" data-demo-case="${Boolean(r.demoScenario)}">
    <button class="case-back" data-close-case>${icon('arrow')}<span>Back to queue</span></button>
    <div class="case-ident"><strong id="record-title">${esc(r.accountName)}</strong><span>${esc(r.submissionNumber)} · ${esc(lineLabels[r.lineOfBusiness] ?? title(r.lineOfBusiness))} · Federato status: ${esc(title(r.queueStatus))}</span></div>
    <div class="case-verdict"><span class="badge lane-${esc(r.verdict)}">${r.demoScenario ? 'Demo scoring' : esc(laneLabels[r.verdict])}</span>${property ? `<div class="case-score"><strong>${r.evidenceCoverage}%</strong><span>factors established</span></div>` : ''}</div></header>
    ${r.demoScenario ? '' : caseSummary(r, resolveResearch(r))}
    ${property ? `<nav class="case-tabs" role="tablist" aria-label="Submission information">
      ${[['review','Review & next steps'],['property','Property details'],['account','Account context · all lines']].map(([key,label],index) => `<button role="tab" data-case-tab="${key}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" aria-controls="case-${key}-${esc(r.id)}" id="tab-${key}-${esc(r.id)}">${label}</button>`).join('')}</nav>` : ''}
    ${property && !isHistoricalCase(r) ? '<div class="mobile-case-actions"><button data-jump-review>Review evidence</button><button data-jump-decision>Decision &amp; terms</button></div>' : ''}
    <div class="case-body${property ? '' : ' context-only'}"><div class="case-main">
      ${property ? `<section data-case-panel="review" id="case-review-${esc(r.id)}" role="tabpanel" aria-labelledby="tab-review-${esc(r.id)}">
        ${reviewPanel(r, researchPanel(r, report.generatedAt), report.generatedAt, report.rules)}
      </section><section data-case-panel="property" id="case-property-${esc(r.id)}" role="tabpanel" aria-labelledby="tab-property-${esc(r.id)}" hidden>
        <p class="scope-note">Property evidence: buildings, insured values and the property loss window used by the commercial property guideline.</p>
        ${exposurePanel(r)}${buildingPanel(r)}${propertyLossPanel(r)}
        <details class="detail-section"><summary>Appetite checks · ${r.factors.length} factors</summary>
        <p class="factor-caption">${r.rawScore} factor points · ${r.scoreCap} score cap. ${r.usesInterpretation ? 'Includes a documented interpretation.' : ''}</p>
        <div class="factor-list">${r.factors.map(f => `<details class="factor"><summary><span class="factor-status ${esc(f.status)}">${icon(f.status === 'fail' ? 'x' : f.status === 'unknown' ? 'info' : 'check')}</span><span>${esc(f.label)}<small>${esc(statusWords[f.status] ?? f.status)}</small></span><b>${f.points} / ${f.maxPoints}</b>${icon('chevron')}</summary><p>${esc(f.reason)}</p><div class="factor-meta">${confidenceChip(f.confidence)}${f.basis === 'interpretation' ? '<span class="chip chip-interp">Interpretation</span>' : ''}</div></details>`).join('')}</div></details>
        <details class="detail-section"><summary>Property pricing comparisons</summary>${comparablesPanel(r) || '<p>No comparable risks available.</p>'}</details>
      </section>` : `<section class="recommendation"><span>OTHER LINE OF BUSINESS</span><p>${esc(lineLabels[r.lineOfBusiness] ?? title(r.lineOfBusiness))} submission</p><small>No appetite model is configured for this line. Property scores, property evidence requests and property pricing guidance are not applied.</small></section>`}
      <section data-case-panel="account" id="case-account-${esc(r.id)}"${property ? ` role="tabpanel" aria-labelledby="tab-account-${esc(r.id)}" hidden` : ''}>
        <p class="scope-note">Account context: the insured's relationship, claims across all lines and broker history. These figures provide background and do not replace property-specific evidence.</p>
        ${signalsPanel(r, report.rules)}${relationshipPanel(r)}${lossPanel(r)}${brokerPanel(r)}
        <details class="source-records"><summary>Source record IDs ${icon('chevron')}</summary><p>${esc(Object.values(r.sources).flat().join(', '))}</p></details>
      </section></div>
      ${property ? `<aside class="case-side"><div class="record-metrics side"><div><small>Submission premium</small><strong>${money(r.premium)}</strong></div><div><small>Property TIV</small><strong>${money(r.tiv)}</strong></div><div><small>Effective date</small><strong>${esc(dateLabel(r.effectiveDate))}</strong></div><div><small>Factors established</small><strong>${r.evidenceCoverage}%</strong></div></div>${isHistoricalCase(r) ? '<p class="scope-note">Reference case. The recorded Federato outcome is shown above; no new underwriting action is recorded here.</p><p data-history-note></p>' : r.demoScenario ? demoWorkflowPanel(r) : workflowPanel(r, report.rules)}</aside>` : ''}
    </div></template>`;
}

export function htmlReport(rawReport) {
  const report = prepare(rawReport);
  const lanes = report.summary.lanes;
  const propertyCount = report.rows.filter(isPropertyCase).length;
  const otherCounts = Object.entries(report.rows.filter(r => !isPropertyCase(r)).reduce((counts, r) => { counts[r.lineOfBusiness] = (counts[r.lineOfBusiness] ?? 0) + 1; return counts; }, {}));
  const lines = [...new Set(report.rows.map(r => r.lineOfBusiness).filter(Boolean))].sort();
  const states = [...new Set(report.rows.map(r => r.primaryState).filter(Boolean))].sort();
  const css = readFileSync(new URL('./federanorth.css', import.meta.url), 'utf8');
  const js = readFileSync(new URL('./dashboard-client.js', import.meta.url), 'utf8');
  const heroImage = `data:image/png;base64,${readFileSync(new URL('../../assets/federanorth-aerial.png', import.meta.url)).toString('base64')}`;

  const rows = report.rows.map(queueRow).join('');
  const details = report.rows.map((r, i) => caseTemplate(r, i, report)).join('');

  const chaseList = report.taskGroups.map(group => `<section class="chase-group"><header><h3>${icon('ask')}${esc(title(group.party))}</h3><span>${group.count} request${group.count === 1 ? '' : 's'} across ${group.submissions.length} submission${group.submissions.length === 1 ? '' : 's'}</span></header>
    <ul>${group.submissions.map(entry => `<li data-chase-account><b>${esc(entry.accountName)}</b> <small>${esc(entry.submissionNumber)}</small><ol>${entry.tasks.map(t => `<li data-chase-task="${esc(t.id)}" data-chase-submission="${esc(t.submissionId)}">${esc(t.question)}</li>`).join('')}</ol></li>`).join('')}</ul></section>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Federanorth · Submission Queue</title><style>${css}</style></head><body>
    ${federanorthShell({ icon, heroImage })}
    <div class="queue-actions"><button data-open-chase>View outstanding evidence requests ${icon('arrow')}</button></div>
    <div class="scope-switch" role="group" aria-label="Submission portfolio"><button data-scope="property" aria-pressed="true">Commercial property <b>${propertyCount}</b></button><button data-scope="other" aria-pressed="false">Other lines <b>${report.rows.length - propertyCount}</b></button><button data-scope="all" aria-pressed="false">All submissions <b>${report.rows.length}</b></button></div>
    <div class="line-breakdown" id="other-line-breakdown" hidden>${otherCounts.map(([key,count]) => `<button data-line-filter="${esc(key)}">${esc(lineLabels[key] ?? title(key))} <b>${count}</b></button>`).join('')}</div>
    <section class="queue-panel" aria-label="Submission queue"><div class="queue-sticky-nav"><div class="panel-heading"><div><h2 id="queue-title">Commercial property</h2><p>Review the next action, then open a case for evidence and context.</p></div><span class="snapshot-label">${icon('clock')} ${esc(dateLabel(report.fetchedAt ?? report.generatedAt))} snapshot</span></div>
    <div class="tabs" id="property-lanes" role="tablist" aria-label="Property appetite"><button class="tab active" role="tab" aria-selected="true" aria-controls="queue-results" data-tab="">All in view <span>${propertyCount}</span></button>${Object.entries(laneLabels).filter(([key]) => key !== 'not-property').map(([lane, label]) => `<button class="tab" role="tab" aria-selected="false" aria-controls="queue-results" data-tab="${lane}">${esc(label)} <span>${lanes[lane] ?? 0}</span></button>`).join('')}</div>
    <div class="queue-filters"><button type="button" class="filters-toggle" id="filters-toggle" aria-expanded="false" aria-controls="filterbar">Filter submissions</button><label class="record-status-label">Show <select id="record-status"><option value="active">Active submissions</option><option value="history">Bound / closed history</option><option value="all">All source statuses</option></select></label><button class="clear-filters" id="clear-filters" hidden>Clear filters</button><label class="sort-label">Sort by <select id="sort"><option value="priority">Review priority</option><option value="score">Appetite fit</option><option value="premium">Premium</option><option value="account">Account name</option></select></label><div class="filterbar" id="filterbar" hidden><label>Line <select id="line"><option value="">All lines in this view</option>${lines.map(l => `<option value="${esc(l)}">${esc(lineLabels[l] ?? title(l))}</option>`).join('')}</select></label><label>State <select id="state"><option value="">All states</option>${states.map(s => `<option>${esc(s)}</option>`).join('')}</select></label><label>Business <select id="group"><option value="">New and renewal</option><option value="new">New business</option><option value="renewal">Renewals</option><option value="unknown">Unverified type</option></select></label></div></div></div>
    <p class="factor-caption" id="ranking-explanation">Ranked by review priority: evidence readiness, premium fit and remaining effort. Switch to appetite fit for highest guideline score.</p>
    <div id="queue-results" role="tabpanel"><div class="table-scroll"><table class="queue-table"><thead><tr><th scope="col">Account / submission</th><th scope="col">Coverage / source status</th><th scope="col">Effective</th><th scope="col" class="number">Premium</th><th scope="col">Property appetite</th><th scope="col">Next step / your work</th><th scope="col"><span class="sr-only">Open record</span></th></tr></thead><tbody id="queue-body">${rows}</tbody></table></div><div class="empty-state" id="empty-state" hidden>${icon('search')}<h3>No submissions match</h3><p>Try another search or clear your filters to see the full queue.</p><button class="button" id="reset-empty">Clear filters</button></div></div>
    <div class="table-footer"><span id="visible-count" aria-live="polite"></span><div class="pagination"><label>Rows per page <select id="page-size"><option>10</option><option selected>15</option><option>25</option><option>50</option></select></label><span id="page-label"></span><button class="icon-button" id="prev-page" aria-label="Previous page">${icon('chevron')}</button><button class="icon-button" id="next-page" aria-label="Next page">${icon('chevron')}</button></div></div></section>
    <footer class="page-footer"><span><span class="footer-dot"></span>Scores reflect the 2025 Commercial Property guidelines</span><button data-method="rules">View scoring methodology ${icon('arrow')}</button></footer></div><footer class="site-footer"><a href="#main">FEDERANORTH<span>+</span></a><p>A clearer view of risk.</p></footer></main>
    <dialog id="record-dialog" class="record-dialog" aria-labelledby="record-title"><button class="icon-button close-dialog" aria-label="Close submission details">${icon('x')}</button><div id="record-content"></div><div class="drawer-footer">Decision support · No policy actions are taken</div></dialog>${details}
    <dialog id="chase-dialog" class="method-dialog" aria-labelledby="chase-title"><button class="icon-button close-dialog" aria-label="Close chase list">${icon('x')}</button><div class="eyebrow">OUTSTANDING REQUESTS</div><h2 id="chase-title">What to chase, and who to ask</h2><p class="method-intro">Every open evidence request across the queue, grouped by who can answer it.</p><button class="button ghost copy-chase" id="copy-chase">${icon('copy')} Copy as text</button><div class="chase-body">${chaseList || '<p class="method-intro">No outstanding requests.</p>'}</div></dialog>
    <dialog id="method-dialog" class="method-dialog" aria-labelledby="method-title"><button class="icon-button close-dialog" aria-label="Close methodology">${icon('x')}</button><div class="eyebrow">COMMERCIAL PROPERTY</div><h2 id="method-title">Appetite &amp; scoring guidelines</h2><p class="method-intro">Transparent rules. Traceable recommendations.</p><section id="rules-section"><h3>How the score works</h3><div class="weight-grid">${Object.entries(report.rules.weights).map(([key, value]) => `<div><span>${esc(title(key.replace(/([A-Z])/g, ' $1')))}</span><b>${value}<small> points</small></b></div>`).join('')}</div><p>Target matches earn full points. Acceptable values earn ${report.rules.acceptableCredit * 100}% when a separate target exists. Missing and failed factors earn zero. Known failures cap the score at ${report.rules.outOfAppetiteScoreCap}; unresolved evidence caps it at ${report.rules.reviewScoreCap}. A favourable reading only earns points when its evidence reaches the <b>${esc(report.rules.minimumScoringConfidence ?? 'inferred')}</b> standard; weaker evidence is escalated instead. Scores are priorities, not probabilities or binding decisions.</p><h3>Interpretations &amp; assumptions</h3><ul>${report.rules.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul></section>
    <section id="sources-section"><h3>Data &amp; sources</h3><p>Guideline source: ${esc(report.rules.source)}</p><p>Data retrieved: ${esc(report.fetchedAt ?? report.generatedAt)}<br>Report generated: ${esc(report.generatedAt)}<br>Mode: ${esc(report.mode)}</p><div class="source-counts">${Object.entries(report.resourceCounts ?? {}).map(([r, count]) => `<span>${esc(r)} <b>${count}</b></span>`).join('')}</div>${report.enrichment ? `<p>External providers: ${esc(report.enrichment.providers.join(', '))} across ${report.enrichment.siteCount} sites, retrieved ${esc(report.enrichment.generatedAt)}. External evidence is advisory and marked unreviewed.</p>` : '<p>Open a property submission to view or refresh location research. Research is saved separately from the source snapshot.</p>'}</section></dialog>
    <div class="toast" id="toast" role="status" hidden></div><script>${js}</script></body></html>`;
}
