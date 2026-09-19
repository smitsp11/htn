import type { QueueFilter } from "@/lib/agent/query-tools";
import { explainSubmission, filterQueue, resolveSubmission } from "@/lib/agent/query-tools";
import { chatWithTools, type ChatMessage, type ChatTool } from "@/lib/agent/openai";
import type { RankedSubmission } from "@/lib/domain/types";

export interface AskResult {
  kind: "filter" | "explain" | "none";
  answer: string;
  filter?: QueueFilter;
  matchedIds?: string[];
}

const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "filterQueue",
      description: "Filter the submission queue by structured criteria. Returns matching submission ids and status counts.",
      parameters: {
        type: "object",
        properties: {
          lineOfBusiness: { type: "string" }, submissionType: { type: "string", enum: ["new", "renewal"] },
          state: { type: "string", description: "2-letter state code" },
          status: { type: "string", enum: ["in_appetite", "needs_investigation", "out_of_appetite"] },
          scoreMin: { type: "number" }, scoreMax: { type: "number" },
          tivMin: { type: "number" }, tivMax: { type: "number" },
          premiumMin: { type: "number" }, premiumMax: { type: "number" },
          buildingYearMin: { type: "number" }, buildingYearMax: { type: "number" },
          hazardMin: { type: "string", enum: ["relatively moderate", "relatively high", "very high"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explainSubmission",
      description: "Get the appetite factors and explanation for one submission by account name or id.",
      parameters: { type: "object", properties: { nameOrId: { type: "string" } }, required: ["nameOrId"] },
    },
  },
];

const SYSTEM =
  "You are an assistant for a commercial-property underwriting queue. Answer ONLY using the tool results. " +
  "Never invent numbers, names, or verdicts. If nothing matches, say so plainly. Keep answers to one or two sentences.";

type ChatFn = (req: { messages: ChatMessage[]; tools: ChatTool[] }) => Promise<ChatMessage>;

export async function askQueue(
  question: string,
  subs: RankedSubmission[],
  opts: { chat?: ChatFn } = {},
): Promise<AskResult> {
  const chat: ChatFn = opts.chat ?? ((req) => chatWithTools(req));
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: question },
  ];
  const first = await chat({ messages, tools: TOOLS });
  const call = first.tool_calls?.[0];
  if (!call) return { kind: "none", answer: first.content ?? "I can only answer questions about the queue." };

  const args = safeParse(call.function.arguments);
  let result: unknown;
  let kind: AskResult["kind"] = "none";
  let filter: QueueFilter | undefined;
  let matchedIds: string[] | undefined;

  if (call.function.name === "filterQueue") {
    kind = "filter";
    filter = args as QueueFilter;
    const r = filterQueue(subs, filter);
    matchedIds = r.matchedIds;
    result = r.counts;
  } else if (call.function.name === "explainSubmission") {
    kind = "explain";
    const found = resolveSubmission(subs, String((args as { nameOrId?: string }).nameOrId ?? ""));
    result = found ? explainSubmission(found) : { error: "not found" };
    if (found) matchedIds = [found.id];
  }

  messages.push(first, {
    role: "tool",
    tool_call_id: call.id,
    content: JSON.stringify(result),
  });
  const final = await chat({ messages, tools: TOOLS });
  return { kind, answer: final.content ?? "", filter, matchedIds };
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
