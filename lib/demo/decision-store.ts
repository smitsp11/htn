"use client";
import type {
  DemoDecision,
  DemoDecisionKind,
  DemoEvidenceFact,
  DemoState,
  RequestState,
} from "./types";

const KEY = "federanorth.demo.v1";

const EMPTY: DemoState = { decisions: {}, evidence: {}, requestStates: {} };

export interface DecisionInput {
  kind: DemoDecisionKind;
  author: string;
  rationale?: string;
  premium?: number;
}

export function validateDecision(input: DecisionInput): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const needsRationale = input.kind === "decline" || input.kind === "request_info";
  if (needsRationale && (input.rationale ?? "").trim().length < 10) {
    errors.push("A rationale of at least 10 characters is required.");
  }
  if (input.kind === "approve") {
    if (input.premium == null || !Number.isFinite(input.premium) || input.premium < 0) {
      errors.push("Premium must be a valid non-negative number.");
    }
  }
  return { ok: errors.length === 0, errors };
}

function read(): DemoState {
  if (typeof window === "undefined") return structuredClone(EMPTY);
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    return { ...structuredClone(EMPTY), ...(JSON.parse(raw) as DemoState) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(state: DemoState): DemoState {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}

export function loadDemoState(): DemoState {
  return read();
}

export function saveDecision(decision: DemoDecision): DemoState {
  const state = read();
  state.decisions[decision.submissionId] = decision;
  return write(state);
}

export function reopenDecision(submissionId: string): DemoState {
  const state = read();
  delete state.decisions[submissionId];
  return write(state);
}

/** Recompute disputed status for one factor: set the moment two facts disagree on value,
 *  cleared the moment only one distinct value remains (e.g. after a correction is logged). */
function reconcileFactor(facts: DemoEvidenceFact[], factorKey: string): void {
  const forFactor = facts.filter((fact) => fact.factorKey === factorKey);
  const distinctValues = new Set(forFactor.map((fact) => fact.value));
  const disputed = distinctValues.size > 1;
  for (const fact of forFactor) {
    if (fact.state === "confirmed") continue; // an underwriter's confirmation stands
    fact.state = disputed ? "disputed" : "observed";
  }
}

export function addEvidenceFact(fact: Omit<DemoEvidenceFact, "id" | "state">): DemoState {
  const state = read();
  const facts = (state.evidence[fact.submissionId] ??= []);
  facts.push({ ...fact, id: `${fact.submissionId}:${fact.factorKey}:${facts.length}`, state: "observed" });
  reconcileFactor(facts, fact.factorKey);
  return write(state);
}

export function confirmEvidenceFact(submissionId: string, factId: string, confirmedBy: string): DemoState {
  const state = read();
  const facts = state.evidence[submissionId] ?? [];
  const fact = facts.find((f) => f.id === factId);
  if (fact) {
    fact.state = "confirmed";
    fact.confirmedBy = confirmedBy;
    fact.confirmedAt = new Date().toISOString();
  }
  return write(state);
}

export function evidenceFactsFor(submissionId: string): DemoEvidenceFact[] {
  return read().evidence[submissionId] ?? [];
}

export function setRequestState(submissionId: string, requestKey: string, value: RequestState): DemoState {
  const state = read();
  (state.requestStates[submissionId] ??= {})[requestKey] = value;
  return write(state);
}

/** Persisted state for a single evidence request, so task cards survive a reload. */
export function getRequestState(submissionId: string, requestKey: string): RequestState | undefined {
  return read().requestStates[submissionId]?.[requestKey];
}
