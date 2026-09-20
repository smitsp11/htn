"use client";

import type { ChangeEvent } from "react";

export type SourceStatus = "active" | "history" | "all";
export type SortKey = "priority" | "appetite" | "premium" | "account";

export interface QueueFiltersProps {
  sourceStatus: SourceStatus;
  sort: SortKey;
  onSourceStatus: (value: SourceStatus) => void;
  onSort: (value: SortKey) => void;
  onClear: () => void;
}

/** Federanorth's `.queue-filters` bar: source-status select, sort select, clear filters. */
export function QueueFilters({ sourceStatus, sort, onSourceStatus, onSort, onClear }: QueueFiltersProps) {
  function handleSourceStatus(event: ChangeEvent<HTMLSelectElement>) {
    onSourceStatus(event.target.value as SourceStatus);
  }
  function handleSort(event: ChangeEvent<HTMLSelectElement>) {
    onSort(event.target.value as SortKey);
  }

  return (
    <div className="queue-filters">
      <label className="record-status-label">
        Show
        <select value={sourceStatus} onChange={handleSourceStatus} aria-label="Source status">
          <option value="active">Active submissions</option>
          <option value="history">Bound / closed history</option>
          <option value="all">All source statuses</option>
        </select>
      </label>
      <button type="button" className="clear-filters" onClick={onClear}>
        Clear filters
      </button>
      <label className="sort-label">
        Sort by
        <select value={sort} onChange={handleSort} aria-label="Sort">
          <option value="priority">Review priority</option>
          <option value="appetite">Appetite fit</option>
          <option value="premium">Premium</option>
          <option value="account">Account name</option>
        </select>
      </label>
    </div>
  );
}
