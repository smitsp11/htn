import { NextResponse } from "next/server";
import { runLiveConsolidation } from "@/lib/consolidation/browserbase-live";
import type { FactorKey } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const submissionId = String(record.submissionId ?? "").trim();
  // The unknown factors the case view wants recovered; synthesized when no curated scenario exists.
  const fields = Array.isArray(record.fields) ? (record.fields.map(String) as FactorKey[]) : [];

  if (!submissionId) {
    return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
  }

  try {
    const result = await runLiveConsolidation(submissionId, fields);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Consolidation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
