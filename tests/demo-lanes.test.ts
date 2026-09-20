import assert from "node:assert/strict";
import test from "node:test";
import { laneForStatus, LANE_LABELS, type Lane } from "../lib/rankings/lanes";

test("maps each appetite status to its lane", () => {
  assert.equal(laneForStatus("in_appetite"), "work-now");
  assert.equal(laneForStatus("needs_investigation"), "chase-evidence");
  assert.equal(laneForStatus("out_of_appetite"), "declined");
  assert.equal(laneForStatus("out_of_scope"), "not-property");
});

test("every lane has a human label", () => {
  const lanes: Lane[] = ["work-now", "chase-evidence", "declined", "not-property"];
  for (const lane of lanes) assert.ok(LANE_LABELS[lane].length > 0);
});
