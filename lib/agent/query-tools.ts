import type { AppetiteStatus, HazardRating, RankedSubmission } from "@/lib/domain/types";
import { primaryReason } from "@/lib/rankings/presentation";

export interface QueueFilter {
  lineOfBusiness?: string;
  submissionType?: string;
  state?: string;
  status?: AppetiteStatus;
  scoreMin?: number;
  scoreMax?: number;
  tivMin?: number;
  tivMax?: number;
  premiumMin?: number;
  premiumMax?: number;
  buildingYearMin?: number;
  buildingYearMax?: number;
  hazardMin?: HazardRating;
}

export interface StatusCounts {
  total: number;
  in_appetite: number;
  needs_investigation: number;
  out_of_appetite: number;
  out_of_scope: number;
}

const HAZARD_ORDER: HazardRating[] = ["unknown", "very low", "relatively low", "relatively moderate", "relatively high", "very high"];
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Case-insensitive, whole-word match so "new" matches "New business" but not "Renewal business". */
const includesCI = (a: string | undefined, b: string) =>
  new RegExp(`\\b${escapeRegExp(b.trim())}\\b`, "i").test(a ?? "");

function matches(s: RankedSubmission, f: QueueFilter): boolean {
  if (f.lineOfBusiness && !includesCI(s.lineOfBusiness, f.lineOfBusiness)) return false;
  if (f.submissionType && !includesCI(s.submissionType, f.submissionType)) return false;
  if (f.state && (s.primaryRiskState ?? "").toUpperCase() !== f.state.toUpperCase()) return false;
  if (f.status && s.status !== f.status) return false;
  if (f.scoreMin !== undefined && s.score < f.scoreMin) return false;
  if (f.scoreMax !== undefined && s.score > f.scoreMax) return false;
  if (f.tivMin !== undefined && !(s.tiv !== undefined && s.tiv >= f.tivMin)) return false;
  if (f.tivMax !== undefined && !(s.tiv !== undefined && s.tiv <= f.tivMax)) return false;
  if (f.premiumMin !== undefined && !(s.totalPremium !== undefined && s.totalPremium >= f.premiumMin)) return false;
  if (f.premiumMax !== undefined && !(s.totalPremium !== undefined && s.totalPremium <= f.premiumMax)) return false;
  if (f.buildingYearMin !== undefined && !(s.buildingYear !== undefined && s.buildingYear >= f.buildingYearMin)) return false;
  if (f.buildingYearMax !== undefined && !(s.buildingYear !== undefined && s.buildingYear <= f.buildingYearMax)) return false;
  if (f.hazardMin) {
    const r = s.enrichment?.compositeRating ?? "unknown";
    if (HAZARD_ORDER.indexOf(r) < HAZARD_ORDER.indexOf(f.hazardMin)) return false;
  }
  return true;
}

/** One matched row, as handed to the language model: identity, verdict, and the engine's own headline reason. */
export interface FilterRow {
  id: string;
  accountName: string;
  status: AppetiteStatus;
  score: number;
  state?: string;
  lineOfBusiness?: string;
  reason: string;
}

/** How many matched rows the model is shown by name; the UI still receives every matched id. */
export const FILTER_ROW_LIMIT = 8;

export function filterQueue(
  subs: RankedSubmission[],
  criteria: QueueFilter,
): { matchedIds: string[]; counts: StatusCounts; rows: FilterRow[] } {
  const hits = subs.filter((s) => matches(s, criteria));
  const counts: StatusCounts = { total: hits.length, in_appetite: 0, needs_investigation: 0, out_of_appetite: 0, out_of_scope: 0 };
  for (const s of hits) counts[s.status] += 1;
  // `subs` arrives in rank order, so the first rows are the highest-ranked matches.
  const rows: FilterRow[] = hits.slice(0, FILTER_ROW_LIMIT).map((s) => ({
    id: s.id,
    accountName: s.accountName,
    status: s.status,
    score: s.score,
    state: s.primaryRiskState,
    lineOfBusiness: s.lineOfBusiness,
    reason: primaryReason(s),
  }));
  return { matchedIds: hits.map((s) => s.id), counts, rows };
}

export function resolveSubmission(subs: RankedSubmission[], nameOrId: string): RankedSubmission | undefined {
  const q = nameOrId.trim().toLowerCase();
  return subs.find((s) => s.id.toLowerCase() === q) ?? subs.find((s) => s.accountName.toLowerCase().includes(q));
}

export function explainSubmission(s: RankedSubmission) {
  return { id: s.id, accountName: s.accountName, status: s.status, score: s.score, factors: s.factors, explanation: s.explanation, enrichment: s.enrichment };
}
