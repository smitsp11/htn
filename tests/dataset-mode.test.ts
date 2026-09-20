import { test } from "node:test";
import assert from "node:assert/strict";
import type { Dataset, LineOfBusiness, RankedSubmission, RankingsResponse } from "../lib/domain/types";

test("Dataset and LineOfBusiness unions compile and carry expected members", () => {
  const d: Dataset = "extended";
  const lobs: LineOfBusiness[] = ["property", "cgl", "auto", "cyber", "excess", "health", "lpl"];
  assert.equal(d, "extended");
  assert.equal(lobs.length, 7);
});

test("RankedSubmission carries an optional synthetic flag", () => {
  const s = { synthetic: true } as Partial<RankedSubmission>;
  assert.equal(s.synthetic, true);
});

test("RankingsResponse echoes the dataset", () => {
  const r = { dataset: "baseline" } as Partial<RankingsResponse>;
  assert.equal(r.dataset, "baseline");
});

import { buildRankings } from "../lib/rankings/pipeline";
import type { CanonicalSubmission } from "../lib/domain/types";
import { rankSubmissions } from "../lib/domain/appetite";

function deps(subs: CanonicalSubmission[], extendedRank = false) {
  return {
    useDemoData: false, demoSubmissions: [], dataSource: "offline" as const,
    runAgent: async () => ({ submissions: subs, traceSummary: [] }),
    rank: (s: CanonicalSubmission[]) => rankSubmissions(s, { extended: extendedRank }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
}

test("baseline does not inject synthetic and leaves non-property out_of_scope", async () => {
  const cgl: CanonicalSubmission = { id: "c1", accountName: "Co", lineOfBusiness: "cgl", primaryRiskState: "CA", totalPremium: 60000 };
  const r = await buildRankings(deps([cgl]), { dataset: "baseline" });
  assert.equal(r.dataset, "baseline");
  assert.ok(r.submissions.every((s) => !s.synthetic));
  assert.equal(r.submissions.find((s) => s.id === "c1")!.status, "out_of_scope");
});

test("extended injects synthetic and scores cgl", async () => {
  const cgl: CanonicalSubmission = { id: "c1", accountName: "Co", lineOfBusiness: "cgl", primaryRiskState: "CA", totalPremium: 60000 };
  const r = await buildRankings(deps([cgl], true), { dataset: "extended" });
  assert.equal(r.dataset, "extended");
  assert.ok(r.submissions.some((s) => s.synthetic === true));
  assert.notEqual(r.submissions.find((s) => s.id === "c1")!.status, "out_of_scope");
});

test("pipeline attaches resolution + re-score from the consolidation index", async () => {
  const gap = { id: "SUB-SYN-0011", accountName: "Gap Co", submissionType: "new", lineOfBusiness: "property", primaryRiskState: "CA", tiv: 75_000_000, buildingYear: 2015, approvedConstructionPercentage: 0.8, fiveYearLossValue: 40000 };
  const deps = {
    useDemoData: false, demoSubmissions: [], dataSource: "offline" as const,
    runAgent: async () => ({ submissions: [gap], traceSummary: [] }),
    rank: (s: import("../lib/domain/types").CanonicalSubmission[]) => rankSubmissions(s, { extended: false }),
    loadConsolidation: async () => ({ "SUB-SYN-0011": { totalPremium: { value: 88000, provenance: { source: "broker email", confidence: 0.9, asOf: "2026-09-20" } } } }),
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  const r = await buildRankings(deps, { dataset: "baseline" });
  const sub = r.submissions.find((s) => s.id === "SUB-SYN-0011")!;
  assert.ok(sub.resolution, "resolution attached");
  assert.equal(sub.resolution!.after.status, "in_appetite");
  assert.equal(sub.status, "needs_investigation"); // queue status unchanged
});
