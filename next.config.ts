import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  // Keep Turbopack scoped to this repo (avoids picking up a parent package-lock).
  turbopack: {
    root,
  },
  // The API routes read the captured Federato snapshot and FEMA enrichment
  // from raw/ at request time via process.cwd() (see lib/federato/offline-data.ts,
  // lib/enrichment/*). Those paths are built dynamically, so Next's tracer can't
  // see them — force them into the serverless function bundle or the deployed
  // functions throw "Missing offline Federato snapshot".
  outputFileTracingIncludes: {
    "/api/**": ["./raw/**/*"],
  },
};

export default nextConfig;
