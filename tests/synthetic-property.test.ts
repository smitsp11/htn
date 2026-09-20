import { test } from "node:test";
import assert from "node:assert/strict";
import { syntheticPropertySubmissions } from "../lib/demo/synthetic-property";
import { rankSubmissions } from "../lib/domain/appetite";

test("synthetic set is ~24 unique property submissions", () => {
  const s = syntheticPropertySubmissions();
  assert.ok(s.length >= 22 && s.length <= 26, `got ${s.length}`);
  assert.equal(new Set(s.map((x) => x.id)).size, s.length);
  assert.ok(s.every((x) => x.lineOfBusiness === "property"));
});
test("synthetic set yields several in-appetite submissions", () => {
  const ranked = rankSubmissions(syntheticPropertySubmissions());
  assert.ok(ranked.filter((r) => r.status === "in_appetite").length >= 4, `in_appetite=${ranked.filter((r) => r.status === "in_appetite").length}`);
});
test("boundary exactly-1990 lands on needs_investigation", () => {
  const ranked = rankSubmissions(syntheticPropertySubmissions());
  const byId = new Map(ranked.map((r) => [r.id, r]));
  assert.equal(byId.get("SUB-SYN-0007")!.status, "needs_investigation");
});
test("renewal cases are out_of_appetite", () => {
  const ranked = rankSubmissions(syntheticPropertySubmissions());
  const byId = new Map(ranked.map((r) => [r.id, r]));
  assert.equal(byId.get("SUB-SYN-0017")!.status, "out_of_appetite");
});
