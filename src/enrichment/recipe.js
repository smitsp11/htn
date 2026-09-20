// Recipes are declarative data. Values from Federato records are only ever substituted into
// query parameters and form input values, never into selectors or URLs paths, so a record
// cannot alter what a recipe does.
const TOKEN = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

export function fillTemplate(template, target) {
  if (typeof template !== 'string') return template;
  let missing = null;
  const filled = template.replace(TOKEN, (_, key) => {
    const value = target[key];
    if (value == null || value === '') { missing ??= key; return ''; }
    return String(value);
  });
  return missing ? { missing } : filled;
}

export function resolveQuery(query, target) {
  const resolved = {};
  for (const [key, template] of Object.entries(query ?? {})) {
    const value = fillTemplate(template, target);
    if (value && typeof value === 'object') return { missing: value.missing };
    resolved[key] = value;
  }
  return { query: resolved };
}

export function readPath(source, path) {
  return String(path).split('.').reduce((value, part) => {
    if (value == null) return undefined;
    const key = /^\d+$/.test(part) ? Number(part) : part;
    return Array.isArray(value) ? value[key] : value?.[key];
  }, source);
}

export function coerce(raw, type) {
  if (raw == null || raw === '') return null;
  if (type === 'number' || type === 'integer') {
    const digits = String(raw).replace(/[^0-9.\-]/g, '');
    // Text with no digit at all must stay null; stripping it to '' would otherwise read as 0
    // and silently become a year built or a TIV of zero.
    if (!/\d/.test(digits)) return null;
    const parsed = Number(digits);
    if (!Number.isFinite(parsed)) return null;
    return type === 'integer' ? Math.trunc(parsed) : parsed;
  }
  const text = String(raw).trim();
  return text === '' ? null : text;
}

export function extractFields(source, spec, read) {
  const fields = {};
  for (const [name, definition] of Object.entries(spec ?? {})) {
    fields[name] = coerce(read(source, definition, name), definition.type);
  }
  return fields;
}

/** A provider can only run when every field it declares in `requires` is present on the target. */
export function unmetRequirements(provider, target) {
  return (provider.requires ?? []).filter(key => target[key] == null || target[key] === '');
}

export function assertAllowedUrl(rawUrl, hostAllowlist) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Recipe URLs must use https.');
  if (url.username || url.password) throw new Error('Recipe URLs must not carry credentials.');
  if (hostAllowlist?.length && !hostAllowlist.includes(url.hostname)) {
    throw new Error(`Recipe host ${url.hostname} is not in the allowlist.`);
  }
  return url;
}
