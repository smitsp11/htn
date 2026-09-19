# W8 — Multi-Channel Consolidation (Browserbase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **DEPENDS ON W3** (the waterfall + provenance + resolution map). Build W3 first — W8 is a *source* that plugs into it.

**Goal:** Consolidate broker data that was *already provided but scattered* across channels (email body, an attached SOV, a broker-portal page) into the canonical submission record — so a field that looks "missing" is resolved from where the broker actually put it, **reducing the ~1.4 broker follow-ups** without contacting the broker at all. A browser agent (Browserbase/Stagehand, or local Playwright) drives the channels; every resolved value carries provenance ("consolidated from broker email").

**Architecture:** Three layers. (1) A **staged scattered scenario** — deterministic fixtures standing in for the messy channels (a broker-email HTML page, a semi-structured SOV, a portal page), because the HTN dataset is a single synthetic API with nothing scattered to consolidate; Federato green-lit synthesizing supporting data. (2) A **`ChannelSource` interface** with deterministic fixture adapters (demo-safe, no network) and an **optional live Browserbase/Stagehand adapter** behind the same interface. (3) A **build-time `scripts/consolidate.ts`** that runs the adapters over the scenario and writes a provenance-tagged `raw/consolidation.json`; W3's `resolveSubmissionFields` reads that cache as its **highest-priority source**, so scattered-but-present data resolves before anything routes to broker-chase (W4). Runtime stays deterministic and demo-safe; live browsing happens at build time or in a clearly-labeled "run consolidation" demo action.

**Tech Stack:** Next.js 16, TypeScript strict, `node:test` + `tsx`. Optional: `@browserbasehq/sdk` + `@browserbasehq/stagehand` (key-gated), or the local Playwright MCP for prototyping. No runtime network dependency in the default path.

**Invariants (must hold after every task):** consolidation only *fills required fields* the engine needs — it never invents a value the channels don't contain, and it never changes appetite scoring logic; every consolidated value carries channel provenance; the default runtime path does no live browsing; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## File Structure

- `lib/consolidation/scenario/` — NEW. Staged scattered-channel fixtures (email, SOV, portal) + which submission/field each hides.
- `lib/consolidation/channel-source.ts` — NEW. `ChannelSource` interface + deterministic fixture adapters.
- `lib/consolidation/consolidate.ts` — NEW. Run adapters → per-submission resolution map (reuses W3 `ResolvedValue`).
- `lib/consolidation/browserbase-source.ts` — NEW (optional, key-gated). Live Stagehand adapter behind `ChannelSource`.
- `scripts/consolidate.ts` — NEW. Build-time cache writer → `raw/consolidation.json`.
- `lib/enrichment/resolve-submission.ts` — MODIFY (from W3). Add the consolidation cache as the top-priority source.
- `tests/consolidation.test.ts` — NEW.

---

## Task 1: Staged scattered scenario + channel-source interface (pure, tested)

**Files:**
- Create: `lib/consolidation/scenario/index.ts`
- Create: `lib/consolidation/channel-source.ts`
- Test: `tests/consolidation.test.ts`

The scenario encodes: for a few demo submissions, a value that the engine sees as `unknown` actually lives in a channel. The fixture makes that explicit so adapters have something real (if synthetic) to extract.

- [ ] **Step 1: Write the failing test**

```ts
// tests/consolidation.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { SCENARIO } from "../lib/consolidation/scenario";
import { emailSource, sovSource, portalSource } from "../lib/consolidation/channel-source";

test("scenario hides at least one field per seeded submission in a channel", () => {
  assert.ok(SCENARIO.length > 0);
  for (const entry of SCENARIO) {
    assert.equal(typeof entry.submissionId, "string");
    assert.ok(entry.channels.length >= 1);
  }
});

test("a channel source returns a value + confidence for a field it holds, else null", () => {
  const entry = SCENARIO[0];
  const held = entry.channels[0];
  const sources = { email: emailSource, sov: sovSource, portal: portalSource };
  const source = sources[held.channel];
  const hit = source.lookup(entry.submissionId, held.field);
  assert.ok(hit, "the holding channel should return a value");
  assert.ok(hit.confidence > 0 && hit.confidence <= 1);
  // a field no channel holds returns null
  assert.equal(source.lookup("does-not-exist", held.field), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/consolidation.test.ts`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Write the scenario + interface + adapters**

```ts
// lib/consolidation/scenario/index.ts
import type { FactorKey } from "@/lib/domain/types";

export type ChannelName = "email" | "sov" | "portal";

export interface HeldField {
  channel: ChannelName;
  field: FactorKey;
  /** The value the broker actually provided in that channel. */
  value: number | string;
  /** How confidently this channel yields the value once located. */
  confidence: number;
}

export interface ScenarioEntry {
  submissionId: string;   // a real offline submission id whose field is "unknown"
  channels: HeldField[];
}

/** Staged scattered-channel data. Replace the placeholder submission ids with
 *  real offline ids whose corresponding factor is `unknown` (see raw/full_*.json
 *  via the offline adapter). Values here stand in for what the broker emailed /
 *  attached / posted to the portal. Synthetic and Federato-sanctioned. */
export const SCENARIO: ScenarioEntry[] = [
  {
    submissionId: "REPLACE_WITH_REAL_ID_1",
    channels: [
      { channel: "email", field: "totalPremium", value: 92_000, confidence: 0.9 },
      { channel: "sov", field: "tiv", value: 78_000_000, confidence: 0.85 },
    ],
  },
  {
    submissionId: "REPLACE_WITH_REAL_ID_2",
    channels: [{ channel: "portal", field: "buildingYear", value: 2015, confidence: 0.8 }],
  },
];
```

```ts
// lib/consolidation/channel-source.ts
import type { FactorKey } from "@/lib/domain/types";
import { SCENARIO, type ChannelName } from "./scenario";

export interface ChannelSource {
  channel: ChannelName;
  /** Return the value this channel holds for (submission, field), or null. */
  lookup: (submissionId: string, field: FactorKey) => { value: number | string; confidence: number } | null;
}

function fixtureSource(channel: ChannelName): ChannelSource {
  return {
    channel,
    lookup(submissionId, field) {
      const entry = SCENARIO.find((e) => e.submissionId === submissionId);
      const held = entry?.channels.find((c) => c.channel === channel && c.field === field);
      return held ? { value: held.value, confidence: held.confidence } : null;
    },
  };
}

export const emailSource = fixtureSource("email");
export const sovSource = fixtureSource("sov");
export const portalSource = fixtureSource("portal");
export const ALL_SOURCES: ChannelSource[] = [emailSource, sovSource, portalSource];
```

- [ ] **Step 4: Run test to verify it passes** (after replacing placeholder ids — see note)

Run: `npx tsx --test tests/consolidation.test.ts`
Expected: PASS.

> **Required before running:** replace `REPLACE_WITH_REAL_ID_*` with real offline submission ids whose factor is genuinely `unknown`. Find them by loading the offline data and picking submissions with missing premium / TIV / building year (the same yellow-flag submissions W1/W2 surface, e.g. the "Unknown premium" rows visible in the queue).

- [ ] **Step 5: Commit**

```bash
git add lib/consolidation/scenario/index.ts lib/consolidation/channel-source.ts tests/consolidation.test.ts
git commit -m "feat(consolidation): staged scattered scenario + channel sources"
```

---

## Task 2: Consolidation resolver (pure, tested)

**Files:**
- Create: `lib/consolidation/consolidate.ts`
- Test: extend `tests/consolidation.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { consolidateSubmission } from "../lib/consolidation/consolidate";
import { ALL_SOURCES } from "../lib/consolidation/channel-source";

test("consolidate resolves a held field with channel provenance", () => {
  const entry = SCENARIO[0];
  const held = entry.channels[0];
  const map = consolidateSubmission(entry.submissionId, [held.field], ALL_SOURCES);
  const resolved = map[held.field];
  assert.ok(resolved, "held field should resolve");
  assert.equal(resolved.provenance.source, `broker ${held.channel}`);
  assert.equal(resolved.value, held.value);
});

test("consolidate leaves a truly-absent field unresolved", () => {
  const map = consolidateSubmission(SCENARIO[0].submissionId, ["primaryRiskState"], ALL_SOURCES);
  assert.equal(map.primaryRiskState, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/consolidation.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```ts
// lib/consolidation/consolidate.ts
import type { FactorKey } from "@/lib/domain/types";
import type { ResolvedValue } from "@/lib/enrichment/provenance";
import type { ChannelSource } from "./channel-source";

const asOf = new Date().toISOString().slice(0, 10);

/** For each requested (unresolved) field, ask each channel in order and take the
 *  first hit. Provenance names the channel ("broker email"). Only fills fields a
 *  channel actually holds — never invents. */
export function consolidateSubmission(
  submissionId: string,
  fields: FactorKey[],
  sources: ChannelSource[],
): Partial<Record<FactorKey, ResolvedValue<number | string>>> {
  const map: Partial<Record<FactorKey, ResolvedValue<number | string>>> = {};
  for (const field of fields) {
    for (const source of sources) {
      const hit = source.lookup(submissionId, field);
      if (hit) {
        map[field] = { value: hit.value, provenance: { source: `broker ${source.channel}`, confidence: hit.confidence, asOf } };
        break;
      }
    }
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/consolidation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/consolidation/consolidate.ts tests/consolidation.test.ts
git commit -m "feat(consolidation): resolve scattered fields with channel provenance"
```

---

## Task 3: Build-time cache script

**Files:**
- Create: `scripts/consolidate.ts`

- [ ] **Step 1: Write the script** (mirrors `scripts/fetch-enrichment.ts` — writes a cache under `raw/`)

```ts
// scripts/consolidate.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { rankSubmissions } from "@/lib/domain/appetite";
import { loadOfflineSubmissions } from "@/lib/federato/offline-data";
import { completenessOf } from "@/lib/rankings/completeness";
import { ALL_SOURCES } from "@/lib/consolidation/channel-source";
import { consolidateSubmission } from "@/lib/consolidation/consolidate";

async function main() {
  const ranked = rankSubmissions(await loadOfflineSubmissions());
  const out: Record<string, unknown> = {};
  for (const s of ranked) {
    const missing = completenessOf(s).missing;
    if (missing.length === 0) continue;
    const resolved = consolidateSubmission(s.id, missing, ALL_SOURCES);
    if (Object.keys(resolved).length > 0) out[s.id] = resolved;
  }
  writeFileSync(join(process.cwd(), "raw", "consolidation.json"), JSON.stringify(out, null, 2));
  console.log(`consolidation.json written for ${Object.keys(out).length} submissions`);
}

void main();
```

- [ ] **Step 2: Run it and inspect output**

Run: `npx tsx scripts/consolidate.ts`
Expected: writes `raw/consolidation.json`; non-empty once SCENARIO ids are real.

- [ ] **Step 3: Commit**

```bash
git add scripts/consolidate.ts raw/consolidation.json
git commit -m "feat(consolidation): build-time cache writer"
```

---

## Task 4: Feed consolidation into W3's waterfall (top-priority source)

**Files:**
- Modify: `lib/enrichment/resolve-submission.ts` (from W3)

- [ ] **Step 1: Load the consolidation cache.** Add a loader that reads `raw/consolidation.json` (mirror `loadHazardIndex` in `lib/enrichment/hazard.ts`: try/catch, return `{}` on miss).

- [ ] **Step 2: Make consolidation the first source in `chainFor`.** In W3's `resolveSubmissionFields`, before running the (empty) inference chain, check the consolidation cache for the field; if present, use that `ResolvedValue` directly (it already has provenance "broker email/sov/portal"). Only fall through to broker-chase (null) when no channel held it.

```ts
// sketch inside resolveSubmissionFields (W3), per unknown factor:
const consolidated = consolidationIndex[submission.id]?.[factor.key];
map[factor.key] = consolidated ?? runWaterfall(chainFor(factor.key, submission), CONFIDENCE_THRESHOLD);
```

- [ ] **Step 3: Verify** the W3 provenance chips now render "broker email/sov/portal · NN% · date" for the seeded fields, and unseeded gaps still show "Request from broker".

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/enrichment/resolve-submission.ts
git commit -m "feat(consolidation): consolidated channels resolve fields before broker-chase"
```

---

## Optional Task 5: Live Browserbase/Stagehand adapter (demo showpiece)

Only for the live-demo moment; keep the fixture adapters as the deterministic default.

**Files:**
- Create: `lib/consolidation/browserbase-source.ts`
- Add a local static host of the scenario pages (a tiny route or `public/scenario/*.html`) so the browser agent has real pages to read.

- [ ] Implement a `ChannelSource` whose `lookup` (or a batch `consolidate`) uses Stagehand to open the seeded email/portal pages and `extract` the field, returning `{ value, confidence }`. Key-gated on `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID`; when absent, callers fall back to the fixture sources. Pull current Stagehand API via context7 before writing.
- [ ] Wire a UI "Run consolidation" action (clearly labeled, human-triggered) that invokes the live path for one submission and animates the fields populating — the on-stage wow moment.

> Keep this OUT of the default runtime and CI. It is a demo affordance, not a request-path dependency.

---

## Self-Review Notes

- **Spec coverage:** scenario + channel sources (Task 1), resolver with provenance (Task 2), build-time cache (Task 3), wired into W3 as top source (Task 4), optional live agent (Task 5). ✅
- **Honesty:** consolidation only surfaces values a channel actually holds; it never invents. Provenance names the channel. Appetite logic untouched — it fills the required fields the deterministic engine reads. ✅
- **Demo reality:** the scattered scenario is synthetic (Federato-sanctioned). The live Browserbase path reads seeded pages, so the demo is real automation over real (synthetic) pages.
- **Depends on W3.** Do not build W8 before W3's `resolve-submission.ts` / provenance exist.
- **Must-do before tests pass:** replace `REPLACE_WITH_REAL_ID_*` in the scenario with real offline ids whose factor is `unknown`.
