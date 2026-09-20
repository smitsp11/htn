import type { SourceStatus } from "@/lib/federato/status";

export interface SourceStatusPanelProps {
  status: SourceStatus;
}

type Tone = "ok" | "warn" | "idle";

interface Indicator {
  label: string;
  value: string;
  tone: Tone;
}

function boolTone(value: boolean): Tone {
  return value ? "ok" : "warn";
}

/**
 * Read-only, server-renderable connection status for the Federato source.
 * Shows only safe diagnostics (configured/authenticated/schema reachable, last
 * success timestamp, record/page counts, last error category) — never secrets.
 *
 * Styles live in ./source-status.css and are loaded by ./index.ts so this file
 * stays importable in node tests (it imports no CSS itself).
 */
export function SourceStatusPanel({ status }: SourceStatusPanelProps) {
  const modeLabel = status.demoMode ? "Demo fixtures" : "Federato API";

  const indicators: Indicator[] = [
    { label: "Configured", value: status.configured ? "Yes" : "No", tone: boolTone(status.configured) },
    {
      label: "Authenticated",
      value: status.demoMode ? "n/a (demo)" : status.authenticated ? "Yes" : "No",
      tone: status.demoMode ? "idle" : boolTone(status.authenticated),
    },
    {
      label: "Schema reachable",
      value: status.demoMode ? "n/a (demo)" : status.schemaReachable ? "Yes" : "No",
      tone: status.demoMode ? "idle" : boolTone(status.schemaReachable),
    },
  ];

  return (
    <section className="src-status" aria-label="Federato source status">
      <header className="src-header">
        <span className={`src-mode src-mode-${status.demoMode ? "demo" : "live"}`}>{modeLabel}</span>
        {status.lastErrorCategory ? (
          <span className="src-error">Last issue: {status.lastErrorCategory}</span>
        ) : null}
      </header>

      <ul className="src-indicators">
        {indicators.map((indicator) => (
          <li key={indicator.label} className={`src-indicator src-tone-${indicator.tone}`}>
            <span className="src-dot" aria-hidden="true" />
            <span className="src-indicator-label">{indicator.label}</span>
            <strong className="src-indicator-value">{indicator.value}</strong>
          </li>
        ))}
      </ul>

      <dl className="src-metrics">
        <div className="src-metric">
          <dt>Records retrieved</dt>
          <dd>{status.lastRecordCount ?? "—"}</dd>
        </div>
        <div className="src-metric">
          <dt>Pages walked</dt>
          <dd>{status.lastPageCount ?? "—"}</dd>
        </div>
        <div className="src-metric">
          <dt>Last successful request</dt>
          <dd>{status.lastSuccessfulRequestAt ?? "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
