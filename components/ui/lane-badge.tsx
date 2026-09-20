import type { AppetiteStatus } from "@/lib/domain/types";
import { LANE_LABELS, laneForStatus } from "@/lib/rankings/lanes";

export interface LaneBadgeProps {
  status: AppetiteStatus;
}

export function LaneBadge({ status }: LaneBadgeProps) {
  const lane = laneForStatus(status);
  return (
    <span className={`badge lane-${lane}`}>
      <i />
      {LANE_LABELS[lane]}
    </span>
  );
}
