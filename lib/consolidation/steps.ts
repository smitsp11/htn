import type { FactorKey } from "@/lib/domain/types";
import type { ChannelName } from "./scenario";

/** One line in the consolidation trace: a channel being read, a field found, or a summary note. */
export interface LiveConsolidationStep {
  channel: ChannelName | "summary";
  message: string;
  ok: boolean;
}

export const CHANNEL_READING: Record<ChannelName, string> = {
  email: "Reading email…",
  sov: "Reading SOV…",
  portal: "Reading portal…",
};

const FIELD_LABELS: Partial<Record<FactorKey, string>> = {
  totalPremium: "premium",
  fiveYearLossValue: "five-year losses",
  tiv: "TIV",
  buildingYear: "building year",
  submissionType: "submission type",
  primaryRiskState: "risk state",
  lineOfBusiness: "line of business",
  construction: "construction",
};

/**
 * Field-aware display: money as $M/$k, a building year as a plain year, construction as a
 * percentage. Keeps the trace and chips legible whatever factor a channel recovered.
 */
export function formatFieldValue(field: FactorKey, value: number | string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (field === "buildingYear") return String(Math.round(value));
  if (field === "construction") {
    const fraction = value > 1 ? value / 100 : value;
    return `${Math.round(fraction * 100)}%`;
  }
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = value / 1_000_000;
    return `$${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (abs >= 10_000) return `$${Math.round(value / 1000)}k`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function foundMessage(field: FactorKey, value: number | string): string {
  const label = FIELD_LABELS[field] ?? field;
  return `Found ${label}: ${formatFieldValue(field, value)}`;
}

export function parseFieldValue(raw: string): number | string {
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const digits = trimmed.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(digits)) return Number(digits);
  return trimmed;
}
