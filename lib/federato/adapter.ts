import type { CanonicalSubmission } from "@/lib/domain/types";
import { planQuery } from "@/lib/federato/schema-planner";

type CanonicalField = keyof CanonicalSubmission;
type FieldMap = Partial<Record<CanonicalField, string>>;
type UnknownRecord = Record<string, unknown>;

/**
 * Flat field map used by the `FEDERATO_FIELD_MAP_JSON` seam. When a Federato
 * response comes back FLAT (each canonical field a top-level scalar), these are
 * the source paths. For the real EXPANDED shape (nested insured/policy/locations/
 * claims) the resolvers below read the real Federato field names directly; the
 * flat map only acts as a documented override/fallback.
 */
const defaultFieldMap: Required<FieldMap> = {
  id: "id",
  accountName: "accountName",
  submissionType: "submissionType",
  lineOfBusiness: "lineOfBusiness",
  primaryRiskState: "primaryRiskState",
  effectiveDate: "effectiveDate",
  expirationDate: "expirationDate",
  tiv: "tiv",
  totalPremium: "totalPremium",
  buildingYear: "buildingYear",
  approvedConstructionPercentage: "approvedConstructionPercentage",
  constructionDescription: "constructionDescription",
  fiveYearLossValue: "fiveYearLossValue",
};

/**
 * Approved (non-combustible) construction classes per the appetite guideline.
 * See MASTER_RESEARCH.md line 70 (">50% JM, non-combustible/steel, or masonry
 * non-combustible") and the "combustible construction" red flag. This is the one
 * place appetite policy legitimately enters normalization, because the frozen
 * contract field is pre-named `approvedConstructionPercentage`; the threshold
 * itself (>50%) is still applied later in lib/domain/appetite.
 */
const APPROVED_CONSTRUCTION_TYPES = new Set<string>([
  "Joisted Masonry",
  "Non-Combustible",
  "Masonry Non-Combustible",
  "Steel Frame",
  "Modified Fire Resistive",
  "Fire Resistive",
]);
/** Explicitly combustible classes, listed for documentation (NOT approved): "Frame", "Wood Frame". */

/**
 * The EXPANDED Federato submission record the normalizer consumes. Produced by
 * the offline data source (and by a live `$expand` query) so a submission
 * carries its joined resources inline, using the REAL Federato field names:
 *
 *   {
 *     id, submission_number, line_of_business, target_effective_date, status,
 *     insured: { name, ... },                       // Insured (expanded)
 *     policy:  { premium, business_type, line_of_business,
 *                dates: { effective, expiration } }, // Policy (expanded) or absent
 *     locations: [ { state, buildings: [ Building, ... ] } ], // risk Locations
 *     claims:  [ { date_of_loss, paid_indemnity, paid_expense } ], // Policy claims
 *   }
 */

/**
 * Build the live query payload. The `FEDERATO_QUERY_PAYLOAD_JSON` seam still
 * wins (it is how an engineer pins the real Query Request Body); otherwise the
 * schema-driven planner generates the projection from the discovered schema.
 */
export function buildQueryPayload(schema: unknown): unknown {
  const configured = process.env.FEDERATO_QUERY_PAYLOAD_JSON;
  if (configured) {
    try {
      return JSON.parse(configured) as unknown;
    } catch {
      throw new Error("FEDERATO_QUERY_PAYLOAD_JSON is not valid JSON.");
    }
  }
  return planQuery(schema).projection;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a dot-path. Object segments traverse normally; an expanded reference is
 * traversed too. Arrays are NOT traversed by dot-path (matching Federato
 * semantics) — array aggregation is handled explicitly below.
 */
function getPath(record: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (isRecord(value)) return value[segment];
    return undefined;
  }, record);
}

function firstDefined(record: UnknownRecord, paths: readonly string[]): unknown {
  for (const path of paths) {
    const value = getPath(record, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function asString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[$,%\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function fieldMap(): Required<FieldMap> {
  const configured = process.env.FEDERATO_FIELD_MAP_JSON;
  if (!configured) return defaultFieldMap;
  try {
    return { ...defaultFieldMap, ...(JSON.parse(configured) as FieldMap) };
  } catch {
    throw new Error("FEDERATO_FIELD_MAP_JSON is not valid JSON.");
  }
}

function extractRows(raw: unknown): UnknownRecord[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (!isRecord(raw)) return [];
  for (const key of ["data", "results", "items", "records"]) {
    const candidate = raw[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
    if (isRecord(candidate)) {
      const nested = extractRows(candidate);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

// --- Array helpers -----------------------------------------------------------

function arrayAt(record: UnknownRecord, key: string): UnknownRecord[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Every risk Building across every risk Location on the expanded record. */
function riskBuildings(row: UnknownRecord): UnknownRecord[] {
  return arrayAt(row, "locations").flatMap((location) => arrayAt(location, "buildings"));
}

/** Building TIV, falling back to building_value when tiv is absent. */
function buildingTiv(building: UnknownRecord): number | undefined {
  return asNumber(building.tiv) ?? asNumber(building.building_value);
}

// --- Canonical field resolvers ----------------------------------------------
// Each resolver prefers the flat/mapped scalar (the env-seam fallback for flat
// responses), then applies the documented real-shape aggregation. Missing data
// stays `undefined` (never invented).

/** TIV = SUM of Building.tiv (fallback building_value) across risk buildings. */
function resolveTiv(row: UnknownRecord, mappedPath: string): number | undefined {
  const flat = asNumber(getPath(row, mappedPath));
  if (flat !== undefined) return flat;
  const values = riskBuildings(row)
    .map(buildingTiv)
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0);
}

/** totalPremium = policy.premium; undefined when there is no policy. */
function resolvePremium(row: UnknownRecord, mappedPath: string): number | undefined {
  return asNumber(firstDefined(row, [mappedPath, "policy.premium"]));
}

/**
 * primaryRiskState = state of the risk Location with the greatest summed
 * Building.tiv; fallback to the first location carrying a state; else undefined.
 * (The offline source seeds `locations` with the HQ location when a submission
 * has no exposure-unit locations, so the HQ-state fallback lives upstream.)
 */
function resolvePrimaryState(row: UnknownRecord, mappedPath: string): string | undefined {
  const flat = asString(getPath(row, mappedPath));
  if (flat !== undefined) return flat;
  const locations = arrayAt(row, "locations");
  if (locations.length === 0) return undefined;

  let best: UnknownRecord | undefined;
  let bestTiv = -Infinity;
  for (const location of locations) {
    const tiv = arrayAt(location, "buildings")
      .map(buildingTiv)
      .filter((value): value is number => value !== undefined)
      .reduce((sum, value) => sum + value, 0);
    if (tiv > bestTiv) {
      bestTiv = tiv;
      best = location;
    }
  }
  const bestState = asString(best?.state);
  if (bestState !== undefined) return bestState;
  // No building TIVs to rank on: fall back to the first location with a state.
  for (const location of locations) {
    const state = asString(location.state);
    if (state !== undefined) return state;
  }
  return undefined;
}

/** buildingYear = MIN Building.year_built (oldest = conservative worst case). */
function resolveBuildingYear(row: UnknownRecord, mappedPath: string): number | undefined {
  const flat = asNumber(getPath(row, mappedPath));
  if (flat !== undefined) return flat;
  const years = riskBuildings(row)
    .map((building) => asNumber(building.year_built))
    .filter((value): value is number => value !== undefined);
  if (years.length === 0) return undefined;
  return Math.min(...years);
}

/**
 * approvedConstructionPercentage = TIV-weighted share (0..1 RATIO) of buildings
 * whose construction_type is in APPROVED_CONSTRUCTION_TYPES. Weight by
 * Building.tiv; equal-weight fallback when TIVs are missing/zero. Undefined when
 * there are no buildings.
 */
function resolveApprovedConstruction(row: UnknownRecord, mappedPath: string): number | undefined {
  const flat = asNumber(getPath(row, mappedPath));
  if (flat !== undefined) return flat;
  const buildings = riskBuildings(row);
  if (buildings.length === 0) return undefined;

  const isApproved = (building: UnknownRecord) => {
    const type = asString(building.construction_type);
    return type !== undefined && APPROVED_CONSTRUCTION_TYPES.has(type);
  };

  let approvedTiv = 0;
  let totalTiv = 0;
  for (const building of buildings) {
    const tiv = buildingTiv(building) ?? 0;
    totalTiv += tiv;
    if (isApproved(building)) approvedTiv += tiv;
  }
  if (totalTiv > 0) return approvedTiv / totalTiv;

  // Equal-weight fallback: no usable TIVs, so weight each building equally.
  const approvedCount = buildings.filter(isApproved).length;
  return approvedCount / buildings.length;
}

/** constructionDescription = sorted distinct construction_type joined by ", ". */
function resolveConstructionDescription(row: UnknownRecord, mappedPath: string): string | undefined {
  const flat = asString(getPath(row, mappedPath));
  if (flat !== undefined) return flat;
  const types = riskBuildings(row)
    .map((building) => asString(building.construction_type))
    .filter((value): value is string => value !== undefined);
  if (types.length === 0) return undefined;
  return Array.from(new Set(types)).sort().join(", ");
}

function yearOfLoss(claim: UnknownRecord): number | undefined {
  const date = asString(claim.date_of_loss);
  if (!date) return undefined;
  const year = new Date(date).getFullYear();
  return Number.isFinite(year) ? year : undefined;
}

function lossAmount(claim: UnknownRecord): number {
  return (asNumber(claim.paid_indemnity) ?? 0) + (asNumber(claim.paid_expense) ?? 0);
}

/**
 * fiveYearLossValue = SUM of (paid_indemnity + paid_expense) for claims whose
 * date_of_loss year is within the trailing 5 years ENDING at the effective-date
 * year (else the newest claim year). Undated claims are always included.
 * - undefined when there is NO policy at all (nothing to base a loss run on);
 * - 0 when a policy exists but has no qualifying claims (including no claims).
 */
function resolveFiveYearLosses(row: UnknownRecord, mappedPath: string, effectiveDate?: string): number | undefined {
  const flat = asNumber(getPath(row, mappedPath));
  if (flat !== undefined) return flat;
  if (!isRecord(row.policy)) return undefined; // no policy -> unknown loss history

  const claims = arrayAt(row, "claims");
  const years = claims.map(yearOfLoss).filter((year): year is number => year !== undefined);
  const effYear = effectiveDate ? new Date(effectiveDate).getFullYear() : NaN;
  const anchorYear = Number.isFinite(effYear) ? effYear : years.length > 0 ? Math.max(...years) : undefined;

  return claims.reduce((sum, claim) => {
    const year = yearOfLoss(claim);
    // Undated claims are included; dated claims must fall in (anchor-5, anchor].
    const inWindow =
      year === undefined ||
      anchorYear === undefined ||
      (year <= anchorYear && year > anchorYear - 5);
    return inWindow ? sum + lossAmount(claim) : sum;
  }, 0);
}

/**
 * Normalize a raw Federato response into `CanonicalSubmission[]`. Understands
 * the real EXPANDED submission shape (nested insured/policy/locations/buildings/
 * claims with real field names) and applies the documented joins/aggregations,
 * while still honoring the flat env-seam paths as a fallback. Missing values are
 * preserved as `undefined` (never invented), NO record is dropped for being out
 * of appetite, and only canonical fields are emitted so raw shapes never leak.
 */
export function normalizeQueryResponse(raw: unknown): CanonicalSubmission[] {
  const map = fieldMap();
  return extractRows(raw).map((row, index) => {
    // id = submission_number || id (per contract), with a synthetic fallback.
    const id = asString(firstDefined(row, ["submission_number", map.id])) ?? `submission-${index + 1}`;
    const accountName = asString(firstDefined(row, [map.accountName, "insured.name"])) ?? "Unknown account";
    const effectiveDate = asString(firstDefined(row, [map.effectiveDate, "policy.dates.effective", "target_effective_date"]));

    return {
      id,
      accountName,
      submissionType: asString(firstDefined(row, [map.submissionType, "policy.business_type"])),
      lineOfBusiness: asString(firstDefined(row, [map.lineOfBusiness, "line_of_business", "policy.line_of_business"])),
      primaryRiskState: resolvePrimaryState(row, map.primaryRiskState),
      effectiveDate,
      expirationDate: asString(firstDefined(row, [map.expirationDate, "policy.dates.expiration"])),
      tiv: resolveTiv(row, map.tiv),
      totalPremium: resolvePremium(row, map.totalPremium),
      buildingYear: resolveBuildingYear(row, map.buildingYear),
      approvedConstructionPercentage: resolveApprovedConstruction(row, map.approvedConstructionPercentage),
      constructionDescription: resolveConstructionDescription(row, map.constructionDescription),
      fiveYearLossValue: resolveFiveYearLosses(row, map.fiveYearLossValue, effectiveDate),
    };
  });
}
