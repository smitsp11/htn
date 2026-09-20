import type { Dataset } from "@/lib/domain/types";

/** Unknown or missing dataset values always preserve baseline behavior. */
export function datasetFrom(value: unknown): Dataset {
  return value === "extended" ? "extended" : "baseline";
}
