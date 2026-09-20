import type { ReactNode } from "react";
import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";
import { primaryReason } from "@/lib/rankings/presentation";
import {
  APPETITE_HIGH_SCORE,
  EFFORT_LOW_MAX,
  isTriageCandidate,
  quadrantOf,
  QUADRANT_CELLS,
  type QuadrantCell,
} from "@/lib/rankings/quadrant";

export interface QuadrantBoardProps {
  submissions: RankedSubmission[];
  onOpen: (id: string) => void;
  selectedId?: string | null;
}

/** How many rows a cell lists before collapsing the rest into a count. */
const CELL_LIMIT = 6;

/** One line per cell saying what landing there means for the underwriter. */
const CELL_MEANING: Record<QuadrantCell, string> = {
  "work-now": "Meets the appetite and nothing is left to chase. Decide now.",
  "worth-effort": "Strong on what is known, but two or more fields are still missing. Chase the evidence.",
  selective: "Out of appetite or weak so far, with nothing left to chase. Check the failing factor before writing it off.",
  deprioritize: "Out of appetite or weak so far, and still missing data. Lowest return on effort.",
};

/** The one line that says why a row sits where it does. */
function rowReason(submission: RankedSubmission): string {
  const completeness = completenessOf(submission);
  if (completeness.effortToDecision > 0) {
    return `${completeness.effortToDecision} to resolve: ${completeness.missingLabels.join(", ").toLowerCase()}`;
  }
  return primaryReason(submission);
}

function AxisY({ appetite }: { appetite: "high" | "low" }) {
  return (
    <span className="quadrant-axis-y">
      {appetite === "high" ? "High appetite" : "Low appetite"}
      <small>{appetite === "high" ? "in appetite, or strong so far" : "out of appetite, or weak so far"}</small>
    </span>
  );
}

/**
 * Appetite x effort triage board. Rows are appetite (high or low), columns are
 * the effort left before a decision (low or high). Every placement comes from
 * `quadrantOf`; this component only labels the axes, explains each cell, and
 * says in one line why each row landed where it did.
 */
export function QuadrantBoard({ submissions, onOpen, selectedId = null }: QuadrantBoardProps) {
  const byCell = new Map<QuadrantCell, RankedSubmission[]>();
  for (const cell of QUADRANT_CELLS) byCell.set(cell.cell, []);
  const placed = submissions.filter(isTriageCandidate);
  for (const submission of placed) byCell.get(quadrantOf(submission).cell)!.push(submission);

  const rows: ReactNode[] = [];
  for (const appetite of ["high", "low"] as const) {
    rows.push(<AxisY key={`axis-${appetite}`} appetite={appetite} />);
    for (const cell of QUADRANT_CELLS.filter((item) => item.appetite === appetite)) {
      const items = byCell.get(cell.cell)!;
      const shown = items.slice(0, CELL_LIMIT);
      rows.push(
        <section key={cell.cell} className={`quadrant-cell qc-${cell.cell}`} aria-label={cell.label}>
          <header>
            <strong>{cell.label}</strong>
            <small>{items.length}</small>
          </header>
          <p className="quadrant-meaning">{CELL_MEANING[cell.cell]}</p>
          {items.length === 0 ? <p className="quadrant-empty">None in this view.</p> : null}
          <ul>
            {shown.map((submission) => (
              <li key={submission.id}>
                <button type="button" aria-pressed={selectedId === submission.id} onClick={() => onOpen(submission.id)}>
                  <span className="quadrant-item-head">
                    <span>{submission.accountName}</span> <small>{submission.score}/100</small>
                  </span>
                  <span className="quadrant-item-reason">{rowReason(submission)}</span>
                </button>
              </li>
            ))}
          </ul>
          {items.length > shown.length ? (
            <p className="quadrant-more">+{items.length - shown.length} more in the list view</p>
          ) : null}
        </section>,
      );
    }
  }

  return (
    <div className="quadrant-board" role="group" aria-label="Appetite by completeness">
      <p className="quadrant-caption">
        {placed.length} submission{placed.length === 1 ? "" : "s"} placed by appetite (rows) and effort left to decide
        (columns). High appetite means in appetite, or needs investigation with a score of {APPETITE_HIGH_SCORE} or
        more. Low effort means at most {EFFORT_LOW_MAX} field left to resolve.
      </p>
      <div className="quadrant">
        <span className="quadrant-corner" aria-hidden="true" />
        <span className="quadrant-axis-x">
          Low effort <small>{EFFORT_LOW_MAX} field or fewer to resolve</small>
        </span>
        <span className="quadrant-axis-x">
          High effort <small>2 or more fields to resolve</small>
        </span>
        {rows}
      </div>
    </div>
  );
}
