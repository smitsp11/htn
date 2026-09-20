"use client";

import type { RankedSubmission } from "@/lib/domain/types";
import { completenessOf } from "@/lib/rankings/completeness";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";

export interface ChaseDialogProps {
  open: boolean;
  onClose(): void;
  submissions: RankedSubmission[];
}

interface ChaseItem {
  submissionId: string;
  accountName: string;
  labels: string[];
}

interface ChaseGroup {
  party: string;
  items: ChaseItem[];
  requestCount: number;
}

/**
 * Groups outstanding evidence gaps by who can close them: `absent` factors are
 * missing values a broker can supply, `ambiguous` factors are values the
 * guidelines don't classify -- an underwriter judgement call, not a broker
 * chase. Mirrors federanorth's `report.taskGroups` (src/decision/dashboard.js),
 * computed here directly from `completenessOf` since this repo has no
 * server-side task-group builder.
 */
function buildGroups(submissions: RankedSubmission[]): ChaseGroup[] {
  const brokerItems: ChaseItem[] = [];
  const underwriterItems: ChaseItem[] = [];

  for (const submission of submissions) {
    const completeness = completenessOf(submission);
    if (completeness.absentLabels.length > 0) {
      brokerItems.push({
        submissionId: submission.id,
        accountName: submission.accountName,
        labels: completeness.absentLabels,
      });
    }
    if (completeness.ambiguousLabels.length > 0) {
      underwriterItems.push({
        submissionId: submission.id,
        accountName: submission.accountName,
        labels: completeness.ambiguousLabels,
      });
    }
  }

  const byAccount = (a: ChaseItem, b: ChaseItem) => a.accountName.localeCompare(b.accountName);
  brokerItems.sort(byAccount);
  underwriterItems.sort(byAccount);

  const groups: ChaseGroup[] = [];
  if (brokerItems.length > 0) {
    groups.push({
      party: "Broker",
      items: brokerItems,
      requestCount: brokerItems.reduce((sum, item) => sum + item.labels.length, 0),
    });
  }
  if (underwriterItems.length > 0) {
    groups.push({
      party: "Underwriter judgement",
      items: underwriterItems,
      requestCount: underwriterItems.reduce((sum, item) => sum + item.labels.length, 0),
    });
  }
  return groups;
}

function asPlainText(groups: ChaseGroup[]): string {
  return groups
    .map((group) => {
      const lines = group.items.map(
        (item) => `  - ${item.accountName} (${item.submissionId}): ${item.labels.join(", ")}`,
      );
      return `${group.party} — ${group.requestCount} request${group.requestCount === 1 ? "" : "s"} across ${group.items.length} submission${group.items.length === 1 ? "" : "s"}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

/**
 * Chase-list dialog: every open evidence request across the loaded queue,
 * grouped by who can close it, with a copy-as-text action for pasting into
 * an email or chat. Ported from federanorth's `#chase-dialog`
 * (src/decision/dashboard.js).
 */
export function ChaseDialog({ open, onClose, submissions }: ChaseDialogProps) {
  const groups = buildGroups(submissions);

  function copyAsText() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(asPlainText(groups)).catch(() => {
      // Clipboard access can be denied by the browser; the dialog stays open either way.
    });
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <button type="button" className="icon-button close-dialog" aria-label="Close chase list" onClick={onClose}>
        <Icon name="x" />
      </button>
      <div className="eyebrow">OUTSTANDING REQUESTS</div>
      <h2>What to chase, and who to ask</h2>
      <p className="method-intro">Every open evidence request across the queue, grouped by who can answer it.</p>
      <button type="button" className="button ghost copy-chase" onClick={copyAsText}>
        <Icon name="copy" /> Copy as text
      </button>
      <div className="chase-body">
        {groups.length === 0 ? (
          <p className="method-intro">No outstanding requests. Every loaded submission is in good order.</p>
        ) : (
          groups.map((group) => (
            <section className="chase-group" key={group.party}>
              <header>
                <h3>
                  <Icon name="ask" />
                  {group.party}
                </h3>
                <span>
                  {group.requestCount} request{group.requestCount === 1 ? "" : "s"} across {group.items.length}{" "}
                  submission{group.items.length === 1 ? "" : "s"}
                </span>
              </header>
              <ul>
                {group.items.map((item) => (
                  <li key={item.submissionId}>
                    <b>{item.accountName}</b>
                    <small>{item.submissionId}</small>
                    <ol>
                      {item.labels.map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Dialog>
  );
}
