import type { FactorKey } from "@/lib/domain/types";

export type DemoDecisionKind = "approve" | "decline" | "request_info";

export interface DemoDecision {
  submissionId: string;
  kind: DemoDecisionKind;
  author: string;
  rationale?: string;
  premium?: number; // approve only
  terms?: string; // approve only
  decidedAt: string; // ISO timestamp
}

/**
 * A single fact's audit trail: where it came from, when it was logged, and
 * whether anyone has verified it. `disputed` is set automatically -- never by a
 * user -- the moment two logged facts for the same factor disagree on value.
 */
export type EvidenceState = "observed" | "confirmed" | "disputed";

export interface DemoEvidenceFact {
  id: string;
  submissionId: string;
  factorKey: FactorKey;
  factorLabel: string;
  value: string;
  source: string;
  sourceDate?: string;
  citation?: string;
  state: EvidenceState;
  confirmedBy?: string;
  confirmedAt?: string;
  recordedAt: string; // ISO timestamp
}

export type RequestState = "open" | "sent" | "received" | "waived";

export interface DemoState {
  decisions: Record<string, DemoDecision>; // key: submissionId
  evidence: Record<string, DemoEvidenceFact[]>; // key: submissionId
  requestStates: Record<string, Record<string, RequestState>>; // submissionId -> requestKey -> state
}

// ---- Static-fixture types (deferred panels) ----
export interface DemoLead {
  kind: string;
  label: string;
  value: string;
  detail: string;
  caution?: string;
  sources: string[];
}

export interface DemoSignal {
  tone: "positive" | "warning" | "neutral";
  headline: string;
  detail: string;
}

export interface DemoPricingBand {
  label: string;
  value: string;
}

export interface DemoResearchNote {
  factorLabel: string;
  reading: string;
  verifyNext: string;
  basedOn: string;
}

export interface DemoResearch {
  locationMatch: string;
  femaFloodZone: string;
  currentWeather: string;
  notes: DemoResearchNote[];
  sources: { label: string; href: string; status: string }[];
}

export interface DemoIntakeProposal {
  factorKey: FactorKey;
  factorLabel: string;
  proposedValue: string;
  quote: string;
  citation: string;
}

export interface DemoFixtureBundle {
  leads: DemoLead[];
  signals: DemoSignal[];
  pricing: DemoPricingBand[];
  research: DemoResearch;
  intakeProposals: DemoIntakeProposal[];
}
