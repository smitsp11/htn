"use client";

import { useCallback, useEffect, useState } from "react";
import type { RankingsResponse } from "@/lib/domain/types";
import type { RankingsErrorBody, RankingsErrorCategory } from "@/lib/rankings/errors";
import { SearchBar } from "@/components/queue/search-bar";
import { QueueWorkspace } from "@/components/queue/queue-workspace";
import { PipelineTrace } from "@/components/queue/pipeline-trace";
import { CaseView } from "@/components/case/case-view";
import { ChaseDialog } from "@/components/case/chase-dialog";
import { MethodologyDialog } from "@/components/case/methodology-dialog";

function toErrorBody(body: unknown, fallback: string): RankingsErrorBody {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    const category = "category" in body ? body.category : undefined;
    return {
      error: body.error,
      category: category === "auth" || category === "configuration" || category === "query" ? category : "unknown",
    };
  }
  return { error: fallback, category: "unknown" };
}

/**
 * Error copy mirrors `components/dashboard/state-panels.tsx`'s
 * `errorHeadings` (that component is retired once this shell lands) so the
 * per-category message stays consistent with main's existing UX.
 */
const ERROR_HEADINGS: Record<RankingsErrorCategory, { title: string; hint: string }> = {
  auth: {
    title: "Federato authentication failed.",
    hint: "Check the organizer-provided credentials, the auth.product.federato.ai domain, and the audience in .env.local.",
  },
  configuration: {
    title: "Live mode is not configured.",
    hint: "Set the missing environment value, or keep FEDERATO_USE_DEMO_DATA=true to work from fixtures.",
  },
  query: {
    title: "Federato query failed.",
    hint: "The schema or query request was rejected. Check the query payload and try again.",
  },
  unknown: {
    title: "Could not evaluate the queue.",
    hint: "An unexpected error occurred while ranking submissions.",
  },
};

/**
 * Top-level client container: fetches the ranked queue once on mount, then
 * wires the search bar, queue workspace, full-screen case view, and the
 * chase-list / methodology dialogs together. This is the only component that
 * owns the rankings fetch -- everything below it (queue, case, dialogs)
 * receives data and callbacks as props.
 */
export function AppShell() {
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [error, setError] = useState<RankingsErrorBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[] | null>(null);
  const [chaseOpen, setChaseOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [dataset, setDataset] = useState<"baseline" | "extended">("baseline");

  const loadRankings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/rankings?dataset=${dataset}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok || typeof body !== "object" || body === null || !("submissions" in body)) {
        setError(toErrorBody(body, `Unable to load rankings (${response.status})`));
        return;
      }
      setData(body as RankingsResponse);
    } catch (caught) {
      setError({ error: caught instanceof Error ? caught.message : "Unable to load rankings", category: "unknown" });
    } finally {
      setLoading(false);
    }
  }, [dataset]);

  useEffect(() => {
    void loadRankings();
  }, [loadRankings]);

  if (loading && !data) {
    return (
      <section className="state-panel" role="status">
        Evaluating the submission queue…
      </section>
    );
  }

  if (error && !data) {
    const copy = ERROR_HEADINGS[error.category];
    return (
      <section className="state-panel error-panel" role="alert">
        <strong>{copy.title}</strong>
        <span>{error.error}</span>
        <small>{copy.hint}</small>
        <button type="button" onClick={() => void loadRankings()}>
          Try again
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="state-panel" role="status">
        Evaluating the submission queue…
      </section>
    );
  }

  if (data.submissions.length === 0) {
    return (
      <section className="state-panel empty-panel">
        <strong>No submissions were returned.</strong>
        <span>The queue is empty for the current query. Refresh to try again.</span>
        <button type="button" onClick={() => void loadRankings()}>
          Refresh queue
        </button>
      </section>
    );
  }

  const selected = selectedId ? data.submissions.find((submission) => submission.id === selectedId) : undefined;

  return (
    <>
      <SearchBar onResult={setMatchedIds} />
      {selected ? (
        <CaseView submission={selected} onBack={() => setSelectedId(null)} />
      ) : (
        <>
          <div className="queue-toolbar">
            <div className="dataset-toggle" role="group" aria-label="Dataset">
              <button
                type="button"
                className={dataset === "baseline" ? "active" : ""}
                aria-pressed={dataset === "baseline"}
                onClick={() => setDataset("baseline")}
              >
                Federato baseline
              </button>
              <button
                type="button"
                className={dataset === "extended" ? "active" : ""}
                aria-pressed={dataset === "extended"}
                onClick={() => setDataset("extended")}
              >
                Extended
              </button>
            </div>
            {dataset === "extended" && (
              <p className="dataset-note">
                Extended adds ~24 synthetic property submissions and scores every line of business through our researched appetite tables.
              </p>
            )}
            <button type="button" className="button ghost" onClick={() => setChaseOpen(true)}>
              Chase list
            </button>
            <button type="button" className="button ghost" onClick={() => setMethodOpen(true)}>
              Scoring methodology
            </button>
          </div>
          <QueueWorkspace submissions={data.submissions} onOpen={setSelectedId} matchedIds={matchedIds} />
          <PipelineTrace trace={data.trace} queryTrace={data.queryTrace} />
        </>
      )}
      <ChaseDialog open={chaseOpen} onClose={() => setChaseOpen(false)} submissions={data?.submissions ?? []} />
      <MethodologyDialog open={methodOpen} onClose={() => setMethodOpen(false)} />
    </>
  );
}
