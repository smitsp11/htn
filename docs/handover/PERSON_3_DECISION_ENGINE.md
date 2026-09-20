# Person 3 — Underwriting decision engine

## Your mission

Turn canonical submissions into transparent, deterministic underwriting priorities that faithfully reflect the supplied appetite table.

## Read first

- `CLAUDE.md`
- `docs/HANDOVER.md`
- `documents/APPETITE_GUIDELINES.pdf`
- Relevant scoring/explanation sections of `documents/STUDENT_PROJECT_GUIDELINES.pdf`
- `lib/domain/types.ts`
- `lib/domain/appetite.ts`
- `tests/appetite.test.ts`

## Owned code

- `lib/domain/appetite.ts`
- New decision/explanation helpers under `lib/domain/`
- New `components/factor-breakdown/` component and local styles
- `tests/appetite.test.ts`
- New decision fixtures under `tests/fixtures/domain/`

Do not edit the API client, schema adapter, ranking route, dashboard shell, or frozen domain contracts.

## Build

1. Verify all eight appetite evaluators against the PDF table.
2. Keep target, acceptable, not acceptable, and unknown as distinct verdicts.
3. Make the score transparent and ensure appetite status controls priority when a numeric score could mislead.
4. Preserve contradictions rather than averaging them away.
5. Treat missing and unclassified boundaries as visible unknowns unless the engineer approves a business interpretation.
6. Generate concise deterministic explanations: appetite match, material positive/negative factors, and human recommendation.
7. Extract a reusable factor-breakdown component for Person 4 to compose into the shared details view.
8. Add table-driven tests for every threshold, exact boundary, missing value, contradiction, and ordering rule.

## Decisions you own

- Score formula and target bonus.
- Status precedence and hard-gate behavior.
- Boundary policy for exactly 1990, exactly $100K losses, and exact 50/50 construction.
- How contradictions affect status and language.
- Recommendation vocabulary and which reasons appear in the short explanation.

You do not decide API field meanings, aggregation of multiple raw records, transport behavior, or page layout.

## Interface promised to others

Given one valid `CanonicalSubmission`, return one stable `RankedSubmission` containing:

- All eight factor evaluations.
- Appetite status.
- Numeric score.
- Short explanation.
- Human recommendation.

The same input must always produce the same result, so the evaluator stays a pure function. Any LLM-generated or enriched data reaches it as part of the input rather than being fetched from inside the evaluator.

## Completion evidence

- Table-driven tests cover every factor's target, acceptable, unacceptable, missing, and boundary cases.
- Tests cover multiple simultaneous contradictions and stable ranking ties.
- Wording never implies an automatic binding decision.
- Typecheck, complete test suite, and production build pass.
- Handoff identifies any business interpretations requiring engineer confirmation.
