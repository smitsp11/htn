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

test("whatWouldFlip is grounded: the engine produces the facts, the model only phrases them", async () => {
  const target = ranked.find((s) => s.status !== "in_appetite");
  assert.ok(target, "need a submission with something to flip");
  let toolResultSeen: string | undefined;
  const chat = async (req: { messages: ChatMessage[]; toolChoice?: "auto" | "none" }) => {
    if (req.toolChoice === "none") {
      // phrasing turn: capture the tool result the model is handed
      toolResultSeen = req.messages.find((m) => m.role === "tool")?.content ?? undefined;
      return { role: "assistant", content: `Fix the flagged factors to move ${target.accountName} up.` } as ChatMessage;
    }
    return {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "t1", type: "function", function: { name: "whatWouldFlip", arguments: JSON.stringify({ nameOrId: target.id }) } }],
    } as ChatMessage;
  };
  const r = await askQueue("what would move this into appetite?", ranked, { chat });
  assert.equal(r.kind, "explain");
  assert.deepEqual(r.matchedIds, [target.id]);
  assert.ok(toolResultSeen && toolResultSeen.includes("changes"), "model must be handed the deterministic flip result");
});
