import type { RankedSubmission } from "@/lib/domain/types";

export interface OutOfScopeSectionProps {
  submissions: RankedSubmission[];
}

/**
 * Non-property submissions are out of scope for the 2025 commercial-property
 * appetite guidelines, so they are not scored. They stay visible — but
 * de-emphasised — in a collapsed section below the ranked queue.
 */
export function OutOfScopeSection({ submissions }: OutOfScopeSectionProps) {
  if (submissions.length === 0) return null;
  return (
    <details className="out-of-scope-panel">
      <summary>Out of scope ({submissions.length})</summary>
      <p>
        These submissions are not commercial property. The 2025 appetite guidelines
        define appetite for property only, so they are not scored.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Line</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((submission) => (
              <tr key={submission.id}>
                <td>
                  <strong>{submission.accountName}</strong>
                  <small>{submission.id}</small>
                </td>
                <td>{submission.lineOfBusiness ?? "—"}</td>
                <td>{submission.primaryRiskState ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
