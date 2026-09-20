import { LOSS_MAX, PREMIUM_MAX, PREMIUM_MIN, TIV_MAX, YEAR_ACCEPTABLE_AFTER } from "./appetite";
import { formatMoney } from "./format";
import type { FactorEvaluation, FactorKey, RankedSubmission } from "./types";

export interface FlipFactor {
  key: FactorKey;
  label: string;
  /** The engine's own reason for the current verdict. */
  reason: string;
  /** True when the underwriter/broker can realistically change this; false when it is a
   *  fixed fact about the risk (where it sits, when it was built, what it's made of). */
  movable: boolean;
  /** What closing this gap actually requires, in one sentence. */
  action: string;
}

const ASK: Record<FactorKey, string> = {
  submissionType: "Confirm whether this submission is new business or a renewal.",
  lineOfBusiness: "Confirm the recorded line of business.",
  primaryRiskState: "Confirm the primary risk state for the insured locations.",
  tiv: "Provide a statement of values with total insured value.",
  totalPremium: "Request the quoted total premium.",
  buildingYear: "Confirm the year built for the oldest insured building.",
  construction: "Confirm the approved-construction percentage across the schedule.",
  fiveYearLossValue: "Request a five-year loss run.",
};

/** For a not-acceptable factor, what it would actually take to flip it -- or why it can't. */
function actionFor(factor: FactorEvaluation, submission: RankedSubmission): { movable: boolean; action: string } {
  switch (factor.key) {
    case "submissionType":
      return { movable: false, action: "Renewal business can't become a new-business submission." };
    case "lineOfBusiness":
      return { movable: false, action: `${submission.lineOfBusiness ?? "This line"} would have to be written as property.` };
    case "primaryRiskState": {
      const state = submission.primaryRiskState?.trim().toUpperCase();
      return {
        movable: false,
        action: state ? `${state} isn't on the acceptable state list -- the risk location is fixed.` : "State is outside the acceptable list.",
      };
    }
    case "tiv": {
      const tiv = submission.tiv;
      if (typeof tiv === "number" && tiv > TIV_MAX) {
        return { movable: false, action: `TIV is ${formatMoney(tiv - TIV_MAX)} over the $150M cap -- insured value is a fact of the risk, not a lever.` };
      }
      return { movable: false, action: "TIV exceeds the $150M cap." };
    }
    case "totalPremium": {
      const premium = submission.totalPremium;
      if (typeof premium === "number" && premium < PREMIUM_MIN) {
        return { movable: true, action: `Premium is ${formatMoney(PREMIUM_MIN - premium)} under the $50K floor -- re-quote at a higher premium.` };
      }
      if (typeof premium === "number" && premium > PREMIUM_MAX) {
        return { movable: true, action: `Premium is ${formatMoney(premium - PREMIUM_MAX)} over the $175K cap -- re-quote at a lower premium or split the limit.` };
      }
      return { movable: true, action: "Re-quote the premium within the $50K–$175K band." };
    }
    case "buildingYear": {
      const year = submission.buildingYear;
      if (typeof year === "number") {
        return { movable: false, action: `Built in ${year}, ${YEAR_ACCEPTABLE_AFTER - year} year(s) before the ${YEAR_ACCEPTABLE_AFTER} cutoff -- construction date can't change.` };
      }
      return { movable: false, action: `Oldest building predates ${YEAR_ACCEPTABLE_AFTER}.` };
    }
    case "construction": {
      const pct = submission.approvedConstructionPercentage;
      if (typeof pct === "number") {
        const percent = Math.round((pct > 1 ? pct / 100 : pct) * 100);
        return { movable: false, action: `Only ${percent}% approved construction, needs more than 50% -- structural type is fixed absent a rebuild.` };
      }
      return { movable: false, action: "Approved construction is under 50% of TIV." };
    }
    case "fiveYearLossValue": {
      const loss = submission.fiveYearLossValue;
      if (typeof loss === "number" && loss > LOSS_MAX) {
        return {
          movable: true,
          action: `Losses are ${formatMoney(loss - LOSS_MAX)} over the $100K cap -- re-review once the loss window rolls forward, or confirm a smaller confirmed figure.`,
        };
      }
      return { movable: true, action: "Five-year losses exceed the $100K cap." };
    }
  }
}

/**
 * What it would take to move this submission toward appetite: one entry per factor that is
 * currently blocking or unresolved, marked movable (broker/underwriter can act on it) or
 * immovable (a fixed fact about the risk). Read-only: it never changes a factor, a status, or
 * a score -- it only explains the deterministic engine's own verdicts in "what next" terms.
 */
export function flipAnalysisFor(submission: RankedSubmission): FlipFactor[] {
  return submission.factors
    .filter((factor) => factor.verdict === "not_acceptable" || factor.verdict === "unknown")
    .map((factor) => {
      if (factor.verdict === "unknown") {
        return { key: factor.key, label: factor.label, reason: factor.reason, movable: true, action: ASK[factor.key] };
      }
      const { movable, action } = actionFor(factor, submission);
      return { key: factor.key, label: factor.label, reason: factor.reason, movable, action };
    });
}
