import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import { runQueryAgent } from "../lib/federato/adapter";
import { loadOfflineEnrichment } from "../lib/federato/offline-data";
import { createReplaySource } from "../lib/federato/replay";

/**
 * The captured snapshot in `raw/` replayed through the query agent is the
 * offline data source the app serves by default. These are the regression
 * numbers the previous hand-written join produced for the same submission, so
 * the agent must reproduce them exactly.
 */
const source = createReplaySource();
const agentPromise = runQueryAgent({
  discoverSchema: source.discoverSchema,
  execute: source.execute,
  useModel: false,
});

test("the replayed snapshot yields all 158 canonical submissions", async () => {
  const { submissions } = await agentPromise;
  assert.equal(submissions.length, 158, "every captured Submission must be normalized (none dropped)");
  assert.equal(new Set(submissions.map((submission) => submission.id)).size, 158, "ids must be unique");
});

test("a known submission joins and maps correctly against the real raw data", async () => {
  const { submissions } = await agentPromise;
  // Raw Submission id 1 -> canonical id is its submission_number.
  const harbor = submissions.find((submission) => submission.id === "SUB-2025-00001");
  assert.ok(harbor, "submission SUB-2025-00001 should be present");

  assert.equal(harbor.accountName, "Harbor Point Retail LLC");
  assert.equal(harbor.lineOfBusiness, "property");
  assert.equal(harbor.submissionType, "new");
  assert.equal(harbor.primaryRiskState, "FL");
  assert.equal(harbor.effectiveDate, "2025-10-01");
  assert.equal(harbor.expirationDate, "2026-10-01");
  assert.equal(harbor.totalPremium, 619_900);
  // Aggregations computed from the joined buildings/claims.
  assert.equal(harbor.tiv, 112_568_000);
  assert.equal(harbor.buildingYear, 1954);
  assert.ok(
    harbor.approvedConstructionPercentage !== undefined &&
      harbor.approvedConstructionPercentage > 0.45 &&
      harbor.approvedConstructionPercentage < 0.46,
    "approved construction ratio should be ~0.455",
  );
  assert.equal(harbor.fiveYearLossValue, 228_700);
});

test("out-of-appetite submissions are retained, and every result is evaluable", async () => {
  const { submissions } = await agentPromise;
  const ranked = rankSubmissions(submissions);
  assert.equal(ranked.length, 158, "ranking must cover every submission, in or out of appetite");
  // Every in-scope (property) submission carries all eight appetite factors.
  const inScope = ranked.filter((item) => item.status !== "out_of_scope");
  assert.ok(inScope.every((item) => item.factors.length === 8));
  // Out-of-scope (non-property) submissions are scored on no property factors.
  const outOfScope = ranked.filter((item) => item.status === "out_of_scope");
  assert.ok(outOfScope.length > 0, "the snapshot includes non-property submissions");
  assert.ok(outOfScope.every((item) => item.factors.length === 0));
  // The snapshot is a mix that includes out-of-appetite property accounts.
  assert.ok(ranked.some((item) => item.status === "out_of_appetite"));
});

test("enrichment keys line up with the agent's canonical ids", async () => {
  const { submissions } = await agentPromise;
  const hazards = await loadOfflineEnrichment();
  for (const submission of submissions) {
    assert.ok(hazards.has(submission.id), `${submission.id} has no hazard profile`);
  }
});
