(() => {
  const byId = id => document.getElementById(id);
  const rows = [...document.querySelectorAll('.row')];
  const search = byId('search'), line = byId('line');
  const sort = byId('sort'), pageSize = byId('page-size');
  const sourceStatus = byId('record-status'), otherLineFilter = byId('other-line-filter');
  let scope = 'property', lane = '', page = 1, filtered = [], lastRecordButton;
  const recordDialog = byId('record-dialog'), methodDialog = byId('method-dialog'), chaseDialog = byId('chase-dialog');
  const dialogs = [recordDialog, methodDialog, chaseDialog].filter(Boolean);

  function render(resetPage = true) {
    if (resetPage) page = 1;
    const term = search.value.trim().toLowerCase();
    filtered = rows.filter(row => row.dataset.search.includes(term) &&
      (scope === 'all' || (scope === 'property' ? row.dataset.line === 'property' : row.dataset.line !== 'property')) &&
      (sourceStatus.value === 'all' || (sourceStatus.value === 'history' ? row.dataset.historical === 'true' : row.dataset.historical !== 'true')) &&
      (!line.value || row.dataset.line === line.value) &&
      (!lane || row.dataset.verdict === lane));
    const byRank = (a, b) => +a.dataset.rank - +b.dataset.rank;
    filtered.sort((a, b) =>
      sort.value === 'account' ? a.dataset.account.localeCompare(b.dataset.account) || byRank(a, b) :
      sort.value === 'premium' ? +b.dataset.premium - +a.dataset.premium || byRank(a, b) :
      sort.value === 'priority' ? +b.dataset.priority - +a.dataset.priority || +b.dataset.score - +a.dataset.score || byRank(a, b) :
      +b.dataset.score - +a.dataset.score || byRank(a, b));
    rows.forEach(row => { row.hidden = true; });
    const size = Number(pageSize.value), pages = Math.max(1, Math.ceil(filtered.length / size));
    page = Math.max(1, Math.min(page, pages));
    const start = (page - 1) * size;
    const body = byId('queue-body');
    filtered.forEach((row, index) => { body.append(row); row.hidden = index < start || index >= start + size; });
    byId('visible-count').textContent = filtered.length ? 'Showing ' + (start + 1) + '–' + Math.min(start + size, filtered.length) + ' of ' + filtered.length + ' submissions' : '0 submissions';
    byId('page-label').textContent = page + ' / ' + pages;
    byId('prev-page').disabled = page <= 1;
    byId('next-page').disabled = page >= pages;
    byId('empty-state').hidden = filtered.length > 0;
    document.querySelector('.table-scroll').hidden = filtered.length === 0;
    byId('clear-filters').hidden = !(term || line.value || lane);
    byId('queue-title').textContent = scope === 'property' ? 'Commercial property' : scope === 'other' ? 'Other insurance lines' : 'All submissions';
    byId('property-lanes').hidden = scope !== 'property';
    byId('other-line-breakdown').hidden = scope !== 'other';
    if (otherLineFilter) {
      const activeRows = rows.filter(row => row.dataset.line !== 'property' &&
        (sourceStatus.value === 'all' || (sourceStatus.value === 'history' ? row.dataset.historical === 'true' : row.dataset.historical !== 'true')));
      otherLineFilter.options[0].textContent = `All other lines (${activeRows.length})`;
      [...otherLineFilter.options].slice(1).forEach(option => {
        const count = activeRows.filter(row => row.dataset.line === option.value).length;
        option.textContent = `${option.dataset.lineLabel} (${count})`;
        option.disabled = count === 0;
      });
      otherLineFilter.value = line.value;
    }
    document.querySelectorAll('[data-scope]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scope === scope)));
    document.querySelectorAll('[data-tab]').forEach(tab => {
      const selected = tab.dataset.tab === lane;
      tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const count = rows.filter(row => row.dataset.line === 'property' &&
        (sourceStatus.value === 'all' || (sourceStatus.value === 'history' ? row.dataset.historical === 'true' : row.dataset.historical !== 'true')) &&
        (!tab.dataset.tab || row.dataset.verdict === tab.dataset.tab)).length;
      tab.querySelector('span').textContent = count;
    });
    document.querySelectorAll('[data-lane]').forEach(stat => stat.classList.toggle('active', stat.dataset.lane === lane));
    const selectedNav = lane === 'chase-evidence' ? 'review' : lane === 'work-now' ? 'appetite' : 'queue';
    document.querySelectorAll('[data-nav]').forEach(button => {
      button.classList.toggle('active', button.dataset.nav === selectedNav);
      if (button.dataset.nav === selectedNav) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
  }

  function clear() { search.value = ''; line.value = ''; lane = ''; render(); }
  function focusLane(value) { clear(); lane = value; sort.value = value === 'chase-evidence' ? 'priority' : 'score'; render(); byId('workspace').scrollIntoView({ block: 'start' }); }

  document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => {
    scope = button.dataset.scope; line.value = ''; lane = ''; sort.value = scope === 'other' ? 'account' : 'priority'; render();
  }));
  if (otherLineFilter) otherLineFilter.addEventListener('change', () => { line.value = otherLineFilter.value; render(); });
  [search, line, sort, pageSize, sourceStatus].forEach(element =>
    element.addEventListener(element === search ? 'input' : 'change', () => render()));
  byId('clear-filters').addEventListener('click', clear);
  byId('reset-empty').addEventListener('click', clear);
  byId('prev-page').addEventListener('click', () => { page--; render(false); });
  byId('next-page').addEventListener('click', () => { page++; render(false); });
  document.querySelectorAll('[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => { lane = tab.dataset.tab; render(); });
    tab.addEventListener('keydown', event => {
      const tabs = [...document.querySelectorAll('[data-tab]')]; let index = tabs.indexOf(tab);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault(); tabs[index].click(); tabs[index].focus();
    });
  });
  document.querySelectorAll('[data-lane]').forEach(button => button.addEventListener('click', () => focusLane(button.dataset.lane)));
  document.querySelectorAll('[data-focus-review]').forEach(button => button.addEventListener('click', () => focusLane('chase-evidence')));
  document.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => {
    focusLane(button.dataset.nav === 'review' ? 'chase-evidence' : button.dataset.nav === 'appetite' ? 'work-now' : '');
    byId('sidebar').classList.remove('open'); byId('menu-toggle').setAttribute('aria-expanded', 'false');
  }));
  // --- Underwriter state -----------------------------------------------------
  // Served from disk when the server is running; localStorage keeps a standalone report usable.
  const STORAGE_KEY = 'federanorth-underwriting-state';
  const served = location.protocol.startsWith('http');
  let records = {};

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  }
  function writeLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* private mode */ }
  }
  async function loadRecords() {
    if (!served) { records = readLocal(); return; }
    try {
      const response = await fetch('/api/state');
      if (!response.ok) throw new Error('unavailable');
      records = (await response.json()).records || {};
    } catch { records = readLocal(); }
  }
  function recordFor(id) { return records[String(id)] || { requests: {}, decision: null }; }

  async function persist(action) {
    action.reportVersion = byId('record-content').querySelector('[data-research]')?.dataset.reportVersion;
    const id = String(action.submissionId);
    const record = structuredClone(recordFor(id));
    if (action.type === 'request') {
      record.requests = { ...record.requests, [action.taskId]: action.state };
      if (action.state === 'open') delete record.requests[action.taskId];
    } else if (action.type === 'decision') {
      record.decision = {
        decision: action.decision, rationale: action.rationale, decidedBy: action.decidedBy,
        decidedAt: new Date().toISOString(),
        pricing: { premium: action.pricing.premium === '' ? null : Number(action.pricing.premium), terms: action.pricing.terms },
      };
    } else if (action.type === 'reopen') record.decision = null;
    if (!served) { records[id] = record; writeLocal(); paintQueue(); return { ok: true }; }
    try {
      const response = await fetch('/api/state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
      });
      const payload = await response.json();
      if (!response.ok) return { ok: false, error: payload.error || 'Could not save.' };
      records[id] = payload.record;
      writeLocal();
      paintQueue();
      return { ok: true };
    } catch { return { ok: false, error: 'Server unreachable. Your changes have not been saved; retry when connected.' }; }
  }

  const DECISION_LABELS = { approve: 'Approve', decline: 'Decline', refer: 'Referred to senior underwriter', 'request-info': 'Information requested' };

  function paintQueue() {
    rows.forEach(row => {
      const record = recordFor(row.dataset.id);
      const next = row.querySelector('[data-queue-next]');
      const work = row.querySelector('[data-queue-work]');
      if (record.decision) {
        next.textContent = DECISION_LABELS[record.decision.decision];
        work.textContent = `Recorded by ${record.decision.decidedBy}`;
      } else {
        next.textContent = row.dataset.nextTitle;
        const states = Object.values(record.requests || {});
        const closed = states.filter(state => state === 'answered' || state === 'waived').length;
        const sent = states.filter(state => state === 'sent').length;
        work.textContent = states.length ? `${closed} action(s) closed${sent ? ` · ${sent} awaiting reply` : ''}` : row.dataset.historical === 'true' ? 'Reference only · source already closed' : 'Not yet reviewed here';
      }
    });
  }

  function wireIntake(root) {
    const panel = root.querySelector('[data-evidence-intake]');
    if (!panel) return;
    const status = panel.querySelector('[data-evidence-status]'), proposals = panel.querySelector('[data-evidence-proposals]');
    const extract = panel.querySelector('[data-extract-evidence]'), confirm = panel.querySelector('[data-confirm-evidence]');
    const parameters = { submissionId: panel.dataset.submission, reportVersion: panel.dataset.reportVersion };
    let draft;
    const showDraft = value => {
      draft = value; proposals.replaceChildren();
      panel.querySelector('[data-evidence-confirm]').hidden = !value?.facts?.length;
      if (!value) return;
      for (const fact of value.facts) {
        const article = document.createElement('article'), label = document.createElement('label'), checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.value = fact.id; checkbox.dataset.evidenceFact = ''; checkbox.checked = false;
        label.append(checkbox, document.createTextNode(fact.field + (fact.buildingId ? ' / Building ' + fact.buildingId : '') + ': ' + (fact.previousValue ?? 'Not established') + ' ? ' + fact.value));
        const quote = document.createElement('blockquote'); quote.textContent = fact.quote;
        const citation = document.createElement('small'); citation.textContent = value.source + ' ? ' + value.sourceDate;
        article.append(label, quote, citation);
        if (fact.conflict) { const warning = document.createElement('p'); warning.className = 'research-notice'; warning.textContent = 'Conflicts with an existing value. Resolve the discrepancy before selecting.'; article.append(warning); }
        proposals.append(article);
      }
      status.textContent = value.facts.length ? 'Review each quote and select only facts that apply. Nothing has changed yet.' : 'No supported, cited facts found. Add explicit units, scope and a submission/building match.';
    };
    const post = async data => {
      const response = await fetch('/api/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...parameters, ...data }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not process evidence.'); return result;
    };
    panel.querySelector('[data-evidence-file]').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 60000 || !/\.(txt|md|csv)$/i.test(file.name)) { status.textContent = 'Use a text, Markdown or CSV file up to 60 KB, or paste a PDF excerpt.'; return; }
      const text = await file.text();
      if (text.length > 20000) { status.textContent = 'Use an excerpt of at most 20,000 characters.'; return; }
      panel.querySelector('[data-evidence-text]').value = text;
      panel.querySelector('[data-evidence-source]').value = file.name;
    });
    extract.addEventListener('click', async () => {
      extract.disabled = true; confirm.disabled = true; status.textContent = 'Extracting cited proposals?';
      try { const result = await post({ action: 'extract', source: panel.querySelector('[data-evidence-source]').value, sourceDate: panel.querySelector('[data-evidence-date]').value, text: panel.querySelector('[data-evidence-text]').value }); showDraft(result.draft); }
      catch (error) { status.textContent = error.message; }
      finally { extract.disabled = false; confirm.disabled = false; }
    });
    confirm.addEventListener('click', async () => {
      confirm.disabled = true; extract.disabled = true; status.textContent = 'Saving confirmed evidence and recalculating?';
      try {
        await post({ action: 'confirm', draftId: draft.id, factIds: [...proposals.querySelectorAll('input:checked')].map(x => x.value), confirmedBy: panel.querySelector('[data-evidence-author]').value, rationale: panel.querySelector('[data-evidence-rationale]').value });
        sessionStorage.setItem('federanorth-open-case', parameters.submissionId); location.reload();
      } catch (error) { status.textContent = error.message; confirm.disabled = false; extract.disabled = false; }
    });
    if (!served) { extract.disabled = true; status.textContent = 'Open localhost:3000 to add and confirm evidence.'; return; }
    fetch('/api/evidence?' + new URLSearchParams(parameters)).then(r => r.ok ? r.json() : null).then(result => {
      if (!panel.isConnected || !result?.draft || result.draft.reportVersion !== parameters.reportVersion) return;
      panel.querySelector('[data-evidence-source]').value = result.draft.source;
      panel.querySelector('[data-evidence-date]').value = result.draft.sourceDate;
      panel.querySelector('[data-evidence-text]').value = result.draft.text; showDraft(result.draft);
    }).catch(() => { status.textContent = 'Saved evidence could not load. Retry when connected.'; });
  }

  function wireLiveResearch(root) {
    const panel = root.querySelector('[data-live-research]');
    if (!panel) return;
    const button = panel.querySelector('[data-open-live-research]');
    const status = panel.querySelector('[data-live-research-status]');
    if (!button || button.disabled || !served) return;
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Opening Browserbase Maps and FEMA workspace…';
      try {
        const response = await fetch('/api/live-research', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionId: panel.dataset.submission, mode: panel.dataset.liveMode, reportVersion: root.querySelector('[data-research]')?.dataset.reportVersion }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Live research is unavailable.');
        const view = window.open(payload.liveViewUrl, '_blank', 'noopener,noreferrer');
        status.textContent = view ? `${payload.demo ? 'Demo ' : ''}Browserbase live view opened for ${payload.address}. It expires in ${Math.round(payload.expiresInSeconds / 60)} minutes. ${payload.demo ? 'Do not use demo findings for underwriting.' : ''}` : 'Your browser blocked the live view. Allow pop-ups for localhost and try again.';
      } catch (error) { status.textContent = error.message || 'Live research is unavailable. Retry when connected.'; }
      finally { button.disabled = false; }
    });
  }

  function wireDemoApply(root) {
    const button = root.querySelector('[data-apply-demo]');
    if (!button || !served) return;
    const status = root.querySelector('.demo-warning');
    button.addEventListener('click', async () => {
      button.disabled = true;
      if (status) status.textContent = 'Applying the generated address and complete schedule to this walkthrough…';
      try {
        const response = await fetch('/api/demo-scenario', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionId: root.querySelector('[data-case-id]')?.dataset.caseId, reportVersion: root.querySelector('[data-research]')?.dataset.reportVersion }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Demo walkthrough is unavailable.');
        const template = document.createElement('template');
        template.innerHTML = payload.html;
        const replacement = template.content.firstElementChild;
        if (!replacement) throw new Error('The demo walkthrough could not be rendered.');
        const content = byId('record-content');
        content.replaceChildren(replacement.content.cloneNode(true));
        wireCaseTabs(content);
        wireIntake(content);
        wireCase(content);
        wireDemoApply(content);
        wireLiveResearch(content);
        wireResearch(content.querySelector('[data-research]'));
      } catch (error) {
        if (status) status.textContent = error.message || 'Demo walkthrough is unavailable.';
        button.disabled = false;
      }
    });
  }

  function wireCaseTabs(root) {
    root.querySelector('[data-jump-review]')?.addEventListener('click', () => root.querySelector('.case-body').scrollTo({ top: 0, behavior: 'smooth' }));
    root.querySelector('[data-jump-decision]')?.addEventListener('click', () => {
      const body = root.querySelector('.case-body'), side = root.querySelector('.case-side');
      body.scrollTo({ top: body.scrollTop + side.getBoundingClientRect().top - body.getBoundingClientRect().top, behavior: 'smooth' });
    });
    const tabs = [...root.querySelectorAll('[data-case-tab]')];
    const activate = tab => {
      tabs.forEach(other => { const selected = other === tab; other.setAttribute('aria-selected', String(selected)); other.tabIndex = selected ? 0 : -1; });
      root.querySelectorAll('[data-case-panel]').forEach(panel => { panel.hidden = panel.dataset.casePanel !== tab.dataset.caseTab; });
      root.querySelector('.case-main').scrollTop = 0;
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next != null) { event.preventDefault(); activate(tabs[next]); tabs[next].focus(); }
      });
    });
  }

  function wireResearch(panel, loadSaved = true) {
    if (!panel) return;
    const button = panel.querySelector('[data-run-research]');
    const status = panel.querySelector('[data-research-status]');
    if (panel.dataset.hasLocations !== 'true') return;
    if (!served) {
      button.disabled = true;
      status.textContent = 'Open localhost:3000 to research this submission. Saved evidence is available offline.';
      return;
    }
    const parameters = { submissionId: panel.dataset.submission, reportVersion: panel.dataset.reportVersion };
    let busy = false;
    const request = async method => {
      if (busy) return false;
      busy = true; button.disabled = true;
      if (method === 'POST') {
        status.textContent = 'Researching this submission: checking locations, Browserbase flood records and weather, then writing AI context. This may take a minute.';
        panel.setAttribute('aria-busy', 'true');
      }
      try {
        const response = await fetch('/api/research' + (method === 'GET' ? '?' + new URLSearchParams(parameters) : ''), {
          method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parameters) } : {}),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Research unavailable. Please retry.');
        if (payload.html && panel.isConnected) {
          // Only our escaped, server-rendered component is accepted; no source-page HTML.
          const template = document.createElement('template');
          template.innerHTML = payload.html;
          const replacement = template.content.firstElementChild;
          panel.replaceWith(replacement);
          wireLiveResearch(replacement);
          wireResearch(replacement, false);
          return true;
        }
        return Boolean(payload.result);
      } catch (error) {
        status.textContent = error.message || 'Research unavailable. Please retry.';
        return true; // An unavailable server must not cause an automatic retry loop.
      } finally {
        busy = false; button.disabled = false; panel.removeAttribute('aria-busy');
      }
    };
    button.addEventListener('click', () => request('POST'));
    if (loadSaved) void request('GET').then(found => {
      if (!found && panel.isConnected && panel.dataset.hasResearch !== 'true' && panel.dataset.autoResearch === 'true') void request('POST');
    });
  }

  /** Reflect saved state into an open case: request chips, step marks, decision banner. */
  function paintCase(root) {
    const workflow = root.querySelector('[data-workflow]');
    if (!workflow) return;
    const id = workflow.dataset.submission;
    const record = recordFor(id);
    const total = Number(workflow.dataset.totalTasks);

    let closed = 0;
    root.querySelectorAll('.task[data-task]').forEach(card => {
      const state = record.requests[card.dataset.task] || 'open';
      const isClosed = state === 'answered' || state === 'waived';
      if (isClosed) closed++;
      card.classList.toggle('closed', isClosed);
      card.querySelector('[data-task-state]').textContent = state === 'open' ? '' : state;
      card.querySelectorAll('[data-set-state]').forEach(button =>
        button.classList.toggle('active', button.dataset.setState === state));
    });

    const reviewDone = total === 0 || closed === total;
    const decision = record.decision;
    root.querySelector('[data-review-progress]').textContent = total === 0 ? 'No outstanding review actions.' : `${closed} of ${total} review actions closed.`;
    root.querySelector('[data-action-count]').textContent = `${total - closed} open`;

    const banner = root.querySelector('[data-decided]');
    const form = root.querySelector('[data-decide-form]');
    banner.hidden = !decision;
    form.hidden = Boolean(decision);
    if (decision) {
      banner.querySelector('[data-decided-label]').textContent = DECISION_LABELS[decision.decision];
      banner.querySelector('[data-decided-rationale]').textContent = decision.rationale || 'No rationale recorded.';
      const priced = decision.pricing && decision.pricing.premium != null
        ? ` · proposed premium $${Number(decision.pricing.premium).toLocaleString('en-US')}${decision.pricing.terms ? ` · ${decision.pricing.terms}` : ''}` : '';
      banner.querySelector('[data-decided-meta]').textContent =
        `${decision.decidedBy} · ${new Date(decision.decidedAt).toLocaleString()}${priced}`;
    }

    // Approving with open requests or a hard appetite failure is an exception; require a reason.
    const exception = Number(workflow.dataset.hasFails) > 0 || !reviewDone;
    const approve = root.querySelector('[data-decision="approve"]');
    if (approve) approve.dataset.requiresRationale = String(exception);
    const requestInfo = root.querySelector('[data-decision="request-info"]');
    if (requestInfo) requestInfo.disabled = reviewDone;
  }

  function wireCase(root) {
    const workflow = root.querySelector('[data-workflow]');
    if (!workflow) {
      const note = root.querySelector('[data-history-note]');
      const decision = recordFor(root.querySelector('[data-case-id]')?.dataset.caseId).decision;
      if (note && decision) note.textContent = `Prior local review: ${DECISION_LABELS[decision.decision]} by ${decision.decidedBy}. ${decision.rationale || ''}`;
      return;
    }
    const id = workflow.dataset.submission;
    const status = root.querySelector('[data-decide-status]');
    const saveButton = root.querySelector('[data-save-decision]');
    const rationale = root.querySelector('[data-rationale]');
    const hint = root.querySelector('[data-rationale-hint]');
    const warning = root.querySelector('[data-decision-warning]');
    let chosen = null;
    const author = root.querySelector('[data-decided-by]');
    const premium = root.querySelector('[data-pricing-premium]');
    const draft = root.querySelector('[data-request-text]');
    let draftEdited = false;
    const rebuildRequest = () => {
      const pending = [...root.querySelectorAll('.task[data-requestable="true"]')].filter(card => !['answered', 'waived'].includes(recordFor(id).requests[card.dataset.task]));
      const row = rows.find(r => r.dataset.id === id);
      draft.value = pending.length ? `Subject: Information needed - ${row.dataset.submission} / ${row.dataset.account}\n\nPlease provide the following to complete our commercial property review:\n\n${pending.map((card, index) => `${index + 1}. ${card.querySelector(':scope > p').textContent}`).join('\n')}\n\nPlease include the source documents and dates covered. Thank you.` : '';
      root.querySelector('[data-copy-request]').disabled = !pending.length;
      draft.placeholder = 'No missing evidence remains to request.';
      draftEdited = false;
    };
    draft.addEventListener('input', () => { draftEdited = true; root.querySelector('[data-copy-request]').disabled = !draft.value.trim(); });
    root.querySelector('[data-open-request]')?.addEventListener('click', () => {
      const panel = root.querySelector('[data-request-draft]');
      panel.open = true; panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); draft.focus({ preventScroll: true });
    });
    root.querySelector('[data-reset-request]').addEventListener('click', rebuildRequest);
    root.querySelector('[data-copy-request]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(draft.value); toast('Request copied. Review it before sending.'); }
      catch { draft.focus(); draft.select(); toast('Select and copy the draft text.'); }
    });

    const refreshSave = () => {
      const needs = chosen && root.querySelector(`[data-decision="${chosen}"]`).dataset.requiresRationale === 'true';
      hint.textContent = needs ? '(required)' : '(optional)';
      const chosenButton = chosen && root.querySelector(`[data-decision="${chosen}"]`);
      saveButton.disabled = !chosen || chosenButton.disabled || !author.value.trim() ||
        (needs && rationale.value.trim().length < 10) || (chosen === 'approve' && premium.value !== '' && (!Number.isFinite(Number(premium.value)) || Number(premium.value) < 0));
    };

    root.querySelectorAll('[data-set-state]').forEach(button => button.addEventListener('click', async () => {
      const current = recordFor(id).requests[button.dataset.taskId];
      const next = current === button.dataset.setState ? 'open' : button.dataset.setState;
      const result = await persist({ type: 'request', submissionId: id, taskId: button.dataset.taskId, state: next });
      paintCase(root);
      refreshSave();
      if (!draftEdited) rebuildRequest();
      toast(result.ok ? `Request marked ${next}` : result.error);
    }));

    root.querySelectorAll('[data-decision]').forEach(button => button.addEventListener('click', () => {
      chosen = button.dataset.decision;
      root.querySelector('[data-pricing]').hidden = chosen !== 'approve';
      root.querySelectorAll('[data-decision]').forEach(other => other.classList.toggle('selected', other === button));
      const exception = button.dataset.requiresRationale === 'true';
      warning.hidden = !exception;
      warning.textContent = exception
        ? (chosen === 'approve'
          ? 'This is an exception: either the risk fails appetite or requests are still open. Say why it is acceptable.'
          : 'A written rationale is required for this decision.')
        : '';
      refreshSave();
    }));

    rationale.addEventListener('input', refreshSave);
    author.addEventListener('input', refreshSave);
    premium.addEventListener('input', refreshSave);

    saveButton.addEventListener('click', async () => {
      const decidedBy = root.querySelector('[data-decided-by]').value.trim();
      if (!decidedBy) { status.textContent = 'Add your name before recording.'; status.className = 'decide-status error'; return; }
      saveButton.disabled = true;
      status.textContent = 'Saving…'; status.className = 'decide-status';
      const result = await persist({
        type: 'decision', submissionId: id, decision: chosen,
        rationale: rationale.value.trim(), decidedBy,
        pricing: {
          premium: chosen === 'approve' ? premium.value : null,
          terms: chosen === 'approve' ? root.querySelector('[data-pricing-terms]').value.trim() : '',
        },
      });
      status.textContent = result.ok ? 'Recorded.' : result.error;
      status.className = result.ok ? 'decide-status saved' : 'decide-status error';
      paintCase(root);
      if (result.ok) toast('Decision recorded');
      else refreshSave();
    });

    root.querySelector('[data-reopen]').addEventListener('click', async () => {
      const result = await persist({ type: 'reopen', submissionId: id });
      chosen = null;
      root.querySelector('[data-pricing]').hidden = true;
      root.querySelectorAll('[data-decision]').forEach(other => other.classList.remove('selected'));
      rationale.value = '';
      refreshSave();
      paintCase(root);
      toast(result.ok ? 'Case reopened' : result.error);
    });

    paintCase(root);
    rebuildRequest();
  }

  document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', async () => {
    await recordsReady;
    lastRecordButton = button;
    const content = byId('record-content');
    content.replaceChildren(byId('record-' + button.dataset.detail).content.cloneNode(true));
    wireCaseTabs(content);
    wireIntake(content);
    wireCase(content);
    wireDemoApply(content);
    wireLiveResearch(content);
    wireResearch(content.querySelector('[data-research]'));
    recordDialog.showModal(); recordDialog.scrollTop = 0;
  }));
  recordDialog.addEventListener('close', () => lastRecordButton?.focus());
  document.querySelectorAll('[data-open-chase]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-chase-task]').forEach(item => {
      item.hidden = ['answered', 'waived'].includes(recordFor(item.dataset.chaseSubmission).requests[item.dataset.chaseTask]);
    });
    document.querySelectorAll('[data-chase-account]').forEach(item => { item.hidden = !item.querySelector('[data-chase-task]:not([hidden])'); });
    document.querySelectorAll('.chase-group').forEach(group => {
      const count = group.querySelectorAll('[data-chase-task]:not([hidden])').length;
      const accounts = group.querySelectorAll('[data-chase-account]:not([hidden])').length;
      group.hidden = count === 0;
      group.querySelector('header>span').textContent = `${count} outstanding request(s) across ${accounts} submission(s)`;
    });
    let empty = byId('chase-empty');
    if (!empty) { empty = document.createElement('p'); empty.id = 'chase-empty'; empty.textContent = 'No outstanding evidence requests in active property submissions.'; chaseDialog.append(empty); }
    empty.hidden = Boolean(document.querySelector('.chase-group:not([hidden])'));
    chaseDialog.showModal(); chaseDialog.scrollTop = 0;
  }));
  document.querySelectorAll('[data-method]').forEach(button => button.addEventListener('click', () => {
    methodDialog.showModal(); methodDialog.scrollTop = 0;
    if (button.dataset.method === 'sources') byId('sources-section').scrollIntoView({ block: 'start' });
  }));
  document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  // The full-screen case has its own back control, rendered from the template.
  byId('record-content').addEventListener('click', event => {
    if (event.target.closest('[data-close-case]')) recordDialog.close();
  });
  [methodDialog, chaseDialog].filter(Boolean).forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && !dialogs.some(d => d.open)) {
      event.preventDefault(); search.focus();
    }
  });

  function toast(message) {
    const element = byId('toast');
    element.textContent = message; element.hidden = false;
    setTimeout(() => { element.hidden = true; }, 3000);
  }

  const copyChase = byId('copy-chase');
  if (copyChase) copyChase.addEventListener('click', async () => {
    const text = [...document.querySelectorAll('.chase-group:not([hidden])')].map(group => {
      const heading = group.querySelector('h3').textContent.trim();
      const accounts = [...group.querySelectorAll(':scope > ul > li:not([hidden])')].map(item => {
        const asks = [...item.querySelectorAll('ol > li:not([hidden])')].map(ask => `  - ${ask.textContent.trim()}`);
        return `${item.querySelector('b').textContent} (${item.querySelector('small').textContent})\n${asks.join('\n')}`;
      });
      return `${heading}\n\n${accounts.join('\n\n')}`;
    }).join('\n\n---\n\n');
    try { await navigator.clipboard.writeText(text); toast('Chase list copied'); }
    catch { toast('Copy blocked by the browser'); }
  });

  byId('export-csv').addEventListener('click', () => {
    const csvCell = value => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
    const headers = ['Submission', 'Account', 'Line', 'State', 'Premium USD', 'Property TIV USD', 'Property appetite score', 'Next step', 'Saved decision', 'Decided by'];
    const data = filtered.map(row => { const saved = recordFor(row.dataset.id).decision; return [row.dataset.submission, row.dataset.account, row.dataset.line, row.dataset.state,
      +row.dataset.premium < 0 ? '' : row.dataset.premium, row.dataset.tiv, row.dataset.score, row.querySelector('[data-queue-next]').textContent, saved ? DECISION_LABELS[saved.decision] : '', saved?.decidedBy ?? '']; });
    const csv = [headers, ...data].map(values => values.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = 'federanorth-queue.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported ' + filtered.length + ' submissions');
  });

  sort.value = 'priority';
  render();
  const recordsReady = loadRecords().then(paintQueue);
  recordsReady.then(() => {
    const id = sessionStorage.getItem('federanorth-open-case'); sessionStorage.removeItem('federanorth-open-case');
    if (id) rows.find(r => r.dataset.id === id)?.querySelector('[data-detail]')?.click();
  });
})();
