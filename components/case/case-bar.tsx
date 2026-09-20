import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";
import { Badge } from "@/components/ui/badge";
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
 * Case bar: back button, account identity, and on the right the appetite verdict
 * plus a single "how much is left to resolve" badge. The completeness-percentage,
 * flag counts, and other meta stats were removed — an underwriter opening a case
 * needs the verdict and the remaining effort, not five restatements of coverage.
 */
export function CaseBar({ submission, onBack }: CaseBarProps) {
  const completeness = completenessOf(submission);

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
      </div>
    </header>
  );
}
