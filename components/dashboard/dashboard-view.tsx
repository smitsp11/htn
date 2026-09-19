import type { RankingsResponse } from "@/lib/domain/types";
import type { RankingsErrorBody } from "@/lib/rankings/errors";
import { summarize } from "@/lib/rankings/presentation";
import { QueueTable } from "./queue-table";
import { QuadrantBoard } from "./quadrant-board";
import { PortfolioStrip } from "./portfolio-strip";
import { SubmissionDetail } from "./submission-detail";
import { SourceStatus } from "./source-status";
import { EmptyPanel, ErrorPanel, LoadingPanel, StaleBanner } from "./state-panels";

export type QueueView = "table" | "quadrant";

export interface DashboardViewProps {
  data: RankingsResponse | null;
  error: RankingsErrorBody | null;
  loading: boolean;
  expandedId: string | null;
  onToggle: (id: string) => void;
  onRefresh: () => void;
  matchedIds?: string[] | null;
  view?: QueueView;
  onViewChange?: (view: QueueView) => void;
}

/** Pure presentational shell; all data fetching lives in RankingsDashboard. */
export function DashboardView({ data, error, loading, expandedId, onToggle, onRefresh, matchedIds, view = "table", onViewChange }: DashboardViewProps) {
  if (!data) {
    if (error) return <ErrorPanel error={error} onRetry={onRefresh} />;
    return <LoadingPanel />;
  }

  if (data.submissions.length === 0) return <EmptyPanel onRefresh={onRefresh} />;

  const summary = summarize(data.submissions);
  const filtering = Array.isArray(matchedIds);
  const visibleSubmissions = Array.isArray(matchedIds)
    ? data.submissions.filter((submission) => matchedIds.includes(submission.id))
    : data.submissions;
  const selected = expandedId ? visibleSubmissions.find((s) => s.id === expandedId) : undefined;

  return (
    <>
      <PortfolioStrip submissions={data.submissions} />
      <section className="summary-grid" aria-label="Queue summary">
        <SummaryCard label="In appetite" value={summary.in_appetite} tone="good" />
        <SummaryCard label="Investigate" value={summary.needs_investigation} tone="warn" />
        <SummaryCard label="Out of appetite" value={summary.out_of_appetite} tone="bad" />
        <SourceStatus data={data} summary={summary} />
      </section>

      <section className="queue-panel">
        <div className="queue-toolbar">
          <div>
            <h2>Prioritized submissions</h2>
            <p>Appetite status is considered before the transparent match score. A human underwriter makes every decision.</p>
          </div>
          <div className="queue-toolbar-actions">
            {onViewChange ? (
              <div className="view-toggle" role="group" aria-label="Queue view">
                <button type="button" aria-pressed={view === "table"} onClick={() => onViewChange("table")}>Table</button>
                <button type="button" aria-pressed={view === "quadrant"} onClick={() => onViewChange("quadrant")}>Quadrant</button>
              </div>
            ) : null}
            <button type="button" onClick={onRefresh} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh queue"}
            </button>
          </div>
        </div>

        {error ? <StaleBanner generatedAt={data.generatedAt} error={error} /> : null}

        {filtering ? (
          <p className="queue-filter-note">
            Showing {visibleSubmissions.length} of {data.submissions.length} — Clear the ask bar to see the full queue.
          </p>
        ) : null}

        {view === "quadrant" ? (
          <>
            <QuadrantBoard submissions={visibleSubmissions} onSelect={onToggle} />
            {selected ? (
              <div className="quadrant-detail">
                <SubmissionDetail submission={selected} />
              </div>
            ) : null}
          </>
        ) : (
          <QueueTable submissions={visibleSubmissions} expandedId={expandedId} onToggle={onToggle} />
        )}
      </section>

      <details className="trace-panel">
        <summary>Decision trace</summary>
        <ul>{data.trace.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
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
