"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { QueryReasoning, RankedSubmission } from "@/lib/domain/types";
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
  /** Query-agent field provenance and batch retrieval time, when available (live/replay
   *  mode only) -- passed through to the property tab to show where each factor's value
   *  came from in the discovered Federato schema. */
  queryTrace?: QueryReasoning;
  retrievedAt?: string;
}

/**
 * Full-screen case view shell: case bar, summary strip, tabbed main panel,
 * and pinned decision sidebar. Ported from federanorth's `caseTemplate`
 * (`src/decision/dashboard.js`) as a client-routed view rather than a
 * `<dialog>`/`<template>` pair. The tab bodies and decision sidebar are composed
 * here; property provenance is passed through to the property details tab.
 */
export function CaseView({ submission, onBack, queryTrace, retrievedAt }: CaseViewProps) {
  const [activeTab, setActiveTab] = useState<CaseTab>("review");

  return (
    <div className="case-view">
      <CaseBar submission={submission} onBack={onBack} />
      <CaseSummary submission={submission} />
      <Tabs tabs={CASE_TABS} active={activeTab} onChange={(id) => setActiveTab(id as CaseTab)} />
      <div className="case-body">
        <main className="case-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {activeTab === "review" && <ReviewTab submission={submission} />}
              {activeTab === "property" && (
                <PropertyTab submission={submission} queryTrace={queryTrace} retrievedAt={retrievedAt} />
              )}
              {activeTab === "account" && <AccountTab submission={submission} />}
            </motion.div>
          </AnimatePresence>
        </main>
        <DecisionSidebar submission={submission} />
      </div>
    </div>
  );
}
