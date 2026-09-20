import type { RankedSubmission } from "@/lib/domain/types";
import { isTriageCandidate, quadrantOf, QUADRANT_CELLS, type QuadrantCell } from "@/lib/rankings/quadrant";

export interface QuadrantBoardProps {
  submissions: RankedSubmission[];
  onOpen: (id: string) => void;
  selectedId?: string | null;
}

export function QuadrantBoard({ submissions, onOpen, selectedId = null }: QuadrantBoardProps) {
  const byCell = new Map<QuadrantCell, RankedSubmission[]>();
  for (const cell of QUADRANT_CELLS) byCell.set(cell.cell, []);
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
                  <button type="button" aria-pressed={selectedId === s.id} onClick={() => onOpen(s.id)}>
                    <span>{s.accountName}</span> <small>{s.score}/100</small>
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
