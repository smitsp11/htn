import { RankingsDashboard } from "@/components/rankings-dashboard";

export default function Home() {
  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Commercial property · 2025 appetite</p>
          <h1>Underwriting opportunity queue</h1>
          <p className="lede">
            A transparent, read-only ranking of submissions against the carrier’s eight appetite factors.
          </p>
        </div>
        <div className="human-review">Human decision required</div>
      </header>
      <RankingsDashboard />
    </main>
  );
}
