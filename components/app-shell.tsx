"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { RankingsResponse } from "@/lib/domain/types";
import type { RankingsErrorBody, RankingsErrorCategory } from "@/lib/rankings/errors";
import { SearchBar } from "@/components/queue/search-bar";
import { QueueWorkspace } from "@/components/queue/queue-workspace";
import { PortfolioInsights } from "@/components/queue/portfolio-insights";
import { QueueSkeleton } from "@/components/queue/queue-skeleton";
import { PipelineTrace } from "@/components/queue/pipeline-trace";
import { CaseView } from "@/components/case/case-view";
import { ChaseDialog } from "@/components/case/chase-dialog";
import { MethodologyDialog } from "@/components/case/methodology-dialog";

/** Shared fade-rise used for the queue <-> case view swap. */
const swap = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
};

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[] | null>(null);
  const [chaseOpen, setChaseOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [dataset, setDataset] = useState<"baseline" | "extended">("baseline");

  const loadRankings = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const response = await fetch(`/api/rankings?dataset=${dataset}`, { cache: "no-store", signal });
      const body: unknown = await response.json();
      if (!response.ok || typeof body !== "object" || body === null || !("submissions" in body)) {
        setError(toErrorBody(body, `Unable to load rankings (${response.status})`));
        return;
      }
      setData(body as RankingsResponse);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError({ error: caught instanceof Error ? caught.message : "Unable to load rankings", category: "unknown" });
    }
  }, [dataset]);

  useEffect(() => {
    const controller = new AbortController();
    void loadRankings(controller.signal);
    return () => controller.abort();
  }, [loadRankings]);

  function changeDataset(next: "baseline" | "extended") {
    if (next === dataset) return;
    setDataset(next);
    setData(null);
    setSelectedId(null);
    setMatchedIds(null);
  }

  // Loading / error / empty are rendered as a single crossfading group so state
  // changes read as a transition, not a flash.
  if (!data) {
    let stateKey = "loading";
    let panel: ReactNode = <QueueSkeleton />;
    if (error) {
      stateKey = "error";
      const copy = ERROR_HEADINGS[error.category];
      panel = (
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
    return (
      <MotionConfig reducedMotion="user">
        <AnimatePresence mode="wait">
          <motion.div key={stateKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {panel}
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
    );
  }

  if (data.submissions.length === 0) {
    return (
      <MotionConfig reducedMotion="user">
        <section className="state-panel empty-panel">
          <strong>No submissions were returned.</strong>
          <span>The queue is empty for the current query. Refresh to try again.</span>
          <button type="button" onClick={() => void loadRankings()}>
            Refresh queue
          </button>
        </section>
      </MotionConfig>
    );
  }

  const selected = selectedId ? data.submissions.find((submission) => submission.id === selectedId) : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <SearchBar key={dataset} dataset={dataset} onResult={setMatchedIds} />
      <AnimatePresence mode="wait">
        {selected ? (
          <motion.div key="case" {...swap}>
            <CaseView submission={selected} onBack={() => setSelectedId(null)} />
          </motion.div>
        ) : (
          <motion.div key="queue" {...swap}>
            <div className="queue-toolbar">
              <div className="dataset-toggle" role="group" aria-label="Dataset">
                <button
                  type="button"
                  className={dataset === "baseline" ? "active" : ""}
                  aria-pressed={dataset === "baseline"}
                  onClick={() => changeDataset("baseline")}
                >
                  Baseline
                </button>
                <button
                  type="button"
                  className={dataset === "extended" ? "active" : ""}
                  aria-pressed={dataset === "extended"}
                  onClick={() => changeDataset("extended")}
                >
                  Extended
                </button>
              </div>
              {dataset === "extended" ? (
                <p className="dataset-note">
                  Extended adds ~24 synthetic property submissions and evaluates every line against its own appetite table.
                </p>
              ) : null}
              <button type="button" className="button ghost" onClick={() => setChaseOpen(true)}>
                Chase list
              </button>
              <button type="button" className="button ghost" onClick={() => setMethodOpen(true)}>
                Scoring methodology
              </button>
            </div>
            <PortfolioInsights submissions={data.submissions} />
            <QueueWorkspace submissions={data.submissions} onOpen={setSelectedId} matchedIds={matchedIds} />
            <PipelineTrace trace={data.trace} queryTrace={data.queryTrace} />
          </motion.div>
        )}
      </AnimatePresence>
      <ChaseDialog open={chaseOpen} onClose={() => setChaseOpen(false)} submissions={data.submissions} />
      <MethodologyDialog dataset={dataset} open={methodOpen} onClose={() => setMethodOpen(false)} />
    </MotionConfig>
  );
}
