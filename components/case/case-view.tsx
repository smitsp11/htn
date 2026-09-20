"use client";

import { useState } from "react";
import type { RankedSubmission } from "@/lib/domain/types";
import { Tabs } from "@/components/ui/tabs";
import { CaseBar } from "@/components/case/case-bar";
import { CaseSummary } from "@/components/case/case-summary";
import { ReviewTab } from "@/components/case/review-tab";
import { PropertyTab } from "@/components/case/property-tab";
import { AccountTab } from "@/components/case/account-tab";
import { DecisionSidebar } from "@/components/case/decision-sidebar";

type CaseTab = "review" | "property" | "account";

const CASE_TABS: { id: CaseTab; label: string }[] = [
  { id: "review", label: "Review & next steps" },
  { id: "property", label: "Property details" },
  { id: "account", label: "Account context" },
];

export interface CaseViewProps {
  submission: RankedSubmission;
  onBack: () => void;
}

/**
 * Full-screen case view shell: case bar, summary strip, tabbed main panel,
 * and pinned decision sidebar. Ported from federanorth's `caseTemplate`
 * (`src/decision/dashboard.js`) as a client-routed view rather than a
 * `<dialog>`/`<template>` pair. The tab bodies and sidebar are stubs today
 * (Task 4.1); later tasks flesh out their contents without touching this
 * shell.
 */
export function CaseView({ submission, onBack }: CaseViewProps) {
  const [activeTab, setActiveTab] = useState<CaseTab>("review");

  return (
    <div className="case-view">
      <CaseBar submission={submission} onBack={onBack} />
      <CaseSummary submission={submission} />
      <Tabs tabs={CASE_TABS} active={activeTab} onChange={(id) => setActiveTab(id as CaseTab)} />
      <div className="case-body">
        <main className="case-main">
          {activeTab === "review" && <ReviewTab submission={submission} />}
          {activeTab === "property" && <PropertyTab submission={submission} />}
          {activeTab === "account" && <AccountTab submission={submission} />}
        </main>
        <DecisionSidebar submission={submission} />
      </div>
    </div>
  );
}
