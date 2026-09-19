import { NextResponse } from "next/server";
import { getSourceStatus } from "@/lib/federato/status";

export const dynamic = "force-dynamic";

/**
 * Safe, secret-free connection status for the shared UI. Reflects the most
 * recent Federato client activity in this process (auth, schema reachability,
 * last successful request, record/page counts). Never returns tokens or creds.
 */
export async function GET() {
  return NextResponse.json(getSourceStatus());
}
