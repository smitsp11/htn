import type { DemoFixtureBundle } from "./types";

const BUNDLE: DemoFixtureBundle = {
  leads: [
    {
      kind: "On this account",
      label: "Prior-term relationship",
      value: "3 years bound",
      detail: "Same insured carried commercial property with the carrier through 2024.",
      caution: "Relationship history is context only; it is not part of the property appetite score.",
      sources: ["account:relationship"],
    },
    {
      kind: "Peer benchmark",
      label: "Median TIV for this class/state",
      value: "$18.4M",
      detail: "Across comparable commercial-property submissions in the loaded queue.",
      sources: ["peer:benchmark"],
    },
  ],
  signals: [
    { tone: "warning", headline: "Open claim on account", detail: "One water-damage claim in the last 24 months (all lines)." },
    { tone: "positive", headline: "Broker hit-rate", detail: "This broker's submissions bind above the queue average." },
    { tone: "neutral", headline: "State concentration", detail: "Adds to existing exposure in the primary risk state." },
  ],
  pricing: [
    { label: "Peer-indicated", value: "$14,800" },
    { label: "Acceptable band", value: "$12,000 – $16,500" },
    { label: "Target band", value: "$13,500 – $15,000" },
  ],
  research: {
    locationMatch: "Address verified (Census geocoder).",
    femaFloodZone: "Zone X (moderate-to-low risk)",
    currentWeather: "Clear, 21°C, wind 12 km/h. No active alerts.",
    notes: [
      {
        factorLabel: "Five-year loss value",
        reading: "Loss history is inferred from account-level claims and not confirmed at the property level.",
        verifyNext: "Request a property-specific 5-year loss run from the broker.",
        basedOn: "account claims summary",
      },
    ],
    sources: [
      { label: "FEMA National Risk Index", href: "https://hazards.fema.gov/nri/", status: "Retrieved · unreviewed" },
      { label: "NWS forecast", href: "https://www.weather.gov/", status: "Retrieved · unreviewed" },
    ],
  },
  intakeProposals: [
    {
      factorLabel: "Construction",
      proposedValue: "Masonry non-combustible",
      quote: "\"Exterior walls are concrete block; roof is metal deck on steel joists.\"",
      citation: "broker email · 2026-09-18",
    },
  ],
};

export function fixturesFor(_submissionId: string): DemoFixtureBundle {
  // Static fixtures: same bundle for every submission (spec decision).
  return BUNDLE;
}
