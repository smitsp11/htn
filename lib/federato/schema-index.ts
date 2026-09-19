/**
 * Runtime index over the schema returned by `{ "action": "schema" }`.
 *
 * Nothing in this file knows about appetite guidelines. It answers three
 * questions the planner needs: which resources exist, does a given path exist,
 * and what does reaching that path require (expansion, array traversal).
 */

export type SchemaNode =
  | { type: "object"; fields: Record<string, SchemaNode>; optional?: boolean }
  | { type: "array"; itemSchema?: SchemaNode; optional?: boolean }
  | { type: "reference"; resource: string; cardinality: "one" | "many"; optional?: boolean }
  | { type: string; optional?: boolean };

export interface ResolvedPath {
  /** Dot path as supplied. */
  path: string;
  /** Resource the path was resolved against. */
  resource: string;
  /** Scalar/array/object type of the final segment. */
  terminalType: string;
  /** Reference hops that must appear in the `expand` stage, outermost first. */
  expandChain: string[];
  /** Path prefixes that fan out (array or `cardinality: "many"`). */
  manyAt: string[];
  /** Resources crossed, in order, starting with the root resource. */
  resourceChain: string[];
}

export interface LeafPath extends ResolvedPath {
  /** Final path segment, e.g. `year_built`. */
  leaf: string;
}

export interface SchemaIndex {
  resources: string[];
  raw: Record<string, SchemaNode>;
  hasResource(resource: string): boolean;
  resolve(resource: string, path: string): ResolvedPath | undefined;
  leaves(resource: string, maxDepth?: number): LeafPath[];
  describe(resource: string): string;
  describeAll(maxFieldsPerResource?: number): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strips the `{ output: [{ data: … }] }` workflow envelope if it is present. */
function unwrapSchemaEnvelope(raw: unknown): Record<string, SchemaNode> {
  let current: unknown = raw;
  for (let depth = 0; depth < 6 && isRecord(current); depth += 1) {
    if (Array.isArray(current.output)) {
      current = current.output[0];
      continue;
    }
    if (isRecord(current.data)) {
      current = current.data;
      continue;
    }
    break;
  }
  if (!isRecord(current)) throw new Error("The schema response did not contain a resource map.");
  const resources: Record<string, SchemaNode> = {};
  for (const [name, node] of Object.entries(current)) {
    if (isRecord(node) && typeof node.type === "string") resources[name] = node as SchemaNode;
  }
  if (Object.keys(resources).length === 0) throw new Error("The schema response described no resources.");
  return resources;
}

export function objectFields(node: SchemaNode | undefined): Record<string, SchemaNode> | undefined {
  if (!node || node.type !== "object") return undefined;
  return (node as { fields?: Record<string, SchemaNode> }).fields;
}

export function referenceTarget(
  node: SchemaNode | undefined,
): { resource: string; cardinality: "one" | "many" } | undefined {
  if (!node || node.type !== "reference") return undefined;
  const reference = node as { resource?: string; cardinality?: "one" | "many" };
  if (!reference.resource) return undefined;
  return { resource: reference.resource, cardinality: reference.cardinality ?? "one" };
}

function fieldsOf(node: SchemaNode | undefined): Record<string, SchemaNode> | undefined {
  if (!node) return undefined;
  if (node.type === "object") return (node as { fields?: Record<string, SchemaNode> }).fields;
  if (node.type === "array") {
    const item = (node as { itemSchema?: SchemaNode }).itemSchema;
    return item?.type === "object" ? (item as { fields?: Record<string, SchemaNode> }).fields : undefined;
  }
  return undefined;
}

export function buildSchemaIndex(raw: unknown): SchemaIndex {
  const resources = unwrapSchemaEnvelope(raw);

  function resolve(resource: string, path: string): ResolvedPath | undefined {
    const root = resources[resource];
    if (!root) return undefined;

    let fields = fieldsOf(root);
    const segments = path.split(".").filter(Boolean);
    const expandChain: string[] = [];
    const manyAt: string[] = [];
    const resourceChain = [resource];
    let terminalType = "object";

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const node = fields?.[segment];
      if (!node) return undefined;

      const prefix = segments.slice(0, index + 1).join(".");
      const isLast = index === segments.length - 1;
      terminalType = node.type;

      if (node.type === "reference") {
        const reference = node as Extract<SchemaNode, { type: "reference" }>;
        expandChain.push(prefix);
        if (reference.cardinality === "many") manyAt.push(prefix);
        const target = resources[reference.resource];
        if (!target) return undefined;
        resourceChain.push(reference.resource);
        fields = fieldsOf(target);
        continue;
      }

      if (node.type === "object") {
        fields = fieldsOf(node);
        continue;
      }

      if (node.type === "array") {
        manyAt.push(prefix);
        fields = fieldsOf(node);
        if (!isLast && !fields) return undefined;
        continue;
      }

      if (!isLast) return undefined;
      fields = undefined;
    }

    return { path, resource, terminalType, expandChain, manyAt, resourceChain };
  }

  function leaves(resource: string, maxDepth = 3): LeafPath[] {
    const found: LeafPath[] = [];
    const walk = (
      node: SchemaNode | undefined,
      prefix: string,
      expandChain: string[],
      manyAt: string[],
      resourceChain: string[],
      depth: number,
    ) => {
      const fields = fieldsOf(node);
      if (!fields || depth > maxDepth) return;
      for (const [name, child] of Object.entries(fields)) {
        const path = prefix ? `${prefix}.${name}` : name;
        if (child.type === "reference") {
          const reference = child as Extract<SchemaNode, { type: "reference" }>;
          if (resourceChain.includes(reference.resource)) continue;
          walk(
            resources[reference.resource],
            path,
            [...expandChain, path],
            reference.cardinality === "many" ? [...manyAt, path] : manyAt,
            [...resourceChain, reference.resource],
            depth + 1,
          );
          continue;
        }
        if (child.type === "object") {
          walk(child, path, expandChain, manyAt, resourceChain, depth);
          continue;
        }
        if (child.type === "array" && fieldsOf(child)) {
          walk(child, path, expandChain, [...manyAt, path], resourceChain, depth);
          continue;
        }
        found.push({
          path,
          leaf: name,
          resource,
          terminalType: child.type,
          expandChain,
          manyAt: child.type === "array" ? [...manyAt, path] : manyAt,
          resourceChain,
        });
      }
    };
    walk(resources[resource], "", [], [], [resource], 0);
    return found;
  }

  function describe(resource: string): string {
    const node = resources[resource];
    const fields = fieldsOf(node);
    if (!fields) return `${resource}: (no fields)`;
    const rendered = Object.entries(fields).map(([name, child]) => {
      if (child.type === "reference") {
        const reference = child as Extract<SchemaNode, { type: "reference" }>;
        return `${name}->${reference.resource}[${reference.cardinality}]`;
      }
      if (child.type === "object") {
        const nested = Object.keys(fieldsOf(child) ?? {}).join("|");
        return `${name}{${nested}}`;
      }
      if (child.type === "array") return `${name}[]`;
      return `${name}:${child.type}`;
    });
    return `${resource}: ${rendered.join(", ")}`;
  }

  function describeAll(maxFieldsPerResource = 40): string {
    return Object.keys(resources)
      .map((resource) => {
        const line = describe(resource);
        const parts = line.split(", ");
        return parts.length > maxFieldsPerResource
          ? `${parts.slice(0, maxFieldsPerResource).join(", ")}, …`
          : line;
      })
      .join("\n");
  }

  return {
    resources: Object.keys(resources),
    raw: resources,
    hasResource: (resource) => Boolean(resources[resource]),
    resolve,
    leaves,
    describe,
    describeAll,
  };
}
