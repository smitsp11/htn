# Competitor comparison and improvement plan: UnderwriteIQ vs. this project

Date: 2026-09-20.
Competitor: `BaronLiu1993/htn-2026`, analysed at head `80e57df` (the brief cited `0fba015`; two later commits add a Baseten model selector and fix their claim-field aliases).
Ours: `main` at `804506d`.

Every claim about our code cites `file:line`. Every claim about theirs was re-verified against a clone. "Designed" or "stubbed" counts as not implemented on either side.

Score key: **Ahead** (we are demonstrably better), **Parity**, **Behind**, **Unverified** (cannot be confirmed from code without a live run), **Not credited** (rubric rule: enrichment earns nothing unless it changes score or rank).

---

## 1. Verdict

**Overall: Parity, with opposite strengths.**

- We are Ahead on scoring output, explanations, and ranking (criteria 8, 17, 19, 22, 28).
- We are Behind on the judges' top-weighted area, agentic reasoning (criteria 3, 4, 7), and on evidence provenance (24). *Update 2026-09-20: criterion 3 is now Parity or better; see the row below and P4.1.*
- Three criteria decide it: **#3/#4** (they run an adaptive query loop with a visible per-query rationale; we issue one static query and show five generic trace lines), **#8/#28** (we have a graded score that orders the red majority; they have four flat buckets), and **#24** (every fact of theirs carries record IDs; none of ours do).

### Their scoring system, in short

Not more in-depth in outcome, but deeper in evidence.

| Aspect | Theirs | Ours |
|---|---|---|
| Output | 4 buckets (`target`, `acceptable`, `needs_review`, `out_of_appetite`), no score. 155 of 158 live rows fall into one bucket. | 4 statuses plus a 0 to 100 score. Red rows spread from 25 to 67 on the snapshot. |
| Per-factor detail | 8 requirements + 4 preferences, each `passed/failed/matched/unresolved`, with value and up to 2 record IDs | 8 factors, each `target/acceptable/not_acceptable/unknown`, with a reason sentence, no record IDs |
| Explanation | Fixed template naming 2 factors max | 3 sentences naming every failing, unknown, and target factor, with an explicit contradiction clause |
| Rules | Versioned JSON rule pack, generic operators, threshold changes need no code | Constants in `lib/domain/appetite.ts:28-39` |
| Evidence | Fact ledger with provenance (resource, id, field, value, retrieved_at, state) and cross-query conflict detection | None |
| Primary state | First Location found (arbitrary on multi-state risks) | TIV-weighted (`lib/federato/adapter.ts:186-212`) |
| Construction | Fire Resistive and Modified Fire Resistive count as **unacceptable** | Both approved, documented (`lib/federato/adapter.ts:39-47`) |
| Losses | Paid + reserves (incurred) at head; window ends **today** | Paid only; window ends at effective-date year (`lib/federato/adapter.ts:274-303`) |
| LLM | Mandatory; run fails without OpenAI | Optional; only the ask bar uses it |

Known weakness in **our** score: it counts how many factors are good, not how far a failing factor is out. A row failing three hard gates can still score 67, and premiums of $176K and $500K both score zero on that factor. It orders the red bucket; it does not measure distance. Work item P1.5 below addresses this.

---

## 2. Scorecard

### B1. Agentic reasoning (judges' top priority)

| # | Criterion | Theirs | Ours | Score |
|---|---|---|---|---|
| 1 | Runtime schema discovery validates queries | Full validator, repairable errors | Live mode discovers schema then resolves each candidate path against it, flagging unresolved fields (`lib/federato/schema-planner.ts:318-371`, `:473-489`). Default offline mode skips discovery and hardcodes `schemaDiscovered: true` (`lib/rankings/pipeline.ts:115`). | Parity |
| 2 | Queries built dynamically | LLM-authored, cap 4 | Deterministic planner builds one nested `$expand` projection from the schema (`lib/federato/schema-planner.ts:459-470`); env override seam (`lib/federato/adapter.ts:69-79`). | Parity |
| 3 | Agent adapts to results | Loop, 4 queries, no deep-dive policy | **Implemented 2026-09-20.** After the first ranking, rows with unknown factors or a single-factor near miss go back to the agent (`lib/rankings/follow-up-targets.ts`, `lib/rankings/pipeline.ts`). The agent plans a schema-resolved route to the insured's prior terms and their claims, batches one query per gap kind, merges, and the queue is re-ranked (`lib/federato/follow-up.ts`, `lib/federato/adapter.ts` `runFollowUp`). On the snapshot: 2 follow-up queries, 11 loss histories resolved across every line the insured holds, 1 status change (SUB-2025-00132), 1 borderline figure confirmed with reserves. Gaps with no data source (premium, type before a quote) are stated as such. Deterministic, capped at 5 queries, runs once per pass, same code offline and live. | **Parity** (deep-dive policy is explicit; theirs is not) |
| 4 | Reasoning trace visible | Purpose, duration, summary per query | Four to five generic sentences (`lib/rankings/pipeline.ts:116-120`, `:127-135`). A per-field trace exists (`lib/federato/query-trace.ts:59-69`) and a view exists (`components/query-trace/query-trace.tsx:14`) but neither is wired into the response or dashboard. | **Behind** |
| 5 | Works without LLM | No, run fails | Yes. OpenAI is used only by the ask bar (`lib/agent/ask.ts:50`, `app/api/ask/route.ts:17-24`). | **Ahead** |
| 6 | `$elemMatch` and `$expand` handling | Validator enforces | `$expand` tree generated (`lib/federato/schema-planner.ts:429-448`); `$elemMatch` only as a developer template, never sent (`:382-390`, `:485`). Live response shape not exercised. | Unverified |
| 7 | Pagination completeness | Breaks on short page or `total` | Cursor-following helper with loop and duplicate guards exists (`lib/federato/pagination.ts:96-145`) but the pipeline calls the single-page `query` (`lib/rankings/pipeline.ts:51`, `:130`). No `total` check. | **Behind** |

### B2. Scoring correctness

| # | Criterion | Theirs | Ours | Score |
|---|---|---|---|---|
| 8 | Graded score | None | 0 to 100, target 2 points, acceptable 1 (`lib/domain/appetite.ts:47-53`, `:167-170`). Counts good factors, not distance. | **Ahead** |
| 9 | Hard failures dominate | Yes | Any not-acceptable factor forces `out_of_appetite` (`lib/domain/appetite.ts:176-180`); status sorts before score (`:224-231`). | Parity |
| 10 | TIV-weighted primary state, shown | First location | State of the location with the largest summed building TIV (`lib/federato/adapter.ts:186-212`). Derivation not shown; reason reads only "CA is a target state" (`lib/domain/appetite.ts:96`). | Ahead |
| 11 | Building age policy stated | Oldest, in rule note | Oldest building (`lib/federato/adapter.ts:215-223`); stated in planner note (`lib/federato/schema-planner.ts:175`) but not rendered. | Parity |
| 12 | Construction share weighted, breakdown | Weighted, no breakdown | TIV-weighted with equal-weight fallback (`lib/federato/adapter.ts:231-254`). A distinct-types description is computed (`:257-265`) but no component renders it. | Parity |
| 13 | Fire Resistive ruling | Silently unacceptable | FR and MFR approved, with a comment citing the research doc (`lib/federato/adapter.ts:39-47`). Not surfaced in UI. | **Ahead** |
| 14 | TIV from buildings, reconciled | Sum, no reconciliation | Sum of `Building.tiv` with `building_value` fallback (`lib/federato/adapter.ts:165-173`). No reconciliation; `Policy.limit` and `Submission.requested_limit` exist in `raw/schema.json` and are unused. | Parity |
| 15 | Five-year losses | Paid + reserves at head; window to today | Paid indemnity + paid expense, reserves excluded (`lib/federato/adapter.ts:274-276`); trailing five years by year ending at effective-date year (`:285-303`). Paid-vs-incurred choice stated only in a code comment. | Ahead |
| 16 | Boundary cases | 1990, 50%, $100K unresolved | Same three go `unknown` with an explicit reason (`lib/domain/appetite.ts:130`, `:142`, `:150`); $150M and $175K pass inclusive; each tested (`tests/appetite.test.ts:72-122`). UI lists them as "Decide ..." items (`components/dashboard/submission-detail.tsx:52-57`). | Ahead |
| 17 | Missing data per field | Per-fact state and note | Unknown verdict per factor; completeness splits absent (broker chase) from ambiguous (underwriter call) (`lib/rankings/completeness.ts:50-67`), rendered as a checklist (`components/dashboard/submission-detail.tsx:47-60`). | **Ahead** |
| 18 | No-policy submissions | Needs-info, no proxy | Premium, type, and losses left undefined when no policy (`lib/federato/offline-data.ts:210-217`, `lib/federato/adapter.ts:288`); 45 of 158 hit this. No `requested_limit` proxy. | Parity |
| 19 | Non-property separated | No | Scope routing before evaluation (`lib/domain/appetite.ts:20-25`, `:183-200`); collapsed section in the UI (`components/dashboard/out-of-scope-section.tsx:12`). 120 of 158 land here. | **Ahead** |
| 20 | New/renewal pairs isolated | At risk | Joins are per policy: policy by submission id, claims and exposure units from that policy only (`lib/federato/offline-data.ts:170-201`). No shared-insured traversal. | **Ahead** |

### B3. Explanations (judges' second priority)

| # | Criterion | Theirs | Ours | Score |
|---|---|---|---|---|
| 21 | Every submission explained with values and recommendation | Template, 2 factors, with values and IDs | Three sentences: score and status, all failing/unknown/target factors by name, recommendation (`lib/domain/explanation.ts:43-74`). Values appear only in the per-factor reasons in the breakdown (`components/factor-breakdown/factor-breakdown.tsx:52-60`). | Parity |
| 22 | Contradictions explicit | Generic "data consistency" | "This contradicts target matches on X, which do not offset it" (`lib/domain/explanation.ts:56-62`). | **Ahead** |
| 23 | Borderline values named | Only via unresolved | Named in the factor reason and in the "Decide" checklist (`lib/domain/appetite.ts:130`, `components/dashboard/submission-detail.tsx:52-57`). | Ahead |
| 24 | Provenance record IDs per factor | Strong | None. A factor carries key, label, verdict, reason only (`lib/domain/types.ts:30-35`). | **Behind** |
| 25 | LLM grounded, cannot change outcome | Designed, disconnected | Ask bar: model picks a tool, engine returns facts, final turn forbids tool calls and only phrases (`lib/agent/ask.ts:44-46`, `:88-91`). It does not write per-submission explanations. | Ahead |
| 26 | Actionable recommendation | Fixed per bucket | Four fixed phrases per status (`lib/domain/explanation.ts:7-12`). | Parity |

### B4. Ranking

| # | Criterion | Theirs | Ours | Score |
|---|---|---|---|---|
| 27 | Reproducible, documented | Yes | Status, score desc, account, id (`lib/domain/appetite.ts:223-232`); tested (`tests/appetite.test.ts:225-247`). | Parity |
| 28 | Orders the out-of-appetite majority | No | Score orders within status; snapshot spreads the 36 red rows from 25 to 67. | **Ahead** |
| 29 | Top-N surfaces opportunities | 0 target or acceptable | Snapshot: 0 in appetite, 2 needs investigation (both no-policy), 36 out, 120 out of scope. 26 of 36 fail on oldest-building year. | Parity |

### B5. Enrichment (bonus; rubric rule: no credit unless it feeds score or rank)

| # | Criterion | Theirs | Ours | Score |
|---|---|---|---|---|
| 30 | External source integrated | None | FEMA NRI county ratings prefetched by `scripts/fetch-enrichment.ts:52-85` into `raw/enrichment.json`, attached offline only (`lib/rankings/pipeline.ts:105-111`). Display and ask-bar filter only (`lib/agent/query-tools.ts:46-49`). | Not credited |
| 31 | Enrichment changes rank, explained | n/a | No, by project rule (`CLAUDE.md`, non-negotiable scope). | Not credited |
| 32 | Graceful degradation | n/a | Missing index yields an empty map and an "unknown" profile (`lib/enrichment/hazard.ts:22-34`); UI shows "No external hazard data" (`components/external-risk/external-risk.tsx:14-20`). | Ahead |

### B6. Resilience and engineering

| # | Criterion | Theirs | Ours | Score |
|---|---|---|---|---|
| 33 | Token minted and refreshed | Yes | Auth0 domain default, cache with 5-minute early refresh, 4-hour fallback TTL (`lib/federato/client.ts:19-22`, `lib/federato/token-cache.ts:17-33`). | Parity |
| 34 | `[CODE]` prefix parsed | Not observed | Not parsed; categorised by HTTP status and message regex (`lib/federato/transport.ts:76-91`, `lib/rankings/errors.ts:13-20`). | Parity |
| 35 | 158 in reasonable time | Multi-minute with LLM | Offline is instant; live is one request with no LLM in the ranking path. Live timing unverified. | Ahead |
| 36 | Tests | Yes | 209 passing: precedence, every boundary, ranking, pagination, route (`tests/appetite.test.ts`, `tests/federato-client.test.ts:168-243`, `tests/rankings-route.test.ts`). | Parity |
| 37 | Rules externalised | Strong | Thresholds are constants in code (`lib/domain/appetite.ts:28-39`). | **Behind** |
| 38 | Read-only | Yes | Recommendation vocabulary never implies a decision (`lib/domain/explanation.ts:3-12`); badge on page (`app/page.tsx:14`). | Parity |

### B7. UI (judges' third priority)

| # | Criterion | Theirs | Ours | Score |
|---|---|---|---|---|
| 39 | Ranked list with status, score, breakdown, explanation | Yes, no score | Rank, status, flag chips, score, state, TIV, premium, primary reason, recommendation, expandable breakdown and explanation (`components/dashboard/queue-table.tsx:23-69`, `components/dashboard/submission-detail.tsx`). | **Ahead** |
| 40 | Filters, evidence view, activity trace | Yes | Natural-language filter only (`components/dashboard/dashboard-view.tsx:29-34`); no column sort, no evidence bundle, trace is five lines. | **Behind** |
| 41 | Underwriter can act | Note-only button | None beyond the "Human decision required" badge (`app/page.tsx:14`). | Parity |

### Tally

| Score | Count | Criteria |
|---|---|---|
| Ahead | 16 | 5, 8, 10, 13, 15, 16, 17, 19, 20, 22, 23, 25, 28, 32, 35, 39 |
| Parity | 16 | 1, 2, 9, 11, 12, 14, 18, 21, 26, 27, 29, 33, 34, 36, 38, 41 |
| Behind | 6 | 3, 4, 7, 24, 37, 40 |
| Unverified | 1 | 6 |
| Not credited | 2 | 30, 31 |

---

## 3. Improvement plan

Goal: turn every **Behind** into Parity or Ahead, every **Unverified** into verified, and lift the Parity items that judges see first (explanations and UI). Ordered by judge weight divided by effort. Owners follow the workstream boundaries in `docs/handover/`; anything that touches a frozen contract is listed separately in section 3.7 and needs engineer approval before work starts.

Estimated total: about 36 hours across four people, split into five phases. Phases 1 and 2 are the minimum for the demo.

### 3.1 Phase 1: make what already exists visible (about 7 h)

These are the cheapest wins. The code exists; it is not wired to the UI.

| ID | Work item | Criteria moved | Owner | Files | Effort | Done when |
|---|---|---|---|---|---|---|
| P1.1 | **Wire the query trace into the response and dashboard.** In live mode call `planQuery` + `buildQueryTrace` and append `traceToLines()` to `RankingsResponse.trace`. In offline mode run `parseSchema` over `raw/schema.json` so the trace is real and `schemaDiscovered` is honest. Mount `QueryTraceView` under the "Decision trace" details. Needs the optional `queryTrace?: QueryTrace` field on `RankingsResponse` (see 3.7); until approved, use `traceToLines` only. | 1, 4, 40 | Person 4 (pipeline, dashboard), Person 2 (trace) | `lib/rankings/pipeline.ts`, `components/dashboard/dashboard-view.tsx`, `components/query-trace/` | 2 h | Dashboard shows per-field resource, matched path, aggregation note, and unresolved fields for both offline and live runs. Test in `tests/rankings-route.test.ts` asserts trace lines include the planner summary. |
| P1.2 | **Honest source labels.** Offline branch reports `source: "federato"` but the summary card says "Federato API" and "Schema discovered: Yes" with no call made (`pipeline.ts:112-118`, `components/dashboard/source-status.tsx:12-13`). Show "Federato snapshot (offline)" and derive `schemaDiscovered` from P1.1. Align `lib/federato/status.ts:81` with the three pipeline modes (demo / offline snapshot / live). | Demo risk | Person 4, Person 1 (status) | `lib/rankings/pipeline.ts`, `components/dashboard/source-status.tsx`, `lib/federato/status.ts` | 1 h | A judge asking "is this live?" gets the same answer from the card, the trace, and `/api/federato/status`. |
| P1.3 | **Render derivations.** Show `constructionDescription` under the construction factor in `FactorBreakdown`. Change reasons to state the rule: "Oldest building built 1985 (older than 1990)", "CA is a target state (TIV-weighted primary risk location)", "62% approved construction, TIV-weighted". | 10, 11, 12 | Person 3 | `lib/domain/appetite.ts`, `components/factor-breakdown/factor-breakdown.tsx`, `tests/appetite.test.ts` | 1.5 h | Every aggregate factor reason names its aggregation rule; construction factor lists the distinct types found. |
| P1.4 | **Values in the explanation sentence.** Second sentence includes the value clause for each not-acceptable and unknown factor: "Not acceptable: building year (built 1985, older than 1990); total premium ($40K, below $50K)". Reuse `factor.reason`, do not duplicate logic. | 21 | Person 3 | `lib/domain/explanation.ts`, `tests/appetite.test.ts` | 1 h | Explanation for a failing row contains the actual numbers without opening the breakdown. |
| P1.5 | **Near-miss deltas.** Reasons for out-of-range numeric factors state the distance: "Premium $176K exceeds the $175K maximum by $1K"; "Built 1988, two years before the 1990 cutoff". Optionally add a `nearMiss` flag chip when the delta is within 5% or 2 years. Score formula stays as is (contract-safe); the delta gives the judge the "how far out" signal. | 8, 23 | Person 3 | `lib/domain/appetite.ts`, `lib/rankings/flags.ts`, `tests/appetite.test.ts` | 1.5 h | Boundary and near-boundary cases in `tests/appetite.test.ts` assert the delta text. |

### 3.2 Phase 2: make the live path work (about 6 h, blocked on credentials for P2.3)

These remove our own versions of the competitor's W4/W6 failure modes.

| ID | Work item | Criteria moved | Owner | Files | Effort | Done when |
|---|---|---|---|---|---|---|
| P2.1 | **Adapter reads the planner's expanded shape.** The live projection expands `policy.exposure_units.location.buildings` and `policy.claims` (`schema-planner.ts:483`) but the adapter reads top-level `locations` and `claims` (`adapter.ts:150`, `:290`). Add fallbacks: `riskBuildings` also walks `policy.exposure_units[].location.buildings`; `resolvePrimaryState` reads `exposure_units[].location.state`; claims fall back to `policy.claims`. Add a fixture built directly from `planQuery(schema).projection` so the test proves the two shapes agree. | 6, demo risk | Person 2 | `lib/federato/adapter.ts`, `tests/federato-adapter.test.ts`, `tests/fixtures/federato/records.ts` | 2 h | A record shaped exactly like the live `$expand` response normalises to the same `CanonicalSubmission` as the offline join. |
| P2.2 | **Pipeline uses `queryAll`.** Replace the single `client.query` in `defaultPipelineDeps` with `client.queryAll(payload, { dedupeKey: submission id })`. Record `pageCount` and `duplicatePagesDetected` in the trace. If the response carries a `total`, compare it to the fetched count and emit a `pagination` trace warning on mismatch. | 7 | Person 4 (pipeline), Person 1 (pagination) | `lib/rankings/pipeline.ts`, `lib/federato/pagination.ts`, `tests/rankings-route.test.ts` | 1.5 h | Trace reads "Fetched 158 records across 2 pages; total matches." |
| P2.3 | **Live smoke test.** With credentials, run `FEDERATO_USE_DEMO_DATA=false` once. Confirm (a) the reverse `policy` `$expand` on Submission is accepted (`schema-planner.ts:282-298` assumes it), (b) the pagination envelope matches `defaultExtractPage`. If (a) is rejected, fall back to querying `Policy` with `$expand: submission` and reusing the offline join in `offline-data.ts:158-232`. Record the outcome in `docs/handover/PERSON_2_HANDOFF.md`. | 6 (Unverified to verified) | Person 2, Person 1 | `lib/federato/schema-planner.ts`, `lib/federato/pagination.ts`, docs | 2 h | Live run yields the same status counts as the offline snapshot, or the fallback is implemented. |
| P2.4 | **Parse the `[CODE]` error prefix.** Federato string errors carry a bracketed code. Extract it in `fetchJson` and carry it on `FederatoTransportError` so the UI can show it. | 34 | Person 1 | `lib/federato/transport.ts`, `tests/federato-client.test.ts` | 0.5 h | An error body of `"[AUTH_EXPIRED] ..."` surfaces `code: "AUTH_EXPIRED"`. |

### 3.3 Phase 3: evidence and provenance (about 7 h, needs contract approval)

This is the competitor's strongest area and our clearest Behind on explanations.

| ID | Work item | Criteria moved | Owner | Files | Effort | Done when |
|---|---|---|---|---|---|---|
| P3.1 | **Record-ID provenance per factor.** Adapter records which raw records fed each aggregate: `{ resource: "Building", ids: [12, 14], field: "year_built" }`. Carried as optional `sources?: Partial<Record<FactorKey, EvidenceRef[]>>` on `CanonicalSubmission` and copied onto `FactorEvaluation.evidence?`. Breakdown shows "from Building #12, #14"; explanation cites the ids for failing factors. Offline join already has every id in hand (`offline-data.ts:175-231`). | 24, 10, 11, 12, 21 | Person 2 (adapter), Person 3 (engine, breakdown), engineer (contract) | `lib/domain/types.ts` (approval), `lib/federato/adapter.ts`, `lib/federato/offline-data.ts`, `lib/domain/appetite.ts`, `components/factor-breakdown/` | 4 h | Every non-unknown factor lists at least one record id; tests assert ids flow from fixture to factor. |
| P3.2 | **TIV reconciliation and `requested_limit` proxy.** When building TIV sum and `Policy.limit` differ by more than 10%, the TIV reason says so ("Building sum $80M; policy limit $75M"). When there is no policy and no buildings, use `Submission.requested_limit` as TIV with the reason "from requested limit; confirm with broker" and provenance from P3.1. Never silently pass. | 14, 18 | Person 2 | `lib/federato/adapter.ts`, `lib/federato/offline-data.ts`, `lib/federato/schema-planner.ts` (add `limit`, `requested_limit` to requirements), tests | 2 h | No-policy rows show a proxied TIV with a visible source; mismatched limits are named. |
| P3.3 | **Cross-source conflict note.** When `Submission.line_of_business` and `Policy.line_of_business` disagree, or `Policy.business_type` and the submission's own type disagree, the affected factor goes `unknown` with the reason "Submission says X, policy says Y". | 22, 24 | Person 2, Person 3 | `lib/federato/adapter.ts`, `lib/domain/appetite.ts` | 1 h | A fixture with disagreeing sources yields `unknown` and names both values. |

### 3.4 Phase 4: agentic depth (about 8 h)

The judges' top criterion. This is where we are furthest behind and where the competitor's design reads best in a demo.

| ID | Work item | Criteria moved | Owner | Files | Effort | Done when |
|---|---|---|---|---|---|---|
| P4.1 | **Adaptive second pass in live mode.** After the first ranking, select rows that are `needs_investigation`, or `out_of_appetite` with exactly one failing factor and score at or above 58. For each unresolved gap issue a focused follow-up query planned by the schema planner (for example `Submission.requested_limit` for no-policy rows; `Policy.claims` with `$elemMatch` on `date_of_loss` within the window). Merge the results, re-rank, and log each query as a trace entry with purpose, target rows, duration, and rows returned. Cap at 5 follow-ups. Offline mode simulates the same loop against the snapshot so the demo shows it without credentials. **Done 2026-09-20** (`lib/federato/follow-up.ts`, `lib/rankings/follow-up-targets.ts`, `tests/follow-up.test.ts`); the follow-up kinds are prior-term losses via the insured and a reserve-aware re-read for borderline losses, not `$elemMatch`, because `where` on ids validates against the schema and replays offline. Losses count every line the insured holds and the derivation note says so. | 2, 3, 4, 6 | Person 2 (planner: `planFollowUp`), Person 4 (pipeline loop, trace) | `lib/federato/schema-planner.ts`, `lib/rankings/pipeline.ts`, `lib/federato/query-trace.ts`, tests | 5 h | Trace shows "Query 2: claims for 11 no-policy rows (purpose: resolve five-year losses), 0.4 s, 11 rows" and at least one row changes status or score after the pass. |
| P4.2 | **LLM-proposed, planner-validated follow-ups (optional).** Let the OpenAI wrapper propose which follow-up to run from a fixed menu; the planner validates every path against the discovered schema and rejects anything unresolved. The LLM never sees or changes verdicts. Falls back to P4.1's deterministic policy when the key is absent. | 2, 3 | Person 4 | `lib/agent/`, `lib/rankings/pipeline.ts` | 3 h | Works identically with and without `OPENAI_API_KEY`; rejected proposals appear in the trace. |

### 3.5 Phase 5: engineering polish (about 8 h)

| ID | Work item | Criteria moved | Owner | Files | Effort | Done when |
|---|---|---|---|---|---|---|
| P5.1 | **Externalise thresholds.** Move the constants in `appetite.ts:28-39` to `lib/domain/appetite-rules.ts` (a typed, versioned object: `{ version: "2025", states: {...}, tiv: {...}, ... }`). `appetite.ts` reads from it. Add a test that overrides one threshold and asserts the verdict changes with no other code change. Show the rule version in the masthead. | 37 | Person 3 | `lib/domain/appetite-rules.ts` (new), `lib/domain/appetite.ts`, `tests/appetite.test.ts`, `app/page.tsx` | 2 h | Threshold change test passes; masthead reads "2025 appetite v1". |
| P5.2 | **Column sort and status filter chips.** Sortable Score, TIV, Premium, State columns; clickable summary cards filter the table to that status. Keep the ask bar as the free-text path. | 40 | Person 4 | `components/dashboard/queue-table.tsx`, `components/dashboard/dashboard-view.tsx`, `tests/rankings-ui.test.ts` | 2 h | Clicking "Out of appetite" shows only those rows, sorted by score. |
| P5.3 | **Evidence view.** In the detail panel, add an "Evidence" tab listing the raw records behind the factors (from P3.1): resource, id, the fields read, and the value. Read-only. | 24, 40 | Person 4 | `components/dashboard/submission-detail.tsx` | 2 h | Underwriter can see the building rows that produced the oldest year without leaving the page. |
| P5.4 | **Underwriter action affordance.** "Flag for review" and "Add note" per row, held in component state only (no persistence, no write to Federato). Clearly labelled as a local worklist. | 41 | Person 4 | `components/dashboard/queue-table.tsx` | 1 h | Judge sees an underwriter workflow; product stays read-only. |
| P5.5 | **Enrichment narrative.** Keep FEMA data display-only per `CLAUDE.md`. Add one trace line stating why ("External hazard data is shown as context and never changes the appetite score, per the guideline scope"). Commit `raw/enrichment.json` so a fresh clone is not empty. Add hazard rating as a visible column in the queue table. | 30, 32 | Person 4 | `lib/rankings/pipeline.ts`, `components/dashboard/queue-table.tsx` | 1 h | Judges see the source, the rating, and the reason it is not scored. |

### 3.6 Criterion-to-work-item map

| Criterion | Current | Target | Work items |
|---|---|---|---|
| 1 | Parity | Ahead | P1.1, P1.2 |
| 2 | Parity | Parity/Ahead | P4.1, P4.2 |
| 3 | ~~Behind~~ Parity (done) | Parity | P4.1 |
| 4 | Behind | Ahead | P1.1, P4.1 |
| 6 | Unverified | Verified | P2.1, P2.3 |
| 7 | Behind | Ahead | P2.2 |
| 8 | Ahead | Ahead | P1.5 |
| 10, 11, 12 | Ahead/Parity | Ahead | P1.3, P3.1 |
| 14 | Parity | Ahead | P3.2 |
| 18 | Parity | Ahead | P3.2 |
| 21 | Parity | Ahead | P1.4, P3.1 |
| 23 | Ahead | Ahead | P1.5 |
| 24 | Behind | Parity | P3.1, P5.3 |
| 34 | Parity | Ahead | P2.4 |
| 37 | Behind | Parity | P5.1 |
| 40 | Behind | Parity | P1.1, P5.2, P5.3 |
| 41 | Parity | Parity/Ahead | P5.4 |
| 30, 32 | Not credited | Not credited (by design) | P5.5 |

### 3.7 Contract changes that need engineer approval

`CanonicalSubmission` and `RankedSubmission` in `lib/domain/types.ts` are frozen. All proposed changes are additive optional fields so existing fixtures and tests keep passing.

| Change | Needed by | Shape |
|---|---|---|
| `RankingsResponse.queryTrace?: QueryTrace` | P1.1 | Existing `QueryTrace` type from `lib/federato/query-trace.ts` |
| `CanonicalSubmission.sources?: Partial<Record<FactorKey, EvidenceRef[]>>` | P3.1, P3.2 | `EvidenceRef = { resource: string; id: string \| number; field: string }` |
| `FactorEvaluation.evidence?: EvidenceRef[]` | P3.1 | Copied from `sources` by `evaluateFactors` |
| `FactorEvaluation.nearMiss?: boolean` | P1.5 (optional) | Set when a numeric value is within 5% or 2 years of a boundary |

If approval is not granted, P1.1 ships via `traceToLines` only, P1.5 ships as reason text only, and P3.1 is deferred.

### 3.8 Demo risks to close before presenting

1. **Live mode returns unknowns for every aggregate** until P2.1 lands. Do not switch to live mode in front of judges before it does.
2. **Reverse `policy` expansion is an assumption** until P2.3 confirms it. Have the Policy-rooted fallback ready.
3. **Live mode fetches one page** until P2.2 lands. Silent truncation would look like their W4.
4. **Offline mode claims "Federato API" and "Schema discovered: Yes"** until P1.2 lands. Say "snapshot" out loud if asked before then.
5. **Ask bar needs `OPENAI_API_KEY`.** Ranking does not. Have the key set, or demo the ask bar last.
6. **`raw/enrichment.json` must be committed** or every External Risk panel reads "No external hazard data".
7. **Competitor's W4 is fixed at their head.** Do not claim their loss aggregation is broken.

### 3.9 Not doing, and why

- **Enrichment feeding the score or rank** (criteria 30, 31). `CLAUDE.md` makes this a non-negotiable: enrichment is decision-support context only. We take the rubric hit and say so in the trace (P5.5).
- **LLM-authored primary queries.** The scope rule limits the LLM to a grounded natural-language interface. P4.2 keeps the LLM to proposing from a validated menu.
- **Changing the score formula to a distance metric.** It would change ranking order across every fixture and test with days left. P1.5 gives the same signal through reason text and an optional flag.
