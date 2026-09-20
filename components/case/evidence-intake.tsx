"use client";

import { useState } from "react";
import type { RankedSubmission } from "@/lib/domain/types";
import { fixturesFor } from "@/lib/demo/fixtures";
import { addEvidence } from "@/lib/demo/decision-store";

/**
 * Demo-simple evidence intake, ported from federanorth's `intakePanel`
 * (`src/decision/intake-panel.js`). There is no real extraction here: "Extract proposed
 * facts" surfaces the fixed intake proposals for this demo bundle, and confirming writes
 * the selected facts to the local decision store as a single evidence entry. It never
 * recomputes the appetite score itself — that stays the deterministic engine's job.
 */
export function EvidenceIntake({ submission }: { submission: RankedSubmission }) {
  const proposals = fixturesFor(submission.id).intakeProposals;
  const [sourceName, setSourceName] = useState("");
  const [sourceDate, setSourceDate] = useState("");
  const [note, setNote] = useState("");
  const [extracted, setExtracted] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState("");

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
    addEvidence({
      submissionId: submission.id,
      source: sourceName.trim() || "Unnamed source",
      note: [
        sourceDate ? `Source dated ${sourceDate}.` : null,
        note.trim() || null,
        ...chosen.map((proposal) => `${proposal.factorLabel}: ${proposal.proposedValue} (${proposal.quote}) — ${proposal.citation}`),
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
      addedAt: new Date().toISOString(),
    });
    setStatus(`Recorded ${chosen.length} fact${chosen.length === 1 ? "" : "s"} as evidence for ${submission.id}.`);
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
      </details>
    </section>
  );
}
