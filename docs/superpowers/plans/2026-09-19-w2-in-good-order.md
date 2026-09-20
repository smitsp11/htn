# W2 — "In Good Order" Completeness + Effort-to-Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For every submission, derive a completeness profile ("N of 8 required fields resolved", the list of missing fields, and whether it is *in good order*) plus an **Effort-to-Decision** value, and surface an "In Good Order" checklist in the submission detail — turning dead `needs_investigation` rows into an actionable gate.

**Architecture:** A new pure helper `lib/rankings/completeness.ts` reads the existing `RankedSubmission.factors[]` (a factor with verdict `unknown` = a missing/ambiguous required field) and returns a `CompletenessProfile`. No new appetite logic and no new data — completeness is a *view* over verdicts the engine already produced. The submission detail replaces its ad-hoc "Unresolved fields" sentence with a proper checklist. `effortToDecision` is exported for W6's quadrant to consume later.

**Tech Stack:** Next.js 16, TypeScript strict, React 19 (server-rendered detail), `node:test` + `tsx`, CSS in `app/globals.css`.

**Invariants (must hold after every task):** appetite engine untouched; no change to `lib/domain/types.ts` contracts; `unknown` never counts as acceptable; product read-only; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## File Structure

- `lib/rankings/completeness.ts` — NEW. Pure `completenessOf(submission)` → `{ resolved, total, missing, missingLabels, inGoodOrder, effortToDecision }`.
- `tests/completeness.test.ts` — NEW. Unit tests.
- `components/dashboard/submission-detail.tsx` — MODIFY. Replace the unresolved sentence with an "In Good Order" checklist block.
- `tests/completeness-ui.test.ts` — NEW. Render test for the checklist.
- `app/globals.css` — MODIFY. Checklist styles.

---

## Task 1: Completeness helper (pure, tested)

**Files:**
- Create: `lib/rankings/completeness.ts`
- Test: `tests/completeness.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/completeness.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { completenessOf } from "../lib/rankings/completeness";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("a fully-specified submission is in good order with zero effort", () => {
  const c = completenessOf(evaluateAppetite(fullTarget));
  assert.equal(c.total, 8);
  assert.equal(c.resolved, 8);
  assert.equal(c.missing.length, 0);
  assert.equal(c.inGoodOrder, true);
  assert.equal(c.effortToDecision, 0);
});

test("an empty submission is not in good order and lists its missing fields", () => {
  const c = completenessOf(evaluateAppetite(empty));
  assert.equal(c.inGoodOrder, false);
  assert.ok(c.missing.length > 0);
  assert.equal(c.resolved + c.missing.length, c.total);
  // effortToDecision equals the number of unresolved required fields.
  assert.equal(c.effortToDecision, c.missing.length);
  // missingLabels are human strings, not raw enum keys.
  assert.ok(c.missingLabels.every((label) => !label.includes("_")));
});

test("a resolved-but-failing submission can still be in good order", () => {
  // contradictory has no unknowns (all fields present), so nothing to chase.
  const c = completenessOf(evaluateAppetite(contradictory));
  assert.equal(c.inGoodOrder, true);
  assert.equal(c.missing.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/completeness.test.ts`
Expected: FAIL — `Cannot find module '../lib/rankings/completeness'`.

> Note: if the `contradictory` fixture happens to contain an `unknown` factor, adjust the third test to use a fixture with all fields present, or assert `inGoodOrder === (missing.length === 0)` generically. Verify against `tests/fixtures/domain/submissions.ts` before implementing.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rankings/completeness.ts
import type { FactorKey, RankedSubmission } from "@/lib/domain/types";

export interface CompletenessProfile {
  /** Required fields with a non-unknown verdict. */
  resolved: number;
  /** Total required fields evaluated (always the 8 appetite factors). */
  total: number;
  /** Factor keys still unresolved (verdict === "unknown"). */
  missing: FactorKey[];
  /** Human labels for the missing factors, for UI copy. */
  missingLabels: string[];
  /** True when nothing is left to chase (missing.length === 0). */
  inGoodOrder: boolean;
  /** Count of unresolved required fields — the work between here and a
   *  confident verdict. 0 = ready to decide. W6's quadrant consumes this. */
  effortToDecision: number;
}

export function completenessOf(submission: RankedSubmission): CompletenessProfile {
  const missingFactors = submission.factors.filter((factor) => factor.verdict === "unknown");
  const missing = missingFactors.map((factor) => factor.key);
  const total = submission.factors.length;
  return {
    resolved: total - missing.length,
    total,
    missing,
    missingLabels: missingFactors.map((factor) => factor.label),
    inGoodOrder: missing.length === 0,
    effortToDecision: missing.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/completeness.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/completeness.ts tests/completeness.test.ts
git commit -m "feat(completeness): in-good-order + effort-to-decision helper"
```

---

## Task 2: "In Good Order" checklist in the detail view

**Files:**
- Modify: `components/dashboard/submission-detail.tsx`

- [ ] **Step 1: Import the helper.** Add to the imports at the top of `components/dashboard/submission-detail.tsx`:

```tsx
import { completenessOf } from "@/lib/rankings/completeness";
```

- [ ] **Step 2: Compute the profile.** Inside `SubmissionDetail`, replace the existing first line:

```tsx
const unresolved = submission.factors.filter((factor) => factor.verdict === "unknown");
```

with:

```tsx
const completeness = completenessOf(submission);
```

- [ ] **Step 3: Replace the unresolved callout.** Replace this existing block:

```tsx
{unresolved.length > 0 ? (
  <p className="missing-callout">
    Unresolved fields: {unresolved.map((factor) => factor.label.toLowerCase()).join(", ")}. These never count as acceptable.
  </p>
) : null}
```

with the "In Good Order" checklist:

```tsx
<div className="in-good-order" aria-label="Submission completeness">
  <p className="igo-header">
    <span className={`igo-badge ${completeness.inGoodOrder ? "igo-ready" : "igo-pending"}`}>
      {completeness.inGoodOrder ? "In good order" : `${completeness.effortToDecision} to resolve`}
    </span>
    <span className="igo-count">{completeness.resolved} of {completeness.total} required fields resolved</span>
  </p>
  {completeness.missing.length > 0 ? (
    <ul className="igo-checklist">
      {completeness.missingLabels.map((label) => (
        <li key={label}>Confirm {label.toLowerCase()}</li>
      ))}
    </ul>
  ) : null}
  {completeness.missing.length > 0 ? (
    <p className="igo-note">Unresolved fields never count as acceptable.</p>
  ) : null}
</div>
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/submission-detail.tsx
git commit -m "feat(detail): In Good Order checklist replaces unresolved sentence"
```

---

## Task 3: Render test for the checklist

**Files:**
- Test: `tests/completeness-ui.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/completeness-ui.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionDetail } from "../components/dashboard/submission-detail";
import { evaluateAppetite } from "../lib/domain/appetite";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("a complete submission reads 'In good order'", () => {
  const html = renderToStaticMarkup(
    createElement(SubmissionDetail, { submission: evaluateAppetite(fullTarget) }),
  );
  assert.match(html, /In good order/);
  assert.match(html, /8 of 8 required fields resolved/);
});

test("an incomplete submission shows a checklist of missing fields", () => {
  const html = renderToStaticMarkup(
    createElement(SubmissionDetail, { submission: evaluateAppetite(empty) }),
  );
  assert.match(html, /to resolve/);
  assert.match(html, /igo-checklist/);
  assert.match(html, /Confirm /);
});
```

- [ ] **Step 2: Run test to verify it passes** (implementation exists from Task 2)

Run: `npx tsx --test tests/completeness-ui.test.ts`
Expected: PASS.

> If `evaluateAppetite` is not the correct export for building a `RankedSubmission` from a fixture in the UI tests, mirror the exact import used by `tests/factor-breakdown.test.ts` (which renders a component the same way). Confirm before running.

- [ ] **Step 3: Commit**

```bash
git add tests/completeness-ui.test.ts
git commit -m "test(detail): assert In Good Order checklist rendering"
```

---

## Task 4: Checklist styles

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append styles.** Add to the end of `app/globals.css`:

```css
.in-good-order { margin: 8px 0; }
.igo-header { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; }
.igo-badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; }
.igo-badge.igo-ready { background: #e6f4ea; color: #1e7d34; }
.igo-badge.igo-pending { background: #fef7e0; color: #8a6d00; }
.igo-count { font-size: 13px; color: #5f6368; }
.igo-checklist { margin: 4px 0; padding-left: 18px; }
.igo-checklist li { font-size: 13px; }
.igo-note { font-size: 12px; color: #5f6368; margin: 4px 0 0; }
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(detail): In Good Order checklist styling"
```

---

## Self-Review Notes

- **Spec coverage:** completeness count + missing list + in-good-order flag + effort value (Task 1); checklist UI (Task 2); tests at both levels (Tasks 1, 3); styles (Task 4). ✅
- **Type consistency:** `CompletenessProfile` fields (`resolved`, `total`, `missing`, `missingLabels`, `inGoodOrder`, `effortToDecision`) defined in Task 1 are exactly the fields read in Task 2. ✅
- **No contract change:** reads `factors[]`; `lib/domain/types.ts` untouched. `effortToDecision` is exported from a `lib/rankings` helper, not added to the frozen `RankedSubmission`. ✅
- **Dependency note:** W6 (Appetite × Completeness quadrant) consumes `effortToDecision` from this helper — do not inline the same logic there; import it.
- **Fixture caveat (must verify before Step 3 of Task 1):** confirm in `tests/fixtures/domain/submissions.ts` whether `contradictory` contains any `unknown` factor. If it does, swap the third unit test to a genuinely-complete fixture or assert the generic invariant `inGoodOrder === (missing.length === 0)`.
