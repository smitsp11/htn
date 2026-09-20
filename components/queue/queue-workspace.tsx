"use client";

import { useMemo, useState } from "react";
import type { RankedSubmission } from "@/lib/domain/types";
import { LANE_LABELS, laneForStatus, type Lane } from "@/lib/rankings/lanes";
import { Icon } from "@/components/ui/icon";
import { LaneTabs } from "@/components/queue/lane-tabs";
import { Pagination } from "@/components/queue/pagination";
import { QueueFilters, type SortKey, type SourceStatus } from "@/components/queue/queue-filters";
import { QueueTable } from "@/components/queue/queue-table";
import { ScopeSwitch, type Scope } from "@/components/queue/scope-switch";

export interface QueueWorkspaceProps {
  submissions: RankedSubmission[];
  onOpen: (id: string) => void;
  matchedIds: string[] | null;
}

/**
 * `LaneTabs.active` is a single `Lane` -- it has no vocabulary for "show every
 * lane at once". This local union adds that mode for the workspace's own
 * filtering; we still hand `LaneTabs` a real `Lane` (its first lane) when this
 * is `"all"` and give the user a separate affordance to get back to it, rather
 * than changing `LaneTabs`'s contract.
 */
type LaneFilter = Lane | "all";

const LANES = Object.keys(LANE_LABELS) as Lane[];

const SCOPE_LABELS: Record<Scope, string> = {
  property: "commercial property",
  other: "other lines",
  all: "all submissions",
};

/**
 * Empty-state copy that names *which* filters combined to produce zero rows, so a
 * stacked scope + lane filter reads as a filter (recoverable via Reset) rather than
 * a broken table.
 */
function emptyStateMessage(scope: Scope, lane: LaneFilter): string {
  const scopeLabel = SCOPE_LABELS[scope];
  if (lane === "all") return `No ${scopeLabel} submissions in view.`;
  return `No ${scopeLabel} submissions in the “${LANE_LABELS[lane]}” lane.`;
}

function laneCounts(list: RankedSubmission[]): Record<Lane, number> {
  const counts = Object.fromEntries(LANES.map((lane) => [lane, 0])) as Record<Lane, number>;
  for (const submission of list) counts[laneForStatus(submission.status)] += 1;
  return counts;
}

/**
 * Is this submission part of the commercial-property book? This is a
 * presentation-layer LINE-OF-BUSINESS slice (which book the row belongs to),
 * so it reads `lineOfBusiness` directly. It deliberately does NOT defer to the
 * appetite engine's `status`: status-based slicing worked only while property
 * was the sole scored line and everything else was `out_of_scope`. Once the
 * Extended dataset began scoring non-property lines (cgl, auto, cyber, excess,
 * health, lpl), those rows stopped being `out_of_scope`, so a status check
 * wrongly pulled them into "Commercial property". Slicing by line of business
 * keeps the two concerns separate: appetite scoping is the engine's job, book
 * membership is this component's.
 */
function isPropertyScope(submission: RankedSubmission): boolean {
  const line = submission.lineOfBusiness?.trim().toLowerCase();
  // A missing line stays in the property pipeline (the engine scores it with the
  // property table), so it belongs to the property book here too.
  return !line || line.includes("property");
}

/** Comparator for a given sort key, or `null` for "priority" (keep the engine's own rank order). */
function comparatorFor(sort: SortKey): ((a: RankedSubmission, b: RankedSubmission) => number) | null {
  switch (sort) {
    case "appetite":
      return (a, b) => b.score - a.score;
    case "premium":
      return (a, b) => {
        if (a.totalPremium == null && b.totalPremium == null) return 0;
        if (a.totalPremium == null) return 1; // undefined premium sorts last
        if (b.totalPremium == null) return -1;
        return b.totalPremium - a.totalPremium;
      };
    case "account":
      return (a, b) => a.accountName.localeCompare(b.accountName);
    default:
      return null;
  }
}

/**
 * Queue workspace container: composes the scope switch, lane tabs, filters,
 * table, empty state, and pagination, and owns the filter -> sort -> paginate
 * pipeline over the ranked queue (ported behavior-for-behavior from
 * federanorth's `dashboard-client.js#render`).
 */
export function QueueWorkspace({ submissions, onOpen, matchedIds }: QueueWorkspaceProps) {
  const [scope, setScope] = useState<Scope>("property");
  const [lane, setLane] = useState<LaneFilter>("all");
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>("active");
  const [sort, setSort] = useState<SortKey>("priority");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  function clearFilters() {
    setLane("all");
    setSourceStatus("active");
    setSort("priority");
    setPage(1);
  }

  // 1. Ask-bar filter: keep only submissions the LLM's grounded search matched.
  const matched = useMemo(
    () => (matchedIds ? submissions.filter((submission) => matchedIds.includes(submission.id)) : submissions),
    [submissions, matchedIds],
  );

  // 2. Scope: property / other lines / everything. See isPropertyScope() above
  // for why this slices by `lineOfBusiness` rather than appetite `status`.
  const scoped = useMemo(
    () =>
      matched.filter((submission) => {
        if (scope === "all") return true;
        return scope === "property" ? isPropertyScope(submission) : !isPropertyScope(submission);
      }),
    [matched, scope],
  );

  // 3. Source status. The frozen `RankedSubmission` contract carries no
  // bound/closed lifecycle flag: every submission the deterministic engine
  // ranked is, by definition, an open submission awaiting an underwriting
  // decision -- there is no separate "closed" record set in this data.
  // "Active" therefore means the full scoped set; "history"/"all" are meant to
  // widen that set to include bound/closed records, but since no such records
  // exist on the contract there is nothing to add, so all three values
  // currently resolve to the same set. The control stays wired (and visible in
  // the UI) so a real lifecycle field can slot in later without reshaping this
  // component.
  const sourceFiltered = scoped;

  // Lane counts reflect the scope+search+source-filtered set, i.e. before the
  // lane filter itself narrows the rows -- otherwise every non-active tab
  // would always show its own current count.
  const counts = useMemo(() => laneCounts(sourceFiltered), [sourceFiltered]);

  // 4. Lane.
  const laned = useMemo(
    () =>
      lane === "all"
        ? sourceFiltered
        : sourceFiltered.filter((submission) => laneForStatus(submission.status) === lane),
    [sourceFiltered, lane],
  );

  // 5. Sort.
  const sorted = useMemo(() => {
    const comparator = comparatorFor(sort);
    return comparator ? laned.slice().sort(comparator) : laned;
  }, [laned, sort]);

  // 6. Paginate, clamping the page in case a filter change shrank the set.
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(Math.max(page, 1), pageCount);
  const start = (clampedPage - 1) * pageSize;
  const visible = sorted.slice(start, start + pageSize);

  return (
    <section id="queue">
      <header className="queue-heading">
        <p className="eyebrow">Opportunity, in focus.</p>
        <h2>Commercial property queue</h2>
      </header>
      <ScopeSwitch
        value={scope}
        onChange={(next) => {
          setScope(next);
          // Reset the lane filter when the line-of-business scope changes: a lane
          // selected under the old scope (e.g. "Ready for review") can have zero
          // rows under the new one, which otherwise reads as a broken empty table
          // rather than a stacked filter.
          setLane("all");
          setPage(1);
        }}
      />
      <div className="queue-nav">
        <div className="lane-row">
          <button
            type="button"
            className="lane-all"
            aria-pressed={lane === "all"}
            onClick={() => {
              setLane("all");
              setPage(1);
            }}
          >
            All lanes in view
          </button>
          <LaneTabs
            counts={counts}
            active={lane === "all" ? LANES[0] : lane}
            onChange={(next) => {
              setLane(next);
              setPage(1);
            }}
          />
        </div>
        <QueueFilters
          sourceStatus={sourceStatus}
          sort={sort}
          onSourceStatus={(next) => {
            setSourceStatus(next);
            setPage(1);
          }}
          onSort={(next) => {
            setSort(next);
            setPage(1);
          }}
          onClear={clearFilters}
        />
      </div>
      {visible.length > 0 ? (
        <QueueTable submissions={visible} onOpen={onOpen} />
      ) : (
        <div className="empty-state">
          <Icon name="inbox" />
          <p>{emptyStateMessage(scope, lane)}</p>
          <button type="button" onClick={clearFilters}>
            Reset filters
          </button>
        </div>
      )}
      <Pagination
        page={clampedPage}
        pageCount={pageCount}
        pageSize={pageSize}
        total={sorted.length}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </section>
  );
}
