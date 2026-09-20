import type { QueueFilter } from "@/lib/agent/query-tools";
import { explainSubmission, filterQueue, resolveSubmission } from "@/lib/agent/query-tools";
import { chatWithTools, type ChatMessage, type ChatTool } from "@/lib/agent/openai";
import type { RankedSubmission } from "@/lib/domain/types";

export interface AskResult {
  kind: "filter" | "explain" | "none";
  answer: string;
  /** The first filter the model asked for, when it asked for one. */
  filter?: QueueFilter;
  /** Every row the deterministic tools matched, across all tool calls, in rank order. */
  matchedIds?: string[];
}

const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "filterQueue",
      description:
        "Filter the submission queue by structured criteria. Returns counts by appetite status plus the highest-ranked matches " +
        "(id, account name, status, score, state, line of business, and the engine's headline reason). " +
        "Statuses: in_appetite, needs_investigation, out_of_appetite, out_of_scope (line is not commercial property; never scored).",
      parameters: {
        type: "object",
        properties: {
          lineOfBusiness: { type: "string", description: "e.g. property, cyber, cgl, auto, health, excess, lpl" },
          submissionType: { type: "string", enum: ["new", "renewal"] },
          state: { type: "string", description: "2-letter state code" },
          status: { type: "string", enum: ["in_appetite", "needs_investigation", "out_of_appetite", "out_of_scope"] },
          scoreMin: { type: "number" }, scoreMax: { type: "number" },
          tivMin: { type: "number" }, tivMax: { type: "number" },
          premiumMin: { type: "number" }, premiumMax: { type: "number" },
          buildingYearMin: { type: "number" }, buildingYearMax: { type: "number" },
          hazardMin: {
            type: "string",
            enum: ["relatively moderate", "relatively high", "very high"],
            description: "Minimum FEMA National Risk Index composite rating (decision-support context; it never changes appetite).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explainSubmission",
      description: "Get the appetite factors, verdicts, evidence and explanation for one submission by account name or id.",
      parameters: { type: "object", properties: { nameOrId: { type: "string" } }, required: ["nameOrId"] },
    },
  },
];

const SYSTEM =
  "You are an assistant for a commercial-property underwriting queue. Answer ONLY using the tool results; never invent numbers, names, or verdicts. " +
  "Appetite statuses: in_appetite means every factor meets the 2025 property appetite; needs_investigation means a required factor is unknown; " +
  "out_of_appetite means at least one factor is not acceptable; out_of_scope means the line of business is not commercial property, so the row was never scored — " +
  "never describe out-of-scope rows as out of appetite. " +
  "When the question says 'property' or names another line of business, pass it as lineOfBusiness. " +
  "Report the counts by status, and name the matched accounts when the tool returns a few. If nothing matches, say so plainly. " +
  "Keep answers to one or two sentences. The underwriter makes the decision; you only report what the deterministic engine found.";

type ChatFn = (req: { messages: ChatMessage[]; tools: ChatTool[]; toolChoice?: "auto" | "none" }) => Promise<ChatMessage>;

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
  const calls = first.tool_calls ?? [];
  if (calls.length === 0) return { kind: "none", answer: first.content ?? "I can only answer questions about the queue." };

  // Every tool call the model made gets a tool message back: OpenAI rejects
  // the phrasing turn otherwise, and a question like "high wildfire or flood
  // hazard" legitimately fans out into more than one filter.
  let kind: AskResult["kind"] = "none";
  let filter: QueueFilter | undefined;
  const matched = new Set<string>();
  const toolMessages: ChatMessage[] = [];

  for (const call of calls) {
    const args = safeParse(call.function.arguments);
    let result: unknown;
    if (call.function.name === "filterQueue") {
      kind = "filter";
      filter ??= args as QueueFilter;
      const r = filterQueue(subs, args as QueueFilter);
      for (const id of r.matchedIds) matched.add(id);
      result = { counts: r.counts, topMatches: r.rows };
    } else if (call.function.name === "explainSubmission") {
      if (kind !== "filter") kind = "explain";
      const found = resolveSubmission(subs, String((args as { nameOrId?: string }).nameOrId ?? ""));
      result = found ? explainSubmission(found) : { error: "not found" };
      if (found) matched.add(found.id);
    } else {
      result = { error: `unknown tool ${call.function.name}` };
    }
    toolMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
  }

  messages.push(first, ...toolMessages);
  // Phrasing turn: forbid further tool calls so the model must return prose
  // (the facts are already grounded in `matchedIds`/`result`).
  const final = await chat({ messages, tools: TOOLS, toolChoice: "none" });
  // Keep rank order: `subs` is already ranked, so filter it rather than dumping the set.
  const matchedIds = subs.filter((s) => matched.has(s.id)).map((s) => s.id);
  return { kind, answer: final.content ?? "", filter, matchedIds };
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
