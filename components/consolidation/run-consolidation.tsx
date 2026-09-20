"use client";

import { useEffect, useState } from "react";
import type { FactorKey } from "@/lib/domain/types";
import type { ResolvedValue } from "@/lib/enrichment/provenance";
import { formatFieldValue } from "@/lib/consolidation/steps";

interface LiveStep {
  channel: string;
  message: string;
  ok: boolean;
}

interface ConsolidateResponse {
  mode: "browserbase" | "fixture";
  configured: boolean;
  resolved: Partial<Record<FactorKey, ResolvedValue<number | string>>>;
  steps: LiveStep[];
  liveViewUrl?: string;
  error?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function impactLine(count: number): string {
  const n = Math.max(count, 0);
  const noun = n === 1 ? "broker follow-up" : "broker follow-ups";
  return `${n} ${noun} avoided — fields recovered from existing channels.`;
}

export function RunConsolidation({
  submissionId,
  fields,
  labels,
}: {
  submissionId: string;
  /** Unknown factor keys to recover; sent so the engine can synthesize channel data for them. */
  fields: FactorKey[];
  labels: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConsolidateResponse | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!result) {
      setVisibleCount(0);
      setShowDetails(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setVisibleCount(0);
      setShowDetails(false);
      for (let i = 1; i <= result.steps.length; i++) {
        if (cancelled) return;
        setVisibleCount(i);
        const justShown = result.steps[i - 1];
        const pauseMs = justShown?.message.startsWith("Reading") ? 3000 : 550;
        await sleep(pauseMs);
      }
      if (!cancelled) setShowDetails(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [result]);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setVisibleCount(0);
    setShowDetails(false);
    try {
      const response = await fetch("/api/consolidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, fields }),
      });
      const payload = (await response.json()) as ConsolidateResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Consolidation failed.");
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Consolidation failed.");
    } finally {
      setBusy(false);
    }
  }

  const resolvedEntries = result
    ? (Object.entries(result.resolved) as [FactorKey, ResolvedValue<number | string>][])
    : [];
  const visibleSteps = result?.steps.slice(0, visibleCount) ?? [];

  return (
    <section className="consol" aria-label="Live channel consolidation">
      <div className="consol-head">
        <div>
          <span className="consol-eyebrow">Browserbase</span>
          <h4 className="consol-title">Consolidate broker channels</h4>
        </div>
        <button type="button" className="consol-btn" onClick={run} disabled={busy}>
          {busy ? "Consolidating…" : "Consolidate"}
        </button>
      </div>

      {error ? <p className="consol-error">{error}</p> : null}

      {result ? (
        <div className="consol-result">
          <ul className="consol-steps">
            {visibleSteps.map((step, index) => (
              <li key={`${step.channel}-${index}`} className={step.ok ? "ok" : "fail"}>
                {step.message}
              </li>
            ))}
          </ul>
          {showDetails && resolvedEntries.length > 0 ? (
            <>
              <p className="consol-impact">{impactLine(resolvedEntries.length)}</p>
              <ul className="consol-chips">
                {resolvedEntries.map(([key, value]) => (
                  <li key={key}>
                    <strong>{labels[key] ?? key}</strong>
                    <span>{formatFieldValue(key, value.value)}</span>
                    <small>{value.provenance.source}</small>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
