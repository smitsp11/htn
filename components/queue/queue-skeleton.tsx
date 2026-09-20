/**
 * Loading placeholder for the queue: a shimmering stand-in for the heading,
 * lane nav, and a few table rows, shown while the rankings fetch is in flight.
 * Purely presentational; the shimmer is CSS (`.skeleton`) and pauses under
 * prefers-reduced-motion via the global guard in app/globals.css.
 */
export function QueueSkeleton() {
  return (
    <section className="queue-skeleton" aria-hidden="true">
      <div className="skeleton sk-eyebrow" />
      <div className="skeleton sk-title" />
      <div className="skeleton sk-tabs" />
      <div className="sk-table">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="sk-row" key={index} style={{ animationDelay: `${index * 60}ms` }}>
            <div className="skeleton sk-cell sk-name" />
            <div className="skeleton sk-cell sk-sm" />
            <div className="skeleton sk-cell sk-sm" />
            <div className="skeleton sk-cell sk-bar" />
            <div className="skeleton sk-cell sk-wide" />
          </div>
        ))}
      </div>
    </section>
  );
}
