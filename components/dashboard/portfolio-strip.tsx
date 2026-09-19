import type { RankedSubmission } from "@/lib/domain/types";
import { formatMoney } from "@/lib/domain/format";
import { portfolioSummary } from "@/lib/rankings/portfolio";

// Stylesheet is loaded via `@import` in app/globals.css so this stays node-testable.
export function PortfolioStrip({ submissions }: { submissions: RankedSubmission[] }) {
  const p = portfolioSummary(submissions);
  const topStates = p.topStates.slice(0, 3);
  return (
    <section className="portfolio-strip" aria-label="Portfolio overview">
      <div className="ps-metric"><span>Submissions</span><strong>{p.total}</strong></div>
      <div className="ps-metric"><span>In-appetite TIV</span><strong>{formatMoney(p.inAppetiteTiv)}</strong></div>
      <div className="ps-metric">
        <span>Top states</span>
        <strong>{topStates.length ? topStates.map((s) => `${s.state} (${s.count})`).join(", ") : "No state data"}</strong>
      </div>
    </section>
  );
}
