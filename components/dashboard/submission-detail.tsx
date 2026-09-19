import { ExternalRisk } from "@/components/external-risk/external-risk";
import { FactorBreakdown } from "@/components/factor-breakdown/factor-breakdown";
import { ResolutionChips } from "@/components/enrichment-resolution/resolution-chips";
import type { RankedSubmission } from "@/lib/domain/types";
import { resolveSubmissionFields } from "@/lib/enrichment/resolve-submission";
import { completenessOf } from "@/lib/rankings/completeness";

export function SubmissionDetail({ submission }: { submission: RankedSubmission }) {
  const completeness = completenessOf(submission);
  const resolutions = resolveSubmissionFields(submission);
  const factorLabels = Object.fromEntries(submission.factors.map((f) => [f.key, f.label]));
  return (
    <div className="detail-content">
      <div>
        <h3>Decision explanation</h3>
        <p>{submission.explanation}</p>
        <div className="in-good-order" aria-label="Submission completeness">
          <p className="igo-header">
            <span className={`igo-badge ${completeness.inGoodOrder ? "igo-ready" : "igo-pending"}`}>
              {completeness.inGoodOrder ? "In good order" : `${completeness.effortToDecision} to resolve`}
            </span>
            <span className="igo-count">{completeness.resolved} of {completeness.total} required fields resolved</span>
          </p>
          {completeness.missing.length > 0 ? (
            <ul className="igo-checklist">
              {completeness.missingLabels.map((label) => (
                <li key={label}>Confirm {label.toLowerCase()}</li>
              ))}
            </ul>
          ) : null}
          {completeness.missing.length > 0 ? (
            <p className="igo-note">Unresolved fields never count as acceptable.</p>
          ) : null}
          <ResolutionChips resolutions={resolutions} labels={factorLabels} />
        </div>
        <dl className="dates">
          <div><dt>Effective</dt><dd>{submission.effectiveDate ?? "Unknown"}</dd></div>
          <div><dt>Expiration</dt><dd>{submission.expirationDate ?? "Unknown"}</dd></div>
        </dl>
      </div>
      <FactorBreakdown submission={submission} />
      <ExternalRisk profile={submission.enrichment} />
    </div>
  );
}
