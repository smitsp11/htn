import assert from "node:assert/strict";
import test from "node:test";
import { hazardKey, hazardForLocation, UNKNOWN_HAZARD } from "../lib/enrichment/hazard";
import { hazardFixture } from "./fixtures/enrichment";

test("hazardKey normalizes state/county to STATE|County", () => {
  assert.equal(hazardKey("ca", " Los Angeles "), "CA|Los Angeles");
  assert.equal(hazardKey(undefined, "X"), undefined);
  assert.equal(hazardKey("CA", undefined), undefined);
});

test("hazardForLocation returns the profile when present", () => {
  const p = hazardForLocation(hazardFixture, "CA", "Los Angeles");
  assert.equal(p.compositeRating, "very high");
  assert.equal(p.topHazards[0].type, "Wildfire");
});

test("hazardForLocation returns UNKNOWN_HAZARD when missing", () => {
  const p = hazardForLocation(hazardFixture, "TX", "Nowhere");
  assert.equal(p.compositeRating, "unknown");
  assert.deepEqual(p.topHazards, []);
  assert.notEqual(p, UNKNOWN_HAZARD, "returns a copy, not the shared constant reference used for mutation safety");
});
