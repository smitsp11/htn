import { NextResponse } from "next/server";
import { categorizeError, httpStatusFor } from "@/lib/rankings/errors";
import { datasetFrom } from "@/lib/rankings/dataset";
import { buildRankings, defaultPipelineDeps } from "@/lib/rankings/pipeline";

export const dynamic = "force-dynamic";
// Live mode does Auth0 + Federato query + evaluates 158 submissions (plus optional
// LLM planner), so give the function generous headroom over the platform default.
export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dataset = datasetFrom(url.searchParams.get("dataset"));
  try {
    return NextResponse.json(await buildRankings(defaultPipelineDeps(dataset), { dataset }));
  } catch (error) {
    const body = categorizeError(error);
    return NextResponse.json(body, { status: httpStatusFor(body.category) });
  }
}
