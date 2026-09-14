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
- Committed and pushed to `origin/main` (`feat: per-account count badge on Schedule
  Planner day chips`, plus a docs follow-up commit for Task 347 + this handoff file).
- PMS board (Review/QA, assigned Leo Sulano, label Feature, 3 subtasks, verified via GET
  after creation): Task 347 → `cmu1f2pum000904lbo8c3yoae`. Added to
  `.claude/pms-synced-tasks.txt` so the Stop hook won't re-create it.

**Open thread / possible next step:**
- Nothing outstanding on this feature — fully shipped, pushed, and filed. CSV/Excel export
  and Ask AI remain explicitly out of scope, matching the existing precedent for the other
  evidence badges.

**Resume prompt for next session:**

> Continue from the 2026-09-14 session (see
> `.agent/handoff/2026-09-14-schedule-planner-per-account-count-badge-shipped.md`). The
> Schedule Planner per-account count badge (Task 347) is fully shipped: built via TDD,
> live-verified against real BIT tab data, pushed to `origin/main`, and filed to PMS
> Review/QA (`cmu1f2pum000904lbo8c3yoae`). Nothing outstanding on this feature — ask what
> to work on next.
