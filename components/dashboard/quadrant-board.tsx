import type { RankedSubmission } from "@/lib/domain/types";
import { isTriageCandidate, quadrantOf, QUADRANT_CELLS, type QuadrantCell } from "@/lib/rankings/quadrant";

export interface QuadrantBoardProps {
  submissions: RankedSubmission[];
  onSelect: (id: string) => void;
  /** The submission whose detail is open, if any. */
  selectedId?: string | null;
}

// Stylesheet is loaded via `@import` in app/globals.css so this stays node-testable.
export function QuadrantBoard({ submissions, onSelect, selectedId = null }: QuadrantBoardProps) {
  const byCell = new Map<QuadrantCell, RankedSubmission[]>();
  for (const cell of QUADRANT_CELLS) byCell.set(cell.cell, []);
  // Input order is the ranked order, so each cell lists its best entries first.
  for (const s of submissions.filter(isTriageCandidate)) byCell.get(quadrantOf(s).cell)!.push(s);

  return (
    <div className="quadrant" role="group" aria-label="Appetite by completeness">
      {QUADRANT_CELLS.map((cell) => {
        const items = byCell.get(cell.cell)!;
        return (
          <section key={cell.cell} className={`quadrant-cell qc-${cell.cell}`} aria-label={cell.label}>
            <header>
              <strong>{cell.label}</strong>
              <small>{items.length}</small>
            </header>
            {items.length === 0 ? <p className="quadrant-empty">None</p> : null}
            <ul>
              {items.map((s) => (
                <li key={s.id}>
                  <button type="button" aria-pressed={selectedId === s.id} onClick={() => onSelect(s.id)}>
                    {s.accountName} <small>{s.score}/100</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
