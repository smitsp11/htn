"use client";

import type { ChangeEvent } from "react";

export type SortKey = "priority" | "appetite" | "premium" | "account";

export interface QueueFiltersProps {
  sort: SortKey;
  onSort: (value: SortKey) => void;
  onClear: () => void;
}

/** Federanorth's `.queue-filters` bar: sort select + clear filters. */
export function QueueFilters({ sort, onSort, onClear }: QueueFiltersProps) {
  function handleSort(event: ChangeEvent<HTMLSelectElement>) {
    onSort(event.target.value as SortKey);
  }

  return (
    <div className="queue-filters">
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
