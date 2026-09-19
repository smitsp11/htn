# Person 2 handoff — schema-driven query agent

Status: complete against the brief in `PERSON_2_QUERY_AGENT.md`. Typecheck, the full suite (154 tests total; 21 owned), and the production build pass.

## Changed files

- `lib/federato/adapter.ts` — enriched `normalizeQueryResponse` for arrays, references, and missing data; `buildQueryPayload` now delegates to the planner while preserving the `FEDERATO_QUERY_PAYLOAD_JSON` / `FEDERATO_FIELD_MAP_JSON` env overrides. **Frozen signatures kept**: `buildQueryPayload(schema: unknown): unknown`, `normalizeQueryResponse(raw: unknown): CanonicalSubmission[]`.
- `lib/federato/schema-planner.ts` — new. Requirements catalogue → schema resolution → query projection for the eight appetite factors plus display fields.
- `lib/federato/query-trace.ts` — new. Serializable, credential-free `QueryTrace` plus `traceToLines()` bridge to the existing `string[]` trace.
- `components/query-trace/` — new. `QueryTraceView` (server-renderable, no CSS import), `query-trace.css` (`qt-` prefixed), `index.ts` (loads the CSS).
- `tests/federato-adapter.test.ts`, `tests/schema-planner.test.ts` — new.
- `tests/fixtures/federato/schema.ts`, `tests/fixtures/federato/records.ts` — new.

## Decisions and assumptions (all marked ASSUMED in code, overridable)

- **Queue resource** guessed from `["submissions","submission","accounts","account","policies","policy"]`; falls back to the first discovered resource, then literal `"submissions"`.
- **Nested shapes assumed:** `locations[]` each with `buildings[]`; `lossHistory[]`/`losses[]`/`claims[]`; `producer`/`account` references.
- **Aggregation rules (documented inline):** TIV = sum of per-location TIV (else sum of building values); premium = scalar else sum of layer premiums; primary risk state = primary location, else largest-TIV, else first; building year = oldest (MIN, conservative); approved-construction % = value-weighted share of source-approved buildings (count-weighted fallback) — never applies appetite policy, that is Person 3; construction description = sorted distinct types; five-year losses = sum within the trailing 5 years anchored on effective-date year (else newest loss year), undated losses summed in full.
- **Query semantics:** `$expand` emitted in the projection `select` for references; `where`/`filter` intentionally empty so all 50+ submissions are retained (appetite is judged client-side, never used to drop records). Each array field carries a developer-facing `$elemMatch` template that is deliberately not applied as a live filter.
- Missing/unexpanded references and malformed values are preserved as `undefined` ("unknown"); no record is dropped for being out of appetite.

## Env vars

No new vars. `FEDERATO_QUERY_PAYLOAD_JSON` (pin the real query body) and `FEDERATO_FIELD_MAP_JSON` (override canonical→scalar paths) remain optional overrides.

## Unresolved API questions

- Real queue resource name and the true Query Request Body shape.
- Actual field paths for TIV, primary state, building year, construction-approval flags, and loss dating (candidate paths are verified against the discovered schema at runtime).
- Whether "approved" construction is source-provided per building or must be derived from a construction-class list.

## Integration notes

- Dashboard owner: `import { QueryTraceView } from "@/components/query-trace"`; build the trace server-side with `buildQueryTrace(planQuery(schema), { generatedFromSchema: true })`.
- **Contract note:** `RankingsResponse.trace` is frozen as `string[]`. `traceToLines(trace)` folds the structured trace into that shape today with zero contract change. Showing the full `QueryTraceView` component would want a new optional `queryTrace?: QueryTrace` field on `RankingsResponse` — a frozen-contract change needing engineer approval.
