import { NextResponse } from "next/server";
import { demoSubmissions } from "@/lib/demo/submissions";
import { rankSubmissions } from "@/lib/domain/appetite";
import type { RankingsResponse } from "@/lib/domain/types";
import { buildQueryPayload, normalizeQueryResponse } from "@/lib/federato/adapter";
import { FederatoClient } from "@/lib/federato/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const useDemoData = process.env.FEDERATO_USE_DEMO_DATA !== "false";

    if (useDemoData) {
      const response: RankingsResponse = {
        source: "demo",
        generatedAt: new Date().toISOString(),
        schemaDiscovered: false,
        trace: [
          "Using local fixtures while Federato credentials/query payload are configured.",
          "The scoring and UI paths are the same paths used for live submissions.",
        ],
        submissions: rankSubmissions(demoSubmissions),
      };
      return NextResponse.json(response);
    }

    const client = new FederatoClient();
    const schema = await client.getSchema();
    const queryPayload = buildQueryPayload(schema);
    const rawResults = await client.query(queryPayload);
    const submissions = normalizeQueryResponse(rawResults);

    const response: RankingsResponse = {
      source: "federato",
      generatedAt: new Date().toISOString(),
      schemaDiscovered: true,
      trace: [
        "Discovered the data schema before querying.",
        "Requested the fields needed for the eight appetite factors.",
        "Normalized the query response before deterministic scoring.",
      ],
      submissions: rankSubmissions(submissions),
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ranking failure";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
