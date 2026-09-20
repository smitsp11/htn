import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextSignal } from "@/lib/domain/types";
import { runQueryAgent } from "@/lib/federato/adapter";
import { createReplaySource } from "@/lib/federato/replay";

/** The offline canonical submissions, replayed through the query agent — the
 *  same path the pipeline uses in offline mode (loadOfflineSubmissions was
 *  retired in favour of the replay source). */
async function loadOfflineSubmissions() {
  const source = createReplaySource();
  const { submissions } = await runQueryAgent({
    discoverSchema: source.discoverSchema,
    execute: source.execute,
  });
  return submissions;
}

const asOf = new Date().toISOString().slice(0, 10);

/** USPS abbreviation → Census state FIPS. */
const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10",
  DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19",
  KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27",
  MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35",
  NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44",
  SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53",
  WV: "54", WI: "55", WY: "56",
};

const FIPS_TO_ABBR = Object.fromEntries(
  Object.entries(STATE_FIPS).map(([abbr, fips]) => [fips, abbr]),
) as Record<string, string>;

/**
 * ACS 2022 5-year median household income (B19013_001E) — offline fallback
 * when the Census API is unreachable. Prefer the live all-states fetch.
 */
const ACS_2022_FALLBACK: Record<string, { name: string; income: number }> = {
  AL: { name: "Alabama", income: 59_609 },
  AK: { name: "Alaska", income: 86_370 },
  AZ: { name: "Arizona", income: 72_581 },
  AR: { name: "Arkansas", income: 56_335 },
  CA: { name: "California", income: 91_905 },
  CO: { name: "Colorado", income: 87_598 },
  CT: { name: "Connecticut", income: 90_213 },
  DE: { name: "Delaware", income: 79_325 },
  DC: { name: "District of Columbia", income: 101_722 },
  FL: { name: "Florida", income: 67_917 },
  GA: { name: "Georgia", income: 71_355 },
  HI: { name: "Hawaii", income: 94_814 },
  ID: { name: "Idaho", income: 70_214 },
  IL: { name: "Illinois", income: 78_433 },
  IN: { name: "Indiana", income: 67_173 },
  IA: { name: "Iowa", income: 70_571 },
  KS: { name: "Kansas", income: 69_747 },
  KY: { name: "Kentucky", income: 60_183 },
  LA: { name: "Louisiana", income: 57_852 },
  ME: { name: "Maine", income: 68_251 },
  MD: { name: "Maryland", income: 98_461 },
  MA: { name: "Massachusetts", income: 96_505 },
  MI: { name: "Michigan", income: 68_505 },
  MN: { name: "Minnesota", income: 84_313 },
  MS: { name: "Mississippi", income: 52_985 },
  MO: { name: "Missouri", income: 65_920 },
  MT: { name: "Montana", income: 66_341 },
  NE: { name: "Nebraska", income: 71_722 },
  NV: { name: "Nevada", income: 71_646 },
  NH: { name: "New Hampshire", income: 90_845 },
  NJ: { name: "New Jersey", income: 97_126 },
  NM: { name: "New Mexico", income: 58_722 },
  NY: { name: "New York", income: 81_386 },
  NC: { name: "North Carolina", income: 66_186 },
  ND: { name: "North Dakota", income: 73_959 },
  OH: { name: "Ohio", income: 66_990 },
  OK: { name: "Oklahoma", income: 61_364 },
  OR: { name: "Oregon", income: 76_632 },
  PA: { name: "Pennsylvania", income: 73_170 },
  RI: { name: "Rhode Island", income: 81_370 },
  SC: { name: "South Carolina", income: 63_623 },
  SD: { name: "South Dakota", income: 69_457 },
  TN: { name: "Tennessee", income: 64_035 },
  TX: { name: "Texas", income: 73_035 },
  UT: { name: "Utah", income: 86_833 },
  VT: { name: "Vermont", income: 74_014 },
  VA: { name: "Virginia", income: 87_249 },
  WA: { name: "Washington", income: 90_325 },
  WV: { name: "West Virginia", income: 55_291 },
  WI: { name: "Wisconsin", income: 72_458 },
  WY: { name: "Wyoming", income: 72_495 },
};

function formatIncome(raw: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(raw);
}

function censusUrl(fips: string): string {
  return `https://api.census.gov/data/2022/acs/acs5?get=NAME,B19013_001E&for=state:${fips}`;
}

function signalFor(name: string, income: number, url: string): ContextSignal {
  return {
    source: "Census ACS",
    label: "Median household income (state)",
    value: `${formatIncome(income)} · ${name}`,
    url,
    asOf,
  };
}

/** Prefer one all-states Census call; fall back to the ACS 2022 snapshot. */
async function loadStateSignals(): Promise<Map<string, ContextSignal>> {
  const byAbbr = new Map<string, ContextSignal>();
  const allUrl = "https://api.census.gov/data/2022/acs/acs5?get=NAME,B19013_001E&for=state:*";
  try {
    const res = await fetch(allUrl, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      const rows = (await res.json()) as string[][];
      for (const row of rows.slice(1)) {
        const [name, incomeRaw, fips] = row;
        const abbr = FIPS_TO_ABBR[fips];
        const income = Number(incomeRaw);
        if (!abbr || !Number.isFinite(income) || income < 0) continue;
        byAbbr.set(abbr, signalFor(name, income, censusUrl(fips)));
      }
    }
  } catch {
    // use offline snapshot below
  }

  for (const [abbr, fallback] of Object.entries(ACS_2022_FALLBACK)) {
    if (byAbbr.has(abbr)) continue;
    const fips = STATE_FIPS[abbr];
    if (!fips) continue;
    byAbbr.set(abbr, signalFor(fallback.name, fallback.income, censusUrl(fips)));
  }
  return byAbbr;
}

async function main() {
  const subs = await loadOfflineSubmissions();
  const byState = await loadStateSignals();
  const out: Record<string, ContextSignal[]> = {};
  let withState = 0;

  for (const s of subs) {
    const state = s.primaryRiskState?.trim().toUpperCase() ?? "";
    if (!state) continue;
    withState += 1;
    const signal = byState.get(state);
    if (signal) out[s.id] = [{ ...signal }];
  }

  const path = join(process.cwd(), "raw", "context.json");
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `context.json written for ${Object.keys(out).length} / ${withState} submissions with a risk state → ${path}`,
  );
}

void main();
