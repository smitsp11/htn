import type { RankingsErrorBody, RankingsErrorCategory } from "@/lib/rankings/errors";

const errorHeadings: Record<RankingsErrorCategory, { title: string; hint: string }> = {
  auth: {
    title: "Federato authentication failed.",
    hint: "Check the organizer-provided credentials, the auth.product.federato.ai domain, and the audience in .env.local.",
  },
  configuration: {
    title: "Live mode is not configured.",
    hint: "Set the missing environment value, or keep FEDERATO_USE_DEMO_DATA=true to work from fixtures.",
  },
  query: {
    title: "Federato query failed.",
    hint: "The schema or query request was rejected. Check the query payload and try again.",
  },
  unknown: {
    title: "Could not evaluate the queue.",
    hint: "An unexpected error occurred while ranking submissions.",
  },
};

export function LoadingPanel() {
  return <section className="state-panel" role="status">Evaluating the submission queue…</section>;
}

export function EmptyPanel({ onRefresh }: { onRefresh: () => void }) {
  return (
    <section className="state-panel empty-panel">
      <strong>No submissions were returned.</strong>
      <span>The queue is empty for the current query. Refresh to try again.</span>
      <button type="button" onClick={onRefresh}>Refresh queue</button>
    </section>
  );
}

export function ErrorPanel({ error, onRetry }: { error: RankingsErrorBody; onRetry: () => void }) {
  const copy = errorHeadings[error.category];
  return (
    <section className="state-panel error-panel" role="alert">
      <strong>{copy.title}</strong>
      <span>{error.error}</span>
      <small>{copy.hint}</small>
      <button type="button" onClick={onRetry}>Try again</button>
    </section>
  );
}

export function StaleBanner({ generatedAt, error }: { generatedAt: string; error: RankingsErrorBody }) {
  return (
    <div className="inline-error" role="alert">
      Showing results from {generatedAt}. Refresh failed: {error.error}
    </div>
  );
}
