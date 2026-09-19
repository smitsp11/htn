import { NextResponse } from "next/server";
import { categorizeError, httpStatusFor } from "@/lib/rankings/errors";
import { buildRankings, defaultPipelineDeps } from "@/lib/rankings/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await buildRankings(defaultPipelineDeps()));
  } catch (error) {
    const body = categorizeError(error);
    return NextResponse.json(body, { status: httpStatusFor(body.category) });
  }
}
