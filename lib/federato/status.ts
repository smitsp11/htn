/**
 * Safe, secret-free source status for the shared UI.
 *
 * The client reports lifecycle events here (auth succeeded, a request
 * succeeded, schema was reachable, or a failure occurred). The status route and
 * the source-status component read a snapshot. This module only ever holds
 * booleans, counts, timestamps, and an error *category* — never the access
 * token, client id/secret, or any response payload.
 */
import type { FederatoErrorCategory } from "./transport";

export interface SourceStatus {
  /** Credentials present (or demo mode), so a live call could be attempted. */
  configured: boolean;
  /** Running against local demo fixtures rather than the live API. */
  demoMode: boolean;
  /** A token has been minted successfully at least once this process. */
  authenticated: boolean;
  /** The schema endpoint responded successfully at least once. */
  schemaReachable: boolean;
  /** ISO timestamp of the last successful API request, or null. */
  lastSuccessfulRequestAt: string | null;
  /** Records returned by the last paginated retrieval, or null. */
  lastRecordCount: number | null;
  /** Pages walked by the last paginated retrieval, or null. */
  lastPageCount: number | null;
  /** Category of the most recent failure, or null after any success. */
  lastErrorCategory: FederatoErrorCategory | "config" | null;
}

interface RuntimeStatus {
  authenticated: boolean;
  schemaReachable: boolean;
  lastSuccessfulRequestAt: string | null;
  lastRecordCount: number | null;
  lastPageCount: number | null;
  lastErrorCategory: SourceStatus["lastErrorCategory"];
}

function emptyRuntime(): RuntimeStatus {
  return {
    authenticated: false,
    schemaReachable: false,
    lastSuccessfulRequestAt: null,
    lastRecordCount: null,
    lastPageCount: null,
    lastErrorCategory: null,
  };
}

let runtime: RuntimeStatus = emptyRuntime();

export function recordAuthSuccess(): void {
  runtime.authenticated = true;
  runtime.lastErrorCategory = null;
}

export function recordSchemaReachable(reachable: boolean): void {
  runtime.schemaReachable = reachable;
}

export function recordRequestSuccess(counts: { records?: number; pages?: number } = {}): void {
  runtime.lastSuccessfulRequestAt = new Date().toISOString();
  if (typeof counts.records === "number") runtime.lastRecordCount = counts.records;
  if (typeof counts.pages === "number") runtime.lastPageCount = counts.pages;
  runtime.lastErrorCategory = null;
}

export function recordFailure(category: SourceStatus["lastErrorCategory"]): void {
  runtime.lastErrorCategory = category;
  if (category === "auth") runtime.authenticated = false;
}

/** Test hook: clear all recorded runtime status. */
export function resetStatus(): void {
  runtime = emptyRuntime();
}

/** Env-derived configuration, computed without exposing any secret value. */
function readConfig(): { configured: boolean; demoMode: boolean } {
  const demoMode = process.env.FEDERATO_USE_DEMO_DATA !== "false";
  const hasCredentials = Boolean(process.env.FEDERATO_CLIENT_ID && process.env.FEDERATO_CLIENT_SECRET);
  return { configured: demoMode || hasCredentials, demoMode };
}

/** Safe snapshot for the shared UI and the status route. */
export function getSourceStatus(): SourceStatus {
  const { configured, demoMode } = readConfig();
  return { configured, demoMode, ...runtime };
}
