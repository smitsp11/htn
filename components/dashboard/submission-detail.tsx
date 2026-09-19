import { ExternalRisk } from "@/components/external-risk/external-risk";
import { FactorBreakdown } from "@/components/factor-breakdown/factor-breakdown";
import type { RankedSubmission } from "@/lib/domain/types";

export function SubmissionDetail({ submission }: { submission: RankedSubmission }) {
  const unresolved = submission.factors.filter((factor) => factor.verdict === "unknown");
  return (
    <div className="detail-content">
      <div>
        <h3>Decision explanation</h3>
        <p>{submission.explanation}</p>
        {unresolved.length > 0 ? (
          <p className="missing-callout">
            Unresolved fields: {unresolved.map((factor) => factor.label.toLowerCase()).join(", ")}. These never count as acceptable.
          </p>
        ) : null}
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
