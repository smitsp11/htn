import assert from "node:assert/strict";
import test from "node:test";
import { loadOfflineEnrichment } from "../lib/federato/offline-data";

test("loadOfflineEnrichment maps every submission id to a HazardProfile", async () => {
  const map = await loadOfflineEnrichment();
  assert.ok(map.size >= 150, `expected ~158 entries, got ${map.size}`);
  // Submission 1 (Harbor Point) primary location is FL|Hillsborough.
  const p = map.get("SUB-2025-00001");
  assert.ok(p, "submission 1 has an enrichment profile");
  assert.equal(p!.source, "FEMA NRI");
});
