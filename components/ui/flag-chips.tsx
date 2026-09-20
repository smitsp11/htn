import type { RankedSubmission } from "@/lib/domain/types";
import { flagSummary, reasonsByTone, type FlagTone } from "@/lib/rankings/flags";

const TONE_ORDER: FlagTone[] = ["red", "yellow", "preferred"];
const TONE_LABEL: Record<FlagTone, string> = { red: "not acceptable", yellow: "unresolved", preferred: "wanted" };

export interface FlagChipsProps {
  submission: RankedSubmission;
}

export function FlagChips({ submission }: FlagChipsProps) {
  const summary = flagSummary(submission);
  const reasons = reasonsByTone(submission);
  return (
    <span className="flag-chips">
      {TONE_ORDER.map((tone) =>
        summary[tone] > 0 ? (
          <span
            key={tone}
            className={`flag-chip flag-${tone}`}
            title={reasons[tone].join("\n")}
          >
            <b>{summary[tone]}</b> {TONE_LABEL[tone]}
          </span>
        ) : null,
      )}
    </span>
  );
}
