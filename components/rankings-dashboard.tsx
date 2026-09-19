"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppetiteStatus, RankedSubmission, RankingsResponse } from "@/lib/domain/types";

const statusLabels: Record<AppetiteStatus, string> = {
  in_appetite: "In appetite",
  needs_investigation: "Needs investigation",
  out_of_appetite: "Out of appetite",
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatMoney(value?: number) {
  return value === undefined ? "Unknown" : money.format(value);
}

export function RankingsDashboard() {
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadRankings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/rankings", { cache: "no-store" });
      const body = (await response.json()) as RankingsResponse | { error?: string };
      if (!response.ok || !("submissions" in body)) {
        throw new Error("error" in body && body.error ? body.error : "Unable to load rankings");
      }
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load rankings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRankings();
  }, [loadRankings]);

  const totals = useMemo(() => {
    const initial: Record<AppetiteStatus, number> = {
      in_appetite: 0,
      needs_investigation: 0,
      out_of_appetite: 0,
    };
    return data?.submissions.reduce((counts, submission) => {
      counts[submission.status] += 1;
      return counts;
    }, initial) ?? initial;
  }, [data]);

  if (loading && !data) {
    return <section className="state-panel">Evaluating the submission queue…</section>;
  }

  if (error && !data) {
    return (
      <section className="state-panel error-panel">
        <strong>Could not evaluate the queue.</strong>
        <span>{error}</span>
        <button type="button" onClick={() => void loadRankings()}>Try again</button>
      </section>
    );
  }

  if (!data || data.submissions.length === 0) {
    return <section className="state-panel">No submissions were returned.</section>;
  }

  return (
    <>
      <section className="summary-grid" aria-label="Queue summary">
        <SummaryCard label="In appetite" value={totals.in_appetite} tone="good" />
        <SummaryCard label="Investigate" value={totals.needs_investigation} tone="warn" />
        <SummaryCard label="Out of appetite" value={totals.out_of_appetite} tone="bad" />
        <div className="summary-card source-card">
          <span>Data source</span>
          <strong>{data.source === "demo" ? "Demo fixtures" : "Federato API"}</strong>
          <small>{data.submissions.length} submissions ranked</small>
        </div>
      </section>

      <section className="queue-panel">
        <div className="queue-toolbar">
          <div>
            <h2>Prioritized submissions</h2>
            <p>Appetite status is considered before the transparent match score.</p>
          </div>
          <button type="button" onClick={() => void loadRankings()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh queue"}
          </button>
        </div>

        {error ? <div className="inline-error">Refresh failed: {error}</div> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Account</th>
                <th>Status</th>
                <th>Score</th>
                <th>State</th>
                <th>TIV</th>
                <th>Premium</th>
                <th>Recommendation</th>
                <th><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {data.submissions.map((submission, index) => (
                <SubmissionRows
                  key={submission.id}
                  rank={index + 1}
                  submission={submission}
                  expanded={expandedId === submission.id}
                  onToggle={() => setExpandedId(expandedId === submission.id ? null : submission.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="trace-panel">
        <summary>Decision trace</summary>
        <ul>{data.trace.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>
    </>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SubmissionRows({
  rank,
  submission,
  expanded,
  onToggle,
}: {
  rank: number;
  submission: RankedSubmission;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td className="rank-cell">{rank}</td>
        <td><strong>{submission.accountName}</strong><small>{submission.id}</small></td>
        <td><span className={`status-badge ${submission.status}`}>{statusLabels[submission.status]}</span></td>
        <td><strong>{submission.score}</strong><small>/100</small></td>
        <td>{submission.primaryRiskState ?? "—"}</td>
        <td>{formatMoney(submission.tiv)}</td>
        <td>{formatMoney(submission.totalPremium)}</td>
        <td className="recommendation-cell">{submission.recommendation}</td>
        <td><button type="button" className="detail-button" onClick={onToggle}>{expanded ? "Close" : "Details"}</button></td>
      </tr>
      {expanded ? (
        <tr className="detail-row">
          <td colSpan={9}>
            <div className="detail-content">
              <div>
                <h3>Decision explanation</h3>
                <p>{submission.explanation}</p>
                <dl className="dates">
                  <div><dt>Effective</dt><dd>{submission.effectiveDate ?? "Unknown"}</dd></div>
                  <div><dt>Expiration</dt><dd>{submission.expirationDate ?? "Unknown"}</dd></div>
                </dl>
              </div>
              <div className="factor-grid">
                {submission.factors.map((factor) => (
                  <div className="factor-card" key={factor.key}>
                    <span>{factor.label}</span>
                    <strong className={factor.verdict}>{factor.verdict.replace("_", " ")}</strong>
                    <small>{factor.reason}</small>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
