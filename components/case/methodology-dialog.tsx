"use client";

import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";

export interface MethodologyDialogProps {
  open: boolean;
  onClose(): void;
}

/**
 * Points a factor earns per verdict, restated for display. Mirrors
 * `SCORE_POINTS`/`MAX_SCORE_POINTS` in `lib/domain/appetite.ts` -- this dialog
 * is explanatory copy, not a second scoring implementation, so the numbers
 * below must stay in lockstep with that module.
 */
const WEIGHTS: { label: string; points: number }[] = [
  { label: "Submission type", points: 1 },
  { label: "Line of business", points: 1 },
  { label: "Primary risk state", points: 2 },
  { label: "Total insured value", points: 2 },
  { label: "Total premium", points: 2 },
  { label: "Building year", points: 2 },
  { label: "Construction type", points: 1 },
  { label: "Five-year losses", points: 1 },
];

const ASSUMPTIONS: string[] = [
  "Target verdicts exist only for the four factors with a published target band -- primary risk state, TIV, total premium, and building year. The other four factors (submission type, line of business, construction, five-year losses) only ever reach \"acceptable\" or \"not acceptable\".",
  "A single not-acceptable factor is a hard gate: the submission is out of appetite regardless of how many other factors are favorable, and the score is informational only in that case.",
  "Any unresolved (\"unknown\") factor -- a missing value, or a value the guidelines don't classify, such as a building from exactly 1990 or a 50/50 construction split -- moves the submission to needs-investigation instead of a verdict.",
  "Renewal business is never acceptable under the current guidelines; only new business is scored as acceptable for the submission-type factor.",
  "A line of business is only in scope for this appetite table when it is commercial property; every other recognized line is out of scope and is never scored.",
];

const INTERPRETATIONS: { factor: string; detail: string }[] = [
  {
    factor: "Primary risk state",
    detail:
      "OH, PA, MD, CO, CA, and FL are target states. NC, SC, GA, VA, and UT are acceptable but not target. Any other state is not acceptable.",
  },
  {
    factor: "Total insured value (TIV)",
    detail: "$50M–$100M is the target band. Above that, up to $150M is acceptable. Above $150M is not acceptable.",
  },
  {
    factor: "Total premium",
    detail:
      "$75K–$100K is the target band. $50K–$175K overall is acceptable. Below $50K or above $175K is not acceptable.",
  },
  {
    factor: "Building year",
    detail:
      "Built after 2010 is target. Built after 1990 (but 2010 or earlier) is acceptable. Built before 1990 is not acceptable. Built in exactly 1990 is unresolved -- the guidelines don't say which side of the line it falls on.",
  },
  {
    factor: "Construction type",
    detail:
      "More than 50% approved construction is acceptable; less than 50% is not acceptable. Exactly 50/50 is unresolved and needs an underwriter call, not a broker chase.",
  },
  {
    factor: "Five-year losses",
    detail: "Under $100K is acceptable; over $100K is not acceptable. Exactly $100K is unresolved.",
  },
];

/**
 * Methodology explainer: how the deterministic appetite engine scores and
 * gates a submission, in the underwriter's own words. Ported from
 * federanorth's `#method-dialog` (src/decision/dashboard.js), adapted to this
 * repo's actual scoring function (`evaluateFactors`/`computeScore`/
 * `deriveStatus` in `lib/domain/appetite.ts`) rather than the source's
 * `report.rules` object, which this codebase doesn't have.
 */
export function MethodologyDialog({ open, onClose }: MethodologyDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <button type="button" className="icon-button close-dialog" aria-label="Close methodology" onClick={onClose}>
        <Icon name="x" />
      </button>
      <div className="eyebrow">COMMERCIAL PROPERTY</div>
      <h2>Appetite &amp; scoring methodology</h2>
      <p className="method-intro">Transparent rules. Traceable recommendations.</p>

      <section>
        <h3>How the score works</h3>
        <p>
          Every submission is checked against eight factors. A target verdict earns 2 points, an acceptable verdict
          earns 1 point, and an unknown or not-acceptable verdict earns 0 points. Points are summed and scaled to
          100 against a maximum of 12. The scoring weight for each factor below is its maximum contribution to that
          total.
        </p>
        <div className="weight-grid">
          {WEIGHTS.map((weight) => (
            <div key={weight.label}>
              <span>{weight.label}</span>
              <b>
                {weight.points}
                <small> pt{weight.points === 1 ? "" : "s"} max</small>
              </b>
            </div>
          ))}
        </div>
        <p>
          The score never overrides status: a single not-acceptable factor caps the submission at out of appetite no
          matter how high the raw point total runs, and any unresolved factor holds the submission at
          needs-investigation until it is answered. Scores are priorities for triage, not probabilities or binding
          decisions.
        </p>

        <h3>Factor interpretations</h3>
        <p className="method-hint">Open a factor to see how its verdict is decided.</p>
        <div className="method-accordion">
          {INTERPRETATIONS.map((item) => (
            <details className="method-item" key={item.factor}>
              <summary>{item.factor}</summary>
              <p>{item.detail}</p>
            </details>
          ))}
          <details className="method-item">
            <summary>Assumptions &amp; edge cases</summary>
            <ul>
              {ASSUMPTIONS.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </details>
          <details className="method-item">
            <summary>Data &amp; sources</summary>
            <p>Guideline source: documents/APPETITE_GUIDELINES.pdf (2025 commercial-property appetite table).</p>
            <p>
              Submission data comes from Federato&rsquo;s supplied API through the Auth0-authenticated flow.
              Enrichment (FEMA National Risk Index hazard data) is decision support only &mdash; it never changes a
              score or status, it only adds location context.
            </p>
          </details>
        </div>
      </section>
    </Dialog>
  );
}
