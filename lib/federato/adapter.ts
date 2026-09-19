import type { CanonicalSubmission } from "@/lib/domain/types";
import { planQuery } from "@/lib/federato/schema-planner";

type CanonicalField = keyof CanonicalSubmission;
type FieldMap = Partial<Record<CanonicalField, string>>;
type UnknownRecord = Record<string, unknown>;

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
 * ASSUMED nested shapes for real Federato records. The live shape is
 * undocumented; these names are guesses used only as *fallbacks* when a flat
 * mapped scalar is absent. They never override an explicit value and never
 * invent data — a genuinely alien record simply yields `undefined`.
 */
const LOCATIONS_KEYS = ["locations", "locationSchedule", "sites"] as const;
const BUILDINGS_KEYS = ["buildings", "structures"] as const;
const LOSS_KEYS = ["lossHistory", "losses", "claims"] as const;
const ACCOUNT_NAME_REFS = ["account.name", "insured.name", "name"] as const;

/**
 * Build the live query payload. The `FEDERATO_QUERY_PAYLOAD_JSON` seam still
 * wins (it is how an engineer pins the real Query Request Body once known);
 * otherwise the schema-driven planner generates the projection from the eight
 * appetite requirements rather than a hand-written query.
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
 * Read a dot-path. Object segments traverse normally; a reference whose value
 * is an expanded object is traversed too. Arrays are NOT traversed by dot-path
 * (matching Federato semantics) — array aggregation is handled explicitly.
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

function arrayAt(record: UnknownRecord, keys: readonly string[]): UnknownRecord[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function locationTiv(location: UnknownRecord): number | undefined {
  const direct = asNumber(firstDefined(location, ["tiv", "totalInsuredValue", "values.totalInsuredValue", "values.tiv"]));
  if (direct !== undefined) return direct;
  // Fall back to summing this location's building values.
  const buildingValues = arrayAt(location, BUILDINGS_KEYS)
    .map((building) => asNumber(firstDefined(building, ["value", "buildingValue", "values.buildingValue"])))
    .filter((value): value is number => value !== undefined);
  if (buildingValues.length === 0) return undefined;
  return buildingValues.reduce((sum, value) => sum + value, 0);
}

function allBuildings(locations: UnknownRecord[]): UnknownRecord[] {
  return locations.flatMap((location) => arrayAt(location, BUILDINGS_KEYS));
}

// --- Canonical field resolvers ----------------------------------------------
// Each resolver prefers an explicit flat/mapped value, then falls back to the
// ASSUMED nested shape, then to `undefined`. Aggregation rules are documented
// inline and mirror lib/federato/schema-planner FIELD_REQUIREMENTS.

/** TIV: SUM of every location's TIV (documented aggregation: additive). */
function resolveTiv(row: UnknownRecord, mappedPath: string): number | undefined {
  const flat = asNumber(getPath(row, mappedPath) ?? row.totalInsuredValue);
  if (flat !== undefined) return flat;
  const locationValues = arrayAt(row, LOCATIONS_KEYS)
    .map(locationTiv)
    .filter((value): value is number => value !== undefined);
  if (locationValues.length === 0) return undefined;
  return locationValues.reduce((sum, value) => sum + value, 0);
}

/** Premium: scalar; if split across layers, SUM the layer premiums. */
function resolvePremium(row: UnknownRecord, mappedPath: string): number | undefined {
  const flat = asNumber(firstDefined(row, [mappedPath, "premium", "premiumAmount"]));
  if (flat !== undefined) return flat;
  const layerPremiums = arrayAt(row, ["layers"])
    .map((layer) => asNumber(firstDefined(layer, ["premium", "premiumAmount"])))
    .filter((value): value is number => value !== undefined);
  if (layerPremiums.length === 0) return undefined;
  return layerPremiums.reduce((sum, value) => sum + value, 0);
}

/** Primary risk state: isPrimary location, else largest-TIV location, else first. */
function resolvePrimaryState(row: UnknownRecord, mappedPath: string): string | undefined {
  const flat = asString(firstDefined(row, [mappedPath, "riskState"]));
  if (flat !== undefined) return flat;
  const locations = arrayAt(row, LOCATIONS_KEYS);
  if (locations.length === 0) return undefined;
  const stateOf = (location: UnknownRecord) => asString(firstDefined(location, ["state", "address.state"]));

  const primary = locations.find((location) => location.isPrimary === true || location.primary === true);
  if (primary) return stateOf(primary);

  let best: UnknownRecord | undefined;
  let bestTiv = -Infinity;
  for (const location of locations) {
    const tiv = locationTiv(location) ?? 0;
    if (tiv > bestTiv) {
      bestTiv = tiv;
      best = location;
    }
  }
  return stateOf(best ?? locations[0]);
}

/** Building year: MIN (oldest) yearBuilt across all buildings — worst case. */
function resolveBuildingYear(row: UnknownRecord, mappedPath: string): number | undefined {
  const flat = asNumber(firstDefined(row, [mappedPath, "yearBuilt"]));
  if (flat !== undefined) return flat;
  const years = allBuildings(arrayAt(row, LOCATIONS_KEYS))
    .map((building) => asNumber(firstDefined(building, ["yearBuilt", "buildingYear"])))
    .filter((value): value is number => value !== undefined);
  if (years.length === 0) return undefined;
  return Math.min(...years);
}

/**
 * Approved construction: value-weighted share of buildings the SOURCE flags as
 * approved (sum(value where approved)/sum(value)); count-weighted fallback when
 * values are missing. This aggregates a source-provided flag only — it never
 * applies the appetite's approved-construction policy (that is Person 3's job).
 */
function resolveApprovedConstruction(row: UnknownRecord, mappedPath: string): number | undefined {
  const flat = asNumber(getPath(row, mappedPath));
  if (flat !== undefined) return flat;
  const buildings = allBuildings(arrayAt(row, LOCATIONS_KEYS));
  if (buildings.length === 0) return undefined;

  const approvalFlag = (building: UnknownRecord): boolean | undefined => {
    const raw = firstDefined(building, ["approvedConstruction", "constructionApproved", "isApproved"]);
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
      const lowered = raw.trim().toLowerCase();
      if (["true", "yes", "y", "approved"].includes(lowered)) return true;
      if (["false", "no", "n"].includes(lowered)) return false;
    }
    return undefined;
  };

  const flags = buildings.map(approvalFlag);
  if (flags.every((flag) => flag === undefined)) return undefined; // source did not say; stay unknown.

  const values = buildings.map((building) => asNumber(firstDefined(building, ["value", "buildingValue"])));
  const hasValues = values.some((value) => value !== undefined);

  if (hasValues) {
    let approvedValue = 0;
    let totalValue = 0;
    buildings.forEach((_, index) => {
      const value = values[index] ?? 0;
      totalValue += value;
      if (flags[index] === true) approvedValue += value;
    });
    if (totalValue === 0) return undefined;
    return Math.round((approvedValue / totalValue) * 100);
  }

  const approvedCount = flags.filter((flag) => flag === true).length;
  const known = flags.filter((flag) => flag !== undefined).length;
  if (known === 0) return undefined;
  return Math.round((approvedCount / known) * 100);
}

/** Construction description: sorted distinct construction types across buildings. */
function resolveConstructionDescription(row: UnknownRecord, mappedPath: string): string | undefined {
  const flat = asString(getPath(row, mappedPath));
  if (flat !== undefined) return flat;
  const types = allBuildings(arrayAt(row, LOCATIONS_KEYS))
    .map((building) => asString(firstDefined(building, ["constructionType", "constructionClass", "construction"])))
    .filter((value): value is string => value !== undefined);
  if (types.length === 0) return undefined;
  const distinct = Array.from(new Set(types)).sort();
  return distinct.join(", ");
}

/**
 * Five-year losses: SUM of loss amounts within the trailing 5 years. The window
 * is anchored on the submission's effective-date year when present, else on the
 * newest loss year in the data; undated losses are summed in full.
 */
function resolveFiveYearLosses(row: UnknownRecord, mappedPath: string, effectiveDate?: string): number | undefined {
  const flat = asNumber(getPath(row, mappedPath));
  if (flat !== undefined) return flat;
  const losses = arrayAt(row, LOSS_KEYS);
  if (losses.length === 0) return undefined;

  const yearOf = (loss: UnknownRecord): number | undefined => {
    const explicit = asNumber(loss.year);
    if (explicit !== undefined && Number.isInteger(explicit)) return explicit;
    const date = asString(firstDefined(loss, ["date", "lossDate"]));
    const parsed = date ? new Date(date).getFullYear() : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const amountOf = (loss: UnknownRecord) => asNumber(firstDefined(loss, ["amount", "lossAmount", "incurred", "value"]));
  const years = losses.map(yearOf).filter((year): year is number => year !== undefined);

  // Undated losses: sum everything (documented) rather than guess a window.
  if (years.length === 0) {
    const amounts = losses.map(amountOf).filter((value): value is number => value !== undefined);
    return amounts.length === 0 ? undefined : amounts.reduce((sum, value) => sum + value, 0);
  }

  const anchorYear = effectiveDate ? new Date(effectiveDate).getFullYear() : NaN;
  const referenceYear = Number.isFinite(anchorYear) ? anchorYear : Math.max(...years);
  const cutoff = referenceYear - 5;

  const total = losses.reduce((sum, loss) => {
    const year = yearOf(loss);
    const amount = amountOf(loss);
    if (amount === undefined) return sum;
    // Undated records inside a dated set are included conservatively.
    if (year === undefined || year > cutoff) return sum + amount;
    return sum;
  }, 0);
  return total;
}

/**
 * Normalize a raw Federato response into `CanonicalSubmission[]`. Handles flat
 * scalars, `$expand`-style nested references, and arrays of locations/buildings/
 * losses via the documented aggregation rules above. Missing or malformed
 * values are preserved as `undefined` (never invented), and NO record is dropped
 * for being out of appetite. The output contains only canonical fields, so raw
 * API shapes never leak downstream.
 */
export function normalizeQueryResponse(raw: unknown): CanonicalSubmission[] {
  const map = fieldMap();
  return extractRows(raw).map((row, index) => {
    const effectiveDate = asString(getPath(row, map.effectiveDate));
    return {
      id: asString(getPath(row, map.id)) ?? `submission-${index + 1}`,
      accountName: asString(firstDefined(row, [map.accountName, ...ACCOUNT_NAME_REFS])) ?? "Unknown account",
      submissionType: asString(getPath(row, map.submissionType)),
      lineOfBusiness: asString(getPath(row, map.lineOfBusiness)),
      primaryRiskState: resolvePrimaryState(row, map.primaryRiskState),
      effectiveDate,
      expirationDate: asString(getPath(row, map.expirationDate)),
      tiv: resolveTiv(row, map.tiv),
      totalPremium: resolvePremium(row, map.totalPremium),
      buildingYear: resolveBuildingYear(row, map.buildingYear),
      approvedConstructionPercentage: resolveApprovedConstruction(row, map.approvedConstructionPercentage),
      constructionDescription: resolveConstructionDescription(row, map.constructionDescription),
      fiveYearLossValue: resolveFiveYearLosses(row, map.fiveYearLossValue, effectiveDate),
    };
  });
}
