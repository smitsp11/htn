import type { ContextSignal } from "@/lib/domain/types";

/**
 * Read-only panel for public/government context signals. Styles live in
 * ./context-signals.css (loaded via app/globals.css) so this file stays
 * importable under node tests.
 */
export function ContextSignals({ signals }: { signals: ContextSignal[] }) {
  if (!signals || signals.length === 0) return null;
  return (
    <section className="ctx" aria-label="Public-data context">
      <span className="ctx-label">Public data · decision context</span>
      <ul className="ctx-list">
        {signals.map((s) => (
          <li key={`${s.source}-${s.label}`} className="ctx-item">
            <span className="ctx-field">{s.label}</span>
            <span className="ctx-value">{s.value}</span>
            <a className="ctx-src" href={s.url} target="_blank" rel="noreferrer">
              {s.source}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
