import type { FactorKey, HazardEntry, RankedSubmission } from "@/lib/domain/types";
import { fixturesFor } from "@/lib/demo/fixtures";
import { Icon } from "@/components/ui/icon";

/** The flood-related hazard entry from the enrichment layer, if any. */
function floodHazard(topHazards: HazardEntry[]): HazardEntry | undefined {
  return topHazards.find((hazard) => hazard.type.toLowerCase().includes("flood"));
}

/** What would resolve each factor, keyed the same as the appetite engine's FactorKey. */
const VERIFY_NEXT: Record<FactorKey, string> = {
  submissionType: "Confirm new business vs. renewal with the broker.",
  lineOfBusiness: "Confirm the recorded line of business.",
  primaryRiskState: "Confirm the primary risk state for the insured locations.",
  tiv: "Request a statement of values with total insured value.",
  totalPremium: "Request the quoted total premium.",
  buildingYear: "Confirm the year built for the oldest insured building.",
  construction: "Confirm the approved-construction percentage across the schedule.",
  fiveYearLossValue: "Request a five-year loss run.",
};

/**
 * Research digest, AI notes, and sources, ported from federanorth's `researchPanel` /
 * `researchDigest` (`src/decision/research-panel.js`). The hazard digest and the AI notes are
 * both real per-submission data: hazard comes straight from `submission.enrichment` (FEMA NRI),
 * and each note is generated from an actually-unresolved factor and its real engine reason --
 * neither recomputes or overrides `submission.status`/`submission.score`. Only the source links
 * below are a fixed reference list (`lib/demo/fixtures.ts`), since there is no per-submission
 * address in this app's schema to research against.
 */
export function ResearchPanel({ submission }: { submission: RankedSubmission }) {
  const sources = fixturesFor(submission.id).research.sources;
  const enrichment = submission.enrichment;
  const hazard = enrichment ? floodHazard(enrichment.topHazards)?.rating ?? enrichment.compositeRating : undefined;

  const notes = submission.factors
    .filter((factor) => factor.verdict === "unknown")
    .map((factor) => ({ factorLabel: factor.label, reading: factor.reason, verifyNext: VERIFY_NEXT[factor.key] }));

  return (
    <details className="research-panel" aria-label="Submission research">
      <summary className="research-heading">
        <div>
          <span className="eyebrow">RESEARCH</span>
          <h3>Property risk research</h3>
        </div>
      </summary>

      <section className="research-digest">
        <div className="digest-heading">
          <h4>Research at a glance</h4>
          {enrichment ? <span>FEMA NRI as of {enrichment.asOf}</span> : null}
        </div>
        {enrichment ? (
          <>
            <div className="digest-grid">
              <div>
                <small>Composite hazard rating</small>
                <strong>{hazard}</strong>
              </div>
              {enrichment.compositeScore != null ? (
                <div>
                  <small>NRI score</small>
                  <strong>{enrichment.compositeScore}</strong>
                </div>
              ) : null}
            </div>
            {enrichment.topHazards.length > 0 ? (
              <ul className="digest-hazards">
                {enrichment.topHazards.map((entry) => (
                  <li key={entry.type}>
                    {entry.type}: {entry.rating}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p>No FEMA hazard enrichment available for this submission.</p>
        )}
      </section>

      {notes.length > 0 ? (
        <div className="research-ai">
          <h4>AI notes</h4>
          {notes.map((note) => (
            <details className="brief ai-note" key={note.factorLabel}>
              <summary>
                <strong>{note.factorLabel}</strong>
                <span>AI context</span>
              </summary>
              <p className="brief-reading">{note.reading}</p>
              {note.verifyNext ? (
                <p className="brief-watch">
                  <b>Verify next:</b> {note.verifyNext}
                </p>
              ) : null}
            </details>
          ))}
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="research-sources">
          {sources.map((source) => (
            <article className="research-source" key={source.label}>
              <header>
                <b>{source.label}</b>
              </header>
              <p>
                <a href={source.href} target="_blank" rel="noopener noreferrer">
                  <Icon name="globe" /> View source
                </a>
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </details>
  );
}
