"use client";

import type { ChangeEvent } from "react";
import { Icon } from "@/components/ui/icon";

export interface PaginationProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

const PAGE_SIZES = [10, 15, 25, 50];

/** Federanorth's table-footer / `.pagination` strip: rows-per-page, page label, prev/next. */
export function Pagination({ page, pageCount, pageSize, total, onPage, onPageSize }: PaginationProps) {
  function handlePageSize(event: ChangeEvent<HTMLSelectElement>) {
    onPageSize(Number(event.target.value));
  }

  return (
    <div className="table-footer">
      <span aria-live="polite">
        {total} submission{total === 1 ? "" : "s"}
      </span>
      <div className="pagination">
        <label>
          Rows per page
          <select value={pageSize} onChange={handlePageSize} aria-label="Rows per page">
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span id="page-label">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className="icon-button prev"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <Icon name="chevron" />
        </button>
        <button
          type="button"
          className="icon-button next"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          <Icon name="chevron" />
        </button>
      </div>
    </div>
  );
}
