import type { RankedSubmission } from "@/lib/domain/types";
import { formatMoney } from "@/lib/domain/format";
import { portfolioSummary } from "@/lib/rankings/portfolio";

export function PortfolioStrip({ submissions }: { submissions: RankedSubmission[] }) {
  const p = portfolioSummary(submissions);
  const topStates = p.topStates.slice(0, 3);
  const rated = p.propertyCount - (p.hazardCounts.unknown ?? 0);
  return (
    <section className="portfolio-strip" aria-label="Portfolio overview">
      <div className="ps-metric">
        <span>Submissions</span>
        <strong>{p.total}</strong>
        {p.nonProperty > 0 ? <small>{p.nonProperty} non-property</small> : null}
      </div>
      <div className="ps-metric">
        <span>Property TIV</span>
        <strong>{formatMoney(p.totalTiv)}</strong>
        {p.tivUnknown > 0 ? <small>{p.tivUnknown} without TIV</small> : null}
      </div>
      <div className="ps-metric">
        <span>In-appetite property TIV</span>
        <strong>{formatMoney(p.inAppetiteTiv)}</strong>
      </div>
      <div className="ps-metric">
        <span>Top property states</span>
        <strong>{topStates.length ? topStates.map((s) => `${s.state} (${s.count})`).join(", ") : "No state data"}</strong>
      </div>
      <div className="ps-metric">
        <span>Property high hazard (FEMA NRI)</span>
        <strong>{rated > 0 ? `${p.highHazard} of ${rated} rated` : "No hazard data"}</strong>
      </div>
    </section>
  );
}
