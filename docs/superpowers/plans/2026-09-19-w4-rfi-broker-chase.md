# W4 — RFI Broker-Chase Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GUARDRAIL (non-negotiable):** This feature **drafts** a broker request; it never sends anything. Sending is an outward-facing action outside this read-only product. The UI is copy-to-review only. Engineer sign-off on the outbound-drafting behavior recommended before Task 3.

**Goal:** For any submission with unresolved required fields, generate a ready-to-review "Request For Information" (RFI) email — a concise checklist of exactly the missing items — and surface it in the detail view as a copyable draft, so the underwriter's follow-up admin is one click instead of a hand-written email.

**Architecture:** A pure `lib/agent/rfi.ts` builds the draft deterministically from the W2 completeness profile (missing field labels) — no LLM needed, so it is fully testable and never fabricates. An optional LLM-polish path can reuse the existing `chatWithTools` wrapper later, but the MVP draft is template-based. The detail view shows the draft behind a disclosure with a copy control.

**Tech Stack:** Next.js 16, TypeScript strict, React 19, `node:test` + `tsx`, CSS in `app/globals.css`.

**Dependencies:** W2 (`lib/rankings/completeness.ts` → `completenessOf`). Complements W3 (null resolutions are the chase list).

**Invariants (must hold after every task):** no network send anywhere in this feature; appetite engine untouched; no contract change; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## File Structure

- `lib/agent/rfi.ts` — NEW. Pure `draftRfi(submission)` → `{ subject, body, missingItems }`.
- `tests/rfi.test.ts` — NEW.
- `components/dashboard/submission-detail.tsx` — MODIFY. Add an RFI draft disclosure.
- `components/rfi-draft/rfi-draft.tsx` (+ `.css`, `index.ts`) — NEW. Client copy control.
- `app/globals.css` — untouched (component CSS used).

---

## Task 1: RFI draft builder (pure, tested)

**Files:**
- Create: `lib/agent/rfi.ts`
- Test: `tests/rfi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/rfi.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { draftRfi } from "../lib/agent/rfi";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("a complete submission produces no RFI", () => {
  assert.equal(draftRfi(evaluateAppetite(fullTarget)), null);
});

test("an incomplete submission drafts a checklist email naming the account", () => {
  const ranked = evaluateAppetite(empty);
  const draft = draftRfi(ranked);
  assert.ok(draft, "expected a draft for an incomplete submission");
  assert.match(draft.subject, new RegExp(ranked.accountName));
  // Every missing field label appears as a checklist item.
  for (const label of ranked.factors.filter((f) => f.verdict === "unknown").map((f) => f.label)) {
    assert.ok(draft.body.includes(label), `body should request ${label}`);
    assert.ok(draft.missingItems.includes(label));
  }
  // Draft-only: no send/recipient side effect is expressed in the payload.
  assert.equal("to" in draft, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/rfi.test.ts`
Expected: FAIL — `Cannot find module '../lib/agent/rfi'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/agent/rfi.ts
import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";

export interface RfiDraft {
  subject: string;
  body: string;
  /** The human labels of the fields being requested. */
  missingItems: string[];
}

/** Build a review-only broker Request-For-Information from the unresolved
 *  required fields. Returns null when the submission is already in good order.
 *  Deterministic and template-based — it never invents a value or a fact. */
export function draftRfi(submission: RankedSubmission): RfiDraft | null {
  const { missingLabels } = completenessOf(submission);
  if (missingLabels.length === 0) return null;

  const subject = `Information needed to complete: ${submission.accountName} (${submission.id})`;
  const checklist = missingLabels.map((label) => `  • ${label}`).join("\n");
  const body =
    `Hi,\n\n` +
    `Thanks for the submission for ${submission.accountName}. To complete our review we still need the following:\n\n` +
    `${checklist}\n\n` +
    `Once we have these we can finish evaluating the account. Please reply with the details or attach the relevant documents (e.g. SOV, loss runs).\n\n` +
    `Thank you.`;

  return { subject, body, missingItems: missingLabels };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/rfi.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/rfi.ts tests/rfi.test.ts
git commit -m "feat(rfi): deterministic broker RFI draft from missing fields"
```

---

## Task 2: RFI draft component with copy control

**Files:**
- Create: `components/rfi-draft/rfi-draft.tsx`
- Create: `components/rfi-draft/rfi-draft.css`
- Create: `components/rfi-draft/index.ts`
- Test: `tests/rfi-draft-ui.test.ts`

- [ ] **Step 1: Write the failing test** (server-render smoke test; the copy button is client-only behavior)

```ts
// tests/rfi-draft-ui.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RfiDraft } from "../components/rfi-draft/rfi-draft";

test("renders subject and body of a draft", () => {
  const html = renderToStaticMarkup(
    createElement(RfiDraft, { draft: { subject: "Information needed: Acme (S1)", body: "Hi,\n  • Total premium\n", missingItems: ["Total premium"] } }),
  );
  assert.match(html, /Information needed: Acme/);
  assert.match(html, /Total premium/);
  assert.match(html, /Copy/); // copy control label present
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/rfi-draft-ui.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component + css + index**

```tsx
// components/rfi-draft/rfi-draft.tsx
"use client";

import { useState } from "react";
import type { RfiDraft as RfiDraftData } from "@/lib/agent/rfi";

export function RfiDraft({ draft }: { draft: RfiDraftData }) {
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
```

```ts
// components/rfi-draft/index.ts
import "./rfi-draft.css";
export { RfiDraft } from "./rfi-draft";
```

```css
/* components/rfi-draft/rfi-draft.css */
.rfi { border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px; margin: 8px 0; }
.rfi-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.rfi-subject { font-size: 13px; }
.rfi-copy { font-size: 12px; padding: 3px 10px; cursor: pointer; }
.rfi-body { white-space: pre-wrap; font-size: 13px; background: #fafafa; padding: 8px; border-radius: 6px; margin: 8px 0 4px; }
.rfi-note { color: #5f6368; font-size: 11px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/rfi-draft-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/rfi-draft tests/rfi-draft-ui.test.ts
git commit -m "feat(rfi): review-only draft component with copy control"
```

---

## Task 3: Wire the RFI disclosure into the detail view

**Files:**
- Modify: `components/dashboard/submission-detail.tsx`

- [ ] **Step 1: Imports.** Add:

```tsx
import { RfiDraft } from "@/components/rfi-draft";
import { draftRfi } from "@/lib/agent/rfi";
```

- [ ] **Step 2: Compute the draft.** Inside `SubmissionDetail`, after the `completeness` line (W2), add:

```tsx
const rfi = draftRfi(submission);
```

- [ ] **Step 3: Render behind a disclosure.** After the `in-good-order` block (and the W3 chips if present), add:

```tsx
{rfi ? (
  <details className="rfi-disclosure">
    <summary>Draft broker request ({rfi.missingItems.length} item{rfi.missingItems.length === 1 ? "" : "s"})</summary>
    <RfiDraft draft={rfi} />
  </details>
) : null}
```

- [ ] **Step 4: Verify typecheck + build + full suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/submission-detail.tsx
git commit -m "feat(detail): draft-broker-request disclosure for incomplete submissions"
```

---

## Optional Task 4: LLM-polished draft (deferred)

Only if time remains and the team wants warmer copy. Reuse `chatWithTools` from `lib/agent/openai.ts` with a system prompt that **rewrites** the deterministic `draft.body` for tone only, forbidden from adding or removing any requested item. Keep the deterministic draft as the ground truth and the fallback when `OPENAI_API_KEY` is absent. Not required for the MVP; the template draft is the shippable version.

---

## Self-Review Notes

- **Spec coverage:** deterministic draft from missing fields (Task 1), copyable review-only UI (Task 2), detail wiring (Task 3). ✅
- **Guardrail:** no send path exists; the component literally states nothing is sent; payload has no recipient. ✅
- **Depends on:** W2 `completenessOf`. Import it — do not recompute missing fields.
- **Type consistency:** `RfiDraft` (the data type in `lib/agent/rfi.ts`) is imported by the component as `RfiDraftData` to avoid clashing with the `RfiDraft` component name. ✅
- **No fabrication:** the draft only lists field labels the engine already flagged `unknown`; it asserts no values.
