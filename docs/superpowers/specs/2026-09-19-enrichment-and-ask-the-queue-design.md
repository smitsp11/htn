# Design spec — Enrichment + Ask-the-Queue

Date: 2026-09-19
Status: Approved design, pre-implementation
Branch: `enrich-and-ask`

## 1. Goal

Close the gap to Federato's stated objective and add the natural-language interface.

Federato's prompt: the agent should **(1) ingest submissions, (2) enrich them with real-world risk data, (3) produce insights relative to a carrier's appetite guidelines** — explainable and actionable.

Current build covers (1) and (3): schema-driven ingest of 158 real submissions and a deterministic 8-factor appetite engine (score, status, ranking, explanations). This spec adds:

- **Feature A — Enrichment:** external natural-hazard risk data per location, as a *separate* decision-support layer (satisfies verb 2).
- **Feature B — Ask-the-queue:** a grounded natural-language interface over the scored queue (strengthens "explainable/actionable/thinks-like-an-underwriter").

**Invariant:** the deterministic appetite engine stays the untouched source of truth. Enrichment never changes a score or status; the LLM never invents facts. The carrier's stated appetite is never overridden. Product stays read-only; a human decides.

## 2. Feature A — Enrichment (external risk layer)

### Source
- **FEMA National Risk Index (NRI)** — free, no API key, county-level natural-hazard risk: a composite rating plus per-hazard ratings (flood, wildfire, hurricane, earthquake, etc.). Keyed by state + county. Exact endpoint/dataset confirmed at build time; if NRI county coverage is thin, fall back to FEMA flood zones or USGS/NOAA. No secret required.
- Keyed off real `Location` fields already present in `raw/` (`state`, `county`, `zip`, `latitude`, `longitude`).

### Offline-first caching
- Prep script `scripts/fetch-enrichment.ts`: collect the unique `(state, county)` pairs across all `Location` records, fetch NRI for each, write `raw/enrichment.json` as `{ "<STATE>|<County>": HazardProfile }`. Run once during the event; committed alongside `raw/*` (data gathered during the event — allowed).
- The app reads this cache offline; **no live enrichment call at request/demo time**. A location missing from the cache resolves to `unknown` hazard (surfaced honestly, never fatal).

### Domain module — `lib/enrichment/hazard.ts`
- `HazardProfile = { compositeRating: HazardRating; compositeScore?: number; topHazards: { type: string; rating: HazardRating }[]; source: "FEMA NRI"; asOf: string }` where `HazardRating = "very low" | "relatively low" | "relatively moderate" | "relatively high" | "very high" | "unknown"`.
- `loadHazardIndex(): HazardIndex` — reads and parses `raw/enrichment.json` (server-side).
- `hazardForLocation(index, loc): HazardProfile` — resolves by `state|county`, else `unknown`.

### Attaching to submissions
- The offline/pipeline layer attaches a hazard profile per submission based on its **primary risk location** (the same location used to derive `primaryRiskState`).
- **Contract change (the one additive, approved change):** add an optional field to `RankedSubmission` in `lib/domain/types.ts`:
  ```ts
  enrichment?: HazardProfile;
  ```
  Additive and optional; existing consumers and the 158 current tests are unaffected. `RankingsResponse` is unchanged (enrichment travels on each ranked submission).

### UI
- **Detail view:** an "External risk — FEMA National Risk Index" panel beside the factor breakdown: composite rating + top hazards, clearly labelled as *outside data, not part of the appetite score*.
- **Queue row:** a compact hazard badge (e.g. "Wildfire · Very High").
- **Explanation:** the appetite explanation is unchanged. A separate, clearly-delimited note may flag high external risk ("External data: very high wildfire risk at the CA location") so it is never confused with the carrier appetite verdict.

### Guarantee
Enrichment is presentation/context only. It does not enter `computeScore`, `deriveStatus`, or the 8 factors.

## 3. Feature B — Ask-the-queue (grounded NL interface)

Approach 1 (grounded tool-calling): the LLM interprets the question and phrases the answer; every fact and row comes from deterministic tools over the already-scored data.

### Components
- `lib/agent/query-tools.ts` — pure functions over `RankedSubmission[]`:
  - `filterQueue(subs, criteria): { matchedIds: string[]; counts: StatusCounts }`
  - `resolveSubmission(subs, nameOrId): RankedSubmission | undefined`
  - `explainSubmission(sub): { factors, explanation, enrichment }` (returns already-computed data; no new judgment)
- `lib/agent/openai.ts` — server-only wrapper calling the OpenAI Chat Completions REST API via `fetch` (no new npm dependency; mirrors `FederatoClient`). Default model `gpt-4.1`, override via `OPENAI_MODEL`. Transport injectable for tests.
- `lib/agent/ask.ts` — orchestrator: runs the tool-calling loop (model picks a tool + args → our code executes → model writes one grounded sentence). Returns `AskResult = { kind: "filter" | "explain" | "none"; answer: string; filter?: QueueFilter; matchedIds?: string[] }`.
- `app/api/ask/route.ts` — `POST { question }`; loads the same scored submissions the pipeline produces; runs `ask`; returns `AskResult`. Server-side so the key never reaches the browser. `dynamic = "force-dynamic"`.
- `components/ask-queue/ask-bar.tsx` — "Ask the queue…" input at the top of the dashboard + the one-line answer; sets a filter that narrows the on-screen queue; "Clear" resets.

### Filter criteria (`QueueFilter`)
`{ lineOfBusiness?, submissionType?, state?, status?, scoreMin?, scoreMax?, tivMin?, tivMax?, premiumMin?, premiumMax?, buildingYearMin?, buildingYearMax?, hazardMin? }` — `hazardMin` lets the chat use enrichment (e.g. "in-appetite property in high-wildfire zones"), tying the two features together. Unknown fields are ignored.

### Data flow
1. UW types a question → `ask-bar` POSTs `/api/ask`.
2. Model returns a tool call (e.g. `filterQueue({ lineOfBusiness:"property", submissionType:"new", state:"CA", tivMax:100000000 })`).
3. Our code executes it over the scored data → `matchedIds` + counts → fed back → model writes "7 match: 0 in appetite, 2 investigate, 5 out."
4. Route returns `{ kind:"filter", answer, matchedIds }`; client narrows the queue to `matchedIds` and shows the sentence.
5. "explain" questions route through `resolveSubmission` + `explainSubmission`; the model narrates the real factors (and enrichment note).

### Grounding guarantee
System prompt: "Only state facts present in tool results; never invent numbers, names, or verdicts; if nothing matches, say so." `matchedIds` always come from `filterQueue`, so the table filter is correct even if the prose weren't — the UI never trusts the model for data.

## 4. Cross-cutting

### Config & secrets
- `.env.local` (gitignored): `OPENAI_API_KEY` (present), optional `OPENAI_MODEL`. FEMA NRI needs no key.
- `.env.example`: document `OPENAI_API_KEY`/`OPENAI_MODEL` (names only, no secret).
- `CLAUDE.md`: revise "Do not add enrichment APIs or external LLM calls" — both are now sanctioned. Enrichment is decision-support that does not override appetite; the LLM is a grounded interface that does not decide appetite. The read-only and human-decides invariants remain.

### Error handling
- Enrichment: missing cache entry → `unknown` hazard (shown, non-fatal). Prep-script network failure is a build-time concern; the app runs against whatever cache is committed.
- Ask: blank question → 400. OpenAI down/timeout (~20s) → 502 with a friendly message; the queue is left untouched. No-match / unparseable intent → `kind:"none"`, honest message. Criteria validated against a fixed schema. No secret ever appears in a response or error.

### Testing (all offline; no real network)
- `tests/enrichment.test.ts` — hazard load/resolve over a committed fixture cache; missing location → `unknown`; attach-to-submission.
- `tests/agent-tools.test.ts` — filter/resolve/explain, including hazard criteria.
- `tests/ask-route.test.ts` — orchestrator with an injected fake OpenAI transport: tools execute, answer is grounded, no-match handled, no key leaks.
- The real prep script and real OpenAI calls are never in the test suite; tests use committed fixtures and injected transports. The existing 158 tests stay green; all additions are additive.

### Sequencing
1. **Enrichment first** (it is the one stated objective currently unmet): confirm source → prep script → cache → hazard module → attach to submissions (contract field) → UI → tests.
2. **Ask-the-queue** (tools → OpenAI wrapper → orchestrator → route → ask-bar + dashboard filter wiring → tests).

### Out of scope (YAGNI)
No live enrichment at request time; no multi-turn chat/history; no streaming; enrichment never alters appetite scoring; no new hazard-based appetite rules; no write-back actions.

## 5. Definition of done
`npm run typecheck` clean, full test suite green (158 + new), `npm run build` succeeds, and the launched app shows the enrichment panel on real submissions and a working ask-the-queue that filters the live queue and explains a submission — all against the real data, offline.
