import type { QueryReasoning } from "@/lib/domain/types";

export interface QueryTraceViewProps {
  trace: QueryReasoning;
}

/**
 * Read-only view of the query agent's reasoning (Person 2's UI contribution).
 * Shows the underwriter which resource the agent chose, which discovered
 * field answers each appetite requirement and why, what it could not resolve,
 * and the steps it took (queries, repairs, derivations, warnings). Styles live
 * in ./query-trace.css and are loaded globally, so this file imports no CSS and
 * stays importable under node tests. Class names are prefixed `qt-`.
 */
export function QueryTraceView({ trace }: QueryTraceViewProps) {
  const resolved = trace.fields.filter((field) => field.schemaPath).length;
  const total = trace.fields.length + trace.unresolved.length;
  const queries = trace.steps.filter((step) => step.stage === "query").length;
  const repairs = trace.steps.filter((step) => step.stage === "repair").length;
  const warnings = trace.steps.filter((step) => step.stage === "warning").length;

  return (
    <section className="qt" aria-label="Query reasoning">
      <header className="qt-header">
        <span className="qt-resource">
          Root resource: <strong>{trace.rootResource}</strong>
          {trace.queueResource && (
            <>
              {" "}· queue: <strong>{trace.queueResource}</strong>
            </>
          )}
        </span>
        <span className="qt-summary">
          Planned from the discovered schema{trace.plannedBy === "llm" ? " with a model's field choices" : ""} ·{" "}
          {resolved}/{total} requirements resolved · {queries} quer{queries === 1 ? "y" : "ies"}
          {repairs > 0 ? ` · ${repairs} repair${repairs === 1 ? "" : "s"}` : ""}
          {warnings > 0 ? ` · ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}
        </span>
      </header>

      <ul className="qt-grid">
        {trace.fields.map((field) => (
          <li key={field.field} className="qt-field qt-resolved" data-resolved="true">
            <div className="qt-field-top">
              <span className="qt-field-name">{field.label}</span>
              <code className="qt-match">{field.schemaPath}</code>
            </div>
            <p className="qt-reason">{field.appetiteReason}</p>
            {field.requires && <p className="qt-behavior">{field.requires}</p>}
            {field.chosenBy === "llm" && <p className="qt-behavior">Chosen by the planner model; validated against the schema.</p>}
          </li>
        ))}
        {trace.unresolved.map((item) => (
          <li key={item.field} className="qt-field qt-unresolved" data-resolved="false">
            <div className="qt-field-top">
              <span className="qt-field-name">{item.field}</span>
              <code className="qt-match">unresolved</code>
            </div>
            <p className="qt-warning">{item.reason}</p>
          </li>
        ))}
      </ul>

      {trace.fallbacks.length > 0 && (
        <details className="qt-assumptions">
          <summary>Fallbacks ({trace.fallbacks.length})</summary>
          <ul>
            {trace.fallbacks.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="qt-assumptions">
        <summary>Steps ({trace.steps.length})</summary>
        <ol className="qt-steps">
          {trace.steps.map((step, index) => (
            <li key={`${index}-${step.title}`} className={`qt-step qt-step-${step.stage}`}>
              <span className="qt-stage">{step.stage}</span>
              <span className="qt-step-title">{step.title}</span>
              <p className="qt-step-detail">{step.detail}</p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
