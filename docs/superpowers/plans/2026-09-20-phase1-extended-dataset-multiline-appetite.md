# Phase 1 — Extended dataset + multi-line appetite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Baseline ▸ Extended dataset toggle that, in Extended mode, injects ~24 synthetic in-appetite-capable property submissions AND scores the six non-property lines through researched appetite tables — with baseline behavior byte-for-byte unchanged.

**Architecture:** Refactor `lib/domain/appetite.ts` into a line-of-business appetite registry (property table extracted verbatim + six new tables), make scope/rank mode-aware, author synthetic property submissions as canonical records merged only in extended mode, and thread a `dataset` param from `/api/rankings?dataset=` through `buildRankings` to a header toggle in `AppShell`.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, TypeScript, `tsx --test` node test runner.

**Spec:** `docs/superpowers/specs/2026-09-20-extended-dataset-multiline-appetite-design.md`

---

## File structure

**Create:**
- `lib/domain/appetite/registry.ts` — `LineOfBusiness`, `AppetiteTable`, `APPETITE_TABLES`, `tableFor()`, factor-band helpers shared across lines.
- `lib/domain/appetite/lines/property.ts` — the existing 8-factor property logic, extracted verbatim.
- `lib/domain/appetite/lines/casualty.ts` — cgl, auto, excess, lpl tables (share a casualty factor pattern).
- `lib/domain/appetite/lines/specialty.ts` — cyber, health tables.
- `lib/demo/synthetic-property.ts` — `syntheticPropertySubmissions(): CanonicalSubmission[]` (~24 cases).
- `tests/appetite-multiline.test.ts`, `tests/synthetic-property.test.ts`, `tests/dataset-mode.test.ts`.

**Modify:**
- `lib/domain/types.ts` — add `LineOfBusiness`, `Dataset`, `AppetiteTable`; add `synthetic?` to `RankedSubmission`; add `dataset?` to `RankingsResponse`.
- `lib/domain/appetite.ts` — becomes a thin re-export + mode-aware `classifyScope`, `rankSubmissions(subs, { extended })`.
- `lib/rankings/pipeline.ts` — `buildRankings(deps, { dataset })`, merge synthetic + select scope mode.
- `app/api/rankings/route.ts` — read `?dataset=`.
- `components/app-shell.tsx` — dataset state, refetch, header toggle.
- `components/case/methodology-dialog.tsx` — line-aware (later step; header only in this phase).

**Baseline invariant:** `dataset=baseline` (the default) must produce output identical to today. Task 2 guards this.

---

## Task 1: Contract additions (types)

**Files:**
- Modify: `lib/domain/types.ts`
- Test: `tests/dataset-mode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/dataset-mode.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Dataset, LineOfBusiness, RankedSubmission, RankingsResponse } from "../lib/domain/types";

test("Dataset and LineOfBusiness unions compile and carry expected members", () => {
  const d: Dataset = "extended";
  const lobs: LineOfBusiness[] = ["property", "cgl", "auto", "cyber", "excess", "health", "lpl"];
  assert.equal(d, "extended");
  assert.equal(lobs.length, 7);
});

test("RankedSubmission carries an optional synthetic flag", () => {
  const s = { synthetic: true } as Partial<RankedSubmission>;
  assert.equal(s.synthetic, true);
});

test("RankingsResponse echoes the dataset", () => {
  const r = { dataset: "baseline" } as Partial<RankingsResponse>;
  assert.equal(r.dataset, "baseline");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/dataset-mode.test.ts`
Expected: FAIL — `Dataset`/`LineOfBusiness` not exported, `synthetic`/`dataset` not on the interfaces.

- [ ] **Step 3: Edit `lib/domain/types.ts`**

Add near the top (after `AppetiteStatus`):

```ts
export type Dataset = "baseline" | "extended";

export type LineOfBusiness = "property" | "cgl" | "auto" | "cyber" | "excess" | "health" | "lpl";
```

Add `synthetic?: boolean;` as the last field of `RankedSubmission` (before the closing brace):

```ts
  /** True only for records injected by the Extended synthetic dataset. */
  synthetic?: boolean;
```

Add `dataset?: Dataset;` to `RankingsResponse` (after `source`):

```ts
  /** Which dataset produced this response; absent means baseline. */
  dataset?: Dataset;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/dataset-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add lib/domain/types.ts tests/dataset-mode.test.ts
git commit -m "feat(types): add Dataset, LineOfBusiness, synthetic flag, dataset echo"
```

---

## Task 2: Extract property table into a registry (baseline-safe refactor)

Pure refactor — no behavior change. The existing appetite tests are the regression gate.

**Files:**
- Create: `lib/domain/appetite/registry.ts`, `lib/domain/appetite/lines/property.ts`
- Modify: `lib/domain/appetite.ts`
- Test: existing `tests/*appetite*`/rule tests (must stay green)

- [ ] **Step 1: Run the existing suite to capture the green baseline**

Run: `npm test`
Expected: 261 passing. Note the count.

- [ ] **Step 2: Create `lib/domain/appetite/lines/property.ts`**

Move the property scoring internals out of `appetite.ts` **verbatim**: the constants (`TARGET_STATES`…`LOSS_MAX`), `labels`, `text`, `isFiniteNumber`, `factor`, the eight `evaluate*` functions, and `evaluateFactors`. Export:

```ts
import type { CanonicalSubmission, FactorEvaluation } from "@/lib/domain/types";
// ...all the moved helpers/constants unchanged...
export const PROPERTY_LABELS = labels;
export function evaluatePropertyFactors(submission: CanonicalSubmission): FactorEvaluation[] {
  return [ /* the existing eight evaluate* calls, unchanged */ ];
}
```

- [ ] **Step 3: Create `lib/domain/appetite/registry.ts`**

```ts
import type { CanonicalSubmission, FactorEvaluation, LineOfBusiness } from "@/lib/domain/types";
import { evaluatePropertyFactors } from "./lines/property";

export type AppetiteProvenance = "provided-pdf" | "synthesized-for-demo";

export interface AppetiteTable {
  line: LineOfBusiness;
  displayName: string;
  provenance: AppetiteProvenance;
  /** Produce the ordered factor verdicts for this line. */
  evaluate(submission: CanonicalSubmission): FactorEvaluation[];
}

const PROPERTY_TABLE: AppetiteTable = {
  line: "property",
  displayName: "Commercial Property",
  provenance: "provided-pdf",
  evaluate: evaluatePropertyFactors,
};

export const APPETITE_TABLES: Record<LineOfBusiness, AppetiteTable> = {
  property: PROPERTY_TABLE,
  // cgl/auto/cyber/excess/health/lpl added in Task 3
} as Record<LineOfBusiness, AppetiteTable>;

export function tableFor(line?: string): AppetiteTable | undefined {
  const key = line?.trim().toLowerCase();
  if (!key) return undefined;
  if (key.includes("property")) return APPETITE_TABLES.property;
  return APPETITE_TABLES[key as LineOfBusiness];
}
```

- [ ] **Step 4: Rewrite `lib/domain/appetite.ts` to delegate**

Keep the public API identical (`classifyScope`, `evaluateFactors`, `computeScore`, `deriveStatus`, `evaluateAppetite`, `rankSubmissions`, `SCORE_POINTS`, `MAX_SCORE_POINTS`). Change only two things:

`classifyScope` gains a mode; default keeps today's behavior:

```ts
import { tableFor } from "./appetite/registry";
export function classifyScope(lineOfBusiness?: string, extended = false): LineScope {
  const normalized = lineOfBusiness?.trim().toLowerCase();
  if (!normalized) return "unknown_line";
  if (normalized.includes("property")) return "property";
  if (extended && tableFor(normalized)) return "in_scope_line"; // scored via its table
  return "out_of_scope";
}
```

Widen `LineScope` to `"property" | "in_scope_line" | "out_of_scope" | "unknown_line"`.

`evaluateFactors` delegates to the registry (property path unchanged):

```ts
export function evaluateFactors(submission: CanonicalSubmission, extended = false): FactorEvaluation[] {
  const table = extended ? tableFor(submission.lineOfBusiness) : APPETITE_TABLES.property;
  return (table ?? APPETITE_TABLES.property).evaluate(submission);
}
```

`evaluateAppetite(submission, extended = false)` and `rankSubmissions(subs, opts?: { extended?: boolean })` thread `extended` through; when `extended` is false/absent, the code path and output are exactly today's. Out-of-scope branch uses `classifyScope(line, extended) === "out_of_scope"`.

- [ ] **Step 5: Run the full suite — regression gate**

Run: `npm test`
Expected: same 261 passing, zero diff. If any property test changed output, the extraction was not verbatim — fix.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add lib/domain/appetite.ts lib/domain/appetite/
git commit -m "refactor(appetite): extract property table into a line-of-business registry (no behavior change)"
```

---

## Task 3: Six researched multi-line appetite tables

Each table is **synthesized-for-demo** (documented, not a real carrier filing) and scores over the fields every record already carries. Factor keys are **reused** from the existing `FactorKey` union — no contract change: `submissionType`, `primaryRiskState`, `totalPremium`, `fiveYearLossValue`, and `tiv` (reinterpreted per line as the exposure/limit basis). Property-only keys (`buildingYear`, `construction`, `lineOfBusiness`) are omitted for non-property lines.

**Researched bands (encode exactly):**

| Line | In-scope submission type | Target states | Acceptable states | Premium acceptable | Premium target | Exposure basis (`tiv`) acceptable | 5-yr losses acceptable |
|---|---|---|---|---|---|---|---|
| **cgl** | new or renewal | OH,PA,MD,CO,CA,FL | +NC,SC,GA,VA,UT,TX,TN | $25K–$250K | $40K–$120K | ≤ $75M revenue-proxy | < $150K |
| **auto** | new or renewal | OH,PA,MD,CO,CA,FL | +IL,MO,MA,NJ,AZ | $30K–$300K | $50K–$150K | ≤ $50M fleet-value | < $250K (loss-heavy line) |
| **cyber** | new or renewal | any US state (target: CA,WA,NY,TX,MA) | any US state | $20K–$200K | $50K–$120K | ≤ $60M revenue-proxy | < $100K breach history |
| **excess** | new or renewal | follows-form; target CA,FL,TX,NY | any US state | $10K–$150K | $20K–$80K | ≤ $100M attachment basis | < $50K |
| **health** | new only (renewal not acceptable) | OH,PA,MD,CO,CA,FL | +NC,SC,GA,VA,UT | $50K–$500K | $100K–$300K | n/a (omit tiv factor) | < $300K |
| **lpl** | new or renewal | CA,NY,IL,TX,FL (target) | any US state | $15K–$180K | $30K–$90K | ≤ $40M firm-revenue-proxy | < $75K |

Rules shared with property: missing value → `unknown`; a value on a not-acceptable side → `not_acceptable`; inside target → `target`; inside acceptable but not target → `acceptable`. Boundaries exactly on a threshold → `unknown` (mirrors property's exact-boundary handling).

**Files:**
- Create: `lib/domain/appetite/lines/casualty.ts` (cgl, auto, excess, lpl), `lib/domain/appetite/lines/specialty.ts` (cyber, health)
- Modify: `lib/domain/appetite/registry.ts`
- Test: `tests/appetite-multiline.test.ts`

- [ ] **Step 1: Write failing tests (one representative assertion per line + boundary + missing)**

```ts
// tests/appetite-multiline.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { tableFor } from "../lib/domain/appetite/registry";
import type { CanonicalSubmission } from "../lib/domain/types";

const base: CanonicalSubmission = { id: "x", accountName: "Acme", submissionType: "new" };

function verdict(line: string, patch: Partial<CanonicalSubmission>, key: string) {
  const f = tableFor(line)!.evaluate({ ...base, lineOfBusiness: line, ...patch });
  return f.find((x) => x.key === key)?.verdict;
}

test("cgl premium bands", () => {
  assert.equal(verdict("cgl", { primaryRiskState: "CA", totalPremium: 60000 }, "totalPremium"), "target");
  assert.equal(verdict("cgl", { primaryRiskState: "CA", totalPremium: 300000 }, "totalPremium"), "not_acceptable");
});
test("auto is loss-tolerant to 250k", () => {
  assert.equal(verdict("auto", { fiveYearLossValue: 200000 }, "fiveYearLossValue"), "acceptable");
});
test("cyber accepts any state", () => {
  assert.equal(verdict("cyber", { primaryRiskState: "WA" }, "primaryRiskState"), "target");
});
test("health rejects renewals", () => {
  assert.equal(verdict("health", { submissionType: "renewal" }, "submissionType"), "not_acceptable");
});
test("excess low-premium band", () => {
  assert.equal(verdict("excess", { totalPremium: 27600 }, "totalPremium"), "target");
});
test("lpl target states", () => {
  assert.equal(verdict("lpl", { primaryRiskState: "NY" }, "primaryRiskState"), "target");
});
test("missing value is unknown for every line", () => {
  for (const line of ["cgl", "auto", "cyber", "excess", "health", "lpl"]) {
    assert.equal(verdict(line, {}, "totalPremium"), "unknown");
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/appetite-multiline.test.ts`
Expected: FAIL — `tableFor("cgl")` is undefined.

- [ ] **Step 3: Implement the shared band helpers + line tables**

In `registry.ts` export reusable pure helpers (so each line file stays declarative):

```ts
import type { AppetiteVerdict, FactorEvaluation, FactorKey } from "@/lib/domain/types";

export function bandVerdict(
  value: number | undefined,
  opts: { min: number; max: number; targetMin?: number; targetMax?: number },
): AppetiteVerdict {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  if (value === opts.min || value === opts.max) return "unknown"; // exact boundary
  if (value < opts.min || value > opts.max) return "not_acceptable";
  if (opts.targetMin !== undefined && value >= opts.targetMin && value <= opts.targetMax!) return "target";
  return "acceptable";
}

export function stateVerdict(value: string | undefined, target: Set<string>, acceptable: Set<string>): AppetiteVerdict {
  const s = value?.trim().toUpperCase();
  if (!s) return "unknown";
  if (target.has(s)) return "target";
  if (acceptable.has(s)) return "acceptable";
  return "not_acceptable";
}

export function submissionTypeVerdict(value: string | undefined, renewalAcceptable: boolean): AppetiteVerdict {
  const s = value?.trim().toLowerCase();
  if (!s) return "unknown";
  if (s.includes("renew")) return renewalAcceptable ? "acceptable" : "not_acceptable";
  if (s.includes("new")) return "acceptable";
  return "unknown";
}

export function mk(key: FactorKey, label: string, verdict: AppetiteVerdict, reason: string): FactorEvaluation {
  return { key, label, verdict, reason };
}
```

Then `casualty.ts` / `specialty.ts` each export an `AppetiteTable` per line whose `evaluate` builds the ordered factors from the table above using `mk`/`bandVerdict`/`stateVerdict`/`submissionTypeVerdict`, with a plain-English `reason` for each (e.g. `` `Premium ${formatMoney(v)} is in the $40K–$120K target range.` ``). Every line's factor order: submissionType, primaryRiskState, totalPremium, tiv (omit for health), fiveYearLossValue. Register all six in `APPETITE_TABLES`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/appetite-multiline.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck + commit**

```bash
npm test && npm run typecheck
git add lib/domain/appetite/ tests/appetite-multiline.test.ts
git commit -m "feat(appetite): researched appetite tables for cgl/auto/cyber/excess/health/lpl (synthesized-for-demo)"
```

---

## Task 4: Synthetic property submissions (~24, balanced)

**Files:**
- Create: `lib/demo/synthetic-property.ts`
- Test: `tests/synthetic-property.test.ts`

**Case matrix (encode each as a `CanonicalSubmission`; ids `SUB-SYN-0001`…`SUB-SYN-0024`, all `lineOfBusiness:"property"`).** Fields: submissionType, primaryRiskState, tiv, totalPremium, buildingYear, approvedConstructionPercentage, constructionDescription, fiveYearLossValue, effectiveDate/expirationDate.

| # | Intent | subType | state | tiv | premium | year | apc | losses |
|---|---|---|---|---|---|---|---|---|
| 1–4 | **In-appetite (target)** | new | CA/FL/CO/OH | 75M | 88K | 2015 | 0.8 | 40K |
| 5–6 | In-appetite (acceptable edges) | new | NC/VA | 140M | 60K | 1995 | 0.6 | 90K |
| 7 | Boundary: exactly 1990 | new | PA | 80M | 85K | 1990 | 0.7 | 50K |
| 8 | Boundary: exactly $150M TIV | new | MD | 150000000 | 90K | 2012 | 0.9 | 10K |
| 9 | Boundary: exactly 50/50 construction | new | CA | 70M | 80K | 2011 | 0.5 | 20K |
| 10 | Boundary: exactly $100K losses | new | FL | 65M | 82K | 2013 | 0.8 | 100000 |
| 11–13 | **Needs-evidence (missing fields)** | new | CA/OH/CO | 75M | *(omit premium)* | 2014 | 0.8 | *(omit losses on 12; omit year on 13)* |
| 14–16 | **Contradiction (one hard gate)** | new | CA | 75M | 88K | 1965 (14) | 0.8 | 40K; #15 premium 400K; #16 state TX |
| 17–19 | **Out of appetite (renewal)** | renewal | CA/FL/OH | 75M | 88K | 2015 | 0.8 | 40K |
| 20–22 | **Multi-location** (derive primary state/construction) | new | CA | 90M | 95K | 2016 | 0.55 | 30K (add a `constructionDescription` implying mixed) |
| 23–24 | High-hazard target (for W7 later) | new | CA/FL | 85M | 92K | 2014 | 0.85 | 25K |

Provide realistic `accountName`s (e.g. "Aster Cold Storage LLC") and matching effective/expiration dates one year apart. Set `constructionDescription` consistent with `apc`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/synthetic-property.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { syntheticPropertySubmissions } from "../lib/demo/synthetic-property";
import { rankSubmissions } from "../lib/domain/appetite";

test("synthetic set is ~24 unique property submissions", () => {
  const s = syntheticPropertySubmissions();
  assert.ok(s.length >= 22 && s.length <= 26, `got ${s.length}`);
  assert.equal(new Set(s.map((x) => x.id)).size, s.length);
  assert.ok(s.every((x) => x.lineOfBusiness === "property"));
});

test("synthetic set yields several in-appetite submissions", () => {
  const ranked = rankSubmissions(syntheticPropertySubmissions());
  assert.ok(ranked.filter((r) => r.status === "in_appetite").length >= 4);
});

test("boundary cases land on needs_investigation via unknown verdicts", () => {
  const ranked = rankSubmissions(syntheticPropertySubmissions());
  const byId = new Map(ranked.map((r) => [r.id, r]));
  assert.equal(byId.get("SUB-SYN-0007")!.status, "needs_investigation"); // exactly 1990
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/synthetic-property.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/demo/synthetic-property.ts`** encoding the matrix above as a `const SUBMISSIONS: CanonicalSubmission[]` and `export function syntheticPropertySubmissions() { return SUBMISSIONS.map((s) => ({ ...s })); }`. Deterministic; no randomness.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/synthetic-property.test.ts`
Expected: PASS. If in-appetite count < 4, adjust cases 1–6 so no factor is unknown/not-acceptable.

- [ ] **Step 5: Full suite + typecheck + commit**

```bash
npm test && npm run typecheck
git add lib/demo/synthetic-property.ts tests/synthetic-property.test.ts
git commit -m "feat(demo): ~24 balanced synthetic property submissions incl. in-appetite + boundary cases"
```

---

## Task 5: Thread the dataset mode through the pipeline + route

**Files:**
- Modify: `lib/rankings/pipeline.ts`, `app/api/rankings/route.ts`
- Test: `tests/dataset-mode.test.ts` (extend)

- [ ] **Step 1: Extend the failing test**

```ts
// append to tests/dataset-mode.test.ts
import { buildRankings } from "../lib/rankings/pipeline";
import type { CanonicalSubmission, RankedSubmission } from "../lib/domain/types";
import { rankSubmissions } from "../lib/domain/appetite";

function deps(subs: CanonicalSubmission[], extendedRank = false) {
  return {
    useDemoData: false, demoSubmissions: [], dataSource: "offline" as const,
    runAgent: async () => ({ submissions: subs, traceSummary: [] }),
    rank: (s: CanonicalSubmission[]) => rankSubmissions(s, { extended: extendedRank }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
}

test("baseline does not inject synthetic and leaves non-property out_of_scope", async () => {
  const cgl: CanonicalSubmission = { id: "c1", accountName: "Co", lineOfBusiness: "cgl", primaryRiskState: "CA", totalPremium: 60000 };
  const r = await buildRankings(deps([cgl]), { dataset: "baseline" });
  assert.equal(r.dataset, "baseline");
  assert.ok(r.submissions.every((s) => !s.synthetic));
  assert.equal(r.submissions.find((s) => s.id === "c1")!.status, "out_of_scope");
});

test("extended injects synthetic and scores cgl", async () => {
  const cgl: CanonicalSubmission = { id: "c1", accountName: "Co", lineOfBusiness: "cgl", primaryRiskState: "CA", totalPremium: 60000 };
  const r = await buildRankings(deps([cgl], true), { dataset: "extended" });
  assert.equal(r.dataset, "extended");
  assert.ok(r.submissions.some((s) => s.synthetic === true));
  assert.notEqual(r.submissions.find((s) => s.id === "c1")!.status, "out_of_scope");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/dataset-mode.test.ts`
Expected: FAIL — `buildRankings` takes one arg; no synthetic injection.

- [ ] **Step 3: Implement in `pipeline.ts`**

Add an options arg and synthetic injection. Signature: `buildRankings(deps, options: { dataset?: Dataset } = {})`. Set `const dataset = options.dataset ?? "baseline";` `const extended = dataset === "extended";`.

In the non-demo path, after `const agent = await deps.runAgent();`:

```ts
import { syntheticPropertySubmissions } from "@/lib/demo/synthetic-property";
const merged = extended ? [...agent.submissions, ...syntheticPropertySubmissions()] : agent.submissions;
const syntheticIds = new Set(extended ? syntheticPropertySubmissions().map((s) => s.id) : []);
const ranked = deps.rank(merged);
for (const s of ranked) if (syntheticIds.has(s.id)) s.synthetic = true;
```

Return `dataset` in the response object. `defaultPipelineDeps` sets `rank: (s) => rankSubmissions(s, { extended: <from closure> })` — pass `extended` into `defaultPipelineDeps(dataset?: Dataset)` and compute `const extended = dataset === "extended"`. (Demo path stays property-only, `dataset` echoed.)

- [ ] **Step 4: Update `app/api/rankings/route.ts`**

```ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  const dataset = url.searchParams.get("dataset") === "extended" ? "extended" : "baseline";
  try {
    return NextResponse.json(await buildRankings(defaultPipelineDeps(dataset), { dataset }));
  } catch (error) {
    const body = categorizeError(error);
    return NextResponse.json(body, { status: httpStatusFor(body.category) });
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsx --test tests/dataset-mode.test.ts && npm test && npm run typecheck`
Expected: PASS; baseline suite still 261+ green.

- [ ] **Step 6: Commit**

```bash
git add lib/rankings/pipeline.ts app/api/rankings/route.ts tests/dataset-mode.test.ts
git commit -m "feat(pipeline): dataset=extended injects synthetic + scores all lines; baseline unchanged"
```

---

## Task 6: Header dataset toggle (UI)

**Files:**
- Modify: `components/app-shell.tsx`
- Test: manual/live (Task 8). No unit test — presentational state only.

- [ ] **Step 1: Add dataset state + fetch param in `components/app-shell.tsx`**

Add `const [dataset, setDataset] = useState<"baseline" | "extended">("baseline");`. In `loadRankings`, fetch `` `/api/rankings?dataset=${dataset}` ``. Add `dataset` to the `useCallback` deps and the mount `useEffect` deps so switching refetches.

- [ ] **Step 2: Render the toggle** in the `queue-toolbar` block (next to Chase list / Methodology):

```tsx
<div className="dataset-toggle" role="group" aria-label="Dataset">
  <button type="button" className={dataset === "baseline" ? "active" : ""} aria-pressed={dataset === "baseline"} onClick={() => setDataset("baseline")}>Federato baseline</button>
  <button type="button" className={dataset === "extended" ? "active" : ""} aria-pressed={dataset === "extended"} onClick={() => setDataset("extended")}>Extended</button>
</div>
{dataset === "extended" && (
  <p className="dataset-note">Extended adds ~24 synthetic property submissions and scores all lines through our researched appetite tables.</p>
)}
```

Add minimal styles to the queue CSS (`components/queue/queue.css`) matching the existing ghost-button treatment.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/app-shell.tsx components/queue/queue.css
git commit -m "feat(ui): Baseline/Extended dataset toggle in the queue header"
```

---

## Task 7: Live verification (browser)

- [ ] **Step 1:** `npm run dev`, open `http://localhost:3000`.
- [ ] **Step 2:** Baseline: confirm 158 rows, "Ready for review" = 0 (unchanged), non-property = out of scope.
- [ ] **Step 3:** Click **Extended**: confirm the queue grows (~182), "Ready for review" now shows the synthetic in-appetite cases, and other-line rows (cgl/auto/…) now carry real statuses instead of "out of scope". Confirm synthetic rows are visibly labeled.
- [ ] **Step 4:** Toggle back to Baseline: confirm it returns to the exact original view (before/after works).
- [ ] **Step 5:** `git commit -m "chore: phase-1 live verification notes"` if any tweaks were needed.

---

## Self-review notes

- **Spec coverage:** toggle (T5/T6), Part A synthetic (T4), Part B multi-line (T2/T3), baseline-unchanged invariant (T2 gate + T5 baseline test), dataset echo (T1). Methodology line-awareness is deferred to the Phase 2 plan (header/queue is the Phase-1 surface); noted so it is not lost.
- **No new FactorKey needed:** non-property lines reuse existing keys; confirmed against `lib/domain/types.ts:1-9`.
- **Type consistency:** `rankSubmissions(subs, { extended })`, `evaluateFactors(sub, extended)`, `classifyScope(line, extended)`, `buildRankings(deps, { dataset })`, `defaultPipelineDeps(dataset)` — signatures consistent across Tasks 2, 5, 6.
```
