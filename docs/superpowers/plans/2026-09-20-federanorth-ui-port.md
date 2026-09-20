# Federanorth UI Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace main's presentation layer with Federato's `federanorth` visual identity and layout (hero + queue workspace + full-screen case view), wired to main's existing engine, with deferred backend features built as static-fixture / localStorage-persisted demo mocks.

**Architecture:** Theme-first rebuild in place (spec approach A). Keep main's engine (`lib/domain` frozen contracts, `lib/rankings/*`, `lib/enrichment`, `app/api/*`) and rebuild `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, and `components/*` as federanorth-styled React components. Real data from `/api/rankings` + `/api/ask`; deferred panels use static fixtures; decision/evidence writes persist to `localStorage` (demo-only, product stays read-only at the API).

**Tech Stack:** Next.js 16, React 19, TypeScript (strict), plain global + per-component CSS (no CSS modules/Tailwind), `tsx --test` with `react-dom/server` `renderToStaticMarkup` for component tests.

**Design spec:** `docs/superpowers/specs/2026-09-20-federanorth-ui-port-design.md`
**Design source of truth (CSS/markup/SVG to port verbatim then adapt):** branch `origin/federanorth`, read with `git show origin/federanorth:<path>`.

---

## Conventions (read once before starting)

- **Path alias:** `@/` → repo root (e.g. `@/lib/domain/types`).
- **CSS import rule (critical):** component `.tsx` files MUST NOT `import "./x.css"` — that breaks `tsx --test`. CSS is loaded one of two ways, matching main today: (a) `@import` at the top of `app/globals.css`, or (b) a package `index.ts` that does `import "./x.css"` and re-exports. New per-component CSS in this plan is wired via `@import` in `globals.css`.
- **Component test pattern:** `renderToStaticMarkup(createElement(Component, props))` then regex-assert on the HTML string. See `tests/rankings-ui.test.ts` and `tests/queue-flags-ui.test.ts` for the exact idiom.
- **Client components:** anything using `useState`/`useEffect`/`onClick`/`localStorage` needs `"use client"` at the top. Server-rendered tests still work on client components via `renderToStaticMarkup` (event handlers are inert in the string output — assert on structure/text, not behavior).
- **Commit after every task.** Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Phase gate:** after each phase, `npm run typecheck && npm test && npm run build` must pass.

---

## File structure (created / modified)

**New — demo data + mapping layer**
- `lib/rankings/lanes.ts` — status→lane mapping + labels (additive; not a frozen contract).
- `lib/demo/types.ts` — demo-only types (decision, evidence, fixtures).
- `lib/demo/decision-store.ts` — localStorage-backed decision/evidence/request-state store + validation.
- `lib/demo/fixtures.ts` — static fixtures (leads, signals, pricing, research notes, intake proposals).

**New — UI primitives** (`components/ui/`)
- `icon.tsx`, `badge.tsx`, `flag-chips.tsx`, `lane-badge.tsx`, `tabs.tsx`, `track.tsx`, `dialog.tsx`, `toast.tsx`, `ui.css`.

**New — shell** (`components/shell/`)
- `site-shell.tsx`, `hero.tsx`, `shell.css`.

**New — queue** (`components/queue/`)
- `queue-workspace.tsx`, `queue-table.tsx`, `scope-switch.tsx`, `lane-tabs.tsx`, `queue-filters.tsx`, `pagination.tsx`, `search-bar.tsx` (wraps main's `/api/ask`), `queue.css`.

**New — case** (`components/case/`)
- `case-view.tsx`, `case-bar.tsx`, `case-summary.tsx`, `review-tab.tsx`, `property-tab.tsx`, `account-tab.tsx`, `decision-sidebar.tsx`, `research-panel.tsx`, `task-card.tsx`, `evidence-intake.tsx`, `evidence-request.tsx`, `chase-dialog.tsx`, `methodology-dialog.tsx`, `case.css`.

**New — app-level container**
- `components/app-shell.tsx` — top client component holding rankings fetch + selected-case state, composing shell + queue + case.

**Modified**
- `app/layout.tsx` — metadata/wordmark only.
- `app/page.tsx` — compose `SiteShell` + `AppShell`.
- `app/globals.css` — replace token set + `@import`s.

**Removed (retired after wire-up)**
- `components/rankings-dashboard.tsx`, `components/dashboard/*`, `components/ask-queue/*`, `components/enrichment-resolution/*`, `components/external-risk/*`, `components/factor-breakdown/*`, `components/query-trace/*`, `components/source-status/*`. (Logic they relied on lives in `lib/*` and is reused.)

**New asset**
- `public/federanorth-aerial.png` — copied from `origin/federanorth:assets/federanorth-aerial.png`.

**New tests**
- `tests/demo-lanes.test.ts`, `tests/demo-decision-store.test.ts`, plus a render test per new component group (added within each task).

---

# Phase 0 — Demo data + mapping layer (pure logic, TDD)

No UI yet. Pure functions, fully unit-tested.

### Task 0.1: Lane mapping

**Files:**
- Create: `lib/rankings/lanes.ts`
- Test: `tests/demo-lanes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/demo-lanes.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { laneForStatus, LANE_LABELS, type Lane } from "../lib/rankings/lanes";

test("maps each appetite status to its lane", () => {
  assert.equal(laneForStatus("in_appetite"), "work-now");
  assert.equal(laneForStatus("needs_investigation"), "chase-evidence");
  assert.equal(laneForStatus("out_of_appetite"), "declined");
  assert.equal(laneForStatus("out_of_scope"), "not-property");
});

test("every lane has a human label", () => {
  const lanes: Lane[] = ["work-now", "chase-evidence", "declined", "not-property"];
  for (const lane of lanes) assert.ok(LANE_LABELS[lane].length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/demo-lanes.test.ts`
Expected: FAIL — cannot find module `../lib/rankings/lanes`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rankings/lanes.ts
import type { AppetiteStatus } from "@/lib/domain/types";

export type Lane = "work-now" | "chase-evidence" | "declined" | "not-property";

export const LANE_LABELS: Record<Lane, string> = {
  "work-now": "Ready for review",
  "chase-evidence": "Needs evidence",
  declined: "Outside appetite",
  "not-property": "Not evaluated",
};

const STATUS_TO_LANE: Record<AppetiteStatus, Lane> = {
  in_appetite: "work-now",
  needs_investigation: "chase-evidence",
  out_of_appetite: "declined",
  out_of_scope: "not-property",
};

export function laneForStatus(status: AppetiteStatus): Lane {
  return STATUS_TO_LANE[status];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/demo-lanes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/lanes.ts tests/demo-lanes.test.ts
git commit -m "feat(rankings): status-to-lane mapping for federanorth queue"
```

### Task 0.2: Demo types

**Files:**
- Create: `lib/demo/types.ts`

- [ ] **Step 1: Write the types** (no test — pure type declarations; verified by consumers/typecheck)

```ts
// lib/demo/types.ts
export type DemoDecisionKind = "approve" | "decline" | "request_info";

export interface DemoDecision {
  submissionId: string;
  kind: DemoDecisionKind;
  author: string;
  rationale?: string;
  premium?: number; // approve only
  terms?: string; // approve only
  decidedAt: string; // ISO timestamp
}

export interface DemoEvidenceEntry {
  submissionId: string;
  source: string;
  note: string;
  addedAt: string; // ISO timestamp
}

export type RequestState = "open" | "sent" | "received" | "waived";

export interface DemoState {
  decisions: Record<string, DemoDecision>; // key: submissionId
  evidence: Record<string, DemoEvidenceEntry[]>; // key: submissionId
  requestStates: Record<string, Record<string, RequestState>>; // submissionId -> requestKey -> state
}

// ---- Static-fixture types (deferred panels) ----
export interface DemoLead {
  kind: string; // e.g. "On this account", "Peer benchmark"
  label: string;
  value: string;
  detail: string;
  caution?: string;
  sources: string[];
}

export interface DemoSignal {
  tone: "positive" | "warning" | "neutral";
  headline: string;
  detail: string;
}

export interface DemoPricingBand {
  label: string; // "Peer-indicated" | "Acceptable band" | "Target band"
  value: string;
}

export interface DemoResearchNote {
  factorLabel: string;
  reading: string;
  verifyNext: string;
  basedOn: string;
}

export interface DemoResearch {
  locationMatch: string;
  femaFloodZone: string; // may be overridden by real HazardProfile when present
  currentWeather: string;
  notes: DemoResearchNote[];
  sources: { label: string; href: string; status: string }[];
}

export interface DemoIntakeProposal {
  factorLabel: string;
  proposedValue: string;
  quote: string;
  citation: string;
}

export interface DemoFixtureBundle {
  leads: DemoLead[];
  signals: DemoSignal[];
  pricing: DemoPricingBand[];
  research: DemoResearch;
  intakeProposals: DemoIntakeProposal[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors introduced).

- [ ] **Step 3: Commit**

```bash
git add lib/demo/types.ts
git commit -m "feat(demo): types for demo decision store and fixtures"
```

### Task 0.3: Decision store validation

**Files:**
- Create: `lib/demo/decision-store.ts`
- Test: `tests/demo-decision-store.test.ts`

- [ ] **Step 1: Write the failing test (validation only)**

```ts
// tests/demo-decision-store.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateDecision } from "../lib/demo/decision-store";

test("approve with author and non-negative premium is valid", () => {
  const r = validateDecision({ kind: "approve", author: "A. Underwriter", premium: 12000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("missing author fails", () => {
  const r = validateDecision({ kind: "approve", author: "", premium: 100 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /author/i);
});

test("decline requires rationale of at least 10 chars", () => {
  const short = validateDecision({ kind: "decline", author: "A", rationale: "too short" });
  assert.equal(short.ok, false);
  assert.match(short.errors.join(" "), /rationale/i);
  const ok = validateDecision({ kind: "decline", author: "A", rationale: "Outside appetite: coastal wind exposure." });
  assert.equal(ok.ok, true);
});

test("request_info requires rationale", () => {
  const r = validateDecision({ kind: "request_info", author: "A" });
  assert.equal(r.ok, false);
});

test("approve with negative premium fails", () => {
  const r = validateDecision({ kind: "approve", author: "A", premium: -5 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /premium/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/demo-decision-store.test.ts`
Expected: FAIL — `validateDecision` not exported.

- [ ] **Step 3: Write validation + store (SSR-safe)**

```ts
// lib/demo/decision-store.ts
"use client";
import type {
  DemoDecision,
  DemoDecisionKind,
  DemoEvidenceEntry,
  DemoState,
  RequestState,
} from "./types";

const KEY = "federanorth.demo.v1";

const EMPTY: DemoState = { decisions: {}, evidence: {}, requestStates: {} };

export interface DecisionInput {
  kind: DemoDecisionKind;
  author: string;
  rationale?: string;
  premium?: number;
}

export function validateDecision(input: DecisionInput): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.author || input.author.trim().length === 0) errors.push("Decided-by author is required.");
  const needsRationale = input.kind === "decline" || input.kind === "request_info";
  if (needsRationale && (input.rationale ?? "").trim().length < 10) {
    errors.push("A rationale of at least 10 characters is required.");
  }
  if (input.kind === "approve") {
    if (input.premium == null || !Number.isFinite(input.premium) || input.premium < 0) {
      errors.push("Premium must be a valid non-negative number.");
    }
  }
  return { ok: errors.length === 0, errors };
}

function read(): DemoState {
  if (typeof window === "undefined") return structuredClone(EMPTY);
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    return { ...structuredClone(EMPTY), ...(JSON.parse(raw) as DemoState) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(state: DemoState): DemoState {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}

export function loadDemoState(): DemoState {
  return read();
}

export function saveDecision(decision: DemoDecision): DemoState {
  const state = read();
  state.decisions[decision.submissionId] = decision;
  return write(state);
}

export function reopenDecision(submissionId: string): DemoState {
  const state = read();
  delete state.decisions[submissionId];
  return write(state);
}

export function addEvidence(entry: DemoEvidenceEntry): DemoState {
  const state = read();
  (state.evidence[entry.submissionId] ??= []).push(entry);
  return write(state);
}

export function setRequestState(submissionId: string, requestKey: string, value: RequestState): DemoState {
  const state = read();
  (state.requestStates[submissionId] ??= {})[requestKey] = value;
  return write(state);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/demo-decision-store.test.ts`
Expected: PASS (5 tests).

> Note: the `read`/`write` localStorage paths are SSR-guarded and exercised only in the browser; the unit tests cover `validateDecision`. This is acceptable for a demo mock.

- [ ] **Step 5: Commit**

```bash
git add lib/demo/decision-store.ts tests/demo-decision-store.test.ts
git commit -m "feat(demo): localStorage decision store with validation"
```

### Task 0.4: Static fixtures

**Files:**
- Create: `lib/demo/fixtures.ts`

- [ ] **Step 1: Implement static fixtures + accessor**

Provide one shared static bundle reused for every submission (spec decision: static fixtures). Keep it self-contained; no imports beyond types.

```ts
// lib/demo/fixtures.ts
import type { DemoFixtureBundle } from "./types";

const BUNDLE: DemoFixtureBundle = {
  leads: [
    {
      kind: "On this account",
      label: "Prior-term relationship",
      value: "3 years bound",
      detail: "Same insured carried commercial property with the carrier through 2024.",
      caution: "Relationship history is context only; it is not part of the property appetite score.",
      sources: ["account:relationship"],
    },
    {
      kind: "Peer benchmark",
      label: "Median TIV for this class/state",
      value: "$18.4M",
      detail: "Across comparable commercial-property submissions in the loaded queue.",
      sources: ["peer:benchmark"],
    },
  ],
  signals: [
    { tone: "warning", headline: "Open claim on account", detail: "One water-damage claim in the last 24 months (all lines)." },
    { tone: "positive", headline: "Broker hit-rate", detail: "This broker's submissions bind above the queue average." },
    { tone: "neutral", headline: "State concentration", detail: "Adds to existing exposure in the primary risk state." },
  ],
  pricing: [
    { label: "Peer-indicated", value: "$14,800" },
    { label: "Acceptable band", value: "$12,000 – $16,500" },
    { label: "Target band", value: "$13,500 – $15,000" },
  ],
  research: {
    locationMatch: "Address verified (Census geocoder).",
    femaFloodZone: "Zone X (moderate-to-low risk)",
    currentWeather: "Clear, 21°C, wind 12 km/h. No active alerts.",
    notes: [
      {
        factorLabel: "Five-year loss value",
        reading: "Loss history is inferred from account-level claims and not confirmed at the property level.",
        verifyNext: "Request a property-specific 5-year loss run from the broker.",
        basedOn: "account claims summary",
      },
    ],
    sources: [
      { label: "FEMA National Risk Index", href: "https://hazards.fema.gov/nri/", status: "Retrieved · unreviewed" },
      { label: "NWS forecast", href: "https://www.weather.gov/", status: "Retrieved · unreviewed" },
    ],
  },
  intakeProposals: [
    {
      factorLabel: "Construction",
      proposedValue: "Masonry non-combustible",
      quote: "\"Exterior walls are concrete block; roof is metal deck on steel joists.\"",
      citation: "broker email · 2026-09-18",
    },
  ],
};

export function fixturesFor(_submissionId: string): DemoFixtureBundle {
  // Static fixtures: same bundle for every submission (spec decision).
  return BUNDLE;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/demo/fixtures.ts
git commit -m "feat(demo): static fixtures for deferred case panels"
```

- [ ] **Phase 0 gate:** `npm run typecheck && npm test && npm run build` → all PASS.

---

# Phase 1 — Theme + UI primitives

### Task 1.1: Port theme tokens into globals.css

**Files:**
- Modify: `app/globals.css` (token block + `@import`s + base element styles)
- Reference: `git show origin/federanorth:src/decision/federanorth.css`

- [ ] **Step 1: Replace the `:root` token block and base styles**

Pull the federanorth CSS and copy its `:root` custom-property block (all `--bg/--surface/--ink/--mint/--orange/--amber/--danger/...` values and legacy aliases, exactly as in §2.1 of the spec) into `app/globals.css`, replacing main's current `:root` block. Copy the federanorth `body`, `button`, focus-outline, and typography base rules (Georgia-serif display via a `.display`/heading rule, system-sans body). Remove main's green radial-gradient body background; use federanorth's `--bg`.

Replace the four existing `@import` lines at the top of `globals.css` with the new per-component sheets that later tasks create:

```css
@import "../components/ui/ui.css";
@import "../components/shell/shell.css";
@import "../components/queue/queue.css";
@import "../components/case/case.css";
```

> These files are created in later tasks. Until they exist the build will fail on the `@import`; create empty placeholder files now so each phase builds:

```bash
mkdir -p components/ui components/shell components/queue components/case
touch components/ui/ui.css components/shell/shell.css components/queue/queue.css components/case/case.css
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (compiles; page still renders old components with new tokens — visually broken is fine at this step).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css components/ui/ui.css components/shell/shell.css components/queue/queue.css components/case/case.css
git commit -m "feat(theme): port federanorth token system into globals.css"
```

### Task 1.2: Icon primitive

**Files:**
- Create: `components/ui/icon.tsx`
- Test: `tests/ui-icon.test.ts`
- Reference: the `paths` icon map in `git show origin/federanorth:src/decision/dashboard.js` (search for the SVG path definitions: grid, inbox, check, shield, search, arrow, chevron, download, clock, building, info, x, filter, menu, ask, globe, copy, alert, book) and the north-star glyph in `git show origin/federanorth:src/decision/federanorth-shell.js`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui-icon.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "../components/ui/icon";

test("renders an svg with the requested icon path", () => {
  const html = renderToStaticMarkup(createElement(Icon, { name: "search" }));
  assert.match(html, /<svg/);
  assert.match(html, /stroke-width="1.6"/);
});

test("renders the north-star brand glyph", () => {
  const html = renderToStaticMarkup(createElement(Icon, { name: "north-star" }));
  assert.match(html, /<svg/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/ui-icon.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `Icon`**

Create a typed `Icon` component. Copy the federanorth path `d` strings into a `PATHS: Record<IconName, string>` map (24×24 viewBox, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.6"`, round caps/joins). Add a `north-star` entry from the shell glyph. Signature:

```tsx
// components/ui/icon.tsx
import type { SVGProps } from "react";

export type IconName =
  | "grid" | "inbox" | "check" | "shield" | "search" | "arrow" | "chevron"
  | "download" | "clock" | "building" | "info" | "x" | "filter" | "menu"
  | "ask" | "globe" | "copy" | "alert" | "book" | "north-star";

const PATHS: Record<IconName, string> = {
  // paste each path d-string from origin/federanorth (dashboard.js paths map + shell glyph)
  // e.g. search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35",
  // ...one entry per IconName above...
  search: "PASTE_FROM_SOURCE",
  north_star: "PASTE_FROM_SOURCE" as never, // placeholder to satisfy the map shape; replace with real keys
} as unknown as Record<IconName, string>;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
```

> Replace the placeholder `PATHS` with the real map: one key per `IconName`, each value the exact `d` string from `origin/federanorth`. Use `strokeWidth={1.6}` (JSX number) so the rendered attribute is `stroke-width="1.6"` — the test asserts this.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/ui-icon.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ui/icon.tsx tests/ui-icon.test.ts
git commit -m "feat(ui): federanorth SVG icon set + north-star glyph"
```

### Task 1.3: Badge, LaneBadge, FlagChips, Track

**Files:**
- Create: `components/ui/badge.tsx`, `components/ui/lane-badge.tsx`, `components/ui/flag-chips.tsx`, `components/ui/track.tsx`
- Modify: `components/ui/ui.css` (add badge/chip/track styles ported from federanorth)
- Test: `tests/ui-badges.test.ts`
- Reference: `federanorth.css` classes `.badge`, `.badge.lane-*`, `.flag-chip`, `.good-order`, `.score-track`/`.line-track`; and `lib/rankings/flags.ts` (`flagSummary`, `reasonsByTone`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui-badges.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "../components/ui/badge";
import { LaneBadge } from "../components/ui/lane-badge";
import { FlagChips } from "../components/ui/flag-chips";
import { Track } from "../components/ui/track";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("badge renders tone class and label", () => {
  const html = renderToStaticMarkup(createElement(Badge, { tone: "mint", children: "In good order" }));
  assert.match(html, /badge/);
  assert.match(html, /In good order/);
});

test("lane badge shows the lane label", () => {
  const html = renderToStaticMarkup(createElement(LaneBadge, { status: "needs_investigation" }));
  assert.match(html, /Needs evidence/);
  assert.match(html, /lane-chase-evidence/);
});

test("flag chips summarise factor tones", () => {
  const [submission] = rankSubmissions([empty]);
  const html = renderToStaticMarkup(createElement(FlagChips, { submission }));
  assert.match(html, /flag-chip/);
});

test("track renders a fill width", () => {
  const html = renderToStaticMarkup(createElement(Track, { value: 72, tone: "mint" }));
  assert.match(html, /width:\s*72%/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/ui-badges.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four components**

`Badge` — `<span className={\`badge \${toneClass}\`}>` with a leading dot `<i/>`; `tone` ∈ `mint|orange|amber|danger|neutral`. `LaneBadge` — uses `laneForStatus` + `LANE_LABELS` from `@/lib/rankings/lanes`, class `lane-<lane>`. `FlagChips` — reuse `flagSummary`/`reasonsByTone` from `@/lib/rankings/flags` to render red/yellow/preferred count chips with `title` tooltips (mirror main's existing `queue-table.tsx` FlagChips logic, restyled with `.flag-chip` classes). `Track` — `<span className="track"><i style={{ width: \`\${value}%\` }} /></span>` with tone class. Port matching CSS into `ui.css` from federanorth.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/ui-badges.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ui/badge.tsx components/ui/lane-badge.tsx components/ui/flag-chips.tsx components/ui/track.tsx components/ui/ui.css tests/ui-badges.test.ts
git commit -m "feat(ui): badge, lane badge, flag chips, track primitives"
```

### Task 1.4: Tabs, Dialog, Toast

**Files:**
- Create: `components/ui/tabs.tsx`, `components/ui/dialog.tsx`, `components/ui/toast.tsx`
- Modify: `components/ui/ui.css`
- Test: `tests/ui-interactive.test.ts`
- Reference: federanorth `.tabs`/tablist markup + `wireCaseTabs` (arrow-key nav) in `dashboard-client.js`; `<dialog>` and `#toast` styles in `federanorth.css`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui-interactive.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Tabs } from "../components/ui/tabs";
import { Dialog } from "../components/ui/dialog";

test("tabs render an ARIA tablist with the active tab selected", () => {
  const html = renderToStaticMarkup(
    createElement(Tabs, {
      tabs: [
        { id: "a", label: "Review", count: 3 },
        { id: "b", label: "Property" },
      ],
      active: "a",
      onChange: () => {},
    }),
  );
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true"[^>]*>\s*Review/);
  assert.match(html, /3/); // count chip
});

test("closed dialog renders nothing", () => {
  const html = renderToStaticMarkup(
    createElement(Dialog, { open: false, onClose: () => {}, children: "hi" }),
  );
  assert.equal(html, "");
});

test("open dialog renders its children and a backdrop", () => {
  const html = renderToStaticMarkup(
    createElement(Dialog, { open: true, onClose: () => {}, children: "hello world" }),
  );
  assert.match(html, /hello world/);
  assert.match(html, /dialog-backdrop/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/ui-interactive.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`Tabs` (`"use client"`): props `{ tabs: {id,label,count?}[]; active; onChange(id) }`, renders `role="tablist"` with underline-active styling, count chips, and `onKeyDown` arrow/Home/End navigation. `Dialog` (`"use client"`): props `{ open; onClose; children }`; returns `null` when `!open`; when open renders a `.dialog-backdrop` (click → `onClose`) wrapping a `.dialog` panel; add an `Escape` key listener via `useEffect`; lock body scroll while open. `Toast` (`"use client"`): props `{ message; onDone }`; renders a `.toast` pill and auto-dismisses after 3s via `useEffect`/`setTimeout`. Port styles into `ui.css`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/ui-interactive.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ui/tabs.tsx components/ui/dialog.tsx components/ui/toast.tsx components/ui/ui.css tests/ui-interactive.test.ts
git commit -m "feat(ui): tabs, dialog, toast primitives"
```

- [ ] **Phase 1 gate:** `npm run typecheck && npm test && npm run build` → all PASS.

---

# Phase 2 — Shell (header + hero + footer)

### Task 2.1: Add the aerial asset

**Files:**
- Create: `public/federanorth-aerial.png`

- [ ] **Step 1: Copy the asset out of the branch**

```bash
mkdir -p public
git show origin/federanorth:assets/federanorth-aerial.png > public/federanorth-aerial.png
```

- [ ] **Step 2: Verify it is a valid PNG (~3.5MB)**

Run: `file public/federanorth-aerial.png && du -h public/federanorth-aerial.png`
Expected: `PNG image data`, size ~3.4–3.6M.

- [ ] **Step 3: Commit**

```bash
git add public/federanorth-aerial.png
git commit -m "feat(shell): add federanorth aerial hero asset"
```

### Task 2.2: Site header, hero, footer

**Files:**
- Create: `components/shell/site-shell.tsx`, `components/shell/hero.tsx`
- Modify: `components/shell/shell.css`
- Test: `tests/shell.test.ts`
- Reference: `git show origin/federanorth:src/decision/federanorth-shell.js` (header markup, hero markup, route/grid SVG overlay, coordinate labels, CTA) and the `.hero`/`.site-header`/`.site-footer` blocks in `federanorth.css`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shell.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteShell } from "../components/shell/site-shell";
import { Hero } from "../components/shell/hero";

test("header renders the Federanorth wordmark", () => {
  const html = renderToStaticMarkup(createElement(SiteShell, { children: "content" }));
  assert.match(html, /FEDERANORTH/);
  assert.match(html, /content/);
});

test("hero renders the headline, CTA, and aerial image", () => {
  const html = renderToStaticMarkup(createElement(Hero, {}));
  assert.match(html, /A clearer view/);
  assert.match(html, /Explore your queue/);
  assert.match(html, /federanorth-aerial\.png/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/shell.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`SiteShell` — sticky header (north-star `Icon` + `FEDERANORTH` wordmark, skip link) wrapping `{children}` and a site footer ("A clearer view of risk."). `Hero` — port the federanorth hero: two-column grid, serif headline "A clearer view. / A better way / to underwrite.", subhead, seafoam CTA `Explore your queue →` (an anchor to `#queue`), and the right-half visual: `<img src="/federanorth-aerial.png" alt="" />` with the dark gradient shade, the dashed route-overlay `<svg>`, map-grid hairlines, coral map-star, and coordinate labels. Convert the base64-inline image to the `public/` URL. Port hero/header/footer CSS into `shell.css`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/shell.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/shell/site-shell.tsx components/shell/hero.tsx components/shell/shell.css tests/shell.test.ts
git commit -m "feat(shell): federanorth site header, hero, and footer"
```

- [ ] **Phase 2 gate:** `npm run typecheck && npm test && npm run build` → all PASS.

---

# Phase 3 — Queue workspace

### Task 3.1: Queue table

**Files:**
- Create: `components/queue/queue-table.tsx`
- Modify: `components/queue/queue.css`
- Test: `tests/queue-table.test.ts`
- Reference: federanorth `.queue-table` markup in `dashboard.js` and `RankedSubmission` in `lib/domain/types.ts`; reuse `primaryReason`/`statusLabels` from `@/lib/rankings/presentation`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/queue-table.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueTable } from "../components/queue/queue-table";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("renders one row per submission with lane badge, score, and premium", () => {
  const submissions = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(
    createElement(QueueTable, { submissions, onOpen: () => {} }),
  );
  assert.match(html, /queue-table/);
  const rows = html.match(/data-row-id=/g) ?? [];
  assert.equal(rows.length, submissions.length);
  assert.match(html, /lane-/); // lane badge present
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/queue-table.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`QueueTable` props `{ submissions: RankedSubmission[]; onOpen(id: string): void }`. Columns (federanorth): Account/submission · Coverage (lineOfBusiness) · Effective · Premium (`Intl.NumberFormat` USD) · Property appetite (`LaneBadge` + `Track` score) · Next step (`primaryReason`) · open chevron (`Icon name="chevron"`). Each `<tr data-row-id={s.id}>` calls `onOpen(s.id)`. Port `.queue-table` CSS into `queue.css`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/queue-table.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/queue/queue-table.tsx components/queue/queue.css tests/queue-table.test.ts
git commit -m "feat(queue): federanorth queue table"
```

### Task 3.2: Scope switch, lane tabs, filters, pagination (controls)

**Files:**
- Create: `components/queue/scope-switch.tsx`, `components/queue/lane-tabs.tsx`, `components/queue/queue-filters.tsx`, `components/queue/pagination.tsx`
- Modify: `components/queue/queue.css`
- Test: `tests/queue-controls.test.ts`
- Reference: federanorth `.scope-switch`, `#property-lanes`, `.queue-filters`, table footer in `dashboard.js`; filter/sort/paginate logic in `dashboard-client.js` `render()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/queue-controls.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScopeSwitch } from "../components/queue/scope-switch";
import { LaneTabs } from "../components/queue/lane-tabs";
import { Pagination } from "../components/queue/pagination";

test("scope switch marks the active scope", () => {
  const html = renderToStaticMarkup(
    createElement(ScopeSwitch, { value: "property", onChange: () => {} }),
  );
  assert.match(html, /Commercial property/);
  assert.match(html, /aria-pressed="true"/);
});

test("lane tabs render counts per lane", () => {
  const html = renderToStaticMarkup(
    createElement(LaneTabs, {
      counts: { "work-now": 4, "chase-evidence": 2, declined: 1, "not-property": 0 },
      active: "work-now",
      onChange: () => {},
    }),
  );
  assert.match(html, /Ready for review/);
  assert.match(html, /Needs evidence/);
});

test("pagination shows the page label", () => {
  const html = renderToStaticMarkup(
    createElement(Pagination, { page: 1, pageCount: 3, pageSize: 10, total: 25, onPage: () => {}, onPageSize: () => {} }),
  );
  assert.match(html, /1[^0-9]+3/); // "1 / 3" style label
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/queue-controls.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four controls**

`ScopeSwitch` — three underline buttons (Commercial property / Other lines / All submissions) with `aria-pressed`. `LaneTabs` — `Tabs`-style lane tabs with count chips, one per lane from `LANE_LABELS`. `QueueFilters` — source-status select (Active / Bound-closed history / All), sort select (Review priority / Appetite fit / Premium / Account name), Clear filters button. `Pagination` — rows-per-page select (10/15/25/50), page label, prev/next `Icon` buttons. All are controlled (value + on\* callbacks). Port CSS.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/queue-controls.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/queue/scope-switch.tsx components/queue/lane-tabs.tsx components/queue/queue-filters.tsx components/queue/pagination.tsx components/queue/queue.css tests/queue-controls.test.ts
git commit -m "feat(queue): scope switch, lane tabs, filters, pagination"
```

### Task 3.3: Search bar (LLM ask-bar, restyled)

**Files:**
- Create: `components/queue/search-bar.tsx`
- Modify: `components/queue/queue.css`
- Test: `tests/queue-search.test.ts`
- Reference: main's `components/ask-queue/ask-bar.tsx` (behavior + `/api/ask` contract) and federanorth's bottom-border search with `/` kbd hint.

- [ ] **Step 1: Write the failing test**

```ts
// tests/queue-search.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchBar } from "../components/queue/search-bar";

test("renders a search input with the slash hint", () => {
  const html = renderToStaticMarkup(createElement(SearchBar, { onResult: () => {} }));
  assert.match(html, /<input/);
  assert.match(html, /<kbd[^>]*>\/<\/kbd>/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/queue-search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Port main's `AskBar` logic into `SearchBar` (`"use client"`): props `{ onResult(matchedIds: string[] | null): void }`; local `q`/`answer`/`busy`; `POST /api/ask` `{question:q}` → `{answer, matchedIds?, kind}`; call `onResult(matchedIds ?? null)` (and `onResult(null)` when `kind==="none"` or cleared). Render federanorth's bottom-border search field with an `Icon name="search"`, a `<kbd>/</kbd>` hint, Ask + Clear buttons, and the answer paragraph. Port CSS.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/queue-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/queue/search-bar.tsx components/queue/queue.css tests/queue-search.test.ts
git commit -m "feat(queue): LLM ask-bar restyled as federanorth search"
```

### Task 3.4: Queue workspace container

**Files:**
- Create: `components/queue/queue-workspace.tsx`
- Test: `tests/queue-workspace.test.ts`
- Reference: federanorth `render()` filter→sort→paginate pipeline in `dashboard-client.js`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/queue-workspace.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueWorkspace } from "../components/queue/queue-workspace";
import { rankSubmissions } from "../lib/domain/appetite";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("renders the queue heading and a table of submissions", () => {
  const submissions = rankSubmissions([fullTarget, empty, contradictory]);
  const html = renderToStaticMarkup(
    createElement(QueueWorkspace, { submissions, onOpen: () => {}, matchedIds: null }),
  );
  assert.match(html, /queue-table/);
  assert.match(html, /Commercial property/);
});

test("empty result set shows the empty state", () => {
  const html = renderToStaticMarkup(
    createElement(QueueWorkspace, { submissions: [], onOpen: () => {}, matchedIds: null }),
  );
  assert.match(html, /No submissions match/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/queue-workspace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`QueueWorkspace` (`"use client"`) props `{ submissions: RankedSubmission[]; onOpen(id): void; matchedIds: string[] | null }`. Holds control state (scope, lane, sourceStatus, sort, page, pageSize) with `useState`. Derives the visible set: filter by `matchedIds` (ask-bar), scope (property = `lineOfBusiness` is commercial property; other/all), lane (`laneForStatus`), source status; sort by review-priority/score/premium/account; paginate. Computes lane counts + other-line counts for the tabs. Renders `<section id="queue">` with page heading ("Opportunity, in focus." / "Commercial property"), `SearchBar`? (search is owned by parent — see Task 5.1; here render `ScopeSwitch`, sticky nav with `LaneTabs`, `QueueFilters`, `QueueTable`, empty state, `Pagination`). Empty state: `Icon` + "No submissions match" + reset.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/queue-workspace.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/queue/queue-workspace.tsx tests/queue-workspace.test.ts
git commit -m "feat(queue): queue workspace with filter/sort/paginate"
```

- [ ] **Phase 3 gate:** `npm run typecheck && npm test && npm run build` → all PASS.

---

# Phase 4 — Case view

### Task 4.1: Case bar + summary + shell

**Files:**
- Create: `components/case/case-bar.tsx`, `components/case/case-summary.tsx`, `components/case/case-view.tsx`
- Modify: `components/case/case.css`
- Test: `tests/case-shell.test.ts`
- Reference: federanorth `caseTemplate` (case bar, `.case-summary`, `.case-body`, tabs) in `dashboard.js`; completeness via `@/lib/rankings/completeness`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/case-shell.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaseView } from "../components/case/case-view";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget } from "./fixtures/domain/submissions";

test("case view renders identity, lane badge, score, and tabs", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(
    createElement(CaseView, { submission, onBack: () => {} }),
  );
  assert.match(html, /Back to queue/);
  assert.match(html, new RegExp(submission.accountName));
  assert.match(html, /Review . next steps|Review/);
  assert.match(html, /Property details/);
  assert.match(html, /Account context/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/case-shell.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`CaseBar` — "← Back to queue" (`onBack`), account identity (name + `id · line · status`), right side `LaneBadge` + in-good-order `Badge` (from `completenessOf`) + `FlagChips` + big mint "% factors established" score. `CaseSummary` — next-step headline + chips (% established, gaps, exceptions, flood zone from real `HazardProfile` when present, weather-alert from fixture) + one AI watch item. `CaseView` (`"use client"`) props `{ submission: RankedSubmission; onBack(): void }`: full-viewport container, `CaseBar`, `CaseSummary`, `Tabs` (Review & next steps / Property details / Account context) with local active-tab state, two-column body (`main` + pinned `DecisionSidebar` — sidebar added in Task 4.5). Tab panels are added in 4.2–4.4; stub them as empty `<div>`s for now so the test passes. Port `.case-*` CSS.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/case-shell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/case/case-bar.tsx components/case/case-summary.tsx components/case/case-view.tsx components/case/case.css tests/case-shell.test.ts
git commit -m "feat(case): case bar, summary strip, and tabbed shell"
```

### Task 4.2: Review tab (research + tasks + evidence draft)

**Files:**
- Create: `components/case/review-tab.tsx`, `components/case/research-panel.tsx`, `components/case/task-card.tsx`, `components/case/evidence-request.tsx`, `components/case/evidence-intake.tsx`
- Modify: `components/case/case.css`
- Test: `tests/case-review.test.ts`
- Reference: federanorth `review.js` (`reviewPanel`, `evidenceRequest`), `research-panel.js`, `intake-panel.js`, `leads.js`. Real data: `submission.explanation`, `submission.recommendation`, `completenessOf` (absent/ambiguous → tasks), `submission.enrichment` (FEMA). Fixtures: `fixturesFor(id)` for research notes/weather/leads/intake proposals.

- [ ] **Step 1: Write the failing test**

```ts
// tests/case-review.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewTab } from "../components/case/review-tab";
import { rankSubmissions } from "../lib/domain/appetite";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("review tab shows the recommendation and research digest", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(ReviewTab, { submission }));
  assert.match(html, /NEXT STEP|Next step/i);
  assert.match(html, new RegExp(submission.recommendation.slice(0, 12)));
  assert.match(html, /Research at a glance|flood zone/i);
});

test("submission with gaps renders evidence task cards and a request draft", () => {
  const [submission] = rankSubmissions([empty]);
  const html = renderToStaticMarkup(createElement(ReviewTab, { submission }));
  assert.match(html, /Evidence gap|Needs/i);
  assert.match(html, /Subject: Information needed/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/case-review.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`ResearchPanel` — digest grid (location match / FEMA flood zone [real `enrichment` when present, else fixture] / current weather [fixture]), AI-note `<details>` briefs from `fixturesFor(id).research.notes` (label + "AI context" + reading + "Verify next" + "Based on"), and a sources list (fixture) with external links. `TaskCard` — one card per completeness gap (`absent` → "Confirm …", `ambiguous` → "Decide …") with severity left-border, a `needs` line, "ask of" chips, and task-action buttons ("Mark sent"/"Evidence received"/"Waive") wired to `setRequestState`. `EvidenceRequest` — collapsible textarea pre-filled `Subject: Information needed — {id} / {accountName}` enumerating open gaps, Copy (clipboard + toast) + Rebuild. `EvidenceIntake` — collapsible form (source, date, note, extract → fixture proposals with checkboxes → confirm) that calls `addEvidence`. `ReviewTab` composes: recommendation card (`Icon name="shield"` + "NEXT STEP" + `recommendation`), assessment (`explanation`), leads `<details>` (fixture), `ResearchPanel`, `EvidenceIntake`, `EvidenceRequest`, task list.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/case-review.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/case/review-tab.tsx components/case/research-panel.tsx components/case/task-card.tsx components/case/evidence-request.tsx components/case/evidence-intake.tsx components/case/case.css tests/case-review.test.ts
git commit -m "feat(case): review tab with research, tasks, evidence draft & intake"
```

### Task 4.3: Property details tab

**Files:**
- Create: `components/case/property-tab.tsx`
- Modify: `components/case/case.css`
- Test: `tests/case-property.test.ts`
- Reference: federanorth property-details panel in `dashboard.js`; real `submission.factors` for appetite checks; fixture `pricing` for peer comparison.

- [ ] **Step 1: Write the failing test**

```ts
// tests/case-property.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyTab } from "../components/case/property-tab";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget } from "./fixtures/domain/submissions";

test("property tab lists appetite factor checks and peer pricing", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(PropertyTab, { submission }));
  assert.match(html, /Appetite check|appetite/i);
  const factorRows = html.match(/fb-|factor-row|appetite-check/g) ?? [];
  assert.ok(factorRows.length >= submission.factors.length);
  assert.match(html, /Peer-indicated|Target band/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/case-property.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`PropertyTab` props `{ submission }`: exposure table (TIV, premium, effective/expiration, state), building details (buildingYear, construction), property-loss table (`fiveYearLossValue`) with a coverage `Track`, a collapsible appetite-checks list rendering each `submission.factors[i]` (label, verdict badge, reason, per-factor confidence chip), and peer-pricing comparison from `fixturesFor(id).pricing`. Port CSS.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/case-property.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/case/property-tab.tsx components/case/case.css tests/case-property.test.ts
git commit -m "feat(case): property details tab (real appetite checks + peer pricing)"
```

### Task 4.4: Account context tab

**Files:**
- Create: `components/case/account-tab.tsx`
- Modify: `components/case/case.css`
- Test: `tests/case-account.test.ts`
- Reference: federanorth account-context panel + `casefile.js` `signalsPanel`; fixture `signals`/`leads`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/case-account.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountTab } from "../components/case/account-tab";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget } from "./fixtures/domain/submissions";

test("account tab renders signals and a context-only disclaimer", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(AccountTab, { submission }));
  assert.match(html, /signal/i);
  assert.match(html, /not.*scored|context only/i);
  assert.match(html, new RegExp(submission.id));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/case-account.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`AccountTab` props `{ submission }`: underwriting `signals` (fixture, toned positive/warning/neutral via the `Badge`/dot), relationship / loss-history / broker context cards (fixture `leads`), source-record IDs (real `submission.id`), and a "Context only. None of this is scored." footer. Port CSS.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/case-account.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/case/account-tab.tsx components/case/case.css tests/case-account.test.ts
git commit -m "feat(case): account context tab (signals + relationship fixtures)"
```

### Task 4.5: Decision sidebar (persisted mock)

**Files:**
- Create: `components/case/decision-sidebar.tsx`
- Modify: `components/case/case-view.tsx` (mount the sidebar in the two-column body), `components/case/case.css`
- Test: `tests/case-decision.test.ts`
- Reference: federanorth `workflowPanel` in `casefile.js`; validation + store from `@/lib/demo/decision-store`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/case-decision.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionSidebar } from "../components/case/decision-sidebar";
import { rankSubmissions } from "../lib/domain/appetite";
import { fullTarget } from "./fixtures/domain/submissions";

test("decision sidebar renders the decision choices and a record button", () => {
  const [submission] = rankSubmissions([fullTarget]);
  const html = renderToStaticMarkup(createElement(DecisionSidebar, { submission }));
  assert.match(html, /Approve/);
  assert.match(html, /Decline/);
  assert.match(html, /Request info|Request information/i);
  assert.match(html, /Record decision/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/case-decision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`DecisionSidebar` (`"use client"`) props `{ submission; onDecided?(): void }`: key metrics header, a segmented decision-choice control (Approve / Decline / Request info), pricing sub-block (peer-indicated / acceptable / target from fixture + premium & terms inputs — shown only when Approve), rationale + "Decided by" fields, and a "Record decision" button. On submit: `validateDecision(...)` → show inline errors or `saveDecision(...)` + toast + optional `onDecided()`. On mount, `loadDemoState()` to show any recorded decision (mint "decided" banner + Reopen → `reopenDecision`). Save disabled until choice + author present. Mount it in `CaseView`'s pinned aside. Port CSS.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/case-decision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/case/decision-sidebar.tsx components/case/case-view.tsx components/case/case.css tests/case-decision.test.ts
git commit -m "feat(case): persisted decision sidebar (demo mock)"
```

### Task 4.6: Chase-list + methodology dialogs

**Files:**
- Create: `components/case/chase-dialog.tsx`, `components/case/methodology-dialog.tsx`
- Modify: `components/case/case.css`
- Test: `tests/case-dialogs.test.ts`
- Reference: federanorth `#chase-dialog` and `#method-dialog` markup in `dashboard.js`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/case-dialogs.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MethodologyDialog } from "../components/case/methodology-dialog";

test("methodology dialog renders scoring weights when open", () => {
  const html = renderToStaticMarkup(
    createElement(MethodologyDialog, { open: true, onClose: () => {} }),
  );
  assert.match(html, /scoring|weight/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/case-dialogs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Both built on the `Dialog` primitive. `ChaseDialog` props `{ open; onClose; submissions }` — lists outstanding evidence requests (from `completenessOf` gaps across submissions) grouped by party then account, with "Copy as text". `MethodologyDialog` props `{ open; onClose }` — scoring weight grid, acceptable/cap explanation, interpretations, and data & sources (resource counts). Port CSS.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/case-dialogs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/case/chase-dialog.tsx components/case/methodology-dialog.tsx components/case/case.css tests/case-dialogs.test.ts
git commit -m "feat(case): chase-list and methodology dialogs"
```

- [ ] **Phase 4 gate:** `npm run typecheck && npm test && npm run build` → all PASS.

---

# Phase 5 — Wire-up & cleanup

### Task 5.1: App shell container

**Files:**
- Create: `components/app-shell.tsx`
- Test: `tests/app-shell.test.ts`
- Reference: main's `components/rankings-dashboard.tsx` (fetch + error/loading handling).

- [ ] **Step 1: Write the failing test**

```ts
// tests/app-shell.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "../components/app-shell";

test("initial render shows a loading state before data arrives", () => {
  const html = renderToStaticMarkup(createElement(AppShell, {}));
  assert.match(html, /Evaluating|Loading|queue/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/app-shell.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`AppShell` (`"use client"`): fetch `GET /api/rankings` (`cache:"no-store"`) on mount into `data/error/loading` state (reuse main's error-category handling). State: `selectedId: string | null`, `matchedIds: string[] | null`. Render `SearchBar` (→ `setMatchedIds`), and when a submission is selected render `CaseView` (full-screen overlay) else `QueueWorkspace` (`onOpen: setSelectedId`, pass `matchedIds`). Loading/error/empty states mirror main's copy ("Evaluating the submission queue"). `CaseView`'s `onBack` → `setSelectedId(null)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test tests/app-shell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/app-shell.tsx tests/app-shell.test.ts
git commit -m "feat(app): app shell wiring rankings fetch to queue + case view"
```

### Task 5.2: Rewrite page.tsx and layout.tsx

**Files:**
- Modify: `app/page.tsx`, `app/layout.tsx`

- [ ] **Step 1: Rewrite `app/page.tsx`**

```tsx
// app/page.tsx
import { SiteShell } from "@/components/shell/site-shell";
import { Hero } from "@/components/shell/hero";
import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <SiteShell>
      <Hero />
      <AppShell />
    </SiteShell>
  );
}
```

- [ ] **Step 2: Update `app/layout.tsx` metadata**

Change `metadata.title` to `"Federanorth — Underwriting workspace"` and `description` to `"A clearer view of commercial-property risk."`. Keep `import "./globals.css"`.

- [ ] **Step 3: Verify build + start**

Run: `npm run build`
Expected: PASS.
Run: `npm run dev` and load `http://localhost:3000` — hero renders, "Explore your queue →" scrolls to the queue, rows open the full-screen case view, recording a decision persists across reload. (Manual smoke; stop dev after.)

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/layout.tsx
git commit -m "feat(app): compose federanorth shell, hero, and workspace"
```

### Task 5.3: Retire old components and stale globals imports

**Files:**
- Delete: `components/rankings-dashboard.tsx`, `components/dashboard/`, `components/ask-queue/`, `components/enrichment-resolution/`, `components/external-risk/`, `components/factor-breakdown/`, `components/query-trace/`, `components/source-status/`
- Modify: remove the old `@import` lines from `app/globals.css` (already replaced in Task 1.1; confirm none remain).
- Delete stale tests that import removed components: `tests/rankings-ui.test.ts`, `tests/queue-flags-ui.test.ts`, `tests/completeness-ui.test.ts`, `tests/factor-breakdown.test.ts`, `tests/external-risk.test.ts`, `tests/resolution-chips.test.ts`, `tests/ask-bar-filter.test.ts`. (Keep pure-logic tests: `flags.test.ts`, `completeness.test.ts`, `presentation.test.ts`, `ask.test.ts`, `resolve-submission.test.ts`, and all engine/route tests.)

- [ ] **Step 1: Identify what still imports the old components**

Run: `grep -rl "components/dashboard\|components/ask-queue\|components/factor-breakdown\|components/external-risk\|components/enrichment-resolution\|components/query-trace\|components/source-status\|rankings-dashboard" app components tests`
Expected: only the files listed for deletion above (plus already-migrated `app/page.tsx`, which no longer references them after Task 5.2).

- [ ] **Step 2: Delete old components and their tests**

```bash
git rm -r components/rankings-dashboard.tsx components/dashboard components/ask-queue components/enrichment-resolution components/external-risk components/factor-breakdown components/query-trace components/source-status
git rm tests/rankings-ui.test.ts tests/queue-flags-ui.test.ts tests/completeness-ui.test.ts tests/factor-breakdown.test.ts tests/external-risk.test.ts tests/resolution-chips.test.ts tests/ask-bar-filter.test.ts
```

- [ ] **Step 3: Verify nothing dangling**

Run: `npm run typecheck`
Expected: PASS (no unresolved imports).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: retire legacy dashboard components and their tests"
```

### Task 5.4: Final gate

- [ ] **Step 1: Full verification**

Run: `npm run typecheck && npm test && npm run build`
Expected: all PASS; test count reflects removed UI tests + added federanorth tests.

- [ ] **Step 2: Manual demo smoke (record for handoff)**

Load `npm run dev` → confirm: hero + CTA scroll; queue filters/lanes/scope/pagination; ask-bar filters; open a case; all three tabs render; research digest shows real FEMA when present; record a decision → persists across reload; chase-list + methodology dialogs open.

- [ ] **Step 3: Commit any final fixups; open PR to main**

```bash
git commit --allow-empty -m "chore: federanorth UI port complete"
gh pr create --base main --title "Federanorth UI port (demo)" --body "Ports federanorth's visual identity and layout into main's React app. Engine, frozen contracts, and API unchanged. Deferred backend features are static-fixture / localStorage demo mocks. Spec: docs/superpowers/specs/2026-09-20-federanorth-ui-port-design.md"
```

---

## Self-review notes (author checklist — completed)

- **Spec coverage:** hero-then-queue (Task 2.2, 5.2) · theme port (1.1) · queue workspace w/ lanes/scope/filters/pagination (3.x) · full-screen case view + 3 tabs + decision sidebar (4.x) · LLM ask-bar kept (3.3, 5.1) · real data mapping incl. FEMA (3.1, 4.2, 4.3) · lane/flag mapping (0.1, 1.3) · static fixtures (0.4) · persisted write mock (0.3, 4.5) · dialogs (4.6) · tests + gates (every task + phase gates). All spec sections map to a task.
- **Type consistency:** `Lane` values and `LANE_LABELS` (0.1) reused by `LaneBadge`/`LaneTabs` (1.3/3.2); `DemoDecision`/`validateDecision`/store fns (0.2/0.3) reused by `DecisionSidebar` (4.5); `DemoFixtureBundle`/`fixturesFor` (0.2/0.4) reused across case tabs (4.2–4.4). Component prop names consistent (`onOpen`, `onBack`, `matchedIds`, `submission`).
- **No placeholders** except the intentional "paste exact `d` string / CSS from `origin/federanorth`" sourcing instructions, which are precise (named file + named class/glyph), not vague TODOs.
