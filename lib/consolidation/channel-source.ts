import type { FactorKey } from "@/lib/domain/types";
import { SCENARIO, type ChannelName } from "./scenario";

export interface ChannelSource {
  channel: ChannelName;
  /** Return the value this channel holds for (submission, field), or null. */
  lookup: (
    submissionId: string,
    field: FactorKey,
  ) => { value: number | string; confidence: number } | null;
}

function fixtureSource(channel: ChannelName): ChannelSource {
  return {
    channel,
    lookup(submissionId, field) {
      const entry = SCENARIO.find((e) => e.submissionId === submissionId);
      const held = entry?.channels.find((c) => c.channel === channel && c.field === field);
      return held ? { value: held.value, confidence: held.confidence } : null;
    },
  };
}

export const emailSource = fixtureSource("email");
export const sovSource = fixtureSource("sov");
export const portalSource = fixtureSource("portal");
export const ALL_SOURCES: ChannelSource[] = [emailSource, sovSource, portalSource];
