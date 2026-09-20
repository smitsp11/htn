import type { FactorEvaluation, RankedSubmission } from "@/lib/domain/types";
import { tableFor } from "@/lib/domain/appetite/registry";
import { Icon } from "@/components/ui/icon";

function verifyNext(factor: FactorEvaluation, isProperty: boolean): string {
  switch (factor.key) {
    case "submissionType": return "Confirm new business versus renewal with the broker.";
    case "lineOfBusiness": return "Confirm the recorded line of business.";
    case "primaryRiskState": return "Confirm the primary risk state for the insured exposure.";
    case "tiv": return isProperty ? "Request a statement of values showing total insured value." : `Request an exposure schedule documenting the ${factor.label.toLowerCase()}.`;
    case "totalPremium": return "Request the quoted total premium.";
    case "buildingYear": return "Confirm the year built for the oldest insured building.";
    case "construction": return "Confirm construction details across the insured schedule.";
    case "fiveYearLossValue": return "Request a five-year loss run for the applicable line.";
  }
}

/** Read-only decision support; research never changes the appetite score or status. */
export function ResearchPanel({ submission }: { submission: RankedSubmission }) {
  const table = tableFor(submission.lineOfBusiness);
  const enrichment = submission.enrichment;
  const unresolved = submission.factors.filter((factor) => factor.verdict === "unknown");
  const isProperty = table?.line === "property";

  return (
    <details className="research-panel" aria-label="Submission research">
      <summary className="research-heading">
        <div><span className="eyebrow">RESEARCH</span><h3>{table?.displayName ?? "Submission"} research</h3></div>
        <span className="research-hint">Public hazard data and unresolved factors</span>
      </summary>
      <section className="research-digest">
        <div className="digest-heading"><h4>Research at a glance</h4>{enrichment ? <span>{enrichment.source} as of {enrichment.asOf}</span> : null}</div>
        {enrichment ? (
          <>
            <div className="digest-grid">
              <div><small>Composite hazard rating</small><strong>{enrichment.compositeRating}</strong></div>
              {enrichment.compositeScore != null ? <div><small>NRI score</small><strong>{enrichment.compositeScore}</strong></div> : null}
            </div>
            {enrichment.topHazards.length > 0 ? <ul className="digest-hazards">{enrichment.topHazards.map((hazard) => <li key={hazard.type}>{hazard.type}: {hazard.rating}</li>)}</ul> : null}
          </>
        ) : <p>No FEMA hazard enrichment is available for this submission.</p>}
      </section>
      {unresolved.length > 0 ? (
        <div className="research-ai">
          <h4>Unresolved factors</h4>
          {unresolved.map((factor) => (
            <details className="brief" key={factor.key}>
              <summary><strong>{factor.label}</strong><span>Engine context</span></summary>
              <p className="brief-reading">{factor.reason}</p>
              <p className="brief-watch"><b>Verify next:</b> {verifyNext(factor, isProperty)}</p>
            </details>
          ))}
        </div>
      ) : null}
      {enrichment ? (
        <details className="research-sources" open>
          <summary>Source</summary>
          <article className="research-source"><header><b>{enrichment.source}</b></header><p><a href="https://hazards.fema.gov/nri/" target="_blank" rel="noopener noreferrer"><Icon name="globe" /> View source</a></p></article>
        </details>
      ) : null}
      <p className="research-notice">Research and engine context are decision support only. They never change the appetite score or status.</p>
    </details>
  );
}
