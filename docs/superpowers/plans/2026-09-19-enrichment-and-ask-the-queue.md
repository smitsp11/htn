# Enrichment + Ask-the-Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (A) an external natural-hazard enrichment layer per submission and (B) a grounded natural-language "ask-the-queue" interface, without changing the deterministic appetite engine.

**Architecture:** Enrichment is a cached, offline, per-location FEMA National Risk Index profile attached to each `RankedSubmission` as an optional field and shown as separate decision-support context — it never enters scoring. Ask-the-queue is grounded tool-calling: OpenAI interprets the question and phrases the answer, while deterministic tools over the already-scored submissions produce every fact and row; the returned filter drives the live queue.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, React 19, `node:test` + `tsx`, OpenAI Chat Completions via `fetch` (no new dependency), FEMA National Risk Index (no key).

**Spec:** `docs/superpowers/specs/2026-09-19-enrichment-and-ask-the-queue-design.md`

**Invariants (must hold after every task):** appetite engine untouched; product read-only; no secret in any response/error/fixture/commit; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## Phase 1 — Enrichment

### Task 1: Hazard types + fixture cache

**Files:**
- Modify: `lib/domain/types.ts` (add hazard types + optional `enrichment` field)
- Create: `raw/enrichment.json` (committed fixture cache; real data pulled in Task 3)
- Create: `tests/fixtures/enrichment/index.ts`

- [ ] **Step 1: Add hazard types and the optional contract field to `lib/domain/types.ts`.** Append the types and add ONE optional field to `RankedSubmission` (additive; the approved frozen-contract change):

```ts
export type HazardRating =
  | "very low"
  | "relatively low"
  | "relatively moderate"
  | "relatively high"
  | "very high"
  | "unknown";

export interface HazardEntry {
  type: string;        // e.g. "Wildfire", "Coastal Flooding", "Hurricane"
  rating: HazardRating;
}

export interface HazardProfile {
  compositeRating: HazardRating;
  compositeScore?: number;      // 0-100 NRI score when available
  topHazards: HazardEntry[];    // highest-rated hazards, most severe first
  source: "FEMA NRI";
  asOf: string;                 // ISO date the data was captured
}
```

Then, inside the existing `RankedSubmission` interface, add:

```ts
  enrichment?: HazardProfile;
```

- [ ] **Step 2: Create the committed cache `raw/enrichment.json`** as a JSON object keyed by `"STATE|County"`. Seed all 15 real county pairs. Real ratings are filled by Task 3; until then use `"unknown"` placeholders so the app is honest, e.g.:

```json
{
  "FL|Hillsborough": { "compositeRating": "unknown", "topHazards": [], "source": "FEMA NRI", "asOf": "2026-09-19" }
}
```

Include every pair emitted by:
`python3 -c "import json;print(sorted({(l['state'],l['county']) for l in json.load(open('raw/full_Location.json'))['output'][0]['data']['results']}))"`

- [ ] **Step 3: Create `tests/fixtures/enrichment/index.ts`** with a small hand-built index for tests (do not depend on `raw/enrichment.json`):

```ts
import type { HazardIndex } from "@/lib/enrichment/hazard";

export const hazardFixture: HazardIndex = {
  "CA|Los Angeles": {
    compositeRating: "very high",
    compositeScore: 92.1,
    topHazards: [
      { type: "Wildfire", rating: "very high" },
      { type: "Earthquake", rating: "relatively high" },
    ],
    source: "FEMA NRI",
    asOf: "2026-09-19",
  },
  "FL|Hillsborough": {
    compositeRating: "relatively high",
    compositeScore: 71.4,
    topHazards: [{ type: "Hurricane", rating: "very high" }],
    source: "FEMA NRI",
    asOf: "2026-09-19",
  },
};
```

- [ ] **Step 4: Verify typecheck.** Run: `npm run typecheck` — Expected: clean (no consumers of the new field yet).

- [ ] **Step 5: Commit.**

```bash
git add lib/domain/types.ts raw/enrichment.json tests/fixtures/enrichment/index.ts
git commit -m "feat(enrichment): hazard types, optional RankedSubmission.enrichment, cache seed + fixture"
```

---

### Task 2: Hazard module (load + resolve)

**Files:**
- Create: `lib/enrichment/hazard.ts`
- Test: `tests/enrichment.test.ts`

- [ ] **Step 1: Write the failing test `tests/enrichment.test.ts`:**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { hazardKey, hazardForLocation, UNKNOWN_HAZARD } from "../lib/enrichment/hazard";
import { hazardFixture } from "./fixtures/enrichment";

test("hazardKey normalizes state/county to STATE|County", () => {
  assert.equal(hazardKey("ca", " Los Angeles "), "CA|Los Angeles");
  assert.equal(hazardKey(undefined, "X"), undefined);
  assert.equal(hazardKey("CA", undefined), undefined);
});

test("hazardForLocation returns the profile when present", () => {
  const p = hazardForLocation(hazardFixture, "CA", "Los Angeles");
  assert.equal(p.compositeRating, "very high");
  assert.equal(p.topHazards[0].type, "Wildfire");
});

test("hazardForLocation returns UNKNOWN_HAZARD when missing", () => {
  const p = hazardForLocation(hazardFixture, "TX", "Nowhere");
  assert.equal(p.compositeRating, "unknown");
  assert.deepEqual(p.topHazards, []);
  assert.notEqual(p, UNKNOWN_HAZARD, "returns a copy, not the shared constant reference used for mutation safety");
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npx tsx --test tests/enrichment.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/enrichment/hazard.ts`:**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HazardProfile } from "@/lib/domain/types";

export type HazardIndex = Record<string, HazardProfile>;

export const UNKNOWN_HAZARD: HazardProfile = {
  compositeRating: "unknown",
  topHazards: [],
  source: "FEMA NRI",
  asOf: "1970-01-01",
};

/** Canonical lookup key: uppercase state, trimmed county. */
export function hazardKey(state?: string, county?: string): string | undefined {
  const s = state?.trim().toUpperCase();
  const c = county?.trim();
  if (!s || !c) return undefined;
  return `${s}|${c}`;
}

export function loadHazardIndex(rawDir = join(process.cwd(), "raw")): HazardIndex {
  try {
    return JSON.parse(readFileSync(join(rawDir, "enrichment.json"), "utf8")) as HazardIndex;
  } catch {
    return {};
  }
}

export function hazardForLocation(index: HazardIndex, state?: string, county?: string): HazardProfile {
  const key = hazardKey(state, county);
  const hit = key ? index[key] : undefined;
  return hit ? { ...hit } : { ...UNKNOWN_HAZARD };
}
```

- [ ] **Step 4: Run tests, expect pass.** Run: `npx tsx --test tests/enrichment.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/enrichment/hazard.ts tests/enrichment.test.ts
git commit -m "feat(enrichment): hazard index load + resolve with unknown fallback"
```

---

### Task 3: Prep script to pull real FEMA NRI data

**Files:**
- Create: `scripts/fetch-enrichment.ts`
- Modify: `raw/enrichment.json` (regenerated with real ratings)

**Note:** `hazards.fema.gov` was blocked from the original dev sandbox. Run this task where FEMA is reachable. The script must (a) read the 15 unique `(state, county)` pairs from `raw/full_Location.json`, (b) fetch each county's NRI ratings, (c) write `raw/enrichment.json` in the `HazardProfile` shape. Source order to try: FEMA NRI county API, then the NRI county CSV download, then the NRI ArcGIS FeatureServer. If none is reachable, leave the county `"unknown"` — never fabricate ratings.

- [ ] **Step 1: Implement `scripts/fetch-enrichment.ts`:**

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HazardProfile, HazardRating } from "@/lib/domain/types";
import { hazardKey } from "@/lib/enrichment/hazard";

const RATING_BY_LABEL: Record<string, HazardRating> = {
  "Very Low": "very low",
  "Relatively Low": "relatively low",
  "Relatively Moderate": "relatively moderate",
  "Relatively High": "relatively high",
  "Very High": "very high",
};

function locations(): { state: string; county: string }[] {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "raw", "full_Location.json"), "utf8"));
  const rows = raw.output[0].data.results as { state?: string; county?: string }[];
  const seen = new Map<string, { state: string; county: string }>();
  for (const r of rows) {
    const k = hazardKey(r.state, r.county);
    if (k && r.state && r.county) seen.set(k, { state: r.state, county: r.county });
  }
  return [...seen.values()];
}

// NRI county API returns a record with RISK_RATNG (composite) and <HAZARD>_RISKR fields.
async function fetchCounty(state: string, county: string): Promise<HazardProfile> {
  const asOf = new Date().toISOString().slice(0, 10);
  const url = `https://hazards.fema.gov/nri/api/v1/counties?state=${encodeURIComponent(state)}&county=${encodeURIComponent(county)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`NRI ${res.status}`);
  const body = (await res.json()) as { features?: { properties: Record<string, unknown> }[] };
  const props = body.features?.[0]?.properties ?? {};
  const composite = RATING_BY_LABEL[String(props.RISK_RATNG)] ?? "unknown";
  const hazards: { type: string; rating: HazardRating }[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (k.endsWith("_RISKR") && typeof v === "string" && RATING_BY_LABEL[v]) {
      hazards.push({ type: k.replace("_RISKR", ""), rating: RATING_BY_LABEL[v] });
    }
  }
  const order: HazardRating[] = ["very high", "relatively high", "relatively moderate", "relatively low", "very low"];
  hazards.sort((a, b) => order.indexOf(a.rating) - order.indexOf(b.rating));
  return {
    compositeRating: composite,
    compositeScore: typeof props.RISK_SCORE === "number" ? props.RISK_SCORE : undefined,
    topHazards: hazards.filter((h) => h.rating === "very high" || h.rating === "relatively high").slice(0, 4),
    source: "FEMA NRI",
    asOf,
  };
}

async function main() {
  const out: Record<string, HazardProfile> = {};
  for (const { state, county } of locations()) {
    const key = hazardKey(state, county)!;
    try {
      out[key] = await fetchCounty(state, county);
      console.log(`ok  ${key} -> ${out[key].compositeRating}`);
    } catch (e) {
      out[key] = { compositeRating: "unknown", topHazards: [], source: "FEMA NRI", asOf: new Date().toISOString().slice(0, 10) };
      console.warn(`skip ${key}: ${(e as Error).message}`);
    }
  }
  writeFileSync(join(process.cwd(), "raw", "enrichment.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote raw/enrichment.json (${Object.keys(out).length} counties)`);
}

void main();
```

- [ ] **Step 2: Run it** (on a FEMA-reachable network). Run: `npx tsx scripts/fetch-enrichment.ts` — Expected: 15 lines, real ratings for reachable counties. If the NRI host/path differs, adjust `fetchCounty` to the working endpoint discovered in this step and re-run; the rest of the plan is unaffected because it consumes `raw/enrichment.json`.

- [ ] **Step 3: Sanity-check the output.** Run: `python3 -c "import json;d=json.load(open('raw/enrichment.json'));print(len(d));print({k:v['compositeRating'] for k,v in list(d.items())[:5]})"` — Expected: 15 entries; real ratings (not all `"unknown"`).

- [ ] **Step 4: Commit.**

```bash
git add scripts/fetch-enrichment.ts raw/enrichment.json
git commit -m "feat(enrichment): FEMA NRI prep script + real county cache"
```

---

### Task 4: Attach enrichment to submissions in the offline pipeline

**Files:**
- Modify: `lib/federato/offline-data.ts` (emit a per-submission hazard map)
- Modify: `lib/rankings/pipeline.ts` (attach `enrichment` after ranking, offline branch only)
- Test: `tests/enrichment-attach.test.ts`

- [ ] **Step 1: Write the failing test `tests/enrichment-attach.test.ts`:**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { loadOfflineEnrichment } from "../lib/federato/offline-data";

test("loadOfflineEnrichment maps every submission id to a HazardProfile", async () => {
  const map = await loadOfflineEnrichment();
  assert.ok(map.size >= 150, `expected ~158 entries, got ${map.size}`);
  // Submission 1 (Harbor Point) primary location is FL|Hillsborough.
  const p = map.get("SUB-2025-00001");
  assert.ok(p, "submission 1 has an enrichment profile");
  assert.equal(p!.source, "FEMA NRI");
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npx tsx --test tests/enrichment-attach.test.ts` — Expected: FAIL (`loadOfflineEnrichment` not exported).

- [ ] **Step 3: Add `loadOfflineEnrichment` to `lib/federato/offline-data.ts`.** Reuse the file's existing raw-loading + join helpers. Add, keyed by the same canonical id the file already produces (`submission_number || id`), using the primary risk location (largest summed building TIV; fall back to the insured HQ location):

```ts
import { hazardForLocation, loadHazardIndex } from "@/lib/enrichment/hazard";
import type { HazardProfile } from "@/lib/domain/types";

// Returns canonicalSubmissionId -> HazardProfile for the primary risk location.
export async function loadOfflineEnrichment(): Promise<Map<string, HazardProfile>> {
  const index = loadHazardIndex();
  const { submissionsById, primaryLocationFor } = await loadOfflineJoin(); // existing/refactored join accessor
  const out = new Map<string, HazardProfile>();
  for (const [canonicalId, sub] of submissionsById) {
    const loc = primaryLocationFor(sub);
    out.set(canonicalId, hazardForLocation(index, loc?.state, loc?.county));
  }
  return out;
}
```

If the current file does not already expose `submissionsById` / `primaryLocationFor`, extract the existing per-submission join + primary-location selection (largest-TIV risk location) into small named helpers and reuse them here — do not duplicate the join logic. Keep `loadOfflineSubmissions()`'s signature and behavior unchanged.

- [ ] **Step 4: Attach in `lib/rankings/pipeline.ts` offline branch.** In `defaultPipelineDeps()` add an optional dep `loadEnrichment?: () => Promise<Map<string, HazardProfile>>` wired to `loadOfflineEnrichment`. In `buildRankings`, in the offline branch only, after ranking:

```ts
if (deps.loadEnrichment) {
  const hazards = await deps.loadEnrichment();
  for (const s of ranked) {
    const h = hazards.get(s.id);
    if (h) s.enrichment = h;
  }
}
```

Do not change the demo or live branches. Do not change `buildRankings`/`defaultPipelineDeps` names or the demo/live return shapes.

- [ ] **Step 5: Run tests, expect pass.** Run: `npx tsx --test tests/enrichment-attach.test.ts` — Expected: PASS. Then `npm test` — Expected: all prior tests still green.

- [ ] **Step 6: Commit.**

```bash
git add lib/federato/offline-data.ts lib/rankings/pipeline.ts tests/enrichment-attach.test.ts
git commit -m "feat(enrichment): attach primary-location hazard to ranked submissions (offline)"
```

---

### Task 5: Surface enrichment in the UI

**Files:**
- Create: `components/external-risk/external-risk.tsx`
- Create: `components/external-risk/external-risk.css`
- Create: `components/external-risk/index.ts`
- Modify: `components/dashboard/submission-detail.tsx` (render the panel)
- Modify: `components/dashboard/queue-table.tsx` (compact badge)
- Modify: `app/globals.css` (import the stylesheet)
- Test: `tests/external-risk.test.ts`

- [ ] **Step 1: Write the failing render test `tests/external-risk.test.ts`:**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExternalRisk } from "../components/external-risk/external-risk";
import type { HazardProfile } from "../lib/domain/types";

const profile: HazardProfile = {
  compositeRating: "very high",
  topHazards: [{ type: "Wildfire", rating: "very high" }],
  source: "FEMA NRI",
  asOf: "2026-09-19",
};

test("renders composite rating, top hazard, and source label", () => {
  const html = renderToStaticMarkup(createElement(ExternalRisk, { profile }));
  assert.match(html, /Very high/i);
  assert.match(html, /Wildfire/);
  assert.match(html, /FEMA National Risk Index/);
});

test("renders nothing meaningful for unknown", () => {
  const html = renderToStaticMarkup(createElement(ExternalRisk, { profile: { compositeRating: "unknown", topHazards: [], source: "FEMA NRI", asOf: "1970-01-01" } }));
  assert.match(html, /No external hazard data/i);
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npx tsx --test tests/external-risk.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `components/external-risk/external-risk.tsx`** (server-renderable, no CSS import; class prefix `xr-`):

```tsx
import type { HazardProfile } from "@/lib/domain/types";

export function ExternalRisk({ profile }: { profile?: HazardProfile }) {
  if (!profile || profile.compositeRating === "unknown") {
    return (
      <section className="xr" aria-label="External risk">
        <span className="xr-label">External risk · FEMA National Risk Index</span>
        <p className="xr-empty">No external hazard data for this location.</p>
      </section>
    );
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <section className="xr" aria-label="External risk">
      <span className="xr-label">External risk · FEMA National Risk Index</span>
      <span className={`xr-composite xr-rating-${profile.compositeRating.replace(/\s+/g, "-")}`}>
        {cap(profile.compositeRating)}
      </span>
      <ul className="xr-hazards">
        {profile.topHazards.map((h) => (
          <li key={h.type} className={`xr-hazard xr-rating-${h.rating.replace(/\s+/g, "-")}`}>
            {h.type}: {cap(h.rating)}
          </li>
        ))}
      </ul>
      <small className="xr-note">Outside data — not part of the carrier appetite score.</small>
    </section>
  );
}
```

- [ ] **Step 4: Create `components/external-risk/external-risk.css`** (prefix `xr-`, reuse the globals color vars, e.g. `--red`, `--amber`, `--muted`) and `components/external-risk/index.ts`:

```ts
import "./external-risk.css";
export { ExternalRisk } from "./external-risk";
```

Add to `app/globals.css` (top, next to the other `@import`): `@import "../components/external-risk/external-risk.css";`

- [ ] **Step 5: Render in `components/dashboard/submission-detail.tsx`** — import `{ ExternalRisk } from "@/components/external-risk/external-risk"` and add `<ExternalRisk profile={submission.enrichment} />` after `<FactorBreakdown .../>`. In `components/dashboard/queue-table.tsx`, add a compact inline badge in the primary-reason or a new small cell: `submission.enrichment && submission.enrichment.compositeRating !== "unknown" ? <span className={...}>{topHazard}</span> : null`.

- [ ] **Step 6: Run tests + full suite.** Run: `npx tsx --test tests/external-risk.test.ts` then `npm test` then `npm run build` — Expected: all PASS/succeed.

- [ ] **Step 7: Commit.**

```bash
git add components/external-risk app/globals.css components/dashboard/submission-detail.tsx components/dashboard/queue-table.tsx tests/external-risk.test.ts
git commit -m "feat(enrichment): external-risk panel + queue badge"
```

---

## Phase 2 — Ask-the-queue

### Task 6: Deterministic query tools

**Files:**
- Create: `lib/agent/query-tools.ts`
- Test: `tests/agent-tools.test.ts`

- [ ] **Step 1: Write the failing test `tests/agent-tools.test.ts`:**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import { filterQueue, resolveSubmission } from "../lib/agent/query-tools";
import { allAcceptable, contradictory, fullTarget, multipleFailures } from "./fixtures/domain/submissions";

const ranked = rankSubmissions([fullTarget, allAcceptable, contradictory, multipleFailures]);

test("filterQueue matches structured criteria and counts by status", () => {
  const { matchedIds, counts } = filterQueue(ranked, { submissionType: "new", state: "CA" });
  assert.ok(matchedIds.includes("fx-target"));
  assert.ok(!matchedIds.includes("fx-contradictory"), "renewal excluded by submissionType=new");
  assert.equal(counts.total, matchedIds.length);
});

test("filterQueue applies numeric ranges", () => {
  const { matchedIds } = filterQueue(ranked, { premiumMax: 100000 });
  for (const id of matchedIds) {
    const s = ranked.find((r) => r.id === id)!;
    assert.ok(s.totalPremium === undefined || s.totalPremium <= 100000);
  }
});

test("resolveSubmission finds by id or fuzzy name", () => {
  assert.equal(resolveSubmission(ranked, "fx-target")?.id, "fx-target");
  assert.equal(resolveSubmission(ranked, "target account")?.id, "fx-target");
  assert.equal(resolveSubmission(ranked, "no such account"), undefined);
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npx tsx --test tests/agent-tools.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `lib/agent/query-tools.ts`:**

```ts
import type { AppetiteStatus, HazardRating, RankedSubmission } from "@/lib/domain/types";

export interface QueueFilter {
  lineOfBusiness?: string;
  submissionType?: string;
  state?: string;
  status?: AppetiteStatus;
  scoreMin?: number;
  scoreMax?: number;
  tivMin?: number;
  tivMax?: number;
  premiumMin?: number;
  premiumMax?: number;
  buildingYearMin?: number;
  buildingYearMax?: number;
  hazardMin?: HazardRating;
}

export interface StatusCounts {
  total: number;
  in_appetite: number;
  needs_investigation: number;
  out_of_appetite: number;
}

const HAZARD_ORDER: HazardRating[] = ["unknown", "very low", "relatively low", "relatively moderate", "relatively high", "very high"];
const includesCI = (a: string | undefined, b: string) => (a ?? "").toLowerCase().includes(b.toLowerCase());

function matches(s: RankedSubmission, f: QueueFilter): boolean {
  if (f.lineOfBusiness && !includesCI(s.lineOfBusiness, f.lineOfBusiness)) return false;
  if (f.submissionType && !includesCI(s.submissionType, f.submissionType)) return false;
  if (f.state && (s.primaryRiskState ?? "").toUpperCase() !== f.state.toUpperCase()) return false;
  if (f.status && s.status !== f.status) return false;
  if (f.scoreMin !== undefined && s.score < f.scoreMin) return false;
  if (f.scoreMax !== undefined && s.score > f.scoreMax) return false;
  if (f.tivMin !== undefined && !(s.tiv !== undefined && s.tiv >= f.tivMin)) return false;
  if (f.tivMax !== undefined && !(s.tiv !== undefined && s.tiv <= f.tivMax)) return false;
  if (f.premiumMin !== undefined && !(s.totalPremium !== undefined && s.totalPremium >= f.premiumMin)) return false;
  if (f.premiumMax !== undefined && !(s.totalPremium !== undefined && s.totalPremium <= f.premiumMax)) return false;
  if (f.buildingYearMin !== undefined && !(s.buildingYear !== undefined && s.buildingYear >= f.buildingYearMin)) return false;
  if (f.buildingYearMax !== undefined && !(s.buildingYear !== undefined && s.buildingYear <= f.buildingYearMax)) return false;
  if (f.hazardMin) {
    const r = s.enrichment?.compositeRating ?? "unknown";
    if (HAZARD_ORDER.indexOf(r) < HAZARD_ORDER.indexOf(f.hazardMin)) return false;
  }
  return true;
}

export function filterQueue(subs: RankedSubmission[], criteria: QueueFilter): { matchedIds: string[]; counts: StatusCounts } {
  const hits = subs.filter((s) => matches(s, criteria));
  const counts: StatusCounts = { total: hits.length, in_appetite: 0, needs_investigation: 0, out_of_appetite: 0 };
  for (const s of hits) counts[s.status] += 1;
  return { matchedIds: hits.map((s) => s.id), counts };
}

export function resolveSubmission(subs: RankedSubmission[], nameOrId: string): RankedSubmission | undefined {
  const q = nameOrId.trim().toLowerCase();
  return subs.find((s) => s.id.toLowerCase() === q) ?? subs.find((s) => s.accountName.toLowerCase().includes(q));
}

export function explainSubmission(s: RankedSubmission) {
  return { id: s.id, accountName: s.accountName, status: s.status, score: s.score, factors: s.factors, explanation: s.explanation, enrichment: s.enrichment };
}
```

- [ ] **Step 4: Run tests, expect pass.** Run: `npx tsx --test tests/agent-tools.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/agent/query-tools.ts tests/agent-tools.test.ts
git commit -m "feat(ask): deterministic query tools (filter/resolve/explain)"
```

---

### Task 7: OpenAI transport wrapper

**Files:**
- Create: `lib/agent/openai.ts`
- Test: `tests/openai-wrapper.test.ts`

- [ ] **Step 1: Write the failing test `tests/openai-wrapper.test.ts`** (injected fetch; asserts request shape + no key leak in errors):

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { chatWithTools } from "../lib/agent/openai";

function fakeFetch(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("chatWithTools posts messages + tools and returns the message", async () => {
  const reply = { choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] } }] };
  const msg = await chatWithTools(
    { messages: [{ role: "user", content: "hello" }], tools: [] },
    { apiKey: "sk-test", model: "gpt-4.1", fetchImpl: fakeFetch(200, reply) as unknown as typeof fetch },
  );
  assert.equal(msg.content, "hi");
});

test("errors never contain the api key", async () => {
  await assert.rejects(
    () => chatWithTools({ messages: [], tools: [] }, { apiKey: "sk-secret", model: "gpt-4.1", fetchImpl: fakeFetch(401, { error: { message: "bad" } }) as unknown as typeof fetch }),
    (e: Error) => !/sk-secret/.test(e.message) && /OpenAI/.test(e.message),
  );
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npx tsx --test tests/openai-wrapper.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `lib/agent/openai.ts`:**

```ts
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function chatWithTools(
  req: { messages: ChatMessage[]; tools: ChatTool[] },
  opts: ChatOptions = {},
): Promise<ChatMessage> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI is not configured (OPENAI_API_KEY missing).");
  const model = opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1";
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: req.messages, tools: req.tools, tool_choice: "auto", temperature: 0 }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200).replace(apiKey, "***");
    throw new Error(`OpenAI request failed (${res.status}): ${detail}`);
  }
  const body = (await res.json()) as { choices: { message: ChatMessage }[] };
  return body.choices[0].message;
}
```

- [ ] **Step 4: Run tests, expect pass.** Run: `npx tsx --test tests/openai-wrapper.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/agent/openai.ts tests/openai-wrapper.test.ts
git commit -m "feat(ask): OpenAI chat-with-tools fetch wrapper (injectable, no key leak)"
```

---

### Task 8: Ask orchestrator

**Files:**
- Create: `lib/agent/ask.ts`
- Test: `tests/ask.test.ts`

- [ ] **Step 1: Write the failing test `tests/ask.test.ts`** (inject a fake `chat` that returns a `filterQueue` tool call, then a final sentence):

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import { askQueue } from "../lib/agent/ask";
import type { ChatMessage } from "../lib/agent/openai";
import { allAcceptable, contradictory, fullTarget } from "./fixtures/domain/submissions";

const ranked = rankSubmissions([fullTarget, allAcceptable, contradictory]);

function scriptedChat(steps: ChatMessage[]) {
  let i = 0;
  return async () => steps[i++];
}

test("filter question runs the tool and returns matchedIds + summary", async () => {
  const chat = scriptedChat([
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "filterQueue", arguments: JSON.stringify({ submissionType: "new" }) } }] },
    { role: "assistant", content: "2 match: 1 in appetite, 0 investigate, 1 out." },
  ]);
  const r = await askQueue("show me new business", ranked, { chat });
  assert.equal(r.kind, "filter");
  assert.ok(r.matchedIds && r.matchedIds.length >= 1);
  assert.match(r.answer, /match/);
});

test("no-tool answer is returned as kind none", async () => {
  const chat = scriptedChat([{ role: "assistant", content: "I can only answer questions about the queue." }]);
  const r = await askQueue("what is the weather", ranked, { chat });
  assert.equal(r.kind, "none");
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npx tsx --test tests/ask.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `lib/agent/ask.ts`:**

```ts
import type { QueueFilter } from "@/lib/agent/query-tools";
import { explainSubmission, filterQueue, resolveSubmission } from "@/lib/agent/query-tools";
import { chatWithTools, type ChatMessage, type ChatTool } from "@/lib/agent/openai";
import type { RankedSubmission } from "@/lib/domain/types";

export interface AskResult {
  kind: "filter" | "explain" | "none";
  answer: string;
  filter?: QueueFilter;
  matchedIds?: string[];
}

const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "filterQueue",
      description: "Filter the submission queue by structured criteria. Returns matching submission ids and status counts.",
      parameters: {
        type: "object",
        properties: {
          lineOfBusiness: { type: "string" }, submissionType: { type: "string", enum: ["new", "renewal"] },
          state: { type: "string", description: "2-letter state code" },
          status: { type: "string", enum: ["in_appetite", "needs_investigation", "out_of_appetite"] },
          scoreMin: { type: "number" }, scoreMax: { type: "number" },
          tivMin: { type: "number" }, tivMax: { type: "number" },
          premiumMin: { type: "number" }, premiumMax: { type: "number" },
          buildingYearMin: { type: "number" }, buildingYearMax: { type: "number" },
          hazardMin: { type: "string", enum: ["relatively moderate", "relatively high", "very high"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explainSubmission",
      description: "Get the appetite factors and explanation for one submission by account name or id.",
      parameters: { type: "object", properties: { nameOrId: { type: "string" } }, required: ["nameOrId"] },
    },
  },
];

const SYSTEM =
  "You are an assistant for a commercial-property underwriting queue. Answer ONLY using the tool results. " +
  "Never invent numbers, names, or verdicts. If nothing matches, say so plainly. Keep answers to one or two sentences.";

type ChatFn = (req: { messages: ChatMessage[]; tools: ChatTool[] }) => Promise<ChatMessage>;

export async function askQueue(
  question: string,
  subs: RankedSubmission[],
  opts: { chat?: ChatFn } = {},
): Promise<AskResult> {
  const chat: ChatFn = opts.chat ?? ((req) => chatWithTools(req));
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: question },
  ];
  const first = await chat({ messages, tools: TOOLS });
  const call = first.tool_calls?.[0];
  if (!call) return { kind: "none", answer: first.content ?? "I can only answer questions about the queue." };

  const args = safeParse(call.function.arguments);
  let result: unknown;
  let kind: AskResult["kind"] = "none";
  let filter: QueueFilter | undefined;
  let matchedIds: string[] | undefined;

  if (call.function.name === "filterQueue") {
    kind = "filter";
    filter = args as QueueFilter;
    const r = filterQueue(subs, filter);
    matchedIds = r.matchedIds;
    result = r.counts;
  } else if (call.function.name === "explainSubmission") {
    kind = "explain";
    const found = resolveSubmission(subs, String((args as { nameOrId?: string }).nameOrId ?? ""));
    result = found ? explainSubmission(found) : { error: "not found" };
    if (found) matchedIds = [found.id];
  }

  messages.push(first, {
    role: "tool",
    tool_call_id: call.id,
    content: JSON.stringify(result),
  });
  const final = await chat({ messages, tools: TOOLS });
  return { kind, answer: final.content ?? "", filter, matchedIds };
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
```

- [ ] **Step 4: Run tests, expect pass.** Run: `npx tsx --test tests/ask.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/agent/ask.ts tests/ask.test.ts
git commit -m "feat(ask): grounded tool-calling orchestrator"
```

---

### Task 9: /api/ask route

**Files:**
- Create: `app/api/ask/route.ts`
- Test: `tests/ask-route.test.ts`

- [ ] **Step 1: Write the failing test `tests/ask-route.test.ts`** (demo mode → deterministic submissions; the route must reject blank input):

```ts
import assert from "node:assert/strict";
import test from "node:test";

test("POST /api/ask rejects a blank question with 400", async () => {
  const { POST } = await import("../app/api/ask/route");
  const res = await POST(new Request("http://x/api/ask", { method: "POST", body: JSON.stringify({ question: "  " }) }));
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npx tsx --test tests/ask-route.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `app/api/ask/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { askQueue } from "@/lib/agent/ask";
import { buildRankings, defaultPipelineDeps } from "@/lib/rankings/pipeline";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!question) return NextResponse.json({ error: "Ask a question about the queue." }, { status: 400 });

  try {
    const { submissions } = await buildRankings(defaultPipelineDeps());
    const result = await askQueue(question, submissions);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The assistant is unavailable.";
    return NextResponse.json({ kind: "none", answer: `Couldn't answer that right now: ${message}` }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run tests, expect pass.** Run: `npx tsx --test tests/ask-route.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/api/ask/route.ts tests/ask-route.test.ts
git commit -m "feat(ask): /api/ask route (server-side, key protected)"
```

---

### Task 10: Ask-bar UI + live queue filtering

**Files:**
- Create: `components/ask-queue/ask-bar.tsx`
- Create: `components/ask-queue/ask-bar.css`
- Create: `components/ask-queue/index.ts`
- Modify: `components/rankings-dashboard.tsx` (hold `matchedIds` filter state, render ask-bar)
- Modify: `components/dashboard/dashboard-view.tsx` (accept + apply `matchedIds` to the queue)
- Modify: `app/globals.css` (import ask-bar stylesheet)

- [ ] **Step 1: Implement `components/ask-queue/ask-bar.tsx`** (client component):

```tsx
"use client";
import { useState } from "react";

export interface AskBarProps {
  onResult: (matchedIds: string[] | null) => void;
}

export function AskBar({ onResult }: AskBarProps) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    if (!q.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      const data = (await res.json()) as { answer: string; matchedIds?: string[]; kind: string };
      setAnswer(data.answer);
      onResult(data.kind === "none" ? null : data.matchedIds ?? null);
    } catch {
      setAnswer("Couldn't reach the assistant. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="askbar">
      <input className="askbar-input" placeholder="Ask the queue… e.g. new-business property in CA under $100M"
        value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void ask()} />
      <button type="button" onClick={() => void ask()} disabled={busy}>{busy ? "Asking…" : "Ask"}</button>
      <button type="button" className="askbar-clear" onClick={() => { setQ(""); setAnswer(null); onResult(null); }}>Clear</button>
      {answer ? <p className="askbar-answer">{answer}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/ask-queue/ask-bar.css`** (prefix `askbar-`, reuse globals vars) and `components/ask-queue/index.ts` (`import "./ask-bar.css"; export { AskBar } from "./ask-bar";`). Add `@import "../components/ask-queue/ask-bar.css";` to `app/globals.css`.

- [ ] **Step 3: Wire state in `components/rankings-dashboard.tsx`.** Add `const [matchedIds, setMatchedIds] = useState<string[] | null>(null);`, render `<AskBar onResult={setMatchedIds} />` above `<DashboardView .../>`, and pass `matchedIds` into `DashboardView`.

- [ ] **Step 4: Apply the filter in `components/dashboard/dashboard-view.tsx`.** Accept `matchedIds?: string[] | null`; when non-null, render only submissions whose `id` is in the set (keep ranking order), and show a small "showing N of M — Clear" note. When null, render all.

- [ ] **Step 5: Verify.** Run: `npm run typecheck` then `npm test` then `npm run build` — Expected: all green.

- [ ] **Step 6: Commit.**

```bash
git add components/ask-queue components/rankings-dashboard.tsx components/dashboard/dashboard-view.tsx app/globals.css
git commit -m "feat(ask): ask-bar UI that filters the live queue"
```

---

### Task 11: Config, docs, and end-to-end verification

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`
- Modify: `README.md` (brief usage note)

- [ ] **Step 1: Document env in `.env.example`** (names only, no secret):

```bash
# OpenAI — powers the ask-the-queue natural-language layer. Put the real key in .env.local.
OPENAI_API_KEY=
# Optional model override (default: gpt-4.1)
OPENAI_MODEL=
```

- [ ] **Step 2: Update `CLAUDE.md`.** Replace the "Do not add enrichment APIs or external LLM calls" bullet with two bullets: enrichment is a decision-support layer (FEMA NRI) that does not override appetite; the LLM is a grounded natural-language interface that does not decide appetite. Keep the read-only and human-decides invariants.

- [ ] **Step 3: Full verification.** Run in order: `npm run typecheck`, `npm test`, `npm run build` — Expected: clean / all pass / succeeds.

- [ ] **Step 4: Launch and drive.** Start `npm run dev`, then:
  - Load `/`, confirm the ask-bar renders and the external-risk badge shows on rows with known hazard data.
  - POST `/api/ask` with `{"question":"show me new-business property in CA under $100M"}` and confirm `matchedIds` + a grounded one-line answer.
  - In the browser, type that question and confirm the queue narrows; type "why is Harbor Point out of appetite?" and confirm a grounded explanation.
  - Expand a submission; confirm the "External risk — FEMA National Risk Index" panel renders and is clearly separated from the appetite factors.

- [ ] **Step 5: Commit.**

```bash
git add .env.example CLAUDE.md README.md
git commit -m "docs: document OpenAI env + revise LLM/enrichment scope; usage notes"
```

---

## Self-review checklist (author)
- Spec coverage: enrichment source/cache/module/attach/UI (Tasks 1-5) ✓; ask-the-queue tools/openai/orchestrator/route/UI (Tasks 6-10) ✓; config + CLAUDE.md + verification (Task 11) ✓; contract field (Task 1) ✓; grounding guarantee (Task 8 SYSTEM + tool execution) ✓.
- Types consistent across tasks: `HazardProfile`/`HazardRating` (Task 1) used by hazard module (2), attach (4), tools (6), UI (5); `QueueFilter`/`AskResult`/`ChatMessage`/`ChatTool` defined before use.
- No placeholders: all code blocks are complete; the only deferred item is the exact FEMA NRI endpoint (Task 3), which has a concrete implementation + fallback instructions and does not block Tasks 4-11 (they consume `raw/enrichment.json`/fixtures).
