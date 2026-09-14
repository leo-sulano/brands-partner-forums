# 2026-09-14 — Schedule Planner Realtime Check + Docs/Workflow Redesign

**What happened this session:**
- User reported: 2 manually-added review accounts for Casino Magius (BIT tab) not being
  "read into" Schedule Planner / not reflected in its counts.
- Live-tested directly against production (two browser tabs — one left open/stale on
  Schedule Planner, one used to add a real disposable test brand via Add Review Account).
  **Confirmed the realtime `subscribeEntries` auto-refresh works correctly** — a new brand
  appeared in the already-open, un-reloaded Schedule Planner tab within moments, fully
  scheduled (TP chip + Done badge). Test entry deleted afterward (entries count
  887→888→887, confirmed clean).
- Root cause of the actual report: **no bug** — by design, the calendar renders one chip
  per (brand, platform, weekday), not per account. 3 accounts posting for the same
  brand/platform/day show as a single confirmed chip, same as 1 would; the toolbar's "TP N"
  count is a slot count, not an account count.
- User then asked for a real feature on top of this: a small `×N` count badge on a day
  chip when multiple accounts posted the same brand/platform/day. **Design approved, NOT
  YET IMPLEMENTED** (see below).
- Separately, user asked to redesign the project's documentation workflow: CLAUDE.md was
  costing a lot of tokens every session (2,479 lines, auto-loaded in full, mostly a
  per-task changelog duplicating `docs/task-history.md`). Trimmed CLAUDE.md to ~70 lines
  (architecture/rules only). Discovered `.agent/handoff/` already existed (this very
  mechanism, started earlier the same day for the PMS sync-direction investigation) and
  adopted it as the canonical "resume here" point, superseding an initial memory-only
  design. `docs/task-history.md` going forward: short `## Task N: Title` + 2-3 sentence
  entries only (required for the `ship-to-pms.ps1` Stop hook's regex). Full policy in
  memory: `feedback_stop_growing_claude_md_use_memory_handoffs`.

**Approved but NOT YET BUILT — per-account count badge:**
- `buildDateStatusIndex` (`src/lib/scheduler/scheduleUtils.ts`) gains a
  `counts: Map<string, number>` — same `brandKey::platform::date` key as the existing
  `removed`/`confirmed`/`pending`/`done` Sets, incremented once per real entry with *any*
  recognized status for that platform dated that day (total accounts, not
  status-specific). New helper `getEntryCount(index, brandKey, platform, iso)`.
- `EvidenceCornerBadge` (`src/lib/scheduler/calendarRenderer.tsx`) gains an optional
  `count` prop — renders a small `×N` badge in the chip's **bottom-left** corner (top-right
  is the existing letter badge D/✓/✕/P; bottom-right is the Paused indicator), shown only
  when count > 1 so the common single-account case is unchanged.
- Tooltip's existing "TrustPilot: Done" line becomes "TrustPilot: Done (3 accounts)" when
  count > 1.
- Flows through `TabScheduleSection.tsx`'s per-cell compute functions
  (`computeConfirmedByPlatform`/`computeDoneByPlatform`-style helpers), passed down to
  `ScheduleCell` the same way the existing four booleans already are. The landing-grid
  preview cards get it for free since they already call `resolveDateEvidenceKind` off the
  same index and reuse `EvidenceCornerBadge`.
- Scope: `scheduleUtils.ts` + `calendarRenderer.tsx` + `TabScheduleSection.tsx` only. No
  `queries.ts`/`scoreSummary.ts` change (Tier 1/2 boundary).
- Explicitly out of scope (matches existing precedent for the letter badges): CSV/Excel
  export, Ask AI.
- Testing plan: unit tests on `buildDateStatusIndex`'s new counts map (multiple entries
  same brand/platform/day → count > 1; independence across different days/platforms), plus
  a manual browser check.

**Recorded in:**
- `docs/task-history.md` — Task 345 (docs workflow redesign) and Task 346 (Schedule
  Planner realtime investigation), both short-form entries.
- Memory: `feedback_stop_growing_claude_md_use_memory_handoffs` (the workflow policy),
  `project_schedule_planner_multi_account_day_cell` (the realtime finding + approved
  count-badge design, for continuity).
- CLAUDE.md and `docs/task-history.md`'s Task 344 entry were both trimmed this session to
  match the new short-entry convention (Task 344's full detail already lived in memory
  `project_pms_schedule_planner_sync_direction_clarified` and the sibling handoff file
  `2026-09-14-pms-schedule-planner-sync-direction-clarified.md`, so nothing was lost).
- Committed + pushed to `origin/main` (`docs: trim CLAUDE.md to architecture/rules only,
  adopt .agent/handoff/ workflow`, commit `cbdd53f`).
- PMS board (Review/QA, assigned Leo Sulano, 3 subtasks each, verified via GET after
  creation):
  - Task 345 → `cmu1ej4r5000304l8og26tnb1` (label: Infrastructure/Structure)
  - Task 346 → `cmu1ejm5p000c04l8o4xqg49u` (label: Feature)
  - Both added to `.claude/pms-synced-tasks.txt` so the Stop hook won't re-create them.

**Open thread / possible next step:**
- Build the per-account count badge per the approved design above — this is the next
  concrete task, not yet started. No PMS ticket exists for it yet (it isn't done work) —
  file one once it's actually built.

**Resume prompt for next session:**

> Continue from the 2026-09-14 session (see
> `.agent/handoff/2026-09-14-schedule-planner-realtime-check-and-docs-workflow.md`). Build
> the approved per-account count badge for Schedule Planner day chips: add a `counts` map
> to `buildDateStatusIndex` (`src/lib/scheduler/scheduleUtils.ts`), a `count` prop on
> `EvidenceCornerBadge` (`calendarRenderer.tsx`, bottom-left corner, only when >1), thread
> it through `TabScheduleSection.tsx`'s per-cell compute functions, and add unit tests. Full
> design detail is in this handoff file. Also note: the documentation workflow itself
> changed this session — check `.agent/handoff/` for the newest file before reading
> `docs/task-history.md`, and see memory `feedback_stop_growing_claude_md_use_memory_handoffs`
> for the full policy.
