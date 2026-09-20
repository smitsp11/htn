import type { RankedSubmission } from "@/lib/domain/types";
import { isOffStrategyBind } from "@/lib/rankings/outcome";
import { DistanceChips } from "@/components/ui/distance-chips";

/**
 * Case summary strip: the one-line recommendation an underwriter acts on, plus
 * the rare off-strategy-bind warning when it applies. The old chip row
 * (established %, gaps, exceptions, flood zone, historical outcome) and the "AI
 * watch" line were removed — they restated completeness/enrichment already shown
 * in the Review tab's next-step card, assessment, and appetite breakdown. The
 * distance chips stay: "one fix away" and "near miss" tell the underwriter that
 * a single confirmed figure could change the verdict, which nothing else states.
 */
export function CaseSummary({ submission }: { submission: RankedSubmission }) {
  return (
    <section className="case-summary">
      <p className="case-summary-headline">{submission.recommendation}</p>
      <DistanceChips submission={submission} />
      {isOffStrategyBind(submission) ? (
        <p className="case-summary-offstrategy">
          <b>Off-strategy bind:</b> this account was bound, but the appetite engine independently places it out
          of appetite. Possible appetite drift — a risk on the books the carrier&rsquo;s stated appetite would
          not have written.
        </p>
      ) : null}
    </section>
  );
}
