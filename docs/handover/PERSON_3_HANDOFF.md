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
