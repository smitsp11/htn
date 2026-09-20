"use client";

import { Tabs } from "@/components/ui/tabs";
import { LANE_LABELS, type Lane } from "@/lib/rankings/lanes";

export type LaneFilter = Lane | "all";

export interface LaneTabsProps {
  counts: Record<Lane, number>;
  total: number;
  active: LaneFilter;
  onChange: (lane: LaneFilter) => void;
}

const LANES = Object.keys(LANE_LABELS) as Lane[];

/**
 * Federanorth's `#property-lanes` tab strip: an "All lanes" tab plus one tab per
 * triage lane, each with a count. A single underline tab set (rather than a pill
 * for "all" and underlines for the lanes) so there is one selection idiom.
 */
export function LaneTabs({ counts, total, active, onChange }: LaneTabsProps) {
  const tabs = [
    { id: "all", label: "All lanes", count: total },
    ...LANES.map((lane) => ({ id: lane, label: LANE_LABELS[lane], count: counts[lane] })),
  ];
  return <Tabs tabs={tabs} active={active} onChange={(id) => onChange(id as LaneFilter)} />;
}
