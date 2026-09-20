"use client";

import { useEffect, useState } from "react";
import type { RankedSubmission } from "@/lib/domain/types";
import { confirmEvidenceFact, evidenceFactsFor } from "@/lib/demo/decision-store";
import type { DemoEvidenceFact } from "@/lib/demo/types";

const STATE_LABEL: Record<DemoEvidenceFact["state"], string> = {
  observed: "Observed",
  confirmed: "Confirmed",
  disputed: "Disputed",
};

/**
 * The audit trail for logged evidence: every fact an underwriter has recorded for this
 * submission, with its source, when it was captured, and whether it's been confirmed or is
 * disputed. `disputed` is set automatically the moment two logged facts for the same factor
 * disagree on value (see `reconcileFactor` in lib/demo/decision-store.ts) -- never invented,
 * never resolved by anything but a person looking at both sources. Local demo persistence
 * only; it never feeds back into the appetite score.
 */
export function EvidenceTrail({ submission, refreshKey }: { submission: RankedSubmission; refreshKey?: number }) {
  const [facts, setFacts] = useState<DemoEvidenceFact[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState("");

  useEffect(() => {
    setFacts(evidenceFactsFor(submission.id));
  }, [submission.id, refreshKey]);

  function confirm(factId: string) {
    if (!confirmer.trim()) return;
    confirmEvidenceFact(submission.id, factId, confirmer.trim());
    setFacts(evidenceFactsFor(submission.id));
    setConfirmingId(null);
    setConfirmer("");
  }

  if (facts.length === 0) return null;

  return (
    <div className="evidence-trail">
      <h4>Evidence trail</h4>
      {facts.map((fact) => (
        <article className={`evidence-fact evidence-${fact.state}`} key={fact.id}>
          <header>
            <strong>{fact.factorLabel}</strong>
            <span className="evidence-fact-state">{STATE_LABEL[fact.state]}</span>
          </header>
          <p>
            <b>{fact.value}</b> — {fact.source}
            {fact.sourceDate ? ` (${fact.sourceDate})` : ""}
          </p>
          {fact.citation ? <p className="evidence-fact-citation">{fact.citation}</p> : null}
          {fact.state === "confirmed" ? (
            <small>
              Confirmed by {fact.confirmedBy} · {new Date(fact.confirmedAt!).toLocaleString()}
            </small>
          ) : fact.state === "disputed" ? (
            <small>Another logged value disagrees with this one — review both sources.</small>
          ) : confirmingId === fact.id ? (
            <div className="evidence-fact-confirm">
              <input
                value={confirmer}
                onChange={(event) => setConfirmer(event.target.value)}
                placeholder="Your name"
                maxLength={120}
              />
              <button type="button" className="button ghost" onClick={() => confirm(fact.id)} disabled={!confirmer.trim()}>
                Confirm
              </button>
            </div>
          ) : (
            <button type="button" className="button ghost" onClick={() => setConfirmingId(fact.id)}>
              Mark confirmed
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
