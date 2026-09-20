import assert from "node:assert/strict";
import test from "node:test";
import { rankSubmissions } from "../lib/domain/appetite";
import { askQueue } from "../lib/agent/ask";
import type { ChatMessage } from "../lib/agent/openai";
import { allAcceptable, contradictory, fullTarget } from "./fixtures/domain/submissions";

const ranked = rankSubmissions([fullTarget, allAcceptable, contradictory]);

function scriptedChat(steps: ChatMessage[]) {
  let i = 0;
  return async () => steps[i++];
}

test("filter question runs the tool and returns matchedIds + summary", async () => {
  const chat = scriptedChat([
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "filterQueue", arguments: JSON.stringify({ submissionType: "new" }) } }] },
    { role: "assistant", content: "2 match: 1 in appetite, 0 investigate, 1 out." },
  ]);
  const r = await askQueue("show me new business", ranked, { chat });
  assert.equal(r.kind, "filter");
  assert.ok(r.matchedIds && r.matchedIds.length >= 1);
  assert.match(r.answer, /match/);
});

test("no-tool answer is returned as kind none", async () => {
  const chat = scriptedChat([{ role: "assistant", content: "I can only answer questions about the queue." }]);
  const r = await askQueue("what is the weather", ranked, { chat });
  assert.equal(r.kind, "none");
});
