import type { RankedSubmission } from "@/lib/domain/types";
import { isOffStrategyBind } from "@/lib/rankings/outcome";

/**
 * Case summary strip: the one-line recommendation an underwriter acts on, plus
 * the rare off-strategy-bind warning when it applies. The old chip row
 * (established %, gaps, exceptions, flood zone, historical outcome) and the "AI
 * watch" line were removed — they restated completeness/enrichment already shown
 * in the Review tab's next-step card, assessment, and appetite breakdown.
 */
export function CaseSummary({ submission }: { submission: RankedSubmission }) {
  return (
    <section className="case-summary">
      <p className="case-summary-headline">{submission.recommendation}</p>
      {isOffStrategyBind(submission) ? (
        <p className="case-summary-offstrategy">
          <b>Off-strategy bind:</b> the carrier bound this account, but it sits outside the 2025 appetite. Worth a
          portfolio conversation.
        </p>
      ) : null}
    </section>
  );
}
