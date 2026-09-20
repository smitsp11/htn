import type { FactorKey } from "@/lib/domain/types";
import type { ResolvedValue } from "@/lib/enrichment/provenance";
import type { ChannelSource } from "./channel-source";

/** For each requested field, ask each channel in order and take the first hit.
 *  Provenance names the channel ("broker email"). Only fills fields a channel
 *  actually holds — never invents. */
export function consolidateSubmission(
  submissionId: string,
  fields: FactorKey[],
  sources: ChannelSource[],
  asOf = new Date().toISOString().slice(0, 10),
): Partial<Record<FactorKey, ResolvedValue<number | string>>> {
  const map: Partial<Record<FactorKey, ResolvedValue<number | string>>> = {};
  for (const field of fields) {
    for (const source of sources) {
      const hit = source.lookup(submissionId, field);
      if (hit) {
        map[field] = {
          value: hit.value,
          provenance: {
            source: `broker ${source.channel}`,
            confidence: hit.confidence,
            asOf,
          },
        };
        break;
      }
    }
  }
  return map;
}
