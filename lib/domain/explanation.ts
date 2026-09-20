import { formatMoney } from "./format";
import type { AppetiteStatus, FactorEvaluation } from "./types";

/**
 * Recommendation vocabulary. Every phrase keeps the underwriter as the decision
 * maker; nothing here reads as an automatic accept, reject, or bind.
 */
const recommendations: Record<AppetiteStatus, string> = {
  in_appetite: "Review for acceptance",
  needs_investigation: "Investigate data",
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

const numberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number) => numberWords[n] ?? String(n);
const article = (noun: string) => (/^[aeiou]/i.test(noun) ? "an" : "a");

/** "cgl" -> "CGL"; longer names are shown as recorded. */
function displayLine(line: string): string {
  const trimmed = line.trim();
  return trimmed.length <= 3 ? trimmed.toUpperCase() : trimmed;
}

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
  /** Profile fields for the opening sentence; each is omitted when unknown. */
  submissionType?: string;
  primaryRiskState?: string;
  tiv?: number;
}

/** "a new-business commercial property submission in CA with $45M TIV". */
function profile(input: ExplanationInput): string {
  const type = input.submissionType?.trim().toLowerCase() ?? "";
  const typeWord = /renew/.test(type) ? "renewal" : /new/.test(type) ? "new-business" : undefined;
  const line = input.lineOfBusiness?.trim();
  const isProperty = !line || /property/i.test(line);
  const lineWord = line ? (isProperty ? "commercial property" : displayLine(line).toLowerCase()) : undefined;
  const noun = [typeWord, lineWord, "submission"].filter(Boolean).join(" ");
  const where = input.primaryRiskState ? ` in ${input.primaryRiskState}` : "";
  const size =
    isProperty && typeof input.tiv === "number" && Number.isFinite(input.tiv) ? ` with ${formatMoney(input.tiv)} TIV` : "";
  return `${article(noun)} ${noun}${where}${size}`;
}

/** "4 target, 3 acceptable, 1 unknown of 8 factors": how the score was earned. */
function tally(factors: FactorEvaluation[]): string {
  const count = (verdict: FactorEvaluation["verdict"]) => factors.filter((factor) => factor.verdict === verdict).length;
  const parts = [
    [count("target"), "target"],
    [count("acceptable"), "acceptable"],
    [count("unknown"), "unknown"],
    [count("not_acceptable"), "not acceptable"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, word]) => `${n} ${word}`);
  return `${parts.join(", ")} of ${factors.length} factors`;
}

/**
 * Three deterministic sentences, following the format in the appetite
 * guidelines: (1) what the submission is and how it scored, with the tally of
 * factor verdicts behind the number; (2) the material factors with their
 * observed values — failures first, then unknowns, then targets; (3) the
 * recommendation. Contradictions are named explicitly rather than averaged
 * into the score, and unknowns are never treated as acceptable.
 */
export function buildExplanation(input: ExplanationInput): string {
  if (input.status === "out_of_scope") {
    const line = input.lineOfBusiness?.trim() ? displayLine(input.lineOfBusiness) : "non-property";
    return `${input.accountName} is ${article(line)} ${line} submission. The 2025 appetite guidelines cover commercial property only, so no appetite is defined for this line. Recommendation: ${input.recommendation}.`;
  }

  const unacceptable = input.factors.filter((factor) => factor.verdict === "not_acceptable");
  const unknown = input.factors.filter((factor) => factor.verdict === "unknown");
  const targets = input.factors.filter((factor) => factor.verdict === "target");

  const first = `${input.accountName} is ${profile(input)}; it scores ${input.score}/100 (${tally(input.factors)}) ${statusPhrase[input.status]}.`;

  const targetClause = `${targets.length === 1 ? "a target match on" : "target matches on"} ${valued(targets)}`;
  let second: string;
  if (unacceptable.length > 0) {
    const clauses = [`Not acceptable: ${valued(unacceptable)}`];
    if (targets.length > 0) {
      clauses.push(`this contradicts ${targetClause}, which ${targets.length === 1 ? "does" : "do"} not offset it`);
    }
    if (unknown.length > 0) clauses.push(`unresolved: ${names(unknown)}`);
    second = `${clauses.join("; ")}.`;
  } else if (unknown.length > 0) {
    const clauses = [`Unresolved: ${names(unknown)}`];
    if (targets.length > 0) clauses.push(targetClause);
    second = `${clauses.join("; ")}.`;
  } else if (targets.length > 0) {
    second = `${targetClause.charAt(0).toUpperCase()}${targetClause.slice(1)}; the remaining factors are acceptable.`;
  } else {
    second = `All ${numberWord(input.factors.length)} factors are acceptable with no target matches.`;
  }

  return `${first} ${second} Recommendation: ${input.recommendation}.`;
}
