import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CanonicalSubmission, HazardProfile } from "@/lib/domain/types";
import { normalizeQueryResponse } from "@/lib/federato/adapter";
import { hazardForLocation, loadHazardIndex } from "@/lib/enrichment/hazard";

/**
 * Offline Federato data source (server-only).
 *
 * The `raw/full_<Resource>.json` files are a real Federato snapshot captured via
 * schema discovery + full-resource queries. This module reads them from disk,
 * indexes each resource by id, performs the documented per-Submission joins to
 * build one EXPANDED record per submission (the shape `normalizeQueryResponse`
 * consumes), and returns the resulting `CanonicalSubmission[]`. It never reaches
 * the network, so it is a deterministic, credential-free data source for the
 * read-only underwriting agent.
 */

type UnknownRecord = Record<string, unknown>;

/** Resources the join needs; each has a `raw/full_<name>.json` file. */
const RESOURCES = [
  "Submission",
  "Policy",
  "Insured",
  "Location",
  "Building",
  "Claim",
  "ExposureUnit",
] as const;
type ResourceName = (typeof RESOURCES)[number];

const RAW_DIR = path.join(process.cwd(), "raw");

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unwrap the `{ output: [ { data: { results: [...] } } ] }` envelope. */
function extractResults(parsed: unknown, resource: ResourceName): UnknownRecord[] {
  const output = isRecord(parsed) ? parsed.output : undefined;
  const first = Array.isArray(output) ? output[0] : undefined;
  const data = isRecord(first) ? first.data : undefined;
  const results = isRecord(data) ? data.results : undefined;
  if (!Array.isArray(results)) {
    throw new Error(`raw/full_${resource}.json did not contain output[0].data.results.`);
  }
  return results.filter(isRecord);
}

async function loadResource(resource: ResourceName): Promise<UnknownRecord[]> {
  const file = path.join(RAW_DIR, `full_${resource}.json`);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    throw new Error(`Missing offline Federato snapshot file: ${file}. Was raw/ captured?`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`raw/full_${resource}.json is not valid JSON.`, { cause });
  }
  return extractResults(parsed, resource);
}

/** Index records by their numeric `id`. */
function indexById(records: UnknownRecord[]): Map<number, UnknownRecord> {
  const map = new Map<number, UnknownRecord>();
  for (const record of records) {
    if (typeof record.id === "number") map.set(record.id, record);
  }
  return map;
}

function refIds(value: unknown): number[] {
  if (Array.isArray(value)) return value.filter((id): id is number => typeof id === "number");
  return [];
}

/** Canonical submission id: `submission_number || id` (matches the adapter's rule). */
function canonicalSubmissionId(submission: UnknownRecord, index: number): string {
  const number = submission.submission_number;
  if (typeof number === "string" && number.trim() !== "") return number;
  if (typeof number === "number") return String(number);
  const id = submission.id;
  if (typeof id === "string" && id.trim() !== "") return id;
  if (typeof id === "number") return String(id);
  return `submission-${index + 1}`;
}

/** Expand a Location into { state, buildings: Building[] } for the adapter. */
function expandLocation(location: UnknownRecord, buildingById: Map<number, UnknownRecord>): UnknownRecord {
  return {
    state: location.state,
    buildings: refIds(location.buildings)
      .map((id) => buildingById.get(id))
      .filter((building): building is UnknownRecord => building !== undefined),
  };
}

/** Building TIV, falling back to building_value when tiv is absent/non-numeric. */
function buildingTivValue(building: UnknownRecord): number {
  const tiv = building.tiv;
  if (typeof tiv === "number" && Number.isFinite(tiv)) return tiv;
  const buildingValue = building.building_value;
  if (typeof buildingValue === "number" && Number.isFinite(buildingValue)) return buildingValue;
  return 0;
}

/** Summed Building.tiv (fallback building_value) across a Location's buildings. */
function locationTiv(location: UnknownRecord, buildingById: Map<number, UnknownRecord>): number {
  return refIds(location.buildings)
    .map((id) => buildingById.get(id))
    .filter((building): building is UnknownRecord => building !== undefined)
    .reduce((sum, building) => sum + buildingTivValue(building), 0);
}

/**
 * The submission's PRIMARY risk location: the risk location with the largest
 * summed building TIV; fall back to the insured's HQ location; then to any
 * location at all (when neither of the above is available).
 */
function pickPrimaryLocation(
  riskLocations: UnknownRecord[],
  hqLocation: UnknownRecord | undefined,
  buildingById: Map<number, UnknownRecord>,
  anyLocation: UnknownRecord | undefined,
): UnknownRecord | undefined {
  let best: UnknownRecord | undefined;
  let bestTiv = -Infinity;
  for (const location of riskLocations) {
    const tiv = locationTiv(location, buildingById);
    if (tiv > bestTiv) {
      bestTiv = tiv;
      best = location;
    }
  }
  return best ?? hqLocation ?? anyLocation;
}

interface JoinedSubmission {
  /** Canonical id: `submission_number || id`. */
  id: string;
  /** The EXPANDED record `normalizeQueryResponse` consumes. */
  expanded: UnknownRecord;
  /** The submission's primary risk location (raw Location record), if any. */
  primaryLocation?: UnknownRecord;
}

/**
 * Read the raw resources, perform the documented per-Submission joins once,
 * and return one `JoinedSubmission` per submission. Both `loadOfflineSubmissions`
 * (canonical normalization) and `loadOfflineEnrichment` (hazard lookup) build on
 * this shared join so the record-linking logic lives in exactly one place.
 */
async function joinSubmissions(): Promise<JoinedSubmission[]> {
  const [submissions, policies, insureds, locations, buildings, claims, exposureUnits] = await Promise.all(
    RESOURCES.map(loadResource),
  );

  const insuredById = indexById(insureds);
  const locationById = indexById(locations);
  const buildingById = indexById(buildings);
  const claimById = indexById(claims);
  const exposureUnitById = indexById(exposureUnits);

  // Policies join to a submission via Policy.submission (one policy per submission here).
  const policyBySubmission = new Map<number, UnknownRecord>();
  for (const policy of policies) {
    if (typeof policy.submission === "number") policyBySubmission.set(policy.submission, policy);
  }

  return submissions.map((submission, index) => {
    const insured = typeof submission.insured === "number" ? insuredById.get(submission.insured) : undefined;
    const hqLocation =
      insured && typeof insured.hq === "number" ? locationById.get(insured.hq) : undefined;
    const policy = typeof submission.id === "number" ? policyBySubmission.get(submission.id) : undefined;

    // Risk locations: deduped Policy.exposure_units -> ExposureUnit.location; fall
    // back to the insured's HQ location when there are no exposure-unit locations.
    const riskLocationIds = new Set<number>();
    if (policy) {
      for (const unitId of refIds(policy.exposure_units)) {
        const unit = exposureUnitById.get(unitId);
        if (unit && typeof unit.location === "number") riskLocationIds.add(unit.location);
      }
    }
    let riskLocations = [...riskLocationIds]
      .map((id) => locationById.get(id))
      .filter((location): location is UnknownRecord => location !== undefined);
    if (riskLocations.length === 0 && hqLocation) riskLocations = [hqLocation];

    // Claims come from the policy; keep the field absent when there is no policy
    // so the adapter can distinguish "no policy" from "policy with zero claims".
    const policyClaims = policy
      ? refIds(policy.claims)
          .map((id) => claimById.get(id))
          .filter((claim): claim is UnknownRecord => claim !== undefined)
      : undefined;

    const expanded: UnknownRecord = {
      id: submission.id,
      submission_number: submission.submission_number,
      line_of_business: submission.line_of_business,
      target_effective_date: submission.target_effective_date,
      status: submission.status,
      insured: insured ? { name: insured.name } : undefined,
      policy: policy
        ? {
            premium: policy.premium,
            business_type: policy.business_type,
            line_of_business: policy.line_of_business,
            dates: policy.dates,
          }
        : undefined,
      locations: riskLocations.map((location) => expandLocation(location, buildingById)),
      claims: policyClaims,
    };

    const primaryLocation = pickPrimaryLocation(riskLocations, hqLocation, buildingById, locations[0]);

    return {
      id: canonicalSubmissionId(submission, index),
      expanded,
      primaryLocation,
    } satisfies JoinedSubmission;
  });
}

export async function loadOfflineSubmissions(): Promise<CanonicalSubmission[]> {
  const joined = await joinSubmissions();
  return normalizeQueryResponse({ data: joined.map((submission) => submission.expanded) });
}

/**
 * Build a `Map<canonicalSubmissionId, HazardProfile>` covering every offline
 * submission, resolved from each submission's PRIMARY risk location's
 * state/county against the FEMA NRI hazard index (`raw/enrichment.json`).
 * Locations without a usable state/county resolve to the "unknown" hazard
 * profile via `hazardForLocation`'s own fallback.
 */
export async function loadOfflineEnrichment(): Promise<Map<string, HazardProfile>> {
  const joined = await joinSubmissions();
  const hazardIndex = loadHazardIndex();

  const map = new Map<string, HazardProfile>();
  for (const submission of joined) {
    const state = typeof submission.primaryLocation?.state === "string" ? submission.primaryLocation.state : undefined;
    const county = typeof submission.primaryLocation?.county === "string" ? submission.primaryLocation.county : undefined;
    map.set(submission.id, hazardForLocation(hazardIndex, state, county));
  }
  return map;
}
