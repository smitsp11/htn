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

test("every tool call gets its own tool message, and matched ids are the union in rank order", async () => {
  const seen: ChatMessage[][] = [];
  const chat = async (req: { messages: ChatMessage[] }) => {
    seen.push(req.messages);
    if (seen.length === 1) {
      return {
        role: "assistant" as const,
        content: null,
        tool_calls: [
          { id: "c1", type: "function" as const, function: { name: "filterQueue", arguments: JSON.stringify({ submissionType: "renewal" }) } },
          { id: "c2", type: "function" as const, function: { name: "explainSubmission", arguments: JSON.stringify({ nameOrId: "Target Account" }) } },
        ],
      };
    }
    return { role: "assistant" as const, content: "Two rows." };
  };
  const r = await askQueue("renewals, and explain target account", ranked, { chat });
  const toolMessages = seen[1].filter((m) => m.role === "tool");
  assert.deepEqual(toolMessages.map((m) => m.tool_call_id), ["c1", "c2"], "one tool message per tool_call id");
  assert.equal(r.kind, "filter");
  assert.deepEqual(r.matchedIds, ["fx-target", "fx-contradictory"], "union of both tools, in rank order");
  assert.deepEqual(r.filter, { submissionType: "renewal" });
});

test("filter tool results carry the top matches by name so the answer can cite accounts", async () => {
  const seen: ChatMessage[][] = [];
  const chat = async (req: { messages: ChatMessage[] }) => {
    seen.push(req.messages);
    return seen.length === 1
      ? { role: "assistant" as const, content: null, tool_calls: [{ id: "c1", type: "function" as const, function: { name: "filterQueue", arguments: "{}" } }] }
      : { role: "assistant" as const, content: "ok" };
  };
  await askQueue("show everything", ranked, { chat });
  const payload = JSON.parse(seen[1].find((m) => m.role === "tool")!.content!) as { counts: { total: number }; topMatches: { accountName: string; reason: string }[] };
  assert.equal(payload.counts.total, 3);
  assert.equal(payload.topMatches[0].accountName, "Target Account");
  assert.ok(payload.topMatches.every((row) => row.reason.length > 0));
});
