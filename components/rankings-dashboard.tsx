"use client";

import { useCallback, useEffect, useState } from "react";
import type { RankingsResponse } from "@/lib/domain/types";
import type { RankingsErrorBody } from "@/lib/rankings/errors";
import { DashboardView } from "./dashboard/dashboard-view";

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

export function RankingsDashboard() {
  const [data, setData] = useState<RankingsResponse | null>(null);
  const [error, setError] = useState<RankingsErrorBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadRankings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/rankings", { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    void loadRankings();
  }, [loadRankings]);

  return (
    <DashboardView
      data={data}
      error={error}
      loading={loading}
      expandedId={expandedId}
      onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
      onRefresh={() => void loadRankings()}
    />
  );
}
