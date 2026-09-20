# Federanorth UI Port — Design

**Date:** 2026-09-20
**Status:** Approved (design); pending implementation plan
**Author:** Engineer-directed (demo build)

## Goal

Replace the current `main` presentation layer with Federato's `federanorth`
visual identity and layout, ported into main's Next.js 16 / React 19 / TypeScript
app. main's engine (data, scoring, API) stays; only the UI changes. This is a
**demo build**: features that main has no backend for are built with sample data
so the demo tells a complete story.

## Context

- `origin/federanorth` is an **orphan branch** (no shared git history with `main`):
  a vanilla-JS, single-document underwriting-queue app served by a Node http
  server (HTML strings + one CSS file + one client JS file). It is a more complete
  and more polished dashboard than main's single-screen table.
- `main` is a Next.js app: one screen (masthead + queue table + expandable detail
  row), light-green theme, wired to `/api/rankings`, `/api/ask`, and
  `/api/federato/status`. Product mandate (CLAUDE.md) is **read-only**.
- federanorth includes **read-write** features (record decision, evidence intake,
  pricing) and panels main has no data for (leads, signals, peer pricing,
  research digest). Those are the deferred/mocked parts of this port.

## Decisions (locked)

| Question | Decision |
|---|---|
| Entry point | **Hero then queue** — full marketing hero (aerial image + serif headline + CTA) at top; scroll/CTA to the queue workspace below. |
| Write features (decision workflow, evidence intake) | **Interactive mock, persisted** — fully clickable; state persists in `localStorage`; reflected in the queue. No real backend; product stays read-only at the API. Clearly demo-only. |
| Sample data for deferred panels | **Static fixtures** — hardcoded sample values reused across submissions (fastest; acceptable for demo). |
| Queue search | **Keep main's LLM ask-bar** (`/api/ask`) as the queue search affordance. |
| Aerial hero asset | Ship the 3.5 MB `federanorth-aerial.png` **as-is** in `public/`; optimization is a follow-up, not a blocker. |
| Approach | **A — theme-first, rebuild components in place** (one shared UI; keeps main's data flow and frozen contracts). |

## Architecture & boundaries

Replace the **presentation layer only**; keep the **engine**.

- **Untouched (frozen / reused):** `lib/domain` (frozen `CanonicalSubmission` /
  `RankedSubmission`), `lib/rankings/*` (presentation, flags, completeness),
  `lib/enrichment`, all `app/api/*` routes.
- **Rewritten:** `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, and
  `components/*`.
- **New:** `lib/demo/` (fixtures + localStorage decision store), `public/` aerial
  asset.
- Built on the current branch (`fedeeranorth-branch-review`) → PR to `main`.
- This is a deliberate shared-UI overhaul (normally cross-workstream); it is
  engineer-directed and demo-targeted. Frozen contracts are not changed.

## Theme layer

Port federanorth's full identity into `app/globals.css`:

- `:root` token set: `--bg #f7f5f0`, `--surface #ffffff`, `--surface-muted #f1ede3`,
  `--border #e3ddd0`, `--ink #211d17`, `--ink-soft #5c5646`, `--ink-faint #8d8268`,
  `--mint #0e9d63` (+`-strong #0a7c4e`, `-tint #e4f6ec`), `--orange #c8581f`
  (+`-strong #a4471a`, `-tint #fbe9dc`), `--amber #a8720a`/`-tint`, `--danger
  #b23a2c`/`-tint`, plus legacy aliases.
- Hero non-token colors: bg `#2b1f19`, headline `#f4ece0`, subhead `#c9baa5`,
  seafoam CTA `#8bead0`, coral overlays `#ffb98c`.
- Georgia-serif **display** (hero H1, section H2s, stat numbers) over
  system-sans body. Light theme only (`color-scheme: light`).
- Per-component `.css` files beside components, imported through `globals.css` —
  matching main's existing plain-CSS convention (no CSS modules, no Tailwind).

## Component tree (new)

- **Shell** (`components/shell/`) — sticky header (north-star SVG wordmark, skip
  link), **full marketing hero** (aerial PNG from `public/`, route/grid SVG
  overlay, coordinate labels, "Explore your queue →" CTA), site footer.
- **QueueWorkspace** (`components/queue/`) — page heading, scope switch
  (Property / Other lines / All), lane tabs + counts, filter row (source status,
  sort, clear filters), federanorth queue table (Account · Coverage · Effective ·
  Premium · Property appetite · Next step · open chevron), pagination + rows-per-page,
  empty state. Data: `/api/rankings`. Queue search = main's LLM ask-bar (`/api/ask`).
- **CaseView** (`components/case/`, full-screen) — case bar (identity, lane badge,
  in-good-order badge, flag chips, % score), summary strip (next step + chips),
  3 tabs + pinned decision sidebar:
  - *Review & next steps*: recommendation card, assessment, **ResearchPanel**,
    evidence intake, evidence-request draft (copy/rebuild), task list.
  - *Property details*: exposure/building/loss tables, appetite checks (**real**
    factor breakdown), peer pricing (fixture).
  - *Account context*: underwriting signals, relationship / loss-history / broker
    cards (fixture), source-record IDs.
  - *Decision sidebar*: key metrics + workflow (approve / decline / request-info),
    pricing inputs (approve only), rationale, "Record decision".
- **Shared primitives** (`components/ui/`): `Icon` (federanorth SVG set),
  `Badge`, `FlagChips`, `LaneBadge`, `Tabs` (ARIA + arrow-key nav), `Dialog`
  (modal), `Toast`, `Track` (meter bar).
- **Dialogs**: chase-list (outstanding requests grouped by party/account),
  methodology (scoring weights + sources).

React adaptations of federanorth's DOM-native patterns: `<dialog showModal()>` →
React modal, `<details>/<summary>` → controlled disclosure, `<template>` clone →
conditional render, `innerHTML` swaps → state-driven re-render, `dataset`-driven
filter/sort/paginate → derived state, manual `esc()` → JSX auto-escape.

## Data mapping

**Real (from `/api/rankings` → `RankedSubmission`):**
queue rows, `status` → lane, `score`, `factors` (appetite checks / factor
breakdown), `explanation`, `recommendation`, completeness (in-good-order via
`lib/rankings/completeness.ts`), and **FEMA `HazardProfile`** enrichment (feeds
the research digest's flood-zone section).

**Lane map:** `in_appetite` → *Ready for review* · `needs_investigation` →
*Needs evidence* · `out_of_appetite` → *Outside appetite* · `out_of_scope` →
*Not evaluated*. Flag chips reuse `lib/rankings/flags.ts`
(`not_acceptable`→red, `unknown`→yellow, `target`/`acceptable`→preferred).

**Static fixtures (`lib/demo/fixtures.ts`):** leads ("related info we hold"),
underwriting signals, peer pricing bands, weather + AI research notes,
evidence-intake proposals.

## Demo write layer

`lib/demo/decision-store.ts` persists decisions, evidence, and request-state
changes to `localStorage`, keyed by submission id. The queue reads it to reflect
lane / next-step changes; the case view reads it to show recorded decisions.
Ported validation: choice + author required; rationale ≥10 chars on
exception/decline/request-info; premium must be a valid non-negative number.
No server writes — the product stays read-only at the API boundary.

## Testing & completion

- Keep `tsx --test tests/*.test.ts`.
- Add unit tests: `decision-store` (localStorage-mocked) and lane/flag mapping
  helpers.
- Completion gate: `npm run typecheck && npm test && npm run build` all pass.

## Out of scope / follow-ups

- Real backend for decisions, evidence, leads, signals, pricing, weather/AI
  research (deferred — mocked for the demo).
- Aerial PNG optimization (ship as-is now).
- Dark mode.
- Restoring a full-featured version of the currently-orphaned main components
  (`query-trace`, rich `source-status`).
