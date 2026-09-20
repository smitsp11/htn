/**
 * Serializable record of what the query agent did and why.
 *
 * Person 4 renders this in the shared UI, so every entry must be safe to show
 * an underwriter: no credentials, no raw API objects, no stack traces.
 */

import type { QueryReasoning } from "@/lib/domain/types";
import type { DataPlan, QueuePlan } from "./schema-planner";

export type TraceStage = "schema" | "plan" | "query" | "repair" | "derive" | "warning";

export interface TraceStep {
  stage: TraceStage;
  title: string;
  detail: string;
  /** Small, printable facts. Never raw records. */
  facts?: Record<string, string | number | boolean>;
  at: string;
}

export interface QueryTrace {
  steps: TraceStep[];
  add(stage: TraceStage, title: string, detail: string, facts?: TraceStep["facts"]): void;
  /** Flat sentences for the existing `RankingsResponse.trace` string array. */
  summarize(): string[];
}

export function createTrace(): QueryTrace {
  const steps: TraceStep[] = [];
  return {
    steps,
    add(stage, title, detail, facts) {
      steps.push({ stage, title, detail, facts, at: new Date().toISOString() });
    },
    summarize() {
      return steps.map((step) => `${step.title}: ${step.detail}`);
    },
  };
}

/**
 * Federato's workflow rethrows every failure as a plain `Error`, so the machine
 * readable parts survive only inside the message text, for example
 * `[VALIDATION_ERROR] Unknown operator "$grt" {"operator":"$grt"}`.
 */
export function parseApiError(error: unknown): { code?: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const match = /\[([A-Z_]+)\]\s*(.*)/s.exec(message);
  return match ? { code: match[1], message: match[2].trim() } : { message };
}

/** The plan and steps as the dashboard-safe `QueryReasoning` shape. */
export function buildQueryReasoning(plan: DataPlan, queuePlan: QueuePlan | undefined, steps: TraceStep[]): QueryReasoning {
  return {
    rootResource: plan.rootResource,
    queueResource: plan.queueResource,
    plannedBy: plan.plannedBy,
    fields: plan.choices.map((choice) => {
      const requires: string[] = [];
      if (choice.expandChain.length) requires.push(`expand ${choice.expandChain.join(" → ")}`);
      if (choice.manyAt.length) requires.push(`array at ${choice.manyAt.join(", ")}`);
      return {
        field: choice.key,
        label: choice.label,
        appetiteReason: choice.appetiteReason,
        schemaPath: choice.path ? `${plan.rootResource}.${choice.path}` : undefined,
        reason: choice.reason,
        chosenBy: choice.chosenBy,
        requires: requires.length ? requires.join("; ") : undefined,
        alternatives: choice.alternatives.slice(0, 3),
      };
    }),
    unresolved: plan.unresolved.map((item) => ({ field: item.label, reason: item.reason })),
    fallbacks: [
      ...(plan.fallback ? [`${plan.rootResource}.${plan.fallback.locationPath}: ${plan.fallback.reason}`] : []),
      ...(queuePlan?.fallback ? [`${queuePlan.resource}.${queuePlan.fallback.locationPath}: ${queuePlan.fallback.reason}`] : []),
    ],
    steps: steps.map((step) => ({ stage: step.stage, title: step.title, detail: step.detail })),
  };
}
