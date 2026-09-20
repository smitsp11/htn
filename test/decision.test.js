import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DATA_CONTRACT, REQUIRED_PATHS, validatePlan, validateSchema, fetchAll } from '../src/decision/data.js';
import { normalizeSubmissions, coverageOf } from '../src/decision/normalize.js';
import { scoreSubmission, rankSubmissions } from '../src/decision/scoring.js';
import { buildEscalations, applyEscalations, aggregateTasks, queueSummary } from '../src/decision/escalation.js';
import { generatePlan } from '../src/decision/planner.js';
import { htmlReport } from '../src/decision/report.js';
import { demoScenarioFor } from '../src/decision/demo-locations.js';

const rules = JSON.parse(await readFile(new URL('../config/appetite.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);

function facts() {
  return {
    id: 1, submissionNumber: 'SUB-1', accountName: 'Example', queueStatus: 'received',
    businessTypes: ['new'], lineOfBusiness: 'property', primaryState: 'OH',
    tiv: 75e6, knownTiv: 75e6, premium: 85e3, targetPremium: 90e3, effectiveDate: '2025-01-01',
    exposuresComplete: true, sites: [],
    buildings: [{ id: 1, tiv: 75e6, yearBuilt: 2015, constructionType: 'Joisted Masonry', roofYear: null, locationId: 1 }],
    loss: {
      observed: 0, valuesComplete: true, historyComplete: true, claimIds: [], claims: [],
      openClaims: 0, coverageRatio: 1, coveredDays: 1826, coveredRanges: [], gaps: [], policyCount: 5,
      windowStart: '2020-01-01', windowEndExclusive: '2025-01-01',
    },
    issues: [], sources: { submission: 'Submission:1' },
  };
}
const factor = (result, key) => result.factors.find(f => f.key === key);

test('demo scenario applies synthetic property facts through the same scorer', () => {
  const source = { ...facts(), queueStatus: 'received' };
  const scenario = demoScenarioFor(source, rules);
  assert.equal(scenario.demoScenario, true);
  assert.equal(scenario.evidenceCoverage, 100);
  assert.equal(scenario.sites.length, 1);
  assert.equal(scenario.buildings.length, 1);
  assert.ok(scenario.demoLocation.address);
  assert.equal(scenario.sites[0].geocodable, true);
  assert.notEqual(scenario.score, scoreSubmission(source, rules).score);
});

test('all target criteria with a fully covered loss window score 100; weights sum to 100', () => {
  assert.equal(Object.values(rules.weights).reduce((s, w) => s + w, 0), 100);
  const result = scoreSubmission(facts(), rules);
  assert.equal(result.score, 100);
  assert.equal(result.decision, 'IN_APPETITE');
  assert.equal(buildEscalations(result, rules).verdict, 'work-now');
});

test('premium and TIV boundaries follow inclusive ranges and hard failures cap scores', () => {
  for (const premium of [50000, 175000]) {
    const result = scoreSubmission({ ...facts(), premium }, rules);
    assert.equal(factor(result, 'premium').status, 'pass');
    assert.equal(result.decision, 'IN_APPETITE');
  }
  for (const premium of [49999, 175001]) {
    const result = scoreSubmission({ ...facts(), premium }, rules);
    assert.equal(result.decision, 'OUT_OF_APPETITE');
    assert.ok(result.score <= 39);
  }
  for (const tiv of [50e6, 100e6, 150e6, 150e6 + 1]) {
    const f = facts(); f.tiv = tiv; f.knownTiv = tiv; f.buildings[0].tiv = tiv;
    assert.equal(factor(scoreSubmission(f, rules), 'tiv').status, tiv > 150e6 ? 'fail' : tiv <= 100e6 ? 'target' : 'pass');
  }
});

test('exactly 1990, 100k loss and 50 percent construction require review', () => {
  const cases = [
    f => { f.buildings[0].yearBuilt = 1990; return 'year'; },
    f => { f.loss.observed = 100000; return 'loss'; },
    f => { f.buildings = [{ ...f.buildings[0], tiv: 37.5e6 }, { id: 2, tiv: 37.5e6, yearBuilt: 2015, constructionType: 'Frame' }]; return 'construction'; },
  ];
  for (const mutate of cases) {
    const f = facts(); const key = mutate(f);
    const result = scoreSubmission(f, rules);
    assert.equal(factor(result, key).status, 'unknown');
    assert.equal(result.decision, 'REVIEW_REQUIRED');
    assert.ok(result.score <= 69);
  }
});

test('target year is strictly after 2010; old buildings and renewal business fail', () => {
  for (const [year, status] of /** @type {[number, string][]} */ ([[1989, 'fail'], [1991, 'pass'], [2010, 'pass'], [2011, 'target'], [2090, 'unknown']])) {
    const f = facts(); f.buildings[0].yearBuilt = year;
    assert.equal(factor(scoreSubmission(f, rules), 'year').status, status);
  }
  assert.equal(scoreSubmission({ ...facts(), businessTypes: ['new', 'renewal'] }, rules).decision, 'OUT_OF_APPETITE');
});

test('missing premium cannot use target premium; a partly covered loss window is not loss-free', () => {
  const f = facts();
  f.premium = null;
  f.loss.historyComplete = false; f.loss.coverageRatio = 0.2;
  f.loss.gaps = [{ start: '2020-01-01', end: '2024-01-01', days: 1461 }];
  const result = scoreSubmission(f, rules);
  assert.equal(factor(result, 'premium').status, 'unknown');
  assert.equal(factor(result, 'loss').status, 'unknown');
  assert.match(factor(result, 'loss').reason, /not evidence of a loss-free record/);
  assert.match(factor(result, 'loss').reason, /2020-01-01 to 2024-01-01/);
  f.loss.observed = 100001;
  assert.equal(scoreSubmission(f, rules).decision, 'OUT_OF_APPETITE');
});

test('ISO class 5-6 construction is acceptable and is labelled as an interpretation', () => {
  for (const [type, expected] of [['Fire Resistive', 'pass'], ['Modified Fire Resistive', 'pass'], ['Steel Frame', 'pass'], ['Wood Frame', 'fail']]) {
    const f = facts(); f.buildings[0].constructionType = type;
    assert.equal(factor(scoreSubmission(f, rules), 'construction').status, expected, type);
  }
  const f = facts(); f.buildings[0].constructionType = 'Fire Resistive';
  const result = scoreSubmission(f, rules);
  assert.equal(factor(result, 'construction').basis, 'interpretation');
  assert.equal(result.usesInterpretation, true);
  assert.equal(factor(scoreSubmission(facts(), rules), 'construction').basis, 'guideline');
});

test('a favourable reading below the confidence standard is escalated instead of credited', () => {
  const strict = { ...rules, minimumScoringConfidence: 'verified' };
  // Primary state is INFERRED from TIV weighting, so a verified-only standard must escalate it.
  const result = scoreSubmission(facts(), strict);
  const state = factor(result, 'state');
  assert.equal(state.status, 'unknown');
  assert.equal(state.points, 0);
  assert.match(state.reason, /below the verified standard/);
  assert.ok(state.gap, 'an escalated factor must carry a gap');
  assert.equal(result.decision, 'REVIEW_REQUIRED');
});

test('ranking uses score descending with stable numeric ID ties', () => {
  const good = facts(), review = facts(), bad = facts();
  review.id = 3; review.loss.historyComplete = false;
  bad.id = 2; bad.premium = 10;
  assert.deepEqual(rankSubmissions([bad, review, good], rules).map(r => r.id), [1, 3, 2]);
  assert.deepEqual(rankSubmissions([{ ...good, id: 10 }, { ...good, id: 2 }], rules).map(r => r.id), [2, 10]);
});

test('loss window coverage reports the uncovered ranges to request', () => {
  const start = Date.parse('2020-01-01'), end = Date.parse('2025-01-01');
  const full = coverageOf([{ start, end }], start, end);
  assert.equal(full.ratio, 1);
  assert.deepEqual(full.gaps, []);
  const partial = coverageOf([{ start: Date.parse('2024-01-01'), end }], start, end);
  assert.ok(partial.ratio > 0.19 && partial.ratio < 0.21);
  assert.deepEqual(partial.gaps, [{ start: '2020-01-01', end: '2024-01-01', days: 1461 }]);
  const merged = coverageOf([
    { start: Date.parse('2020-01-01'), end: Date.parse('2022-01-01') },
    { start: Date.parse('2021-01-01'), end: Date.parse('2023-01-01') },
  ], start, end);
  assert.deepEqual(merged.merged, [{ start: '2020-01-01', end: '2023-01-01' }]);
  assert.deepEqual(merged.gaps, [{ start: '2023-01-01', end: '2025-01-01', days: 731 }]);
});

test('lanes separate non-property lines from real property declines', () => {
  const property = facts();
  const otherLine = { ...facts(), id: 2, lineOfBusiness: 'cyber' };
  const declined = { ...facts(), id: 3, premium: 10 };
  const rows = applyEscalations(rankSubmissions([property, otherLine, declined], rules), rules);
  const lane = id => rows.find(r => r.id === id).verdict;
  assert.equal(lane(1), 'work-now');
  assert.equal(lane(2), 'not-property');
  assert.equal(lane(3), 'declined');
  assert.deepEqual(queueSummary(rows).lanes, { 'work-now': 1, 'chase-evidence': 0, declined: 1, 'not-property': 1 });
});

test('review priority ranks a nearly complete submission above one with nothing established', () => {
  const nearlyDone = facts();
  nearlyDone.loss.historyComplete = false; nearlyDone.loss.coverageRatio = 0.2;
  const empty = {
    ...facts(), id: 2, businessTypes: [], premium: null, tiv: null, knownTiv: null,
    primaryState: null, buildings: [], exposuresComplete: false,
    loss: { ...facts().loss, historyComplete: false, coverageRatio: 0 },
    issues: ['No policy is explicitly linked to this submission.'],
  };
  const rows = applyEscalations(rankSubmissions([empty, nearlyDone], rules), rules);
  const near = rows.find(r => r.id === 1), blank = rows.find(r => r.id === 2);
  assert.equal(near.verdict, 'chase-evidence');
  assert.equal(blank.verdict, 'chase-evidence');
  assert.ok(near.reviewPriority > blank.reviewPriority,
    `expected near-complete (${near.reviewPriority}) to outrank empty (${blank.reviewPriority})`);
  assert.equal(near.tasks.length, 1);
  assert.equal(near.tasks[0].factorKey, 'loss');
  assert.ok(near.tasks[0].askOf.includes('prior carrier'));
});

test('outstanding requests group by the party that can answer them', () => {
  const f = facts();
  f.premium = null; f.loss.historyComplete = false; f.loss.coverageRatio = 0;
  const groups = aggregateTasks(applyEscalations(rankSubmissions([f], rules), rules));
  const broker = groups.find(g => g.party === 'broker');
  assert.ok(broker && broker.count >= 2);
  assert.ok(groups.some(g => g.party === 'prior carrier'));
});

function dataset() {
  return {
    Submission: [{ id: 1, submission_number: 'SUB-1', insured: 1, line_of_business: 'property', target_effective_date: '2025-01-01' }],
    Insured: [{ id: 1, name: 'Account', hq: 99 }],
    Policy: [{ id: 1, submission: 1, insured: 1, business_type: 'new', line_of_business: 'property', premium: 85000, currency: 'USD', dates: { effective: '2025-01-01', expiration: '2026-01-01' }, exposure_units: [1, 2], claims: [1, 2, 3, 4] }],
    ExposureUnit: [{ id: 1, kind: 'location', location: 1 }, { id: 2, kind: 'location', location: 1 }],
    Location: [{ id: 1, state: 'OH', buildings: [1, 1], address: '1 Main St', city: 'Columbus', zip: '43004' }, { id: 99, state: 'TX', buildings: [2] }],
    Building: [{ id: 1, tiv: 75e6, year_built: 2015, construction_type: 'Steel Frame' }, { id: 2, tiv: 200e6, year_built: 1900, construction_type: 'Frame' }],
    Claim: [
      { id: 1, policy: 1, date_of_loss: '2020-01-01', paid_indemnity: 10000, paid_expense: 1000, reserve_indemnity: 2000, reserve_expense: 500 },
      { id: 2, policy: 1, date_of_loss: '2019-12-31', paid_indemnity: 1e6, paid_expense: 0, reserve_indemnity: 0, reserve_expense: 0 },
      { id: 3, policy: 1, date_of_loss: '2025-01-01', paid_indemnity: 1e6, paid_expense: 0, reserve_indemnity: 0, reserve_expense: 0 },
      { id: 4, policy: 1, date_of_loss: '2021-01-01', paid_indemnity: 1000, paid_expense: 0, reserve_indemnity: 0, reserve_expense: 0 },
    ],
  };
}

test('joins explicit IDs, deduplicates exposures, ignores HQ and computes incurred losses in the window', () => {
  const [f] = normalizeSubmissions(dataset(), rules);
  assert.equal(f.tiv, 75e6);
  assert.equal(f.buildings.length, 1);
  assert.equal(f.primaryState, 'OH');
  assert.equal(f.loss.observed, 14500);
  assert.deepEqual(f.loss.claimIds, [1, 4]);
  assert.equal(f.loss.historyComplete, false);
  // The only policy on file runs forward from the effective date, so it covers none of the
  // preceding five years: claims exist, but the loss history behind them is unevidenced.
  assert.equal(f.loss.coverageRatio, 0);
  assert.deepEqual(f.loss.gaps, [{ start: '2020-01-01', end: '2025-01-01', days: 1827 }]);
});

test('location addresses are carried through for enrichment keying', () => {
  const [f] = normalizeSubmissions(dataset(), rules);
  assert.equal(f.sites.length, 1);
  assert.equal(f.sites[0].address, '1 Main St');
  assert.equal(f.sites[0].geocodable, true);
  const noAddress = dataset();
  delete noAddress.Location[0].address;
  assert.equal(normalizeSubmissions(noAddress, rules)[0].sites[0].geocodable, false);
});

test('unlinked submissions, unresolved buildings and currencies remain unknown', () => {
  const data = dataset();
  data.Submission.push({ ...data.Submission[0], id: 2 });
  data.Location[0].buildings.push(404);
  let rows = normalizeSubmissions(data, rules);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tiv, null);
  assert.equal(rows[1].premium, null);
  assert.equal(rows[1].tiv, null);
  assert.equal(rows[1].businessTypes.length, 0);
  const other = dataset();
  other.Policy[0].currency = 'CAD';
  rows = normalizeSubmissions(other, rules);
  assert.equal(rows[0].premium, null);
  assert.equal(rows[0].tiv, null);
});

test('pagination retrieves every record even when server page size is below requested size', async () => {
  const source = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const offsets = [];
  const result = await fetchAll({ query: async q => { offsets.push(q.pagination.offset); return { results: source.slice(q.pagination.offset, q.pagination.offset + 2), total: 3 }; } }, { resource: 'Submission', select: ['id'] });
  assert.deepEqual(result, source);
  assert.deepEqual(offsets, [0, 2]);
});

test('pagination rejects duplicate pages and changing totals rather than ranking partial data', async () => {
  await assert.rejects(fetchAll({ query: async () => ({ results: [{ id: 1 }], total: 2 }) }, { resource: 'Submission' }), /duplicate/);
  let calls = 0;
  await assert.rejects(fetchAll({ query: async () => ({ results: [{ id: ++calls }], total: calls === 1 ? 2 : 3 }) }, { resource: 'Submission' }), /changed/);
});

// A schema fixture independent of production artifacts; tests require no credentials.
function schemaFixture() {
  const schema = /** @type {Record<string, any>} */ ({});
  for (const [resource, paths] of Object.entries(DATA_CONTRACT)) {
    schema[resource] = { type: 'object', fields: {} };
    for (const path of paths) {
      let current = schema[resource];
      const parts = path.split('.');
      for (let i = 0; i < parts.length; i++) {
        current.fields[parts[i]] ??= i === parts.length - 1 ? { type: 'string' } : { type: 'object', fields: {} };
        current = current.fields[parts[i]];
      }
    }
  }
  schema.Policy.fields.insured = { type: 'reference', resource: 'Insured', cardinality: 'one' };
  return schema;
}
const planFixture = () => ({ summary: 'Test', queries: Object.entries(DATA_CONTRACT).map(([resource, select]) => ({ resource, select: [...select], purpose: 'Scoring evidence' })) });

test('query validator rejects invented fields, filters, omitted resources and reference traversal', () => {
  const schema = schemaFixture(), plan = planFixture();
  assert.equal(validatePlan(plan, schema), plan);
  for (const path of ['fabricated_field', 'insured.name']) {
    const p = clone(plan);
    p.queries.find(q => q.resource === 'Policy').select.push(path);
    assert.throws(() => validatePlan(p, schema), /invalid select/);
  }
  const p = clone(plan);
  p.queries[0].where = { status: 'bound' };
  assert.throws(() => validatePlan(p, schema), /unsupported/);
  assert.throws(() => validatePlan({ ...plan, queries: plan.queries.slice(1) }, schema), /one query/);
});

test('required fields are mandatory but optional context only degrades the run', () => {
  const schema = schemaFixture();
  const plan = clone(planFixture());
  const policy = plan.queries.find(q => q.resource === 'Policy');
  policy.select = policy.select.filter(p => p !== 'premium');
  assert.throws(() => validatePlan(plan, schema), /missing required Policy fields: premium/);

  const lean = clone(planFixture());
  const location = lean.queries.find(q => q.resource === 'Location');
  location.select = [...REQUIRED_PATHS.Location];
  const validated = validatePlan(lean, schema);
  assert.ok(validated.omittedContext.includes('Location.address'));

  assert.deepEqual(validateSchema(schema), []);
  const reduced = schemaFixture();
  delete reduced.Location.fields.county;
  assert.deepEqual(validateSchema(reduced), ['Location.county']);
  const broken = schemaFixture();
  delete broken.Building.fields.tiv;
  assert.throws(() => validateSchema(broken), /requires Building.tiv/);
});

test('OpenAI planner sends schema/rules with strict JSON, repairs invalid paths, and excludes credentials', async () => {
  const calls = [];
  let attempt = 0;
  const result = await generatePlan(schemaFixture(), rules, { apiKey: 'local-secret', fetchImpl: async (url, options) => {
    calls.push(JSON.parse(options.body));
    const plan = planFixture();
    if (attempt++ === 0) plan.queries[0].select.push('invented');
    return new Response(JSON.stringify({ status: 'completed', model: 'test-model', output: [{ content: [{ type: 'output_text', text: JSON.stringify(plan) }] }] }));
  } });
  assert.equal(result.attempts, 2);
  assert.equal(calls[0].store, false);
  assert.equal(calls[0].text.format.strict, true);
  assert.ok(JSON.parse(calls[0].input).schema.Submission);
  assert.equal(JSON.parse(calls[0].input).appetite.maxTiv, 150e6);
  assert.equal(calls[0].input.includes('local-secret'), false);
  assert.match(JSON.parse(calls[1].input).correction, /invalid select/);
});

test('OpenAI incomplete responses fail before queries run', async () => {
  await assert.rejects(generatePlan(schemaFixture(), rules, { apiKey: 'test', fetchImpl: async () => new Response(JSON.stringify({ status: 'incomplete' })) }), /incomplete/);
});

test('HTML report escapes untrusted account names and surfaces requests and confidence', () => {
  const f = facts();
  f.accountName = '<img src=x onerror=alert(1)>';
  f.loss.historyComplete = false; f.loss.coverageRatio = 0;
  f.loss.gaps = [{ start: '2020-01-01', end: '2025-01-01', days: 1826 }];
  const rows = applyEscalations(rankSubmissions([f], rules), rules);
  const html = htmlReport({ generatedAt: '2025-01-01', mode: 'test', rules, rows, summary: queueSummary(rows), taskGroups: aggregateTasks(rows) });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('Observed incurred loss'));
  assert.ok(html.includes('Why this recommendation'));
  assert.ok(html.includes('data-tab="chase-evidence"'));
  assert.ok(html.includes('prior carrier'.replace('prior', 'Prior')) || html.includes('prior carrier'));
});

test('reports saved by an earlier version still render', () => {
  const legacy = rankSubmissions([facts()], rules).map(row => {
    const { verdict, tasks, reviewPriority, ...rest } = row;
    return rest;
  });
  assert.ok(htmlReport({ generatedAt: '2025-01-01', mode: 'test', rules, rows: legacy }).includes('Ready for review'));

  // An older report stored taskGroups with a submission count rather than a list.
  const stale = { generatedAt: '2025-01-01', mode: 'test', rules, rows: legacy,
    taskGroups: [{ party: 'broker', count: 2, submissions: 2, tasks: [] }] };
  assert.ok(htmlReport(stale).includes('data-tab="work-now"'));
});
