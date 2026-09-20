# Phase 3 — Rewire W3 (resolution waterfall) with re-score + before/after Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reconnect the orphaned W3 enrichment waterfall into the case flow: fill a submission's *absent* required fields from the consolidation index, re-run the deterministic engine, and show the case's appetite status/score **before → after** with per-field provenance chips.

**Architecture:** The resolution is computed **server-side in the pipeline** (like enrichment/outcomes/context) and attached as `RankedSubmission.resolution`. A pure `buildResolution(submission, consolidationIndex, extended)` resolves absent fields (source-agnostic waterfall over `raw/consolidation.json`), patches the canonical fields, re-runs `evaluateAppetite`, and returns `{ fields, before, after }`. The case renders it read-only. The queue's own ranking is unchanged — resolution is decision-support ("if you accept these consolidated values, the verdict becomes X"), never a silent re-rank.

**Tech Stack:** Next.js 16, React 19, TypeScript, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-20-extended-dataset-multiline-appetite-design.md` (Phase 3).

**Key facts:**
- W3 engine already exists (orphaned): `lib/enrichment/resolve-submission.ts` (`resolveSubmissionFields`, `ResolutionMap`, `ConsolidationIndex`, `CONFIDENCE_THRESHOLD`, `DEFAULT_CHAINS`), `waterfall.ts`, `provenance.ts` (`ResolvedValue`, `Provenance`), and `consolidation-index.ts` (`loadConsolidationIndex`, server-only fs). Tests `tests/resolve-submission.test.ts`, `tests/waterfall.test.ts` pass.
- `raw/consolidation.json` maps `submissionId → { factorKey → ResolvedValue }`. It currently has `SUB-2025-00138` and `SUB-2025-00132` (each: totalPremium + fiveYearLossValue).
- `completenessOf(submission).absent` gives the absent `FactorKey[]`. `FACTOR_INPUT` in `lib/rankings/completeness.ts` maps each `FactorKey` → the `CanonicalSubmission` field it reads (currently NOT exported — Task 1 exports it).
- `evaluateAppetite(submission, extended = false)` (pure) and `formatMoney` (`lib/domain/format.ts`) exist.
- The pipeline (`lib/rankings/pipeline.ts`) attaches enrichment/outcomes/context after `deps.rank(...)`, offline mode only, and knows `extended` (Phase 1).
- The case review UI is `components/case/review-tab.tsx`.

---

## Task 1: Contract + export the field map

**Files:**
- Modify: `lib/domain/types.ts`, `lib/rankings/completeness.ts`
- Test: `tests/resolution-result.test.ts` (created here, imports the new types)

- [ ] **Step 1: Add types to `lib/domain/types.ts`** (import `FactorKey`, `AppetiteStatus` already present). After `ContextSignal`:

```ts
/** One required field the consolidation waterfall filled, with provenance. */
export interface ResolvedField {
  key: FactorKey;
  label: string;
  value: number | string;
  /** Formatted for display (money/percent/plain). */
  display: string;
  source: string;
  /** 0–1 confidence the source reported. */
  confidence: number;
  asOf: string;
}

/**
 * Decision-support only: what the appetite verdict WOULD become if the resolved
 * values are accepted. Attached AFTER ranking; the queue's own status/score
 * (`before`) is unchanged. The human underwriter confirms before it counts.
 */
export interface ResolutionResult {
  fields: ResolvedField[];
  before: { status: AppetiteStatus; score: number };
  after: { status: AppetiteStatus; score: number };
}
```
Add to `RankedSubmission` (after `context?`):
```ts
  /** Fields the consolidation waterfall could fill + the re-scored verdict. */
  resolution?: ResolutionResult;
```

- [ ] **Step 2: Export the field map in `lib/rankings/completeness.ts`** — change `const FACTOR_INPUT` to `export const FACTOR_INPUT`.

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add lib/domain/types.ts lib/rankings/completeness.ts
git commit -m "feat(types): ResolutionResult contract + export FACTOR_INPUT map"
```

---

## Task 2: `buildResolution` — resolve absent fields, patch, re-score

**Files:**
- Create: `lib/enrichment/resolution-result.ts`
- Test: `tests/resolution-result.test.ts`

- [ ] **Step 1: Write the failing test** `tests/resolution-result.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { buildResolution } from "../lib/enrichment/resolution-result";
import type { ConsolidationIndex } from "../lib/enrichment/resolve-submission";
import { missingLosses } from "./fixtures/domain/submissions";

test("resolving the one missing field flips needs_investigation → in_appetite", () => {
  const ranked = evaluateAppetite(missingLosses);
  assert.equal(ranked.status, "needs_investigation");
  const index: ConsolidationIndex = {
    [ranked.id]: { fiveYearLossValue: { value: 40000, provenance: { source: "broker email", confidence: 0.9, asOf: "2026-09-20" } } },
  };
  const r = buildResolution(ranked, index, false);
  assert.ok(r, "resolution present");
  assert.equal(r!.before.status, "needs_investigation");
  assert.equal(r!.after.status, "in_appetite");
  assert.equal(r!.fields.length, 1);
  assert.equal(r!.fields[0].key, "fiveYearLossValue");
  assert.match(r!.fields[0].display, /\$40/);
  assert.equal(r!.fields[0].source, "broker email");
});

test("returns null when nothing resolves", () => {
  const ranked = evaluateAppetite(missingLosses);
  assert.equal(buildResolution(ranked, {}, false), null);
});
```
(If `missingLosses` does not score `needs_investigation` with exactly one absent field, use `tests/fixtures/domain/submissions.ts` to pick a fixture that does — read it first. Do NOT edit fixtures.)

Run: `npx tsx --test tests/resolution-result.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `lib/enrichment/resolution-result.ts`:**

```ts
import { evaluateAppetite } from "@/lib/domain/appetite";
import { formatMoney } from "@/lib/domain/format";
import type { CanonicalSubmission, FactorKey, RankedSubmission, ResolutionResult, ResolvedField } from "@/lib/domain/types";
import { FACTOR_INPUT } from "@/lib/rankings/completeness";
import { CONFIDENCE_THRESHOLD, DEFAULT_CHAINS, resolveSubmissionFields, type ConsolidationIndex } from "./resolve-submission";

const MONEY_KEYS = new Set<FactorKey>(["tiv", "totalPremium", "fiveYearLossValue"]);

/** Present a resolved value the way the rest of the UI shows that factor. */
export function formatResolvedValue(key: FactorKey, value: number | string): string {
  if (typeof value !== "number") return value;
  if (MONEY_KEYS.has(key)) return formatMoney(value);
  if (key === "construction") return `${Math.round((value > 1 ? value / 100 : value) * 100)}% approved construction`;
  return String(value);
}

/**
 * Resolve a submission's absent required fields from the consolidation index,
 * patch the canonical inputs, and re-run the deterministic engine. Returns the
 * resolved fields + before/after verdict, or null when nothing resolved.
 * `extended` must match the mode the submission was ranked in so the re-score
 * uses the same appetite table.
 */
export function buildResolution(
  submission: RankedSubmission,
  index: ConsolidationIndex,
  extended: boolean,
): ResolutionResult | null {
  const map = resolveSubmissionFields(submission, DEFAULT_CHAINS, CONFIDENCE_THRESHOLD, index);
  const resolved = Object.entries(map).filter(([, v]) => v) as [FactorKey, NonNullable<(typeof map)[FactorKey]>][];
  if (resolved.length === 0) return null;

  const patched: CanonicalSubmission = { ...submission };
  for (const [key, rv] of resolved) (patched as Record<string, unknown>)[FACTOR_INPUT[key]] = rv.value;
  const after = evaluateAppetite(patched, extended);

  const labelFor = new Map(submission.factors.map((f) => [f.key, f.label]));
  const fields: ResolvedField[] = resolved.map(([key, rv]) => ({
    key,
    label: labelFor.get(key) ?? key,
    value: rv.value,
    display: formatResolvedValue(key, rv.value),
    source: rv.provenance.source,
    confidence: rv.provenance.confidence,
    asOf: rv.provenance.asOf,
  }));

  return {
    fields,
    before: { status: submission.status, score: submission.score },
    after: { status: after.status, score: after.score },
  };
}
```

- [ ] **Step 3: Run test** → PASS. Then `npm test` + `npm run typecheck`.

- [ ] **Step 4: Commit**

```bash
git add lib/enrichment/resolution-result.ts tests/resolution-result.test.ts
git commit -m "feat(enrichment): buildResolution — resolve absent fields, patch, re-score (before/after)"
```

---

## Task 3: Add synthetic consolidation entries (clean status-flip demo)

**Files:**
- Modify: `raw/consolidation.json`

The single-missing-field synthetic property cases from Phase 1 flip cleanly when their one gap is filled:
- `SUB-SYN-0011` is missing **totalPremium** (rest in-appetite) → resolve to `88000`.
- `SUB-SYN-0012` is missing **fiveYearLossValue** → resolve to `40000`.
- `SUB-SYN-0013` is missing **buildingYear** → resolve to `2014`.

- [ ] **Step 1: Add these three keys to `raw/consolidation.json`** (keep the existing two entries):

```json
  "SUB-SYN-0011": {
    "totalPremium": { "value": 88000, "provenance": { "source": "broker email", "confidence": 0.9, "asOf": "2026-09-20" } }
  },
  "SUB-SYN-0012": {
    "fiveYearLossValue": { "value": 40000, "provenance": { "source": "broker loss run", "confidence": 0.85, "asOf": "2026-09-20" } }
  },
  "SUB-SYN-0013": {
    "buildingYear": { "value": 2014, "provenance": { "source": "broker sov", "confidence": 0.8, "asOf": "2026-09-20" } }
  }
```
Ensure the JSON stays valid (commas between objects).

- [ ] **Step 2: Verify JSON parses** — `node -e "JSON.parse(require('fs').readFileSync('raw/consolidation.json','utf8')); console.log('ok')"`

- [ ] **Step 3: Commit**

```bash
git add raw/consolidation.json
git commit -m "data(consolidation): resolvable single gaps for SUB-SYN-0011/0012/0013 (status-flip demo)"
```

---

## Task 4: Wire resolution into the pipeline

**Files:**
- Modify: `lib/rankings/pipeline.ts`
- Test: `tests/dataset-mode.test.ts` (append)

- [ ] **Step 1: Append a failing test** to `tests/dataset-mode.test.ts`:

```ts
import { buildRankings as buildRankingsR } from "../lib/rankings/pipeline";
import type { CanonicalSubmission as CS } from "../lib/domain/types";
import { rankSubmissions as rankR } from "../lib/domain/appetite";

test("pipeline attaches resolution + re-score from the consolidation index", async () => {
  const gap: CS = { id: "SUB-SYN-0011", accountName: "Gap Co", submissionType: "new", lineOfBusiness: "property", primaryRiskState: "CA", tiv: 75_000_000, buildingYear: 2015, approvedConstructionPercentage: 0.8, fiveYearLossValue: 40000 };
  const deps = {
    useDemoData: false, demoSubmissions: [], dataSource: "offline" as const,
    runAgent: async () => ({ submissions: [gap], traceSummary: [] }),
    rank: (s: CS[]) => rankR(s, { extended: false }),
    loadConsolidation: async () => ({ "SUB-SYN-0011": { totalPremium: { value: 88000, provenance: { source: "broker email", confidence: 0.9, asOf: "2026-09-20" } } } }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  const r = await buildRankingsR(deps, { dataset: "baseline" });
  const sub = r.submissions.find((s) => s.id === "SUB-SYN-0011")!;
  assert.ok(sub.resolution, "resolution attached");
  assert.equal(sub.resolution!.after.status, "in_appetite");
  assert.equal(sub.status, "needs_investigation"); // queue status unchanged
});
```
Run `npx tsx --test tests/dataset-mode.test.ts` → FAIL (`loadConsolidation` unused; no `resolution`).

- [ ] **Step 2: Modify `lib/rankings/pipeline.ts`:**
  - Import `buildResolution` from `@/lib/enrichment/resolution-result`, `loadConsolidationIndex` from `@/lib/enrichment/consolidation-index`, and `type ConsolidationIndex` from `@/lib/enrichment/resolve-submission`.
  - Add to `RankingsPipelineDeps`: `loadConsolidation?: () => Promise<ConsolidationIndex>;`
  - In `defaultPipelineDeps`, set `loadConsolidation: useDemoData || explicitLive ? undefined : async () => loadConsolidationIndex()` (offline only, like the other loaders).
  - In `buildRankings`, AFTER the context-attach block (still inside the non-demo path), add:
```ts
if (deps.loadConsolidation) {
  const index = await deps.loadConsolidation();
  for (const submission of ranked) {
    const resolution = buildResolution(submission, index, extended);
    if (resolution) submission.resolution = resolution;
  }
}
```
  (Do NOT change `submission.status`/`score` — only attach `resolution`.)

- [ ] **Step 3: Run tests** → PASS. Then `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add lib/rankings/pipeline.ts tests/dataset-mode.test.ts
git commit -m "feat(pipeline): attach W3 resolution + before/after re-score from consolidation index"
```

---

## Task 5: Resolution panel UI in the case

**Files:**
- Create: `components/case/resolution-panel.tsx`, `tests/resolution-ui.test.ts`
- Modify: `components/case/case.css`, `components/case/review-tab.tsx`

- [ ] **Step 1: Write the failing render test** `tests/resolution-ui.test.ts` (`.ts` + `createElement`, per `tests/queue-table.test.ts`):

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResolutionPanel } from "../components/case/resolution-panel";
import type { ResolutionResult } from "../lib/domain/types";

const resolution: ResolutionResult = {
  fields: [{ key: "totalPremium", label: "Total premium", value: 88000, display: "$88K", source: "broker email", confidence: 0.9, asOf: "2026-09-20" }],
  before: { status: "needs_investigation", score: 58 },
  after: { status: "in_appetite", score: 92 },
};

test("resolution panel shows chips and a before → after verdict", () => {
  const html = renderToStaticMarkup(createElement(ResolutionPanel, { resolution }));
  assert.match(html, /broker email/);
  assert.match(html, /\$88K/);
  assert.match(html, /Needs investigation/);
  assert.match(html, /In appetite/);
});

test("renders nothing when there is no resolution", () => {
  assert.equal(renderToStaticMarkup(createElement(ResolutionPanel, { resolution: undefined })), "");
});
```
Run → FAIL (module missing).

- [ ] **Step 2: Create `components/case/resolution-panel.tsx`:**

```tsx
import type { AppetiteStatus, ResolutionResult } from "@/lib/domain/types";
import { Icon } from "@/components/ui/icon";

const STATUS_LABEL: Record<AppetiteStatus, string> = {
  in_appetite: "In appetite",
  needs_investigation: "Needs investigation",
  out_of_appetite: "Out of appetite",
  out_of_scope: "Out of scope",
};

export function ResolutionPanel({ resolution }: { resolution?: ResolutionResult }) {
  if (!resolution || resolution.fields.length === 0) return null;
  const { fields, before, after } = resolution;
  const flipped = before.status !== after.status;
  return (
    <section className="resolution-panel" aria-label="Consolidated data resolution">
      <header>
        <span><Icon name="book" /> Resolved from consolidated channels</span>
        <small>Decision support — confirm before it counts.</small>
      </header>
      <ul className="res-chips" aria-label="Field resolutions">
        {fields.map((f) => (
          <li key={f.key} className="res-chip res-found">
            <span className="res-field">{f.label}</span>
            <span className="res-meta">{f.display} · {f.source} · {Math.round(f.confidence * 100)}% · {f.asOf}</span>
          </li>
        ))}
      </ul>
      <div className={`res-verdict ${flipped ? "res-flip" : ""}`}>
        <span className="res-before">{STATUS_LABEL[before.status]} · {before.score}/100</span>
        <Icon name="chevron" />
        <span className="res-after">{STATUS_LABEL[after.status]} · {after.score}/100</span>
      </div>
    </section>
  );
}
```
(If `Icon` has no `book`/`chevron` name, read `components/ui/icon.tsx` and use valid names.)

- [ ] **Step 3: Append styles to `components/case/case.css`** (federanorth tokens):

```css
/* W3 — consolidated-data resolution panel */
.resolution-panel { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin: 16px 0; background: var(--panel); }
.resolution-panel header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.resolution-panel header span { font-weight: 600; color: var(--ink); display: inline-flex; align-items: center; gap: 6px; }
.resolution-panel header small { color: var(--ink-faint); }
.res-chips { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.res-chip { display: flex; gap: 8px; align-items: baseline; font-size: 13px; padding: 5px 9px; border-radius: 6px; }
.res-chip.res-found { background: var(--mint-tint); }
.res-field { font-weight: 600; color: var(--ink); }
.res-meta { color: var(--ink-soft); }
.res-verdict { display: inline-flex; align-items: center; gap: 10px; font-size: 14px; }
.res-before { color: var(--ink-faint); }
.res-after { color: var(--ink); font-weight: 600; }
.res-verdict.res-flip .res-after { color: var(--mint-strong); }
```

- [ ] **Step 4: Wire into `components/case/review-tab.tsx`** — import `ResolutionPanel`; render `<ResolutionPanel resolution={submission.resolution} />` directly after the `assessment-summary` section (it self-hides when absent).

- [ ] **Step 5: Verify** — `npx tsx --test tests/resolution-ui.test.ts`, `npm test`, `npm run typecheck`, `npm run build` (all green).

- [ ] **Step 6: Commit**

```bash
git add components/case/resolution-panel.tsx components/case/case.css components/case/review-tab.tsx tests/resolution-ui.test.ts
git commit -m "feat(case): W3 resolution panel — provenance chips + before/after verdict"
```

---

## Task 6: Live verification

- [ ] **Step 1:** `npm run dev`; open `http://localhost:3000`, switch to **Extended**.
- [ ] **Step 2:** Open case `SUB-SYN-0011` (or 0012/0013) from the queue (it's a "Needs evidence" row). On the Review tab, the resolution panel shows the resolved field chip (e.g. "Total premium · $88K · broker email · 90% · 2026-09-20") and **Needs investigation · 58/100 → In appetite · 92/100** (flip highlighted).
- [ ] **Step 3:** Open `SUB-2025-00138` (baseline or extended): the panel shows premium + losses resolved from broker email/SOV, with a partial improvement (submission type still missing → status may stay needs-investigation but score rises). Confirm the panel handles the no-flip case gracefully.
- [ ] **Step 4:** Confirm the queue status/lane is UNCHANGED (resolution is case-level only); the row still sits in "Needs evidence".

---

## Self-review notes

- **Spec coverage:** waterfall reconnected (Task 4), re-score before/after (Task 2), provenance chips + before/after UI (Task 5). The orphaned `resolve-submission.ts`/`waterfall.ts`/`provenance.ts`/`consolidation-index.ts` are now reachable from the running app.
- **Read-only:** resolution never mutates queue `status`/`score`; it is attached alongside, mirroring enrichment/context/outcome. Queue ranking stays on actual data.
- **Contract change:** additive `resolution?` on `RankedSubmission` + new `ResolutionResult`/`ResolvedField` types; `FACTOR_INPUT` exported.
- **Type consistency:** `buildResolution(sub, index, extended)`, `evaluateAppetite(sub, extended)`, `loadConsolidation()`, `ResolutionPanel({ resolution })` consistent across tasks.
- **Extended-mode note:** `buildResolution` receives the same `extended` flag the pipeline ranked with, so re-score uses the correct appetite table (property or multi-line).
```
