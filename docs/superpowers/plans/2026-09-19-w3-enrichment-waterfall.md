# W3 — Missing-Data Enrichment Waterfall + Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **SCOPE DECISION REQUIRED BEFORE BUILDING:** This feature *resolves* missing appetite fields. To stay honest, resolution is **decision-support context by default** (shown with provenance, does NOT silently change the score). "Apply this resolved value and re-score" is a separate, explicit, labeled action. Confirm this stance with the engineer before Task 4.

**Goal:** For each unresolved required field on a submission, run a cheapest-first source chain ("waterfall"), stop at the first source clearing a confidence threshold, record which source won, and display a provenance chip (`value · source · confidence · as-of`) — without silently altering the deterministic appetite score.

**Architecture:** Three pure layers plus UI. `provenance.ts` defines the value+provenance shape. `waterfall.ts` runs an ordered list of pluggable sources and returns the first confident hit. `resolve-submission.ts` builds a source chain per missing appetite field (canonical value → deterministic inference → "needs broker") and returns a resolution map. The appetite engine is never called differently; resolutions are attached as separate context (like FEMA enrichment already is). Re-scoring on an accepted value is an explicit opt-in, out of scope for the default flow.

**Tech Stack:** Next.js 16, TypeScript strict, React 19, `node:test` + `tsx`, CSS in `app/globals.css`. No network dependency for the MVP source chain (deterministic inference only); real external sources plug into the same `Source<T>` interface later.

**Invariants (must hold after every task):** appetite score/status never changes as a side effect of resolution; `lib/domain/types.ts` frozen contract untouched (resolutions live in a `lib/enrichment` type, not on `RankedSubmission`); product read-only; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## File Structure

- `lib/enrichment/provenance.ts` — NEW. `Provenance`, `ResolvedValue<T>` types + a helper.
- `lib/enrichment/waterfall.ts` — NEW. Generic `runWaterfall` over `Source<T>[]`.
- `lib/enrichment/resolve-submission.ts` — NEW. Per-field source chains + resolution map.
- `tests/waterfall.test.ts`, `tests/resolve-submission.test.ts` — NEW.
- `components/enrichment-resolution/resolution-chips.tsx` (+ `.css`, `index.ts`) — NEW. Provenance chips.
- `components/dashboard/submission-detail.tsx` — MODIFY. Render resolution chips beside the In Good Order checklist (W2).
- `app/globals.css` — untouched if component CSS is used; otherwise add chip styles.

---

## Task 1: Provenance types + waterfall runner (pure, tested)

**Files:**
- Create: `lib/enrichment/provenance.ts`
- Create: `lib/enrichment/waterfall.ts`
- Test: `tests/waterfall.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/waterfall.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { runWaterfall, type Source } from "../lib/enrichment/waterfall";

const asOf = "2026-09-19";

test("stops at the first source clearing the confidence threshold", () => {
  const calls: string[] = [];
  const sources: Source<number>[] = [
    { name: "canonical", asOf, lookup: () => { calls.push("canonical"); return null; } },
    { name: "inference", asOf, lookup: () => { calls.push("inference"); return { value: 42, confidence: 0.8 }; } },
    { name: "external", asOf, lookup: () => { calls.push("external"); return { value: 99, confidence: 1 }; } },
  ];
  const result = runWaterfall(sources, 0.5);
  assert.deepEqual(calls, ["canonical", "inference"], "must not call sources after a confident hit");
  assert.equal(result?.value, 42);
  assert.equal(result?.provenance.source, "inference");
  assert.equal(result?.provenance.confidence, 0.8);
});

test("returns null when no source clears the threshold", () => {
  const sources: Source<number>[] = [
    { name: "canonical", asOf, lookup: () => null },
    { name: "inference", asOf, lookup: () => ({ value: 1, confidence: 0.2 }) },
  ];
  assert.equal(runWaterfall(sources, 0.5), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/waterfall.test.ts`
Expected: FAIL — `Cannot find module '../lib/enrichment/waterfall'`.

- [ ] **Step 3: Write the implementations**

```ts
// lib/enrichment/provenance.ts
export interface Provenance {
  /** Which source produced the value (e.g. "canonical", "inference", "FEMA NRI"). */
  source: string;
  /** 0–1 confidence the source reported. */
  confidence: number;
  /** ISO date the value was captured/derived. */
  asOf: string;
}

export interface ResolvedValue<T> {
  value: T;
  provenance: Provenance;
}
```

```ts
// lib/enrichment/waterfall.ts
import type { ResolvedValue } from "./provenance";

export interface Source<T> {
  name: string;
  asOf: string;
  /** Return a candidate value with confidence, or null if this source has nothing. */
  lookup: () => { value: T; confidence: number } | null;
}

/** Run sources in order (cheapest first). Return the first hit whose confidence
 *  is >= threshold; stop immediately. Return null if none qualifies. Pure: the
 *  caller supplies whatever the sources need via closures. */
export function runWaterfall<T>(sources: Source<T>[], threshold: number): ResolvedValue<T> | null {
  for (const source of sources) {
    const hit = source.lookup();
    if (hit && hit.confidence >= threshold) {
      return { value: hit.value, provenance: { source: source.name, confidence: hit.confidence, asOf: source.asOf } };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/waterfall.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/enrichment/provenance.ts lib/enrichment/waterfall.ts tests/waterfall.test.ts
git commit -m "feat(enrichment): provenance types + cheapest-first waterfall runner"
```

---

## Task 2: Per-field resolution for a submission (pure, tested)

**Files:**
- Create: `lib/enrichment/resolve-submission.ts`
- Test: `tests/resolve-submission.test.ts`

Design: for each appetite factor with verdict `unknown`, assemble a source chain and run the waterfall. MVP sources are deterministic and require no network:
1. **canonical** — the value already present on the submission (confidence 1.0). If it were present this factor would not be `unknown`, so this normally misses; included so the chain is uniform and future re-runs work.
2. **inference** — a documented deterministic estimate for a subset of fields (e.g. `tiv` from building count if such a field exists). Only added where a defensible rule exists; otherwise the chain has no inference source.
3. No confident source → `null` → the field is a broker-chase candidate (feeds W4).

- [ ] **Step 1: Write the failing test**

```ts
// tests/resolve-submission.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { resolveSubmissionFields } from "../lib/enrichment/resolve-submission";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("a complete submission has nothing to resolve", () => {
  const map = resolveSubmissionFields(evaluateAppetite(fullTarget));
  assert.equal(Object.keys(map).length, 0);
});

test("an incomplete submission yields an entry per unresolved field", () => {
  const ranked = evaluateAppetite(empty);
  const map = resolveSubmissionFields(ranked);
  const unresolvedKeys = ranked.factors.filter((f) => f.verdict === "unknown").map((f) => f.key);
  for (const key of unresolvedKeys) {
    assert.ok(key in map, `missing resolution entry for ${key}`);
    // Each entry is either a ResolvedValue (with provenance) or null (broker-chase).
    const entry = map[key];
    if (entry !== null) {
      assert.equal(typeof entry.provenance.source, "string");
      assert.ok(entry.provenance.confidence >= 0 && entry.provenance.confidence <= 1);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/resolve-submission.test.ts`
Expected: FAIL — `Cannot find module '../lib/enrichment/resolve-submission'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/enrichment/resolve-submission.ts
import type { FactorKey, RankedSubmission } from "@/lib/domain/types";
import type { ResolvedValue } from "./provenance";
import { runWaterfall, type Source } from "./waterfall";

const CONFIDENCE_THRESHOLD = 0.6;
const asOf = new Date().toISOString().slice(0, 10);

/** Deterministic MVP source chains keyed by factor. Extend with real external
 *  sources by pushing more `Source<number|string>` entries — the runner is
 *  source-agnostic. Chains with no confident source return null (broker-chase). */
function chainFor(key: FactorKey, submission: RankedSubmission): Source<number | string>[] {
  // No defensible offline inference exists for these MVP fields, so the chain is
  // empty and the field becomes a broker-chase candidate. This is intentionally
  // honest: we do not invent values. Real sources (SOV parse, public datasets)
  // attach here later.
  void key;
  void submission;
  return [];
}

export type ResolutionMap = Partial<Record<FactorKey, ResolvedValue<number | string> | null>>;

export function resolveSubmissionFields(submission: RankedSubmission): ResolutionMap {
  const map: ResolutionMap = {};
  for (const factor of submission.factors) {
    if (factor.verdict !== "unknown") continue;
    const resolved = runWaterfall(chainFor(factor.key, submission), CONFIDENCE_THRESHOLD);
    map[factor.key] = resolved; // ResolvedValue when a source hit, else null (chase).
  }
  return map;
}
```

> **Honesty note for reviewers:** the MVP ships with empty chains (`chainFor` returns `[]`) so we never fabricate a value — every unresolved field is surfaced as a broker-chase candidate. The wow is the *architecture* (waterfall + provenance) and the honest routing, not fake data. Populate `chainFor` only with defensible, cited sources. If the team approves a specific inference rule (e.g. a real field the dataset exposes), add it here with a documented confidence.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/resolve-submission.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/enrichment/resolve-submission.ts tests/resolve-submission.test.ts
git commit -m "feat(enrichment): honest per-field waterfall resolution map"
```

---

## Task 3: Resolution chips component

**Files:**
- Create: `components/enrichment-resolution/resolution-chips.tsx`
- Create: `components/enrichment-resolution/resolution-chips.css`
- Create: `components/enrichment-resolution/index.ts`
- Test: `tests/resolution-chips.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/resolution-chips.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResolutionChips } from "../components/enrichment-resolution/resolution-chips";

test("renders a provenance chip for a resolved field", () => {
  const html = renderToStaticMarkup(
    createElement(ResolutionChips, {
      resolutions: { tiv: { value: 75_000_000, provenance: { source: "inference", confidence: 0.8, asOf: "2026-09-19" } } },
      labels: { tiv: "Total insured value" },
    }),
  );
  assert.match(html, /Total insured value/);
  assert.match(html, /inference/);
  assert.match(html, /0\.8|80%/);
});

test("renders a broker-chase pill for an unresolved (null) field", () => {
  const html = renderToStaticMarkup(
    createElement(ResolutionChips, {
      resolutions: { totalPremium: null },
      labels: { totalPremium: "Total premium" },
    }),
  );
  assert.match(html, /Total premium/);
  assert.match(html, /request from broker|chase/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/resolution-chips.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component + index + css**

```tsx
// components/enrichment-resolution/resolution-chips.tsx
import type { FactorKey } from "@/lib/domain/types";
import type { ResolutionMap } from "@/lib/enrichment/resolve-submission";

export interface ResolutionChipsProps {
  resolutions: ResolutionMap;
  labels: Partial<Record<FactorKey, string>>;
}

export function ResolutionChips({ resolutions, labels }: ResolutionChipsProps) {
  const entries = Object.entries(resolutions) as [FactorKey, ResolutionMap[FactorKey]][];
  if (entries.length === 0) return null;
  return (
    <ul className="res-chips" aria-label="Field resolutions">
      {entries.map(([key, resolved]) => (
        <li key={key} className={`res-chip ${resolved ? "res-found" : "res-chase"}`}>
          <span className="res-field">{labels[key] ?? key}</span>
          {resolved ? (
            <span className="res-meta">
              {String(resolved.value)} · {resolved.provenance.source} · {Math.round(resolved.provenance.confidence * 100)}% · {resolved.provenance.asOf}
            </span>
          ) : (
            <span className="res-meta">Request from broker</span>
          )}
        </li>
      ))}
    </ul>
  );
}
```

```ts
// components/enrichment-resolution/index.ts
import "./resolution-chips.css";
export { ResolutionChips } from "./resolution-chips";
```

```css
/* components/enrichment-resolution/resolution-chips.css */
.res-chips { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.res-chip { display: flex; gap: 8px; align-items: baseline; font-size: 13px; padding: 4px 8px; border-radius: 6px; }
.res-chip.res-found { background: #e6f4ea; }
.res-chip.res-chase { background: #fef7e0; }
.res-field { font-weight: 600; }
.res-meta { color: #5f6368; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/resolution-chips.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/enrichment-resolution tests/resolution-chips.test.ts
git commit -m "feat(enrichment): provenance/broker-chase resolution chips"
```

---

## Task 4: Wire resolution chips into the detail view (SCOPE-GATED)

> Only start after the engineer confirms the "context, not silent re-score" stance.

**Files:**
- Modify: `components/dashboard/submission-detail.tsx`

- [ ] **Step 1: Imports.** Add:

```tsx
import { ResolutionChips } from "@/components/enrichment-resolution";
import { resolveSubmissionFields } from "@/lib/enrichment/resolve-submission";
```

- [ ] **Step 2: Compute resolutions and a label map.** Inside `SubmissionDetail`, after the `completeness` line (from W2), add:

```tsx
const resolutions = resolveSubmissionFields(submission);
const factorLabels = Object.fromEntries(submission.factors.map((f) => [f.key, f.label]));
```

- [ ] **Step 3: Render chips under the checklist.** Immediately after the `</div>` closing the `in-good-order` block (from W2), add:

```tsx
<ResolutionChips resolutions={resolutions} labels={factorLabels} />
```

- [ ] **Step 4: Verify typecheck + build + full suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS. Confirm no scores changed (rankings-route/appetite tests still green).

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/submission-detail.tsx
git commit -m "feat(detail): show field resolutions with provenance (context only)"
```

---

## Self-Review Notes

- **Spec coverage:** cheapest-first stop-at-confident waterfall (Task 1), per-field resolution map (Task 2), provenance chip + broker-chase pill (Task 3), detail wiring (Task 4). ✅
- **Honesty:** ships with empty source chains so no value is fabricated; every gap routes to broker-chase (W4). The waterfall/provenance architecture is the deliverable. ✅
- **No contract change / no silent re-score:** resolutions are a `lib/enrichment` type, never added to `RankedSubmission`; appetite engine untouched; re-scoring is explicitly out of scope. ✅
- **Depends on:** W2 (`in-good-order` block anchor for Task 3). Feeds: W4 (null entries are the chase list).
- **Extension point:** `chainFor` in Task 2 — real sources (SOV parse, public datasets) attach here as `Source<T>` with documented confidence.
