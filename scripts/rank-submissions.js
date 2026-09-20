import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { FederatoClient } from '../src/federato.js';
import { generatePlan } from '../src/decision/planner.js';
import { planQueries, planWarnings } from '../src/decision/plan.js';
import { fetchAll, validateSchema, validatePlan } from '../src/decision/data.js';
import { normalizeSubmissions } from '../src/decision/normalize.js';
import { rankSubmissions } from '../src/decision/scoring.js';
import { applyEscalations, aggregateTasks, queueSummary } from '../src/decision/escalation.js';
import { buildCasefiles } from '../src/decision/casefile.js';
import { buildLeads } from '../src/decision/leads.js';
import { attachBriefs } from '../src/decision/brief.js';
import { collectTargets, enabledProviders, enrichSites, loadEnrichmentConfig } from '../src/enrichment/runner.js';
import { applyEnrichment } from '../src/enrichment/apply.js';
import { openBrowserbase } from '../src/browserbase.js';
import { htmlReport, markdownReport } from '../src/decision/report.js';

let browser;
try {
  const { values } = parseArgs({ options: {
    offline: { type: 'string' }, top: { type: 'string', default: '10' },
    enrich: { type: 'boolean', default: false },
    brief: { type: 'boolean', default: false },
    planner: { type: 'string', default: 'deterministic' },
  } });
  if (!['deterministic', 'llm'].includes(values.planner)) throw new Error('--planner must be deterministic or llm.');
  const top = Number(values.top);
  if (!Number.isInteger(top) || top < 1) throw new Error('--top must be a positive integer.');
  const rules = JSON.parse(await readFile(new URL('../config/appetite.json', import.meta.url), 'utf8'));
  const generatedAt = new Date().toISOString();
  const directory = `artifacts/decision/${generatedAt.replace(/[:.]/g, '-')}`;
  await mkdir(directory, { recursive: true });
  let snapshot;
  let schemaGaps = [];
  if (values.offline) {
    snapshot = JSON.parse(await readFile(values.offline, 'utf8'));
    schemaGaps = validateSchema(snapshot.schema);
    validatePlan(snapshot.plan, snapshot.schema);
    console.log(`Replaying snapshot captured ${snapshot.fetchedAt}.`);
  } else {
    const client = new FederatoClient();
    console.log('Discovering live Federato schema…');
    const schema = await client.schema();
    schemaGaps = validateSchema(schema);
    if (schemaGaps.length) console.log(`Optional context not exposed by this schema: ${schemaGaps.join(', ')}`);
    await writeFile(`${directory}/schema.json`, JSON.stringify(schema, null, 2));
    let plan;
    if (values.planner === 'llm') {
      console.log('Asking OpenAI for a query plan from the schema and appetite rules…');
      plan = await generatePlan(schema, rules);
      validatePlan(plan, schema);
    } else {
      // Default: resolve the requirements catalogue against the schema. Same validation gate,
      // no model in the retrieval path, so the plan is reproducible run to run.
      plan = planQueries(schema);
      if (plan.missingRequired.length) {
        throw new Error(`Schema changed: scoring adapter requires ${plan.missingRequired.map(e => `${e.resource}.${e.path}`).join(', ')}.`);
      }
      validatePlan(plan, schema);
      console.log(`Planned queries from the schema: ${plan.summary}`);
      for (const warning of planWarnings(plan)) console.log(`  ${warning}`);
    }
    await writeFile(`${directory}/plan.json`, JSON.stringify(plan, null, 2));
    const data = {};
    for (const query of plan.queries) {
      data[query.resource] = await fetchAll(client, query);
      console.log(`Retrieved ${query.resource}: ${data[query.resource].length}`);
    }
    snapshot = { schema, plan, data, fetchedAt: new Date().toISOString() };
    await writeFile(`${directory}/snapshot.json`, JSON.stringify(snapshot, null, 2));
  }
  let rows = buildLeads(buildCasefiles(applyEscalations(rankSubmissions(normalizeSubmissions(snapshot.data, rules), rules), rules), snapshot.data, rules), snapshot.data, rules);

  let enrichment = null;
  let enrichmentConfig = null;
  if (values.enrich) {
    enrichmentConfig = await loadEnrichmentConfig();
    const providers = enabledProviders(enrichmentConfig);
    const targets = collectTargets(rows).filter(site => site.geocodable);
    if (!providers.length) console.log('No enrichment providers are enabled; skipping external evidence.');
    else if (!targets.length) console.log('No site has enough address detail to enrich; skipping external evidence.');
    else {
      if (providers.some(p => p.transport === 'browser' || p.via === 'browser')) browser = await openBrowserbase();
      console.log(`Enriching ${targets.length} sites with ${providers.map(p => p.name).join(', ')}…`);
      enrichment = await enrichSites(targets, enrichmentConfig, { page: browser?.page });
      await writeFile(`${directory}/enrichment.json`, JSON.stringify(enrichment, null, 2));
      rows = applyEnrichment(rows, enrichment, enrichmentConfig);
      const ok = enrichment.sites.flatMap(s => s.evidence).filter(e => e.status === 'ok').length;
      console.log(`External evidence: ${ok} successful lookups (advisory only; scores unchanged).`);
    }
  }

  if (values.brief) {
    console.log('Generating context for unresolved factors…');
    rows = await attachBriefs(rows);
    const covered = rows.filter(r => r.briefs?.length).length;
    console.log(`Context written for ${covered} submission(s) (advisory only; scores unchanged).`);
  }

  const hash = obj => createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  const report = {
    generatedAt, mode: values.offline ? 'offline replay' : 'live Federato',
    fetchedAt: snapshot.fetchedAt, schemaHash: hash(snapshot.schema), rulesHash: hash(rules),
    rules, plan: snapshot.plan, planner: snapshot.plan?.mode ?? 'llm', schemaGaps,
    resourceCounts: Object.fromEntries(Object.entries(snapshot.data).map(([r, items]) => [r, items.length])),
    summary: queueSummary(rows), taskGroups: aggregateTasks(rows),
    enrichment: enrichment ? { generatedAt: enrichment.generatedAt, providers: enrichment.providerNames, siteCount: enrichment.sites.length } : null,
    rows,
  };
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await writeFile(`${directory}/report.md`, markdownReport(report));
  const dashboard = htmlReport(report);
  await writeFile(`${directory}/report.html`, dashboard);
  await writeFile('artifacts/dashboard.html', dashboard);
  await writeFile('artifacts/dashboard-report.json', JSON.stringify(report));

  const lanes = report.summary.lanes;
  console.log(`\nRanked ${rows.length} submissions.`);
  console.log(`  Ready to work:    ${lanes['work-now']}`);
  console.log(`  Chase evidence:   ${lanes['chase-evidence']}  (${report.summary.totalUpside} score points recoverable)`);
  console.log(`  Declined:         ${lanes.declined}`);
  console.log(`  Not property:     ${lanes['not-property']}`);
  const priority = rows.filter(r => r.verdict !== 'not-property').sort((a, b) => b.reviewPriority - a.reviewPriority || b.score - a.score);
  for (const row of priority.slice(0, top)) {
    console.log(`\n${row.submissionNumber} | ${row.accountName} | ${row.score}/100 | ${row.verdict}${row.reviewPriority ? ` | priority ${row.reviewPriority}` : ''}`);
    console.log(`${row.explanation} ${row.recommendation}`);
    for (const task of (row.tasks ?? []).slice(0, 3)) console.log(`  → [${task.severity}] ${task.question}`);
  }
  console.log(`\nFull reports and evidence: ${directory}/report.html (also .md and .json)`);
} catch (error) {
  // Avoid exposing raw SDK/network errors, secrets or API response bodies.
  const message = String(error.message);
  const safe = /^(OpenAI |Set OPENAI_|Federato |Set FEDERATO_|Set BROWSERBASE_|Schema changed:|Plan |Provider |Recipe |Invalid or oversized |Incomplete |Inconsistent |Missing or duplicate |--top )/.test(message);
  console.error(safe ? message : `Decision engine failed (${error.name}); no new ranking was produced. Check configuration, network access, and input files.`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.release().catch(() => {});
}
