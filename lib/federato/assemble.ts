/**
 * Turns API records into `CanonicalSubmission` values.
 *
 * Every appetite factor in the guidelines is a single value, but the data is
 * relational: a submission has many locations, each with many buildings, and
 * losses sit on claims that may belong to an earlier term. Each aggregation
 * choice below is deliberate and is reported as a derivation note so Person 3
 * and Person 4 can show an underwriter where a number came from.
 *
 * Aggregation rules (kept identical to the offline join they replace):
 * - Locations are deduplicated by id: several exposure units on one location
 *   must not count its buildings twice.
 * - TIV is the sum of building values over the risk locations; a policy with
 *   no building schedule falls back to exposure units on an insured-value
 *   basis, then to the fallback location the planner discovered (the insured's
 *   headquarters), at low confidence.
 * - Primary risk state is the state holding the most building value.
 * - Building year is the oldest building (the one that breaches the age rule).
 * - Approved construction is the value-weighted share of buildings in an
 *   approved class (equal weights when values are absent).
 * - Five-year losses are paid indemnity plus paid expense on claims whose year
 *   of loss falls in the five years ending at the effective year; a policy
 *   with no claims reports 0, a submission with no policy reports unknown.
 */

import type { CanonicalSubmission } from "@/lib/domain/types";
import type { DataPlan, FallbackLocation, FieldChoice, QueuePlan } from "./schema-planner";
import { REQUIREMENTS_BY_KEY, type RequirementKey } from "./requirements";
import { asNumber, asString, collectPath, getPath, isRecord, type UnknownRecord } from "./response";

export interface DerivationNote {
  field: string;
  method: string;
  sourcePath: string;
  confidence: "high" | "medium" | "low";
  ambiguity?: string;
}

export interface AssembledSubmission {
  submission: CanonicalSubmission;
  notes: DerivationNote[];
  /** `id` of the API record this was assembled from, for cross-checks. */
  sourceRecordId?: string;
  /** Building values summed over every traversal, as a server-side `$sum` would. */
  undedupedTiv?: number;
  /** The location the primary state came from, for enrichment lookups. */
  primaryLocation?: { state?: string; county?: string };
}

/** Construction classes the guidelines accept; "Frame"/"Wood Frame" are combustible. */
const APPROVED_CONSTRUCTION = /joisted masonry|non[-\s]?combustible|steel|fire resistive/i;

function parentOf(path: string): string {
  const cut = path.lastIndexOf(".");
  return cut === -1 ? "" : path.slice(0, cut);
}

function leafOf(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1);
}

function relativeTo(path: string | undefined, prefix: string): string | undefined {
  if (!path) return undefined;
  if (!prefix) return path;
  return path.startsWith(`${prefix}.`) ? path.slice(prefix.length + 1) : undefined;
}

function choiceFor(choices: FieldChoice[], key: RequirementKey): FieldChoice | undefined {
  return choices.find((choice) => choice.key === key && choice.path);
}

/** Which leaf names carry the building facts; taken from the plan, else the requirement synonyms. */
interface BuildingLeaves {
  year: string[];
  construction: string[];
  value: string[];
}

function buildingLeaves(choices: FieldChoice[]): BuildingLeaves {
  const year = choiceFor(choices, "buildingYear");
  const construction = choiceFor(choices, "constructionType");
  const tiv = choiceFor(choices, "tiv");
  return {
    year: year?.path ? [leafOf(year.path)] : REQUIREMENTS_BY_KEY.get("buildingYear")!.synonyms,
    construction: construction?.path
      ? [leafOf(construction.path)]
      : REQUIREMENTS_BY_KEY.get("constructionType")!.synonyms,
    value: [
      ...(tiv?.path ? [leafOf(tiv.path)] : []),
      ...(tiv?.supporting ?? []).map(leafOf),
      ...REQUIREMENTS_BY_KEY.get("tiv")!.synonyms,
    ].filter((leaf) => leaf !== "id"),
  };
}

function firstNumber(record: UnknownRecord, leaves: string[]): number | undefined {
  for (const leaf of leaves) {
    const value = asNumber(record[leaf]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstString(record: UnknownRecord, leaves: string[]): string | undefined {
  for (const leaf of leaves) {
    const value = asString(record[leaf]);
    if (value) return value;
  }
  return undefined;
}

interface LocationView {
  state?: string;
  county?: string;
  buildings: UnknownRecord[];
}

function dedupe(records: UnknownRecord[]): UnknownRecord[] {
  const seen = new Set<string>();
  const identity = new Set<UnknownRecord>();
  const output: UnknownRecord[] = [];
  for (const record of records) {
    const id = asString(record.id);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    } else {
      if (identity.has(record)) continue;
      identity.add(record);
    }
    output.push(record);
  }
  return output;
}

/**
 * Risk locations of a record, deduplicated, each with its buildings. The
 * geometry (where locations sit, where buildings sit under them) comes from
 * the plan's state and building paths, so it works for any schema in which a
 * state and a building schedule hang off the same location record.
 */
function riskLocations(row: UnknownRecord, choices: FieldChoice[]): {
  locations: LocationView[];
  buildings: UnknownRecord[];
  undedupedBuildings: UnknownRecord[];
} {
  const state = choiceFor(choices, "riskState");
  const building = choiceFor(choices, "buildingYear") ?? choiceFor(choices, "constructionType");
  const locationContainer = state?.path ? parentOf(state.path) : undefined;
  const buildingsPath = building?.path ? parentOf(building.path) : undefined;
  const countyLeaf = state?.supporting.map(leafOf).find((leaf) => /county/i.test(leaf));

  const locationRecords =
    locationContainer === undefined
      ? []
      : locationContainer === ""
        ? [row]
        : dedupe(collectPath(row, locationContainer).filter(isRecord));

  const buildingsRel =
    locationContainer === undefined ? undefined : relativeTo(buildingsPath, locationContainer);

  const locations: LocationView[] = locationRecords.map((location) => ({
    state: state?.path ? asString(location[leafOf(state.path)])?.trim().toUpperCase() : undefined,
    county: countyLeaf ? asString(location[countyLeaf]) : undefined,
    buildings: buildingsRel ? collectPath(location, buildingsRel).filter(isRecord) : [],
  }));

  // Buildings that are not nested under the location record are collected
  // from the row directly (no location to attribute them to).
  const undedupedBuildings = buildingsRel
    ? locationRecords.length === 0 && buildingsPath
      ? collectPath(row, buildingsPath).filter(isRecord)
      : collectPath(row, buildingsPath ?? "").filter(isRecord)
    : buildingsPath
      ? collectPath(row, buildingsPath).filter(isRecord)
      : [];
  const buildings = buildingsRel
    ? dedupe(locations.flatMap((location) => location.buildings))
    : dedupe(undedupedBuildings);

  return { locations, buildings, undedupedBuildings };
}

/** The fallback location (for example the insured's HQ) as a single location view. */
function fallbackLocation(
  row: UnknownRecord,
  fallback: FallbackLocation | undefined,
): LocationView | undefined {
  if (!fallback) return undefined;
  const location = getPath(row, fallback.locationPath);
  if (!isRecord(location)) return undefined;
  const stateLeaf = leafOf(fallback.statePath);
  const buildingsRel = relativeTo(fallback.buildingsPath, fallback.locationPath);
  const countyPath = fallback.projectPaths.find((path) => /county/i.test(leafOf(path)));
  return {
    state: asString(location[stateLeaf])?.trim().toUpperCase(),
    county: countyPath ? asString(getPath(row, countyPath)) : undefined,
    buildings: buildingsRel ? collectPath(location, buildingsRel).filter(isRecord) : [],
  };
}

function locationValue(location: LocationView, leaves: BuildingLeaves): number {
  return location.buildings.reduce((total, building) => total + (firstNumber(building, leaves.value) ?? 0), 0);
}

function derivePrimaryState(
  locations: LocationView[],
  leaves: BuildingLeaves,
  sourcePath: string,
  notes: DerivationNote[],
  lowConfidence: string | undefined,
): { state?: string; location?: LocationView } {
  const withState = locations.filter((location) => location.state);
  if (withState.length === 0) return {};

  const weights = new Map<string, number>();
  const anyValue = withState.some((location) => locationValue(location, leaves) > 0);
  for (const location of withState) {
    const weight = anyValue ? locationValue(location, leaves) : 1;
    weights.set(location.state!, (weights.get(location.state!) ?? 0) + weight);
  }
  const ranked = [...weights.entries()].sort((left, right) => right[1] - left[1]);
  const [state, weight] = ranked[0];
  const total = ranked.reduce((sum, [, value]) => sum + value, 0);
  const share = total > 0 ? Math.round((weight / total) * 100) : 100;

  if (lowConfidence) {
    notes.push({
      field: "primaryRiskState",
      method: lowConfidence,
      sourcePath,
      confidence: "low",
      ambiguity: "A headquarters address is not necessarily where the insured property sits.",
    });
  } else {
    notes.push({
      field: "primaryRiskState",
      method:
        ranked.length === 1
          ? `Only state on the risk schedule (${withState.length} location(s)).`
          : `${state} holds ${share}% of ${anyValue ? "building value" : "locations"} across ${ranked.length} state(s): ${ranked.map(([name]) => name).join(", ")}.`,
      sourcePath,
      confidence: ranked.length === 1 ? "high" : share >= 50 ? "medium" : "low",
      ambiguity:
        ranked.length > 1 && share < 50
          ? "No state holds a majority of the insured value, so the primary risk state is contestable."
          : undefined,
    });
  }
  const location = withState.find((candidate) => candidate.state === state);
  return { state, location };
}

function deriveBuildingYear(
  buildings: UnknownRecord[],
  leaves: BuildingLeaves,
  sourcePath: string,
  notes: DerivationNote[],
  lowConfidence?: string,
): number | undefined {
  const years = buildings
    .map((building) => firstNumber(building, leaves.year))
    .filter((value): value is number => value !== undefined);
  if (years.length === 0) return undefined;

  const oldest = Math.min(...years);
  const newest = Math.max(...years);
  notes.push({
    field: "buildingYear",
    method:
      (years.length === 1
        ? "Single building on the schedule."
        : `Oldest of ${years.length} buildings (${oldest}–${newest}); the oldest building is the one that breaches the age rule.`) +
      (lowConfidence ? ` ${lowConfidence}` : ""),
    sourcePath,
    confidence: lowConfidence ? "low" : "high",
  });
  return oldest;
}

function deriveConstruction(
  buildings: UnknownRecord[],
  leaves: BuildingLeaves,
  sourcePath: string,
  notes: DerivationNote[],
  lowConfidence?: string,
): { share?: number; description?: string } {
  let approved = 0;
  let total = 0;
  const seen = new Set<string>();
  const anyValue = buildings.some((building) => (firstNumber(building, leaves.value) ?? 0) > 0);

  for (const building of buildings) {
    const description = firstString(building, leaves.construction);
    if (!description) continue;
    const weight = anyValue ? (firstNumber(building, leaves.value) ?? 0) : 1;
    total += weight;
    seen.add(description);
    if (APPROVED_CONSTRUCTION.test(description)) approved += weight;
  }
  if (seen.size === 0) return {};
  if (total === 0) return { description: [...seen].sort().join(", ") };

  const share = approved / total;
  notes.push({
    field: "approvedConstructionPercentage",
    method:
      `${Math.round(share * 100)}% of ${anyValue ? "building value" : "buildings"} is in an approved class (joisted masonry, non-combustible/steel, masonry non-combustible or fire resistive).` +
      (lowConfidence ? ` ${lowConfidence}` : ""),
    sourcePath,
    confidence: lowConfidence ? "low" : anyValue ? "high" : "medium",
    ambiguity: anyValue ? undefined : "Building values were absent, so every building was weighted equally.",
  });
  return { share, description: [...seen].sort().join(", ") };
}

function yearOf(value: unknown): number | undefined {
  const text = asString(value);
  if (!text) return undefined;
  const match = /^(\d{4})/.exec(text.trim());
  return match ? Number(match[1]) : undefined;
}

/**
 * Five-year losses: paid indemnity plus paid expense on claims whose year of
 * loss falls in the five years ending at the effective year (else the newest
 * claim year). Undated claims are included so a missing date never hides a loss.
 */
function deriveLosses(
  claims: UnknownRecord[],
  effectiveDate: string | undefined,
  choices: FieldChoice[],
  notes: DerivationNote[],
): number {
  const amount = choiceFor(choices, "lossAmount");
  const amountLeaves = amount?.path ? [leafOf(amount.path)] : REQUIREMENTS_BY_KEY.get("lossAmount")!.synonyms;
  const expenseLeaves = (amount?.supporting ?? []).map(leafOf).filter((leaf) => /expense/i.test(leaf));
  const dateChoice = choiceFor(choices, "lossDate");
  const dateLeaves = dateChoice?.path ? [leafOf(dateChoice.path)] : REQUIREMENTS_BY_KEY.get("lossDate")!.synonyms;

  const years = claims.map((claim) => yearOf(firstString(claim, dateLeaves))).filter((year): year is number => year !== undefined);
  const anchor = yearOf(effectiveDate) ?? (years.length ? Math.max(...years) : undefined);

  let total = 0;
  let counted = 0;
  let undated = 0;
  for (const claim of claims) {
    const year = yearOf(firstString(claim, dateLeaves));
    if (year === undefined) undated += 1;
    else if (anchor !== undefined && (year > anchor || year <= anchor - 5)) continue;
    total += (firstNumber(claim, amountLeaves) ?? 0) + (firstNumber(claim, expenseLeaves) ?? 0);
    counted += 1;
  }

  notes.push({
    field: "fiveYearLossValue",
    method:
      claims.length === 0
        ? "The policy has no claims on record, so five-year losses are 0."
        : `Paid indemnity plus paid expense on ${counted} of ${claims.length} claim(s) with a year of loss in ${anchor === undefined ? "any year" : `${anchor - 4}–${anchor}`}.`,
    sourcePath: amount?.path ?? "",
    confidence: undated > 0 ? "medium" : "high",
    ambiguity: undated > 0 ? `${undated} claim(s) had no usable date of loss and were counted anyway.` : undefined,
  });
  return total;
}

function scalarString(row: UnknownRecord, choice: FieldChoice | undefined): string | undefined {
  if (!choice?.path) return undefined;
  return collectPath(row, choice.path).map(asString).find((value): value is string => Boolean(value));
}

function scalarNumber(row: UnknownRecord, choice: FieldChoice | undefined): number | undefined {
  if (!choice?.path) return undefined;
  return collectPath(row, choice.path).map(asNumber).find((value): value is number => value !== undefined);
}

/**
 * Exposure units measured on an insured-value basis, summed. Units of any
 * other kind (a fleet's cost, a payroll) are never added to a property TIV.
 */
function exposureValue(row: UnknownRecord, choices: FieldChoice[], notes: DerivationNote[]): number | undefined {
  const choice = choiceFor(choices, "exposureValue");
  if (!choice?.path) return undefined;
  const container = parentOf(choice.path);
  const leaf = leafOf(choice.path);
  const kindLeaves = choice.supporting.map(leafOf).filter((name) => name !== "id");
  const units = container ? collectPath(row, container).filter(isRecord) : [row];
  const insuredValue = units.filter((unit) =>
    /tiv|insured[_\s]?value|location|property/i.test(kindLeaves.map((name) => asString(unit[name]) ?? "").join(" ")),
  );
  const amounts = insuredValue
    .map((unit) => asNumber(unit[leaf]))
    .filter((value): value is number => value !== undefined);
  if (amounts.length === 0) return undefined;
  notes.push({
    field: "tiv",
    method: `Summed ${amounts.length} exposure unit(s) measured on an insured-value basis; no building schedule was available.`,
    sourcePath: choice.path,
    confidence: "medium",
  });
  return amounts.reduce((total, value) => total + value, 0);
}

function referenceId(value: unknown): string | undefined {
  if (isRecord(value)) return asString(value.id);
  return asString(value);
}

export interface AssembleInput {
  plan: DataPlan;
  rootRows: UnknownRecord[];
  queuePlan?: QueuePlan;
  queueRows?: UnknownRecord[];
}

interface BuildingFacts {
  tiv?: number;
  buildingYear?: number;
  approvedConstructionPercentage?: number;
  constructionDescription?: string;
  primaryRiskState?: string;
  primaryLocation?: { state?: string; county?: string };
  undedupedTiv?: number;
}

/**
 * Everything the building schedule answers, from the risk locations when the
 * record has any, else from the fallback location at low confidence.
 */
function deriveFromLocations(
  row: UnknownRecord,
  choices: FieldChoice[],
  fallback: FallbackLocation | undefined,
  leaves: BuildingLeaves,
  notes: DerivationNote[],
): BuildingFacts {
  const risk = riskLocations(row, choices);
  const stateChoice = choiceFor(choices, "riskState");
  const buildingChoice = choiceFor(choices, "buildingYear") ?? choiceFor(choices, "constructionType");
  const facts: BuildingFacts = {};

  let locations = risk.locations;
  let buildings = risk.buildings;
  let lowConfidence: string | undefined;
  let stateSource = stateChoice?.path ?? "";
  let buildingSource = buildingChoice?.path ?? "";

  if (locations.length === 0 && buildings.length === 0) {
    const stand = fallbackLocation(row, fallback);
    if (stand && (stand.state || stand.buildings.length)) {
      locations = [stand];
      buildings = dedupe(stand.buildings);
      lowConfidence = `Used the location at ${fallback!.locationPath} (the insured's own address); no risk schedule exists on this record.`;
      stateSource = fallback!.statePath;
      buildingSource = fallback!.buildingsPath ?? fallback!.locationPath;
      notes.push({
        field: "*",
        method: lowConfidence,
        sourcePath: fallback!.locationPath,
        confidence: "low",
        ambiguity: "Location-derived factors are a stand-in until a risk schedule is available.",
      });
    }
  }

  const primary = derivePrimaryState(locations, leaves, stateSource, notes, lowConfidence);
  facts.primaryRiskState = primary.state;
  facts.primaryLocation = primary.location ? { state: primary.location.state, county: primary.location.county } : undefined;

  const values = buildings
    .map((building) => firstNumber(building, leaves.value))
    .filter((value): value is number => value !== undefined);
  if (values.length > 0) {
    facts.tiv = values.reduce((total, value) => total + value, 0);
    notes.push({
      field: "tiv",
      method: `Summed ${values.length} building value(s) across ${locations.length} location(s).` + (lowConfidence ? ` ${lowConfidence}` : ""),
      sourcePath: buildingSource,
      confidence: lowConfidence ? "low" : "high",
    });
  }
  if (!lowConfidence) {
    const undeduped = risk.undedupedBuildings
      .map((building) => firstNumber(building, leaves.value))
      .filter((value): value is number => value !== undefined);
    facts.undedupedTiv = undeduped.length ? undeduped.reduce((total, value) => total + value, 0) : undefined;
  }

  facts.buildingYear = deriveBuildingYear(buildings, leaves, buildingSource, notes, lowConfidence);
  const construction = deriveConstruction(buildings, leaves, buildingSource, notes, lowConfidence);
  facts.approvedConstructionPercentage = construction.share;
  facts.constructionDescription = construction.description;
  return facts;
}

export function assembleSubmissions({ plan, rootRows, queuePlan, queueRows = [] }: AssembleInput): AssembledSubmission[] {
  const leaves = buildingLeaves(plan.choices);
  const claimsChoice = choiceFor(plan.choices, "lossAmount");
  const claimsPath = claimsChoice?.path ? parentOf(claimsChoice.path) : undefined;
  const queueChoices = queuePlan?.choices ?? [];

  const assembled: AssembledSubmission[] = [];
  const linkedQueueIds = new Set<string>();

  for (const row of rootRows) {
    const notes: DerivationNote[] = [];
    const queueId = plan.queueLinkPath ? referenceId(getPath(row, plan.queueLinkPath)) : undefined;
    if (queueId) linkedQueueIds.add(queueId);
    const queueRow = queueId ? queueRows.find((candidate) => asString(candidate.id) === queueId) : undefined;

    const effectiveDate =
      scalarString(row, choiceFor(plan.choices, "effectiveDate")) ??
      (queueRow ? scalarString(queueRow, choiceFor(queueChoices, "effectiveDate")) : undefined);

    const facts = deriveFromLocations(row, plan.choices, plan.fallback, leaves, notes);
    const tiv = facts.tiv ?? exposureValue(row, plan.choices, notes);

    const claims = claimsPath ? dedupe(collectPath(row, claimsPath).filter(isRecord)) : [];
    const losses = claimsPath ? deriveLosses(claims, effectiveDate, plan.choices, notes) : undefined;

    const identifier =
      (queueRow ? scalarString(queueRow, choiceFor(queueChoices, "submissionIdentifier")) : undefined) ??
      scalarString(row, choiceFor(plan.choices, "submissionIdentifier")) ??
      asString(row.id) ??
      `record-${assembled.length + 1}`;

    assembled.push({
      sourceRecordId: asString(row.id),
      undedupedTiv: facts.undedupedTiv,
      primaryLocation: facts.primaryLocation,
      submission: {
        id: identifier,
        accountName:
          scalarString(row, choiceFor(plan.choices, "accountName")) ??
          (queueRow ? scalarString(queueRow, choiceFor(queueChoices, "accountName")) : undefined) ??
          "Unknown account",
        submissionType: scalarString(row, choiceFor(plan.choices, "submissionType")),
        lineOfBusiness:
          scalarString(row, choiceFor(plan.choices, "lineOfBusiness")) ??
          (queueRow ? scalarString(queueRow, choiceFor(queueChoices, "lineOfBusiness")) : undefined),
        primaryRiskState: facts.primaryRiskState,
        effectiveDate,
        expirationDate: scalarString(row, choiceFor(plan.choices, "expirationDate")),
        tiv,
        totalPremium: scalarNumber(row, choiceFor(plan.choices, "totalPremium")),
        buildingYear: facts.buildingYear,
        approvedConstructionPercentage: facts.approvedConstructionPercentage,
        constructionDescription: facts.constructionDescription,
        fiveYearLossValue: losses,
      },
      notes,
    });
  }

  for (const queueRow of queueRows) {
    const id = asString(queueRow.id);
    if (id && linkedQueueIds.has(id)) continue;
    assembled.push(assembleUnboundSubmission(queueRow, queuePlan, leaves));
  }

  return assembled;
}

/**
 * A submission with no policy yet is the one an underwriter still has to act
 * on, so it stays in the queue. Premium and loss history do not exist for it;
 * they are left undefined rather than guessed. Location-derived factors come
 * from the fallback location at low confidence, and the requested limit stands
 * in for TIV only when no building at all is known.
 */
function assembleUnboundSubmission(
  row: UnknownRecord,
  queuePlan: QueuePlan | undefined,
  leaves: BuildingLeaves,
): AssembledSubmission {
  const choices = queuePlan?.choices ?? [];
  const notes: DerivationNote[] = [
    {
      field: "*",
      method: "This submission has no bound policy, so premium and loss history are not in the data yet.",
      sourcePath: "",
      confidence: "low",
      ambiguity: "Scored on the fields that exist; the rest stay unknown and need underwriter follow-up.",
    },
  ];

  const facts = deriveFromLocations(row, [], queuePlan?.fallback, leaves, notes);
  let tiv = facts.tiv;
  if (tiv === undefined) {
    const limitChoice = choiceFor(choices, "requestedLimit");
    tiv = scalarNumber(row, limitChoice);
    if (tiv !== undefined) {
      notes.push({
        field: "tiv",
        method: "Used the requested limit as a stand-in; no building is known for this submission.",
        sourcePath: limitChoice?.path ?? "",
        confidence: "low",
        ambiguity: "A requested limit is not a total insured value.",
      });
    }
  }

  return {
    sourceRecordId: asString(row.id),
    primaryLocation: facts.primaryLocation,
    submission: {
      id: scalarString(row, choiceFor(choices, "submissionIdentifier")) ?? asString(row.id) ?? "unknown-submission",
      accountName: scalarString(row, choiceFor(choices, "accountName")) ?? "Unknown account",
      lineOfBusiness: scalarString(row, choiceFor(choices, "lineOfBusiness")),
      primaryRiskState: facts.primaryRiskState,
      effectiveDate: scalarString(row, choiceFor(choices, "effectiveDate")),
      tiv,
      buildingYear: facts.buildingYear,
      approvedConstructionPercentage: facts.approvedConstructionPercentage,
      constructionDescription: facts.constructionDescription,
    },
    notes,
  };
}
