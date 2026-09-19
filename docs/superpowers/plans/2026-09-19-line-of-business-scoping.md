# Line-of-business scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify non-property submissions as `out_of_scope` so they are never scored on property factors, and surface them in a de-emphasised collapsed section instead of the ranked queue.

**Architecture:** Add a fourth `AppetiteStatus` value, `out_of_scope`. `evaluateAppetite` short-circuits before the eight property factors when a submission's line is a known non-property line (returns empty factors, score 0, an out-of-scope explanation/recommendation). The dashboard partitions the visible submissions and renders out-of-scope ones in a collapsed `<details>` section. Missing/empty lines stay in the property pipeline as `needs_investigation`.

**Tech Stack:** TypeScript, Next.js/React (server-rendered), `node:test` + `node:assert/strict`.

Design spec: `docs/superpowers/specs/2026-09-19-line-of-business-scoping-design.md`

---

## File Structure

- Modify `lib/domain/types.ts` — add `"out_of_scope"` to `AppetiteStatus`.
- Modify `lib/domain/appetite.ts` — `classifyScope()`, `evaluateAppetite` short-circuit, `statusOrder` entry.
- Modify `lib/domain/explanation.ts` — `recommendations`/`statusPhrase` entries, `ExplanationInput.lineOfBusiness`, out-of-scope early return.
- Modify `lib/rankings/presentation.ts` — `statusLabels` entry, `QueueSummary.out_of_scope`, `primaryReason` special-case.
- Create `components/dashboard/out-of-scope-section.tsx` — collapsed section listing Account · Line · State.
- Modify `components/dashboard/dashboard-view.tsx` — partition visible submissions, render the section.
- Modify `app/globals.css` — minimal styles for `.out-of-scope-panel`.
- Modify `tests/appetite.test.ts` — engine routing + `classifyScope` cases.
- Create `tests/presentation.test.ts` — `summarize` count, `statusLabels`, `primaryReason` for out-of-scope.
- Modify `tests/rankings-ui.test.ts` — collapsed section renders; out-of-scope excluded from the main table.

---

### Task 1: Engine — `out_of_scope` status and routing

**Files:**
- Modify: `lib/domain/types.ts:12`
- Modify: `lib/domain/explanation.ts`
- Modify: `lib/domain/appetite.ts`
- Test: `tests/appetite.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/appetite.test.ts`. Also add `classifyScope` to the existing import from `../lib/domain/appetite` (line 3-9) so this line reads:

```ts
import {
  classifyScope,
  computeScore,
  deriveStatus,
  evaluateAppetite,
  evaluateFactors,
  rankSubmissions,
} from "../lib/domain/appetite";
```

Then append these tests:

```ts
test("classifyScope: property, non-property, and missing lines", () => {
  assert.equal(classifyScope("Commercial Property"), "property");
  assert.equal(classifyScope("property"), "property");
  assert.equal(classifyScope("Cyber"), "out_of_scope");
  assert.equal(classifyScope("General Liability"), "out_of_scope");
  assert.equal(classifyScope(undefined), "unknown_line");
  assert.equal(classifyScope("   "), "unknown_line");
});

test("out of scope: a non-property line short-circuits before the property factors", () => {
  const ranked = evaluateAppetite({ ...fullTarget, lineOfBusiness: "Cyber" });
  assert.equal(ranked.status, "out_of_scope");
  assert.equal(ranked.factors.length, 0);
  assert.equal(ranked.score, 0);
  assert.match(ranked.recommendation, /out of scope/i);
  assert.match(ranked.explanation, /commercial property only/i);
  assert.match(ranked.explanation, /Cyber/);
});

test("out of scope: a property line is evaluated on all eight factors", () => {
  const ranked = evaluateAppetite({ ...fullTarget, lineOfBusiness: "Property" });
  assert.notEqual(ranked.status, "out_of_scope");
  assert.equal(ranked.factors.length, 8);
});

test("out of scope: a missing line stays in the property pipeline as needs_investigation", () => {
  const ranked = evaluateAppetite({ ...fullTarget, lineOfBusiness: undefined });
  assert.equal(ranked.status, "needs_investigation");
  assert.equal(ranked.factors.length, 8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/appetite.test.ts` (or `npm test`)
Expected: FAIL — `classifyScope` is not exported and `"out_of_scope"` is not assignable to `AppetiteStatus`.

- [ ] **Step 3: Implement the engine changes**

In `lib/domain/types.ts`, change line 12 from:

```ts
export type AppetiteStatus = "in_appetite" | "needs_investigation" | "out_of_appetite";
```

to:

```ts
export type AppetiteStatus = "in_appetite" | "needs_investigation" | "out_of_appetite" | "out_of_scope";
```

In `lib/domain/explanation.ts`, add the `out_of_scope` entries and the early return.

Change the `recommendations` map to:

```ts
const recommendations: Record<AppetiteStatus, string> = {
  in_appetite: "Review for acceptance",
  needs_investigation: "Investigate missing or ambiguous data",
  out_of_appetite: "Review for likely decline",
  out_of_scope: "Out of scope — line not written",
};
```

Change the `statusPhrase` map to:

```ts
const statusPhrase: Record<AppetiteStatus, string> = {
  in_appetite: "and is in appetite",
  needs_investigation: "and needs investigation",
  out_of_appetite: "but is out of appetite",
  out_of_scope: "and is out of scope",
};
```

Add `lineOfBusiness` to `ExplanationInput`:

```ts
export interface ExplanationInput {
  accountName: string;
  status: AppetiteStatus;
  score: number;
  factors: FactorEvaluation[];
  recommendation: string;
  lineOfBusiness?: string;
}
```

Add an early return at the very top of `buildExplanation`'s body (before it reads `input.factors`):

```ts
export function buildExplanation(input: ExplanationInput): string {
  if (input.status === "out_of_scope") {
    const line = input.lineOfBusiness?.trim() || "non-property";
    return `${input.accountName} is a ${line} submission. The 2025 appetite guidelines cover commercial property only, so no appetite is defined for this line. Recommendation: ${input.recommendation}.`;
  }

  const unacceptable = input.factors.filter((factor) => factor.verdict === "not_acceptable");
  // ...rest unchanged
```

In `lib/domain/appetite.ts`, add the scope type + classifier near the top-level exports (after the imports, before `SCORE_POINTS` is fine):

```ts
export type LineScope = "property" | "out_of_scope" | "unknown_line";

/**
 * Route a submission by its line of business. Property lines get the full
 * eight-factor appetite evaluation; known non-property lines are out of scope
 * (no property appetite is defined for them); a missing line stays in the
 * property pipeline so its unknown line factor drives needs_investigation.
 */
export function classifyScope(lineOfBusiness?: string): LineScope {
  const normalized = lineOfBusiness?.trim().toLowerCase();
  if (!normalized) return "unknown_line";
  if (normalized.includes("property")) return "property";
  return "out_of_scope";
}
```

Add the `out_of_scope` entry to `statusOrder` (sorted last):

```ts
const statusOrder: Record<AppetiteStatus, number> = {
  in_appetite: 0,
  needs_investigation: 1,
  out_of_appetite: 2,
  out_of_scope: 3,
};
```

Add the short-circuit at the top of `evaluateAppetite`:

```ts
export function evaluateAppetite(submission: CanonicalSubmission): RankedSubmission {
  if (classifyScope(submission.lineOfBusiness) === "out_of_scope") {
    const recommendation = recommendationFor("out_of_scope");
    return {
      ...submission,
      status: "out_of_scope",
      score: 0,
      factors: [],
      recommendation,
      explanation: buildExplanation({
        accountName: submission.accountName,
        status: "out_of_scope",
        score: 0,
        factors: [],
        recommendation,
        lineOfBusiness: submission.lineOfBusiness,
      }),
    };
  }

  const factors = evaluateFactors(submission);
  // ...rest unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the four new tests pass and all previously-passing tests still pass (fixtures use `"Property"` or a missing line, so none are reclassified).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/types.ts lib/domain/explanation.ts lib/domain/appetite.ts tests/appetite.test.ts
git commit -m "feat(appetite): out_of_scope status for non-property lines"
```

---

### Task 2: Presentation — count, label, and reason

**Files:**
- Modify: `lib/rankings/presentation.ts`
- Test: `tests/presentation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/presentation.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { primaryReason, statusLabels, summarize } from "../lib/rankings/presentation";

const cyber = evaluateAppetite({ id: "C1", accountName: "Cyber Co", lineOfBusiness: "Cyber", primaryRiskState: "TX" });
const property = evaluateAppetite({
  id: "P1",
  accountName: "Prop Co",
  lineOfBusiness: "Property",
  submissionType: "New business",
  primaryRiskState: "FL",
  tiv: 60_000_000,
  totalPremium: 80_000,
  buildingYear: 2015,
  approvedConstructionPercentage: 0.9,
  fiveYearLossValue: 0,
});

test("statusLabels has an out-of-scope label", () => {
  assert.equal(statusLabels.out_of_scope, "Out of scope");
});

test("summarize counts out_of_scope and does not fold it into out_of_appetite", () => {
  const summary = summarize([cyber, property]);
  assert.equal(summary.out_of_scope, 1);
  assert.equal(summary.out_of_appetite, 0);
  assert.equal(summary.total, 2);
});

test("primaryReason for out-of-scope names the line, not the factor fallback", () => {
  const reason = primaryReason(cyber);
  assert.match(reason, /Cyber/);
  assert.doesNotMatch(reason, /All eight factors/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/presentation.test.ts`
Expected: FAIL — `statusLabels.out_of_scope` is undefined and `summary.out_of_scope` does not exist.

- [ ] **Step 3: Implement the presentation changes**

In `lib/rankings/presentation.ts`:

Add the label to `statusLabels`:

```ts
export const statusLabels: Record<AppetiteStatus, string> = {
  in_appetite: "In appetite",
  needs_investigation: "Needs investigation",
  out_of_appetite: "Out of appetite",
  out_of_scope: "Out of scope",
};
```

Special-case `primaryReason` (add at the top of the function body, before the `byVerdict` fallback chain):

```ts
export function primaryReason(submission: RankedSubmission): string {
  if (submission.status === "out_of_scope") {
    const line = submission.lineOfBusiness?.trim() || "This line";
    return `${line} — no property appetite defined for this line.`;
  }
  const byVerdict = (verdict: RankedSubmission["factors"][number]["verdict"]) =>
    submission.factors.find((factor) => factor.verdict === verdict)?.reason;
  return byVerdict("not_acceptable") ?? byVerdict("unknown") ?? byVerdict("target") ?? "All eight factors are acceptable.";
}
```

Add `out_of_scope` to `QueueSummary` and initialise it in `summarize` (the `summary[submission.status] += 1` line already increments the right key):

```ts
export interface QueueSummary {
  total: number;
  in_appetite: number;
  needs_investigation: number;
  out_of_appetite: number;
  out_of_scope: number;
  /** Submissions with at least one unknown factor, regardless of status. */
  unresolved: number;
}

export function summarize(submissions: RankedSubmission[]): QueueSummary {
  const summary: QueueSummary = {
    total: 0,
    in_appetite: 0,
    needs_investigation: 0,
    out_of_appetite: 0,
    out_of_scope: 0,
    unresolved: 0,
  };
  for (const submission of submissions) {
    summary.total += 1;
    summary[submission.status] += 1;
    if (submission.factors.some((factor) => factor.verdict === "unknown")) summary.unresolved += 1;
  }
  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — new presentation tests pass; existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/presentation.ts tests/presentation.test.ts
git commit -m "feat(presentation): out_of_scope label, count, and reason"
```

---

### Task 3: UI — collapsed out-of-scope section

**Files:**
- Create: `components/dashboard/out-of-scope-section.tsx`
- Modify: `components/dashboard/dashboard-view.tsx`
- Modify: `app/globals.css`
- Test: `tests/rankings-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/rankings-ui.test.ts` (the file already imports `rankSubmissions`, `response`, and defines the `text` helper):

```ts
test("out-of-scope submissions render in a collapsed section, not the main table", () => {
  const mixed = rankSubmissions([
    {
      id: "P1",
      accountName: "Prop Co",
      lineOfBusiness: "Property",
      submissionType: "New business",
      primaryRiskState: "FL",
      tiv: 60_000_000,
      totalPremium: 80_000,
      buildingYear: 2015,
      approvedConstructionPercentage: 0.9,
      fiveYearLossValue: 0,
    },
    { id: "C1", accountName: "Cyber Co", lineOfBusiness: "Cyber", primaryRiskState: "TX" },
  ]);
  const html = render({ data: response({ submissions: mixed }) });
  const bodyRows = (html.match(/<tr class="queue-row"/g) ?? []).length;
  assert.equal(bodyRows, 1); // only the property submission is in the ranked table
  const plain = text(html);
  assert.match(plain, /Out of scope \(1\)/);
  assert.match(plain, /Cyber Co/);
  assert.match(html, /out-of-scope-panel/);
});

test("no out-of-scope section renders when every submission is in scope", () => {
  const html = render({ data: response() });
  assert.doesNotMatch(html, /out-of-scope-panel/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/rankings-ui.test.ts`
Expected: FAIL — "Cyber Co" appears in a queue-row (bodyRows === 2) and `out-of-scope-panel` is absent.

- [ ] **Step 3: Implement the UI**

Create `components/dashboard/out-of-scope-section.tsx`:

```tsx
import type { RankedSubmission } from "@/lib/domain/types";

export interface OutOfScopeSectionProps {
  submissions: RankedSubmission[];
}

/**
 * Non-property submissions are out of scope for the 2025 commercial-property
 * appetite guidelines, so they are not scored. They stay visible — but
 * de-emphasised — in a collapsed section below the ranked queue.
 */
export function OutOfScopeSection({ submissions }: OutOfScopeSectionProps) {
  if (submissions.length === 0) return null;
  return (
    <details className="out-of-scope-panel">
      <summary>Out of scope ({submissions.length})</summary>
      <p>
        These submissions are not commercial property. The 2025 appetite guidelines
        define appetite for property only, so they are not scored.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Line</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((submission) => (
              <tr key={submission.id}>
                <td>
                  <strong>{submission.accountName}</strong>
                  <small>{submission.id}</small>
                </td>
                <td>{submission.lineOfBusiness ?? "—"}</td>
                <td>{submission.primaryRiskState ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
```

In `components/dashboard/dashboard-view.tsx`:

Add the import near the other component imports (top of file):

```ts
import { OutOfScopeSection } from "./out-of-scope-section";
```

Replace the `visibleSubmissions` block and the `QueueTable` usage so the visible list is partitioned. Change:

```ts
  const filtering = Array.isArray(matchedIds);
  const visibleSubmissions = Array.isArray(matchedIds)
    ? data.submissions.filter((submission) => matchedIds.includes(submission.id))
    : data.submissions;
```

to:

```ts
  const filtering = Array.isArray(matchedIds);
  const visibleSubmissions = Array.isArray(matchedIds)
    ? data.submissions.filter((submission) => matchedIds.includes(submission.id))
    : data.submissions;
  const rankedSubmissions = visibleSubmissions.filter((submission) => submission.status !== "out_of_scope");
  const outOfScopeSubmissions = visibleSubmissions.filter((submission) => submission.status === "out_of_scope");
```

Then change the `QueueTable` line from:

```tsx
        <QueueTable submissions={visibleSubmissions} expandedId={expandedId} onToggle={onToggle} />
```

to:

```tsx
        <QueueTable submissions={rankedSubmissions} expandedId={expandedId} onToggle={onToggle} />

        <OutOfScopeSection submissions={outOfScopeSubmissions} />
```

Append to `app/globals.css`:

```css
.out-of-scope-panel {
  margin-top: 1rem;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  background: var(--surface-muted, #f8fafc);
  color: var(--text-muted, #475569);
}

.out-of-scope-panel > summary {
  cursor: pointer;
  font-weight: 600;
}

.out-of-scope-panel p {
  margin: 0.5rem 0;
  font-size: 0.875rem;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — the collapsed section renders with the count, "Cyber Co" is in the section (bodyRows === 1), and the in-scope-only render has no `out-of-scope-panel`.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/out-of-scope-section.tsx components/dashboard/dashboard-view.tsx app/globals.css tests/rankings-ui.test.ts
git commit -m "feat(dashboard): collapsed out-of-scope section below the ranked queue"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors. (The exhaustive `Record<AppetiteStatus, …>` maps in `explanation.ts`, `presentation.ts`, and `appetite.ts` all now include `out_of_scope`.)

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all tests pass (174 prior + the new engine/presentation/UI tests).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Sanity-check against the real snapshot (optional but recommended)**

Run the app in offline mode (`FEDERATO_USE_DEMO_DATA` unset) and confirm the ranked queue shows ~38 property submissions with the three status cards reflecting property only, and the "Out of scope" section shows ~120 non-property submissions. No commit.
