import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextSignal } from "@/lib/domain/types";

export type ContextIndex = Record<string, ContextSignal[]>;

export function loadContextIndex(rawDir = join(process.cwd(), "raw")): ContextIndex {
  try {
    return JSON.parse(readFileSync(join(rawDir, "context.json"), "utf8")) as ContextIndex;
  } catch {
    return {};
  }
}

export function contextForSubmission(index: ContextIndex, submissionId: string): ContextSignal[] {
  return index[submissionId] ?? [];
}

/** Build a Map for the rankings pipeline from the offline context cache. */
export function loadOfflineContext(): Map<string, ContextSignal[]> {
  const index = loadContextIndex();
  return new Map(Object.entries(index));
}
