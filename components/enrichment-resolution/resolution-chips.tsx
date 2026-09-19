import { formatMoney } from "@/lib/domain/format";
import type { FactorKey } from "@/lib/domain/types";
import type { ResolutionMap } from "@/lib/enrichment/resolve-submission";

export interface ResolutionChipsProps {
  resolutions: ResolutionMap;
  labels: Partial<Record<FactorKey, string>>;
}

const MONEY_KEYS = new Set<FactorKey>(["tiv", "totalPremium", "fiveYearLossValue"]);

/** Present a resolved value the way the rest of the UI shows that factor. */
export function formatResolvedValue(key: FactorKey, value: number | string): string {
  if (typeof value !== "number") return value;
  if (MONEY_KEYS.has(key)) return formatMoney(value);
  if (key === "construction") return `${Math.round((value > 1 ? value / 100 : value) * 100)}% approved construction`;
  return String(value);
}

export function ResolutionChips({ resolutions, labels }: ResolutionChipsProps) {
  const entries = Object.entries(resolutions) as [FactorKey, ResolutionMap[FactorKey]][];
  if (entries.length === 0) return null;
  return (
    <ul className="res-chips" aria-label="Field resolutions">
      {entries.map(([key, resolved]) => (
        <li key={key} className={`res-chip ${resolved ? "res-found" : "res-chase"}`}>
          <span className="res-field">{labels[key] ?? key}</span>
          {resolved ? (
            <span className="res-meta">
              {formatResolvedValue(key, resolved.value)} · {resolved.provenance.source} · {Math.round(resolved.provenance.confidence * 100)}% · {resolved.provenance.asOf}
            </span>
          ) : (
            <span className="res-meta">Request from broker</span>
          )}
        </li>
      ))}
    </ul>
  );
}
