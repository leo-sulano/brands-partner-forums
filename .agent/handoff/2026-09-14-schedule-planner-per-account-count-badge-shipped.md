# 2026-09-14 — Schedule Planner Per-Account Count Badge Shipped

**What happened this session:**
- Resumed from `.agent/handoff/2026-09-14-schedule-planner-realtime-check-and-docs-workflow.md`
  (Task 346's approved-but-unbuilt design) at the user's request.
- Built the per-account count badge via TDD:
  - RED: 7 new tests in `scheduleUtils.test.ts` for `buildDateStatusIndex`'s new `counts`
    map and a new `getEntryCount` helper — confirmed failing for the right reason
    (`counts` undefined, `getEntryCount` not a function) before writing any implementation.
  - GREEN: added `counts: Map<string, number>` to `DateStatusIndex`
    (`src/lib/scheduler/scheduleUtils.ts`), incremented once per real entry regardless of
    which of the four evidence categories (removed/confirmed/pending/done) it lands in;
    added `getEntryCount(index, brandKey, platform, iso)`. All 7 new tests + the full
    existing suite passed unmodified except 9 hand-built `DateStatusIndex` test fixtures
    elsewhere in the same file that needed a `counts: new Map()` field added (TypeScript
    caught these immediately via `npm run build`).
  - UI: `EvidenceCornerBadge` (`calendarRenderer.tsx`) gained an optional `count` prop — a
    small `×N` badge in the chip's bottom-left corner, shown only when count > 1 (top-right
    is the existing D/✓/✕/P letter badge, bottom-right is the Paused indicator).
    `PlatformChip`'s tooltip content line gains "(N accounts)" under the same condition.
  - Threaded through `TabScheduleSection.tsx` (new `computeEntryCountByPlatform`, mirrors
    `computeConfirmedByPlatform`/`computeDoneByPlatform`) and `TabPreviewCard.tsx` (the
    landing-grid preview cards, which already shared `EvidenceCornerBadge`/
    `resolveDateEvidenceKind` — just needed the `count` prop actually passed through, plus
    a `getEntryCount` import).
- Verified: `npm run build` clean, full suite 2490/2490 passing, `deno check` clean on both
  `generate-weekly-schedule` and `sync-schedule-pms` (this file is Deno-shared).
- **Live-verified** against real production BIT tab data (not synthetic test data) by
  running `npm run dev` locally and checking the actual page: Casino Magius, which has 3
  real accounts posted the same day (504/506/512, all TP "Done" today), correctly shows
  `D` + `×3` in **both** the detailed Schedule Planner grid and the landing-grid preview
  card. Crowncoins Casino and NoLimitCoins Casino (1 account each that same day) correctly
  show only the `D` letter badge with no `×N`, confirming the `count > 1` gate leaves the
  common single-account case visually unchanged, exactly as designed.
- Scope stayed exactly within the approved design: `scheduleUtils.ts` +
  `calendarRenderer.tsx` + `TabScheduleSection.tsx` + `TabPreviewCard.tsx` only. No
  `queries.ts`/`scoreSummary.ts` touched.

**Recorded in:**
- `docs/task-history.md` — Task 347 (short-form entry).
- Memory: `project_schedule_planner_multi_account_day_cell` updated in place (was
  "approved, not built" → now "SHIPPED", with the live-verification detail).
- Committed locally (`feat: per-account count badge on Schedule Planner day chips`) — **not
  yet pushed to origin/main, and no PMS ticket filed yet** as of this handoff note. Both
  are the immediate next step, same pattern as Tasks 345/346 (push, then file to PMS
  Review/QA with assignee + label + subtasks, then record the ticket ID here and in
  `.claude/pms-synced-tasks.txt`).

**Open thread / possible next step:**
- Push the commit to `origin/main` and file the Task 347 PMS ticket (Review/QA column,
  assigned Leo Sulano, with subtasks) if not already done by the time this is read — check
  `git log origin/main` and the PMS board directly rather than trusting this note blindly,
  since it may have been completed later in the same session after this file was written.
- Nothing else outstanding on this feature — CSV/Excel export and Ask AI remain explicitly
  out of scope, matching the existing precedent for the other evidence badges.

**Resume prompt for next session:**

> Continue from the 2026-09-14 session (see
> `.agent/handoff/2026-09-14-schedule-planner-per-account-count-badge-shipped.md`). The
> Schedule Planner per-account count badge (Task 347) is built, tested, and live-verified
> against real BIT tab data. Check whether it was pushed to `origin/main` and filed to the
> PMS board yet (`git log origin/main`, PMS Review/QA) — if not, that's the immediate next
> step, following the same pattern as Tasks 345/346. If it's already done, there's nothing
> outstanding on this feature; ask what to work on next.
