import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConsolidationIndex } from "./resolve-submission";

/** Load the build-time consolidation cache (`raw/consolidation.json`). Missing
 *  or unreadable caches fail open to `{}` so runtime stays demo-safe.
 *  Server/scripts only — do not import from client components. */
export function loadConsolidationIndex(rawDir = join(process.cwd(), "raw")): ConsolidationIndex {
  try {
    return JSON.parse(readFileSync(join(rawDir, "consolidation.json"), "utf8")) as ConsolidationIndex;
  } catch {
    return {};
  }
}
