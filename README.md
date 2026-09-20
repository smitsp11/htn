# Federanorth

A commercial property underwriting workspace powered by Federato data, with a dark brown and cream visual identity, orange grid details, mint accents, and original aerial imagery.

Federanorth answers three questions an underwriter actually has in front of a submission queue: **which of these can I decide today, which are one request away, and what exactly do I need to ask for?**

## Rank the submission queue

Run `npm run agent:rank` to discover the live Federato schema, build a validated query plan from the requirements catalogue, retrieve every page of the required resources, and rank all submissions against the Commercial Property appetite guidelines. OpenAI query planning remains available with `--planner llm`.

The local `.env` already contains the supplied credentials. For another checkout, copy `.env.example` to `.env` and set `FEDERATO_CLIENT_ID`, `FEDERATO_CLIENT_SECRET`, and `OPENAI_API_KEY`. `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Node.js 22+ is required. Run `npm install` for the Browserbase dependencies.

```sh
npm run agent:rank -- --top 10
npm run agent:rank -- --enrich       # also gather external evidence
npm run agent:rank -- --enrich --brief # also write AI context from the captured evidence
npm run case -- SUB-2025-00001       # full workup for one submission
npm run check                        # typecheck + tests
```

Each successful run creates `artifacts/decision/<timestamp>/` with:

- `report.html`: standalone searchable dashboard with triage lanes, evidence requests, and expandable per-factor evidence. Open it in your browser; no server is required.
- `report.md`: the ranked queue, the outstanding-request list grouped by who can answer it, and plain-English explanations.
- `report.json`: scores, factor points, confidence per factor, open requests, source record IDs, resource counts, and schema/rule hashes.
- `schema.json`, `plan.json`, `snapshot.json`: runtime schema, LLM query plan/purposes, and the retrieved evidence for audit/replay.
- `enrichment.json`: external evidence per site with its provider, source URL, and retrieval time, when `--enrich` is used.

Run `npm start` to view the dashboard at `http://localhost:3000`. The server loads `.env`, binds to loopback, and serves the generated dashboard plus local APIs for saved decisions and submission research. To refresh only the interface from the latest saved report, without API calls, run `npm run dashboard:render`.

### Underwriter workflow and data scope

The queue defaults to **active commercial property** submissions. The inspected Federato snapshot contains 38 property submissions (6 cleared/quoted and 32 bound/declined/lost) plus 120 submissions in other lines: general liability 21, auto 20, professional liability 10, cyber 18, excess 15, and health 36. Counts in the interface are computed from the loaded report. Use **Other lines** or **All submissions**, then the source-status selector to include historical records.

Other insurance lines are shown as **Not evaluated** rather than receiving a property appetite score. This is distinct from **account-wide context**, which can include multiple lines within the same insured's relationship and claims history.

An active property case separates three views:

- **Review & next steps:** the next action, AI context, editable evidence-request draft, and review tasks. Known failures ask for exception review rather than requesting facts already established. Only missing evidence enters the draft; copying never sends it.
- **Property details:** buildings, occupancy, construction, TIV, the property-only loss window, appetite checks, and comparable property pricing.
- **Account context:** relationships, all-line/all-date claims, and broker history. These totals are not substituted for the property's five-year loss value.

Pricing inputs appear only when approving. Decisions require attribution, and exceptions require a rationale validated by the server. A failed save leaves the form editable rather than displaying a false success. Saved work appears in the queue and survives reopening. Bound or closed source submissions remain reference cases, including any previously recorded local review; they cannot receive new decisions here.

The design follows the underwriting tasks of evaluating applications, obtaining missing information, reviewing software recommendations, and determining coverage and premiums described by the [U.S. Bureau of Labor Statistics](https://www.bls.gov/ooh/business-and-financial/insurance-underwriters.htm). Its application to this UI is a product design choice, not a replacement for carrier authority or a rating model.

### Research and AI context

Open a property submission in the queue. When a factor is missing, inferred, externally supplied, or conflicted, the case automatically researches its linked locations and generates AI context. A known appetite failure can also be researched using **Research this submission**. The appetite score measures fit; evidence confidence describes how well the inputs are established.

The research panel contains:

- FEMA flood zones retrieved through a Browserbase browser, plus Census address verification.
- NWS forecasts (temperature, wind, precipitation chance) and active alerts for each property's coordinates.
- AI notes explaining uncertain or failed factors, the supplied information used, and what to verify next. Notes never change a score or make an underwriting decision.
- Source links, location IDs, retrieval times, and explicit unavailable/unmatched results. A current forecast is not evidence of historical losses or long-term catastrophe exposure.

Research is saved in `artifacts/research/`, keyed to the report and submission. Reopening a case loads saved results without another paid call. **Refresh research** requests new evidence and new AI notes. Concurrent clicks share the same job. Browserbase navigations and extraction are serialized per page, preventing one site's evidence from being attached to another site. API calls for independent sites can still run concurrently. Browserbase is released before the AI call.

If Browserbase or OpenAI is unavailable, available source evidence remains visible and the panel states which integration failed. Assessor scraping remains disabled until a county recipe has been verified. Old enrichment generated before the page-isolation fix is not rendered as current research; refresh it.

The local research API accepts only a submission ID and report version; addresses and URLs come from server-held records. A stale report must be refreshed before research. Keys stay in the local server's environment.

Implementation references: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [NWS API documentation](https://www.weather.gov/documentation/services-web-api).

Replay a completed run without API calls:

```sh
npm run agent:rank -- --offline artifacts/decision/<timestamp>/snapshot.json
```

`npm run typecheck` runs `tsc --noEmit` over the whole codebase with `checkJs`. The code is plain JavaScript, but it is type-checked: this caught a real bug where a `timeout` field was being passed to a Browserbase call that has no such parameter, so a session lifetime the README once claimed was never actually applied.

An API failure produces no partial ranking. Every resource uses stable ID ordering, offset pagination, total-count checks, and duplicate-ID checks. These checks cannot provide a transactional snapshot across separate API calls.

## Triage lanes

Sorting 158 submissions by score buries the work. The queue is split into four lanes instead:

| Lane | Meaning |
|---|---|
| **Ready to work** | Every factor established and inside appetite. |
| **Chase evidence** | Nothing has failed, but something is unproven. These carry a review priority. |
| **Declined** | A real property risk that fails a stated appetite criterion. |
| **Not property** | Another line of business, out of scope for this guideline. |

The last lane matters more than it sounds: in the sample data 120 of 158 submissions are cyber, auto, health or excess. They correctly fail the property line test, but leaving them mixed into a single ranked list hides the 38 submissions an underwriter can actually act on.

**Review priority** answers "how close is this to a decision, and is it worth closing?" — deliberately not "how much score is theoretically missing". It combines how much of the evidence is already established, whether the premium is inside appetite, and how many separate parties must be chased. A submission with one open question outranks one where nothing is known, even though the latter has far more raw upside.

## The underwriting workflow

An underwriter does three things: review the application, assess the risk, then decide and price it. The engine only ever did the first two, and only as a report — there was no way to act, and nothing survived a refresh. Opening a case now opens the work.

**Step 1 — Application review.** Every outstanding request can be marked *sent*, *answered* or *waived*. Sending a request does not close it: a sent request is still an open question. Review completes when nothing is outstanding.

**Step 2 — Risk assessment.** The appetite analysis, the case file, and the leads. Always available.

**Step 3 — Decision and pricing.** Approve, decline, refer, or request more information; set the premium to bind at and any terms; attribute it and say why. Pricing shows the quote against the peer-indicated premium and both appetite bands.

Two rules make this honest:

- **Nothing is blocked.** Approving a risk that fails appetite is a real underwriting act — it is an exception — so it is allowed, but it requires a written rationale and the rationale is stored with the decision. A gate that cannot be overridden just gets worked around outside the tool.
- **The engine never decides.** It establishes what is known and records what a named person concluded at a point in time. A score is a fact about a submission; a decision is an act by a person, and the two are stored separately.

State persists to `artifacts/underwriting-state.json` through the dashboard server, so decisions survive a refresh, a re-render, and a fresh `agent:rank`. Writes are atomic and serialized. Opened as a standalone file with no server, the same UI falls back to browser storage so the offline report stays usable.

## The case file

Opening a submission gives the whole underwriting picture, not just the appetite verdict. An appetite score answers "does this fit the box". It cannot answer "should we write it", because that depends on what we already have with the account, what it has already cost us, and where the value actually sits.

```sh
npm run case -- SUB-2025-00001
```

Every case assembles five things from Federato, plus whatever external evidence was captured:

- **What stands out** — cross-cutting signals the eight factors cannot express. These never change the score.
- **Our relationship** — policies in force and their premium by line, what has lapsed, what we previously declined, how long the account has been with us.
- **Loss experience across every line** — a live property theft claim is not a property-only fact when it sits next to a cyber claim in litigation. Open reserves are flagged separately from closed claims, with incurred loss expressed against written premium.
- **Where the value sits** — per-location TIV with share bars, the single largest concentration, construction mix weighted by TIV, sprinkler coverage.
- **How it prices against peers** — rate per $1,000 of insured value against other property risks in the same NAICS industry group, with their loss ratios.
- **Who sent it** — the broker's record across the whole book: submissions, bound, declined, hit rate.

On the sample data this changes the reading of real submissions. `SUB-2025-00001` scores 39/100 and lands in `Declined` on construction and premium — but the case file shows **$1.75M of premium already in force across three lines**, a **102% loss ratio**, a **$1.5M theft claim still open**, a cancelled excess policy, and two prior declines. That is a materially different conversation from "outside appetite".

It also catches things the appetite test is not built to see. That same submission spreads $112M of TIV across FL, WA, CA and AZ; the state factor scores `target` because Florida leads at 33%, while **43% of insured value sits in states the guideline does not cover at all**. The signal says so without touching the score, because the guideline speaks to a single primary risk state and the engine does not silently rewrite the rules it was given.

## How the agent evaluates a field

Every factor carries a **confidence** alongside its status, and status alone never earns points:

| Confidence | Meaning |
|---|---|
| `verified` | Complete structured Federato records. |
| `corroborated` | Federato plus an agreeing external source. |
| `inferred` | Derived from complete records through a documented assumption. |
| `external` | External capture only. |
| `absent` / `conflicted` | No evidence, or sources disagree. |

A factor only earns points when its evidence reaches `minimumScoringConfidence` (set in [config/appetite.json](config/appetite.json), default `inferred`). **A favourable reading backed by weaker evidence is demoted to `unknown` and escalated rather than credited** — the engine never converts a guess into appetite credit. Raising the setting to `verified` immediately pushes inference-based factors like primary risk state into review.

Every unresolved factor produces a structured request: the question to ask, the specific records needed, who can answer it, how many points are at stake, and whether it can be retrieved automatically. Those roll up into a queue-wide chase list grouped by party and then by account, so it reads like the emails you were going to send anyway.

### An unresolved factor is never a dead end

"Ask the broker" is not an answer when the account is already sitting in front of you. Every unresolved factor carries **related information we already hold**, so an underwriter can form a view now instead of waiting a week for a reply.

For `SUB-2025-00115`, which has no linked policy and reads as seven unknowns, the case file surfaces:

| Unknown | What we already hold |
|---|---|
| Total insured value | Requested limit $10M · prior schedule $124,074,000 across 9 buildings · account revenue $253M |
| Primary risk state | Prior policy locations: CA $84.4M, FL $39.7M |
| Building year | Prior schedule: oldest **1961**, newest 2018 |
| Total premium | Prior property premium **$703,500** |
| Construction | Prior schedule includes Frame |
| Submission type | Three sibling policies on the account, all new business |

Read together, those say the account is very likely outside appetite — 1961 buildings, premium four times the band — before the broker has replied to anything.

Every lead states **why it is not a substitute** ("Requested limit is not TIV. It can sit well below total insured value on a sub-limited or layered placement.") and cites the Federato records it came from. Leads are context, never evidence: a test asserts that attaching them changes no score, factor, decision or lane.

### Five-year loss history is scored on how much of the window is actually covered

Previously this factor was hardcoded as never-verifiable, so no submission could ever reach appetite. The engine now computes what fraction of the five-year window is covered by property policies on file and reports the uncovered periods as explicit date ranges:

> Property policies on file cover 0% of the window; no loss data for 2021-03-15 to 2026-03-15. This is not evidence of a loss-free record.

An underwriter can act on that: request loss runs for those exact dates from the prior carrier. An absence of claims in an uncovered period is never treated as a clean record.

### Construction classes are a table, not a hardcoded list

[config/appetite.json](config/appetite.json) maps each construction type to its ISO class. The guideline names Joisted Masonry, non-combustible/steel, and masonry non-combustible; it is silent on Fire Resistive and Modified Fire Resistive, which are ISO class 5–6 and strictly better fire performers than every class it does name. Treating them as unacceptable produced false declines, so they are accepted and **labelled as an interpretation** on each affected submission and in the methodology dialog.

## Scoring

The mathematical score is deterministic. The eight weights total 100: business type 10, line 10, state 15, TIV 15, premium 20, year 10, construction 10, loss 10. Target values earn full points. Acceptable values with a separate target earn 70%. Unknown/failed factors earn zero. Any known failure means `OUT_OF_APPETITE` (cap 39); unresolved evidence means `REVIEW_REQUIRED` (cap 69); otherwise `IN_APPETITE`. Sorting uses final score, raw points, then submission ID. These weights and caps are project choices, not weights provided by the carrier.

All report explanations come directly from the evaluated factors, avoiding invented LLM explanations. The guideline's exact 1990/$100,000/50% boundaries go to review. Building TIV is deduplicated, construction is weighted by TIV, primary state is the state with the most building TIV, and the oldest building controls age. Actual premium is never replaced by target premium; policy limit is never used as TIV.

## Query planning

Retrieval is **deterministic by default — no model sits in the data path.** [src/decision/requirements.js](src/decision/requirements.js) is a catalogue in which every field states why it is retrieved and which appetite factor it backs:

```js
{ resource: 'Claim', path: 'reserve_indemnity', required: true, factor: 'loss',
  reason: 'Component of incurred loss. Excluding reserves understates open claims.' }
```

[src/decision/plan.js](src/decision/plan.js) resolves that catalogue against the discovered schema and emits the query plan directly. The same schema always produces the same plan: it cannot vary between runs, cannot fail on a network hiccup, and cannot be steered by anything embedded in the schema it is reading. The catalogue is also the single source of the data contract and the required-path gate, so those three can never drift apart.

The catalogue separates **required** paths from **optional context**. Missing required paths stop the run, because the scorer cannot work without them. Missing optional paths — location addresses, roof year, sprinkler status, claim cause — only reduce confidence and enrichment reach. This is what lets an older snapshot replay against a newer contract instead of failing outright.

A field may declare `candidates` — alternative paths tried in order. `Building.tiv` falls back to `building_value`, but the substitution is recorded rather than applied silently: `building_value` excludes contents and business interruption, so the TIV factor drops from `verified` to `inferred` confidence and says so in its reason.

The LLM planner remains available with `--planner llm`. It passes the same validation gate, so it can never widen what is fetched beyond the catalogue; it is kept as a cross-check, not as the default, because a reproducible plan is worth more than a generated one.

```sh
npm run agent:rank -- --planner llm   # optional; deterministic is the default
```

Reference IDs are joined locally through Submission → Policy → ExposureUnit → Location → Building, with account-level property claims linked through Policy/Insured. No appetite prefilter removes nonmatching submissions.

## External evidence through Browserbase

Federato's building data is complete in the sample set, so enrichment is not about filling blanks — it is about signals Federato does not hold, and about catching disagreements between systems of record.

Providers are **declarative entries in [config/enrichment.json](config/enrichment.json)**, not bespoke scraping code. A provider declares what it resolves, what it requires, and how to extract each field. Adding a county assessor is a JSON entry, not a code change.

Three transports:

- `http` — a public JSON API with templated query parameters.
- `arcgis` — the standard Esri point-intersection query every public feature service accepts.
- `browser` — a Browserbase recipe: an ordered list of `goto` / `fill` / `click` / `waitFor` / `select` / `press` steps, then CSS selectors per extracted field.

```sh
npm run enrich:probe -- census-geocode --address "1600 Pennsylvania Ave NW" --city Washington --state DC
```

The probe runs one provider against one address and prints exactly what it extracted, so a recipe can be confirmed before it is enabled for the queue. Census geocoding, FEMA flood zones, NWS point metadata, forecasts, and alerts are enabled. The county assessor example remains disabled. Tests require enabled providers to be marked verified.

**Recipe behavior.** Selectors and browser actions come from provider configuration. Query and path templates support provider-specific lookups; the NWS forecast URL returned by point metadata is restricted to `api.weather.gov`. URLs must be HTTPS and credential-free; configured host allowlists are checked. Only the six listed browser actions are permitted. A provider failure degrades that lookup without discarding other evidence. Completed lookups are cached by input key within a run. A Browserbase session is reused with exclusive page access for each navigation and extraction.

**External evidence is advisory and never changes a score.** It can do exactly three things, and all three become underwriter tasks:

1. **Propose** a value for a field Federato left blank.
2. **Contradict** a value Federato supplied — on the live data this surfaced a location Federato records in Sacramento that the US Census geocoder places in Yolo County, which changes rating territory.
3. **Raise a risk flag** the appetite guideline does not cover, such as a FEMA Special Flood Hazard Area.

Fields marked `"role": "keying"` (coordinates, FIPS codes) are plumbing to reach the next provider; they are recorded for audit but never raised as questions. Everything captured is stored with its provider, source URL, and retrieval time, and marked `unreviewed`.

Page contents and downloaded documents are untrusted evidence, not agent instructions. A missing result does not prove a property has no permits or incidents.

Reference: [Browserbase Playwright quickstart](https://docs.browserbase.com/welcome/quickstarts/playwright).

## The dashboard

The Federanorth dashboard opens with a serif headline, aerial landscape, and three-step explanation, followed by the submission queue. Duplicate summary tiles have been removed. Lane tabs, filters, sorting, and pagination lead into a full-screen case with research and evidence beside the saved decision workflow.

The drawer also shows a loss-coverage bar with the uncovered ranges called out, a confidence chip on every factor, an interpretation badge where one was applied, and an external-evidence section with each source URL. The chase-list dialog groups every outstanding request by party and account and copies as plain text.

Export downloads the entire filtered queue as CSV, including rows beyond the current page and the lane, priority and open-request counts. The dashboard is self-contained and works offline, including its original [hero image and generation prompt](assets/README.md).

## Federato API

The local `.env` is configured with `FEDERATO_CLIENT_ID` and `FEDERATO_CLIENT_SECRET`. For a new checkout, supply these values yourself. Never put them in frontend code.

- `npm run federato:check` authenticates, saves the live schema, and retrieves up to five policies.
- `npm run federato:schema` refreshes `artifacts/federato/schema.json`.
- `npm run federato:query -- queries/policies.json` runs a JSON query and saves the response.
- `npm test` checks authentication, token reuse/refresh, and response handling without live credentials.

Import `FederatoClient` from [src/federato.js](src/federato.js) and call `schema()` or `query({ resource: 'Policy', pagination: { limit: 5 } })`. The client uses the supplied API documentation's custom Auth0 domain `auth.product.federato.ai`, audience `https://product.federato.ai/core-api`, and handler `https://product.federato.ai/integrations-api/handlers/federato-hack-north`. Tokens remain in memory, refresh before expiry, and retry once on HTTP 401. Responses are unwrapped when the server returns a workflow envelope despite `outputOnly=true`.

Saved data stays in the Git-ignored `artifacts/` directory.

## Scope

Recommendations do not issue, bind, or decline coverage in Federato. Scores are triage priorities, not probabilities or binding decisions. Submissions with no linked policy remain visible rather than being dropped.

Implementation reference: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

### Evidence updates and explainable ranking

The queue displays rank within the selected view and offers review-priority or appetite-score ordering. Evidence completeness and confirmed exceptions are separate from points; none is a loss probability. Research includes a source summary for address matching, FEMA flood zones, current NWS alerts, failures and unresolved questions, followed by cited AI context.

In an active property case, open **Add evidence & update assessment**. Name and date the source, paste a broker reply/document excerpt or load a TXT/MD/CSV file, then extract proposed facts. Review the exact quotes, existing values and conflict warnings, select facts, and provide your name and rationale. Supported fields: quoted USD premium, new/renewal, complete aggregate USD TIV, primary TIV state, and year/construction/roof details for existing building IDs. PDF excerpts can be pasted; PDF upload/OCR, new building schedules and loss-run normalization are not implemented by this intake.

Confirmation reruns the deterministic appetite rules, refreshes ranking and shows factor-by-factor before/after results. Building totals that contradict an aggregate TIV remain unresolved. The original Federato snapshot is immutable; local confirmations, source excerpts, reviewers, dates and superseded decisions persist separately in underwriting-state.json. New evidence clears an existing local decision for re-review while preserving it in history. Confirmations are scoped to the source report version and never silently applied to a new Federato snapshot. Refresh research after evidence changes to obtain context for the revised facts.

Active property submissions without a Federato location also show a clearly labelled synthetic demo scenario. It fills a sample address and complete schedule with deterministic values so the Browserbase walkthrough and appetite reasoning can be demonstrated. Selecting **Use demo data for this walkthrough** applies those values to the open case view and recalculates the visible score with the same engine; the walkthrough never writes evidence, research citations, or an underwriting decision to the source state.
