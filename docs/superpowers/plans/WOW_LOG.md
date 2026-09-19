# Wow-Factor Backlog & Build Log

Running log + prioritized backlog for the "productionize the underwriting agent" work.
Grounded in four research briefs (competitor teardown, adjacent-industry patterns,
underwriter day-in-the-life) summarized in `docs/superpowers/specs/` when each feature
is picked up.

## How we work

- **One plan per feature.** Each backlog item below gets its own full
  `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` implementation plan — written only
  when we pick it up, so later plans reflect what we learned building earlier ones.
- **One feature at a time, diligently.** TDD, frequent commits, green
  `typecheck` / `test` / `build` before moving on.
- **Respect workstream ownership.** Only edit files owned by the current person's
  brief. Shared / frozen-contract changes (`lib/domain/types.ts`) get described to the
  engineer for approval before editing — not edited unilaterally.
- Update the **Running Log** at the bottom every session so context survives resets.

## The pitch this backlog serves

Federato tells an underwriter *which* submissions to look at. We do that **and** resolve
the missing data, show where every number came from, and draft the broker follow-ups — so
the underwriter spends the day deciding, not chasing. Three sourced numbers behind it:

1. **30–40%** of underwriter time is admin / re-keying, not risk analysis (McKinsey; Accenture).
2. **~58%** of submissions arrive missing a mandatory field; **~60%** are never fully processed.
3. **76%** of execs won't trust AI they can't explain — explainability is the adoption gate.

Our architecture is the antidote: deterministic engine decides every verdict, the LLM only
phrases and fetches, every value traces to a rule and a named source.

---

## Backlog (priority order)

Status legend: `queued` · `planning` · `building` · `blocked` · `done`

### W1 — Appetite flag taxonomy (red / yellow / preferred chips)
- **Status:** DONE (2026-09-19) → plan `2026-09-19-w1-flag-taxonomy.md`. Built on branch
  `federato-prompt-improvement`, 4 commits, 179/179 tests green, PR opened to `main`.
- **Goal:** Render the existing `RankedSubmission.factors[]` verdicts as color-coded chips
  (`not_acceptable` = red, `unknown` = yellow, `target`/`acceptable` = preferred/green) with
  the factor `reason` on hover — the Kalepa "score shows its work / trust-or-override" pattern.
- **Why:** Explainability is the adoption gate (brief #3). We already compute the signal and
  throw it away into one number.
- **Scope / files:** UI only (`components/dashboard/*`). No engine or contract change.
- **Owner:** Person 4 (product UI).
- **Risk:** none (pure presentation over data that already exists).

### W2 — "In Good Order" completeness view + Effort-to-Decision axis
- **Status:** DONE (2026-09-19) → plan `2026-09-19-w2-in-good-order.md`. Built on branch
  `federato-prompt-improvement`, stacked onto PR #3. `lib/rankings/completeness.ts` +
  In Good Order detail panel. 184/184 tests green. Exports `effortToDecision` for W6.
- **Goal:** For each submission, show a completeness checklist derived from `unknown` factors
  ("3 fields between this and a quote"), and add an **Effort-to-Decision** measure so the queue
  can be read as *appetite × completeness* (Convr's shipped "fast-flow / referral / decline" lanes;
  Indico's "In Good Order" checklist).
- **Why:** Turns dead `needs_investigation` rows into an actionable gate; matches the
  "expose missing or contradictory data" mandate.
- **Scope / files:** completeness derivation could live in a new `lib/` module reading existing
  `factors[]` (no contract change) + UI. Confirm module ownership.
- **Owner:** Person 4 (UI) + possibly Person 3 (derivation helper).
- **Risk:** low (reads existing fields; adds a derived view, not a new verdict).

### W3 — Missing-data enrichment waterfall + provenance chips (the ENGINE)
- **Status:** DONE (2026-09-19) → plan `2026-09-19-w3-enrichment-waterfall.md`. Built on branch
  `w3-enrichment-waterfall` (stacked PR on `federato-prompt-improvement`). Engineer confirmed the
  context-not-silent-rescore stance. 190/190 tests green. Ships honest empty chains (every gap →
  "Request from broker"); provenance chips ready. **W8 plugs its sources into `resolve-submission.ts`.**
- **Role:** the source-agnostic waterfall + provenance + resolution map.
- **Goal:** Per missing required field, run a cheapest-first source chain (Federato field →
  free inference → external dataset), stop at first confident source, record which source won,
  and show a provenance chip (`value · source · confidence · as-of`) with click-through.
  (Clay waterfall + Indico/Nutrient field-level confidence + provenance.)
- **Why:** Directly attacks the ~58% missing-field / admin-time bottleneck.
- **Scope / files:** enrichment layer (`lib/enrichment/*`), provenance types, UI.
- **Owner:** Person 3/4 + **engineer approval** — lets a *resolved* field change status, which
  brushes the "enrichment must not change appetite" rule and the frozen `CanonicalSubmission`
  contract. Frame as "filling a documented required field so the deterministic engine can run,"
  not "enrichment inventing a verdict."
- **Risk:** medium (scope + contract). **Do not build unilaterally.**

### W4 — RFI broker-chase loop (draft, human-approved)
- **Status:** DONE (2026-09-19) → plan `2026-09-19-w4-rfi-broker-chase.md`. Built on branch
  `w4-rfi-broker-chase` (individual PR #5, stacked on PR #4). `lib/agent/rfi.ts` deterministic draft
  + copy-only component + detail disclosure. Draft-only (no send path). 193/193 tests green.
- **Goal:** Per submission, list gaps vs. the required-field schema, auto-**draft** (not send)
  a broker Request-For-Information email (checklist of exactly the missing items), and re-run
  the engine + re-rank when the answer lands. (FurtherAI RFI loop; Alloy "route only exceptions
  to a human"; kept draft-only for the read-only / compliance stance.)
- **Why:** Eliminates the admin round-trips (1.4 broker touchpoints per incomplete submission).
- **Scope / files:** `lib/agent/*` tool + UI. Read-only guardrail: draft only, never auto-send.
- **Owner:** Person 4 + engineer sign-off on the outbound-drafting behavior.
- **Risk:** medium (outward-facing content; keep human-in-the-loop).

### W5 — Agentic narration layer around the deterministic engine
- **Status:** DONE (2026-09-19) → plan `2026-09-19-w5-agentic-narration.md`. Built on branch
  `w5-agentic-narration` (individual PR #6, stacked on PR #5). `lib/domain/counterfactual.ts`
  (`whatWouldFlip`) + ask.ts tool + contradiction-first prompt. Grounding proven in tests (LLM is
  handed the engine's flip result; phrasing turn forbids tools). 197/197 tests green.
- **Goal:** Extend the grounded LLM ask-layer with (a) **contradiction-first** phrasing and
  (b) a **"what would flip this"** counterfactual tool (min factor change to raise status),
  and (c) missing-vs-out-of-appetite distinction. The engine still owns every number.
- **Why:** Makes the agent *reason* like an underwriter (the graded differentiator) without
  letting the LLM decide appetite.
- **Scope / files:** `lib/agent/ask.ts` (system prompt + tools). Aligns with existing ask layer.
- **Owner:** Person 4 (ask layer owner) — confirm.
- **Risk:** low-medium (prompt/tooling; keep verdicts deterministic).

### W6 — Appetite × Completeness 2×2 quadrant queue view
- **Status:** planned → `docs/superpowers/plans/2026-09-19-w6-appetite-completeness-quadrant.md` (depends on W2)
- **Goal:** Visual quadrant (work-now / worth-effort / selective / deprioritize) instead of a
  flat ranked list — Federato's own signature mechanic, but with our honest second axis
  (completeness/effort, not a black-box winnability score).
- **Why:** Beats FIFO framing; reads as senior underwriting tooling.
- **Scope / files:** UI, depends on W2's Effort-to-Decision measure.
- **Owner:** Person 4.
- **Risk:** low (presentation; depends on W2).

### W7 — Portfolio-impact strip ("Control Tower" lite)
- **Status:** planned → `docs/superpowers/plans/2026-09-19-w7-portfolio-strip.md` (stretch; build after W1/W2)
- **Goal:** Header strip showing queue-level aggregates (total TIV, state concentration, hazard
  exposure) and how the selected submission shifts them.
- **Why:** Highest-end differentiator; signals portfolio-level thinking.
- **Scope / files:** UI + a small aggregation helper over already-ranked submissions.
- **Owner:** Person 4.
- **Risk:** low (read-only aggregation).

### W8 — Multi-channel consolidation (Browserbase) — THE SHOWPIECE
- **Status:** planned → `docs/superpowers/plans/2026-09-19-w8-multichannel-consolidation.md` (depends on W3)
- **Goal:** consolidate data the broker *already sent but scattered* across email / SOV / portal
  into the canonical record — resolving "missing" fields from where the broker actually put them,
  cutting the ~1.4 broker follow-ups without contacting the broker. A browser agent
  (Browserbase/Stagehand, or local Playwright) drives the channels; every value carries channel
  provenance ("consolidated from broker email").
- **Why:** most "missing" data isn't missing — it's buried. This is the strongest pitch/demo moment.
- **Scope / files:** staged synthetic scattered scenario (Federato green-lit synthetic data) →
  `lib/consolidation/*` → build-time `scripts/consolidate.ts` → feeds W3's `resolve-submission.ts`
  as top-priority source. Optional live Browserbase adapter (key-gated) for the on-stage wow.
- **Owner:** Person 4 + whoever owns W3. **Depends on W3.**
- **Risk:** medium (browser automation demo risk kept OUT of the runtime; default path deterministic).

### W9 — Government / public-data enrichment (context-only)
- **Status:** planned → `docs/superpowers/plans/2026-09-19-w9-public-data-enrichment.md`
- **Goal:** attach public/government context signals (flood zone, Census, OSHA, business registry…)
  to each submission — decision-support that **never changes appetite** (the FEMA pattern extended).
- **Why:** the "enrich decision-making with public data" idea, kept honestly separate from the
  broker-gap-filling flow. Lower wow, but real and easy (public sources cache cleanly like FEMA).
- **Scope / files:** additive `context?: ContextSignal[]` on `RankedSubmission` (same nod as the
  FEMA `enrichment` field) + `lib/enrichment/context.ts` + `scripts/fetch-context.ts` + read-only panel.
- **Owner:** Person 3/4 + contract sign-off (additive field). **Independent.**
- **Risk:** low (context-only; mirrors existing FEMA plumbing). Decision needed: which public source first.

---

## Running Log

### 2026-09-19
- Completed four research briefs (Federato/Kalepa/Cytora/Send/hyperexponential/Convr/Indico/
  Planck/Gradient competitor teardown; adjacent-industry patterns in clinical triage, lending,
  sales enrichment, e-discovery, KYC; underwriter day-in-the-life with sourced bottleneck stats).
- Read current main-branch engine (`lib/domain/appetite.ts`, `explanation.ts`, `types.ts`),
  pipeline, hazard enrichment, and the ask layer (`lib/agent/ask.ts`). Key finding: every missing
  field dead-ends at `unknown` → this is the wedge.
- Created this log + prioritized backlog (W1–W7).
- Removed the project `CLAUDE.md` (staged deletion; person-assignment/scope ceremony dropped at
  engineer's request; restore via `git restore --staged CLAUDE.md && git checkout CLAUDE.md`).
- Wrote full TDD plans for **W1** (flag taxonomy) and **W2** (In Good Order + Effort-to-Decision),
  grounded in the real components (`queue-table.tsx`, `submission-detail.tsx`, `factor-breakdown.tsx`,
  `presentation.ts`). Both are pure-helper-first + presentational, zero engine/contract change.
- Wrote full TDD plans for **W3–W7** as well. All seven features (W1–W7) now have complete,
  no-placeholder, TDD-structured plans in `docs/superpowers/plans/`.
- Decision: **plans only, no build yet** (per engineer). Code untouched (only CLAUDE.md removal + docs).

## Recommended build order (dependencies)

1. **W1** flag taxonomy — DONE.
2. **W2** In Good Order + `effortToDecision` — DONE; unblocks W6.
3. **W5** agentic narration — independent (reasoning differentiator).
4. **W6** quadrant — needs W2 (ready).
5. **W3** enrichment waterfall (the engine) — needs scope sign-off; unblocks W8.
6. **W8** multi-channel consolidation — needs W3; THE showpiece (staged synthetic scenario + Browserbase).
7. **W4** RFI draft — needs W2 + draft-only sign-off (the "what W8 couldn't find" chase).
8. **W9** public-data enrichment — independent; context-only; needs which-source decision.
9. **W7** portfolio strip — stretch; after W1/W2.

**The gap-closing trio, in order:** W3 (engine) → W8 (find what the broker already sent, scattered)
→ W4 (draft a chase only for what's *genuinely* still missing). Together they attack the ~1.4
broker round-trips end to end.

- **Built W1** (flag taxonomy) end-to-end on this branch: `lib/rankings/flags.ts` + queue-table
  Flags column + chip styles, TDD (helper test + render test). `typecheck` clean, `npm test`
  179/179 green, `npm run build` succeeds. Four commits. PR opened to `main`.
- **Next:** engineer picks the next feature (recommend W2 → then W5/W6); I execute its plan task-by-task.

### 2026-09-19 (later)
- Disentangled the "reduce broker back-and-forth" idea into three distinct capabilities:
  W3 (engine to resolve gaps), **W8** (consolidate what the broker already sent, scattered across
  channels — the Browserbase vision), **W4** (chase only what's truly missing). Public/government
  data split out as **W9** (context-only, never changes appetite).
- Wrote full TDD plans for **W8** (multi-channel consolidation via Browserbase; staged synthetic
  scattered scenario feeding W3) and **W9** (public-data enrichment mirroring the FEMA pattern).
- Reframed **W3** as the source-agnostic engine; W8/W9 plug into it. Federato green-lit synthetic
  supporting data + synthesized guidelines, so W8's staged scenario and a live demo are legitimate.
- **Decisions still open:** (1) W3 "context-not-silent-rescore" stance; (2) W9's first public source;
  (3) whether W8's live Browserbase adapter is worth wiring vs. the deterministic fixture default.
