import type { FactorKey, RankedSubmission } from "@/lib/domain/types";
import type { ResolutionMap } from "@/lib/enrichment/resolve-submission";
import { completenessOf } from "@/lib/rankings/completeness";

export interface RfiDraft {
  subject: string;
  body: string;
  /** The human labels of the fields being requested. */
  missingItems: string[];
}

/** What to ask the broker for, per required field, in underwriting terms. */
const REQUEST_HINTS: Record<FactorKey, string> = {
  submissionType: "confirm whether this is new business or a renewal",
  lineOfBusiness: "confirm the line of business being requested",
  primaryRiskState: "the state of the primary risk location",
  tiv: "total insured value, ideally the statement of values (SOV)",
  totalPremium: "the proposed total premium for the term",
  buildingYear: "year built for each building",
  construction: "construction type by building, with the share of joisted masonry / non-combustible / masonry non-combustible",
  fiveYearLossValue: "currently valued five-year loss runs",
};

/**
 * Build a review-only broker Request-For-Information for the required fields
 * the broker has not supplied. Ambiguous values (present but unclassified by
 * the guidelines) are an underwriter call and are not requested; fields a
 * registered source has already resolved are not chased again. Returns null
 * when there is nothing to ask. Deterministic and template-based — it never
 * invents a value or a fact, and nothing is sent by this tool.
 */
export function draftRfi(submission: RankedSubmission, resolutions: ResolutionMap = {}): RfiDraft | null {
  const { absent } = completenessOf(submission);
  const toRequest = submission.factors.filter((factor) => absent.includes(factor.key) && !resolutions[factor.key]);
  if (toRequest.length === 0) return null;

  const missingItems = toRequest.map((factor) => factor.label);
  const subject = `Information needed to complete: ${submission.accountName} (${submission.id})`;
  const checklist = toRequest.map((factor) => `  • ${factor.label} — ${REQUEST_HINTS[factor.key]}`).join("\n");
  const body =
    `Hi,\n\n` +
    `Thanks for the submission for ${submission.accountName}. To complete our review we still need the following:\n\n` +
    `${checklist}\n\n` +
    `Once we have these we can finish evaluating the account. Please reply with the details or attach the relevant documents (e.g. SOV, loss runs).\n\n` +
    `Thank you.`;

  return { subject, body, missingItems };
}
