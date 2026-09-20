import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HazardProfile } from "@/lib/domain/types";

export type HazardIndex = Record<string, HazardProfile>;

export const UNKNOWN_HAZARD: HazardProfile = {
  compositeRating: "unknown",
  topHazards: [],
  source: "FEMA NRI",
  asOf: "1970-01-01",
};

/** Canonical lookup key: uppercase state, trimmed county. */
export function hazardKey(state?: string, county?: string): string | undefined {
  const s = state?.trim().toUpperCase();
  const c = county?.trim();
  if (!s || !c) return undefined;
  return `${s}|${c}`;
}

export function loadHazardIndex(rawDir = join(process.cwd(), "raw")): HazardIndex {
  try {
    return JSON.parse(readFileSync(join(rawDir, "enrichment.json"), "utf8")) as HazardIndex;
  } catch {
    return {};
  }
}

export function hazardForLocation(index: HazardIndex, state?: string, county?: string): HazardProfile {
  const key = hazardKey(state, county);
  const hit = key ? index[key] : undefined;
  return hit ? { ...hit } : { ...UNKNOWN_HAZARD };
}
