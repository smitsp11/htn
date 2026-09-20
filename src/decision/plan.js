import { REQUIREMENTS, RESOURCES, REQUIRED_PATHS } from './requirements.js';
import { fieldAt } from './data.js';

/**
 * Deterministic query planner.
 *
 * Resolves the requirements catalogue against the discovered schema and emits the query plan
 * directly. No model sits in the retrieval path, so the same schema always produces the same
 * plan: it cannot fail on a network hiccup, cannot vary between runs, and cannot be steered by
 * anything embedded in the schema it is reading.
 *
 * Unresolved paths are recorded, never invented. A required path that cannot be resolved is
 * reported so the caller can stop before any query runs.
 */
export function planQueries(schema) {
  const resolved = [];
  const unresolved = [];

  for (const requirement of REQUIREMENTS) {
    const candidates = requirement.candidates ?? [requirement.path];
    const matched = candidates.find(candidate => fieldAt(schema, requirement.resource, candidate));
    if (matched) {
      resolved.push({ ...requirement, matchedPath: matched, substituted: matched !== requirement.path });
    } else {
      unresolved.push({
        resource: requirement.resource, path: requirement.path, required: requirement.required,
        reason: `${requirement.resource}.${candidates.join(' | ')} is not present in the discovered schema.`,
      });
    }
  }

  const byResource = new Map();
  for (const entry of resolved) {
    if (!byResource.has(entry.resource)) byResource.set(entry.resource, []);
    byResource.get(entry.resource).push(entry);
  }

  const queries = RESOURCES
    .filter(resource => byResource.has(resource))
    .map(resource => {
      const entries = byResource.get(resource);
      const factors = [...new Set(entries.map(e => e.factor).filter(Boolean))];
      return {
        resource,
        // Dedupe: a substituted candidate can collide with another requirement's path.
        select: [...new Set(entries.map(e => e.matchedPath))],
        purpose: factors.length
          ? `Supplies the ${factors.join(', ')} factor${factors.length === 1 ? '' : 's'}, plus joins and case context.`
          : 'Supplies joins and case context for the workup.',
      };
    });

  return {
    mode: 'deterministic',
    summary: `Resolved ${resolved.length} of ${REQUIREMENTS.length} catalogued fields across ${queries.length} resources directly from the discovered schema.`,
    queries,
    resolved: resolved.map(e => ({ resource: e.resource, path: e.matchedPath, factor: e.factor ?? null, reason: e.reason, substituted: e.substituted })),
    unresolved,
    missingRequired: unresolved.filter(entry => entry.required),
  };
}

/** Human-readable notes on anything the schema could not satisfy. */
export function planWarnings(plan) {
  return plan.unresolved.map(entry =>
    `${entry.required ? 'Required' : 'Optional'} field ${entry.resource}.${entry.path} is unavailable: ${entry.reason}`);
}
