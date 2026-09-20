import type { ChannelName, ScenarioEntry } from "./index";
import { SCENARIO } from "./index";

/** Human labels for scenario channel pages. */
export const CHANNEL_TITLES: Record<ChannelName, string> = {
  email: "Broker email",
  sov: "Schedule of values (SOV)",
  portal: "Broker portal",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDisplay(value: number | string): string {
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US").format(value);
  }
  return value;
}

/** Build a realistic-looking channel page the live browser can read. */
export function buildChannelHtml(entry: ScenarioEntry, channel: ChannelName): string | null {
  const held = entry.channels.filter((c) => c.channel === channel);
  if (held.length === 0) return null;

  const rows = held
    .map(
      (h) => `
      <tr>
        <th scope="row">${escapeHtml(h.field)}</th>
        <td>
          <span data-field="${escapeHtml(h.field)}" data-raw="${escapeHtml(String(h.value))}">
            ${escapeHtml(formatDisplay(h.value))}
          </span>
        </td>
      </tr>`,
    )
    .join("");

  const title = CHANNEL_TITLES[channel];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} · ${escapeHtml(entry.submissionId)}</title>
  <style>
    body { font-family: Georgia, serif; margin: 2rem; background: #f7f4ef; color: #1c1a16; }
    header { margin-bottom: 1.5rem; }
    .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .7rem; color: #6b6458; }
    h1 { font-size: 1.4rem; margin: .2rem 0; }
    table { border-collapse: collapse; width: min(520px, 100%); background: #fff; }
    th, td { border: 1px solid #d9d2c5; padding: .65rem .8rem; text-align: left; }
    th { width: 40%; background: #f0ebe3; font-weight: 600; }
    .meta { margin-top: 1rem; color: #6b6458; font-size: .85rem; }
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">${escapeHtml(title)}</div>
    <h1>Submission ${escapeHtml(entry.submissionId)}</h1>
    <p class="meta">Scattered broker channel — seeded for live Browserbase consolidation.</p>
  </header>
  <table>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

export function scenarioEntry(submissionId: string): ScenarioEntry | undefined {
  return SCENARIO.find((e) => e.submissionId === submissionId);
}

export function scenarioSubmissionIds(): string[] {
  return SCENARIO.map((e) => e.submissionId);
}
