import { isPropertyCase } from './review.js';
import { assessBookConcentration, concentrationStep } from './concentration.js';
import { runBrowserbaseInvestigate } from './investigate-browser.js';

/**
 * Decide whether a live Browserbase session is worth spending on this file.
 * Hard fails and non-property lines refuse; missing addresses also refuse.
 */
export function browserDecisionFor(row) {
  if (!isPropertyCase(row) || row.verdict === 'not-property') {
    return {
      allow: false,
      reason: 'Not a commercial-property file. I am not spending a Browserbase session on it.',
    };
  }
  if (row.verdict === 'declined' || row.factors.some(f => f.status === 'fail')) {
    const fails = row.factors.filter(f => f.status === 'fail').map(f => f.label);
    return {
      allow: false,
      reason: fails.length
        ? `Hard appetite fail already (${fails.join(', ')}). I am not opening a live browser.`
        : 'This file is already declined. I am not opening a live browser.',
    };
  }
  const hasAddress = Boolean(row.sites?.some(site => site.address) || row.demoScenario || row.demoLocation?.address);
  if (!hasAddress) {
    return {
      allow: false,
      reason: 'No linked property address. Request the schedule before a Browserbase lookup.',
    };
  }
  return {
    allow: true,
    reason: 'Still worth time. Opening Browserbase Search + a live Maps/FEMA tab.',
  };
}

/** Deterministic Federato reasoning log — what the agent already knows and what it will do next. */
export function buildInvestigateSteps(row, decision, concentration = null) {
  const steps = [];
  steps.push({
    kind: 'open',
    tone: 'neutral',
    message: `Opening ${row.accountName ?? row.submissionNumber ?? row.id}. Appetite ${row.score ?? '—'}/100 · lane ${row.verdict ?? 'unknown'}.`,
  });

  for (const factor of row.factors ?? []) {
    const tone = factor.status === 'fail' ? 'bad'
      : factor.status === 'unknown' ? 'warn'
        : factor.status === 'target' || factor.status === 'pass' ? 'good'
          : 'neutral';
    steps.push({
      kind: 'factor',
      tone,
      message: `${factor.label}: ${factor.reason ?? factor.status}`,
    });
  }

  const unknowns = (row.factors ?? []).filter(f => f.status === 'unknown');
  if (unknowns.length) {
    steps.push({
      kind: 'gap',
      tone: 'warn',
      message: `Still missing: ${unknowns.map(f => f.label).join(', ')}. Related Federato leads can guide the ask, but they are not proof.`,
    });
  }

  const bookStep = concentrationStep(concentration);
  if (bookStep) steps.push(bookStep);

  const premium = row.premium;
  const tiv = row.tiv ?? row.totalInsuredValue;
  if (decision.allow && (premium != null || tiv != null)) {
    steps.push({
      kind: 'deepen',
      tone: 'good',
      message: `Worth deepening${tiv != null ? ` · TIV context available` : ''}${premium != null ? ` · premium $${Number(premium).toLocaleString('en-US')}` : ''}. Handing off to Browserbase for outside risk.`,
    });
  }

  steps.push({
    kind: decision.allow ? 'browser' : 'refuse',
    tone: decision.allow ? 'good' : 'bad',
    message: decision.reason,
  });

  return steps;
}

export function floodFinding(result) {
  const floods = (result?.sites ?? []).flatMap(site =>
    (site.evidence ?? []).filter(e => e.provider === 'fema-nfhl' && e.status === 'ok')
      .map(e => ({ ...e, address: site.address })));
  if (!floods.length) return null;
  const zones = floods.map(e => e.fields?.floodZone).filter(Boolean);
  const elevated = floods.some(e => String(e.fields?.specialFloodHazardArea ?? '').toLowerCase() === 'yes'
    || /^(A|AE|AH|AO|AR|A99|V|VE)$/i.test(String(e.fields?.floodZone ?? '')));
  return {
    elevated,
    summary: elevated
      ? `Browserbase / FEMA found special flood hazard zone ${zones.join(', ') || 'SFHA'}. Appetite may still like the file — pause and review flood before binding.`
      : `Browserbase / FEMA returned zone ${zones.join(', ') || 'unresolved'}. No special flood hazard flag on the returned records.`,
  };
}

/**
 * Investigate = Federato reasoning + book concentration, then Browserbase only when worth it.
 * @param {Record<string, any>} row
 * @param {{queue?: Record<string, any>[], runBrowser?: typeof runBrowserbaseInvestigate} & Record<string, any>} [options]
 */
export async function investigateSubmission(row, options = {}) {
  const queue = options.queue ?? [];
  const concentration = assessBookConcentration(row, queue);
  const decision = browserDecisionFor(row);
  const steps = buildInvestigateSteps(row, decision, concentration);

  if (!decision.allow) {
    return {
      version: 3,
      submissionId: String(row.id),
      generatedAt: new Date().toISOString(),
      steps,
      browserDecision: 'refused',
      refuseReason: decision.reason,
      liveViewRecommended: false,
      liveViewUrl: null,
      handle: null,
      concentration,
      impact: {
        changed: false,
        summary: concentration.level === 'heavy' || concentration.level === 'caution'
          ? `No live browser. Book check still matters: ${concentration.summary}`
          : 'No live browser. Federato already settled the hard question.',
      },
      research: null,
    };
  }

  const browser = await (options.runBrowser ?? runBrowserbaseInvestigate)(row, options);
  for (const step of browser.steps ?? []) steps.push(step);

  const research = browser.research;
  const flood = floodFinding(research);
  if (flood) {
    steps.push({
      kind: 'finding',
      tone: flood.elevated ? 'warn' : 'good',
      message: flood.summary,
    });
  } else if (browser.browserStatus === 'unavailable') {
    steps.push({
      kind: 'finding',
      tone: 'warn',
      message: 'Browserbase could not finish enrichment. Federato reasoning and the book check still stand.',
    });
  } else if (research?.sites?.length) {
    steps.push({
      kind: 'finding',
      tone: 'neutral',
      message: 'Live Browserbase lookups finished. Review flood and weather sources below — advisory only, not a score change.',
    });
  }

  steps.push({
    kind: 'close',
    tone: 'neutral',
    message: 'A person still decides. Investigate underwrites the file and the book — it does not bind.',
  });

  const impactParts = [];
  if (concentration.level === 'heavy' || concentration.level === 'caution') impactParts.push(concentration.summary);
  if (flood) impactParts.push(flood.summary);
  if (!impactParts.length && research?.sites?.length) impactParts.push('Browserbase research attached to this case for underwriter review.');

  return {
    version: 3,
    submissionId: String(row.id),
    generatedAt: new Date().toISOString(),
    steps,
    browserDecision: browser.browserStatus === 'unavailable' && !browser.liveViewUrl ? 'failed' : 'opened',
    refuseReason: null,
    liveViewRecommended: Boolean(browser.liveViewUrl),
    liveViewUrl: browser.liveViewUrl ?? null,
    handle: browser.handle ?? null,
    concentration,
    search: browser.search ?? null,
    impact: {
      changed: Boolean(flood || concentration.level === 'heavy' || concentration.level === 'caution'),
      elevated: Boolean(flood?.elevated || concentration.level === 'heavy'),
      summary: impactParts.join(' ') || 'Investigate finished. A person still decides.',
    },
    research,
  };
}
