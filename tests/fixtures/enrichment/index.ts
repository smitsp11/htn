import type { HazardProfile } from "@/lib/domain/types";

export const hazardFixture: Record<string, HazardProfile> = {
  "CA|Los Angeles": {
    compositeRating: "very high",
    compositeScore: 92.1,
    topHazards: [
      { type: "Wildfire", rating: "very high" },
      { type: "Earthquake", rating: "relatively high" },
    ],
    source: "FEMA NRI",
    asOf: "2026-09-19",
  },
  "FL|Hillsborough": {
    compositeRating: "relatively high",
    compositeScore: 71.4,
    topHazards: [{ type: "Hurricane", rating: "very high" }],
    source: "FEMA NRI",
    asOf: "2026-09-19",
  },
};
