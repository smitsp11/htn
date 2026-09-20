import type { AppetiteStatus, FactorEvaluation } from "./types";

/**
 * Recommendation vocabulary. Every phrase keeps the underwriter as the decision
 * maker; nothing here reads as an automatic accept, reject, or bind.
 */
const recommendations: Record<AppetiteStatus, string> = {
  in_appetite: "Review for acceptance",
  needs_investigation: "Investigate missing or ambiguous data",
  out_of_appetite: "Review for likely decline",
  out_of_scope: "Out of scope — line not written",
};

export function recommendationFor(status: AppetiteStatus): string {
  return recommendations[status];
}

const statusPhrase: Record<AppetiteStatus, string> = {
  in_appetite: "and is in appetite",
  needs_investigation: "and needs investigation",
  out_of_appetite: "but is out of appetite",
  out_of_scope: "and is out of scope",
};

function names(factors: FactorEvaluation[]) {
  return factors.map((factor) => factor.label.toLowerCase()).join(", ");
}

/** "building year (built in 1985, 5 years before the 1990 cutoff)": the label with the observed value. */
function withValue(factor: FactorEvaluation): string {
  const reason = factor.reason.trim().replace(/\.$/, "");
  // Lowercase a leading word unless it is an acronym or a state code (TIV, TX).
  const firstWord = reason.split(" ")[0];
  const acronym = firstWord.length > 1 && firstWord === firstWord.toUpperCase();
  const clause = acronym ? reason : reason.charAt(0).toLowerCase() + reason.slice(1);
  return `${factor.label.toLowerCase()} (${clause})`;
}

function valued(factors: FactorEvaluation[]) {
  return factors.map(withValue).join(", ");
}

export interface ExplanationInput {
  accountName: string;
  status: AppetiteStatus;
  score: number;
  factors: FactorEvaluation[];
  recommendation: string;
  lineOfBusiness?: string;
}

/**
 * Three deterministic sentences: appetite match with score, the material
 * factors (failures first, with their observed values, then unknowns, then
 * targets), and the recommendation. Contradictions are named explicitly
 * rather than averaged into the score.
 */
export function buildExplanation(input: ExplanationInput): string {
  if (input.status === "out_of_scope") {
    const line = input.lineOfBusiness?.trim() || "non-property";
    return `${input.accountName} is a ${line} submission. The 2025 appetite guidelines cover commercial property only, so no appetite is defined for this line. Recommendation: ${input.recommendation}.`;
  }

  const unacceptable = input.factors.filter((factor) => factor.verdict === "not_acceptable");
  const unknown = input.factors.filter((factor) => factor.verdict === "unknown");
  const targets = input.factors.filter((factor) => factor.verdict === "target");

  const first = `${input.accountName} scores ${input.score}/100 ${statusPhrase[input.status]}.`;

  let second: string;
  if (unacceptable.length > 0) {
    const clauses = [`Not acceptable: ${valued(unacceptable)}`];
    if (targets.length > 0) {
      clauses.push(`this contradicts target matches on ${names(targets)}, which do not offset it`);
    }
    if (unknown.length > 0) clauses.push(`unresolved: ${names(unknown)}`);
    second = `${clauses.join("; ")}.`;
  } else if (unknown.length > 0) {
    const clauses = [`Unresolved: ${names(unknown)}`];
    if (targets.length > 0) clauses.push(`target matches on ${names(targets)}`);
    second = `${clauses.join("; ")}.`;
  } else if (targets.length > 0) {
    second = `Target matches on ${names(targets)}; the remaining factors are acceptable.`;
  } else {
    second = "All eight factors are acceptable with no target matches.";
  }

  return `${first} ${second} Recommendation: ${input.recommendation}.`;
}
