# Person 4 handoff — queue and product integration

Status: complete against the brief in `PERSON_4_PRODUCT_INTEGRATION.md` using the modules that exist today. Typecheck, the full test suite (118 tests), and the production build pass. The page was also exercised in a real browser against the demo API: queue, summary, source status, expanded detail with the factor breakdown, and decision trace all render.

## Changed files

- `app/api/rankings/route.ts` — now a thin orchestrator: calls the pipeline and maps errors to a categorised body and HTTP status.
- `lib/rankings/pipeline.ts` — new. Dependency-injected `buildRankings` that runs schema discovery, planning, query, normalization, and ranking in order and writes the decision trace. `defaultPipelineDeps` wires the real client, adapter, and evaluator.
- `lib/rankings/errors.ts` — new. Categorises upstream failures as `auth`, `configuration`, `query`, or `unknown` and maps them to 401, 500, 502, or 500.
- `lib/rankings/presentation.ts` — new. Status labels, the at-a-glance primary reason per row, and queue summary counts including unresolved-data diagnostics.
- `components/rankings-dashboard.tsx` — reduced to the client shell: fetching, error parsing, expand/collapse state. Renders the pure view.
- `components/dashboard/dashboard-view.tsx` — new. Pure presentational composition of every state; fully server-renderable for tests.
- `components/dashboard/queue-table.tsx`, `submission-detail.tsx`, `source-status.tsx`, `state-panels.tsx` — new dashboard-local components.
- `app/globals.css` — imports the factor-breakdown stylesheet, adds the primary-reason column, unresolved callout, empty panel, and sticky table header; removes the inline factor-card styles that the component replaced.
- `components/factor-breakdown/index.ts` — no longer imports CSS (loaded once from `globals.css` instead).
- `tests/rankings-route.test.ts` — pipeline ordering, trace, error categorisation, presentation helpers, and the route handler in demo mode and in a failing live mode.
- `tests/rankings-ui.test.ts` — every UI state rendered from fixtures: loading, auth/query/configuration errors, empty, populated, 55-row queue, expanded detail, stale banner, refreshing, and a no-write-back check.
- `tests/fixtures/rankings/responses.ts` — ranked fixtures, a response builder, and a 55-submission generator.

Not touched: API client, adapter, appetite logic, frozen contracts, `app/layout.tsx`.

## Interaction decisions made

- **Status is visually stronger than score.** The badge column sits before the score column, and both the summary cards and detail header lead with status. Ranking sorts by status first, so a 92/100 renewal sits below a 67/100 all-acceptable account.
- **Primary reason column.** Each row shows one factor reason: the first not-acceptable factor, else the first unknown, else the first target, else "All eight factors are acceptable." This gives the underwriter the why without opening details.
- **Error states by category.** Authentication, configuration, and query failures get distinct headings and hints. Nothing in the body echoes a secret; the message comes from Person 1's error text.
- **Stale results.** A failed refresh keeps the last good queue on screen with a banner naming the timestamp of the data shown and the failure.
- **Missing data.** The source card counts submissions with unresolved fields, the trace repeats it, and the detail view shows an amber callout listing unresolved factors.
- **Trace on demand.** The decision trace stays collapsed by default. The route trace now includes counts from every stage so an empty or short result is explainable.
- **No write-back.** The only buttons are Refresh, Try again, and Details/Close. A test asserts no accept, bind, reject, or approve action exists.

## Seams left for Persons 1 and 2

- `SourceStatus` in `components/dashboard/source-status.tsx` renders from the shared `RankingsResponse` only. Person 1's richer connection status (token state, pagination completeness) can replace it; the props are the response and the queue summary.
- The pipeline calls `buildQueryPayload(schema)` and `normalizeQueryResponse(raw)` through injected functions. When Person 2 replaces the JSON seam with the schema planner and adds a structured query trace, extend `defaultPipelineDeps` and append their trace lines in `buildRankings`. `RankingsResponse.trace` is still `string[]`, so a structured trace would need a contract discussion.
- The pipeline does not paginate; it trusts `query` to return the full set. When Person 1 adds pagination, keep it behind the `query` dependency so the pipeline and its tests do not change.

## Remaining blockers

- Live mode is untested against Federato because no credentials or query body exist in this workspace. The live path is covered by injected-dependency tests only.
- `app/layout.tsx` still has no favicon, which produces a harmless 404 in the browser console.
