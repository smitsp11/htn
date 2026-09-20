# Federato MVP implementation plan

## Outcome

Build one shared, read-only underwriter interface that discovers Federato's schema, retrieves the full submission queue, evaluates all eight published appetite factors, ranks the results, and explains every recommendation. A human underwriter remains the decision maker.

The supplied Federato handler and Auth0 endpoint are required core infrastructure. Enrichment services such as Nominatim, OpenFEMA, or Open-Meteo, and LLM calls, are permitted but optional; the MVP does not depend on them.

## Required user experience

The product has one shared UI, composed by Person 4 with visible components contributed by the other workstreams:

1. A ranked table of all submissions.
2. Appetite status and numeric match score.
3. State, TIV, premium, and recommendation at a glance.
4. An expanded view containing all eight factor verdicts, the effective/expiration dates, and a short explanation.
5. Loading, empty, authentication-error, query-error, and partial/missing-data states.
6. A manual refresh action and a minimal decision trace.

There are no separate team dashboards. Person 1 contributes connection/source status, Person 2 contributes query reasoning, Person 3 contributes the factor breakdown, and Person 4 composes them into the ranked queue. Building multiple customer-facing applications would duplicate effort and create inconsistent decisions.

## Shared contracts to freeze before parallel work

`CanonicalSubmission` is the handoff from data to decision logic. It includes identity/display fields plus the eight appetite inputs.

`RankedSubmission` is the handoff from decision logic to UI. It adds factor verdicts, status, score, explanation, and recommendation.

Both contracts are defined in `lib/domain/types.ts` and are frozen before parallel work begins. Every workstream uses fixtures matching these types rather than importing another person's unfinished implementation.

## Four equal parallel workstreams

Each person owns one substantial core capability, one visible UI contribution, and its own test surface. Detailed executable briefs are in `docs/handover/`.

### Person 1 — API runtime

Core capability:

- Auth0 client-credentials flow and four-hour token lifecycle.
- Schema/query transport, pagination, timeouts, and safe errors.
- Completeness metadata proving all 50+ submissions were retrieved.

UI contribution: source/connection status.

Test surface: token reuse/expiry, request bodies, pagination, transport failures, and secret safety.

Decision domain: operational correctness—auth body, token refresh, retries, pagination termination, and error categories.

### Person 2 — schema-driven query agent

Core capability:

- Schema-to-appetite field mapping and generated projections.
- `$elemMatch`, `$expand`, `where`, and `filter` behavior.
- Raw-response normalization into `CanonicalSubmission`.

UI contribution: query/decision trace explaining what data was requested and why.

Test surface: schema changes, arrays, references, aggregations, malformed records, and missing values.

Decision domain: data semantics—resource selection, field mapping, repeated-record aggregation, and follow-up queries.

### Person 3 — underwriting decision engine

Core capability:

- Eight deterministic appetite evaluators.
- Transparent score, status ordering, contradictions, and explanations.
- Missing and unclassified boundary handling.

UI contribution: reusable factor-breakdown and recommendation component.

Test surface: every threshold, target/acceptable/unacceptable state, boundary, missing value, contradiction, and tie.

Decision domain: underwriting policy—score formula, target bonus, status precedence, boundary policy, and recommendation wording.

### Person 4 — queue and product integration

Core capability:

- Thin rankings orchestration route and final pipeline composition.
- Ranked queue, detail experience, refresh, and all application states.
- Fixture-driven and final live-data integration.

UI contribution: dashboard shell, ranked table, responsive layout, and composition of the other three UI components.

Test surface: route orchestration, loading/empty/error/stale states, 50+ result rendering, and end-to-end integration.

Decision domain: interaction design—information hierarchy, status versus score presentation, trace visibility, refresh behavior, and final demo path.

## Execution order

1. **Freeze the baseline:** commit the two TypeScript contracts, representative fixtures, and per-person file ownership.
2. **Create four workspaces:** every Claude Code session starts from the same pushed commit and receives its numbered brief.
3. **Parallel build:** all four people work simultaneously against fixtures; nobody waits for upstream implementation.
4. **Merge capabilities:** combine transport, query/normalization, and decision work with their owned files intact.
5. **Compose the product:** Person 4 connects the merged modules and contributed UI components.
6. **Real-data audit:** inspect high, middle, low, missing-data, and contradictory examples manually.
7. **Demo hardening:** refresh credentials, verify 50+ records, test error states, and rehearse the reasoning trace.

## Definition of done

- Calls schema before constructing the production query.
- Retrieves and accounts for all 50+ submissions with pagination.
- Any external enrichment API or LLM use is optional, supplements the Federato API rather than replacing it, and is explained in the trace or result.
- Evaluates every available submission against all eight factors.
- Unknown data is visible and never silently treated as acceptable.
- Produces a stable rank, factor breakdown, explanation, and human recommendation.
- Handles the documented `$elemMatch`, `$expand`, `where`, and `filter` pitfalls.
- Keeps credentials server-side and retains human underwriting authority.
- Tests and production build pass.

## Documentation gap isolated by the boilerplate

The PDFs print the integration handler, action bodies, correct Auth0 domain, token lifetime, and important query operators. They do not print the OAuth audience, the complete Query Request Body shape, resource names, pagination response, or actual field paths; they point to separate Notion resources for those details. The PDF files contain no hidden link annotations.

The scaffold therefore isolates those unknowns in `lib/federato/adapter.ts` and environment configuration. Once a real schema/query response is available, Person 2 replaces the temporary `FEDERATO_QUERY_PAYLOAD_JSON` seam with the schema-driven planner rather than spreading assumptions across the application.
