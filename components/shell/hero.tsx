import { Icon } from "@/components/ui/icon";

/**
 * Marketing hero ported from federanorth's `federanorth-shell.js`: a two-column grid
 * with the serif headline + CTA on the left and an aerial photo with a dashed
 * route-overlay, map-grid hairlines, a map-star, and corner coordinate labels on the
 * right. The CTA and skip link both target `#queue`, the id the queue workspace section
 * renders under (added in a later task).
 */
export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title">
          A clearer view.
          <br />
          A better way
          <br />
          to underwrite.
        </h1>
        <p>
          Review the submission. Check local conditions.
          <br />
          Get the context to make your next decision.
        </p>
        <a className="button mint hero-cta" href="#queue">
          Explore your queue <Icon name="arrow" />
        </a>
      </div>
      <div className="hero-visual">
        <img className="hero-photo" src="/federanorth-aerial.png" alt="" />
        <div className="image-shade" />
        <svg
          className="route-overlay"
          viewBox="0 0 1536 1024"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <path d="M-40 750C400 580 960 485 1580 383" />
          <path d="M385-20C475 224 630 410 820 535S1250 858 1540 1075" />
          <path d="M575 260C695 154 822 70 932 101S1080 224 1112 343" />
        </svg>
        <span className="map-grid vertical one" />
        <span className="map-grid vertical two" />
        <span className="map-grid horizontal" />
        <span className="map-star">
          <Icon name="north-star" />
        </span>
        <div className="image-coordinates">
          THE VIEW FROM ABOVE
          <span>A NEW PERSPECTIVE</span>
        </div>
        <div className="image-label">
          <span className="status-dot" /> CONNECTING THE DOTS
        </div>
      </div>
    </section>
  );
}
