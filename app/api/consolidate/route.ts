import { NextResponse } from "next/server";
import { runLiveConsolidation } from "@/lib/consolidation/browserbase-live";
import { scenarioEntry } from "@/lib/consolidation/scenario/pages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const submissionId =
    typeof body === "object" && body !== null && "submissionId" in body
      ? String((body as { submissionId?: unknown }).submissionId ?? "").trim()
      : "";

  if (!submissionId) {
    return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
  }

  if (!scenarioEntry(submissionId)) {
    return NextResponse.json(
      { error: "No scattered-channel scenario for this submission." },
      { status: 404 },
    );
  }

  try {
    const result = await runLiveConsolidation(submissionId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Consolidation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
