import { needsContext } from './brief.js';
import { attentionFor, isHistoricalCase, isPropertyCase } from './review.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const names = { 'census-geocode': 'Address verification', 'fema-nfhl': 'Flood zone · Browserbase / FEMA', 'nws-conditions': 'Weather location · NWS', 'nws-forecast': 'Local forecast · NWS', 'nws-alerts': 'Active alerts · NWS' };
const JSON_API_HOSTS = new Set(['api.weather.gov', 'geocoding.geo.census.gov', 'hazards.fema.gov']);
const link = reference => {
  try {
    const url = new URL(reference);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const isJson = JSON_API_HOSTS.has(url.hostname) || url.searchParams.get('f') === 'json';
    return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${isJson ? 'View raw data (JSON) ↗' : 'View source ↗'}</a>`;
  } catch { return ''; }
};
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC' : 'Time unavailable';

function evidenceSummary(e) {
  const f = e.fields ?? {};
  if (e.status !== 'ok') return e.status === 'empty' ? 'No matching record returned. Risk remains unverified.' : e.status === 'skipped' ? `Not checked: ${e.detail ?? 'required information unavailable'}.` : 'Source unavailable. Retry research to check again.';
  switch (e.provider) {
    case 'census-geocode': return `${f.matchedAddress ?? 'Address matched'}${f.county ? ` · ${f.county} County` : ''}`;
    case 'fema-nfhl': return f.floodZone ? `Zone ${f.floodZone}${f.floodZoneSubtype ? ` · ${f.floodZoneSubtype}` : ''}. Special flood hazard area: ${f.specialFloodHazardArea ?? 'not established'}.` : 'Flood zone not established.';
    case 'nws-conditions': return `Forecast office ${f.forecastOffice ?? 'unavailable'}`;
    case 'nws-forecast': return `${f.period ?? 'Next period'}: ${f.forecast ?? 'Forecast unavailable'}${f.temperature != null ? ` · ${f.temperature}°${f.temperatureUnit ?? ''}` : ''}${f.wind ? ` · wind ${f.wind}` : ''}${f.precipitationPercent != null ? ` · precipitation chance ${f.precipitationPercent}%` : ''}`;
    case 'nws-alerts': return f.alertCount === 0 ? 'No active NWS alerts returned at retrieval time.' : `${f.alertCount ?? 'Unknown number of'} active alert(s)${f.topAlert ? ` · ${f.topAlert} (${f.topAlertSeverity ?? 'severity unavailable'})` : ''}`;
    default: return Object.entries(f).map(([key, value]) => `${key}: ${value}`).join(' · ');
  }
}

export function resolveResearch(row) {
  let result = row.research ?? null;
  if (!result && row.external?.version >= 2) result = {
    generatedAt: row.external.retrievedAt,
    external: row.external,
    sites: row.external.lookups ?? [],
    briefs: row.briefs ?? [],
    aiStatus: row.briefs?.length ? 'completed' : 'not-run',
  };
  return result;
}

export function researchPanel(row, reportVersion, result = resolveResearch(row)) {
  const locationCount = row.sites?.length ?? 0;
  const demoScenario = Boolean(row.demoScenario);
  const uncertain = row.factors.filter(f => needsContext(f) && f.status !== 'fail');
  const weight = { unknown: 0, fail: 1, pass: 2, target: 2 };
  const briefs = [...(result?.briefs ?? [])].sort((a,b) => (weight[row.factors.find(f => f.key === a.factorKey)?.status] ?? 3) - (weight[row.factors.find(f => f.key === b.factorKey)?.status] ?? 3));
  const liveMode = demoScenario ? 'demo' : locationCount ? 'linked' : 'none';
  const autoResearch = demoScenario || (row.verdict !== 'not-property' && uncertain.length > 0);
  return `<section class="research-panel" data-research data-live-research data-live-mode="${liveMode}" data-demo-scenario="${demoScenario}" data-submission="${esc(row.id)}" data-report-version="${esc(reportVersion)}" data-needs-context="${row.verdict !== 'not-property' && uncertain.length > 0}" data-auto-research="${autoResearch}" data-has-research="${Boolean(result)}" data-has-locations="${locationCount > 0}" aria-label="Submission research">
    <div class="research-heading"><div><span class="eyebrow">BROWSERBASE + WEATHER + AI</span><h3>${demoScenario ? 'Demo location research' : 'Property risk research'}</h3></div><div class="research-actions"><button class="button ghost" data-open-live-research ${locationCount ? '' : 'disabled'}>Open Browserbase</button><button class="button mint" data-run-research ${locationCount ? '' : 'disabled'}>${result ? 'Refresh research' : 'Run research'}</button></div></div>
    <p class="research-confidence">${demoScenario ? `<strong>Demo location:</strong> ${esc(row.demoLocation.address)}, ${esc(row.demoLocation.city)}, ${esc(row.demoLocation.state)} ${esc(row.demoLocation.zip)}. This location powers the visible walkthrough score and research.` : uncertain.length ? `<strong>${uncertain.length} factor${uncertain.length === 1 ? '' : 's'} need stronger evidence.</strong> ${esc(uncertain.map(f => f.label).join(', '))}.` : '<strong>No low-confidence factors identified.</strong> Research can still surface local conditions.'}</p>
    <p class="research-status" data-research-status role="status" aria-live="polite">${result ? '' : demoScenario ? 'Searching the generated location through Browserbase, FEMA, weather sources, and AI context.' : 'Opening an uncertain property case starts research. Results are saved with this submission.'}</p>
    <p class="research-status live-status" data-live-research-status role="status" aria-live="polite"></p>
    ${result?.browserStatus === 'unavailable' ? '<p class="research-notice">Browserbase could not connect. Weather and other available sources are still shown; flood evidence is unavailable.</p>' : ''}
    <div class="research-results">
    ${!locationCount ? researchDigest(row, { sites: [] }) : result ? researchDigest(row, result) : ''}
    ${briefs.length ? `<div class="research-ai"><h4>AI notes <span>${briefs.length}</span></h4>${briefs.map(b => `<details class="brief ai-note"><summary><strong>${esc(row.factors.find(f => f.key === b.factorKey)?.label ?? b.factorKey)}</strong><span>AI context</span></summary><p>${esc(b.reading)}</p><p class="brief-watch"><b>Verify next:</b> ${esc(b.watchFor)}</p>${b.basedOn?.length ? `<p class="brief-basis">Based on: ${esc(b.basedOn.join(' / '))}</p>` : ''}</details>`).join('')}</div>` : result ? `<p class="research-notice">${result.aiStatus === 'not-needed' ? 'No uncertain or failed property factors need an AI note.' : result.aiStatus === 'unavailable' ? 'AI context is unavailable. Review the source evidence below or retry research.' : 'The AI returned no usable context. The source evidence remains available.'}</p>` : ''}
    ${(result?.external?.conflicts ?? []).map(c => `<p class="research-notice">Location ${esc(c.siteId)}: ${esc(c.provider)} reports ${esc(c.field)} as ${esc(c.external)}; Federato reports ${esc(c.federato.join(', '))}. Confirm the correct value.</p>`).join('')}
    ${(result?.external?.flags ?? []).map(f => `<p class="research-notice">Location ${esc(f.siteId)}: ${esc(f.message)} (${esc(f.value)}). Review before proceeding.</p>`).join('')}
    ${result?.sites?.length ? `<details class="research-sources"${briefs.length ? '' : ' open'}><summary>Weather and property sources · ${result.sites.length} location(s)</summary>${result.sites.map(site => `<section class="research-site"><h4>${esc(site.address || `Location ${site.siteId}`)}</h4><small>Location ${esc(site.siteId)} · ${esc(site.coordinateBasis)}</small>${site.evidence.filter(e => e.provider !== 'nws-conditions').map(e => `<article class="research-source"><header><b>${esc(names[e.provider] ?? e.provider)}</b><span>${esc(e.status === 'ok' ? 'Retrieved · unreviewed' : e.status)}</span></header><p>${esc(evidenceSummary(e))}</p><small>${esc(date(e.retrievedAt))}${e.fields?.endsAt ? ` · Forecast ends ${esc(date(e.fields.endsAt))}` : ''}${e.fields?.topAlertExpires ? ` · Alert expires ${esc(date(e.fields.topAlertExpires))}` : ''} ${link(e.reference)}</small></article>`).join('')}</section>`).join('')}</details>` : result ? '<p>No linked property locations are available. Request a property schedule before location research.</p>' : ''}
    </div>
  </section>`;
}

function researchDigest(row, result) {
  const sites = result.sites ?? [];
  if (!sites.length) {
    const propertyIssue = row.issues?.find(issue => /locations|exposure/i.test(issue));
    const historicalProperty = row.casefile?.relationship?.byLine?.find(line => line.line === 'property');
    return `<section class="research-digest research-blocked"><h4>Research is waiting for a property location</h4><p>This is a Federato data-linkage gap, not a finding that the property is safe or unsafe. ${esc(propertyIssue ?? 'No current property location is linked to this submission.')}</p><ul><li><b>Required next step:</b> confirm the property schedule, address, city, state and insured building IDs for this submission.</li><li><b>Why we stop here:</b> Maps, FEMA and weather evidence must be tied to the current insured location. An address from a different policy or line would be misleading.</li>${historicalProperty ? `<li><b>Account context:</b> Federato shows ${historicalProperty.count} property policy record(s) elsewhere on this account, but their locations are reference history until linked to this submission.</li>` : ''}</ul><small>Once the location is linked, research will run address matching, Browserbase/FEMA checks and current weather lookups.</small></section>`;
  }
  const checks = sites.flatMap(site => site.evidence.map(e => ({ ...e, address: site.address, coordinateBasis: site.coordinateBasis })));
  const successful = checks.filter(e => e.status === 'ok');
  const floods = successful.filter(e => e.provider === 'fema-nfhl');
  const alerts = successful.filter(e => e.provider === 'nws-alerts');
  const condition = successful.find(e => e.provider === 'nws-forecast');
  const conflicts = result.external?.conflicts ?? [];
  const flood = floods.length ? floods.map(e => `${esc(e.address || `Location ${e.siteId}`)}: zone ${esc(e.fields?.floodZone ?? 'unavailable')}`).join('; ') : 'Not returned';
  const weather = alerts.length ? alerts.map(e => evidenceSummary(e)).join('; ') : condition ? evidenceSummary(condition) : 'Not returned';
  return `<section class="research-digest"><div class="digest-heading"><h4>Research at a glance</h4><span>${successful.length}/${checks.length} checks returned</span></div>
    <div class="digest-grid"><div><small>Location match</small><strong>${successful.filter(e => e.provider === 'census-geocode').length ? 'Verified' : 'Unverified'}</strong></div><div><small>FEMA flood zone</small><strong>${flood}</strong></div><div><small>Current weather</small><strong>${weather}</strong></div></div>
    ${conflicts.length ? `<p class="research-notice">${conflicts.length} source conflict${conflicts.length === 1 ? '' : 's'} needs review before relying on the result.</p>` : ''}</section>`;
}

/** A single-glance synthesis for the top of a case: appetite state plus, once research has run, the headline field findings and AI watch items. Pure presentation over already-computed data â€” no new lookups or AI calls. */
export function caseSummary(row, result = resolveResearch(row)) {
  if (!isPropertyCase(row)) return '';
  const attention = attentionFor(row);
  const failed = row.factors.filter(f => f.status === 'fail').length;
  const missing = row.factors.filter(f => f.status === 'unknown').length;
  const chips = [`${row.evidenceCoverage}% established`, missing ? `${missing} gap${missing === 1 ? '' : 's'}` : null, failed ? `${failed} exception${failed === 1 ? '' : 's'}` : null].filter(Boolean);

  const checks = (result?.sites ?? []).flatMap(site => site.evidence.map(e => ({ ...e, address: site.address })));
  const flood = checks.find(e => e.provider === 'fema-nfhl' && e.status === 'ok');
  const alerts = checks.filter(e => e.provider === 'nws-alerts' && e.status === 'ok' && e.fields?.alertCount > 0);
  if (flood) chips.push(`Flood zone ${esc(flood.fields?.floodZone ?? 'unresolved')}`);
  if (alerts.length) chips.push(`${alerts.reduce((n, e) => n + e.fields.alertCount, 0)} active weather alert${alerts.length === 1 && alerts[0].fields.alertCount === 1 ? '' : 's'}`);

  const briefs = result?.briefs ?? [];
  const topBrief = briefs.find(b => row.factors.find(f => f.key === b.factorKey)?.status !== 'pass') ?? briefs[0];

  return `<section class="case-summary">
    <p class="case-summary-headline">${esc(attention.title)}</p>
    <div class="case-summary-chips">${chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>
    ${topBrief ? `<p class="case-summary-watch"><b>AI watch item:</b> ${esc(topBrief.watchFor)}</p>` : !result && !isHistoricalCase(row) ? `<p class="case-summary-watch">Run research below to bring in flood, weather and AI context.</p>` : ''}
  </section>`;
}
