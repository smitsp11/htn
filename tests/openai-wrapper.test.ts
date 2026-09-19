import assert from "node:assert/strict";
import test from "node:test";
import { chatWithTools } from "../lib/agent/openai";

function fakeFetch(status: number, body: unknown) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("chatWithTools posts messages + tools and returns the message", async () => {
  const reply = { choices: [{ message: { role: "assistant", content: "hi", tool_calls: [] } }] };
  const msg = await chatWithTools(
    { messages: [{ role: "user", content: "hello" }], tools: [] },
    { apiKey: "sk-test", model: "gpt-4.1", fetchImpl: fakeFetch(200, reply) as unknown as typeof fetch },
  );
  assert.equal(msg.content, "hi");
});

test("errors never contain the api key", async () => {
  await assert.rejects(
    () => chatWithTools({ messages: [], tools: [] }, { apiKey: "sk-secret", model: "gpt-4.1", fetchImpl: fakeFetch(401, { error: { message: "bad" } }) as unknown as typeof fetch }),
    (e: Error) => !/sk-secret/.test(e.message) && /OpenAI/.test(e.message),
  );
});
