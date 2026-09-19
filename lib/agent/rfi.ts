import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";

export interface RfiDraft {
  subject: string;
  body: string;
  /** The human labels of the fields being requested. */
  missingItems: string[];
}

/** Build a review-only broker Request-For-Information from the unresolved
 *  required fields. Returns null when the submission is already in good order.
 *  Deterministic and template-based — it never invents a value or a fact. */
export function draftRfi(submission: RankedSubmission): RfiDraft | null {
  const { missingLabels } = completenessOf(submission);
  if (missingLabels.length === 0) return null;

  const subject = `Information needed to complete: ${submission.accountName} (${submission.id})`;
  const checklist = missingLabels.map((label) => `  • ${label}`).join("\n");
  const body =
    `Hi,\n\n` +
    `Thanks for the submission for ${submission.accountName}. To complete our review we still need the following:\n\n` +
    `${checklist}\n\n` +
    `Once we have these we can finish evaluating the account. Please reply with the details or attach the relevant documents (e.g. SOV, loss runs).\n\n` +
    `Thank you.`;

  return { subject, body, missingItems: missingLabels };
}
