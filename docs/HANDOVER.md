# Federato MVP handover

## Mission

Build one read-only underwriting queue that uses Federato's supplied API to discover the available schema, request the data needed by the 2025 commercial-property appetite guidelines, evaluate every submission, rank the queue, and explain each recommendation. The application assists an underwriter; it does not accept, reject, price, or bind insurance automatically.

## Current state

The repository contains:

- All three source PDFs and a consolidated research document.
- A Next.js/TypeScript application that runs in demo mode.
- A server-side Federato/Auth0 client boundary.
- Canonical submission and ranked-result contracts.
- A deterministic implementation of the eight appetite factors.
- A ranked dashboard with details, explanations, and error/loading states.
- Demo fixtures and initial rule tests.

The boilerplate builds and tests successfully. Live mode is intentionally incomplete because the PDFs provide the handler URL, actions, Auth0 domain, token lifetime, and query pitfalls, but not the OAuth audience, complete Query Request Body, resource names, pagination response, or real field paths. Those values must come from organizer credentials, the referenced Notion technical documentation, or the first successful schema response.

## Product flow

```text
Person 1                    Person 2                    Person 3                 Person 4
Auth + API pages     ->     Schema/query planner  ->   Appetite decisions  ->  Ranked shared UI
raw schema/results          CanonicalSubmission[]      RankedSubmission[]       underwriter action
```

This is an integration pipeline, not a development sequence. Every person works concurrently against committed fixtures and frozen TypeScript contracts.

## Frozen contracts

`CanonicalSubmission` is the output of Person 2 and input to Person 3. It contains identity/display fields and the eight appetite inputs.

`RankedSubmission` is the output of Person 3 and input to Person 4. It adds status, score, factor verdicts, explanation, and recommendation.

Both live in `lib/domain/types.ts`. Changes require explicit agreement from all affected people. Until then, adapters—not shared contracts—absorb differences in the real API.

## Equal parallel assignments

| Person | Core capability | UI contribution | Test ownership | Brief |
|---|---|---|---|---|
| 1 | Auth, API transport, pagination, resilience | Source/connection status | API client and pagination tests | `docs/handover/PERSON_1_API_RUNTIME.md` |
| 2 | Schema reasoning, query planning, normalization | Query/decision trace | Planner and adapter tests | `docs/handover/PERSON_2_QUERY_AGENT.md` |
| 3 | Appetite rules, score, explanations | Factor breakdown | Rule and boundary tests | `docs/handover/PERSON_3_DECISION_ENGINE.md` |
| 4 | Rankings orchestration and application integration | Queue/dashboard shell | Route and UI integration tests | `docs/handover/PERSON_4_PRODUCT_INTEGRATION.md` |

Each assignment includes one substantial core module, one visible UI contribution, and its own test surface. Nobody builds a duplicate dashboard.

## Decision ownership

- **Person 1 owns operational decisions:** authentication, caching, retries, pagination completeness, transport errors.
- **Person 2 owns data-semantic decisions:** resource selection, field mapping, arrays/references, aggregation, follow-up queries.
- **Person 3 owns underwriting-policy decisions:** scoring, boundaries, contradictions, unknowns, recommendation language.
- **Person 4 owns interaction decisions:** information hierarchy, status versus score presentation, refresh/error states, final composition.

If a decision crosses boundaries, the owner proposes it and the consuming person verifies the contract impact. Do not solve disagreement by independently changing shared types.

## Parallel workflow

1. Create four Conductor workspaces from the same pushed commit.
2. Give each Claude Code session its numbered person brief.
3. Keep `FEDERATO_USE_DEMO_DATA=true` unless the workspace has valid organizer credentials.
4. Work against fixtures; do not wait for upstream implementation.
5. Each person runs typecheck, tests, and production build before handoff.
6. Merge workstreams with their owned files intact.
7. Run one end-to-end live-data integration pass after Persons 1–3 are merged; Person 4 composes the final UI.

Conductor is configured for concurrent local development using a different `$CONDUCTOR_PORT` in each workspace. `.env*` files are copied by Conductor's default files-to-copy behavior; never commit real credentials.

## Shared product rules

- Target/acceptable/not-acceptable classifications come from `APPETITE_GUIDELINES.pdf`.
- Missing values never silently count as acceptable.
- Exact boundaries not classified by the PDF remain visible as ambiguous until the engineer decides otherwise.
- Out-of-appetite submissions remain in the queue and receive explanations.
- The score is subordinate to appetite status; a high score cannot hide an unacceptable factor.
- Explanations are deterministic for this MVP; no external LLM is required.
- External enrichment is out of scope.

## Whole-product definition of done

- Authenticates through `auth.product.federato.ai` and keeps credentials server-side.
- Discovers schema before constructing the live production query.
- Uses `$elemMatch`, `$expand`, `where`, and `filter` correctly.
- Retrieves and accounts for all 50+ submissions through pagination.
- Produces all eight factor verdicts, a stable rank, and a short explanation for every result.
- Displays loading, empty, missing-data, authentication, and query-error states.
- Retains human underwriting authority and performs no write-back.
- `npm run typecheck`, `npm test`, and `npm run build` pass after integration.
