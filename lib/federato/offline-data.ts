import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CanonicalSubmission } from "@/lib/domain/types";
import { normalizeQueryResponse } from "@/lib/federato/adapter";

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

/**
 * Build every EXPANDED submission record from the indexed raw resources, then
 * hand them to the shared adapter so all 158 submissions normalize through the
 * exact same code path a live query would use.
 */
export async function loadOfflineSubmissions(): Promise<CanonicalSubmission[]> {
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

  // Expand a Location into { state, buildings: Building[] } for the adapter.
  const expandLocation = (location: UnknownRecord): UnknownRecord => ({
    state: location.state,
    buildings: refIds(location.buildings)
      .map((id) => buildingById.get(id))
      .filter((building): building is UnknownRecord => building !== undefined),
  });

  const expanded = submissions.map((submission) => {
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

    return {
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
      locations: riskLocations.map(expandLocation),
      claims: policyClaims,
    } satisfies UnknownRecord;
  });

  return normalizeQueryResponse({ data: expanded });
}
