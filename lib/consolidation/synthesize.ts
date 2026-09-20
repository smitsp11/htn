import type { FactorKey } from "@/lib/domain/types";
import type { ChannelName, HeldField, ScenarioEntry } from "./scenario";

/**
 * Magnitude factors we can recover from a broker channel in the demo. Gate factors
 * (submissionType / lineOfBusiness / primaryRiskState) are never synthesized — those
 * stay a genuine broker chase, since faking a dispositive field would be misleading.
 */
export const SYNTHESIZABLE_FIELDS = new Set<FactorKey>([
  "totalPremium",
  "tiv",
  "fiveYearLossValue",
  "buildingYear",
  "construction",
]);

/** Which channel each recoverable field is staged in, so a run reads across email/SOV/portal. */
const CHANNEL_FOR: Partial<Record<FactorKey, ChannelName>> = {
  totalPremium: "email",
  fiveYearLossValue: "portal",
  tiv: "sov",
  buildingYear: "sov",
  construction: "sov",
};

const RANGES: Partial<Record<FactorKey, { min: number; max: number; step: number }>> = {
  totalPremium: { min: 50_000, max: 175_000, step: 500 },
  tiv: { min: 5_000_000, max: 150_000_000, step: 500_000 },
  fiveYearLossValue: { min: 0, max: 100_000, step: 500 },
  buildingYear: { min: 1985, max: 2015, step: 1 },
  construction: { min: 55, max: 95, step: 1 },
};

/** FNV-1a: a stable per-(submission, field) seed so the same values recur on every run. */
function seed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function inRange(value: number, min: number, max: number, step: number): number {
  const span = Math.floor((max - min) / step) + 1;
  return min + (value % span) * step;
}

/**
 * Stand-in broker-channel data for a needs-evidence submission that has no curated
 * scenario: deterministic per (submission, field), so the recovered values are stable.
 * Fake by design — the demo pretends Browserbase read them off the broker's channels.
 * Returns null when none of the requested fields are recoverable.
 */
export function synthesizeScenario(submissionId: string, fields: FactorKey[]): ScenarioEntry | null {
  const channels: HeldField[] = [];
  for (const field of fields) {
    const range = RANGES[field];
    const channel = CHANNEL_FOR[field];
    if (!SYNTHESIZABLE_FIELDS.has(field) || !range || !channel) continue;
    const s = seed(`${submissionId}:${field}`);
    channels.push({
      channel,
      field,
      value: inRange(s, range.min, range.max, range.step),
      // Unsigned shift: a signed `>>` would go negative past 2^31 and push confidence below the floor.
      confidence: Math.round((0.75 + ((s >>> 8) % 21) / 100) * 100) / 100, // 0.75–0.95, stable per field
    });
  }
  return channels.length > 0 ? { submissionId, channels } : null;
}
