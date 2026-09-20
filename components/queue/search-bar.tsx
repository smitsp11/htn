"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";

export interface SearchBarProps {
  onResult: (matchedIds: string[] | null) => void;
}

interface AskResponse {
  answer: string;
  matchedIds?: string[];
  kind: string;
}

/**
 * Federanorth's `.global-search` bottom-border search field, wired to main's LLM
 * ask-the-queue endpoint (ported from `components/ask-queue/ask-bar.tsx`). The LLM only
 * interprets the question and phrases the answer; `matchedIds` is the deterministic
 * engine's row list, which the caller uses to filter the queue.
 */
export function SearchBar({ onResult }: SearchBarProps) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    if (!q.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json()) as AskResponse;
      setAnswer(data.answer);
      onResult(data.kind === "none" ? null : data.matchedIds ?? null);
    } catch {
      setAnswer("Couldn't reach the assistant. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setQ("");
    setAnswer(null);
    onResult(null);
  }

  return (
    <div className="search-bar-wrap">
      <div className="search-bar">
        <Icon name="search" />
        <input
          className="search-input"
          placeholder="Ask the queue… e.g. new-business property in CA under $100M"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void ask()}
        />
        <button type="button" className="button mint" onClick={() => void ask()} disabled={busy}>
          {busy ? "Asking…" : "Ask"}
        </button>
        {q || answer ? (
          <button type="button" className="search-clear" onClick={clear}>
            Clear
          </button>
        ) : null}
      </div>
      {answer ? <p className="search-answer">{answer}</p> : null}
    </div>
  );
}
