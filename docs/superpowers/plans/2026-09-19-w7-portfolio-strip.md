# W7 — Portfolio-Impact Strip ("Control Tower" lite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **STRETCH:** Build only after W1/W2 land. Highest-end differentiator, lowest priority.

**Goal:** Show a header strip of queue-level aggregates — total in-appetite TIV, state concentration, and hazard exposure — so an underwriter sees the book, not just one row. This signals portfolio-level thinking (Federato's "Control Tower", Kalepa's portfolio dashboard) at MVP scale.

**Architecture:** A pure `lib/rankings/portfolio.ts` aggregates an array of `RankedSubmission` into a `PortfolioSummary` (read-only; no engine involvement). A `PortfolioStrip` component renders it above the queue. No per-submission "what if I bind this" delta in the MVP — that is a documented follow-up — the strip is queue-level only, which is enough to read as senior tooling.

**Tech Stack:** Next.js 16, TypeScript strict, React 19, `node:test` + `tsx`, component CSS.

**Dependencies:** none hard; renders best alongside W1/W2. Reuses the FEMA hazard rating already on `RankedSubmission.enrichment`.

**Invariants (must hold after every task):** read-only aggregation; appetite engine untouched; no contract change; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## File Structure

- `lib/rankings/portfolio.ts` — NEW. Pure `portfolioSummary(submissions)`.
- `tests/portfolio.test.ts` — NEW.
- `components/dashboard/portfolio-strip.tsx` (+ `.css`) — NEW.
- `components/dashboard/dashboard-view.tsx` — MODIFY. Render the strip above the queue panel.

---

## Task 1: Portfolio aggregation (pure, tested)

**Files:**
- Create: `lib/rankings/portfolio.ts`
- Test: `tests/portfolio.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/portfolio.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import { portfolioSummary } from "../lib/rankings/portfolio";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("aggregates count, in-appetite TIV, and state concentration", () => {
  const subs = rankSubmissions([fullTarget, empty, contradictory]);
  const p = portfolioSummary(subs);
  assert.equal(p.total, 3);
  // in-appetite TIV sums only submissions with status in_appetite and a numeric tiv.
  const expectedTiv = subs
    .filter((s) => s.status === "in_appetite" && typeof s.tiv === "number")
    .reduce((sum, s) => sum + (s.tiv ?? 0), 0);
  assert.equal(p.inAppetiteTiv, expectedTiv);
  // topStates is sorted, most-concentrated first, and counts sum to submissions with a state.
  const withState = subs.filter((s) => s.primaryRiskState).length;
  assert.equal(p.topStates.reduce((n, s) => n + s.count, 0), withState);
  if (p.topStates.length > 1) assert.ok(p.topStates[0].count >= p.topStates[1].count);
});

test("counts hazard exposure by composite rating", () => {
  const subs = rankSubmissions([fullTarget, empty, contradictory]);
  const p = portfolioSummary(subs);
  const totalRated = Object.values(p.hazardCounts).reduce((n, c) => n + c, 0);
  assert.equal(totalRated, subs.length); // every submission contributes a rating bucket (incl. "unknown")
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/portfolio.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```ts
// lib/rankings/portfolio.ts
import type { HazardRating, RankedSubmission } from "@/lib/domain/types";

export interface StateConcentration {
  state: string;
  count: number;
}

export interface PortfolioSummary {
  total: number;
  /** Sum of TIV across in-appetite submissions with a numeric TIV. */
  inAppetiteTiv: number;
  /** States by submission count, most concentrated first. */
  topStates: StateConcentration[];
  /** Submission counts bucketed by composite hazard rating (incl. "unknown"). */
  hazardCounts: Partial<Record<HazardRating, number>>;
}

export function portfolioSummary(submissions: RankedSubmission[]): PortfolioSummary {
  const states = new Map<string, number>();
  const hazardCounts: Partial<Record<HazardRating, number>> = {};
  let inAppetiteTiv = 0;

  for (const s of submissions) {
    if (s.status === "in_appetite" && typeof s.tiv === "number") inAppetiteTiv += s.tiv;
    if (s.primaryRiskState) states.set(s.primaryRiskState, (states.get(s.primaryRiskState) ?? 0) + 1);
    const rating: HazardRating = s.enrichment?.compositeRating ?? "unknown";
    hazardCounts[rating] = (hazardCounts[rating] ?? 0) + 1;
  }

  const topStates = [...states.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));

  return { total: submissions.length, inAppetiteTiv, topStates, hazardCounts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/portfolio.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/portfolio.ts tests/portfolio.test.ts
git commit -m "feat(portfolio): queue-level aggregation summary"
```

---

## Task 2: Portfolio strip component

**Files:**
- Create: `components/dashboard/portfolio-strip.tsx`
- Create: `components/dashboard/portfolio-strip.css`
- Test: `tests/portfolio-ui.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/portfolio-ui.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioStrip } from "../components/dashboard/portfolio-strip";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("renders total, in-appetite TIV, and a top state", () => {
  const subs = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(createElement(PortfolioStrip, { submissions: subs }));
  assert.match(html, /In-appetite TIV/);
  assert.match(html, /Submissions/);
  assert.match(html, /Top states|No state data/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/portfolio-ui.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component + css**

```tsx
// components/dashboard/portfolio-strip.tsx
import type { RankedSubmission } from "@/lib/domain/types";
import { formatMoney } from "@/lib/domain/format";
import { portfolioSummary } from "@/lib/rankings/portfolio";
import "./portfolio-strip.css";

export function PortfolioStrip({ submissions }: { submissions: RankedSubmission[] }) {
  const p = portfolioSummary(submissions);
  const topStates = p.topStates.slice(0, 3);
  return (
    <section className="portfolio-strip" aria-label="Portfolio overview">
      <div className="ps-metric"><span>Submissions</span><strong>{p.total}</strong></div>
      <div className="ps-metric"><span>In-appetite TIV</span><strong>{formatMoney(p.inAppetiteTiv)}</strong></div>
      <div className="ps-metric">
        <span>Top states</span>
        <strong>{topStates.length ? topStates.map((s) => `${s.state} (${s.count})`).join(", ") : "No state data"}</strong>
      </div>
    </section>
  );
}
```

```css
/* components/dashboard/portfolio-strip.css */
.portfolio-strip { display: flex; gap: 24px; padding: 12px 16px; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 12px; }
.ps-metric { display: flex; flex-direction: column; }
.ps-metric span { font-size: 12px; color: #5f6368; }
.ps-metric strong { font-size: 18px; }
```

> `formatMoney` from `lib/domain/format.ts` renders compact currency ($75M). Confirmed exported.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/portfolio-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/portfolio-strip.tsx components/dashboard/portfolio-strip.css tests/portfolio-ui.test.ts
git commit -m "feat(portfolio): queue-level overview strip"
```

---

## Task 3: Render the strip in the dashboard

**Files:**
- Modify: `components/dashboard/dashboard-view.tsx`

- [ ] **Step 1: Import.** Add:

```tsx
import { PortfolioStrip } from "./portfolio-strip";
```

- [ ] **Step 2: Render above the summary grid.** Immediately inside the returned fragment (before `<section className="summary-grid" ...>`), add:

```tsx
<PortfolioStrip submissions={data.submissions} />
```

> Use `data.submissions` (the full queue) so the portfolio view reflects the whole book, not the ask-bar-filtered subset. If the team prefers it to reflect the current filter, pass `visibleSubmissions` instead — call this out for review.

- [ ] **Step 3: Verify typecheck + build + full suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/dashboard-view.tsx
git commit -m "feat(dashboard): portfolio overview strip above the queue"
```

---

## Self-Review Notes

- **Spec coverage:** aggregation (Task 1), strip UI (Task 2), placement (Task 3). ✅
- **Read-only:** pure reduction over ranked submissions; no engine call, no contract change. ✅
- **Reuses:** `formatMoney` (`lib/domain/format.ts`), `RankedSubmission.enrichment.compositeRating` (FEMA hazard already attached).
- **Documented follow-up (not in MVP):** per-submission "how does binding this shift the book" delta — compute `portfolioSummary(all)` vs `portfolioSummary(all minus s)` when a row is selected. Add only if time remains.
- **Scope choice for review:** whole-book vs filtered-subset aggregation (Task 3 Step 2).
