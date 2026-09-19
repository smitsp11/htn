"use client";
import { useState } from "react";

export interface AskBarProps {
  onResult: (matchedIds: string[] | null) => void;
}

export function AskBar({ onResult }: AskBarProps) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    if (!q.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      const data = (await res.json()) as { answer: string; matchedIds?: string[]; kind: string };
      setAnswer(data.answer);
      onResult(data.kind === "none" ? null : data.matchedIds ?? null);
    } catch {
      setAnswer("Couldn't reach the assistant. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="askbar">
      <input className="askbar-input" placeholder="Ask the queue… e.g. new-business property in CA under $100M"
        value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void ask()} />
      <button type="button" onClick={() => void ask()} disabled={busy}>{busy ? "Asking…" : "Ask"}</button>
      <button type="button" className="askbar-clear" onClick={() => { setQ(""); setAnswer(null); onResult(null); }}>Clear</button>
      {answer ? <p className="askbar-answer">{answer}</p> : null}
    </div>
  );
}
