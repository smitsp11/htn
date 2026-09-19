import type { AppetiteStatus, AppetiteVerdict, RankedSubmission } from "@/lib/domain/types";

const statusLabels: Record<AppetiteStatus, string> = {
  in_appetite: "In appetite",
  needs_investigation: "Needs investigation",
  out_of_appetite: "Out of appetite",
};

const verdictLabels: Record<AppetiteVerdict, string> = {
  target: "Target",
  acceptable: "Acceptable",
  not_acceptable: "Not acceptable",
  unknown: "Unknown",
};

const tallyOrder: AppetiteVerdict[] = ["target", "acceptable", "not_acceptable", "unknown"];

export interface FactorBreakdownProps {
  submission: RankedSubmission;
}

/**
 * Reusable, read-only breakdown of one ranked submission: appetite status
 * first, transparent score second, then all eight factor verdicts and the
 * human recommendation. Styles live in ./factor-breakdown.css and are loaded
 * by the package index so this file stays importable in node tests.
 */
export function FactorBreakdown({ submission }: FactorBreakdownProps) {
  const counts = tallyOrder.map((verdict) => ({
    verdict,
    count: submission.factors.filter((factor) => factor.verdict === verdict).length,
  }));

  return (
    <section className="fb" aria-label="Appetite factor breakdown">
      <header className="fb-header">
        <span className={`fb-status fb-status-${submission.status}`}>{statusLabels[submission.status]}</span>
        <span className="fb-score">
          <strong>{submission.score}</strong>
          <small>/100</small>
        </span>
        <span className="fb-tally">
          {counts.map(({ verdict, count }) => (
            <span key={verdict} className={`fb-tally-item fb-verdict-${verdict}`}>
              {count} {verdictLabels[verdict].toLowerCase()}
            </span>
          ))}
        </span>
      </header>

      <ul className="fb-grid">
        {submission.factors.map((factor) => (
          <li key={factor.key} className={`fb-factor fb-verdict-${factor.verdict}`} data-verdict={factor.verdict}>
            <span className="fb-label">{factor.label}</span>
            <strong className="fb-verdict">{verdictLabels[factor.verdict]}</strong>
            <small className="fb-reason">{factor.reason}</small>
          </li>
        ))}
      </ul>

      <p className="fb-recommendation">
        <strong>Recommendation:</strong> {submission.recommendation}
      </p>
    </section>
  );
}
