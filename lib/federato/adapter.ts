import type { CanonicalSubmission } from "@/lib/domain/types";

type CanonicalField = Exclude<keyof CanonicalSubmission, "constructionDescription"> | "constructionDescription";
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

export function buildQueryPayload(_schema: unknown): unknown {
  const configured = process.env.FEDERATO_QUERY_PAYLOAD_JSON;
  if (!configured) {
    throw new Error(
      "FEDERATO_QUERY_PAYLOAD_JSON is required for live mode because the supplied PDFs show the query endpoint but omit the Query Request Body shape.",
    );
  }
  try {
    return JSON.parse(configured) as unknown;
  } catch {
    throw new Error("FEDERATO_QUERY_PAYLOAD_JSON is not valid JSON.");
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPath(record: UnknownRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (Array.isArray(value)) return value[Number(segment)];
    if (isRecord(value)) return value[segment];
    return undefined;
  }, record);
}

function asString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
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

export function normalizeQueryResponse(raw: unknown): CanonicalSubmission[] {
  const map = fieldMap();
  return extractRows(raw).map((row, index) => ({
    id: asString(getPath(row, map.id)) ?? `submission-${index + 1}`,
    accountName: asString(getPath(row, map.accountName)) ?? "Unknown account",
    submissionType: asString(getPath(row, map.submissionType)),
    lineOfBusiness: asString(getPath(row, map.lineOfBusiness)),
    primaryRiskState: asString(getPath(row, map.primaryRiskState)),
    effectiveDate: asString(getPath(row, map.effectiveDate)),
    expirationDate: asString(getPath(row, map.expirationDate)),
    tiv: asNumber(getPath(row, map.tiv)),
    totalPremium: asNumber(getPath(row, map.totalPremium)),
    buildingYear: asNumber(getPath(row, map.buildingYear)),
    approvedConstructionPercentage: asNumber(getPath(row, map.approvedConstructionPercentage)),
    constructionDescription: asString(getPath(row, map.constructionDescription)),
    fiveYearLossValue: asNumber(getPath(row, map.fiveYearLossValue)),
  }));
}
