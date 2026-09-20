import type { RankingsResponse } from "@/lib/domain/types";
import type { QueueSummary } from "@/lib/rankings/presentation";

/**
 * Connection and data-completeness status. Person 1's richer source-status
 * component can replace this once it lands; the props are the shared response.
 */
export function SourceStatus({ data, summary }: { data: RankingsResponse; summary: QueueSummary }) {
  return (
    <div className="summary-card source-card">
      <span>Data source</span>
      <strong>{data.source === "demo" ? "Demo fixtures" : "Federato API"}</strong>
      <small>Schema discovered: {data.schemaDiscovered ? "Yes" : "No"}</small>
      <small>{summary.total} submissions ranked, {summary.unresolved} with unresolved fields</small>
      <small>Generated {data.generatedAt}</small>
    </div>
  );
}
