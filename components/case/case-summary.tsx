import type { HazardEntry, RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";
import { flagSummary } from "@/lib/rankings/flags";
import { isOffStrategyBind, outcomeChipText } from "@/lib/rankings/outcome";

/** The flood-related hazard entry from the enrichment layer, if any. Purely
 *  presentational -- enrichment never changes appetite, it only adds context. */
function floodHazard(topHazards: HazardEntry[]): HazardEntry | undefined {
  return topHazards.find((hazard) => hazard.type.toLowerCase().includes("flood"));
}

export function CaseSummary({ submission }: { submission: RankedSubmission }) {
  const completeness = completenessOf(submission);
  const establishedPct =
    completeness.total > 0 ? Math.round((completeness.resolved / completeness.total) * 100) : 0;
  const exceptions = flagSummary(submission).red;
  const hazard = submission.enrichment ? floodHazard(submission.enrichment.topHazards) : undefined;

  return (
    <section className="case-summary">
      <p className="case-summary-headline">{submission.recommendation}</p>
      <div className="case-summary-chips">
        <span className="chip">{establishedPct}% established</span>
        <span className="chip">{completeness.missing.length} gaps</span>
        <span className="chip">{exceptions} exceptions</span>
        <span className="chip">Flood zone: {hazard ? hazard.rating : "—"}</span>
        {submission.actualOutcome ? (
          <span className="chip">{outcomeChipText(submission.actualOutcome)}</span>
        ) : null}
      </div>
      {isOffStrategyBind(submission) ? (
        <p className="case-summary-offstrategy">
          <b>Off-strategy bind:</b> bound, though this engine places it outside appetite — possible appetite
          drift.
        </p>
      ) : null}
    </section>
  );
}
