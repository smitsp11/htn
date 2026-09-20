import type { ReactNode } from "react";

export type BadgeTone = "mint" | "orange" | "amber" | "danger" | "neutral";

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone, children }: BadgeProps) {
  return (
    <span className={`badge badge-${tone}`}>
      <i />
      {children}
    </span>
  );
}
