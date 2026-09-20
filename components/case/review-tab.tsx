import type { AppetiteVerdict, FactorEvaluation, FactorKey, RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";
import { fixturesFor } from "@/lib/demo/fixtures";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { FlipAnalysis } from "@/components/case/flip-analysis";
import { ResearchPanel } from "@/components/case/research-panel";
import { ResolutionPanel } from "@/components/case/resolution-panel";
import { EvidenceIntake } from "@/components/case/evidence-intake";
import { EvidenceRequest } from "@/components/case/evidence-request";
import { TaskCard, type TaskSeverity } from "@/components/case/task-card";
import { RunConsolidation } from "@/components/consolidation/run-consolidation";
import { scenarioSubmissionIds } from "@/lib/consolidation/scenario/pages";
import { tableFor } from "@/lib/domain/appetite/registry";

/** Curated scattered-channel scenarios (W8); always expose the Consolidate affordance. */
const CONSOLIDATION_DEMO_IDS = new Set(scenarioSubmissionIds());

/**
 * Factors that gate eligibility outright (a hard "no" flips the whole submission
 * out_of_appetite). Missing one of these blocks a verdict; missing a magnitude factor
 * (tiv/premium/year/losses) is chased but less immediately dispositive.
 */
const GATE_FACTORS = new Set<FactorKey>(["submissionType", "lineOfBusiness", "primaryRiskState"]);

const ABSENT_ASK: Record<FactorKey, { question: string; needs: string }> = {
  submissionType: {
    question: "Confirm whether this submission is new business or a renewal.",
    needs: "Broker submission letter, ACORD 125, or binder request stating new/renewal status.",
  },
  lineOfBusiness: {
    question: "Confirm the recorded line of business for this submission.",
    needs: "ACORD 125/140 or broker cover note identifying the line of business.",
  },
  primaryRiskState: {
    question: "Confirm the primary risk state for the insured locations.",
    needs: "Statement of values or a list of insured location addresses.",
  },
  tiv: {
    question: "Confirm the total insured value (TIV) across all locations.",
    needs: "Statement of values with building, contents, and business-interruption values.",
  },
  totalPremium: {
    question: "Confirm the total premium quoted for this submission.",
    needs: "Quote, indication, or binder showing total premium in USD.",
  },
  buildingYear: {
    question: "Confirm the year built for the oldest insured building.",
    needs: "Statement of values or inspection report showing year built.",
  },
  construction: {
    question: "Confirm the approved-construction percentage across the schedule.",
    needs: "Statement of values with construction type recorded per building.",
  },
  fiveYearLossValue: {
    question: "Confirm the five-year property loss value for this account.",
    needs: "Five-year loss run from the broker or the expiring carrier.",
  },
};

/** Clarifying asks for the boundary cases the guidelines don't classify. Underwriter
 *  judgement calls, not broker information chases — phrased as a fact check rather than
 *  a request to justify the number. */
const AMBIGUOUS_NEEDS: Partial<Record<FactorKey, string>> = {
  submissionType: "Clarify whether this submission is new business or a renewal.",
  buildingYear: "Confirm the exact construction-completion date, or note any renovation after 1990.",
  construction: "Confirm the precise approved-construction percentage across the schedule.",
  fiveYearLossValue: "Confirm whether the reported five-year loss figure includes recoveries or salvage.",
};

const verdictTone: Record<AppetiteVerdict, BadgeTone> = {
  target: "mint",
  acceptable: "mint",
  not_acceptable: "danger",
  unknown: "amber",
};

const verdictLabel: Record<AppetiteVerdict, string> = {
  target: "Target",
  acceptable: "Acceptable",
  not_acceptable: "Not acceptable",
  unknown: "Unknown",
};

interface Gap {
  requestKey: string;
  label: string;
  severity: TaskSeverity;
  question: string;
  needs?: string;
}

function gapFor(factor: FactorEvaluation, kind: "absent" | "ambiguous", submission: RankedSubmission): Gap {
  if (kind === "absent") {
    const line = tableFor(submission.lineOfBusiness);
    const ask =
      factor.key === "tiv" && line?.line !== "property"
        ? {
            question: `Confirm the ${factor.label.toLowerCase()} used for this line.`,
            needs: `Broker submission or exposure schedule documenting the ${factor.label.toLowerCase()}.`,
          }
        : factor.key === "fiveYearLossValue" && line?.line !== "property"
          ? {
              question: `Confirm the five-year loss value for this ${line?.displayName ?? "submission"} account.`,
              needs: "Five-year loss run for the applicable line of business.",
            }
          : ABSENT_ASK[factor.key];
    return {
      requestKey: factor.key,
      label: factor.label,
      severity: GATE_FACTORS.has(factor.key) ? "blocking" : "material",
      question: ask.question,
      needs: ask.needs,
    };
  }
  return {
    requestKey: factor.key,
    label: factor.label,
    severity: "minor",
    question: `Decide how to treat this value: ${factor.reason}`,
    needs: AMBIGUOUS_NEEDS[factor.key],
  };
}

/**
 * Case review tab: recommendation, assessment, related account leads, research digest,
 * evidence intake, an evidence-request draft, and one task card per open gap. Ported from
 * federanorth's `reviewPanel` (`src/decision/dashboard.js`) against this repo's simpler
 * `RankedSubmission` + `completenessOf` model rather than federanorth's richer task/lead
 * graph. Gaps come straight from `completenessOf`: `absent` fields a broker can supply,
 * `ambiguous` fields where a value exists but the guidelines don't classify it (underwriter
 * judgement). Neither research nor evidence intake ever changes `status`/`score`/`explanation`
 * — those stay the deterministic engine's job; this tab only presents and drafts.
 */
export function ReviewTab({ submission }: { submission: RankedSubmission }) {
  const completeness = completenessOf(submission);
  const bundle = fixturesFor(submission.id);
  const factorByKey = new Map(submission.factors.map((factor) => [factor.key, factor]));

  const gaps: Gap[] = [
    ...completeness.absent.map((key) => ({ key, kind: "absent" as const })),
    ...completeness.ambiguous.map((key) => ({ key, kind: "ambiguous" as const })),
  ]
    .map(({ key, kind }) => {
      const factor = factorByKey.get(key);
      return factor ? gapFor(factor, kind, submission) : null;
    })
    .filter((gap): gap is Gap => gap !== null);

  const openGaps = gaps.map((gap) => ({ label: gap.label, needs: gap.needs }));

  return (
    <div className="review-tab">
      <section className="assessment-summary">
        <h3>Why this score</h3>
        <p>{submission.explanation}</p>
      </section>

      <FlipAnalysis submission={submission} />

      <ResolutionPanel resolution={submission.resolution} />

      <details className="detail-section" open>
        <summary>Appetite breakdown · {submission.factors.length} factors</summary>
        <div className="factor-list">
          {submission.factors.map((factor) => (
            <div className="appetite-check" key={factor.key} data-factor={factor.key}>
              <span className="appetite-check-label">{factor.label}</span>
              <Badge tone={verdictTone[factor.verdict]}>{verdictLabel[factor.verdict]}</Badge>
              {factor.nearMiss ? <Badge tone="amber">Near miss</Badge> : null}
              <p>{factor.reason}</p>
              {factor.detail ? <p className="factor-detail">{factor.detail}</p> : null}
              {factor.evidence ? (
                <p className="factor-evidence">
                  <b>Source:</b>{" "}
                  {factor.evidence.sourcePath ? <code>{factor.evidence.sourcePath}</code> : "not recorded"} ·{" "}
                  {factor.evidence.method} · {factor.evidence.confidence} confidence
                  {factor.evidence.ambiguity ? <span className="ambiguity"> · {factor.evidence.ambiguity}</span> : null}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </details>

      {bundle.leads.length > 0 ? (
        <details className="leads">
          <summary>
            <span>
              <Icon name="book" /> Related information we already hold
            </span>
            <span className="lead-count">{bundle.leads.length}</span>
            <Icon name="chevron" />
          </summary>
          <div className="lead-list">
            {bundle.leads.map((lead) => (
              <article className="lead" key={lead.label}>
                <header>
                  <span className="lead-kind">{lead.kind}</span>
                  <strong>{lead.label}</strong>
                </header>
                <b className="lead-value">{lead.value}</b>
                <p>{lead.detail}</p>
                <p className="lead-caution">
                  <Icon name="info" /> Context only.
                </p>
              </article>
            ))}
          </div>
        </details>
      ) : null}

      <ResearchPanel submission={submission} />

      <EvidenceIntake submission={submission} />

      <EvidenceRequest submission={submission} openGaps={openGaps} />

      {submission.status === "needs_investigation" || CONSOLIDATION_DEMO_IDS.has(submission.id) ? (
        <RunConsolidation
          submissionId={submission.id}
          fields={completeness.absent}
          labels={Object.fromEntries(submission.factors.map((factor) => [factor.key, factor.label]))}
        />
      ) : null}

      <div className="task-list">
        {gaps.length === 0 ? (
          <p className="all-clear">In good order — no outstanding evidence.</p>
        ) : (
          gaps.map((gap) => (
            <TaskCard
              key={gap.requestKey}
              submissionId={submission.id}
              requestKey={gap.requestKey}
              severity={gap.severity}
              label={gap.label}
              question={gap.question}
              needs={gap.needs}
            />
          ))
        )}
      </div>
    </div>
  );
}
