"use client";

import { useState } from "react";
import type { RfiDraft as RfiDraftData } from "@/lib/agent/rfi";

export interface RfiDraftProps {
  draft: RfiDraftData;
}

export function RfiDraft({ draft }: RfiDraftProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  };
  const copyLabel = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed — select the text" : "Copy draft";
  return (
    <div className="rfi">
      <div className="rfi-head">
        <strong className="rfi-subject">{draft.subject}</strong>
        <button type="button" className="rfi-copy" onClick={() => void copy()}>
          {copyLabel}
        </button>
      </div>
      <pre className="rfi-body">{draft.body}</pre>
      <small className="rfi-note">Draft only — review and send from your own email. Nothing is sent by this tool.</small>
    </div>
  );
}
