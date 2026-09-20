import test from 'node:test';
import assert from 'node:assert/strict';
import { planQueries, planWarnings } from '../src/decision/plan.js';
import { validatePlan, validateSchema, DATA_CONTRACT, REQUIRED_PATHS } from '../src/decision/data.js';
import { REQUIREMENTS, requirementFor } from '../src/decision/requirements.js';

/** A schema fixture built from the catalogue itself, so it needs no live credentials. */
function schemaFixture({ omit = [], include = [] } = {}) {
  const schema = /** @type {Record<string, any>} */ ({});
  const paths = [...REQUIREMENTS.flatMap(r => [`${r.resource}.${r.path}`, ...(r.candidates ?? []).map(c => `${r.resource}.${c}`)]), ...include];
  for (const full of paths) {
    if (omit.includes(full)) continue;
    const [resource, ...rest] = full.split('.');
    const path = rest.join('.');
    schema[resource] ??= { type: 'object', fields: {} };
    let current = schema[resource];
    const parts = path.split('.');
    for (let i = 0; i < parts.length; i++) {
      current.fields[parts[i]] ??= i === parts.length - 1 ? { type: 'string' } : { type: 'object', fields: {} };
      current = current.fields[parts[i]];
    }
  }
  return schema;
}

test('the catalogue is the single source of the contract and the required-path gate', () => {
  for (const requirement of REQUIREMENTS) {
    assert.ok(requirement.reason, `${requirement.resource}.${requirement.path} must say why it is retrieved`);
    assert.ok(DATA_CONTRACT[requirement.resource].includes(requirement.path));
    assert.equal(
      (REQUIRED_PATHS[requirement.resource] ?? []).includes(requirement.path),
      requirement.required,
      `${requirement.resource}.${requirement.path} required flag must match REQUIRED_PATHS`);
  }
  // Every factor the scorer reports must be backed by at least one retrieved field.
  const factors = new Set(REQUIREMENTS.map(r => r.factor).filter(Boolean));
  for (const key of ['businessType', 'lineOfBusiness', 'state', 'tiv', 'premium', 'year', 'construction', 'loss']) {
    assert.ok(factors.has(key), `no catalogued field backs the ${key} factor`);
  }
});

test('planning is deterministic and satisfies the same gate an LLM plan must pass', () => {
  const schema = schemaFixture();
  const first = planQueries(schema);
  const second = planQueries(schema);
  assert.deepEqual(first, second, 'the same schema must always produce the same plan');
  assert.equal(first.mode, 'deterministic');
  assert.equal(first.unresolved.length, 0);
  assert.equal(first.missingRequired.length, 0);
  assert.equal(validatePlan(first, schema), first);
  assert.deepEqual(validateSchema(schema), []);
});

test('each query explains which appetite factors it supplies', () => {
  const plan = planQueries(schemaFixture());
  const building = plan.queries.find(q => q.resource === 'Building');
  assert.match(building.purpose, /tiv/);
  assert.match(building.purpose, /construction/);
  const broker = plan.queries.find(q => q.resource === 'Broker');
  assert.match(broker.purpose, /case context/);
});

test('an optional field missing from the schema degrades instead of stopping the run', () => {
  const plan = planQueries(schemaFixture({ omit: ['Location.county', 'Building.roof_year'] }));
  assert.equal(plan.missingRequired.length, 0);
  assert.deepEqual(plan.unresolved.map(u => `${u.resource}.${u.path}`).sort(), ['Building.roof_year', 'Location.county']);
  assert.ok(plan.queries.find(q => q.resource === 'Location').select.includes('state'));
  assert.ok(!plan.queries.find(q => q.resource === 'Location').select.includes('county'));
  assert.ok(planWarnings(plan).every(w => w.startsWith('Optional')));
});

test('a missing required field is reported so the caller can stop before querying', () => {
  const plan = planQueries(schemaFixture({ omit: ['Building.tiv', 'Building.building_value'] }));
  assert.equal(plan.missingRequired.length, 1);
  assert.equal(plan.missingRequired[0].path, 'tiv');
  assert.ok(planWarnings(plan).some(w => w.startsWith('Required')));
});

test('TIV falls back to building_value only when tiv is absent from the schema', () => {
  const full = planQueries(schemaFixture());
  const tiv = full.resolved.find(r => r.resource === 'Building' && r.factor === 'tiv');
  assert.equal(tiv.path, 'tiv');
  assert.equal(tiv.substituted, false);

  const fallback = planQueries(schemaFixture({ omit: ['Building.tiv'] }));
  const substituted = fallback.resolved.find(r => r.resource === 'Building' && r.factor === 'tiv');
  assert.equal(substituted.path, 'building_value');
  assert.equal(substituted.substituted, true);
  assert.equal(fallback.missingRequired.length, 0, 'a usable fallback is not a missing requirement');
  // The catalogue records why the substitution is weaker evidence.
  assert.match(requirementFor('Building', 'tiv').note, /understates TIV/);
});

test('selected paths are unique even when a fallback collides with another requirement', () => {
  const plan = planQueries(schemaFixture({ omit: ['Building.tiv'] }));
  const select = plan.queries.find(q => q.resource === 'Building').select;
  assert.equal(new Set(select).size, select.length, 'duplicate select paths would be sent to the API');
  assert.ok(select.includes('building_value'));
});
