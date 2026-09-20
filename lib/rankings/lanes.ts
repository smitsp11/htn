import type { AppetiteStatus } from "@/lib/domain/types";

export type Lane = "work-now" | "chase-evidence" | "declined" | "not-property";

export const LANE_LABELS: Record<Lane, string> = {
  "work-now": "Ready for review",
  "chase-evidence": "Needs evidence",
  declined: "Outside appetite",
  "not-property": "Not evaluated",
};

const STATUS_TO_LANE: Record<AppetiteStatus, Lane> = {
  in_appetite: "work-now",
  needs_investigation: "chase-evidence",
  out_of_appetite: "declined",
  out_of_scope: "not-property",
};

export function laneForStatus(status: AppetiteStatus): Lane {
  return STATUS_TO_LANE[status];
}
