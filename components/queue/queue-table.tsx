"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import type { RankedSubmission } from "@/lib/domain/types";
import { primaryReason } from "@/lib/rankings/presentation";
import { laneForStatus } from "@/lib/rankings/lanes";
import { LaneBadge } from "@/components/ui/lane-badge";
import { Icon } from "@/components/ui/icon";

export interface QueueTableProps {
  submissions: RankedSubmission[];
  onOpen: (id: string) => void;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function formatDate(value?: string): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? dateFormatter.format(parsed) : "Not available";
}

function formatMoney(value?: number): string {
  return value == null ? "—" : moneyFormatter.format(value);
}

/**
 * Decision-first queue: each row answers the three questions an underwriter asks
 * while triaging — is it in appetite (the lane badge), what's the catch / next
 * step (the reason line), and how big is it (premium). Account and primary risk
 * state identify and place it; the score is a small tie-breaker. Depth (the full
 * factor breakdown, historical outcome, enrichment) lives in the case view, not
 * on the triage row.
 */
export function QueueTable({ submissions, onOpen }: QueueTableProps) {
  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(id);
    }
  }

  return (
    <div className="table-scroll">
      <table className="queue-table">
        <thead>
          <tr>
            <th scope="col">Account / submission</th>
            <th scope="col">State</th>
            <th scope="col">Effective</th>
            <th scope="col" className="number">
              Premium
            </th>
            <th scope="col">Appetite</th>
            <th scope="col">Next step</th>
            <th scope="col">
              <span className="sr-only">Open record</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((submission, index) => (
            <tr
              key={submission.id}
              data-row-id={submission.id}
              data-lane={laneForStatus(submission.status)}
              className="row"
              style={{ "--row-index": index } as CSSProperties}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(submission.id)}
              onKeyDown={(event) => handleRowKeyDown(event, submission.id)}
            >
              <td>
                <span className="account-link">
                  <strong>{submission.accountName}</strong>
                  <small>{submission.id}</small>
                </span>
              </td>
              <td>
                <span className="line-label">{submission.primaryRiskState ?? "—"}</span>
              </td>
              <td>{formatDate(submission.effectiveDate)}</td>
              <td className="number">{formatMoney(submission.totalPremium)}</td>
              <td>
                <span className="score-cell">
                  <LaneBadge status={submission.status} />
                  <b className="score-value" title="Appetite score (orders ties)">
                    {submission.score}
                  </b>
                </span>
              </td>
              <td className="next-action">
                <span>{primaryReason(submission)}</span>
              </td>
              <td>
                <button
                  type="button"
                  className="icon-button open-record"
                  aria-label={`Open ${submission.accountName}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(submission.id);
                  }}
                >
                  <Icon name="chevron" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
