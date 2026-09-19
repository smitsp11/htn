/**
 * Turns API records into `CanonicalSubmission` values.
 *
 * Every appetite factor in the guidelines is a single value, but the data is
 * relational: a submission has many locations, each with many buildings, and
 * losses sit on claims that may belong to an earlier term. Each aggregation
 * choice below is deliberate and is reported as a derivation note so Person 3
 * and Person 4 can show an underwriter where a number came from.
 */

import type { CanonicalSubmission } from "@/lib/domain/types";
import type { DataPlan, FieldChoice } from "./schema-planner";
import type { RequirementKey } from "./requirements";
import {
  asNumber,
  asString,
  collectPath,
  getPath,
  isRecord,
  type UnknownRecord,
} from "./response";

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
}

/** Construction descriptions the guidelines accept when they exceed 50%. */
const APPROVED_CONSTRUCTION = /joisted masonry|non[-\s]?combustible|steel/i;
/**
 * Fire resistive is a superior class that the 2025 table simply does not list.
 * It is excluded from the approved share and reported as an ambiguity rather
 * than silently counted either way.
 */
const UNLISTED_CONSTRUCTION = /fire resistive/i;

const FIVE_YEARS_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;

function pathFor(plan: DataPlan, key: RequirementKey): FieldChoice | undefined {
  return plan.choices.find((choice) => choice.key === key && choice.path);
}

/** Deepest array/`many` prefix on a path, i.e. the collection to iterate. */
function collectionPath(choice: FieldChoice | undefined): { prefix?: string; leaf?: string } {
  if (!choice?.path) return {};
  const deepest = [...choice.manyAt].sort((left, right) => right.length - left.length)[0];
  if (!deepest || !choice.path.startsWith(`${deepest}.`)) return { leaf: choice.path };
  return { prefix: deepest, leaf: choice.path.slice(deepest.length + 1) };
}

function records(row: UnknownRecord, path?: string): UnknownRecord[] {
  if (!path) return [];
  return collectPath(row, path).filter(isRecord);
}

function numbers(row: UnknownRecord, path?: string): number[] {
  if (!path) return [];
  return collectPath(row, path)
    .map(asNumber)
    .filter((value): value is number => value !== undefined);
}

function siblingNumber(record: UnknownRecord, pattern: RegExp): number | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (pattern.test(key)) {
      const parsed = asNumber(value);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

/**
 * Total insured value: sum the per-building values when they are available,
 * because they are the values the construction and building-age factors are
 * weighted by. Exposure-unit basis amounts are the fallback, and are only
 * counted for units whose basis or kind marks them as insured value — a fleet
 * cost must never be added to a property TIV.
 */
function deriveTiv(
  row: UnknownRecord,
  buildings: UnknownRecord[],
  plan: DataPlan,
  notes: DerivationNote[],
): number | undefined {
  const buildingTiv = buildings
    .map((building) => siblingNumber(building, /^tiv$/i))
    .filter((value): value is number => value !== undefined);

  if (buildingTiv.length > 0) {
    notes.push({
      field: "tiv",
      method: `Summed ${buildingTiv.length} building value(s).`,
      sourcePath: pathFor(plan, "buildingYear")?.path?.replace(/\.[^.]+$/, ".tiv") ?? "buildings.tiv",
      confidence: "high",
    });
    return buildingTiv.reduce((total, value) => total + value, 0);
  }

  const tivChoice = pathFor(plan, "tiv");
  const { prefix, leaf } = collectionPath(tivChoice);
  const units = records(row, prefix);
  if (units.length > 0 && leaf) {
    const insuredValue = units.filter((unit) => {
      const basis = asString(unit.basis) ?? "";
      const kind = asString(unit.kind) ?? "";
      return /tiv|value|location|property/i.test(`${basis} ${kind}`);
    });
    const chosen = insuredValue.length > 0 ? insuredValue : units;
    const amounts = chosen
      .map((unit) => asNumber(getPath(unit, leaf)))
      .filter((value): value is number => value !== undefined);
    if (amounts.length > 0) {
      notes.push({
        field: "tiv",
        method: `Summed ${amounts.length} exposure unit(s)${insuredValue.length === 0 ? " of every kind" : " measured on an insured-value basis"}.`,
        sourcePath: tivChoice?.path ?? "",
        confidence: insuredValue.length === 0 ? "low" : "medium",
        ambiguity:
          insuredValue.length === 0
            ? "No exposure unit declared an insured-value basis, so units of every kind were summed."
            : undefined,
      });
      return amounts.reduce((total, value) => total + value, 0);
    }
  }

  const direct = numbers(row, tivChoice?.path);
  if (direct.length === 1) {
    notes.push({
      field: "tiv",
      method: "Used the single value on the record; no exposure detail was available.",
      sourcePath: tivChoice?.path ?? "",
      confidence: "low",
      ambiguity: "This is a requested limit, not an appraised total insured value.",
    });
    return direct[0];
  }
  return undefined;
}

/**
 * Primary risk state: the state holding the largest share of insured value.
 * A submission spread over several states has no single state in the data, and
 * the guidelines score "primary risk state", so value share decides it.
 */
function deriveRiskState(
  row: UnknownRecord,
  plan: DataPlan,
  notes: DerivationNote[],
): string | undefined {
  const choice = pathFor(plan, "riskState");
  const { prefix, leaf } = collectionPath(choice);
  const containers = prefix ? records(row, prefix) : [];

  const weights = new Map<string, number>();
  for (const container of containers) {
    const state = asString(leaf ? getPath(container, leaf) : undefined)?.trim().toUpperCase();
    if (!state) continue;
    const buildings = collectPath(container, "buildings").filter(isRecord);
    const value = buildings.length
      ? buildings.reduce((total, building) => total + (siblingNumber(building, /^tiv$/i) ?? 0), 0)
      : (siblingNumber(container, /basis_amount|value/i) ?? 1);
    weights.set(state, (weights.get(state) ?? 0) + Math.max(value, 1));
  }

  if (weights.size === 0) {
    const flat = collectPath(row, choice?.path ?? "").map(asString).filter(Boolean) as string[];
    if (flat.length === 0) return undefined;
    notes.push({
      field: "primaryRiskState",
      method: "Used the only state on the record.",
      sourcePath: choice?.path ?? "",
      confidence: "medium",
    });
    return flat[0].trim().toUpperCase();
  }

  const ranked = [...weights.entries()].sort((left, right) => right[1] - left[1]);
  const [state, weight] = ranked[0];
  const total = ranked.reduce((sum, [, value]) => sum + value, 0);
  const share = Math.round((weight / total) * 100);
  notes.push({
    field: "primaryRiskState",
    method: `${state} holds ${share}% of insured value across ${ranked.length} state(s): ${ranked.map(([name]) => name).join(", ")}.`,
    sourcePath: choice?.path ?? "",
    confidence: ranked.length === 1 ? "high" : share >= 50 ? "medium" : "low",
    ambiguity:
      ranked.length > 1 && share < 50
        ? "No state holds a majority of the insured value, so the primary risk state is contestable."
        : undefined,
  });
  return state;
}

/**
 * Building age: the oldest building. The guidelines exclude buildings older
 * than 1990, and the oldest building is the one that would breach that.
 */
function deriveBuildingYear(
  buildings: UnknownRecord[],
  plan: DataPlan,
  notes: DerivationNote[],
): number | undefined {
  const choice = pathFor(plan, "buildingYear");
  const { leaf } = collectionPath(choice);
  const years = buildings
    .map((building) => asNumber(leaf ? getPath(building, leaf) : undefined))
    .filter((value): value is number => value !== undefined);
  if (years.length === 0) return undefined;

  const oldest = Math.min(...years);
  const newest = Math.max(...years);
  notes.push({
    field: "buildingYear",
    method:
      years.length === 1
        ? "Single building on the submission."
        : `Oldest of ${years.length} buildings (${oldest}–${newest}); the oldest building is the one that breaches the age rule.`,
    sourcePath: choice?.path ?? "",
    confidence: "high",
  });
  return oldest;
}

/**
 * Construction: share of insured value in an approved construction class,
 * because the guidelines are written as ">50%" and value is what is at risk.
 */
function deriveConstruction(
  buildings: UnknownRecord[],
  plan: DataPlan,
  notes: DerivationNote[],
): { share?: number; description?: string } {
  const choice = pathFor(plan, "constructionType");
  const { leaf } = collectionPath(choice);
  if (!leaf || buildings.length === 0) return {};

  let approved = 0;
  let unlisted = 0;
  let total = 0;
  const seen = new Map<string, number>();

  for (const building of buildings) {
    const description = asString(getPath(building, leaf));
    if (!description) continue;
    const weight = siblingNumber(building, /^tiv$/i) ?? 1;
    total += weight;
    seen.set(description, (seen.get(description) ?? 0) + weight);
    if (APPROVED_CONSTRUCTION.test(description)) approved += weight;
    else if (UNLISTED_CONSTRUCTION.test(description)) unlisted += weight;
  }
  if (total === 0) return {};

  const share = approved / total;
  const unlistedShare = unlisted / total;
  const mix = [...seen.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, weight]) => `${name} ${Math.round((weight / total) * 100)}%`)
    .join(", ");

  notes.push({
    field: "approvedConstructionPercentage",
    method: `${Math.round(share * 100)}% of insured value is joisted masonry, non-combustible/steel or masonry non-combustible. Mix: ${mix}.`,
    sourcePath: choice?.path ?? "",
    confidence: unlistedShare > 0 ? "low" : "high",
    ambiguity:
      unlistedShare > 0
        ? `${Math.round(unlistedShare * 100)}% of insured value is fire resistive, a class the 2025 table does not list. It is excluded from the approved share; including it would give ${Math.round((share + unlistedShare) * 100)}%.`
        : undefined,
  });

  return { share, description: mix };
}

/**
 * Five-year losses: incurred indemnity (paid plus reserved) on claims whose
 * date of loss falls in the five years before the effective date. Open claims
 * count at their reserve, which is what an underwriter would price against.
 */
function deriveLosses(
  claims: UnknownRecord[],
  effectiveDate: string | undefined,
  plan: DataPlan,
  notes: DerivationNote[],
): number | undefined {
  if (claims.length === 0) return undefined;
  const lossDateChoice = pathFor(plan, "lossDate");
  const { leaf: lossDateLeaf } = collectionPath(lossDateChoice);
  const anchor = effectiveDate ? Date.parse(effectiveDate) : Date.now();

  let total = 0;
  let counted = 0;
  let undated = 0;

  for (const claim of claims) {
    const indemnity = Object.entries(claim)
      .filter(([key]) => /indemnity/i.test(key))
      .map(([, value]) => asNumber(value) ?? 0)
      .reduce((sum, value) => sum + value, 0);
    if (indemnity === 0) continue;

    const raw = lossDateLeaf ? asString(getPath(claim, lossDateLeaf)) : undefined;
    const lossTime = raw ? Date.parse(raw) : Number.NaN;
    if (Number.isNaN(lossTime)) {
      undated += 1;
      total += indemnity;
      counted += 1;
      continue;
    }
    if (Number.isFinite(anchor) && anchor - lossTime > FIVE_YEARS_MS) continue;
    total += indemnity;
    counted += 1;
  }

  notes.push({
    field: "fiveYearLossValue",
    method: `Incurred indemnity (paid plus reserved) on ${counted} of ${claims.length} claim(s) within five years of the effective date.`,
    sourcePath: pathFor(plan, "lossAmount")?.path ?? "",
    confidence: undated > 0 ? "medium" : "high",
    ambiguity: undated > 0 ? `${undated} claim(s) had no usable date of loss and were counted anyway.` : undefined,
  });

  return total;
}

function firstString(row: UnknownRecord, choice: FieldChoice | undefined): string | undefined {
  if (!choice?.path) return undefined;
  const values = collectPath(row, choice.path).map(asString).filter(Boolean) as string[];
  return values[0];
}

function firstNumber(row: UnknownRecord, choice: FieldChoice | undefined): number | undefined {
  if (!choice?.path) return undefined;
  return numbers(row, choice.path)[0];
}

export interface AssembleInput {
  plan: DataPlan;
  rootRows: UnknownRecord[];
  queueRows?: UnknownRecord[];
  /** Field choices used for the queue-only query, when one ran. */
  queueChoices?: FieldChoice[];
}

function referenceId(value: unknown): string | undefined {
  if (isRecord(value)) return asString(value.id);
  return asString(value);
}

export function assembleSubmissions({
  plan,
  rootRows,
  queueRows = [],
  queueChoices = [],
}: AssembleInput): AssembledSubmission[] {
  const buildingChoice = pathFor(plan, "buildingYear") ?? pathFor(plan, "constructionType");
  const buildingsPath = collectionPath(buildingChoice).prefix;
  const claimsPath = collectionPath(pathFor(plan, "lossAmount")).prefix;

  const assembled: AssembledSubmission[] = [];
  const linkedQueueIds = new Set<string>();

  for (const row of rootRows) {
    const notes: DerivationNote[] = [];
    const buildings = records(row, buildingsPath);
    const claims = records(row, claimsPath);

    const effectiveDate = firstString(row, pathFor(plan, "effectiveDate"));
    const queueId = plan.queueLinkPath ? referenceId(getPath(row, plan.queueLinkPath)) : undefined;
    if (queueId) linkedQueueIds.add(queueId);
    const queueRow = queueId
      ? queueRows.find((candidate) => asString(candidate.id) === queueId)
      : undefined;

    const construction = deriveConstruction(buildings, plan, notes);
    const identifier =
      (queueRow ? firstString(queueRow, findChoice(queueChoices, "submissionIdentifier")) : undefined) ??
      firstString(row, pathFor(plan, "submissionIdentifier")) ??
      asString(row.id) ??
      `record-${assembled.length + 1}`;

    assembled.push({
      sourceRecordId: asString(row.id),
      submission: {
        id: identifier,
        accountName: firstString(row, pathFor(plan, "accountName")) ?? "Unknown account",
        submissionType: firstString(row, pathFor(plan, "submissionType")),
        lineOfBusiness: firstString(row, pathFor(plan, "lineOfBusiness")),
        primaryRiskState: deriveRiskState(row, plan, notes),
        effectiveDate,
        expirationDate: firstString(row, pathFor(plan, "expirationDate")),
        tiv: deriveTiv(row, buildings, plan, notes),
        totalPremium: firstNumber(row, pathFor(plan, "totalPremium")),
        buildingYear: deriveBuildingYear(buildings, plan, notes),
        approvedConstructionPercentage: construction.share,
        constructionDescription: construction.description,
        fiveYearLossValue: deriveLosses(claims, effectiveDate, plan, notes),
      },
      notes,
    });
  }

  for (const queueRow of queueRows) {
    const id = asString(queueRow.id);
    if (id && linkedQueueIds.has(id)) continue;
    assembled.push(assembleUnboundSubmission(queueRow, queueChoices));
  }

  return assembled;
}

function findChoice(choices: FieldChoice[], key: RequirementKey): FieldChoice | undefined {
  return choices.find((choice) => choice.key === key && choice.path);
}

/**
 * A submission with no policy yet is the one an underwriter still has to act
 * on, so it stays in the queue. Premium, buildings and losses do not exist for
 * it; they are left undefined rather than guessed, and the requested limit is
 * reported as a low-confidence stand-in for TIV.
 */
function assembleUnboundSubmission(
  row: UnknownRecord,
  choices: FieldChoice[],
): AssembledSubmission {
  const notes: DerivationNote[] = [
    {
      field: "*",
      method:
        "This submission has no bound policy, so premium, building detail and loss history are not in the data yet.",
      sourcePath: "",
      confidence: "low",
      ambiguity: "Scored on the fields that exist; the rest stay unknown and need underwriter follow-up.",
    },
  ];

  const stateChoice = findChoice(choices, "riskState");
  if (stateChoice?.path?.includes("hq")) {
    notes.push({
      field: "primaryRiskState",
      method: "Used the insured's headquarters state; no risk schedule exists yet.",
      sourcePath: stateChoice.path,
      confidence: "low",
      ambiguity: "A headquarters address is not necessarily where the insured property sits.",
    });
  }

  const tivChoice = findChoice(choices, "tiv");
  const tiv = firstNumber(row, tivChoice);
  if (tiv !== undefined) {
    notes.push({
      field: "tiv",
      method: "Used the requested limit as a stand-in; no exposure schedule exists yet.",
      sourcePath: tivChoice?.path ?? "",
      confidence: "low",
      ambiguity: "A requested limit is not a total insured value.",
    });
  }

  return {
    sourceRecordId: asString(row.id),
    submission: {
      id:
        firstString(row, findChoice(choices, "submissionIdentifier")) ??
        asString(row.id) ??
        "unknown-submission",
      accountName: firstString(row, findChoice(choices, "accountName")) ?? "Unknown account",
      lineOfBusiness: firstString(row, findChoice(choices, "lineOfBusiness")),
      primaryRiskState: firstString(row, stateChoice)?.trim().toUpperCase(),
      effectiveDate: firstString(row, findChoice(choices, "effectiveDate")),
      tiv,
    },
    notes,
  };
}
