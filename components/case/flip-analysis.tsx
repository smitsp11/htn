import type { RankedSubmission } from "@/lib/domain/types";
import { flipAnalysisFor } from "@/lib/domain/flip";
import { Icon } from "@/components/ui/icon";

/**
 * What it would take to move this submission toward appetite: one card per blocking or
 * unresolved factor, marked movable (broker/underwriter can act on it) or immovable (a fixed
 * fact about the risk). Purely a read of the deterministic engine's own factor verdicts and
 * the published guideline thresholds -- it never recomputes a factor, a status, or a score.
 */
export function FlipAnalysis({ submission }: { submission: RankedSubmission }) {
  const flips = flipAnalysisFor(submission);
  if (flips.length === 0) return null;

  const movableCount = flips.filter((flip) => flip.movable).length;

  return (
    <details className="flip-analysis" open>
      <summary>
        <span>
          <span className="flip-info" tabIndex={0}>
            <Icon name="info" />
            <span className="flip-tooltip" role="tooltip">
              Each factor blocking or missing on this submission, marked Actionable when you can fix it (re-quote, request a
              document) or Fixed when it is a fact of the risk you cannot change.
            </span>
          </span>{" "}
          Flip analysis
        </span>
        <span className="flip-summary">
          {movableCount} of {flips.length} actionable
        </span>
      </summary>
      <div className="flip-list">
        {flips.map((flip) => (
          <article className={`flip-item ${flip.movable ? "flip-movable" : "flip-immovable"}`} key={flip.key}>
            <header>
              <strong>{flip.label}</strong>
              <span className="flip-tag">{flip.movable ? "Actionable" : "Fixed"}</span>
            </header>
            <p>{flip.action}</p>
          </article>
        ))}
      </div>
    </details>
  );
}
