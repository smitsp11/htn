/**
 * Serializable record of what the query agent did and why.
 *
 * Person 4 renders this in the shared UI, so every entry must be safe to show
 * an underwriter: no credentials, no raw API objects, no stack traces.
 */

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
