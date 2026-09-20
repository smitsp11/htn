import type { QueryReasoning } from "@/lib/domain/types";

export interface PipelineTraceProps {
  /** RankingsResponse.trace — the human-readable decision-trace lines. */
  trace: string[];
  /** RankingsResponse.queryTrace — the schema-driven query agent's reasoning. */
  queryTrace?: QueryReasoning;
}

/**
 * Plain-English summary of how the query agent reasoned, derived from the
 * structured trace. This is what shows by default; the full step-by-step trace
 * sits behind a toggle for anyone who wants to audit every query.
 */
function summarizeQueryReasoning(qt: QueryReasoning): string[] {
  const resolved = qt.fields.filter((field) => field.schemaPath).length;
  const total = qt.fields.length;
  const queries = qt.steps.filter((step) => step.stage === "query").length;
  const planner = qt.plannedBy === "llm" ? "an LLM planner" : "schema name-matching (no model)";

  const sentences: string[] = [];
  sentences.push(
    `The agent discovered the data schema and chose ${qt.rootResource} as the root resource — it answers more appetite requirements than any other.`,
  );
  sentences.push(
    `Using ${planner}, it mapped ${resolved} of ${total} appetite factors to schema paths` +
      (qt.queueResource ? `, pulling the queue from ${qt.queueResource}` : "") +
      `, then ran ${queries} validated ${queries === 1 ? "query" : "queries"}.`,
  );
  const parts: string[] = [];
  if (qt.unresolved.length > 0) {
    parts.push(`${qt.unresolved.length} factor${qt.unresolved.length === 1 ? "" : "s"} could not be resolved`);
  }
  if (qt.fallbacks.length > 0) {
    parts.push(`${qt.fallbacks.length} fallback${qt.fallbacks.length === 1 ? "" : "s"} filled in where data was missing`);
  }
  if (parts.length > 0) {
    sentences.push(`${parts.join(" and ")} — each is flagged on the rows it affects.`);
  } else {
    sentences.push("Every path was validated against the schema before its query was sent.");
  }
  return sentences;
}

/**
 * Minimal surfacing of the engine's own trace data. "Query reasoning" leads with
 * a plain-English summary and hides the full step trace behind a toggle;
 * "Decision trace" lists the deterministic scoring steps. Everything shown comes
 * straight from the /api/rankings response — nothing is computed here beyond the
 * summary sentences above.
 */
export function PipelineTrace({ trace, queryTrace }: PipelineTraceProps) {
  return (
    <section className="pipeline-trace" aria-label="Pipeline reasoning">
      <details>
        <summary>Query reasoning</summary>
        {queryTrace ? (
          <div className="pipeline-trace-body">
            {summarizeQueryReasoning(queryTrace).map((sentence, index) => (
              <p key={index} className="trace-summary">
                {sentence}
              </p>
            ))}
            <details className="trace-detail">
              <summary>Show full trace</summary>
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
            </details>
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
