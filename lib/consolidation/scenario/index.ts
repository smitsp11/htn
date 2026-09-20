import type { FactorKey } from "@/lib/domain/types";

export type ChannelName = "email" | "sov" | "portal";

export interface HeldField {
  channel: ChannelName;
  field: FactorKey;
  /** The value the broker actually provided in that channel. */
  value: number | string;
  /** How confidently this channel yields the value once located. */
  confidence: number;
}

export interface ScenarioEntry {
  submissionId: string;
  channels: HeldField[];
}

/**
 * Staged scattered-channel data for offline demo submissions whose appetite
 * factors are genuinely absent (unknown premium / loss history). Values stand
 * in for what the broker emailed, attached in an SOV, or posted to the portal.
 */
export const SCENARIO: ScenarioEntry[] = [
  {
    submissionId: "SUB-2025-00138",
    channels: [
      { channel: "email", field: "totalPremium", value: 92_000, confidence: 0.9 },
      { channel: "sov", field: "fiveYearLossValue", value: 0, confidence: 0.85 },
    ],
  },
  {
    submissionId: "SUB-2025-00132",
    channels: [
      { channel: "portal", field: "totalPremium", value: 64_500, confidence: 0.8 },
      { channel: "email", field: "fiveYearLossValue", value: 12_500, confidence: 0.75 },
    ],
  },
];
