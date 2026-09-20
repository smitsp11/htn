import type { RankedSubmission } from "@/lib/domain/types";
import { isTriageCandidate, quadrantOf, QUADRANT_CELLS, type QuadrantCell } from "@/lib/rankings/quadrant";

export interface QuadrantBoardProps {
  submissions: RankedSubmission[];
  onOpen: (id: string) => void;
  selectedId?: string | null;
}

/** Short axis descriptor shown under each cell label so the 2×2 reads as a
 *  quadrant (appetite on the vertical axis, effort-to-decide on the horizontal). */
function descriptor(appetite: "high" | "low", effort: "low" | "high"): string {
  return `${appetite === "high" ? "Higher appetite" : "Lower appetite"} · ${
    effort === "low" ? "less to resolve" : "more to resolve"
  }`;
}

export function QuadrantBoard({ submissions, onOpen, selectedId = null }: QuadrantBoardProps) {
  const byCell = new Map<QuadrantCell, RankedSubmission[]>();
  for (const cell of QUADRANT_CELLS) byCell.set(cell.cell, []);
  for (const s of submissions.filter(isTriageCandidate)) byCell.get(quadrantOf(s).cell)!.push(s);

  return (
    <div className="quadrant-board">
      <p className="quadrant-caption">
        Appetite rises up the board; the less there is to resolve, the further left. Work the top-left first.
      </p>
      <div className="quadrant" role="group" aria-label="Appetite by effort to decide">
        {QUADRANT_CELLS.map((cell) => {
          const items = byCell.get(cell.cell)!;
          return (
            <section key={cell.cell} className={`quadrant-cell qc-${cell.cell}`} aria-label={cell.label}>
              <header className="quadrant-head">
                <div className="quadrant-head-text">
                  <strong>{cell.label}</strong>
                  <span>{descriptor(cell.appetite, cell.effort)}</span>
                </div>
                <b className="quadrant-count">{items.length}</b>
              </header>
              {items.length === 0 ? (
                <p className="quadrant-empty">None</p>
              ) : (
                <ul>
                  {items.map((s) => (
                    <li key={s.id}>
                      <button type="button" aria-pressed={selectedId === s.id} onClick={() => onOpen(s.id)}>
                        <span className="quadrant-name">{s.accountName}</span>
                        <small>{s.score}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
