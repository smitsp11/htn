"use client";

import { useState } from "react";
import type { RfiDraft as RfiDraftData } from "@/lib/agent/rfi";

export interface RfiDraftProps {
  draft: RfiDraftData;
}

export function RfiDraft({ draft }: RfiDraftProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rfi">
      <div className="rfi-head">
        <strong className="rfi-subject">{draft.subject}</strong>
        <button type="button" className="rfi-copy" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy draft"}
        </button>
      </div>
      <pre className="rfi-body">{draft.body}</pre>
      <small className="rfi-note">Draft only — review and send from your own email. Nothing is sent by this tool.</small>
    </div>
  );
}
