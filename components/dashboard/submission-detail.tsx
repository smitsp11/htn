import { ExternalRisk } from "@/components/external-risk/external-risk";
import { FactorBreakdown } from "@/components/factor-breakdown/factor-breakdown";
import { ResolutionChips } from "@/components/enrichment-resolution/resolution-chips";
import type { RankedSubmission } from "@/lib/domain/types";
import { resolveSubmissionFields } from "@/lib/enrichment/resolve-submission";
import { completenessOf } from "@/lib/rankings/completeness";

export function SubmissionDetail({ submission }: { submission: RankedSubmission }) {
  return (
    <div className="detail-content">
      <div>
        <h3>Decision explanation</h3>
        <p>{submission.explanation}</p>
        {submission.status !== "out_of_scope" ? <InGoodOrder submission={submission} /> : null}
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

/** Completeness checklist derived from the engine's unknown verdicts. Absent
 *  inputs are a broker chase; ambiguous ones (a value the guidelines do not
 *  classify) are an underwriter call. Not rendered for out-of-scope lines,
 *  which were never evaluated against the property factors. */
function InGoodOrder({ submission }: { submission: RankedSubmission }) {
  const completeness = completenessOf(submission);
  const pending = completeness.effortToDecision;
  const resolutions = resolveSubmissionFields(submission);
  const factorLabels = Object.fromEntries(submission.factors.map((f) => [f.key, f.label]));
  const reasonFor = (key: string) => submission.factors.find((factor) => factor.key === key)?.reason;
  return (
    <div className="in-good-order" aria-label="Submission completeness">
      <p className="igo-header">
        <span className={`igo-badge ${completeness.inGoodOrder ? "igo-ready" : "igo-pending"}`}>
          {completeness.inGoodOrder ? "In good order" : `${pending} field${pending === 1 ? "" : "s"} to resolve`}
        </span>
        <span className="igo-count">{completeness.resolved} of {completeness.total} required fields resolved</span>
      </p>
      {pending > 0 ? (
        <ul className="igo-checklist">
          {completeness.absent.map((key, index) => (
            <li key={key}>Confirm {completeness.absentLabels[index].toLowerCase()}</li>
          ))}
          {completeness.ambiguous.map((key, index) => (
            <li key={key}>
              Decide {completeness.ambiguousLabels[index].toLowerCase()}
              {reasonFor(key) ? <small className="igo-reason"> — {reasonFor(key)}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {pending > 0 ? <p className="igo-note">Unresolved fields never count as acceptable.</p> : null}
      <ResolutionChips resolutions={resolutions} labels={factorLabels} />
    </div>
  );
}
