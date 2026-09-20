"use client";

import { useEffect, useState } from "react";
import { getRequestState, setRequestState } from "@/lib/demo/decision-store";
import type { RequestState } from "@/lib/demo/types";

export type TaskSeverity = "blocking" | "material" | "minor";

export interface TaskCardProps {
  submissionId: string;
  requestKey: string;
  severity: TaskSeverity;
  label: string;
  question: string;
  needs?: string;
}

/**
 * A single evidence gap, ported from federanorth's `taskCard` (`src/decision/dashboard.js`).
 * Self-contained: it owns its own open/closed request state and writes straight through to
 * the demo decision store on each action, so it needs no parent wiring.
 */
export function TaskCard({ submissionId, requestKey, severity, label, question, needs }: TaskCardProps) {
  const [state, setState] = useState<RequestState>("open");

  // Restore any previously-recorded status for this request on mount, so
  // marking a card sent/received/waived survives a page reload. Read in an
  // effect (not initial state) to avoid a server/client hydration mismatch.
  useEffect(() => {
    const persisted = getRequestState(submissionId, requestKey);
    if (persisted) setState(persisted);
  }, [submissionId, requestKey]);

  function mark(next: RequestState) {
    setRequestState(submissionId, requestKey, next);
    setState(next);
  }

  const closed = state !== "open";

  return (
    <details className={`task sev-${severity}${closed ? " closed" : ""}`} open>
      <summary>
        <span className="sev-dot" aria-hidden="true" />
        <strong>{label}</strong>
        <span className="sev-tag">Evidence gap</span>
        {closed ? <span className="task-state">{state}</span> : null}
      </summary>
      <p>{question}</p>
      {needs ? (
        <ul className="needs">
          <li>{needs}</li>
        </ul>
      ) : null}
      <footer>
        <span className="task-actions">
          <button
            type="button"
            className={`task-action${state === "sent" ? " active" : ""}`}
            onClick={() => mark("sent")}
          >
            Mark sent
          </button>
          <button
            type="button"
            className={`task-action${state === "received" ? " active" : ""}`}
            onClick={() => mark("received")}
          >
            Evidence received
          </button>
          <button
            type="button"
            className={`task-action${state === "waived" ? " active" : ""}`}
            onClick={() => mark("waived")}
          >
            Waive
          </button>
        </span>
      </footer>
    </details>
  );
}
