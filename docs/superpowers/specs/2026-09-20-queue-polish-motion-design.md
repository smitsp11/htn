# Queue-first UI polish + tasteful motion — design

Date: 2026-09-20
Base: PR #14 head (`triage-rebase-ui-outcomes` @ `a77fb12`), treated as the new "main".
Branch: `federanorth-ui-overhaul`.
Direction (approved): refine the existing warm-editorial Federanorth brand; queue-first;
tasteful/subtle motion. Reference vibe: bencho.dev/finds (restraint + crisp easing).

## Problem (confirmed live against the running app)

1. **Color lies.** The queue score `Track` bar renders green regardless of status — green
   fills sit one inch from a red "Outside appetite" badge on the same row. Elsewhere green
   means "good", so the bar contradicts the badge. "Target" vs "Acceptable" are visually
   identical.
2. **Inverted hierarchy.** Case header makes "100% factors established" (a data-completeness
   metric) the largest element; the actual outcome ("In appetite"/"Outside appetite") is a
   small pill. Queue rows give the raw score number equal/greater weight than the status.
3. **Hero eats the first screen.** The editorial hero occupies ~100vh before any queue row
   is visible.
4. **Filter desync.** Switching the line-of-business tab does not reset the lane filter,
   producing a "no submissions match" empty state that reads as a bug.
5. **Static.** No motion — nothing guides the eye or feels responsive.
6. **Case layout bugs.** Decision sidebar is clipped off the right edge; the hero photo
   bleeds into the bottom of the case overlay. Unlabeled "8" count pill in the header.

## Approach

Refine, don't replace. Keep serif + cream + aerial photography. Fix structure and color
first, then layer CSS-first motion on top. No new dependencies (no framer-motion): pure CSS
transitions/keyframes + a tiny count-up hook, all behind the existing
`prefers-reduced-motion` guard.

### 1. Semantic color layer (adapted to real tokens)
Real tokens today: `--green/--amber/--red/--navy` (+ `-soft` tints). Add a thin semantic
status layer mapping lane -> `positive | caution | warning | negative | neutral`, each a
`-strong` foreground on a `-tint` background. Repoint `LaneBadge` and `Track`.
- `Track` already accepts a `tone` prop; pass `tone={laneForStatus(status)}` so bar color
  follows row status (green only in-appetite; red outside; amber needs-evidence).
- Add a distinct `caution` (teal) tier so "Acceptable" is visibly not "Target".
- Keep brand/decorative rust separate from semantic warning.
No token currently used by the app is renamed out from under other components.

### 2. Queue hierarchy + structure
- Compress the hero into a shorter branded band (reclaim ~40% height) so the queue is near
  the top; keep serif + photo; add a subtle scroll cue.
- Row hierarchy: appetite status dominant; score number secondary (smaller, muted); bar is
  a second encoding of the same fact, not a competing green.
- Fix lane/LOB desync: switching LOB tab resets the lane filter; empty state names which
  filters combined to zero and offers Reset.
- Collapse the two "selected" idioms (pill + underline) into one.

### 3. Motion (queue) — CSS-first, subtle
- Staggered row reveal on load (fade + ~6px rise, ~30ms stagger).
- Row hover: subtle lift + left accent bar in the row's status color.
- Score counts up + bar width fills on mount / filter change.
- Lane underline slides between tabs; filtered rows animate in/out.
- Smooth queue -> case transition (shared fade/slide, not a hard cut).
- Everything gated by `prefers-reduced-motion: reduce` (guard already exists).

### 4. Case view — bug-fix pass only (secondary surface)
- Fix clipped decision sidebar and hero-photo bleed (real layout bugs).
- Flip header hierarchy: shrink "100% factors established", promote appetite outcome.
- Label or remove the unlabeled count pill.
- Adopt the new tokens; no deep redesign.

## Guardrails
- Read-only preserved; no changes to `lib/domain/types.ts` or the ranking pipeline logic.
- All motion respects reduced-motion.
- `npm run typecheck`, `npm test`, `npm run build` must pass.

## Out of scope (from the review; can fold in later on request)
Accordion methodology modal; de-duplicating repeated numbers on the case page; the
"Lakeside … Group Group" data-name bug; 9px -> 11px badge bump.

## Landing
Work commits onto `federanorth-ui-overhaul` (based on PR #14 head). Since PR #14 is the new
"main", these changes are intended to land into that version — final integration (push to
the PR branch vs. a follow-up PR) decided at handoff. Note: PR #14's "outcome" work touches
`queue-table.tsx`, `queue.css`, `case.css`; my base already includes it, so no conflict with
that committed work — only coordinate if new commits land on the PR branch meanwhile.
