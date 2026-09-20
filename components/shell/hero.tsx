import { Icon } from "@/components/ui/icon";
import { HeroMap } from "@/components/shell/hero-map";

/**
 * Marketing hero: a two-column grid with the serif headline + CTA on the left and, on the
 * right, an aerial map rendered as a dithered dot matrix (see `HeroMap`) under thin
 * coral hairlines, dashed cream sightlines, and a coral route squiggle. The CTA and skip
 * link both target `#queue`, the id the queue workspace section renders under.
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
        <p>Every submission ranked against the 2025 appetite, with the reason beside the verdict.</p>
        <a className="button mint hero-cta" href="#queue">
          Explore your queue <Icon name="arrow" />
        </a>
      </div>
      <div className="hero-visual">
        <HeroMap />
        <svg
          className="hero-hairlines"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line className="hairline" x1="28" y1="0" x2="28" y2="100" />
          <line className="hairline" x1="0" y1="62" x2="100" y2="62" />
          <line className="sightline" x1="52" y1="8" x2="88" y2="46" />
          <line className="sightline" x1="34" y1="88" x2="96" y2="70" />
        </svg>
        <svg
          className="map-squiggle"
          width="52"
          height="68"
          viewBox="0 0 46 60"
          fill="none"
          aria-hidden="true"
        >
          <path d="M4 56C16 50 28 38 34 8" />
          <path d="M34 8C34 22 39 32 44 37" />
        </svg>
      </div>
    </section>
  );
}
