import type { RankedSubmission } from "@/lib/domain/types";
import { portfolioInsights, type InsightKind } from "@/lib/rankings/portfolio-insights";

const KIND_LABEL: Record<InsightKind, string> = {
  shape: "Book shape",
  drift: "Appetite drift",
  opportunity: "Opportunity",
};

export interface PortfolioInsightsProps {
  submissions: RankedSubmission[];
}

/**
 * Portfolio-level read of the ranked queue, below the metric strip: does the
 * 2025 appetite fit the book that is arriving? Every figure comes from `portfolioInsights`, which
 * only counts verdicts the engine already assigned. Read-only context for the
 * underwriter and the portfolio manager; it never feeds back into ranking.
 */
export function PortfolioInsights({ submissions }: PortfolioInsightsProps) {
  const insights = portfolioInsights(submissions);
  if (insights.length === 0) return null;
  return (
    <section className="portfolio-insights" aria-label="Portfolio insights">
      <header className="portfolio-heading">
        <p className="eyebrow">The agent's read of the book</p>
        <h2>Does the 2025 appetite fit what is arriving?</h2>
      </header>
      <ul className="portfolio-cards">
        {insights.map((insight) => (
          <li key={insight.id} className={`portfolio-card portfolio-${insight.kind}`} data-insight={insight.id}>
            <small>{KIND_LABEL[insight.kind]}</small>
            <strong>{insight.headline}</strong>
            <p>{insight.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
