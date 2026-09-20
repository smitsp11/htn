import type { RankedSubmission } from "@/lib/domain/types";
import { distanceLabel, isOneFixAway, nearMissFactors } from "@/lib/rankings/flags";
import { Badge } from "@/components/ui/badge";

export interface DistanceChipsProps {
  submission: RankedSubmission;
}

/**
 * How far an out-of-appetite row sits from appetite, read straight off the
 * engine's verdicts: "One fix away" when exactly one factor fails, "Near miss"
 * when that failing value is within the engine's near-miss band, and the
 * plain factor count otherwise. Presentation only; no appetite logic here.
 */
export function DistanceChips({ submission }: DistanceChipsProps) {
  if (submission.status !== "out_of_appetite") return null;
  const label = distanceLabel(submission);
  const nearMisses = nearMissFactors(submission);
  const oneFix = isOneFixAway(submission);
  return (
    <span className="distance-chips">
      {oneFix ? <Badge tone="orange">One fix away</Badge> : null}
      {nearMisses.length > 0 ? (
        <Badge tone="amber">
          Near miss · {nearMisses.map((factor) => factor.label.toLowerCase()).join(", ")}
        </Badge>
      ) : null}
      {!oneFix && label ? <span className="distance-label">{label}</span> : null}
    </span>
  );
}
