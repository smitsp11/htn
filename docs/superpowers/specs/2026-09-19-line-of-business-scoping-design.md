# Line-of-business scoping — design

## Problem

The captured Federato snapshot holds 158 submissions across seven lines of
business (property 38, health 36, cgl 21, auto 20, cyber 18, excess 15, lpl 10).
The 2025 appetite guidelines the agent enforces are **commercial property only** —
every rule (TIV bands, construction type, building age, loss history) is a
property concept.

Today the engine runs the property scorer on all 158 submissions.
`evaluateLine()` marks any non-property line as `not_acceptable`, which hard-gates
it to `out_of_appetite`. Two problems follow:

1. A cyber/auto/health policy is graded on TIV bands, building year, and
   construction type — meaningless factors for that line.
2. The 120 non-property submissions land in the same **Out of appetite** bucket as
   genuinely bad *property* risks. An underwriter cannot tell "we evaluated this
   property risk and it fails" from "we do not write this line at all."

This is the naive behaviour a good underwriting agent should avoid. Narrowing the
queue to the line the carrier actually writes is itself underwriter reasoning.

## Goal

Introduce an explicit **out-of-scope** classification for submissions whose line
is not property, so:

- Non-property submissions are never scored on property factors.
- The In appetite / Investigate / Out of appetite counts reflect only the
  property (and unknown-line) working set — so "Out of appetite" means genuinely
  bad property risks.
- Out-of-scope submissions remain visible and explained (never silently dropped),
  in a de-emphasised collapsed section.

## Non-goals

- No per-field "request X from broker" wording on the needs-info path. The
  existing generic `needs_investigation` prompt stays. (Easy to upgrade later.)
- No change to the enrichment layer, ask-the-queue agent, or live Federato path
  beyond their tolerating the new status value.

## Approach

**Chosen: a new `out_of_scope` appetite status** (over a separate `inScope`
boolean or a pipeline-level partition). It is the smallest change, keeps a single
source of truth (status), reuses the existing status-driven UI/summary machinery,
and keeps every consumer iterating one `submissions` array.

## Scope rule (`lib/domain/appetite.ts`)

Decided in `evaluateAppetite()` before the eight factors run:

- Line **missing/empty** → stays in the property pipeline. `lineOfBusiness`
  factor resolves to `unknown` → `needs_investigation`. We do not assume an
  absent line is out of scope.
- Line contains **"property"** (case-insensitive) → full eight-factor evaluation,
  unchanged from today.
- Line is any **other non-empty value** → short-circuit to `out_of_scope`:
  - `factors: []` (no property factors are run)
  - `score: 0`
  - `recommendation: "Out of scope — line not written"`
  - explanation carries a dedicated sentence naming the line.

A small helper (e.g. `classifyScope(lineOfBusiness)` returning
`"property" | "out_of_scope" | "unknown_line"`) centralises the normalisation so
the rule lives in one place.

## Types (`lib/domain/types.ts`)

Add `"out_of_scope"` to the `AppetiteStatus` union. **This is a frozen-contract
change** (CLAUDE.md) and is approved as part of this design. No other contract
field changes.

## Explanation (`lib/domain/explanation.ts`)

- `recommendations["out_of_scope"] = "Out of scope — line not written"`.
- `statusPhrase["out_of_scope"]` reads as an out-of-scope clause, not an appetite
  verdict.
- `buildExplanation` special-cases `out_of_scope`: e.g. *"{Account} is a {line}
  submission. The 2025 appetite guidelines cover commercial property only, so no
  appetite is defined for this line. Recommendation: Out of scope — line not
  written."* It must not emit the eight-factor phrasing (there are no factors).

## Presentation (`lib/rankings/presentation.ts`)

- `statusLabels["out_of_scope"] = "Out of scope"`.
- `QueueSummary` gains an `out_of_scope: number` count; `summarize()` increments
  it via the existing `summary[submission.status] += 1` path (no unresolved
  contribution, since `factors` is empty).
- `primaryReason()` special-cases `out_of_scope` to return the line reason (e.g.
  "Cyber — no property appetite defined"), never the "All eight factors are
  acceptable" fallback.
- `statusOrder["out_of_scope"]` sorts last (after `out_of_appetite`). Ordering is
  mostly cosmetic because the UI partitions these into their own section.

## UI (`components/dashboard/`)

- `dashboard-view.tsx` partitions the visible submissions:
  - `status !== "out_of_scope"` → existing `QueueTable` (unchanged columns).
  - `status === "out_of_scope"` → a new collapsed section below the table.
- New lightweight `OutOfScopeSection` (collapsed `<details>` with the count in the
  `<summary>`, e.g. "Out of scope — 120"), listing **Account · Line · State**
  only. No Score/TIV/Premium columns (meaningless for these lines).
- The ask-bar `matchedIds` filter is applied before partitioning, so filtering
  narrows both the main table and the out-of-scope section.
- The three summary cards are unchanged in markup; their counts now naturally
  exclude out-of-scope submissions.

## Tests

- `tests/appetite.test.ts`: non-property line → `out_of_scope`, `factors: []`,
  `score: 0`, out-of-scope recommendation; property line unchanged; missing line →
  `needs_investigation` (unknown line factor), not out-of-scope.
- `tests/rankings-ui.test.ts`: out-of-scope submissions render in the collapsed
  section with the count, and are absent from the main `QueueTable`.
- Presentation coverage: `summarize()` returns the `out_of_scope` count;
  `primaryReason()` returns the line reason for out-of-scope submissions.

## Ownership

This spans Person 3 (`types.ts`, `appetite.ts`, `explanation.ts`,
`presentation.ts`) and Person 4 (`dashboard-view.tsx`, new section component +
CSS). All four workstreams are merged to `main`; this is post-merge product
iteration directed by the engineer, not a single-person workstream.

## Definition of done

- Non-property submissions classified `out_of_scope`, never scored on property
  factors, and explained.
- Property and unknown-line submissions evaluated exactly as before.
- Collapsed out-of-scope section renders with a count; out-of-scope rows excluded
  from the main ranked table.
- `npm run typecheck`, `npm test`, `npm run build` all pass.
