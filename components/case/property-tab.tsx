import type { AppetiteVerdict, RankedSubmission } from "@/lib/domain/types";
import { fixturesFor } from "@/lib/demo/fixtures";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Track } from "@/components/ui/track";
import { Icon } from "@/components/ui/icon";

const money = (value: number | undefined): string =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

const dateLabel = (value: string | undefined): string => {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

const pct = (value: number | undefined): string => (value == null ? "—" : `${Math.round(value * 100)}%`);

const verdictTone: Record<AppetiteVerdict, BadgeTone> = {
  target: "mint",
  acceptable: "mint",
  not_acceptable: "danger",
  unknown: "amber",
};

const verdictLabel: Record<AppetiteVerdict, string> = {
  target: "Target",
  acceptable: "Acceptable",
  not_acceptable: "Not acceptable",
  unknown: "Unknown",
};

/**
 * Case property-details tab: exposure figures, building details, five-year
 * loss evidence, the real appetite-factor checks (ported from federanorth's
 * `exposurePanel`/`buildingPanel`/`propertyLossPanel`/factor-list markup in
 * `src/decision/dashboard.js`), and a peer pricing comparison sourced from the
 * static demo fixtures (`lib/demo/fixtures.ts`). Every appetite fact here
 * comes straight from `submission`/`submission.factors` -- the pricing block
 * is presentational demo context only and never feeds back into scoring.
 */
export function PropertyTab({ submission }: { submission: RankedSubmission }) {
  const bundle = fixturesFor(submission.id);

  return (
    <div className="property-tab">
      <div className="section-title">
        <h3>Exposure</h3>
      </div>
      <div className="record-metrics">
        <div>
          <small>Total insured value</small>
          <strong>{money(submission.tiv)}</strong>
        </div>
        <div>
          <small>Total premium</small>
          <strong>{money(submission.totalPremium)}</strong>
        </div>
        <div>
          <small>Effective date</small>
          <strong>{dateLabel(submission.effectiveDate)}</strong>
        </div>
        <div>
          <small>Expiration date</small>
          <strong>{dateLabel(submission.expirationDate)}</strong>
        </div>
        <div>
          <small>Primary risk state</small>
          <strong>{submission.primaryRiskState ?? "—"}</strong>
        </div>
      </div>

      <div className="section-title">
        <h3>Building details</h3>
      </div>
      <div className="record-metrics">
        <div>
          <small>Year built</small>
          <strong>{submission.buildingYear ?? "—"}</strong>
        </div>
        <div>
          <small>Construction</small>
          <strong>{submission.constructionDescription ?? "—"}</strong>
        </div>
        <div>
          <small>Approved construction</small>
          <strong>{pct(submission.approvedConstructionPercentage)}</strong>
        </div>
      </div>

      <div className="section-title">
        <h3>Property loss evidence</h3>
        <span>Used for appetite</span>
      </div>
      <div className="record-metrics">
        <div>
          <small>Five-year property loss value</small>
          <strong>{money(submission.fiveYearLossValue)}</strong>
        </div>
      </div>
      <Track
        value={submission.fiveYearLossValue == null ? 0 : Math.min(100, (submission.fiveYearLossValue / 100_000) * 100)}
        tone={submission.fiveYearLossValue == null ? "neutral" : undefined}
      />

      <details className="detail-section" open>
        <summary>Appetite checks · {submission.factors.length} factors</summary>
        <div className="factor-list">
          {submission.factors.map((factor) => (
            <div className="appetite-check" key={factor.key}>
              <span className="appetite-check-label">{factor.label}</span>
              <Badge tone={verdictTone[factor.verdict]}>{verdictLabel[factor.verdict]}</Badge>
              <p>{factor.reason}</p>
            </div>
          ))}
        </div>
      </details>

      <details className="detail-section">
        <summary>Peer pricing comparison</summary>
        <p className="factor-caption">
          <Icon name="info" /> Demo peer context only -- not part of the appetite score.
        </p>
        <div className="record-metrics">
          {bundle.pricing.map((band) => (
            <div key={band.label}>
              <small>{band.label}</small>
              <strong>{band.value}</strong>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
