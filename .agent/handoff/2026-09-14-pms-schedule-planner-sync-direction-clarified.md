# 2026-09-14 — PMS ↔ Schedule Planner Sync Direction Clarified

**What happened this session:**
- User asked for clarification: if a task on the PMS board is manually moved from To Do/In Progress
  into Project Paused, does the Schedule Planner detect that and show the day as paused (with a
  "cancel task" paused-button-style affordance)?
- Investigated the real code (`src/lib/scheduler/pmsSync.ts`) rather than answering from memory,
  given how many times this project's PMS sync logic has changed (Tasks 247, 267, 294, 319, 341, 342).
- **Confirmed answer: no.** The status/column sync is one-way, dashboard-authoritative:
  - `resolveAndSyncTabStatuses` / `syncScheduleStatusToPms` push the calendar's own resolved status
    (Removed/Confirmed/Pending/Done/Paused/Active) *to* PMS and move the linked card's column.
  - The only PMS→dashboard pull, `pullScheduleFromPms`, reconciles **due date and assignee drift
    only** — it never reads a card's column.
  - A manual PMS column move to Project Paused does **not** pause the Schedule Planner day. The
    calendar keeps showing its real evidence/plan, and the next sync tick moves the card back to
    match the calendar (dashboard wins) — the manual PMS move gets silently overwritten.
  - The brand-new Task 342 parity check (`computeSchedulePmsParityIssues`) doesn't change this either
    — it's read-only/alert-only (emails approved users on a detected mismatch), never writes back.
- No code changed. This was a pure investigation/clarification session.

**Recorded in:**
- `docs/task-history.md` — Task 344 (investigation only, no code diff)
- Memory: `project_pms_schedule_planner_sync_direction_clarified.md` (indexed in MEMORY.md)
- PMS board: Task 344 ticket filed, will land in Review/QA via the standard Stop-hook auto-sync
  (per the standing PMS workflow rule — no manual API call needed)

**Open thread / possible next step (not started, no decision made yet):**
- If a true two-way sync is ever wanted — i.e. dragging a PMS card to Project Paused actually pausing
  the Schedule Planner day — that is new, unscoped work. Nothing has been designed for it. If this
  comes up again, start from `project_pms_schedule_planner_sync_direction_clarified.md` and
  cross-reference `project_pms_cancelled_day_deletes_card.md` /
  `project_pms_status_sync_stale_column_reconcile.md` for the existing push-side pause/cancel
  mechanics before designing anything.

**Resume prompt for next session:**

> Continue from the 2026-09-14 session (see `.agent/handoff/2026-09-14-pms-schedule-planner-sync-direction-clarified.md`
> and Task 344 in docs/task-history.md). We clarified that PMS↔Schedule Planner sync is one-way,
> dashboard-authoritative — a manual PMS column move (e.g. to Project Paused) is NOT reflected back
> onto the Schedule Planner calendar and gets overwritten by the next sync tick. No code was changed.
> If I want to actually build two-way sync (PMS pause → Schedule Planner pause), let's scope that as
> a new feature from scratch — nothing exists for it yet.
