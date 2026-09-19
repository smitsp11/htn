# Person 2 — Schema-driven query agent

## Your mission

Translate the published appetite requirements into schema-aware data requests and normalize Federato responses into the frozen `CanonicalSubmission` contract.

## Read first

- `CLAUDE.md`
- `docs/HANDOVER.md`
- All three PDFs and `documents/MASTER_RESEARCH.md`
- `lib/federato/adapter.ts`
- `lib/domain/types.ts`

## Owned code

- `lib/federato/adapter.ts`
- New `lib/federato/schema-planner.ts`
- New `lib/federato/query-trace.ts`
- New `components/query-trace/` component and local styles
- `tests/federato-adapter.test.ts`
- `tests/schema-planner.test.ts`
- Schema/query fixtures under `tests/fixtures/federato/`

Do not edit the transport client, appetite evaluator, dashboard shell, or frozen domain contracts.

## Build

1. Parse the discovered schema and identify candidate resources/fields for all required display data and eight appetite factors.
2. Generate the query projection from those requirements rather than hand-writing a query per submission.
3. Use `$elemMatch` for arrays, `$expand` for references, and `where` versus `filter` according to Federato's documented execution order.
4. Normalize real records into `CanonicalSubmission` without leaking raw API shapes downstream.
5. Define deterministic handling for multiple locations, buildings, construction categories, and loss records; document every aggregation choice.
6. Produce a structured trace containing the field requested, appetite reason, schema match, expansion/array behavior, and unresolved fields.
7. Replace the temporary `FEDERATO_QUERY_PAYLOAD_JSON` seam once the real query-body contract is known.
8. Test realistic arrays, references, missing values, malformed records, and schema changes using fixtures.

## Decisions you own

- Which resource represents the queue.
- How each appetite concept maps to schema paths.
- When data requires `$expand`, `$elemMatch`, `where`, or `filter`.
- How repeated records aggregate to one canonical value.
- Whether a missing value triggers a follow-up query or remains unknown.
- Which query trace is valuable to underwriters versus developers.

You do not decide appetite thresholds, scores, recommendations, authentication behavior, or dashboard layout.

## Interface promised to others

Person 3 receives `CanonicalSubmission[]` exactly as defined in `lib/domain/types.ts`.

Person 4 receives a serializable query trace that can be shown in the shared UI without exposing credentials or overwhelming the underwriter.

When the raw API does not cleanly fit the contract, adapt here and report the discrepancy; do not change the shared contract unilaterally.

## Completion evidence

- Every canonical field has a documented schema source or an explicit unresolved state.
- Tests demonstrate correct array/reference behavior and missing-data preservation.
- The planner does not filter out records merely because they are out of appetite.
- Typecheck, complete test suite, and production build pass.
- Handoff includes captured schema assumptions and unresolved API questions.
