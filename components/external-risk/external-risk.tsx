import type { HazardProfile } from "@/lib/domain/types";

export interface ExternalRiskProps {
  profile?: HazardProfile;
}

/**
 * Read-only panel surfacing FEMA National Risk Index hazard data alongside
 * (never as part of) the carrier appetite score. Styles live in
 * ./external-risk.css and are loaded by the package index so this file stays
 * importable in node tests.
 */
export function ExternalRisk({ profile }: ExternalRiskProps) {
  if (!profile || profile.compositeRating === "unknown") {
    return (
      <section className="xr" aria-label="External risk">
        <span className="xr-label">External risk · FEMA National Risk Index</span>
        <p className="xr-empty">No external hazard data for this location.</p>
      </section>
    );
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <section className="xr" aria-label="External risk">
      <span className="xr-label">External risk · FEMA National Risk Index</span>
      <span className={`xr-composite xr-rating-${profile.compositeRating.replace(/\s+/g, "-")}`}>
        {cap(profile.compositeRating)}
      </span>
      <ul className="xr-hazards">
        {profile.topHazards.map((h) => (
          <li key={h.type} className={`xr-hazard xr-rating-${h.rating.replace(/\s+/g, "-")}`}>
            {h.type}: {cap(h.rating)}
          </li>
        ))}
      </ul>
      <small className="xr-note">Outside data — not part of the carrier appetite score.</small>
    </section>
  );
}
