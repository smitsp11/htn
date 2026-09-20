import { NextResponse } from "next/server";
import { askQueue } from "@/lib/agent/ask";
import { buildRankings, defaultPipelineDeps } from "@/lib/rankings/pipeline";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!question) return NextResponse.json({ error: "Ask a question about the queue." }, { status: 400 });

  try {
    const { submissions } = await buildRankings(defaultPipelineDeps());
    const result = await askQueue(question, submissions);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The assistant is unavailable.";
    return NextResponse.json({ kind: "none", answer: `Couldn't answer that right now: ${message}` }, { status: 502 });
  }
}
