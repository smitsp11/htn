# Master Research Document — Hack the North 2026: AI Underwriting Agent (Federato)

> Consolidated from the three source PDFs in `documents/`:
> `STUDENT_PROJECT_GUIDELINES.pdf`, `APPETITE_GUIDELINES.pdf`, `GLOSSARY.pdf`.
>
> **Reading weight:** This synthesis deliberately over-weights the *later* sections of the
> source material — Common Pitfalls, the FAQ, Key Reminders, and the full appetite table.
> Those are the parts that resolve the ambiguities (auth, query mechanics, scope, scoring),
> so the **Final Conclusion** and the **Doubts Cleared** section below carry the most weight.

---

## 1. The Challenge in One Sentence

Build an **AI agent that thinks like an underwriter**: given a queue of 50+ commercial
insurance submissions from a mock API, it scores each against carrier appetite guidelines,
reasons about which data to request, ranks the queue to surface the best opportunities, and
**explains every decision in plain English**. This mirrors Federato's Forward Deployed
Engineering (FDE) work.

The graded differentiator is **reasoning + explainability**, not UI polish and not external
data enrichment.

---

## 2. What You're Given

| Asset | Detail |
|-------|--------|
| **Synthetic dataset** | 50+ realistic commercial property submissions, accessed via a mock API. |
| **Schema endpoint** | `POST .../federato-hack-north?outputOnly=true` with `{"action": "schema"}` → resources, fields, types, relationships. |
| **Query endpoint** | Same URL with `{"action": "query", "payload": {...}}` → filtering, sorting, pagination, aggregations. |
| **Appetite guidelines** | Real 2025 carrier criteria (see §4). |
| **Glossary** | Insurance/RiskOps terminology (see §3). |
| **External enrichment** | *Optional bonus only* — Nominatim, OpenFEMA, Open-Meteo are suggestions. |

Base endpoint:
`POST https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true`

---

## 3. Domain Vocabulary (Glossary Distilled)

- **Insurance / Premium / Policy** — customer pays a premium for a contract covering defined losses.
- **Underwriting** — evaluating risk to accept/reject an application and set price.
- **Carrier** — the insurance company.
- **Submission** — a broker/agent's request for insurance (the unit we score and rank).
- **Appetite** — the kinds of risk a carrier *wants*. **In-Appetite** = matches (high priority);
  **Out-of-Appetite** = doesn't align.
- **RiskOps** — Federato's tools/workflows helping underwriters decide faster with data + AI.
- **Tech**: Dashboard, API, SQL-style filtering, JSON responses.

The agent's whole job is turning **appetite → a ranked, explained queue** an underwriter can act on.

---

## 4. Appetite Guidelines — 2025 Commercial Property Carrier (Authoritative Scoring Table)

This table is the scoring backbone. "Target" is the sweet spot, "Acceptable" is fine,
"Not Acceptable" should be penalized or rejected.

| Factor | Acceptable | Target (sweet spot) | Not Acceptable |
|--------|-----------|---------------------|----------------|
| **Submission type** | New business | — | Renewal business |
| **Line of business** | Property | — | All other lines |
| **Primary risk state** | OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT | OH, PA, MD, CO, CA, FL | All other states |
| **TIV (Total Insured Value)** | Up to $150M | $50M–$100M | Over $150M |
| **Total premium** | $50K–$175K | $75K–$100K | Under $50K or over $175K |
| **Building age** | Newer than 1990 | Newer than 2010 | Older than 1990 |
| **Construction type** | >50% JM, non-combustible/steel, or masonry non-combustible | — | >50% other types |
| **Loss value (5-yr)** | Under $100,000 | — | Over $100,000 |

**Required data points behind these rules:** account name, primary risk state, line of
business, effective/expiration dates, TIV, construction type, building year, premium, and
five-year loss history.

**Scoring implication:** every submission should be resolvable on these 8 factors. A clean
scoring model gives each factor a Target/Acceptable/Not-Acceptable verdict, then combines
them. Contradictions (in-appetite on some, out on others) are expected and must be surfaced,
not hidden.

---

## 5. Recommended Build Path (Milestones)

The source frames these as *guidance, not a prescription* — order is flexible.

1. **Understand the domain** — appetite + glossary + query language feel.
2. **Discover the data shape** — call the schema endpoint at startup; save the schema; don't assume field names.
3. **Build query capability** — start with one simple query (e.g., active property policies in CA), test, iterate on filters/projections/pagination.
4. **Build agentic reasoning** ← *the differentiator*. A layer that translates a goal into queries (templating, rules, or LLM), inspects the schema, decides which queries help, executes, and adapts (e.g., broaden filter if few results). "Does your agent *think*?"
5. **Score and rank** — apply the §4 table; pick weighted / rules-based / LLM scoring; produce a top-N list.
6. **Add decision explanations** ← *critical*. 2–3 sentences per submission: appetite match + key factors + recommendation (review / accept / reject / investigate).
7. **Present results** — dashboard, CLI, report, or API. Clarity over polish.
8. **(Optional) Enrich** — 1–2 external APIs that *visibly* change ranking, with explanation.

**Example explanation format (from source):**
> **Policy #42: SCORE 87/100** — $45M TIV commercial property in CA matches your appetite
> targets. Building newer than 2010, premium $85K in range, no claims in 5 years.
> **Recommendation: Review for acceptance.**

---

## 6. Quality Bar — What "Good" Looks Like

- **MVP:** queries the API; applies appetite via logic; ranks by a calculated score; shows a list with brief explanations; handles 50+ submissions in reasonable time.
- **Strong:** + dynamic (non-hardcoded) query construction; detailed justifications; edge-case handling (missing fields, API issues); clean code + good error messages.
- **Exceptional:** + traceable agentic reasoning (why *these* queries); adaptive depth for high-value opportunities; transparent handling of contradictions; polished, immediately actionable output.
- **Bonus:** + 1–2 researched external APIs whose enrichment visibly influences ranking, with a clear explanation of the effect.

---

## 7. ⭐ Doubts Cleared — The Bottom-of-the-Docs Section (Highest Weight)

These are the FAQ / Common Pitfalls / Key Reminders answers that remove the ambiguity.
Treat this as the single most important operational reference.

### Auth (the #1 time sink)
- **401 Invalid token → you're minting from the wrong Auth0 domain.** Use
  **`auth.product.federato.ai`**, *NOT* the canonical domain. This is called out twice
  (setup guidance + FAQ) — it is the most common blocker.
- Get `client_id` / `client_secret` from organizers.
- **Tokens last 4 hours** — mint a fresh one for long sessions.

### Query language mechanics (silent-failure traps)
- **Dot-paths do NOT traverse arrays.** `{"locations.state": "CA"}` silently matches nothing.
  Use `$elemMatch`: `{"locations": {"$elemMatch": {"state": "CA"}}}`.
- **References return IDs, not values, unless expanded.** Selecting `producer.broker.name`
  gives you an ID like `2`. Use `$expand`:
  `{"select": {"producer": {"broker": {"$expand": {"select": ["name"]}}}}}`.
- **`where` vs `filter`:** `where` runs **before** references are expanded (pre-filter, use for
  whole-submission filters); `filter` runs **after** expansion (post-expansion filters).
- Queries support filtering, sorting, pagination, and aggregations (count policies, sum TIV, etc.).

### Scope & priorities (what NOT to over-invest in)
- **External enrichment is fully optional** — you can score highly without it. Confirmed three
  times (given-assets note, milestone, FAQ). Don't spend the hackathon on integrations.
- **Don't over-build UI.** 90%-UI / 10%-logic is an explicit anti-pattern. Priority order:
  **(1) agentic reasoning → (2) explanations → (3) UI polish.**
- **Don't hardcode every query** — build a small templating/rule/LLM layer. Hardcoding is
  "technically yes, but risky and less interesting."
- **Don't skip schema discovery** — call schema at startup; assuming field names breaks queries.
- **Don't ship scores without explanations** — underwriters can't act on a bare number.

### Freedoms confirmed
- **Any LLM is allowed** (Claude, ChatGPT, etc.) — no tool restrictions.
- **No web UI required** — CLI, dashboard, API, or printed output all fine; clarity > polish.
- **Milestone order is flexible** — combine/reorder as makes sense.
- If an external API goes down, **fail gracefully** (log, proceed without enrichment, or skip).

### Guiding mantras (Key Reminders)
- **Focus on reasoning** — the core challenge is *what data to request and why*.
- **Explain decisions** — the underwriter must understand *why* a submission ranks where it does.
- **Test early** — get one query working, then iterate; don't perfect schema understanding upfront.
- **Keep it simple** — clean code + clear explanations + working end-to-end beats fancy tech.

---

## 8. Final Conclusion & Recommended Strategy

**The winning move is a lean, transparent reasoning agent — not a data-integration project
and not a UI project.** Everything in the later, doubt-clearing sections of the source points
the same direction:

1. **Nail auth first, once.** Mint against `auth.product.federato.ai`, cache the 4-hour token,
   and stop losing time to 401s. This is the single highest-ROI first step.

2. **Discover, then trust, the schema.** Call the schema endpoint at startup and drive the
   agent off it. Never hardcode field names.

3. **Build a thin agentic query layer, not a query zoo.** A templating/rules (optionally
   LLM-assisted) layer that maps appetite factors → queries, uses `$elemMatch` for array
   fields (locations/states) and `$expand` for references (broker/producer), and picks
   `where` vs `filter` correctly. Let it adapt (broaden a filter when results are thin).

4. **Score on the §4 table, transparently.** Give each of the 8 appetite factors a
   Target/Acceptable/Not-Acceptable verdict, combine into a 0–100 score (weighting is fine),
   and **rank** to a top-N. Reject-level factors (renewal, non-property line, out-of-list
   state, TIV > $150M, premium out of band, pre-1990 buildings, combustible construction,
   >$100K losses) should dominate.

5. **Explanations are the deliverable, not an afterthought.** Every ranked submission gets
   2–3 sentences: how it matches appetite + key factors + an action recommendation, and it
   must **name contradictions openly** when a submission is in-appetite on some factors and
   out on others.

6. **Ship the simplest presentation that makes the ranking actionable.** A clean ranked table
   with per-submission breakdown and explanations clears the bar; only polish if time remains.

7. **Treat enrichment as a stretch goal.** Add 1–2 external signals *only after* the core loop
   is solid, and only if the enrichment **visibly changes** the ranking with a clear before/after
   explanation.

**Judged on:** *does the agent think, and can an underwriter trust and act on why?* Optimize
for traceable reasoning and clear, contradiction-aware explanations over everything else.
