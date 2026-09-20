# Person 2 handoff — schema-driven query agent

## Query agent addendum (supersedes everything below)

The hand-written planner and normalizer were replaced by a query agent that reasons from the discovered schema at runtime. Nothing in `lib/federato/` names a Federato field ahead of time; `lib/federato/requirements.ts` lists name *fragments* per appetite requirement, and every chosen path is resolved against the live schema before it is used.

### How it works (`lib/federato/adapter.ts`, `runQueryAgent`)

1. **Discover** — `{ "action": "schema" }` is indexed by `schema-index.ts` (resources, paths, reference hops, array boundaries).
2. **Plan** — `schema-planner.ts` picks the root resource by requirement coverage with a depth penalty (Policy, not Claim, which merely reaches Policy), finds the queue resource through a single reference (`Policy.submission → Submission`), scores candidate paths for each requirement (lookalikes such as `driver.license_state`, `target_premium`, `roof_year` and anything under `hq`/`broker`/`producer` are penalized), attaches the *supporting* sibling paths each derivation reads (building `tiv`, claim `paid_expense`, exposure `kind`/`basis`, `id`s for de-duplication), and discovers a **fallback location** structurally: the only location reachable from the root without crossing an array (`insured.hq`), plus its buildings.
3. **Optional model pass** — `llm-planner.ts` asks a model which discovered field answers each requirement. It is **off unless `FEDERATO_PLANNER_PROVIDER`** names a provider; every path it returns is re-resolved against the schema and rejected if absent. The model never writes a query and never sees a submission.
4. **Compile** — `query-compiler.ts` emits Query Request Body payloads in the documented stage order: nested `expand` for references, a `select` projection covering every path the assembler reads, offset pagination, and progressively simpler fallback payloads. `where`/`filter` stay empty so all submissions are retained.
5. **Execute with repair** — `query-executor.ts` pages until `total` is reached, retries a rejected payload with the next fallback, and parses the `[CODE]` error prefix.
6. **Assemble** — `assemble.ts` turns hydrated rows into `CanonicalSubmission` with a derivation note per factor (method, source path, confidence, ambiguity). Unbound submissions come from a second query against the queue resource and are merged by the link id.
7. **Cross-check** — a server-side `unwind` + `over` + `$sum` of building TIV is compared with the client's pre-deduplication total; a mismatch is traced as a warning.

### Aggregation rules (same as the offline join they replace, verified on all 158 captured submissions)

- Locations are **deduplicated by id** (46 policies have several exposure units on one location).
- TIV = Σ building value over risk locations; else exposure units on an insured-value basis (a fleet's `cost_new` is never added); else the fallback location's buildings at low confidence; else the requested limit (unbound only, low confidence).
- Primary risk state = state holding the most building value, summed per state (3 submissions differ from the old join, which took the single largest location). Equal weights when values are absent. Minority shares are flagged.
- Building year = oldest building. Approved construction = value-weighted share in Joisted Masonry / Non-Combustible / Masonry Non-Combustible / Steel / (Modified) Fire Resistive; `Frame`/`Wood Frame` are combustible.
- Five-year losses = Σ (`paid_indemnity` + `paid_expense`) on claims whose year of loss is in the five years ending at the effective year; undated claims included; **0** for a policy with no claims, **undefined** for a submission with no policy. (20 submissions differ from the old join, e.g. SUB-2026-00005 has three 2026 claims totalling 31,100 that it reported as 0.)
- No exposure-unit location → the fallback location (`insured.hq`) supplies state, buildings, year and construction at **low confidence**, with a note on every affected submission. All 158 submissions therefore carry a state and a building year.

### Offline and live modes

`lib/federato/replay.ts` replays `raw/` through the same agent, honouring `expand`, `select`, `unwind`/`$sum` and pagination, so the offline path exercises the real projection. `lib/rankings/pipeline.ts` injects one `runAgent` dependency: the replay source when `FEDERATO_USE_DEMO_DATA` is unset, Person 1's `FederatoClient` when it is `false`. `RankingsResponse.queryTrace` (`QueryReasoning`, additive) carries the plan, fallbacks and steps; `components/query-trace/` renders it under "Query reasoning" on the dashboard. The `FEDERATO_QUERY_PAYLOAD_JSON` / `FEDERATO_FIELD_MAP_JSON` seams are gone.

### Tests

`tests/schema-planner.test.ts` (planner, compiler, fallback discovery, model-choice validation, alien schema) and `tests/federato-adapter.test.ts` (assembly rules on `tests/fixtures/federato/agent-*.ts`, plus the whole agent against `raw/`, including a projection-equivalence check: assembling projected rows equals assembling whole records). `tests/offline-data.test.ts` keeps the SUB-2025-00001 regression numbers.

### Open items

- Live run once credentials exist: confirm the first attempt (with `select`) is accepted rather than falling back, `total` reads 113/158, and the TIV cross-check reports zero disagreements.
- `lib/federato/offline-data.ts` still performs its own id-join only to find each submission's primary location for FEMA enrichment; `AssembledSubmission.primaryLocation` now exposes that and the join can be retired.
- ~~Adaptive follow-up queries are not implemented.~~ Done 2026-09-20: `lib/federato/follow-up.ts` plans a schema-resolved route from the queue record to the insured's prior terms and claims, compiles two batched follow-ups (prior-term losses for unbound submissions; a reserve-aware re-read for borderline losses), and merges the results with derivation notes. `runQueryAgent` exposes it as `followUp(gaps)`, which runs once per agent run and logs every step under the `follow-up` trace stage. The queue query now also projects the insured's id so the follow-up needs no second read of the queue. Prior-term losses count every line of business the insured holds, and the note says so. Tests: `tests/follow-up.test.ts`.

---


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
