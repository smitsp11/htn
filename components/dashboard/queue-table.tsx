import type { RankedSubmission } from "@/lib/domain/types";
import { flagSummary, reasonsByTone, type FlagTone } from "@/lib/rankings/flags";
import { primaryReason, statusLabels } from "@/lib/rankings/presentation";
import { SubmissionDetail } from "./submission-detail";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function formatMoney(value?: number) {
  return value === undefined ? "Unknown" : money.format(value);
}

export interface QueueTableProps {
  submissions: RankedSubmission[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}

export function QueueTable({ submissions, expandedId, onToggle }: QueueTableProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Account</th>
            <th>Status</th>
            <th>Flags</th>
            <th>Score</th>
            <th>State</th>
            <th>TIV</th>
            <th>Premium</th>
            <th>Primary reason</th>
            <th>Recommendation</th>
            <th><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((submission, index) => {
            const expanded = expandedId === submission.id;
            return [
              <tr className="queue-row" key={submission.id}>
                <td className="rank-cell">{index + 1}</td>
                <td><strong>{submission.accountName}</strong><small>{submission.id}</small></td>
                <td><span className={`status-badge ${submission.status}`}>{statusLabels[submission.status]}</span></td>
                <td className="flags-cell"><FlagChips submission={submission} /></td>
                <td><strong>{submission.score}</strong><small>/100</small></td>
                <td>{submission.primaryRiskState ?? "—"}</td>
                <td>{formatMoney(submission.tiv)}</td>
                <td>{formatMoney(submission.totalPremium)}</td>
                <td className="reason-cell">
                  {primaryReason(submission)}
                  {submission.enrichment && submission.enrichment.compositeRating !== "unknown" ? (
                    <span className={`xr-badge xr-rating-${submission.enrichment.compositeRating.replace(/\s+/g, "-")}`}>
                      {submission.enrichment.topHazards[0]?.type ?? "Hazard"} ·{" "}
                      {submission.enrichment.compositeRating.charAt(0).toUpperCase() + submission.enrichment.compositeRating.slice(1)}
                    </span>
                  ) : null}
                </td>
                <td className="recommendation-cell">{submission.recommendation}</td>
                <td>
                  <button type="button" className="detail-button" aria-expanded={expanded} onClick={() => onToggle(submission.id)}>
                    {expanded ? "Close" : "Details"}
                  </button>
                </td>
              </tr>,
              expanded ? (
                <tr className="detail-row" key={`${submission.id}-detail`}>
                  <td colSpan={11}><SubmissionDetail submission={submission} /></td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

const TONE_ORDER: FlagTone[] = ["red", "yellow", "preferred"];
const TONE_LABEL: Record<FlagTone, string> = { red: "not acceptable", yellow: "unresolved", preferred: "wanted" };

function FlagChips({ submission }: { submission: RankedSubmission }) {
  const summary = flagSummary(submission);
  const reasons = reasonsByTone(submission);
  return (
    <span className="flag-chips">
      {TONE_ORDER.map((tone) =>
        summary[tone] > 0 ? (
          <span
            key={tone}
            role="img"
            className={`flag-chip flag-${tone}`}
            title={reasons[tone].join("\n")}
            aria-label={`${summary[tone]} ${TONE_LABEL[tone]}`}
          >
            {summary[tone]}
          </span>
        ) : null,
      )}
    </span>
  );
}
