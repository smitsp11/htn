import type { HazardEntry, RankedSubmission } from "@/lib/domain/types";
import { fixturesFor } from "@/lib/demo/fixtures";
import { Icon } from "@/components/ui/icon";

/** The flood-related hazard entry from the enrichment layer, if any. */
function floodHazard(topHazards: HazardEntry[]): HazardEntry | undefined {
  return topHazards.find((hazard) => hazard.type.toLowerCase().includes("flood"));
}

/**
 * Research digest, AI briefs, and sources, ported from federanorth's `researchPanel` /
 * `researchDigest` (`src/decision/research-panel.js`). Enrichment (FEMA hazard data) and the
 * static demo research bundle are presentational only: nothing here recomputes or overrides
 * `submission.status` / `submission.score` / `submission.explanation` from the deterministic
 * appetite engine.
 */
export function ResearchPanel({ submission }: { submission: RankedSubmission }) {
  const research = fixturesFor(submission.id).research;
  const hazard = submission.enrichment
    ? floodHazard(submission.enrichment.topHazards)?.rating ?? submission.enrichment.compositeRating
    : undefined;
  const floodZone = hazard ?? research.femaFloodZone;

  return (
    <details className="research-panel" aria-label="Submission research">
      <summary className="research-heading">
        <div>
          <span className="eyebrow">RESEARCH</span>
          <h3>Property risk research</h3>
        </div>
        <span className="research-hint">Local risk context — FEMA, weather, sources</span>
      </summary>

      <section className="research-digest">
        <div className="digest-heading">
          <h4>Research at a glance</h4>
          {submission.enrichment ? <span>FEMA NRI as of {submission.enrichment.asOf}</span> : null}
        </div>
        <div className="digest-grid">
          <div>
            <small>Location match</small>
            <strong>{research.locationMatch}</strong>
          </div>
          <div>
            <small>FEMA flood zone</small>
            <strong>{floodZone}</strong>
          </div>
          <div>
            <small>Current weather</small>
            <strong>{research.currentWeather}</strong>
          </div>
        </div>
      </section>

      {research.notes.length > 0 ? (
        <div className="research-ai">
          <h4>
            AI notes <span>{research.notes.length}</span>
          </h4>
          {research.notes.map((note) => (
            <details className="brief ai-note" key={note.factorLabel}>
              <summary>
                <strong>{note.factorLabel}</strong>
                <span>AI context</span>
              </summary>
              <p className="brief-reading">{note.reading}</p>
              <p className="brief-watch">
                <b>Verify next:</b> {note.verifyNext}
              </p>
              <p className="brief-basis">Based on: {note.basedOn}</p>
            </details>
          ))}
        </div>
      ) : null}

      {research.sources.length > 0 ? (
        <details className="research-sources" open>
          <summary>Sources · {research.sources.length}</summary>
          {research.sources.map((source) => (
            <article className="research-source" key={source.label}>
              <header>
                <b>{source.label}</b>
                <span>{source.status}</span>
              </header>
              <p>
                <a href={source.href} target="_blank" rel="noopener noreferrer">
                  <Icon name="globe" /> View source
                </a>
              </p>
            </article>
          ))}
        </details>
      ) : null}

      <p className="research-notice">
        Research and AI notes are context only. They never change the appetite score or status —
        only the deterministic engine does that.
      </p>
    </details>
  );
}
