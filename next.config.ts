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
};

export default nextConfig;
