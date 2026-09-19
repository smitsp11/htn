export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function chatWithTools(
  req: { messages: ChatMessage[]; tools: ChatTool[] },
  opts: ChatOptions = {},
): Promise<ChatMessage> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI is not configured (OPENAI_API_KEY missing).");
  const model = opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1";
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: req.messages, tools: req.tools, tool_choice: "auto", temperature: 0 }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200).replace(apiKey, "***");
    throw new Error(`OpenAI request failed (${res.status}): ${detail}`);
  }
  const body = (await res.json()) as { choices: { message: ChatMessage }[] };
  return body.choices[0].message;
}
