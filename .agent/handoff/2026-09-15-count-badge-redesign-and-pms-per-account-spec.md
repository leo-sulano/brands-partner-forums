# 2026-09-15 — Count Badge Redesign + PMS Per-Account Task Spec

**What happened this session:**
- Continued directly from `.agent/handoff/2026-09-14-schedule-planner-per-account-count-badge-shipped.md`
  (Task 347, shipped and pushed at the end of that session).
- User gave live feedback on the shipped Task 347 badge (screenshot of the real BIT tab):
  1. The toolbar's "TP N" total was still undercounting — showed "TP 3" when it should
     show "TP 5" (3 Casino Magius accounts + 1 Crowncoins + 1 NoLimitCoins), since
     `countActivePlatformSlots` counted 1 per active slot, not 1 per real entry.
  2. Wanted individual account/agent details in the tooltip, not just a merged
     brand-level value.
  3. Wanted the `×N` badge redesigned — inline next to the platform icon instead of a
     tiny floating corner pill.
  4. Separately: wanted each of Casino Magius's 3 accounts (different agents) to get
     its own PMS task card, not share the one card that already existed.
- Built via TDD, item by item:
  - **Redesign** (items 2+3): `DateStatusIndex.counts: Map<string, number>` (Task 347's
    original shape) replaced with `entries: Map<string, EntryDetails[]>` — count is now
    just the array length, no parallel structure. `EntryDetails` gained `agent`.
    `EvidenceCornerBadge` reverted to its original single-purpose form (no count prop);
    the `×N` indicator moved to inline text in `PlatformChip` (and the landing-grid
    preview), shown only when count > 1. New `EntryAccountLines` component lists each
    account individually in the tooltip when count > 1; the common single-account case
    (`AgentCountryLines`) is completely unchanged.
  - **Toolbar total** (item 1): `countActivePlatformSlots` now sums `getEntryCount(...)`
    per day instead of counting a boolean `hasDateEvidence`. Also fixed a related gap:
    today's evidence used to be ignored entirely (today was treated as plan-only,
    deferring to `brand_schedule` even when real evidence already existed) — now
    evidence wins for any day, past or today, with the plan only used as a fallback for
    days with no evidence yet.
  - All changes verified via `npm run build` (clean), full suite (2494/2494 passing),
    `deno check` (clean on `generate-weekly-schedule` and `sync-schedule-pms`), and live
    against real production BIT tab data via local `npm run dev`: toolbar reads "TP 5";
    Casino Magius's Monday chip shows inline "×3"; its tooltip lists all 3 real accounts
    individually with their own agents (504→LAI, 506→JEN, 512→ANN).
  - Committed and pushed to `origin/main` in two commits (Task 347's original ship, then
    this session's redesign/fix commit — see `docs/task-history.md` Task 348).
- **PMS per-account task cards (item 4) — investigated, NOT implemented.** Read through
  `pmsSync.ts` (1322 lines) and `schedule_pms_links`'s migration to understand the real
  blocker: a hard `unique (tab, brand_key, platform, date)` constraint, with every
  consumer function assuming exactly 1 task per combo. Given this project's long history
  of regressions in this exact subsystem (Tasks 267, 287, 292, 294, 302, 319, 320, 325,
  341, 342), stopped short of implementing directly. Asked the user 2 rounds of
  structured clarifying questions (scope: backfill-now-and-going-forward vs.
  going-forward-only; status-sync: per-entry-independent vs. combined; task title
  format; whether to write a spec first) — all answered toward the fuller, more correct
  option each time. **Wrote and committed a full design spec**
  (`docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md`) covering: a new
  nullable `entry_id` column + two partial unique indexes on `schedule_pms_links`;
  `EntryDetails` gaining `id`/`kind` fields; a new `backfillMissingEntryLinks` function
  (additive, sibling to the existing `backfillMissingScheduledLinks`, wired into the
  same 1-minute cron + daily audit); per-entry status resolution for entry-tied links vs.
  unchanged combo-aggregate resolution for the existing generic link. Self-reviewed the
  spec and caught + fixed one real logic bug in my own pseudocode (the "first entry
  rides the generic link" rule was accidentally count-dependent instead of purely
  positional, which would have broken on a second backfill run).
- **Session paused here, at "spec written, awaiting user review"** — this was a
  deliberate stopping point per the brainstorming skill's process (present design →
  write spec → get user approval → THEN writing-plans → implementation). Did not
  proceed to implementation without that approval.

**Recorded in:**
- `docs/task-history.md` — Task 348 (short-form entry, covers the redesign + toolbar fix
  + spec-writing, all as one task since the redesign/fix shipped but the spec is a
  separate not-yet-started piece of work).
- Memory: `project_schedule_planner_multi_account_day_cell` updated in place — corrects
  the stale Task-347-only description (the `counts` map no longer exists, replaced by
  `entries`), documents the Task 348 redesign in full, and adds the full per-account PMS
  spec summary as its own section.
- Committed + pushed to `origin/main`: the redesign/fix commit, the spec-doc commit, and
  the docs/handoff commit.
- PMS ticket filed: Task 348 → `cmu1fw9f8000v04ict6noxchz` (Review/QA, assigned Leo
  Sulano, label Feature, 3 subtasks) — verified live via GET after creation. Added to
  `.claude/pms-synced-tasks.txt`.

**Open thread / possible next step:**
- **Blocked on the user reviewing `docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md`.**
  If they've approved it (or asked for changes) since this note was written, that
  supersedes this note — check the spec file's git history / ask directly rather than
  re-asking from scratch.
- If approved as-is: the next step is the writing-plans skill → an implementation plan
  → build it (schema migration, `EntryDetails.id`/`.kind`, `backfillMissingEntryLinks`,
  per-entry status resolution in `resolveAndSyncTabStatuses`), following the same
  TDD + build + full-suite + deno-check + live-verification discipline every other task
  this session used. This is real production PMS-sync surgery — treat it with the same
  care Task 341/342 (the most recent incidents in this subsystem) demanded.
- File the Task 348 PMS ticket if it turns out not to have been done yet.

**Resume prompt for next session:**

> Continue from the 2026-09-15 session (see
> `.agent/handoff/2026-09-15-count-badge-redesign-and-pms-per-account-spec.md`). The
> count-badge redesign and toolbar-total fix (Task 348) are done, tested, live-verified,
> and pushed. Separately, per-account PMS task cards (each of Casino Magius's 3 accounts
> getting its own PMS card instead of sharing one) is SPEC'D but not built — read
> `docs/superpowers/specs/2026-09-15-pms-per-account-tasks-design.md` first. Check
> whether the user has reviewed/approved that spec since it was written. If approved,
> proceed via the writing-plans skill into implementation, treating
> `schedule_pms_links`/`pmsSync.ts` with real care — this is the most incident-prone
> subsystem in the project's history (see the spec's own Context section for the task
> numbers). If not yet reviewed, ask the user directly before writing any code.
