# W9 — Government / Public-Data Enrichment (Context-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CONTRACT CHANGE:** adds one optional field to `RankedSubmission` (like the existing `enrichment?: HazardProfile` did for FEMA). Get the same nod the FEMA field got before Task 1.

**Goal:** Attach additional public/government context signals to each submission — decision-support that *adds context* but, by the project's non-negotiable rule, **never changes the appetite score or status**. This is the FEMA-hazard pattern extended to a second, pluggable source.

**Architecture:** Identical shape to the existing FEMA enrichment: a cached, offline, provenance-tagged file (`raw/context.json`) produced by a build-time `scripts/fetch-context.ts`, loaded into a `Map<submissionId, ContextSignal[]>`, attached to each `RankedSubmission` as an optional `context` field, and rendered in a read-only panel next to (never inside) the appetite breakdown. A `ContextSignal` is source-agnostic (`source`, `label`, `value`, `url`, `asOf`) so any government dataset — flood zone, census/place economics, business-registration status, OSHA establishment safety — plugs in without schema churn. Chosen concrete first source: **[DECIDE] a single public dataset keyed by the submission's primary location or account** (see Task 2).

**Tech Stack:** Next.js 16, TypeScript strict, `node:test` + `tsx`. Build-time `fetch` against a public API (no key where possible); runtime serves the cache offline (deterministic, demo-safe).

**Invariants (must hold after every task):** context signals NEVER enter `computeScore`/`deriveStatus`; the appetite engine and its tests are unchanged; every signal carries a source + url + asOf; runtime does no live fetch; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## File Structure

- `lib/domain/types.ts` — MODIFY. Add `ContextSignal` type + optional `context?: ContextSignal[]` on `RankedSubmission` (additive, mirrors `enrichment`).
- `lib/enrichment/context.ts` — NEW. `loadContextIndex` + `contextForSubmission` (mirror `hazard.ts`).
- `scripts/fetch-context.ts` — NEW. Build-time cache writer → `raw/context.json` (mirror `fetch-enrichment.ts`).
- `lib/rankings/pipeline.ts` — MODIFY. Attach context in the offline branch (mirror the `loadEnrichment` wiring).
- `components/context-signals/context-signals.tsx` (+ `.css`, `index.ts`) — NEW. Read-only panel.
- `components/dashboard/submission-detail.tsx` — MODIFY. Render the panel beside `ExternalRisk`.
- `tests/context.test.ts`, `tests/context-ui.test.ts` — NEW.

---

## Task 1: Types + loader (pure, tested)

**Files:**
- Modify: `lib/domain/types.ts`
- Create: `lib/enrichment/context.ts`
- Test: `tests/context.test.ts`

- [ ] **Step 1: Add the types.** Append to `lib/domain/types.ts` and add ONE optional field to `RankedSubmission` (additive, like `enrichment`):

```ts
export interface ContextSignal {
  source: string;   // e.g. "FEMA Flood Map", "Census ACS", "OSHA Establishment Search"
  label: string;    // e.g. "Flood zone", "Median household income", "OSHA inspections (5yr)"
  value: string;    // human-ready value ("Zone AE", "$68,400", "2 inspections, 0 violations")
  url: string;      // the exact public source, for click-through provenance
  asOf: string;     // ISO date captured
}
```

Add to `RankedSubmission`:

```ts
  context?: ContextSignal[];
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/context.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { contextForSubmission, loadContextIndex } from "../lib/enrichment/context";

test("loadContextIndex returns {} when the cache is absent", () => {
  const index = loadContextIndex("/nonexistent-dir");
  assert.deepEqual(index, {});
});

test("contextForSubmission returns the signals for a known key, else []", () => {
  const index = { "SUB-1": [{ source: "Census ACS", label: "Median income", value: "$68,400", url: "https://data.census.gov/x", asOf: "2026-09-19" }] };
  assert.equal(contextForSubmission(index, "SUB-1").length, 1);
  assert.deepEqual(contextForSubmission(index, "SUB-404"), []);
});
```

- [ ] **Step 3: Write the loader**

```ts
// lib/enrichment/context.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextSignal } from "@/lib/domain/types";

export type ContextIndex = Record<string, ContextSignal[]>;

export function loadContextIndex(rawDir = join(process.cwd(), "raw")): ContextIndex {
  try {
    return JSON.parse(readFileSync(join(rawDir, "context.json"), "utf8")) as ContextIndex;
  } catch {
    return {};
  }
}

export function contextForSubmission(index: ContextIndex, submissionId: string): ContextSignal[] {
  return index[submissionId] ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/types.ts lib/enrichment/context.ts tests/context.test.ts
git commit -m "feat(context): ContextSignal type + offline loader (context-only)"
```

---

## Task 2: Build-time fetch script

**Files:**
- Create: `scripts/fetch-context.ts`

Pick ONE concrete public source to start (decision required). Good candidates, all keyed to data you already have (`primaryLocation.state/county` or account name):
- **FEMA Flood Map Service Center** (flood zone by lat/long) — geographic, public.
- **Census ACS** (median income / population by county) — public API, no key.
- **OSHA Establishment Search** (inspection history by employer) — public.
- **USASpending / SAM.gov** (business registration/exclusions) — public.

- [ ] **Step 1: Write the script** (mirror `scripts/fetch-enrichment.ts`: iterate offline submissions, fetch per key, write `raw/context.json`)

```ts
// scripts/fetch-context.ts  (shape; fill in the chosen endpoint)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextSignal } from "@/lib/domain/types";
import { loadOfflineSubmissions } from "@/lib/federato/offline-data";

const asOf = new Date().toISOString().slice(0, 10);

async function signalsFor(/* submission or location */): Promise<ContextSignal[]> {
  // fetch the chosen public endpoint; map response -> ContextSignal[]; on failure
  // return [] (fail-open, never block the pipeline). Include the source `url`.
  return [];
}

async function main() {
  const subs = await loadOfflineSubmissions();
  const out: Record<string, ContextSignal[]> = {};
  for (const s of subs) {
    const signals = await signalsFor(/* s */);
    if (signals.length) out[s.id] = signals;
  }
  writeFileSync(join(process.cwd(), "raw", "context.json"), JSON.stringify(out, null, 2));
  console.log(`context.json written for ${Object.keys(out).length} submissions`);
}

void main();
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/fetch-context.ts`
Expected: writes `raw/context.json`.

- [ ] **Step 3: Commit**

```bash
git add scripts/fetch-context.ts raw/context.json
git commit -m "feat(context): build-time public-data cache writer"
```

---

## Task 3: Attach context in the pipeline

**Files:**
- Modify: `lib/rankings/pipeline.ts`

- [ ] **Step 1: Add a `loadContext` dep** to `RankingsPipelineDeps` mirroring `loadEnrichment` (optional; wired in `defaultPipelineDeps` for the offline branch only).

- [ ] **Step 2: Attach after ranking**, exactly like enrichment:

```ts
if (deps.loadContext) {
  const context = await deps.loadContext();
  for (const s of ranked) {
    const signals = context.get(s.id);
    if (signals && signals.length) s.context = signals;
  }
}
```

- [ ] **Step 3: Provide the loader** in `defaultPipelineDeps`: build a `Map<submissionId, ContextSignal[]>` from `loadContextIndex()` (mirror `loadOfflineEnrichment`).

- [ ] **Step 4: Verify appetite is untouched** — no context value flows into scoring.

Run: `npm run typecheck && npm test`
Expected: PASS (existing appetite/rankings tests unchanged — proves context did not alter scores).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/pipeline.ts lib/enrichment/context.ts
git commit -m "feat(context): attach public-data signals in the offline pipeline"
```

---

## Task 4: Context panel (read-only)

**Files:**
- Create: `components/context-signals/context-signals.tsx` (+ `.css`, `index.ts`)
- Modify: `components/dashboard/submission-detail.tsx`
- Test: `tests/context-ui.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/context-ui.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextSignals } from "../components/context-signals/context-signals";

test("renders each signal with a source link and 'not part of appetite' note", () => {
  const html = renderToStaticMarkup(
    createElement(ContextSignals, { signals: [{ source: "Census ACS", label: "Median income", value: "$68,400", url: "https://data.census.gov/x", asOf: "2026-09-19" }] }),
  );
  assert.match(html, /Median income/);
  assert.match(html, /\$68,400/);
  assert.match(html, /href="https:\/\/data\.census\.gov/);
  assert.match(html, /not part of the (carrier )?appetite/i);
});

test("renders nothing when there are no signals", () => {
  const html = renderToStaticMarkup(createElement(ContextSignals, { signals: [] }));
  assert.equal(html, "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/context-ui.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component** (mirror `ExternalRisk`'s read-only, context-only framing)

```tsx
// components/context-signals/context-signals.tsx
import type { ContextSignal } from "@/lib/domain/types";

export function ContextSignals({ signals }: { signals: ContextSignal[] }) {
  if (!signals || signals.length === 0) return null;
  return (
    <section className="ctx" aria-label="Public-data context">
      <span className="ctx-label">Public data · decision context</span>
      <ul className="ctx-list">
        {signals.map((s) => (
          <li key={`${s.source}-${s.label}`} className="ctx-item">
            <span className="ctx-field">{s.label}</span>
            <span className="ctx-value">{s.value}</span>
            <a className="ctx-src" href={s.url} target="_blank" rel="noreferrer">{s.source}</a>
          </li>
        ))}
      </ul>
      <small className="ctx-note">Outside data — not part of the carrier appetite score.</small>
    </section>
  );
}
```

Add `index.ts` (css import + re-export) and `context-signals.css` (mirror `external-risk.css`).

- [ ] **Step 4: Render in the detail view.** In `submission-detail.tsx`, import `ContextSignals` and render `<ContextSignals signals={submission.context ?? []} />` right after `<ExternalRisk .../>`.

- [ ] **Step 5: Run tests + verify**

Run: `npx tsx --test tests/context-ui.test.ts && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/context-signals components/dashboard/submission-detail.tsx tests/context-ui.test.ts
git commit -m "feat(context): read-only public-data context panel"
```

---

## Self-Review Notes

- **Spec coverage:** types + loader (Task 1), build-time cache (Task 2), pipeline attach (Task 3), read-only panel (Task 4). ✅
- **Rule compliance:** context NEVER touches `computeScore`/`deriveStatus`; Task 3 Step 4 proves it by keeping the appetite/rankings tests green. Panel copy explicitly says "not part of the carrier appetite score" (same wording as `ExternalRisk`). ✅
- **Contract change:** one additive optional field (`context?: ContextSignal[]`), mirroring the already-approved `enrichment?: HazardProfile`. Needs the same sign-off.
- **Decision required (Task 2):** which single public dataset to wire first. Recommend the one that keys cleanly off `primaryLocation` (flood zone or Census ACS) since that join already exists for FEMA.
- **Consistency:** deliberately mirrors `hazard.ts` / `fetch-enrichment.ts` / `ExternalRisk` so a reviewer sees one pattern, not two.
