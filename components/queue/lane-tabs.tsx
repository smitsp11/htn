"use client";

import { Tabs } from "@/components/ui/tabs";
import { LANE_LABELS, type Lane } from "@/lib/rankings/lanes";

export interface LaneTabsProps {
  counts: Record<Lane, number>;
  active: Lane;
  onChange: (lane: Lane) => void;
}

const LANES = Object.keys(LANE_LABELS) as Lane[];

/** Federanorth's `#property-lanes` tab strip, one tab per triage lane with a count chip. */
export function LaneTabs({ counts, active, onChange }: LaneTabsProps) {
  return (
    <Tabs
      tabs={LANES.map((lane) => ({ id: lane, label: LANE_LABELS[lane], count: counts[lane] }))}
      active={active}
      onChange={(id) => onChange(id as Lane)}
    />
  );
}
