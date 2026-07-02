# Delete/Edit Audit Log & Restore — Design Spec

**Date:** 2026-07-02
**Status:** Approved

## Overview

Deletes and edits to accounts (`profiles`) and rows (`entries`) are currently permanent and untracked in detail — a hard delete leaves no trace, and an edit only stamps `last_edited_by`/`last_edited_email` on the row itself, overwriting any prior value. This adds two append-only audit tables (`delete_log`, `edit_log`) that snapshot a row before every delete or edit, surfaces them as new tabs on the existing `/log` (Activity Log) page, and lets an admin restore a deleted row/account or revert an edit back to its pre-change state.

---

## 1. Data Model

Two new tables, same shape, kept separate so deletes (rare, high-stakes) aren't buried in the much higher volume of routine edits:

```sql
create table public.delete_log (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        text not null check (entity_type in ('account','entry')),
  entity_id          uuid not null,
  tab                text,               -- entries only; null for accounts
  before_data        jsonb not null,     -- full row snapshot immediately before the delete
  actor_id           uuid references auth.users(id) on delete set null,
  actor_email        text not null,
  restored_at        timestamptz,
  restored_by_email  text,
  created_at         timestamptz not null default now()
);

create table public.edit_log (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        text not null check (entity_type in ('account','entry')),
  entity_id          uuid not null,
  tab                text,
  before_data        jsonb not null,     -- full row snapshot immediately before the edit
  actor_id           uuid references auth.users(id) on delete set null,
  actor_email        text not null,
  restored_at        timestamptz,
  restored_by_email  text,
  created_at         timestamptz not null default now()
);

create index delete_log_created_at_idx on public.delete_log (created_at desc);
create index edit_log_created_at_idx   on public.edit_log (created_at desc);
```

Both tables are append-only from the app's perspective — there is no delete code path against them, so no `DELETE` RLS policy is defined (intentional, not an oversight: these are meant to be immutable audit trails).

### RLS

Mirrors the existing split in `schema.sql`: `entries` is anyone-can-read, `admin_logs` (the existing account-action log) is admin-only-read. Since these new tables mix entry and account snapshots, the read policy is split by `entity_type`:

```sql
alter table public.delete_log enable row level security;
alter table public.edit_log   enable row level security;

-- entries: same visibility as the entries table itself
create policy "approved users can read entry rows in delete_log"
  on public.delete_log for select
  using (entity_type = 'entry' and public.is_approved());
create policy "approved users can read entry rows in edit_log"
  on public.edit_log for select
  using (entity_type = 'entry' and public.is_approved());

-- accounts: admin-only, matching admin_logs
create policy "admins can read account rows in delete_log"
  on public.delete_log for select
  using (entity_type = 'account' and public.is_admin());
create policy "admins can read account rows in edit_log"
  on public.edit_log for select
  using (entity_type = 'account' and public.is_admin());

-- insert: any approved user performing a delete/edit can write the log entry
create policy "approved users can insert delete_log"
  on public.delete_log for insert with check (public.is_approved());
create policy "approved users can insert edit_log"
  on public.edit_log for insert with check (public.is_approved());

-- restore (marking restored_at) is admin-only
create policy "admins can update delete_log"
  on public.delete_log for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can update edit_log"
  on public.edit_log for update using (public.is_admin()) with check (public.is_admin());
```

`profiles` currently has no `insert` policy at all — accounts are only ever created via the `handle_new_user` trigger, which runs as `security definer` and bypasses RLS. Restoring a deleted account requires a client-side insert into `profiles`, so this migration also adds:

```sql
create policy "admins can insert profiles"
  on public.profiles for insert with check (public.is_admin());
```

This closes the account side end-to-end at the database level, not just in the UI. The same isn't true for entries — `entries` already has an "approved users can insert/update entries" policy (any approved user has full entry CRUD today, not just admins), so entry restore is enforced by the UI's admin-only gate plus the admin-only `delete_log`/`edit_log` update policy (which records *who* restored it), consistent with the rest of the entries permission model where regular approved users already have full write access.

---

## 2. Write-Path Changes (`src/lib/queries.ts`)

Each function below fetches the current row, inserts a log entry with `before_data` set to that row, and only then performs the mutation. If the log insert fails, the mutation is aborted.

| Function | Table | Log written |
|---|---|---|
| `deleteEntries(ids[], tab)` | `entries` | one `delete_log` row **per id** (bulk deletes restore independently) |
| `updateEntryData(id, tab, fields)` | `entries` | one `edit_log` row |
| `updateMentionStatus(id, status)` | `entries` | one `edit_log` row |
| `moveEntryToTab(id, oldTab, newTab)` | `entries` | one `edit_log` row |
| `deleteProfile(id)` | `profiles` | one `delete_log` row |
| `updateProfile(id, {approved, role})` | `profiles` | one `edit_log` row |

`insertEntry` (creating a brand-new row) is **not** logged — there is no "before" state to restore to, and this feature only covers deletes and saves/edits of existing rows.

New helper in `queries.ts`:

```ts
async function logChange(
  table: 'delete_log' | 'edit_log',
  entityType: 'account' | 'entry',
  entityId: string,
  beforeData: object,
  tab?: string
): Promise<void>
```

---

## 3. Restore Logic

New functions in `queries.ts`:

```ts
restoreDeletedEntity(logId: string): Promise<void>
restoreEditedEntity(logId: string): Promise<void>
```

**`restoreDeletedEntity`:**
1. Fetch the `delete_log` row; error if `restored_at` is already set.
2. Re-insert `before_data` into `entries` or `profiles` (based on `entity_type`).
3. Update that `delete_log` row: `restored_at = now()`, `restored_by_email = <current admin>`.
4. Nothing new is logged — this undoes the delete, it isn't itself a new change.

**`restoreEditedEntity`:**
1. Fetch the `edit_log` row; error if `restored_at` is already set.
2. Write a **new** `edit_log` row capturing the row's current state immediately before this restore — so a restore can itself be undone later.
3. Overwrite only the fields an edit can actually change: `entries.data` and `entries.tab` (so restoring a `moveEntryToTab` edit moves the row back, not just field-data edits), or `profiles.approved`/`role`. Sync-internal bookkeeping (`last_sync_tag`, `sheet_row_id`, `row_index`) is never copied back from the snapshot — an old `last_sync_tag` could confuse the Sheet sync's echo-loop protection. `updated_at`/`last_edited_by`/`last_edited_email` are refreshed to reflect the restore happening now, not backdated to the snapshot's values.
4. Update the original `edit_log` row: `restored_at = now()`, `restored_by_email = <current admin>`.

Both functions guard against a race (two admins restoring the same entry at once) by conditioning the update on `restored_at is null` at write time, not just checking it beforehand.

### Failure cases

- **Restoring a delete, but a conflicting row now exists** (e.g. a Google Sheet sync re-created an entry with the same `sheet_row_id`/`tab` after the dashboard delete): the insert fails on the unique constraint; surfaced as an error toast, not swallowed.
- **Restoring an edit, but the row was deleted since**: the update affects zero rows; detected and surfaced as "this row no longer exists — restore the delete first."

---

## 4. UI (`src/pages/ActivityLog.tsx`)

The `/log` page currently renders a single merged feed (entry edits + `admin_logs` account actions) with no tabs — `sync_runs` are shown separately on `/sync`, not here. This gets restructured into tabs, keeping the existing feed as the default:

- **Activity** — the existing merged edits + admin-actions feed, unchanged.
- **Edits** — `edit_log` rows, newest first, showing actor email, entity type, an identifying label (entry's tab + brand name, or account email), timestamp, and an expandable "view details" showing the raw `before_data`.
- **Deletes** — same layout, sourced from `delete_log`.

Both use the existing 25-row client-side pagination pattern used elsewhere in the app.

**Visibility:**
- Entry rows in both tabs: visible to any approved user (matches `entries` RLS).
- Account rows in both tabs: visible to admins only (matches `admin_logs` RLS) — a non-admin viewing the Edits/Deletes tabs simply won't see account-related rows.
- The **Restore** button renders only for admin-role users, gated the same way `AdminUsers.tsx` already gates admin-only actions.
- An already-restored row shows a "Restored by \<email\> at \<time\>" badge instead of the button.

**Restore confirmation:** a lightweight confirm dialog (not the heavy "type delete to confirm" pattern used for actual deletes) — restoring is inherently low-risk since it is itself logged and reversible.

---

## 5. Error Handling Summary

- Snapshot-then-write ordering: if the audit insert fails, the delete/edit is aborted rather than proceeding without a record.
- Restore failures use the existing `Toast` component to surface a clear message; never a silent no-op.
- `delete_log`/`edit_log` have no `DELETE` RLS policy — by design, not omission.

---

## 6. Scope

- Covers: entry deletes/edits (`entries` table) and account deletes/edits (`profiles` table).
- Does not cover: row/account creation (`insertEntry`, new signups), `sync_runs`, or the existing `admin_logs` table (approve/revoke/role-change actions) — those remain as-is.
- Retention: log rows are kept indefinitely; no automated cleanup job.
- New files: none. Changes are in `supabase/schema.sql` (new tables + RLS), `src/lib/queries.ts` (logging + restore functions), and `src/pages/ActivityLog.tsx` (new tabs).

---

## 7. Verification

No automated test suite exists in this project; verification follows the existing convention:

- `npm run build` to catch type errors.
- Manual click-through: delete a test entry → confirm it appears under Deletes → restore it → confirm it reappears in its original tab with original data. Repeat for a test account.
- Edit a test entry twice → confirm both edits appear under Edits → restore the first edit → confirm the row reverts and a new `edit_log` row is created for the restore itself.
- Confirm a non-admin user sees the Edits/Deletes tabs but not account rows and not Restore buttons; confirm a direct Supabase call bypassing the UI is rejected by RLS.
