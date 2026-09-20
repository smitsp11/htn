# W1 — Appetite Flag Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact, color-coded appetite-flag summary (red / yellow / preferred) on every queue row, each chip revealing its factor reasons on hover — the "score shows its work" pattern — without touching the appetite engine.

**Architecture:** A new pure helper `lib/rankings/flags.ts` maps each factor's existing `AppetiteVerdict` to a display tone and tallies per submission. `queue-table.tsx` gains one "Flags" column that renders the tally as chips with a `title` of the underlying reasons. Nothing new is computed about appetite; we only re-present `RankedSubmission.factors[]` that the engine already produced.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, React 19 (server-rendered rows), `node:test` + `tsx`, plain CSS in `app/globals.css`.

**Invariants (must hold after every task):** appetite engine untouched; no change to `lib/domain/types.ts` contracts; product read-only; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## File Structure

- `lib/rankings/flags.ts` — NEW. Pure verdict→tone mapping + per-submission tally + reason grouping. No React, so it is node-testable.
- `tests/flags.test.ts` — NEW. Unit tests for the helper.
- `components/dashboard/queue-table.tsx` — MODIFY. Add a "Flags" header + cell.
- `app/globals.css` — MODIFY. Add `.flag-chip` tone styles.

---

## Task 1: Flag helper (pure, tested)

**Files:**
- Create: `lib/rankings/flags.ts`
- Test: `tests/flags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/flags.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { flagTone, flagSummary, reasonsByTone } from "../lib/rankings/flags";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("flagTone maps each verdict to its display tone", () => {
  assert.equal(flagTone("not_acceptable"), "red");
  assert.equal(flagTone("unknown"), "yellow");
  assert.equal(flagTone("target"), "preferred");
  assert.equal(flagTone("acceptable"), "preferred");
});

test("flagSummary tallies the eight factors into three tones", () => {
  const s = flagSummary(evaluateAppetite(fullTarget));
  assert.equal(s.red + s.yellow + s.preferred, 8);
  assert.equal(s.red, 0);
  assert.equal(s.yellow, 0);
  assert.equal(s.preferred, 8);
});

test("a submission with missing data reports yellow flags", () => {
  const s = flagSummary(evaluateAppetite(empty));
  assert.ok(s.yellow > 0, "empty submission should have unknown/yellow flags");
});

test("reasonsByTone groups the factor reasons under each tone", () => {
  const grouped = reasonsByTone(evaluateAppetite(contradictory));
  assert.ok(Array.isArray(grouped.red));
  assert.ok(grouped.red.length >= 1, "contradictory fixture has a failing factor");
  assert.equal(typeof grouped.red[0], "string");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/flags.test.ts`
Expected: FAIL — `Cannot find module '../lib/rankings/flags'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rankings/flags.ts
import type { AppetiteVerdict, RankedSubmission } from "@/lib/domain/types";

export type FlagTone = "red" | "yellow" | "preferred";

/** not_acceptable is a hard concern (red), unknown is a data gap (yellow),
 *  target/acceptable are wanted business (preferred). Pure re-presentation of
 *  the verdict the engine already assigned; no appetite logic here. */
export function flagTone(verdict: AppetiteVerdict): FlagTone {
  if (verdict === "not_acceptable") return "red";
  if (verdict === "unknown") return "yellow";
  return "preferred";
}

export interface FlagSummary {
  red: number;
  yellow: number;
  preferred: number;
}

export function flagSummary(submission: RankedSubmission): FlagSummary {
  const summary: FlagSummary = { red: 0, yellow: 0, preferred: 0 };
  for (const factor of submission.factors) summary[flagTone(factor.verdict)] += 1;
  return summary;
}

/** Factor reasons grouped by tone, for chip hover text / tooltips. */
export function reasonsByTone(submission: RankedSubmission): Record<FlagTone, string[]> {
  const grouped: Record<FlagTone, string[]> = { red: [], yellow: [], preferred: [] };
  for (const factor of submission.factors) grouped[flagTone(factor.verdict)].push(`${factor.label}: ${factor.reason}`);
  return grouped;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/flags.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/flags.ts tests/flags.test.ts
git commit -m "feat(flags): verdict->tone flag helper for queue rows"
```

---

## Task 2: Flags column in the queue table

**Files:**
- Modify: `components/dashboard/queue-table.tsx`

- [ ] **Step 1: Import the helper.** Add to the imports at the top of `components/dashboard/queue-table.tsx`:

```tsx
import { flagSummary, reasonsByTone, type FlagTone } from "@/lib/rankings/flags";
```

- [ ] **Step 2: Add the header cell.** In the `<thead>` row, insert a new `<th>` immediately after `<th>Status</th>`:

```tsx
<th>Flags</th>
```

- [ ] **Step 3: Add the flag cell.** In the `<tbody>` row, insert this `<td>` immediately after the Status cell (`<td><span className={`status-badge ...`}>...</span></td>`):

```tsx
<td className="flags-cell">
  <FlagChips submission={submission} />
</td>
```

- [ ] **Step 4: Add the `FlagChips` component.** Append this function at the bottom of the same file, after the `QueueTable` function:

```tsx
const TONE_ORDER: FlagTone[] = ["red", "yellow", "preferred"];
const TONE_LABEL: Record<FlagTone, string> = { red: "not acceptable", yellow: "unresolved", preferred: "wanted" };

function FlagChips({ submission }: { submission: RankedSubmission }) {
  const summary = flagSummary(submission);
  const reasons = reasonsByTone(submission);
  return (
    <span className="flag-chips">
      {TONE_ORDER.map((tone) =>
        summary[tone] > 0 ? (
          <span
            key={tone}
            className={`flag-chip flag-${tone}`}
            title={reasons[tone].join("\n")}
            aria-label={`${summary[tone]} ${TONE_LABEL[tone]}`}
          >
            {summary[tone]}
          </span>
        ) : null,
      )}
    </span>
  );
}
```

- [ ] **Step 5: Fix the detail row colSpan.** The expanded detail row spans all columns. Find `<td colSpan={10}>` in the `detail-row` and change it to `colSpan={11}` (we added one column).

- [ ] **Step 6: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS. (No test asserts on this JSX yet; Task 3 adds one.)

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/queue-table.tsx
git commit -m "feat(queue): show red/yellow/preferred flag chips per row"
```

---

## Task 3: Render test for the flags cell

**Files:**
- Test: `tests/queue-flags-ui.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/queue-flags-ui.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueTable } from "../components/dashboard/queue-table";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("queue rows render flag chips with reason tooltips", () => {
  const submissions = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(
    createElement(QueueTable, { submissions, expandedId: null, onToggle: () => {} }),
  );
  assert.match(html, /flag-chip/, "expected at least one flag chip");
  assert.match(html, /flag-yellow/, "empty submission should produce a yellow chip");
  assert.match(html, /title="[^"]+:/, "chips carry factor-reason tooltips");
});
```

- [ ] **Step 2: Run test to verify it passes** (implementation already exists from Task 2)

Run: `npx tsx --test tests/queue-flags-ui.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/queue-flags-ui.test.ts
git commit -m "test(queue): assert flag chips and tooltips render"
```

---

## Task 4: Flag chip styles

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append chip styles.** Add to the end of `app/globals.css`:

```css
.flag-chips { display: inline-flex; gap: 4px; }
.flag-chip {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 10px; font-size: 12px; font-weight: 600; cursor: default;
}
.flag-chip.flag-red { background: #fdecea; color: #b3261e; }
.flag-chip.flag-yellow { background: #fef7e0; color: #8a6d00; }
.flag-chip.flag-preferred { background: #e6f4ea; color: #1e7d34; }
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(queue): flag chip tones (red/yellow/preferred)"
```

---

## Self-Review Notes

- **Spec coverage:** flag tally per row (Task 2), reasons on hover (`title`, Task 2), tones styled (Task 4), tested at helper (Task 1) and render (Task 3) levels. ✅
- **Type consistency:** `FlagTone` and `FlagSummary` defined in Task 1 are the exact names imported in Tasks 2–3. `flagSummary` / `reasonsByTone` signatures match. ✅
- **No contract change:** reads `RankedSubmission.factors[]` only; `lib/domain/types.ts` untouched. ✅
- **Accessibility:** each chip has `aria-label`; the count is visible text. The `sr-only` details header pattern already in the table is preserved.
- **Open choice for review:** chip shows a count per tone. Alternative is one chip per failing factor (more granular, noisier). Counts chosen for a scannable queue; revisit if underwriters want per-factor chips inline.
