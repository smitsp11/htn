# Federato Track Brief — Hack the North 2026

> A summary of every document supplied for the Federato track, plus the track listing itself.
> The source documents take precedence over this summary. Sources: the track listing, `README.txt`,
> `STUDENT_PROJECT_GUIDELINES.pdf`, `API_DOCUMENTATION.pdf`, `QUERY_REQUEST_BODY.pdf`,
> `DATA_SCHEMA.pdf`, `APPETITE_GUIDELINES.pdf`, `GLOSSARY.pdf`.

---

## 0. TL;DR — the ten things that matter most

1. **Build an agent that thinks like an underwriter.** It should score submissions against appetite, reason about which data to query, rank the queue, and **explain every decision in plain English**.
2. **Judges weigh reasoning and explainability most.** Their stated priority order is (1) agentic reasoning, (2) explanations, (3) UI polish. External data enrichment is an optional bonus.
3. **One winning team** splits **$3,500**.
4. The data layer is **one POST endpoint with two actions**: `schema` and `query`.
5. **Mint tokens from `auth.product.federato.ai`.** Using any other domain causes a 401. Tokens last **4 hours**.
6. **The schema is deliberately undocumented.** Call `action: "schema"` at startup and let the agent learn field names at runtime. Never assume field names.
7. **A dot-path through an array silently returns zero results.** Use `$elemMatch` instead.
8. **A reference field returns only an ID until it is expanded.** Use the `expand` stage, or a `$expand` select leaf.
9. **The dataset holds 50+ commercial property submissions.** Score all of them, including out-of-appetite ones.
10. **Each result needs a 2–3 sentence explanation** covering its appetite match, the key factors, and a recommendation (review, accept, reject, or investigate further). Be open about borderline and contradictory cases.

---

## 1. Track listing (the prize description)

**Federato: Building the Federato Insurance Agent.** There is **1 winner**, and the prize is **$3,500 split among the team**.

- **Objective:** Build an AI agent that thinks like an underwriting professional. It should ingest submissions, **enrich them with real-world risk data**, and produce insights measured against a carrier's appetite guidelines. This is the kind of work Federato's Forward Deployed Engineering (FDE) team does daily.
- **Problem:** Insurance teams are buried in submissions. Each one must be checked against outside data and appetite guidelines before anyone can act. The agent should distill this work into **explainable, actionable insights** so decision-makers can move faster and with confidence.
- **Provided:** A sample submissions dataset served through the API, a schema-discovery endpoint, sample appetite guidelines, and an underwriting glossary.

> ⚠️ **The track listing and the student guidelines differ on enrichment.** The listing names "enrich them with real-world risk data" as part of the objective. The student guidelines repeat that enrichment is *optional and will not hurt your score*. **Our reading:** build the core agent first. Then add 1–2 enrichment sources that **visibly change the ranking**, because the listing's wording suggests the judges will value them.

---

## 2. `README.txt` — package index

- Lists the doc package and a suggested reading order: Guidelines → API docs → Query body → Glossary → Appetite → Data schema.
- Repeats the key points: use the auth domain `auth.product.federato.ai`, tokens last 4h, schema discovery is intentional, external APIs are optional, and the focus is reasoning and clear explanations.
- For questions, **ask the organizers**.

---

## 3. `STUDENT_PROJECT_GUIDELINES.pdf` — the main brief

### The four tasks the agent must do
1. **Score** each submission against carrier appetite guidelines.
2. **Reason** about which data to request from the API.
3. **Rank** submissions to surface the best opportunities.
4. **Explain** every decision in plain English.

**Why it matters:** underwriters manually check hundreds of submissions a day. Each check covers appetite, outside risk data (flood, climate, business health), and **portfolio context** ("are we already exposed to this risk?").

### Resources supplied
- A synthetic dataset of 50+ commercial submissions, served by a mock API.
- The schema and query endpoints (§4).
- Sample appetite guidelines from a real 2025 carrier.
- A glossary.
- Optional external APIs you would research yourself. The suggestions are **Nominatim** (geocoding), **OpenFEMA** (flood and disaster data), and **Open-Meteo** (weather and climate history).

### Milestones (guidance only; any order is fine)
| Milestone | Key guidance |
|---|---|
| Understand the domain | Read the glossary and appetite docs, and skim the query language. Ask what makes a submission "good" and how a human would prioritize the queue. |
| Discover the data shape | Mint a token, call `schema`, and **save the schema**. Identify the resources, fields, and references, and which fields map to the appetite factors. |
| Build query capability | Start simple, then iterate on filters, projections, pagination, `$expand` for references, and aggregations such as counting policies or summing TIV. |
| **Build agentic reasoning** | *"This is where you differentiate."* Don't hardcode every query. Translate goals into queries with templating, rules, or an LLM. Inspect the schema, reason about which queries help, execute them, and **adapt** (for example, broaden a filter that returns few results). Know when to expand references. Explain the reasoning. |
| Score and rank | Pick a scoring approach: points, weighted, rules-based, or LLM-based. Rank from high to low and choose a top-N. Handle **contradictions** (a submission that matches some factors and fails others) and decide whether all criteria weigh equally. Keep the scoring transparent. |
| **Decision explanations** | *"This is critical."* Each result gets 2–3 sentences covering the appetite match, the key factors, and a recommendation. |
| UI / present results | A web app, CLI, report, or API endpoint are all acceptable. Include the ranked list, a per-submission breakdown, and the explanations, plus optional filters, sorting, and visuals. *Clarity beats polish.* The underwriter should be able to act on each result (review, approve, reject). |
| Optional enrichment | Pick 1–2 APIs. The enrichment **must actually affect ranking**, and you must explain how it changed decisions. |

**The guidelines' example explanation:**
```
Policy #42: SCORE 87/100
$45M TIV commercial property in CA matches your appetite targets.
Building is newer than 2010, premium $85K in range, no claims in 5 years.
Recommendation: Review for acceptance.
```

### Judging tiers
- **MVP:** queries the API, applies appetite logic, ranks by a calculated score, shows a list with brief explanations, and handles 50+ submissions in reasonable time.
- **Strong:** everything in MVP, plus dynamically constructed queries, detailed and justified explanations, handling of edge cases (missing fields, API failures), and clean code with good error messages.
- **Exceptional:** everything in Strong, plus **traceable agentic reasoning** (why it chose each query), **adapting to results** (deeper analysis for high-value opportunities), **open handling of contradictions**, and a polished, actionable UI.
- **Bonus enrichment:** 1–2 well-researched external APIs, a **visible influence on ranking**, and an explanation of how they changed decisions.

### Common pitfalls
1. **Hardcoding queries.** Build a template or rules layer that turns appetite rules into queries.
2. **Ignoring schema discovery.** Call the schema endpoint at startup.
3. **No explanations.** Every result needs its 2–3 sentence explanation.
4. **Dot-paths on arrays.** `{"locations.state":"CA"}` silently matches nothing. Use `{"locations":{"$elemMatch":{"state":"CA"}}}`.
5. **Selecting references without `$expand`.** You get IDs back instead of names.
6. **Overthinking enrichment.** Build the core agent first.
7. **UI over reasoning.** Prioritize reasoning first, then explanations, then UI.

### FAQ highlights
- A **401** means you minted the token from the wrong Auth0 domain.
- **`where` vs `filter`:** `where` runs *before* references are expanded, so use it for whole-submission filters. `filter` runs *after* expansion, so use it for conditions on expanded fields.
- Any LLM (Claude, ChatGPT, and so on) is allowed. A web UI is not required. You may use APIs other than the three suggested. If an external API goes down, log the failure and continue without it.
- Hardcoding queries is technically allowed but risky. *"A small templating layer is worth the effort."*

### Key reminders
Focus on reasoning. Explain decisions. Treat external APIs as optional. Structure the work however you like. **Test early:** get one query working quickly. **Keep it simple:** a working end-to-end system beats fancy tech.

---

## 4. `API_DOCUMENTATION.pdf` — auth and endpoints

### Token
```bash
curl -X POST 'https://auth.product.federato.ai/oauth/token' \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"…","client_secret":"…",
       "audience":"https://product.federato.ai/core-api",
       "grant_type":"client_credentials"}'
# → { "access_token": "...", "expires_in": 14400, "token_type": "Bearer" }
```
- The organizers hand out `client_id` and `client_secret` on hackathon day.
- The token is valid for **4 hours** (14,400 s). Refresh or re-mint it during long sessions.
- To verify a token, decode the JWT: `iss` should be `https://auth.product.federato.ai/` and `aud` should be `https://product.federato.ai/core-api`.

### Endpoint
```
POST https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true
Authorization: Bearer $TOKEN
Content-Type: application/json

{ "action": "schema" }
{ "action": "query", "payload": { "resource": "Policy", "pagination": { "limit": 5 } } }
```
- `?outputOnly=true` strips the workflow envelope. Without it, responses come back wrapped as `{ "output": [ { "data": … } ] }`.
- Only two actions exist, `schema` and `query`. Anything else returns `Unknown action <x>.`

### Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `401 Invalid token.` | The token was minted from the wrong domain or has expired. Re-mint it from `auth.product.federato.ai`. |
| `301 Moved Permanently` | The path shape is wrong. Check the `Location` header with `curl -i`, or use `--post301`. |
| `404 Cannot POST /handlers/trigger/...` | There are extra path segments after the handler slug. The 404 body echoes the path the router parsed. |
| `zsh: no matches found` | The shell is globbing the `?`. Quote the URL. |
| Query validates but returns 0 rows | A dot-path goes through an array. Use `$elemMatch`. |
| Errors come back as plain strings | The workflow rethrows `new Error(e.message)`. The code and details survive only inside the message text, e.g. `[VALIDATION_ERROR] Unknown operator "$grt" {"operator":"$grt"}`. **Parse the `[CODE]` prefix** if you need machine-readable errors. |

---

## 5. `DATA_SCHEMA.pdf` — how to read the schema response

- **Why the schema is discovered, not documented:** figuring out *what to ask for* is part of the challenge. The schema is **stable** for the duration of the event, so caching it is safe.
- The response describes each resource, for example:
  ```json
  { "Policy": { "type": "object", "fields": {
      "id": { "type": "number" },
      "hazard_tags": { "type": "array", "itemSchema": { "type": "string" } },
      "locations": { "type": "reference", "resource": "Location", "cardinality": "many" },
      "insured": { "type": "object", "fields": { "name": { "type": "string" } } } } } }
  ```
- Field types:
  - `object` has a `fields` map.
  - `array` has an `itemSchema`, which may be a scalar or an object.
  - `reference` has a target `resource` and a `cardinality` of `one` or `many`. It stores **an ID or an array of IDs**, not the record itself.
  - Everything else is a scalar: `string`, `number`, `boolean`, and so on.
- Expand references in the query pipeline to avoid N+1 lookups.
- The field names in this document's examples (`Policy`, `status`, `hazard_tags`, `locations`, `insured`) are **illustrative**. Confirm every one against the live schema.

---

## 6. `QUERY_REQUEST_BODY.pdf` — the query language (Mongo-flavored)

### Keys and pipeline order
Only `resource` is required. The stages run in this order, and omitted stages are skipped:

`where` → `expand` → `unwind` → `filter` → `over` → `select` → `sort` → `pagination`

- **`where`** filters raw records. **`filter`** filters hydrated rows after `expand` and `unwind`.
- Nested objects accept either nesting or dot-paths: `{"dates":{"effective":"2026-01-01"}}` is the same as `{"dates.effective":"2026-01-01"}`. **Arrays break dot-paths**, so use `$elemMatch` for them.

### Operators
`$eq` (deep equality), `$ne`, `$exists`, `$gt`/`$gte`/`$lt`/`$lte` (scalars), `$in`/`$nin` (scalars or arrays), `$contains` (substring or element), and `$elemMatch` (arrays only). The combinators are `$and`, `$or`, and `$not`. Several operators in one clause combine as an implicit AND.

```json
{ "where": { "status": "active",
             "$or": [ { "business_type": "renewal" }, { "premium": { "$gte": 100000 } } ],
             "$not": { "producer.broker": 2 } } }
```

### References
- **`expand` stage:** hydrates the record so that `filter`, `over`, `sort`, and `select` can reach through it. Equivalent forms: `{"producer":"broker"}`, `{"producer":{"broker":true}}`, `{"producer":{"broker":{}}}`. Chain by nesting: `{"exposure_units":{"location":{"buildings":true}}}`.
- **`$expand` select leaf:** resolves the reference in the output only, e.g. `{"broker":{"$expand":{"select":["name"]}}}`. It can nest.
- **Rule:** use `expand` when a later stage needs the referenced data. Use `$expand` when you only want it in the response.

### Projection (`select`)
Omit `select` to get the full record. There are two forms: an array (`["id","dates.effective"]`) or an object (`{"id":true,"dates":{"effective":true}}`). Each leaf is a field path, a `$expand`, or an aggregation.

### Aggregations
| Fn | Notes |
|---|---|
| `$sum` | Skips non-numeric and null values. The sum of nothing is 0. |
| `$avg` | Skips nulls. The average of nothing is null. |
| `$min` / `$max` | Skip nulls. Over nothing, the result is null. |
| `$count: true` | Counts every row, nulls included. |
| `$countDistinct` | Counts distinct non-null values. |

### Unwind, group, sort, paginate
- **`unwind`:** takes path strings or `{path, type}` objects. `"inner"` keeps only rows with elements (k ≤ N). `"left"` keeps all N parents.
- **`over`:** like SQL GROUP BY. The default is `["id"]`. Groups come back as flat projections in first-seen order, e.g. `{resource, total, groups:[…]}`. To regroup unwound rows back to one row per parent, use `over: ["id", "<array>.id"]`.
- **`sort`:** `[{field, direction}]`, where direction defaults to `asc` and **nulls sort last**. Sorting runs *after* `select`, so it can use derived fields such as `totalPremium`.
- **`pagination`:** `{limit, offset}`. `total` counts all matches regardless of pagination, so use it to confirm you fetched every record.

### Worked examples
1. **Non-expired policies with expanded insured:** `where status $ne expired` → `expand insured` → `filter insured.naics_code` → select policy and insured fields → sort by `insured.name`.
2. **Auto fleet summary:** `expand` + `unwind exposure_units` → `filter kind = vehicle` → `$count`, `$sum cost_new`, and `$min year` → sort by fleet cost.
3. **Pre-1990 buildings at catastrophe-exposed locations:** expand `insured` and `exposure_units → location → buildings` → unwind twice → filter on hazard tags, `sprinklered:false`, and `year_built ≤ 1990` → group by `exposure_units.location.state` → sum and max building `tiv`. This example shows the most likely data shape: **Policy → exposure_units → location → buildings**, with `tiv`, `year_built`, `sprinklered`, `hazard_tags`, and `state`. Still, **confirm it against the live schema.**

---

## 7. `APPETITE_GUIDELINES.pdf` — the scoring rules

**What appetite is:** the rules describing which submissions a carrier wants. The agent should use them to qualify submissions, explain prioritization, and help underwriters act faster. *"Guidelines equal underwriting strategy."*

**The suggested process:** read the rules, turn them into conditional logic (plus an LLM for explanations if you like; heavy ML is not needed), apply them to the API data, and show in-appetite versus out-of-appetite in the UI with an explanation and an optional score, color, or badge.

The document also gives generic example rules: "accept if Commercial Property and state = NY", "reject if premium < $50K", and "prioritize if submitted within the last 7 days". **These are illustrations only.** The 2025 table below is the authoritative rule set.

### 2025 Commercial Property Underwriting Guidelines
| Factor | Acceptable | Target | Not acceptable |
|---|---|---|---|
| Submission type | New business | — | Renewal business |
| Line of business | Property | — | All other lines |
| Primary risk state | OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT | OH, PA, MD, CO, CA, FL | All other states |
| TIV | Up to $150M | $50M–$100M | Over $150M |
| Total premium | $50K–$175K | $75K–$100K | Under $50K or over $175K |
| Building age | Built after 1990 | Built after 2010 | Built before 1990 |
| Construction type | >50% JM, non-combustible/steel, or masonry non-combustible | — | >50% other types |
| Loss value | Under $100,000 | — | Over $100,000 |

**Required data points:** account name, primary risk state, line of business, effective and expiration dates, TIV, construction type, building year, premium, and **five-year loss history**.

**Ambiguities the agent must handle explicitly:**
- **Exact boundaries are undefined.** The table does not say how to treat exactly 1990, exactly $150M, or a $100K loss. Pick an interpretation, document it, and flag boundary cases in the explanation.
- **"Primary" risk state and ">50%" construction imply multi-location submissions.** The state and the construction share must be derived, e.g. by TIV weighting. Show that derivation.
- **Building age with several buildings:** decide whether to use the oldest, a TIV-weighted value, or per-building, and say which.
- **Missing data** should be surfaced as "needs information", not silently scored as a pass or a fail.

---

## 8. `GLOSSARY.pdf` — domain vocabulary

- **Insurance:** protection against specific risks in exchange for a **premium**.
- **Underwriting:** evaluating a risk to decide whether to accept or reject it and how much to charge.
- **Carrier:** the insurance company.
- **Policy:** the contract between the insured and the carrier.
- **Premium:** what the customer pays for coverage.
- **Submission:** a request for insurance sent by a broker or agent. This is the unit we score.
- **RiskOps:** Federato's tools and workflows that help underwriters decide faster with data and AI.
- **Appetite:** the risks a carrier wants. **In-appetite** submissions are high priority. **Out-of-appetite** submissions don't fit the carrier's guidelines.
- **Data terms:** dashboard, API, SQL, JSON, filtering (e.g. "only submissions from California").

---

## 9. What this means for our build

- **Startup sequence:** mint a token → call `schema` and cache it → map the appetite factors to discovered fields (flag anything unmapped) → run a paginated query that expands the needed references → confirm `total` ≥ 50 → normalize → score **every** submission → rank → explain.
- **Show the agent's reasoning:** display which schema fields it picked for each factor, the queries it built and why, and any adaptive follow-up queries, such as deeper analysis of high-value or borderline submissions.
- **Scoring:** use deterministic rules from the table, with Target above Acceptable and Not acceptable as a hard or heavy penalty. Keep the score reproducible, and use an LLM only for wording the explanation.
- **Explanations:** cover the appetite match, the key factors with their actual values, contradictions, missing data, and a recommendation (review, accept, reject, or investigate).
- **Resilience:** parse the `[CODE]` error prefix, re-mint expired tokens, and degrade gracefully when an enrichment API fails.
- **Enrichment:** add it only after the core works. Use 1–2 sources (for example OpenFEMA flood or disaster data for the state or county) that **visibly change the ranking**, and explain the change.
- **Keep the product read-only.** A human underwriter makes the final decision.
