# W5 — Agentic Narration: Contradiction-First + "What Would Flip This" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the grounded ask-layer reason like an underwriter — lead with contradictions, distinguish "missing" from "failing," and answer "what would move this into appetite?" — while every fact and verdict still comes from the deterministic engine, never the LLM.

**Architecture:** A pure `lib/domain/counterfactual.ts` computes the minimal factor change that raises a submission's status one tier (deterministic, using the existing `deriveStatus`). It is exposed as a new `whatWouldFlip` tool in `lib/agent/ask.ts`, alongside the existing `filterQueue`/`explainSubmission` tools. The system prompt is tightened so the LLM's *phrasing* leads with contradictions and the missing-vs-failing distinction. The LLM decides nothing about appetite; it selects tools and narrates their deterministic output.

**Tech Stack:** Next.js 16, TypeScript strict, `node:test` + `tsx`, OpenAI Chat Completions via the existing `chatWithTools` wrapper (injectable `chat` for tests — see `tests/ask.test.ts`).

**Invariants (must hold after every task):** the LLM never produces a number, verdict, or field value; the phrasing turn still forbids tool calls (`toolChoice: "none"`, per existing `ask.ts`); appetite engine untouched; `npm run typecheck`, `npm test`, `npm run build` all green.

---

## File Structure

- `lib/domain/counterfactual.ts` — NEW. Pure `whatWouldFlip(submission)`.
- `tests/counterfactual.test.ts` — NEW.
- `lib/agent/ask.ts` — MODIFY. Add the tool schema, handler branch, and tighten `SYSTEM`.
- `tests/ask.test.ts` — MODIFY (or add cases) to cover the new tool and prompt behavior via an injected `chat`.

---

## Task 1: Counterfactual helper (pure, tested)

**Files:**
- Create: `lib/domain/counterfactual.ts`
- Test: `tests/counterfactual.test.ts`

Rules (deterministic, mirrors `deriveStatus` precedence: any `not_acceptable` → out_of_appetite; else any `unknown` → needs_investigation; else in_appetite):
- If `out_of_appetite`: the blockers are the `not_acceptable` factors. Report them as the changes required (each would need to become at least `acceptable`).
- If `needs_investigation`: the blockers are the `unknown` factors — resolving them is the path to `in_appetite`.
- If `in_appetite`: nothing to flip → return null.

- [ ] **Step 1: Write the failing test**

```ts
// tests/counterfactual.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAppetite } from "../lib/domain/appetite";
import { whatWouldFlip } from "../lib/domain/counterfactual";
import { contradictory, empty, fullTarget } from "./fixtures/domain/submissions";

test("an in-appetite submission has nothing to flip", () => {
  assert.equal(whatWouldFlip(evaluateAppetite(fullTarget)), null);
});

test("a needs-investigation submission flips by resolving unknowns", () => {
  const ranked = evaluateAppetite(empty);
  const flip = whatWouldFlip(ranked);
  assert.ok(flip);
  assert.equal(flip.targetStatus, "needs_investigation" in {} ? "in_appetite" : "in_appetite");
  const unknowns = ranked.factors.filter((f) => f.verdict === "unknown").map((f) => f.key);
  assert.deepEqual(flip.changes.map((c) => c.key).sort(), unknowns.sort());
  assert.ok(flip.changes.every((c) => c.from === "unknown"));
});

test("an out-of-appetite submission flips by fixing not-acceptable factors", () => {
  const ranked = evaluateAppetite(contradictory);
  const flip = whatWouldFlip(ranked);
  assert.ok(flip);
  const blockers = ranked.factors.filter((f) => f.verdict === "not_acceptable").map((f) => f.key);
  assert.deepEqual(flip.changes.map((c) => c.key).sort(), blockers.sort());
  assert.ok(flip.changes.every((c) => c.from === "not_acceptable"));
});
```

> Before implementing, confirm in `tests/fixtures/domain/submissions.ts` that `empty` is `needs_investigation` (all unknown, no not_acceptable) and `contradictory` is `out_of_appetite` (has ≥1 not_acceptable). If a fixture differs, pick one that matches each branch or build a small inline `CanonicalSubmission`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/counterfactual.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```ts
// lib/domain/counterfactual.ts
import type { AppetiteStatus, AppetiteVerdict, FactorKey, RankedSubmission } from "./types";

export interface FlipChange {
  key: FactorKey;
  label: string;
  from: AppetiteVerdict;
  /** The verdict this factor would need to reach for the status to improve. */
  to: "acceptable";
  hint: string;
}

export interface FlipResult {
  /** The status the submission would reach if every change below were made. */
  targetStatus: AppetiteStatus;
  changes: FlipChange[];
}

/** The minimal set of factor changes that raises status one tier. Deterministic
 *  and derived from the engine's own verdicts — the LLM only phrases this. */
export function whatWouldFlip(submission: RankedSubmission): FlipResult | null {
  const blockers = submission.factors.filter((f) => f.verdict === "not_acceptable");
  if (blockers.length > 0) {
    return {
      targetStatus: "needs_investigation", // removing hard gates lifts it off out_of_appetite
      changes: blockers.map((f) => ({ key: f.key, label: f.label, from: f.verdict, to: "acceptable", hint: f.reason })),
    };
  }
  const unknowns = submission.factors.filter((f) => f.verdict === "unknown");
  if (unknowns.length > 0) {
    return {
      targetStatus: "in_appetite",
      changes: unknowns.map((f) => ({ key: f.key, label: f.label, from: f.verdict, to: "acceptable", hint: f.reason })),
    };
  }
  return null;
}
```

> **Note on the empty-fixture test:** the second unit test's `targetStatus` expectation is `in_appetite` only when resolving the unknowns leaves no `not_acceptable` factor. Since `empty` has no `not_acceptable` factors, resolving all unknowns to `acceptable` yields `in_appetite` — matches the implementation. Simplify that test's assertion to `assert.equal(flip.targetStatus, "in_appetite")` (the ternary in the failing-test stub is just to make it compile before impl; replace it).

- [ ] **Step 4: Run test to verify it passes** (fix the stubbed ternary to the plain assertion)

Run: `npx tsx --test tests/counterfactual.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/counterfactual.ts tests/counterfactual.test.ts
git commit -m "feat(counterfactual): deterministic what-would-flip-this"
```

---

## Task 2: Add the `whatWouldFlip` tool + tighten the system prompt

**Files:**
- Modify: `lib/agent/ask.ts`

- [ ] **Step 1: Import the helper and the type.** Add to the imports at the top of `lib/agent/ask.ts`:

```ts
import { whatWouldFlip } from "@/lib/domain/counterfactual";
```

- [ ] **Step 2: Add the tool schema.** Append a third entry to the `TOOLS` array (after `explainSubmission`):

```ts
{
  type: "function",
  function: {
    name: "whatWouldFlip",
    description: "For one submission (by account name or id), return the minimal factor changes that would raise its appetite status (e.g. resolve unknowns, or fix not-acceptable factors).",
    parameters: { type: "object", properties: { nameOrId: { type: "string" } }, required: ["nameOrId"] },
  },
},
```

- [ ] **Step 3: Tighten the system prompt.** Replace the existing `SYSTEM` constant:

```ts
const SYSTEM =
  "You are an assistant for a commercial-property underwriting queue. Answer ONLY using the tool results. " +
  "Never invent numbers, names, or verdicts. When a submission has problems, LEAD with them: state contradictions first " +
  "(a factor that fails while others match), and clearly distinguish a factor that is MISSING (unresolved data) from one that FAILS " +
  "(out of appetite) — never blur the two. If nothing matches, say so plainly. Keep answers to one or two sentences.";
```

- [ ] **Step 4: Add the handler branch.** In `askQueue`, after the `explainSubmission` branch (the `else if (call.function.name === "explainSubmission")` block), add:

```ts
} else if (call.function.name === "whatWouldFlip") {
  kind = "explain";
  const found = resolveSubmission(subs, String((args as { nameOrId?: string }).nameOrId ?? ""));
  result = found ? (whatWouldFlip(found) ?? { alreadyInAppetite: true }) : { error: "not found" };
  if (found) matchedIds = [found.id];
}
```

- [ ] **Step 5: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/agent/ask.ts
git commit -m "feat(ask): whatWouldFlip tool + contradiction-first prompt"
```

---

## Task 3: Ask-layer tests for the new tool + grounding

**Files:**
- Modify: `tests/ask.test.ts` (mirror its existing injected-`chat` pattern)

- [ ] **Step 1: Read the existing test to copy the fake-`chat` pattern.**

Run: `sed -n '1,60p' tests/ask.test.ts`
Expected: shows how `askQueue` is called with `{ chat }` returning a canned first message (tool call) then a phrasing message.

- [ ] **Step 2: Add a test where the model calls `whatWouldFlip`.** Append a test that injects a `chat` returning a `whatWouldFlip` tool call for a known incomplete account on the first turn, then prose on the second (`toolChoice: "none"`). Assert:
  - the returned `kind === "explain"` and `matchedIds` contains the target id,
  - the tool-result message content (the second `messages` entry the fake `chat` receives) is the deterministic `whatWouldFlip` output — i.e. the facts came from the engine, not the model.

```ts
// tests/ask.test.ts (add near the other askQueue tests)
import { rankSubmissions } from "../lib/domain/appetite";
import { empty } from "./fixtures/domain/submissions";

test("whatWouldFlip is grounded: facts come from the engine, model only phrases", async () => {
  const subs = rankSubmissions([empty]);
  const target = subs[0];
  let toolResultSeen: string | undefined;
  const chat = async (req: { messages: { role: string; content: string | null }[]; toolChoice?: string }) => {
    if (req.toolChoice === "none") {
      // phrasing turn: capture the tool result the model was given
      toolResultSeen = req.messages.find((m) => m.role === "tool")?.content ?? undefined;
      return { role: "assistant", content: `Resolve the missing fields to move ${target.accountName} into appetite.` } as never;
    }
    return {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "t1", type: "function", function: { name: "whatWouldFlip", arguments: JSON.stringify({ nameOrId: target.id }) } }],
    } as never;
  };

  const res = await askQueue("what would move this into appetite?", subs, { chat });
  assert.equal(res.kind, "explain");
  assert.deepEqual(res.matchedIds, [target.id]);
  assert.ok(toolResultSeen && toolResultSeen.includes("changes"), "model must be handed the deterministic flip result");
});
```

- [ ] **Step 3: Run the ask tests**

Run: `npx tsx --test tests/ask.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 4: Full suite + commit**

Run: `npm test`
Expected: PASS.

```bash
git add tests/ask.test.ts
git commit -m "test(ask): whatWouldFlip grounding + tool routing"
```

---

## Self-Review Notes

- **Spec coverage:** contradiction-first + missing-vs-failing (Task 2 prompt), counterfactual tool (Tasks 1–2), grounding proof (Task 3). ✅
- **LLM never decides:** the tool result is the deterministic `whatWouldFlip` object; the phrasing turn runs with `toolChoice: "none"` (existing behavior), so the model can only narrate. Task 3 asserts the engine output is what the model receives. ✅
- **Type consistency:** `FlipResult`/`FlipChange` in Task 1 are consumed only as JSON in `ask.ts`; the `to: "acceptable"` literal keeps the shape honest (the minimal lift target). ✅
- **Fixture caveat:** verify `empty` = needs_investigation and `contradictory` = out_of_appetite before running Task 1 (see note there).
- **Depends on:** nothing else in this backlog; independent. Pairs well with W3/W4 (the flip changes for `unknown` factors are the same fields W4 chases).
