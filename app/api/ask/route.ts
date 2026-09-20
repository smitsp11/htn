import { NextResponse } from "next/server";
import { askQueue } from "@/lib/agent/ask";
import { datasetFrom } from "@/lib/rankings/dataset";
import { buildRankings, defaultPipelineDeps } from "@/lib/rankings/pipeline";

export const dynamic = "force-dynamic";
// The ask layer builds rankings then makes a grounded OpenAI call; allow room
// for a slow model response.
export const maxDuration = 60;

export async function POST(request: Request) {
  let question = "";
  let dataset = datasetFrom(undefined);
  try {
    const body = (await request.json()) as { question?: unknown; dataset?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
    dataset = datasetFrom(body.dataset);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!question) return NextResponse.json({ error: "Ask a question about the queue." }, { status: 400 });

  try {
    const { submissions } = await buildRankings(defaultPipelineDeps(dataset), { dataset });
    const result = await askQueue(question, submissions);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The assistant is unavailable.";
    return NextResponse.json({ kind: "none", answer: `Couldn't answer that right now: ${message}` }, { status: 502 });
  }
}
