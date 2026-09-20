"use client";

import { useEffect, useState } from "react";
import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";
import { fixturesFor } from "@/lib/demo/fixtures";
import {
  loadDemoState,
  reopenDecision,
  saveDecision,
  validateDecision,
} from "@/lib/demo/decision-store";
import type { DemoDecision, DemoDecisionKind } from "@/lib/demo/types";
import { Icon } from "@/components/ui/icon";
import { Toast } from "@/components/ui/toast";

const money = (value: number | undefined): string =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

/** "in_appetite" -> "In appetite". Pure re-presentation of the engine's own status word. */
function statusLabel(status: string): string {
  const words = status.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const CHOICES: { value: DemoDecisionKind; label: string }[] = [
  { value: "approve", label: "Approve" },
  { value: "decline", label: "Decline" },
  { value: "request_info", label: "Request info" },
];

export interface DecisionSidebarProps {
  submission: RankedSubmission;
  onDecided?(): void;
}

/**
 * Persisted decision sidebar: ported from federanorth's `workflowPanel`
 * (src/decision/dashboard.js) as a client-side mock over `lib/demo/decision-store`
 * (localStorage) rather than a server-recorded workflow. The decision is a demo
 * record only -- it never touches `submission.status`/`score`.
 */
export function DecisionSidebar({ submission, onDecided }: DecisionSidebarProps) {
  const [choice, setChoice] = useState<DemoDecisionKind | null>(null);
  const [premium, setPremium] = useState("");
  const [terms, setTerms] = useState("");
  const [rationale, setRationale] = useState("");
  const [author, setAuthor] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [decided, setDecided] = useState<DemoDecision | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const state = loadDemoState();
    setDecided(state.decisions[submission.id] ?? null);
  }, [submission.id]);

  const completeness = completenessOf(submission);
  const pricing = fixturesFor(submission.id).pricing;

  function record() {
    const input = {
      kind: choice as DemoDecisionKind,
      author,
      rationale,
      premium: choice === "approve" ? Number(premium) : undefined,
    };
    const result = validateDecision(input);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    const decision: DemoDecision = {
      submissionId: submission.id,
      kind: input.kind,
      author: input.author,
      rationale: input.rationale,
      premium: input.premium,
      terms: choice === "approve" ? terms : undefined,
      decidedAt: new Date().toISOString(),
    };
    saveDecision(decision);
    setDecided(decision);
    setToast("Decision recorded.");
    onDecided?.();
  }

  function reopen() {
    reopenDecision(submission.id);
    setDecided(null);
    setChoice(null);
    setErrors([]);
  }

  const canRecord = choice != null && author.trim().length > 0;

  return (
    <aside className="decision-sidebar">
      <div className="record-metrics">
        <div>
          <small>Appetite score</small>
          <strong>{submission.score}/100</strong>
        </div>
        <div>
          <small>Status</small>
          <strong>{statusLabel(submission.status)}</strong>
        </div>
        <div>
          <small>Property TIV</small>
          <strong>{money(submission.tiv)}</strong>
        </div>
        <div>
          <small>Submission premium</small>
          <strong>{money(submission.totalPremium)}</strong>
        </div>
      </div>

      {decided && (
        <div className="decided-banner">
          <div>
            <span className="decided-label">{statusLabel(decided.kind)}</span>
            {decided.rationale && <p>{decided.rationale}</p>}
            <small>
              {decided.author} · {new Date(decided.decidedAt).toLocaleString()}
            </small>
          </div>
          <button type="button" className="button" onClick={reopen}>
            Reopen
          </button>
        </div>
      )}

      <div className="decide-form">
        <div className="section-title">
          <h3>Your decision</h3>
          <span>Saved to this case</span>
        </div>
        <div className="decision-choices">
          {CHOICES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`decision-choice${choice === option.value ? " selected" : ""}`}
              onClick={() => setChoice(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {choice === "approve" && (
          <div className="pricing">
            <div className="section-title">
              <h3>Pricing</h3>
              <span>{completeness.effortToDecision === 0 ? "in good order" : `${completeness.effortToDecision} to resolve`}</span>
            </div>
            <div className="record-metrics">
              {pricing.map((band) => (
                <div key={band.label}>
                  <small>{band.label}</small>
                  <strong>{band.value}</strong>
                </div>
              ))}
            </div>
            <label className="field">
              <span>Proposed premium</span>
              <input
                type="number"
                min={0}
                step={100}
                value={premium}
                onChange={(event) => setPremium(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Terms or conditions</span>
              <input
                type="text"
                maxLength={500}
                value={terms}
                onChange={(event) => setTerms(event.target.value)}
                placeholder="Deductible, sub-limits, warranties"
              />
            </label>
          </div>
        )}

        <label className="field">
          <span>Rationale</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Why this decision, on this evidence"
          />
        </label>
        <label className="field">
          <span>Decided by</span>
          <input
            type="text"
            maxLength={120}
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            placeholder="Your name"
          />
        </label>

        {errors.length > 0 && (
          <ul className="decision-errors">
            {errors.map((error) => (
              <li key={error}>
                <Icon name="alert" />
                {error}
              </li>
            ))}
          </ul>
        )}

        <div className="decide-actions">
          <button type="button" className="button mint" disabled={!canRecord} onClick={record}>
            Record decision
          </button>
        </div>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </aside>
  );
}
