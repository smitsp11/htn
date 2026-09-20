"use client";

import { useState } from "react";
import type { RankedSubmission } from "@/lib/domain/types";
import { fixturesFor } from "@/lib/demo/fixtures";
import { addEvidenceFact } from "@/lib/demo/decision-store";
import { EvidenceTrail } from "@/components/case/evidence-trail";

/**
 * Demo-simple evidence intake, ported from federanorth's `intakePanel`
 * (`src/decision/intake-panel.js`). There is no real extraction here: "Extract proposed
 * facts" surfaces the fixed intake proposals for this demo bundle. Confirming writes one
 * evidence fact per selected proposal to the local decision store -- source, date, and
 * citation attached per fact, not folded into a single free-text blob -- so the trail below
 * can show where each value came from. It never recomputes the appetite score itself; that
 * stays the deterministic engine's job.
 */
export function EvidenceIntake({ submission }: { submission: RankedSubmission }) {
  const proposals = fixturesFor(submission.id).intakeProposals;
  const [sourceName, setSourceName] = useState("");
  const [sourceDate, setSourceDate] = useState("");
  const [note, setNote] = useState("");
  const [extracted, setExtracted] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  function extract() {
    setExtracted(true);
    setSelected(Object.fromEntries(proposals.map((_, index) => [index, true])));
  }

  function toggle(index: number) {
    setSelected((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  function confirm() {
    const chosen = proposals.filter((_, index) => selected[index]);
    if (chosen.length === 0) return;
    for (const proposal of chosen) {
      addEvidenceFact({
        submissionId: submission.id,
        factorKey: proposal.factorKey,
        factorLabel: proposal.factorLabel,
        value: proposal.proposedValue,
        source: sourceName.trim() || "Unnamed source",
        sourceDate: sourceDate || undefined,
        citation: [proposal.citation, proposal.quote, note.trim() || null].filter(Boolean).join(" — "),
        recordedAt: new Date().toISOString(),
      });
    }
    setStatus(`Logged ${chosen.length} fact${chosen.length === 1 ? "" : "s"} to the evidence trail below.`);
    setNote("");
    setRefreshKey((key) => key + 1);
  }

  return (
    <section className="evidence-intake">
      <details>
        <summary>Add evidence to this case</summary>
        <label>
          Source name or URL
          <input
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            maxLength={300}
            placeholder="Broker email / statement of values"
          />
        </label>
        <label>
          Source document date
          <input type="date" value={sourceDate} onChange={(event) => setSourceDate(event.target.value)} />
        </label>
        <label>
          Evidence text
          <textarea
            rows={5}
            maxLength={20000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Include the submission reference, relevant facts, units and dates."
          />
        </label>
        <button type="button" className="button mint" onClick={extract}>
          Show suggested facts
        </button>
        {extracted ? (
          <div className="evidence-proposals">
            {proposals.length === 0 ? (
              <p>No proposed facts found for this demo bundle.</p>
            ) : (
              <>
                {proposals.map((proposal, index) => (
                  <label className="evidence-proposal" key={`${proposal.factorLabel}-${index}`}>
                    <input type="checkbox" checked={Boolean(selected[index])} onChange={() => toggle(index)} />
                    <span>
                      <b>{proposal.factorLabel}:</b> {proposal.proposedValue}
                      <blockquote>{proposal.quote}</blockquote>
                      <small>{proposal.citation}</small>
                    </span>
                  </label>
                ))}
                <div className="evidence-confirm">
                  <button type="button" className="button mint" onClick={confirm}>
                    Log selected facts to this case
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
        {status ? (
          <p role="status" aria-live="polite">
            {status}
          </p>
        ) : null}
        <EvidenceTrail submission={submission} refreshKey={refreshKey} />
      </details>
    </section>
  );
}
