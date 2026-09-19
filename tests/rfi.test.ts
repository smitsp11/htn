import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { draftRfi } from "../lib/agent/rfi";
import { empty, fullTarget } from "./fixtures/domain/submissions";

test("a complete submission produces no RFI", () => {
  assert.equal(draftRfi(evaluateAppetite(fullTarget)), null);
});

test("an incomplete submission drafts a checklist email naming the account", () => {
  const ranked = evaluateAppetite(empty);
  const draft = draftRfi(ranked);
  assert.ok(draft, "expected a draft for an incomplete submission");
  assert.match(draft.subject, new RegExp(ranked.accountName));
  for (const label of ranked.factors.filter((f) => f.verdict === "unknown").map((f) => f.label)) {
    assert.ok(draft.body.includes(label), `body should request ${label}`);
    assert.ok(draft.missingItems.includes(label));
  }
  // Each item says what to send, in underwriting terms.
  assert.match(draft.body, /loss runs/);
  assert.match(draft.body, /statement of values/);
  // Draft-only: no send/recipient side effect is expressed in the payload.
  assert.equal("to" in draft, false);
});

test("a boundary value the broker already supplied is not requested", () => {
  // Built exactly 1990 is unknown to the engine but is an underwriter call.
  assert.equal(draftRfi(evaluateAppetite({ ...fullTarget, id: "fx-1990", buildingYear: 1990 })), null);
  const mixed = draftRfi(evaluateAppetite({ ...fullTarget, id: "fx-mix", buildingYear: 1990, totalPremium: undefined }));
  assert.ok(mixed);
  assert.deepEqual(mixed.missingItems, ["Total premium"]);
  assert.doesNotMatch(mixed.body, /Building year/);
});

test("a field already resolved by a source is not chased again", () => {
  const ranked = evaluateAppetite({ ...fullTarget, id: "fx-resolved", totalPremium: undefined, fiveYearLossValue: undefined });
  const draft = draftRfi(ranked, {
    totalPremium: { value: 80_000, provenance: { source: "broker email", confidence: 0.9, asOf: "2026-09-19" } },
    fiveYearLossValue: null,
  });
  assert.ok(draft);
  assert.deepEqual(draft.missingItems, ["Five-year losses"]);
});
