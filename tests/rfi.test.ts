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
  // Draft-only: no send/recipient side effect is expressed in the payload.
  assert.equal("to" in draft, false);
});
