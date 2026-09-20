# W6 — Appetite × Completeness Quadrant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer a 2×2 quadrant view of the queue — Appetite (high/low) × Completeness/Effort (low/high effort-to-decision) — with cells "Work now", "Worth the effort", "Selective", and "Deprioritize", so the queue reads as a triage board, not a flat FIFO list.

**Architecture:** A pure `lib/rankings/quadrant.ts` classifies each `RankedSubmission` into a cell using the existing appetite `status`/`score` and W2's `effortToDecision`. A new `QuadrantBoard` component renders four cells; `dashboard-view.tsx` gains a view toggle (Table ↔ Quadrant) that reuses the same `visibleSubmissions` and `onToggle` wiring already present.

**Tech Stack:** Next.js 16, TypeScript strict, React 19, `node:test` + `tsx`, CSS in component file.

**Dependencies:** **W2** (`lib/rankings/completeness.ts` → `completenessOf().effortToDecision`). Build W2 first.

**Invariants (must hold after every task):** appetite engine untouched; no contract change; the quadrant is a re-presentation of already-ranked data; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## File Structure

- `lib/rankings/quadrant.ts` — NEW. Pure `quadrantOf(submission)` + `QUADRANT_CELLS`.
- `tests/quadrant.test.ts` — NEW.
- `components/dashboard/quadrant-board.tsx` (+ `.css`, `index.ts`) — NEW.
- `components/dashboard/dashboard-view.tsx` — MODIFY. Add a Table/Quadrant toggle.

---

## Task 1: Quadrant classifier (pure, tested)

**Files:**
- Create: `lib/rankings/quadrant.ts`
- Test: `tests/quadrant.test.ts`

Classification:
- **Appetite high** when `status === "in_appetite"` OR `score >= APPETITE_HIGH_SCORE` (default 60); else low.
- **Effort low** when `effortToDecision <= EFFORT_LOW_MAX` (default 1); else high.
- Cell map: high-appetite+low-effort → `work-now`; high-appetite+high-effort → `worth-effort`; low-appetite+low-effort → `selective`; low-appetite+high-effort → `deprioritize`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/quadrant.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { quadrantOf, QUADRANT_CELLS } from "../lib/rankings/quadrant";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("in-appetite + complete submission is 'work-now'", () => {
  const q = quadrantOf(evaluateAppetite(fullTarget));
  assert.equal(q.appetite, "high");
  assert.equal(q.effort, "low");
  assert.equal(q.cell, "work-now");
});

test("needs-investigation (missing data) lands in a high-effort cell", () => {
  const q = quadrantOf(evaluateAppetite(empty));
  assert.equal(q.effort, "high");
  assert.ok(q.cell === "worth-effort" || q.cell === "deprioritize");
});

test("out-of-appetite is low appetite", () => {
  const q = quadrantOf(evaluateAppetite(contradictory));
  assert.equal(q.appetite, "low");
});

test("QUADRANT_CELLS lists the four cells with labels", () => {
  assert.deepEqual(
    QUADRANT_CELLS.map((c) => c.cell).sort(),
    ["deprioritize", "selective", "work-now", "worth-effort"],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/quadrant.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```ts
// lib/rankings/quadrant.ts
import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "./completeness";

export type QuadrantCell = "work-now" | "worth-effort" | "selective" | "deprioritize";

const APPETITE_HIGH_SCORE = 60;
const EFFORT_LOW_MAX = 1;

export interface QuadrantPosition {
  appetite: "high" | "low";
  effort: "low" | "high";
  cell: QuadrantCell;
}

export const QUADRANT_CELLS: { cell: QuadrantCell; label: string; appetite: "high" | "low"; effort: "low" | "high" }[] = [
  { cell: "work-now", label: "Work now", appetite: "high", effort: "low" },
  { cell: "worth-effort", label: "Worth the effort", appetite: "high", effort: "high" },
  { cell: "selective", label: "Selective", appetite: "low", effort: "low" },
  { cell: "deprioritize", label: "Deprioritize", appetite: "low", effort: "high" },
];

export function quadrantOf(submission: RankedSubmission): QuadrantPosition {
  const appetite = submission.status === "in_appetite" || submission.score >= APPETITE_HIGH_SCORE ? "high" : "low";
  const effort = completenessOf(submission).effortToDecision <= EFFORT_LOW_MAX ? "low" : "high";
  const cell =
    appetite === "high"
      ? effort === "low" ? "work-now" : "worth-effort"
      : effort === "low" ? "selective" : "deprioritize";
  return { appetite, effort, cell };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/quadrant.test.ts`
Expected: PASS (4 tests).

> Adjust the second test's `ok(...)` if the `empty` fixture's score forces one specific cell; both branches are acceptable because appetite of an all-unknown submission depends on its score (0), so it is likely `deprioritize`.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/quadrant.ts tests/quadrant.test.ts
git commit -m "feat(quadrant): appetite x completeness classifier"
```

---

## Task 2: Quadrant board component

**Files:**
- Create: `components/dashboard/quadrant-board.tsx`
- Create: `components/dashboard/quadrant-board.css`
- Create: `components/dashboard/quadrant-index.ts` (or fold the css import into the component's package; see note)
- Test: `tests/quadrant-ui.test.ts`

> Note: existing dashboard components import CSS via global `app/globals.css`, not per-component index files, EXCEPT the packaged components (`factor-breakdown`, `external-risk`, etc.) which use an `index.ts`. Keep the quadrant board consistent with the dashboard folder: put styles in `quadrant-board.css` and import it directly at the top of `quadrant-board.tsx` (Next.js supports component-level CSS imports). Verify the project's CSS import convention before choosing.

- [ ] **Step 1: Write the failing test**

```ts
// tests/quadrant-ui.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuadrantBoard } from "../components/dashboard/quadrant-board";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("renders four labelled cells and places accounts", () => {
  const submissions = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(
    createElement(QuadrantBoard, { submissions, onSelect: () => {} }),
  );
  for (const label of ["Work now", "Worth the effort", "Selective", "Deprioritize"]) {
    assert.ok(html.includes(label), `missing cell ${label}`);
  }
  assert.ok(html.includes(fullTarget.accountName ?? "Acme") || html.includes("account"), "places at least one account");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/quadrant-ui.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component + css**

```tsx
// components/dashboard/quadrant-board.tsx
import type { RankedSubmission } from "@/lib/domain/types";
import { quadrantOf, QUADRANT_CELLS, type QuadrantCell } from "@/lib/rankings/quadrant";
import "./quadrant-board.css";

export interface QuadrantBoardProps {
  submissions: RankedSubmission[];
  onSelect: (id: string) => void;
}

export function QuadrantBoard({ submissions, onSelect }: QuadrantBoardProps) {
  const byCell = new Map<QuadrantCell, RankedSubmission[]>();
  for (const cell of QUADRANT_CELLS) byCell.set(cell.cell, []);
  for (const s of submissions) byCell.get(quadrantOf(s).cell)!.push(s);

  return (
    <div className="quadrant" aria-label="Appetite by completeness">
      {QUADRANT_CELLS.map((cell) => (
        <section key={cell.cell} className={`quadrant-cell qc-${cell.cell}`}>
          <header>
            <strong>{cell.label}</strong>
            <small>{byCell.get(cell.cell)!.length}</small>
          </header>
          <ul>
            {byCell.get(cell.cell)!.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onSelect(s.id)}>
                  {s.accountName} <small>{s.score}/100</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

```css
/* components/dashboard/quadrant-board.css */
.quadrant { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
.quadrant-cell { border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px; min-height: 120px; }
.quadrant-cell header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.quadrant-cell ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.quadrant-cell button { width: 100%; text-align: left; background: #f6f8fa; border: none; border-radius: 6px; padding: 6px 8px; cursor: pointer; font-size: 13px; }
.qc-work-now { background: #f2fbf5; }
.qc-worth-effort { background: #fffdf3; }
.qc-selective { background: #f6f8fa; }
.qc-deprioritize { background: #fbf2f2; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/quadrant-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/quadrant-board.tsx components/dashboard/quadrant-board.css tests/quadrant-ui.test.ts
git commit -m "feat(quadrant): 2x2 triage board component"
```

---

## Task 3: View toggle in the dashboard

**Files:**
- Modify: `components/dashboard/dashboard-view.tsx`

> The dashboard is a server component that receives `expandedId`/`onToggle` from the client `RankingsDashboard`. The view toggle needs local state, so it must live in a client boundary. Simplest approach that respects the existing split: add a `view` prop + `onViewChange` handled by `RankingsDashboard` (client), OR make the queue/quadrant switch a small client component. Choose based on the current client/server boundary — do NOT add `useState` to `dashboard-view.tsx` if it is server-rendered. Confirm by checking for `"use client"` at the top of the file (it is absent → it is a server component).

- [ ] **Step 1: Add `view` to `DashboardViewProps`.** Extend the interface:

```tsx
export interface DashboardViewProps {
  // ...existing props...
  view?: "table" | "quadrant";
  onViewChange?: (view: "table" | "quadrant") => void;
}
```

- [ ] **Step 2: Import the board.** Add:

```tsx
import { QuadrantBoard } from "./quadrant-board";
```

- [ ] **Step 3: Render the toggle + conditional body.** In the `queue-toolbar`, add a toggle (only when `onViewChange` is provided), and swap the `<QueueTable .../>` for the board when `view === "quadrant"`:

```tsx
{onViewChange ? (
  <div className="view-toggle" role="group" aria-label="Queue view">
    <button type="button" aria-pressed={view !== "quadrant"} onClick={() => onViewChange("table")}>Table</button>
    <button type="button" aria-pressed={view === "quadrant"} onClick={() => onViewChange("quadrant")}>Quadrant</button>
  </div>
) : null}
```

```tsx
{view === "quadrant" ? (
  <QuadrantBoard submissions={visibleSubmissions} onSelect={onToggle} />
) : (
  <QueueTable submissions={visibleSubmissions} expandedId={expandedId} onToggle={onToggle} />
)}
```

- [ ] **Step 4: Add state in `RankingsDashboard`.** In `components/rankings-dashboard.tsx`, add `const [view, setView] = useState<"table" | "quadrant">("table");` and pass `view={view} onViewChange={setView}` to `<DashboardView .../>`.

- [ ] **Step 5: Verify typecheck + build + full suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/dashboard-view.tsx components/rankings-dashboard.tsx
git commit -m "feat(dashboard): Table/Quadrant view toggle"
```

---

## Self-Review Notes

- **Spec coverage:** classifier (Task 1), 2×2 board (Task 2), toggle (Task 3). ✅
- **Depends on W2:** imports `completenessOf` — build W2 first, do not reimplement effort.
- **Boundary caveat:** the toggle needs client state; Task 3 keeps `dashboard-view.tsx` a server component by lifting `view` state to the client `RankingsDashboard`. Verify the `"use client"` boundary before wiring.
- **Type consistency:** `QuadrantCell`, `QuadrantPosition`, `QUADRANT_CELLS` from Task 1 are the exact names used in Task 2. ✅
- **Thresholds** (`APPETITE_HIGH_SCORE = 60`, `EFFORT_LOW_MAX = 1`) are tunable constants; expose to the team for calibration against real data.
