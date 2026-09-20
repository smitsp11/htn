# Phase 2 — Restore W6 quadrant + W7 portfolio strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restore the two extensions dropped in the federanorth UI overhaul — the W6 Appetite×Completeness quadrant board and the W7 portfolio overview strip — into the current queue shell, styled to match.

**Architecture:** Restore the pure logic (`lib/rankings/quadrant.ts`, `lib/rankings/portfolio.ts`) and their tests verbatim from the original branches (they depend only on the still-frozen `RankedSubmission` + existing `completeness.ts`). Rebuild the two presentational components under `components/queue/` using current CSS tokens, wire the quadrant into `QueueWorkspace` as a List▸Quadrant view toggle and the portfolio strip into `AppShell` above the queue.

**Tech Stack:** Next.js 16, React 19, TypeScript, `tsx --test`. CSS via `@import` in `app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-09-20-extended-dataset-multiline-appetite-design.md` (Phase 2).

**Context that matters:**
- These features work best in Extended mode (Phase 1), where the quadrant "Work now" cell and the portfolio in-appetite TIV are actually populated. Baseline still renders them (mostly "deprioritize"/low TIV).
- Current CSS tokens: text `--ink`/`--ink-soft`/`--ink-faint`; surfaces `--surface`/`--surface-muted`/`--surface-hover`/`--panel`; lines `--border`/`--border-strong`; accents `--mint`/`--mint-tint`, `--amber`/`--amber-tint`, `--danger`/`--danger-tint`.
- `components/queue/queue.css` is already `@import`ed by `app/globals.css`; add the new styles there (no new @import needed).
- `QueueWorkspace` (`components/queue/queue-workspace.tsx`) owns scope/lane/sort/pagination. It computes `sourceFiltered` (scope-filtered, all lanes) then `laned`→`sorted`→`visible`. The quadrant should render over `sourceFiltered`.
- `AppShell` (`components/app-shell.tsx`) renders, in the queue (non-case) branch: `<QueueWorkspace .../>` then `<PipelineTrace .../>`. It holds `data` (the `RankingsResponse`).

---

## Task 1: Restore W6 quadrant logic + test (verbatim)

**Files:**
- Create: `lib/rankings/quadrant.ts`, `tests/quadrant.test.ts`

- [ ] **Step 1: Restore both files verbatim from the original branch**

```bash
cd /Users/smit/conductor/workspaces/htn/luanda
git show origin/w6-appetite-completeness-quadrant:lib/rankings/quadrant.ts > lib/rankings/quadrant.ts
git show origin/w6-appetite-completeness-quadrant:tests/quadrant.test.ts > tests/quadrant.test.ts
```

- [ ] **Step 2: Confirm dependencies resolve** — `quadrant.ts` imports `completenessOf` from `./completeness` (exists) and `RankedSubmission` from `@/lib/domain/types` (exists). `quadrant.test.ts` imports `evaluateAppetite`/`rankSubmissions` from `@/lib/domain/appetite` and fixtures `fullTarget`/`empty`/`contradictory` from `./fixtures/domain/submissions` (all exist).

- [ ] **Step 3: Run the test**

Run: `npx tsx --test tests/quadrant.test.ts`
Expected: PASS (6 tests). If the `contradictory` fixture no longer scores ≥60, that single assertion may need the fixture — but do NOT edit the fixture; if it fails, report as a concern.

- [ ] **Step 4: Full suite + typecheck + commit**

```bash
npm test && npm run typecheck
git add lib/rankings/quadrant.ts tests/quadrant.test.ts
git commit -m "feat(rankings): restore W6 appetite×completeness quadrant logic + tests"
```

---

## Task 2: Restore W7 portfolio logic + test (verbatim)

**Files:**
- Create: `lib/rankings/portfolio.ts`, `tests/portfolio.test.ts`

- [ ] **Step 1: Restore both files verbatim**

```bash
git show origin/w7-portfolio-strip:lib/rankings/portfolio.ts > lib/rankings/portfolio.ts
git show origin/w7-portfolio-strip:tests/portfolio.test.ts > tests/portfolio.test.ts
```

- [ ] **Step 2: Confirm dependencies** — `portfolio.ts` imports `HazardRating`/`RankedSubmission` from `@/lib/domain/types` (exist). Test imports `rankSubmissions` + the same fixtures.

- [ ] **Step 3: Run the test**

Run: `npx tsx --test tests/portfolio.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Full suite + typecheck + commit**

```bash
npm test && npm run typecheck
git add lib/rankings/portfolio.ts tests/portfolio.test.ts
git commit -m "feat(rankings): restore W7 portfolio-summary logic + tests"
```

---

## Task 3: QuadrantBoard component + styles + render test

**Files:**
- Create: `components/queue/quadrant-board.tsx`, `tests/quadrant-ui.test.ts`
- Modify: `components/queue/queue.css`

- [ ] **Step 1: Write the failing render test** `tests/quadrant-ui.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QuadrantBoard } from "../components/queue/quadrant-board";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget, empty } from "./fixtures/domain/submissions";

test("quadrant renders the four cells and places a work-now entry", () => {
  const subs = rankSubmissions([fullTarget, empty]);
  const html = renderToStaticMarkup(<QuadrantBoard submissions={subs} onOpen={() => {}} />);
  assert.match(html, /Work now/);
  assert.match(html, /Worth the effort/);
  assert.match(html, /Selective/);
  assert.match(html, /Deprioritize/);
  assert.match(html, /qc-work-now/);
});
```
(If the test file needs JSX, name it `.tsx`. Check how existing UI tests are named — e.g. `tests/queue-table` render tests — and match that. If they are `.ts` using `React.createElement`, follow that style instead of JSX.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/quadrant-ui.test.ts` (or `.tsx`)
Expected: FAIL — module missing.

- [ ] **Step 3: Create `components/queue/quadrant-board.tsx`** (adapted from the original W6 component; `onOpen` prop to match `QueueTable`):

```tsx
import type { RankedSubmission } from "@/lib/domain/types";
import { isTriageCandidate, quadrantOf, QUADRANT_CELLS, type QuadrantCell } from "@/lib/rankings/quadrant";

export interface QuadrantBoardProps {
  submissions: RankedSubmission[];
  onOpen: (id: string) => void;
  selectedId?: string | null;
}

export function QuadrantBoard({ submissions, onOpen, selectedId = null }: QuadrantBoardProps) {
  const byCell = new Map<QuadrantCell, RankedSubmission[]>();
  for (const cell of QUADRANT_CELLS) byCell.set(cell.cell, []);
  for (const s of submissions.filter(isTriageCandidate)) byCell.get(quadrantOf(s).cell)!.push(s);

  return (
    <div className="quadrant" role="group" aria-label="Appetite by completeness">
      {QUADRANT_CELLS.map((cell) => {
        const items = byCell.get(cell.cell)!;
        return (
          <section key={cell.cell} className={`quadrant-cell qc-${cell.cell}`} aria-label={cell.label}>
            <header>
              <strong>{cell.label}</strong>
              <small>{items.length}</small>
            </header>
            {items.length === 0 ? <p className="quadrant-empty">None</p> : null}
            <ul>
              {items.map((s) => (
                <li key={s.id}>
                  <button type="button" aria-pressed={selectedId === s.id} onClick={() => onOpen(s.id)}>
                    <span>{s.accountName}</span> <small>{s.score}/100</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Append styles to `components/queue/queue.css`** (federanorth tokens):

```css
/* W6 — Appetite × Completeness quadrant board */
.quadrant { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
.quadrant-cell { border: 1px solid var(--border); border-radius: 10px; padding: 12px; min-height: 130px; }
.quadrant-cell header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.quadrant-cell header strong { font-size: 14px; color: var(--ink); }
.quadrant-cell header small { font-size: 12px; color: var(--ink-faint); }
.quadrant-cell ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.quadrant-cell li button { width: 100%; display: flex; justify-content: space-between; gap: 8px; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 7px 9px; cursor: pointer; font-size: 13px; color: var(--ink); }
.quadrant-cell li button:hover { background: var(--surface-hover); }
.quadrant-cell li button small { color: var(--ink-faint); }
.quadrant-cell li button[aria-pressed="true"] { border-color: var(--mint); outline: 1px solid var(--mint); }
.quadrant-empty { margin: 0; font-size: 13px; color: var(--ink-faint); }
.qc-work-now { background: var(--mint-tint); }
.qc-worth-effort { background: var(--amber-tint); }
.qc-selective { background: var(--surface-muted); }
.qc-deprioritize { background: var(--danger-tint); }
@media (max-width: 720px) { .quadrant { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Run the render test + full suite**

Run: `npx tsx --test tests/quadrant-ui.test.ts` then `npm test`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add components/queue/quadrant-board.tsx components/queue/queue.css tests/quadrant-ui.test.ts
git commit -m "feat(queue): W6 quadrant board component + styles"
```

---

## Task 4: Wire the quadrant into QueueWorkspace (List ▸ Quadrant toggle)

**Files:**
- Modify: `components/queue/queue-workspace.tsx`, `components/queue/queue.css`

- [ ] **Step 1: Add a view-mode state + toggle.** In `QueueWorkspace`, add `const [view, setView] = useState<"list" | "quadrant">("list");`. Import `QuadrantBoard`. Add a toggle in the `queue-nav` (next to `QueueFilters`, or in the `lane-row`):

```tsx
<div className="view-toggle" role="group" aria-label="Queue view">
  <button type="button" aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button>
  <button type="button" aria-pressed={view === "quadrant"} className={view === "quadrant" ? "active" : ""} onClick={() => setView("quadrant")}>Quadrant</button>
</div>
```

- [ ] **Step 2: Branch the render.** When `view === "quadrant"`, render the board over the scope-filtered set and hide the lane row + pagination (the 2×2 replaces lane filtering):
  - Wrap the existing `lane-row` so it only renders when `view === "list"`.
  - Replace the table/empty block:
```tsx
{view === "quadrant" ? (
  <QuadrantBoard submissions={sourceFiltered} onOpen={onOpen} />
) : visible.length > 0 ? (
  <QueueTable submissions={visible} onOpen={onOpen} />
) : (
  <div className="empty-state">…existing…</div>
)}
```
  - Wrap `<Pagination .../>` so it only renders when `view === "list"`.
  - Keep the `ScopeSwitch` visible in both views (so you can quadrant the property book vs. all lines). When switching scope, leave `view` as-is.

- [ ] **Step 3: Style the view toggle** in `queue.css` (reuse the `.dataset-toggle` segmented pattern from Phase 1 for consistency):

```css
.view-toggle { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; }
.view-toggle button { padding: 4px 12px; font-size: 13px; background: var(--surface); color: var(--ink-soft); border: 0; cursor: pointer; }
.view-toggle button + button { border-left: 1px solid var(--border-strong); }
.view-toggle button.active { background: var(--mint); color: #fff; }
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build && npm test`
Expected: all green (existing queue-workspace tests still pass — the default `view` is "list", so their assertions are unchanged).

- [ ] **Step 5: Commit**

```bash
git add components/queue/queue-workspace.tsx components/queue/queue.css
git commit -m "feat(queue): List/Quadrant view toggle wiring the W6 board into the workspace"
```

---

## Task 5: PortfolioStrip component + styles + render test + wire into AppShell

**Files:**
- Create: `components/queue/portfolio-strip.tsx`, `tests/portfolio-ui.test.ts`
- Modify: `components/queue/queue.css`, `components/app-shell.tsx`

- [ ] **Step 1: Write the failing render test** `tests/portfolio-ui.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioStrip } from "../components/queue/portfolio-strip";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget, empty } from "./fixtures/domain/submissions";

test("portfolio strip shows total, TIV and state metrics", () => {
  const subs = rankSubmissions([fullTarget, empty]);
  const html = renderToStaticMarkup(<PortfolioStrip submissions={subs} />);
  assert.match(html, /Submissions/);
  assert.match(html, /Total TIV/);
  assert.match(html, /In-appetite TIV/);
  assert.match(html, /Top states/);
});
```
(Match the JSX-vs-createElement convention of the existing render tests, as in Task 3 Step 1.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/portfolio-ui.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `components/queue/portfolio-strip.tsx`** (adapted from original W7):

```tsx
import type { RankedSubmission } from "@/lib/domain/types";
import { formatMoney } from "@/lib/domain/format";
import { portfolioSummary } from "@/lib/rankings/portfolio";

export function PortfolioStrip({ submissions }: { submissions: RankedSubmission[] }) {
  const p = portfolioSummary(submissions);
  const topStates = p.topStates.slice(0, 3);
  const rated = p.inScope - (p.hazardCounts.unknown ?? 0);
  return (
    <section className="portfolio-strip" aria-label="Portfolio overview">
      <div className="ps-metric">
        <span>Submissions</span>
        <strong>{p.total}</strong>
        {p.outOfScope > 0 ? <small>{p.outOfScope} out of scope</small> : null}
      </div>
      <div className="ps-metric">
        <span>Total TIV</span>
        <strong>{formatMoney(p.totalTiv)}</strong>
        {p.tivUnknown > 0 ? <small>{p.tivUnknown} without TIV</small> : null}
      </div>
      <div className="ps-metric">
        <span>In-appetite TIV</span>
        <strong>{formatMoney(p.inAppetiteTiv)}</strong>
      </div>
      <div className="ps-metric">
        <span>Top states</span>
        <strong>{topStates.length ? topStates.map((s) => `${s.state} (${s.count})`).join(", ") : "No state data"}</strong>
      </div>
      <div className="ps-metric">
        <span>High hazard (FEMA NRI)</span>
        <strong>{rated > 0 ? `${p.highHazard} of ${rated} rated` : "No hazard data"}</strong>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Append styles to `components/queue/queue.css`:**

```css
/* W7 — Portfolio overview strip */
.portfolio-strip { display: flex; flex-wrap: wrap; gap: 28px; padding: 14px 18px; border: 1px solid var(--border); border-radius: 10px; margin: 0 0 16px; background: var(--panel); }
.ps-metric { display: flex; flex-direction: column; gap: 2px; }
.ps-metric span { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-faint); }
.ps-metric strong { font-size: 18px; color: var(--ink); }
.ps-metric small { font-size: 12px; color: var(--ink-faint); }
```

- [ ] **Step 5: Wire into `components/app-shell.tsx`.** Import `PortfolioStrip`. In the queue (non-case) branch, render it directly above `<QueueWorkspace .../>`, passing the full ranked set:

```tsx
<PortfolioStrip submissions={data.submissions} />
<QueueWorkspace submissions={data.submissions} onOpen={setSelectedId} matchedIds={matchedIds} />
```
(Only in the queue branch — not in the case-view branch.)

- [ ] **Step 6: Verify + commit**

Run: `npx tsx --test tests/portfolio-ui.test.ts && npm test && npm run typecheck && npm run build`
Expected: all green.

```bash
git add components/queue/portfolio-strip.tsx components/queue/queue.css components/app-shell.tsx tests/portfolio-ui.test.ts
git commit -m "feat(queue): W7 portfolio overview strip above the queue"
```

---

## Task 6: Live verification (browser)

- [ ] **Step 1:** `npm run dev`; open `http://localhost:3000`.
- [ ] **Step 2:** Portfolio strip renders above the queue with real numbers (Total TIV, top states, high-hazard count).
- [ ] **Step 3:** Click **List ▸ Quadrant**: the 2×2 renders. In **Extended** mode the "Work now" (green) cell holds the in-appetite entries; switching back to Baseline shows mostly "Deprioritize".
- [ ] **Step 4:** Clicking an entry in the quadrant opens that case (same as clicking a table row).
- [ ] **Step 5:** Toggle Baseline↔Extended and property/other-lines scopes; confirm both the strip and quadrant update coherently.

---

## Self-review notes

- **Spec coverage:** W6 quadrant (Tasks 1,3,4), W7 portfolio strip (Tasks 2,5). Both restored into the current shell, styled with current tokens.
- **No new contract change:** both logic modules use the existing frozen `RankedSubmission` + `completeness.ts`; no `types.ts` edit.
- **Baseline safety:** default `view` is "list"; portfolio strip is additive above the queue; existing queue-workspace tests unaffected.
- **Extended-mode note:** `portfolioSummary` treats `out_of_scope` as excluded; in Extended nothing is out_of_scope, so Total TIV aggregates the whole scored book (expected — it is a queue-level band, read-only, never feeds scoring).
- **Type consistency:** `QuadrantBoard`/`PortfolioStrip` props (`onOpen`, `submissions`) match `QueueTable`/`AppShell` usage.
```
