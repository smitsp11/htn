import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";
import { Badge } from "@/components/ui/badge";
import { FlagChips } from "@/components/ui/flag-chips";
import { Icon } from "@/components/ui/icon";
import { LaneBadge } from "@/components/ui/lane-badge";

export interface CaseBarProps {
  submission: RankedSubmission;
  onBack: () => void;
}

/** "in_appetite" -> "In appetite". Pure re-presentation of the engine's own status word. */
function statusLabel(status: string): string {
  const words = status.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Case bar: back button, account identity, and on the right the lane badge,
 * an in-good-order badge derived from `completenessOf`, flag chips, and the
 * "factors established" score. That score is the completeness resolved/total
 * ratio (the fraction of the eight appetite factors the engine could
 * actually resolve) rather than `submission.score` -- it mirrors
 * federanorth's `evidenceCoverage%` "factors established" stat, which is a
 * data-completeness read, not the appetite score itself.
 */
export function CaseBar({ submission, onBack }: CaseBarProps) {
  const completeness = completenessOf(submission);
  const establishedPct =
    completeness.total > 0 ? Math.round((completeness.resolved / completeness.total) * 100) : 0;

  return (
    <header className="case-bar">
      <button type="button" className="case-back" onClick={onBack}>
        <Icon name="arrow" />
        <span>Back to queue</span>
      </button>
      <div className="case-ident">
        <strong>{submission.accountName}</strong>
        <span>
          {submission.id} · {submission.lineOfBusiness ?? "—"} · {statusLabel(submission.status)}
        </span>
      </div>
      <div className="case-verdict">
        <LaneBadge status={submission.status} />
        <Badge tone={completeness.inGoodOrder ? "mint" : "amber"}>
          {completeness.inGoodOrder ? "In good order" : `${completeness.effortToDecision} to resolve`}
        </Badge>
        <FlagChips submission={submission} />
        <div className="case-score">
          <strong>{establishedPct}%</strong>
          <span>factors established</span>
        </div>
      </div>
    </header>
  );
}
