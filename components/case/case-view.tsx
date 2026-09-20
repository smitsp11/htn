"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { RankedSubmission } from "@/lib/domain/types";
import { Tabs } from "@/components/ui/tabs";
import { CaseBar } from "@/components/case/case-bar";
import { CaseSummary } from "@/components/case/case-summary";
import { ReviewTab } from "@/components/case/review-tab";
import { AccountTab } from "@/components/case/account-tab";
import { DecisionSidebar } from "@/components/case/decision-sidebar";

type CaseTab = "review" | "account";

const CASE_TABS: { id: CaseTab; label: string }[] = [
  { id: "review", label: "Review & next steps" },
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
 * `<dialog>`/`<template>` pair. The tab bodies (review/account) and the
 * decision sidebar are all implemented; this shell just composes them and owns
 * the active-tab state. Property exposure/building facts live inside the Review
 * tab's appetite breakdown rather than a separate (redundant) details tab.
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
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {activeTab === "review" && <ReviewTab submission={submission} />}
              {activeTab === "account" && <AccountTab submission={submission} />}
            </motion.div>
          </AnimatePresence>
        </main>
        <DecisionSidebar submission={submission} />
      </div>
    </div>
  );
}
