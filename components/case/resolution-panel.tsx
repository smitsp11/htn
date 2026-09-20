import type { AppetiteStatus, ResolutionResult } from "@/lib/domain/types";
import { Icon } from "@/components/ui/icon";

const STATUS_LABEL: Record<AppetiteStatus, string> = {
  in_appetite: "In appetite",
  needs_investigation: "Needs investigation",
  out_of_appetite: "Out of appetite",
  out_of_scope: "Out of scope",
};

export function ResolutionPanel({ resolution }: { resolution?: ResolutionResult }) {
  if (!resolution || resolution.fields.length === 0) return null;
  const { fields, before, after } = resolution;
  const flipped = before.status !== after.status;
  return (
    <section className="resolution-panel" aria-label="Consolidated data resolution">
      <header>
        <span><Icon name="book" /> Resolved from consolidated channels</span>
        <small>Decision support — confirm before it counts.</small>
      </header>
      <ul className="res-chips" aria-label="Field resolutions">
        {fields.map((f) => (
          <li key={f.key} className="res-chip res-found">
            <span className="res-field">{f.label}</span>
            <span className="res-meta">{f.display} · {f.source} · {Math.round(f.confidence * 100)}% · {f.asOf}</span>
          </li>
        ))}
      </ul>
      <div className={`res-verdict ${flipped ? "res-flip" : ""}`}>
        <span className="res-before">{STATUS_LABEL[before.status]} · {before.score}/100</span>
        <Icon name="chevron" />
        <span className="res-after">{STATUS_LABEL[after.status]} · {after.score}/100</span>
      </div>
    </section>
  );
}
