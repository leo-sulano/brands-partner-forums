# 2026-09-15 — Per-Account PMS Task Cards (Task 350), shipped and deployed

**What happened this session:**
- Continued from `.agent/handoff/2026-09-15-count-badge-redesign-and-pms-per-account-spec.md`,
  which had paused at "spec written, awaiting user review." User approved the spec.
- Found the implementation plan had *already* been written on `main`
  (`docs/superpowers/plans/2026-09-15-pms-per-account-tasks.md`, 964 lines, 6 tasks) and a
  dedicated worktree (`pms-per-account-tasks`) was already set up — from a prior session that
  continued past the handoff checkpoint without leaving its own note. No task was executed yet.
- Executed the plan via `superpowers:subagent-driven-development`: pre-flight scan clean, Tasks
  1-5 each fresh-subagent-implemented + task-reviewed (Task 4 needed 1 fix round: missing test for
  the per-entry failure/cleanup path, and a missing weekly-approval gate the spec's pseudocode
  omitted but every sibling card-creation path in this codebase has; Task 5 needed 1 fix round: a
  test landed in the wrong `describe` block). Task 6 was deliberately split: code+tests (Steps 1-6)
  via subagent, Steps 7-11 (migration, deploy, live-verify, docs) held for explicit human approval
  since they're irreversible/production-affecting.
- **The final whole-branch review (dispatched after all 6 tasks' code was done, on the most capable
  model) is what actually earned its keep here.** It found 2 Critical + 5 Important + 6 Minor issues
  that no single task's diff could show, because they all trace to one wrong assumption in the
  spec's own "Call sites NOT changed" section: every one of `pullScheduleFromPms`,
  `pushScheduleToPms`'s `alreadyLinked` check, `cancelScheduleInPms`, the parity/active-count
  aggregate, and 3 non-status branches in `resolveAndSyncTabStatuses` assumed "at most one link per
  combo" still held. It doesn't, once a combo can have a generic link plus multiple entry-tied
  links. The worst one (C1): `pullScheduleFromPms` had zero `entry_id` filtering, so an agent
  deleting or re-dating their own per-account PMS card would silently blank or move the WHOLE
  day's `brand_schedule` plan. The other Critical (C2) was a genuine schema flaw, not an
  implementation bug: `entry_id`'s `on delete set null` collides with the "one generic link per
  combo" partial unique index that used `entry_id IS NULL` as the discriminator.
- C2 was put to the user directly (AskUserQuestion, 3 options with tradeoffs) — chose adding an
  explicit `link_kind text` discriminator column over `on delete cascade` or dropping the FK.
- Dispatched one fix wave for the 9 mechanical findings (C1 + 5 Important + 3 Minor), scoped
  re-reviewed clean. Then dispatched a dedicated follow-up "Task 7" (not part of the original
  plan) to add `link_kind`, amend the still-unapplied Task 1 migration in place, and sweep every
  `entry_id`-nullness discriminator check in `pmsSync.ts` over to `link_kind` — while leaving the
  genuinely different "which specific entry" identity checks alone. This task's first dispatch hit
  an Opus session rate limit mid-way (production sweep done, tests not yet added, uncommitted); a
  second dispatch on Sonnet independently re-verified the whole sweep before finishing and
  committing. Reviewed clean — the reviewer independently rebuilt the full 15-item
  discriminator/identity classification from the diff and it matched exactly.
- **Deployed to production** (with explicit user approval): linked the worktree to the Supabase
  project, confirmed the live unique-constraint name (read-only), discovered and merged a
  concurrent session's already-live migration (`20260915120000`, unrelated admin-schedule-approval
  work, Task 349) that this worktree's branch didn't have yet — clean merge, full suite still
  green. Pushed both new migrations (`entry_id`+`link_kind` schema, `entry_id` index). Deployed
  both edge functions (`sync-schedule-pms`, `generate-weekly-schedule`).
- **Live-verified against the real Casino Magius case, and it worked without any manual trigger**:
  the 1-minute cron had already self-created the 2 new entry-tied cards for accounts 506 (JEN) and
  512 (ANN) within minutes of deploy, correctly resolved to `published`/`done` matching their real
  entry statuses, while 504 (LAI) correctly rides the pre-existing generic card. A manual
  `syncAllStatuses` re-trigger afterward created zero additional cards (idempotent, confirmed via
  row count).

**Recorded in:**
- `docs/task-history.md` — Task 350.
- Memory: `project_schedule_planner_multi_account_day_cell` updated in place — the "SPEC'D, NOT
  YET BUILT" section replaced with "SHIPPED", including the `link_kind`-not-`entry_id` correction
  and the 5 spec-was-wrong call sites, since a future session touching this table needs to know
  `link_kind` is the real discriminator now, not `entry_id` nullness.
- This file.

**Open thread / possible next step:**
- **This work lives on the `worktree-pms-per-account-tasks` branch in `.claude/worktrees/
  pms-per-account-tasks/`, not yet merged to `main`.** The branch already has `main` merged into
  it (picked up Task 349's concurrent migration cleanly), so a fast-forward or clean merge back to
  `main` should be straightforward. Next step: `superpowers:finishing-a-development-branch` to
  decide how to integrate — this wasn't done yet in this session because the user's original ask
  was to get the feature shipped and live-verified, not to also close out the branch/worktree
  bookkeeping, and this handoff note is the natural checkpoint for that decision.
- Two accepted, non-blocking residual gaps, both noted in the memory update in full: an
  entry-tied link can become permanently orphaned (no server-side cleanup path) if its entry's
  brand/platform/date changes after the card was created; and a small set of Deno tests in
  `index_test.ts` silently swallow a real (but harmless) error from `backfillMissingEntryLinks`
  running against a fake client — cosmetic, flagged for whoever next touches that test file.
- File the Task 350 PMS ticket in Review/QA if it turns out not to have been done yet (check
  `.claude/pms-synced-tasks.txt` and the PMS board directly — the Stop hook usually does this
  automatically from the `docs/task-history.md` entry).

**Resume prompt for next session:**

> Continue from the 2026-09-15 session (see
> `.agent/handoff/2026-09-15-per-account-pms-task-cards.md`). Per-account PMS task cards (Task 350)
> are fully built, reviewed, deployed to production, and live-verified against the real Casino
> Magius case — this is DONE, not in-progress. What's NOT done: the `worktree-pms-per-account-tasks`
> branch (in `.claude/worktrees/pms-per-account-tasks/`) hasn't been merged back to `main` or had
> its SDD workspace/worktree cleaned up. Use `superpowers:finishing-a-development-branch` to close
> this out — check with the user on how they want to integrate (the branch already has `main`
> merged into it, so this should be a clean fast-forward or merge). If touching
> `schedule_pms_links`/`pmsSync.ts` again for any reason, read the "SHIPPED (Task 350)" section of
> memory `project_schedule_planner_multi_account_day_cell` first — `link_kind`, not `entry_id`
> nullness, is now the generic-vs-entry-tied discriminator, and getting that backwards reintroduces
> the exact bug class this session's final whole-branch review caught and fixed.
