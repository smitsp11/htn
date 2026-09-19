# Person 4 — Queue and product integration

## Your mission

Compose the shared underwriter experience and orchestrate the full data-to-decision pipeline without duplicating logic owned by the other workstreams.

## Read first

- `CLAUDE.md`
- `docs/HANDOVER.md`
- Product/output sections of `documents/STUDENT_PROJECT_GUIDELINES.pdf`
- `app/api/rankings/route.ts`
- `components/rankings-dashboard.tsx`
- `app/page.tsx`
- `app/globals.css`
- `lib/domain/types.ts`

## Owned code

- `app/api/rankings/route.ts`
- `app/page.tsx`
- `app/globals.css`
- `components/rankings-dashboard.tsx`
- New orchestration helpers under `lib/rankings/`
- New dashboard-local components/styles
- `tests/rankings-route.test.ts`
- UI/integration fixtures under `tests/fixtures/rankings/`

Do not edit API transport, schema/normalization, appetite logic, or frozen domain contracts.

## Build

1. Keep one shared, read-only underwriting interface.
2. Orchestrate schema discovery, query execution, normalization, scoring, and ranking through module interfaces; do not reproduce their logic in the route.
3. Develop against `RankedSubmission` fixtures so upstream work does not block the UI.
4. Show rank, account, appetite status, score, state, TIV, premium, primary reason, and recommendation at a glance.
5. Show all factor verdicts, dates, full explanation, and appropriate trace/status components in details.
6. Handle initial loading, refresh, empty queue, authentication failure, query failure, missing data, stale results, and partial diagnostics.
7. Keep status visually stronger than score so an unacceptable factor is never hidden by a high number.
8. After other workstreams merge, compose their source-status, query-trace, and factor-breakdown components and run the live end-to-end pass.
9. Test route orchestration and important UI states without relying on live Federato availability.

## Decisions you own

- Information hierarchy and responsive behavior.
- Status, score, and contradiction presentation.
- Refresh/stale/error interaction.
- How much trace appears by default versus on demand.
- Final composition and demo path.

You do not decide OAuth behavior, raw-field interpretation, score semantics, or underwriting thresholds.

## Interface promised to others

Person 1's diagnostics, Person 2's trace, and Person 3's ranked output/components must be consumable without those modules importing UI code from this workstream.

The route remains a thin orchestrator. Domain behavior stays independently testable.

## Completion evidence

- Every important state is demonstrable using fixtures.
- The dashboard works with 50+ results and remains readable on smaller screens.
- No secret or raw access token reaches the browser.
- Human review remains explicit and no mutation/write-back action exists.
- Typecheck, complete test suite, and production build pass.
- Handoff documents final merge order and any component composition still pending.
