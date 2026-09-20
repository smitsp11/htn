# Person 3 handoff — underwriting decision engine

Status: complete against the brief in `PERSON_3_DECISION_ENGINE.md`. Typecheck, the full test suite (89 tests), and the production build pass.

## Changed files

- `lib/domain/appetite.ts` — eight evaluators, `evaluateFactors`, `computeScore`, `deriveStatus`, `evaluateAppetite`, `rankSubmissions`.
- `lib/domain/explanation.ts` — new. Recommendation vocabulary and the deterministic three-sentence explanation.
- `lib/domain/format.ts` — new. Compact currency formatting for factor reasons ($40K, $160M).
- `components/factor-breakdown/` — new. `FactorBreakdown` component, local stylesheet, and an index that loads the stylesheet.
- `tests/appetite.test.ts` — rewritten as table-driven coverage of every factor tier, boundary, missing value, contradiction, and ordering rule.
- `tests/factor-breakdown.test.ts` — new. Server-render tests for the component.
- `tests/fixtures/domain/submissions.ts` — new. Named fixtures: full target, all acceptable, contradictory, missing losses, empty, multiple failures.

No frozen contract, API client, adapter, route, or dashboard file was touched.

## Decisions made

- **Score is naive and additive.** Target earns 2 points, acceptable earns 1, unknown and not acceptable earn 0. Four factors have a target tier, so the maximum is 12 points, scaled to 0–100. Weights are equal.
- **Status is a hard gate.** Any not-acceptable factor gives `out_of_appetite`. Otherwise any unknown gives `needs_investigation`. Otherwise `in_appetite`. A high score never overrides status; ranking sorts by status first.
- **Contradictions are named, not averaged.** When a submission has target matches and a failing factor, the explanation says the targets "do not offset" the failure. The score still reflects the targets so the underwriter can see how close it was.
- **Recommendation vocabulary.** "Review for acceptance", "Investigate missing or ambiguous data", "Review for likely decline". Nothing reads as accept, reject, or bind.
- **Explanation shape.** Always three sentences: name, score, and status; the material factors (failures first, then unknowns, then targets); the recommendation. Factor reasons carry the observed value so the breakdown is self-explanatory.
- **Tie-break.** Status, then score descending, then account name, then id. The id makes the order stable when two accounts share a name.
- **Invalid numbers are unknown.** Zero or negative TIV and premium, negative losses, non-integer building years, construction shares below 0 or above 100, and non-finite values all become `unknown` rather than being silently scored. Zero losses stay acceptable.
- **Construction input.** The evaluator accepts either a 0–1 ratio or a 0–100 percentage. Exactly 1 is read as 100%. This guess is documented in the code and should go away once Person 2 commits to one format.

## Business interpretations needing engineer confirmation

The PDF leaves three exact boundaries unclassified. All three currently produce `unknown`, which forces `needs_investigation`:

1. A building year of exactly 1990. "Newer than 1990" and "older than 1990" both exclude it.
2. Five-year losses of exactly $100,000. "Under" and "over" both exclude it.
3. An exact 50/50 construction split. Both rows say "more than 50%".

Inclusive reads I applied without asking, because the wording supports them: TIV of exactly $150M is acceptable ("up to"), premium of exactly $50K and $175K is acceptable, and the target bands ($50M–$100M, $75K–$100K) are inclusive at both ends. Change the constants at the top of `appetite.ts` if the carrier disagrees.

## Integration notes for Person 4

- Import the component from `@/components/factor-breakdown`. Its stylesheet is loaded once via `@import` in `app/globals.css`, which keeps the component tree renderable in node tests. Props are `{ submission: RankedSubmission }`.
- The component shows status before score, a verdict tally, all eight factor cards, and the recommendation. It does not show dates or the account name; those stay in the details shell.
- The dashboard detail view now composes this component (done as part of the Person 4 work). Its class names are prefixed `fb-` so nothing collides.

## Integration notes for Person 2

- `constructionDescription` is in the contract but unused by the engine. The engine only reads `approvedConstructionPercentage`.
- Please deliver `approvedConstructionPercentage` as a 0–1 ratio. The engine tolerates percentages, but a value of exactly 1 is ambiguous and is read as 100%.

## Addendum 2026-09-20 — distance, sensitivity, provenance, portfolio

Implemented by the engineer's integration session across workstreams (engine, adapter, UI) with the engineer's approval for the additive contract fields below. Merged onto main on 2026-09-20 after PRs 16–22 landed; typecheck, 363 tests, and the production build pass.

### Contract changes (`lib/domain/types.ts`, all optional and additive)

- `CanonicalSubmission.buildingSchedule?: BuildingFact[]` — per-building `{ year, value, constructionType }` from the query agent, so the engine can state sensitivity to the oldest-building rule.
- `CanonicalSubmission.derivations?: Partial<Record<FactorKey, FactorEvidence>>` — provenance per factor from the adapter's derivation notes. Stripped from the ranked row; it reaches the UI only as `FactorEvaluation.evidence`.
- `FactorEvaluation.detail?`, `nearMiss?`, `evidence?`.

### Engine decisions (`lib/domain/appetite.ts`, `lib/domain/explanation.ts`)

- **Ranking order:** status, then fewest not-acceptable factors, then score descending, then name, then id. A one-fix row now outranks a two-fix row that counts the same good factors. Score formula unchanged.
- **Near-miss band:** within 5% of a money boundary, 2 years of 1990, or 5 points of 50% construction. Sets `nearMiss: true`; verdict unchanged.
- **Deltas in reasons:** every out-of-range numeric reason states the distance ("Premium $176K is $1K above the $175K maximum").
- **Building-year sensitivity:** when the schedule has 2+ dated buildings, `detail` states the oldest building's share of value, how many were built after 1990, and what the value-weighted year would conclude. The verdict still follows the oldest building.
- **Explanation:** the not-acceptable clause now carries each factor's observed value. Unknown factors stay as labels; the completeness checklist already separates absent from ambiguous.

### Adapter (`lib/federato/assemble.ts`, `lib/federato/adapter.ts`)

- Emits `buildingSchedule` and `derivations` on every assembled submission. Scalar factors read directly get "Read directly from the record." with the schema path; aggregates get their derivation note; absent fields on unbound rows get the no-policy note. `refreshDerivations` re-applies notes after the follow-up pass so a follow-up's note replaces the first pass.

### UI

- `components/ui/distance-chips.tsx` (queue rows): "One fix away", "Near miss · factor", "N factors out".
- `components/queue/portfolio-insights.tsx` (under the W7 metric strip) and `lib/rankings/portfolio-insights.ts`: book shape, failure leaderboard, premium-band fit, appetite drift from bound accounts, one-fix-away count. Also appended to the decision trace.
- Review tab appetite breakdown (the property tab was folded into it on main): near-miss badge, sensitivity note, and a provenance line (source path, method, confidence, ambiguity) under each factor.
- Case summary shows the distance chips under the recommendation; the methodology dialog describes the new ordering and bands. Near-miss logic lives in `lib/domain/appetite/lines/property.ts` (property bands) and `lib/domain/appetite/lines/helpers.ts` (5% money band for the synthesized lines).

### Tests

`tests/near-miss.test.ts`, `tests/portfolio-insights.test.ts`, `tests/derivations.test.ts` (new); expectations updated in `tests/appetite.test.ts` (explanation values) and `tests/federato-adapter.test.ts` (two new canonical keys).

### Not done, by decision

FEMA hazard as a rank tie-breaker was not implemented; it needs an explicit engineer ruling on whether reordering within equal status and score is compatible with the "enrichment never changes rank" scope rule.
