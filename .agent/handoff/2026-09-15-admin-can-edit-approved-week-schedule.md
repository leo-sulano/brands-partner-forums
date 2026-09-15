# 2026-09-15 — Admin Can Edit/Pause/Cancel an Approved Week (Approve Stays Super-Admin-Only)

Ran in parallel with another session (that one working the Task 348 per-account PMS spec, in its
own worktree) — this task was done directly on `main`.

## What changed
Approved-week `brand_schedule` writes had been locked to `super_admin` only since
`20260903150000` (the 3rd flip of this exact policy — see that migration's own comment for the
prior two). Per direct user request, loosened it one notch: a plain `admin` can now edit, pause,
and cancel a schedule even after its week is approved, same as a `super_admin`. Approving/revoking
the week itself (`weekly_schedule_approvals` writes, locked in `20260903140000`) and role
escalation are untouched — still `super_admin`-only.

- `src/components/TabScheduleSection.tsx`: `canEditWeek`'s approved-week branch now checks
  `isAdmin` instead of `isSuperAdmin`. Approve/Revoke buttons and `handleApproveWeek`/the revoke
  handler still gate on `isSuperAdmin` directly — unchanged.
- `supabase/migrations/20260915120000_reopen_approved_week_brand_schedule_to_admin.sql`: swaps
  `is_super_admin()` for `is_admin()` in the 3 `brand_schedule` RLS policies (insert/update/delete).
  Applied to remote via `supabase db push` (this push also picked up the already-committed but
  not-yet-applied `20260911140000_widen_schedule_platform_columns.sql` from the other session's
  earlier work — pre-existing drift, unrelated to this task, safe/additive, now cleared).

## Verified
- `npm run build` passes.
- `src/lib/scheduleApproval.test.ts` passes (14/14).
- Confirmed no other user-facing copy needed updating — the one remaining "super admin" string
  (revoke-confirmation modal) is about re-approving, which is still correctly super-admin-only.

## Not touched / still true
- `weekly_schedule_approvals` RLS, `is_super_admin()`, `is_admin()` function bodies: unchanged.
- This is the 4th flip of the brand_schedule approved-week policy in under 2 weeks
  (admin-only → open → super-admin-only → admin-only again). If this reverts again, check
  `20260903120000`, `20260903130000`, `20260903150000`, and this file for the full history before
  re-deciding.
