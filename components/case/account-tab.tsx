import type { RankedSubmission } from "@/lib/domain/types";
import { fixturesFor } from "@/lib/demo/fixtures";
import { Icon } from "@/components/ui/icon";
import { ContextSignals } from "@/components/context-signals/context-signals";

/**
 * Case account-context tab: underwriting signals, relationship / loss-history
 * / broker leads, and source-record IDs. Ported from federanorth's
 * `signalsPanel`/`relationshipPanel`/`lossPanel`/`brokerPanel` and the
 * `case-account` source-records markup (src/decision/{casefile,dashboard}.js).
 * Everything here comes from the static demo fixture bundle
 * (`lib/demo/fixtures.ts`) plus `submission.id`; none of it is scored --
 * appetite status/score/explanation are set entirely by the deterministic
 * engine before this tab ever renders.
 */
export function AccountTab({ submission }: { submission: RankedSubmission }) {
  const bundle = fixturesFor(submission.id);

  return (
    <div className="account-tab">
      <div className="section-title">
        <h3>Underwriting signals</h3>
        <span>
          {bundle.signals.length} signal{bundle.signals.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="signal-list">
        {bundle.signals.map((signal) => (
          <article className={`signal tone-${signal.tone}`} key={signal.headline}>
            <span className="signal-dot" />
            <div>
              <strong>{signal.headline}</strong>
              <p>{signal.detail}</p>
            </div>
          </article>
        ))}
      </div>

      <ContextSignals signals={submission.context ?? []} />

      {bundle.leads.length > 0 ? (
        <div className="context-card">
          <div className="section-title">
            <h3>Relationship &amp; loss-history context</h3>
            <span>{bundle.leads.length} items</span>
          </div>
          {bundle.leads.map((lead) => (
            <div key={lead.label} className="lead">
              <header>
                <span className="lead-kind">{lead.kind}</span>
                <strong>{lead.label}</strong>
              </header>
              <b className="lead-value">{lead.value}</b>
              <p>{lead.detail}</p>
              {lead.caution ? (
                <p className="context-card-caution">
                  <Icon name="info" /> {lead.caution}
                </p>
              ) : null}
              {lead.sources.length > 0 ? <p className="lead-sources">{lead.sources.join(", ")}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      <details className="source-records">
        <summary>
          Source record IDs <Icon name="chevron" />
        </summary>
        <p>{submission.id}</p>
      </details>

      <p className="account-tab-footer">Context only. None of this is scored.</p>
    </div>
  );
}
