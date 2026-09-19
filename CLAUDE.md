# Claude Code project instructions

This repository contains a Hack the North 2026 MVP for Federato: a read-only underwriting agent that retrieves commercial-property submissions, evaluates them against the supplied appetite guidelines, ranks them, and explains every recommendation.

## Read before editing

Read these files in order:

1. `docs/HANDOVER.md`
2. `documents/MASTER_RESEARCH.md`
3. `docs/MVP_PLAN.md`
4. Your assigned brief in `docs/handover/`
5. The source files listed as owned by your brief

The three PDFs in `documents/` are authoritative. `MASTER_RESEARCH.md` is a synthesis, not a replacement for them.

## Determine your assignment

The engineer should identify you as Person 1, 2, 3, or 4. If no assignment is stated, ask which person you are before changing code. Do not absorb another person's work merely because their implementation is incomplete; use the frozen fixtures and contracts instead.

## Non-negotiable scope

- Keep the product read-only; a human underwriter makes the final decision.
- Call schema discovery before the production query.
- Evaluate all 50+ submissions, including out-of-appetite submissions.
- Explain every result and expose missing or contradictory data.
- Build one shared product UI. Individual workstreams contribute components to it; they do not create separate applications.
- Do not silently invent undocumented Federato resource or field names.

## Parallel-work boundaries

`CanonicalSubmission` and `RankedSubmission` in `lib/domain/types.ts` are frozen integration contracts. Do not change them without explicit engineer approval. Work against fixtures when upstream code is unavailable.

Only edit files assigned to your workstream. If a shared file must change, describe the requested change to the engineer instead of creating a competing edit. Keep tests for your work in your owned test files.

## Completion checklist

Before handing work back:

1. Run `npm run typecheck`.
2. Run `npm test`.
3. Run `npm run build`.
4. Explain decisions and assumptions in your final handoff.
5. List changed files, remaining blockers, and any integration action required from another person.
