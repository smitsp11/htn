import type { QueryTrace } from "@/lib/federato/query-trace";

export interface QueryTraceViewProps {
  trace: QueryTrace;
}

/**
 * Read-only view of the schema-driven query trace (Person 2's UI contribution).
 * Shows the underwriter which data the agent requested and why, and flags any
 * field the schema could not resolve. Styles live in ./query-trace.css and are
 * loaded by the package index, so this file imports no CSS and stays importable
 * under node tests. All class names are prefixed `qt-` to avoid collisions.
 */
export function QueryTraceView({ trace }: QueryTraceViewProps) {
  const resolvedCount = trace.fields.length - trace.unresolvedFields.length;

  return (
    <section className="qt" aria-label="Query trace">
      <header className="qt-header">
        <span className="qt-resource">
          Resource: <strong>{trace.resource}</strong>
          {!trace.resourceResolved && <em className="qt-flag"> (fallback — not confirmed in schema)</em>}
        </span>
        <span className="qt-summary">
          {trace.generatedFromSchema ? "Generated from discovered schema" : "Generated from fixtures"} ·{" "}
          {resolvedCount}/{trace.fields.length} fields resolved
        </span>
      </header>

      <ul className="qt-grid">
        {trace.fields.map((field) => (
          <li
            key={field.field}
            className={`qt-field ${field.resolved ? "qt-resolved" : "qt-unresolved"}`}
            data-resolved={field.resolved}
          >
            <div className="qt-field-top">
              <span className="qt-field-name">{field.field}</span>
              <code className="qt-match">{field.schemaMatch}</code>
            </div>
            <p className="qt-reason">{field.appetiteReason}</p>
            {field.behavior && <p className="qt-behavior">{field.behavior}</p>}
            {field.unresolvedReason && <p className="qt-warning">{field.unresolvedReason}</p>}
          </li>
        ))}
      </ul>

      {trace.assumptions.length > 0 && (
        <details className="qt-assumptions">
          <summary>Assumptions ({trace.assumptions.length})</summary>
          <ul>
            {trace.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
