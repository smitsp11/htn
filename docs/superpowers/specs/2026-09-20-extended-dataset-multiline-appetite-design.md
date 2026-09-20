# Extended dataset, multi-line appetite, and restored W6/W7/W3 — design

**Date:** 2026-09-20
**Status:** proposed (awaiting spec review)
**Owner:** engineer-directed (contract changes pre-approved by the directing engineer)

## Problem

Two gaps hurt the demo of the read-only underwriting agent:

1. **The flagship lane is empty.** The real 158-record offline snapshot produces
   **zero in-appetite submissions** (max score 67/100). An underwriter opening the
   default "Ready for review" lane sees nothing to review — the product's core pitch
   ("here is what to write") has no positive example.
2. **76% of the queue is "out of scope."** 120 of 158 records are non-property lines
   (health 36, cgl 21, auto 20, cyber 18, excess 15, lpl 10). They are dumped as
   `out_of_scope` **only because the provided appetite PDF covers property alone** — not
   because the data is unscoreable. Every record already carries the same canonical
   fields (submission type, primary risk state, TIV, total premium, building year,
   construction, five-year losses), so the other lines are neglected, not un-scoreable.

Separately, three previously-shipped extensions were **lost in the federanorth UI
overhaul (PRs #14/#15)** and must be restored:

- **W6** — Appetite × Completeness quadrant board (PR #7; logic + UI deleted).
- **W7** — Portfolio overview strip / "Control Tower lite" (PR #8; logic + UI deleted).
- **W3** — Missing-data enrichment waterfall (PR #4; engine orphaned, UI deleted).

## Goals

- A visible, on-stage **Baseline ▸ Extended dataset toggle** that shows an explicit
  before/after: the honest Federato baseline vs. our extended version.
- **Part A — better property data:** ~24 synthetic property submissions, balanced to
  include genuinely in-appetite cases plus edge/boundary/contradiction talking points.
- **Part B — multi-line appetite:** researched, documented appetite guidelines for all
  six other lines so the existing 158 are fully scored in Extended mode.
- Restore **W6**, **W7**, and **W3** into the current federanorth shell, with W3 able to
  re-score on resolution and show a before/after status change.
- All 261 existing tests stay green; every new capability is TDD'd.

## Non-goals

- No change to the Federato API path, Auth0 flow, or live-mode behavior.
- No write-back; the product stays read-only. Human makes the final decision.
- Baseline mode behavior is unchanged, byte-for-byte, from today (regression-guarded).
- Not researching real per-carrier filings; Part B tables are plausible, clearly-labeled
  **synthesized-for-demo** guidelines, honest about provenance.

## Architecture

### The dataset toggle

- `RankingsResponse` gains a `dataset: "baseline" | "extended"` echo and (extended only)
  synthetic flags on rows.
- `GET /api/rankings?dataset=baseline|extended` (default `baseline`, preserving current
  behavior). `buildRankings(deps, { dataset })` threads the mode through the pipeline.
- Header UI: a segmented control **`Dataset: Federato baseline ▸ Extended`** in the
  queue toolbar. `AppShell` holds `dataset` state, refetches on change, and surfaces a
  one-line caption of what Extended adds. No page reload.

### Part A — synthetic property submissions (~24)

- Authored as **canonical-level records** (`lib/demo/synthetic-property.ts`) returning
  `CanonicalSubmission[]`, merged into the pipeline **only in extended mode**, each
  flagged `synthetic: true` so the UI can label "our version." They run through the
  identical scoring → ranking → explanation engine as the real snapshot (this is what
  "the same engine scored them" means; we are not authoring verdicts).
- Distribution (balanced for talking points):
  - **In-appetite (several):** new-business property, target state, TIV/premium in target
    band, post-2010 building, >50% approved construction, losses < $100K → fill the
    "Ready for review" lane.
  - **Needs-evidence:** one or more required fields missing → chase / W3 / W8 targets.
  - **Boundary cases:** exactly 1990 building, exactly $150M TIV, exactly 50/50
    construction, exactly $100K losses — exercise the documented "unknown" handling.
  - **Contradictions:** strong on most factors, one hard-gate failure.
  - **Multi-location:** primary state and construction share derived by TIV weighting,
    with the derivation shown.
- Deterministic and stable (fixed ids `SUB-SYN-0001…`, no randomness).

### Part B — multi-line appetite registry (the research job)

- Refactor `lib/domain/appetite.ts` into a **line-of-business registry**:
  `APPETITE_TABLES: Record<LineOfBusiness, AppetiteTable>`.
- **Property table = today's exact logic, unchanged** — extracted verbatim, guarded by
  the existing appetite tests (no behavioral drift in baseline).
- Six new researched tables — **auto, cgl, cyber, excess, health, lpl** — each defining
  which factors apply and their acceptable/target/not-acceptable bands over the shared
  available fields (submission type, primary risk state, premium band, exposure/TIV,
  five-year losses, effective window; building year/construction only where the line
  cares). Each table carries a short documented rationale and a
  `provenance: "provided-pdf" | "synthesized-for-demo"` marker.
- `classifyScope` / `evaluate` become **mode-aware and line-aware**:
  - Baseline: only `property` is in-scope; all other lines → `out_of_scope` (unchanged).
  - Extended: any line with a registered table is in-scope and fully scored.
- The **methodology dialog** becomes line-aware, rendering the active line's table and
  its provenance marker.

### Contract changes (deliberate, engineer-approved)

- `lib/domain/types.ts`:
  - Extend `FactorKey` with any non-property factor keys a line needs (most factors are
    shared and reused).
  - Add optional `synthetic?: boolean` to `RankedSubmission`.
  - Add a `LineOfBusiness` union and an `AppetiteTable` type for the registry.
- These are the only frozen-contract edits; they are additive and baseline-safe.

### Phase 2 — restore W6 and W7

- Recover `lib/rankings/quadrant.ts` and `lib/rankings/portfolio.ts` near-verbatim from
  PRs #7/#8 (they depend only on the still-frozen `RankedSubmission` + `completeness.ts`).
- **W6 UI:** a **List ▸ Quadrant** view toggle on the queue; the quadrant board
  (work-now / worth-the-effort / selective / deprioritize) rebuilt to match the
  federanorth aesthetic. Out-of-scope lines stay off the board.
- **W7 UI:** a portfolio strip band above the queue — total TIV, in-appetite TIV, top
  state concentrations, hazard exposure — and how the selected case shifts them. Both
  populate meaningfully once Extended data exists (hence data-first ordering).

### Phase 3 — rewire W3 with before/after

- Reconnect `lib/enrichment/resolve-submission.ts` (waterfall + provenance) into the
  case flow. Resolving a missing required field **re-runs the deterministic engine**;
  the case shows **status before → after** and per-field provenance chips
  (`value · source · confidence · as-of`).
- Restore the resolution-chips UI (`components/enrichment-resolution/*` equivalent) into
  the current case view. Keep the honest-empty-chain behavior (every unresolved gap →
  "Request from broker").
- Guardrail: re-scoring is the deterministic engine acting on a now-present documented
  field, not enrichment inventing a verdict; FEMA/public context remain non-authoritative.

## Data flow

```
dataset=baseline  → real snapshot (158) → property-only appetite → rank → explain
dataset=extended  → real snapshot (158) + synthetic property (~24)
                     → multi-line appetite (7 tables) → rank → explain
                     → [case] W3 resolve missing field → re-score → before/after
```

## Error handling

- Unknown `dataset` param → default to `baseline`.
- A line with no registered table in extended mode → `out_of_scope` with a clear reason
  (never a crash).
- Synthetic loader failure → extended mode degrades to "real records, multi-line
  appetite" rather than failing the queue.
- Existing missing-file / missing-field graceful degradation is preserved.

## Testing

- **Regression:** existing 261 tests stay green; baseline output is unchanged.
- **Part A:** synthetic set loads only in extended mode; produces ≥N in-appetite; each
  boundary case lands on its documented verdict.
- **Part B:** per-line table unit tests (target/acceptable/not-acceptable/unknown for
  representative inputs); scope is mode-aware.
- **W6/W7:** ported helper tests reinstated; new render tests for the shell UI.
- **W3:** resolve-submission re-score changes status as expected; before/after captured.
- **Live:** browser pass after each phase (engineer drives; screenshots verified).

## Build order

1. **Phase 1 — data** (toggle + Part A + Part B): unblocks live testing and makes the
   restored views look populated.
2. **Phase 2 — W6 + W7.**
3. **Phase 3 — W3 rewire + before/after.**

## Open assumptions (flag if wrong)

- Synthetic property is authored at the canonical level (not full raw-schema JSON).
- Part B guidelines are synthesized-for-demo and labeled as such, not sourced from real
  carrier filings.
- The Baseline ▸ Extended toggle bundles **both** Part A and Part B (one before/after),
  rather than exposing them as two separate toggles.
