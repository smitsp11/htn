import assert from "node:assert/strict";
import test from "node:test";

test("POST /api/ask rejects a blank question with 400", async () => {
  const { POST } = await import("../app/api/ask/route");
  const res = await POST(new Request("http://x/api/ask", { method: "POST", body: JSON.stringify({ question: "  " }) }));
  assert.equal(res.status, 400);
});
