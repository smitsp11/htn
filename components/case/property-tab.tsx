import type { AppetiteVerdict, FactorKey, QueryReasoning, RankedSubmission } from "@/lib/domain/types";
import { pricingBandsFor } from "@/lib/domain/appetite";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Track } from "@/components/ui/track";

/** A factor key doesn't always match the query agent's own field name for it (see the
 *  `field` values it actually emits in lib/federato/assemble.ts / query-trace.ts). */
const SCHEMA_FIELD_FOR_FACTOR: Record<FactorKey, string> = {
  submissionType: "submissionType",
  lineOfBusiness: "lineOfBusiness",
  primaryRiskState: "riskState",
  tiv: "tiv",
  totalPremium: "totalPremium",
  buildingYear: "buildingYear",
  construction: "constructionType",
  fiveYearLossValue: "lossAmount",
};

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
 * static demo fixtures (`lib/demo/fixtures.ts`). Every appetite fact here,
 * including the pricing bands below, comes straight from `submission` and the
 * published guideline thresholds -- never a peer dataset the app doesn't have. When the
 * query agent ran (live/replay mode), each factor also shows the real Federato schema path
 * it was read from and when that batch was retrieved -- `queryTrace`/`retrievedAt` come
 * straight from the query agent's own reasoning, never invented.
 */
export function PropertyTab({
  submission,
  queryTrace,
  retrievedAt,
}: {
  submission: RankedSubmission;
  queryTrace?: QueryReasoning;
  retrievedAt?: string;
}) {
  const schemaPathByField = new Map(queryTrace?.fields.map((field) => [field.field, field.schemaPath]) ?? []);
  const retrievedLabel = retrievedAt && !Number.isNaN(Date.parse(retrievedAt)) ? new Date(retrievedAt).toLocaleString() : undefined;

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
          {submission.factors.map((factor) => {
            const schemaPath = schemaPathByField.get(SCHEMA_FIELD_FOR_FACTOR[factor.key]);
            return (
              <div className="appetite-check" key={factor.key}>
                <span className="appetite-check-label">{factor.label}</span>
                <Badge tone={verdictTone[factor.verdict]}>{verdictLabel[factor.verdict]}</Badge>
                <p>{factor.reason}</p>
                {schemaPath ? (
                  <small className="appetite-check-provenance">
                    Source: {schemaPath}
                    {retrievedLabel ? ` · Retrieved ${retrievedLabel}` : ""}
                  </small>
                ) : null}
              </div>
            );
          })}
        </div>
      </details>

      <details className="detail-section">
        <summary>Premium vs. guideline bands</summary>
        <div className="record-metrics">
          {pricingBandsFor(submission).map((band) => (
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
