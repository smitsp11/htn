/**
 * Optional model pass over the schema-matched plan.
 *
 * The model chooses *which discovered field answers which appetite
 * requirement* and says why. It never writes a query and never sees a
 * submission: the query is compiled from its choices, and every chosen path is
 * re-resolved against the live schema before it is used. Without an API key the
 * pipeline runs on the schema-matched plan alone.
 *
 * OpenAI and Anthropic are both supported; `FEDERATO_PLANNER_PROVIDER` picks one.
 */

import type { SchemaIndex } from "./schema-index";
import type { DataPlan, LlmSelection } from "./schema-planner";
import { describePlanForPrompt } from "./schema-planner";
import type { QueryTrace } from "./query-trace";

type Provider = "openai" | "anthropic";

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-5.6-sol",
  anthropic: "claude-opus-5",
};

const SYSTEM = `You map an insurance carrier's appetite requirements onto a discovered database schema.

You are given the schema of every resource and, for each requirement, the paths a name-matching pass already shortlisted. Pick the single best path for each requirement, relative to the root resource.

Rules:
- Only choose a path that exists in the schema. Paths are dot separated and may cross references and arrays.
- Prefer the path that carries the insured risk itself over a lookalike (for example a driver's licence state or a broker's region is not the risk state of a property).
- Prefer per-item detail (a building's year and construction) over a summary field, because the appetite rules are evaluated per building.
- If no path answers a requirement, return null for it and say what is missing.
- Reply with JSON only, no prose and no code fences:
  {"selections":[{"key":"<requirement key>","path":"<dot path or null>","reason":"<one sentence>"}]}`;

/**
 * Opt-in only: the model pass runs when `FEDERATO_PLANNER_PROVIDER` names a
 * provider whose key is present. A key alone never enables it, so live field
 * mapping stays deterministic unless the engineer asks for the model.
 */
function plannerProvider(): Provider | undefined {
  if (process.env.FEDERATO_DISABLE_LLM_PLANNER === "true") return undefined;
  const configured = process.env.FEDERATO_PLANNER_PROVIDER as Provider | undefined;
  if (configured === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (configured === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return undefined;
}

function plannerModel(provider: Provider): string {
  return process.env.FEDERATO_PLANNER_MODEL ?? DEFAULT_MODELS[provider];
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The planner response contained no JSON object.");
  return JSON.parse(body.slice(start, end + 1));
}

function readSelections(parsed: unknown): LlmSelection[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const raw = (parsed as { selections?: unknown }).selections;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { key, path, reason } = entry as Record<string, unknown>;
    if (typeof key !== "string") return [];
    return [
      {
        key,
        path: typeof path === "string" && path.trim() !== "" ? path.trim() : null,
        reason: typeof reason === "string" ? reason : "",
      },
    ];
  });
}

async function askOpenAi(model: string, prompt: string): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

async function askAnthropic(model: string, prompt: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

export async function selectFieldsWithModel(
  index: SchemaIndex,
  plan: DataPlan,
  trace: QueryTrace,
): Promise<LlmSelection[] | undefined> {
  const provider = plannerProvider();
  if (!provider) {
    trace.add(
      "plan",
      "Planned without a model",
      "FEDERATO_PLANNER_PROVIDER is not set, so field mapping used schema name-matching only. Every chosen path comes from the discovered schema.",
    );
    return undefined;
  }

  const model = plannerModel(provider);
  const prompt = [
    `Root resource: ${plan.rootResource}`,
    plan.queueResource ? `Queue resource: ${plan.queueResource} (via ${plan.rootResource}.${plan.queueLinkPath})` : "",
    "",
    "Schema:",
    index.describeAll(),
    "",
    "Requirements and shortlisted paths:",
    describePlanForPrompt(index, plan),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const text =
      provider === "openai" ? await askOpenAi(model, prompt) : await askAnthropic(model, prompt);
    const selections = readSelections(extractJson(text));

    trace.add(
      "plan",
      "Asked the model to map appetite requirements onto schema fields",
      `${model} returned ${selections.length} field selection(s). Each one is re-resolved against the schema before use.`,
      { provider, model, selections: selections.length },
    );
    return selections;
  } catch (error) {
    trace.add(
      "warning",
      "Model planning failed; continuing without it",
      `${model}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
