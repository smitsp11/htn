import type { RankedSubmission } from "@/lib/domain/types";
import { quadrantOf, QUADRANT_CELLS, type QuadrantCell } from "@/lib/rankings/quadrant";

export interface QuadrantBoardProps {
  submissions: RankedSubmission[];
  onSelect: (id: string) => void;
}

// Stylesheet is loaded via `@import` in app/globals.css so this stays node-testable.
export function QuadrantBoard({ submissions, onSelect }: QuadrantBoardProps) {
  const byCell = new Map<QuadrantCell, RankedSubmission[]>();
  for (const cell of QUADRANT_CELLS) byCell.set(cell.cell, []);
  for (const s of submissions) byCell.get(quadrantOf(s).cell)!.push(s);

  return (
    <div className="quadrant" aria-label="Appetite by completeness">
      {QUADRANT_CELLS.map((cell) => {
        const items = byCell.get(cell.cell)!;
        return (
          <section key={cell.cell} className={`quadrant-cell qc-${cell.cell}`}>
            <header>
              <strong>{cell.label}</strong>
              <small>{items.length}</small>
            </header>
            <ul>
              {items.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => onSelect(s.id)}>
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
