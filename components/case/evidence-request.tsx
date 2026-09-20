"use client";

import { useRef, useState } from "react";
import type { RankedSubmission } from "@/lib/domain/types";
import { tableFor } from "@/lib/domain/appetite/registry";
import { Icon } from "@/components/ui/icon";

export interface EvidenceRequestGap {
  label: string;
  needs?: string;
}

export interface EvidenceRequestProps {
  submission: RankedSubmission;
  openGaps: EvidenceRequestGap[];
}

/** A draft only; copying it does not send anything or mark requests sent. Ported from
 *  federanorth's `evidenceRequest` (`src/decision/review.js`). */
function draftFor(submission: RankedSubmission, gaps: EvidenceRequestGap[]): string {
  const header = `Subject: Information needed — ${submission.id} / ${submission.accountName}`;
  if (gaps.length === 0) {
    return `${header}\n\nNo outstanding evidence requests for this submission.`;
  }
  const body = gaps
    .map((gap, index) => `${index + 1}. ${gap.needs ?? `Confirm ${gap.label.toLowerCase()}.`}`)
    .join("\n");
  const reviewName = tableFor(submission.lineOfBusiness)?.displayName.toLowerCase() ?? "submission";
  return `${header}\n\nPlease provide the following to complete our ${reviewName} review:\n\n${body}\n\nPlease include the source documents and dates covered. Thank you.`;
}

export function EvidenceRequest({ submission, openGaps }: EvidenceRequestProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(() => draftFor(submission, openGaps));

  function copyRequest() {
    const text = textareaRef.current?.value ?? draft;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  function rebuild() {
    const fresh = draftFor(submission, openGaps);
    setDraft(fresh);
    if (textareaRef.current) textareaRef.current.value = fresh;
  }

  return (
    <details className="evidence-request request-draft">
      <summary>Prepare evidence request</summary>
      <p>A draft only; copying it does not send anything or mark requests sent.</p>
      <textarea ref={textareaRef} rows={7} aria-label="Evidence request draft" defaultValue={draft} />
      <div className="request-actions">
        <button type="button" className="button ghost" onClick={copyRequest}>
          <Icon name="copy" /> Copy request
        </button>
        <button type="button" className="button ghost" onClick={rebuild}>
          Rebuild from open requests
        </button>
      </div>
    </details>
  );
}
