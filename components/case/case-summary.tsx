import type { HazardEntry, RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";
import { flagSummary } from "@/lib/rankings/flags";

/** The flood-related hazard entry from the enrichment layer, if any. Purely
 *  presentational -- enrichment never changes appetite, it only adds context. */
function floodHazard(topHazards: HazardEntry[]): HazardEntry | undefined {
  return topHazards.find((hazard) => hazard.type.toLowerCase().includes("flood"));
}

/** A single factual watch item pulled from the engine's own factor reasons --
 *  no LLM involved here, just a pick of the most pressing existing verdict. */
function watchItem(submission: RankedSubmission): string {
  const concern = submission.factors.find((factor) => factor.verdict === "not_acceptable");
  if (concern) return `${concern.label}: ${concern.reason}`;
  const gap = submission.factors.find((factor) => factor.verdict === "unknown");
  if (gap) return `${gap.label}: ${gap.reason}`;
  return "No open concerns on the factors evaluated so far.";
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
      </div>
      <p className="case-summary-watch">
        <b>AI watch:</b> {watchItem(submission)}
      </p>
    </section>
  );
}
