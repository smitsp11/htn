import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HazardProfile, HazardRating } from "@/lib/domain/types";
import { hazardKey } from "@/lib/enrichment/hazard";

const RATING_BY_LABEL: Record<string, HazardRating> = {
  "Very Low": "very low",
  "Relatively Low": "relatively low",
  "Relatively Moderate": "relatively moderate",
  "Relatively High": "relatively high",
  "Very High": "very high",
};

// FEMA NRI hazard field prefixes -> human-readable names (the `*_RISKR` columns).
const HAZARD_LABELS: Record<string, string> = {
  AVLN: "Avalanche",
  CFLD: "Coastal Flooding",
  CWAV: "Cold Wave",
  DRGT: "Drought",
  ERQK: "Earthquake",
  HAIL: "Hail",
  HWAV: "Heat Wave",
  HRCN: "Hurricane",
  ISTM: "Ice Storm",
  LNDS: "Landslide",
  LTNG: "Lightning",
  RFLD: "Riverine Flooding",
  SWND: "Strong Wind",
  TRND: "Tornado",
  TSUN: "Tsunami",
  VLCN: "Volcanic Activity",
  WFIR: "Wildfire",
  WNTW: "Winter Weather",
};

function locations(): { state: string; county: string }[] {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "raw", "full_Location.json"), "utf8"));
  const rows = raw.output[0].data.results as { state?: string; county?: string }[];
  const seen = new Map<string, { state: string; county: string }>();
  for (const r of rows) {
    const k = hazardKey(r.state, r.county);
    if (k && r.state && r.county) seen.set(k, { state: r.state, county: r.county });
  }
  return [...seen.values()];
}

// NRI county data returns a record with RISK_RATNG (composite) and <HAZARD>_RISKR fields.
// Primary source is the FEMA NRI API; hazards.fema.gov is unreachable from some networks,
// so we fall back to FEMA's public ArcGIS NRI Counties FeatureServer, which serves the same
// RISK_RATNG / RISK_SCORE / *_RISKR fields as GeoJSON properties.
async function fetchCounty(state: string, county: string): Promise<HazardProfile> {
  const asOf = new Date().toISOString().slice(0, 10);
  const primaryUrl = `https://hazards.fema.gov/nri/api/v1/counties?state=${encodeURIComponent(state)}&county=${encodeURIComponent(county)}`;
  const fallbackWhere = `STATEABBRV='${state.replace(/'/g, "''")}' AND COUNTY='${county.replace(/'/g, "''")}'`;
  const fallbackUrl = `https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query?where=${encodeURIComponent(fallbackWhere)}&outFields=*&returnGeometry=false&f=geojson`;

  let res: Response;
  try {
    res = await fetch(primaryUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`NRI ${res.status}`);
  } catch {
    res = await fetch(fallbackUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`NRI fallback ${res.status}`);
  }
  const body = (await res.json()) as { features?: { properties: Record<string, unknown> }[] };
  const props = body.features?.[0]?.properties ?? {};
  const composite = RATING_BY_LABEL[String(props.RISK_RATNG)] ?? "unknown";
  const hazards: { type: string; rating: HazardRating }[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (k.endsWith("_RISKR") && typeof v === "string" && RATING_BY_LABEL[v]) {
      const code = k.replace("_RISKR", "");
      hazards.push({ type: HAZARD_LABELS[code] ?? code, rating: RATING_BY_LABEL[v] });
    }
  }
  const order: HazardRating[] = ["very high", "relatively high", "relatively moderate", "relatively low", "very low"];
  hazards.sort((a, b) => order.indexOf(a.rating) - order.indexOf(b.rating));
  return {
    compositeRating: composite,
    compositeScore: typeof props.RISK_SCORE === "number" ? props.RISK_SCORE : undefined,
    topHazards: hazards.filter((h) => h.rating === "very high" || h.rating === "relatively high").slice(0, 4),
    source: "FEMA NRI",
    asOf,
  };
}

async function main() {
  const out: Record<string, HazardProfile> = {};
  for (const { state, county } of locations()) {
    const key = hazardKey(state, county)!;
    try {
      out[key] = await fetchCounty(state, county);
      console.log(`ok  ${key} -> ${out[key].compositeRating}`);
    } catch (e) {
      out[key] = { compositeRating: "unknown", topHazards: [], source: "FEMA NRI", asOf: new Date().toISOString().slice(0, 10) };
      console.warn(`skip ${key}: ${(e as Error).message}`);
    }
  }
  writeFileSync(join(process.cwd(), "raw", "enrichment.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote raw/enrichment.json (${Object.keys(out).length} counties)`);
}

void main();
