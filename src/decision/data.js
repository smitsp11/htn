import { DATA_CONTRACT, REQUIRED_PATHS, RESOURCES } from './requirements.js';

export { DATA_CONTRACT, REQUIRED_PATHS, RESOURCES };

export function fieldAt(schema, resource, path) {
  let field = schema[resource];
  for (const part of path.split('.')) {
    if (field?.type !== 'object' || !Object.hasOwn(field.fields ?? {}, part)) return undefined;
    field = field.fields[part];
  }
  return field;
}

export function validatePlan(plan, schema) {
  const contract = availableContract(schema);
  if (!plan || !Array.isArray(plan.queries) || plan.queries.length !== Object.keys(contract).length) {
    throw new Error('Plan must contain one query per scoring resource.');
  }
  const seen = new Set();
  const omitted = [];
  for (const query of plan.queries) {
    if (!Object.hasOwn(contract, query.resource) || seen.has(query.resource)) throw new Error('Plan contains an unknown or duplicate resource.');
    seen.add(query.resource);
    if (Object.keys(query).some(k => !['resource', 'select', 'purpose'].includes(k))) throw new Error('Plan contains unsupported query keys.');
    if (!Array.isArray(query.select) || query.select.some(p => typeof p !== 'string' || !fieldAt(schema, query.resource, p))) {
      throw new Error(`Plan has invalid select paths for ${query.resource}; do not traverse references or arrays.`);
    }
    // Required paths are non-negotiable; optional context only degrades confidence, so a plan
    // that omits it (or an older snapshot replayed against a newer contract) still runs.
    const missing = (REQUIRED_PATHS[query.resource] ?? []).filter(p => !query.select.includes(p));
    if (missing.length) throw new Error(`Plan missing required ${query.resource} fields: ${missing.join(', ')}.`);
    for (const path of contract[query.resource]) if (!query.select.includes(path)) omitted.push(`${query.resource}.${path}`);
  }
  plan.omittedContext = omitted;
  return plan;
}

export function validateSchema(schema) {
  for (const [resource, paths] of Object.entries(REQUIRED_PATHS)) {
    for (const path of paths) if (!fieldAt(schema, resource, path)) throw new Error(`Schema changed: scoring adapter requires ${resource}.${path}.`);
  }
  const unavailable = [];
  for (const [resource, paths] of Object.entries(DATA_CONTRACT)) {
    for (const path of paths) if (!fieldAt(schema, resource, path)) unavailable.push(`${resource}.${path}`);
  }
  return unavailable;
}

/** Narrow the contract to what the live schema actually exposes, so optional context never breaks a run. */
export function availableContract(schema) {
  return Object.fromEntries(Object.entries(DATA_CONTRACT)
    .map(([resource, paths]) => [resource, paths.filter(path => fieldAt(schema, resource, path))]));
}

export async function fetchAll(client, query, { pageSize = 100, maxRecords = 10000 } = {}) {
  const records = [];
  const seen = new Set();
  let total;
  do {
    const result = await client.query({ resource: query.resource, select: query.select,
      sort: [{ field: 'id', direction: 'asc' }], pagination: { limit: pageSize, offset: records.length } });
    if (!Array.isArray(result?.results) || !Number.isInteger(result.total) || result.total < 0 || result.total > maxRecords) {
      throw new Error(`Invalid or oversized ${query.resource} result; no partial ranking produced.`);
    }
    if (total !== undefined && total !== result.total) throw new Error(`${query.resource} changed during pagination; rerun for a consistent snapshot.`);
    total = result.total;
    if (result.results.length === 0 && records.length < total) throw new Error(`Incomplete ${query.resource} pagination.`);
    for (const record of result.results) {
      if (record?.id == null || seen.has(String(record.id))) throw new Error(`Missing or duplicate ${query.resource} ID during pagination.`);
      seen.add(String(record.id));
      records.push(record);
    }
    if (records.length > total) throw new Error(`Inconsistent ${query.resource} total.`);
  } while (records.length < total);
  return records;
}
