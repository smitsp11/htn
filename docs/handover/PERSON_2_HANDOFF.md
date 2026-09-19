# Person 2 handoff — schema-driven query agent

Status: complete against the brief in `PERSON_2_QUERY_AGENT.md`, then **refactored to the real captured Federato schema** (`raw/schema.json` + `raw/full_*.json`). Typecheck, the full suite (158 tests), and the production build pass.

## Real-schema addendum (supersedes the guessed assumptions below)

The real Federato schema and a full data snapshot were captured into `raw/`, so the planner and adapter now target the actual resources instead of guesses:

- **Queue root:** `Submission` (158 records). References are numeric ids; the join walks `Submission.insured → Insured.hq → Location.buildings → Building`, the reverse `Policy.submission` relation for premium/business type/dates/claims, and `Policy.exposure_units → ExposureUnit.location` for risk locations.
- **Field mapping:** accountName←`Insured.name`; submissionType←`Policy.business_type`; lineOfBusiness←`Submission.line_of_business`; primaryRiskState←`Location.state` (largest-TIV risk location, else insured HQ); effective/expiration←`Policy.dates`; tiv←Σ`Building.tiv`; totalPremium←`Policy.premium`; buildingYear←min`Building.year_built`; approvedConstructionPercentage←TIV-weighted share of `Building.construction_type` in the approved set (non-combustible and better; `Frame`/`Wood Frame` excluded — cites MASTER_RESEARCH line 70); fiveYearLossValue←Σ(`paid_indemnity`+`paid_expense`) within the trailing 5 years of the effective year.
- **Offline source:** `lib/federato/offline-data.ts` reads the `raw/` snapshot, performs the id-joins, and feeds the expanded records through `normalizeQueryResponse`. `lib/rankings/pipeline.ts` serves it as `source: "federato"`, `schemaDiscovered: true` when `FEDERATO_USE_DEMO_DATA` is unset (the default). This is how the app shows the real 158 submissions with no live audience.
- **Sanity:** ranking the 158 yields 2 needs-investigation and 156 out-of-appetite (0 in-appetite) — real, not a bug: real premiums sit far above the guideline's $50K–$175K band and many buildings predate 1990. Appetite thresholds are Person 3's to revisit if the book should score differently.

Original pre-refactor notes follow for history.

---

Status (original): complete against the brief in `PERSON_2_QUERY_AGENT.md`. Typecheck, the full suite (154 tests total; 21 owned), and the production build pass.

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
