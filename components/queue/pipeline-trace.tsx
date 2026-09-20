import type { QueryReasoning } from "@/lib/domain/types";

export interface PipelineTraceProps {
  /** RankingsResponse.trace — the human-readable decision-trace lines. */
  trace: string[];
  /** RankingsResponse.queryTrace — the schema-driven query agent's reasoning. */
  queryTrace?: QueryReasoning;
}

/**
 * Minimal, deliberately plain surfacing of the engine's own trace data. The
 * previous dashboard exposed "Query reasoning" and "Decision trace" panels; the
 * federanorth UI dropped them, so this restores that transparency. Everything
 * shown comes straight from the /api/rankings response — nothing is computed here.
 */
export function PipelineTrace({ trace, queryTrace }: PipelineTraceProps) {
  return (
    <section className="pipeline-trace" aria-label="Pipeline reasoning">
      <details>
        <summary>Query reasoning</summary>
        {queryTrace ? (
          <div className="pipeline-trace-body">
            <p>
              Planned by <b>{queryTrace.plannedBy}</b> · root <code>{queryTrace.rootResource}</code>
              {queryTrace.queueResource ? (
                <>
                  {" · queue "}
                  <code>{queryTrace.queueResource}</code>
                </>
              ) : null}
            </p>
            <ol>
              {queryTrace.steps.map((step, index) => (
                <li key={index}>
                  <b>
                    [{step.stage}] {step.title}
                  </b>{" "}
                  — {step.detail}
                </li>
              ))}
            </ol>
            {queryTrace.fields.length > 0 ? (
              <>
                <p>
                  <b>Field resolutions</b>
                </p>
                <ul>
                  {queryTrace.fields.map((field, index) => (
                    <li key={index}>
                      {field.label} ← <code>{field.schemaPath ?? "unresolved"}</code> ({field.chosenBy}) —{" "}
                      {field.reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {queryTrace.unresolved.length > 0 ? (
              <p>
                <b>Unresolved:</b> {queryTrace.unresolved.map((item) => `${item.field} (${item.reason})`).join("; ")}
              </p>
            ) : null}
            {queryTrace.fallbacks.length > 0 ? (
              <p>
                <b>Fallbacks:</b> {queryTrace.fallbacks.join("; ")}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="pipeline-trace-body">No query reasoning was produced (demo mode uses local fixtures).</p>
        )}
      </details>
      <details>
        <summary>Decision trace</summary>
        <ol className="pipeline-trace-body">
          {trace.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}
