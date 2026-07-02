# Delete/Edit Audit Log & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot every account (`profiles`) and row (`entries`) delete/edit into new `delete_log`/`edit_log` tables, surface them as new tabs on `/log`, and let admins restore a deleted record or revert an edit.

**Architecture:** Two new append-only Postgres tables (one for deletes, one for edits — kept separate so rare deletes aren't buried under high-volume edits) capture a full row snapshot immediately before every mutation. All snapshotting and restore logic lives in `src/lib/queries.ts`, wrapping the 6 existing write functions (`deleteEntries`, `updateEntryData`, `updateMentionStatus`, `moveEntryToTab`, `deleteProfile`, `updateProfile`) with a snapshot-then-write pattern. `ActivityLog.tsx` gains "Edits" and "Deletes" tabs alongside its existing merged feed, with an admin-only Restore action.

**Tech Stack:** Vite 6 · React 19 · TypeScript (strict) · Tailwind v4 · Supabase (Postgres + RLS) · Lucide icons

**Spec:** `docs/superpowers/specs/2026-07-02-delete-edit-audit-restore-design.md`

## Global Constraints

- TypeScript strict mode with `noUnusedLocals`/`noUnusedParameters` — no unused bindings.
- All Supabase access goes through `src/lib/queries.ts` — no direct `supabase.from(...)` calls from components (per this project's architecture rule).
- Tailwind v4 utility classes only, matching existing spacing/color conventions (`slate`/`violet`/`rose`/`emerald` palette already used in `ActivityLog.tsx` and `AdminUsers.tsx`).
- No new npm dependencies.
- No automated test suite exists in this project — verification is `npm run build` (type-check) plus manual click-through, matching how every prior feature here was verified.
- Retention: log rows are kept forever — no cleanup job.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Create | `supabase/migrations/20260702120000_add_delete_edit_audit_logs.sql` | `delete_log`, `edit_log` tables + RLS, plus a missing `profiles` insert policy |
| Create | `src/types/audit-log.ts` | `AuditEntityType`, `AuditLogEntry` types |
| Modify | `src/lib/queries.ts` | Add `currentActor`/`logChange` helpers; wrap 6 write functions; add `fetchEditLog`, `fetchDeleteLog`, `restoreEditedEntity`, `restoreDeletedEntity` |
| Modify | `src/pages/ActivityLog.tsx` | Add tabbed UI: existing feed becomes "Activity" tab; new "Edits" and "Deletes" tabs with restore |
| Modify | `docs/task-history.md` | Append completed-task entry |

---

## Task 1: Database migration — audit tables + RLS

**Files:**
- Create: `supabase/migrations/20260702120000_add_delete_edit_audit_logs.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260702120000_add_delete_edit_audit_logs.sql`:

```sql
-- Delete/edit audit log for accounts (profiles) and rows (entries), with
-- admin-only restore. Snapshot the row before every delete/update so a
-- deleted account/row can be recreated, and an edit can be reverted.
-- See docs/superpowers/specs/2026-07-02-delete-edit-audit-restore-design.md

create table if not exists public.delete_log (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        text not null check (entity_type in ('account','entry')),
  entity_id          uuid not null,
  tab                text,
  before_data        jsonb not null,
  actor_id           uuid references auth.users(id) on delete set null,
  actor_email        text not null,
  restored_at        timestamptz,
  restored_by_email  text,
  created_at         timestamptz not null default now()
);

create table if not exists public.edit_log (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        text not null check (entity_type in ('account','entry')),
  entity_id          uuid not null,
  tab                text,
  before_data        jsonb not null,
  actor_id           uuid references auth.users(id) on delete set null,
  actor_email        text not null,
  restored_at        timestamptz,
  restored_by_email  text,
  created_at         timestamptz not null default now()
);

create index if not exists delete_log_created_at_idx on public.delete_log (created_at desc);
create index if not exists edit_log_created_at_idx   on public.edit_log (created_at desc);

alter table public.delete_log enable row level security;
alter table public.edit_log   enable row level security;

-- entries: same read visibility as the entries table itself
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

-- insert: any approved user performing a delete/edit writes its own log row
create policy "approved users can insert delete_log"
  on public.delete_log for insert with check (public.is_approved());
create policy "approved users can insert edit_log"
  on public.edit_log for insert with check (public.is_approved());

-- restore (setting restored_at) is admin-only
create policy "admins can update delete_log"
  on public.delete_log for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can update edit_log"
  on public.edit_log for update using (public.is_admin()) with check (public.is_admin());

-- profiles has no insert policy today (accounts are only ever created via the
-- handle_new_user trigger, which runs as security definer and bypasses RLS).
-- Restoring a deleted account needs a client-side insert into profiles.
create policy "admins can insert profiles"
  on public.profiles for insert with check (public.is_admin());
```

- [ ] **Step 2: Apply the migration to the linked Supabase project**

This modifies production schema — confirm with the user before running:

```bash
supabase db push
```

Expected output: confirmation that migration `20260702120000_add_delete_edit_audit_logs.sql` was applied, no errors.

- [ ] **Step 3: Verify in the Supabase SQL editor**

Run:

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('delete_log', 'edit_log');

select policyname from pg_policies where tablename in ('delete_log', 'edit_log', 'profiles');
```

Expected: both tables listed; `admins can insert profiles` appears alongside the existing profiles policies.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260702120000_add_delete_edit_audit_logs.sql
git commit -m "feat(audit): add delete_log/edit_log tables with RLS"
```

---

## Task 2: Audit log TypeScript types

**Files:**
- Create: `src/types/audit-log.ts`

**Interfaces:**
- Produces: `AuditEntityType`, `AuditLogEntry` — consumed by Task 3 (`queries.ts`) and Task 4 (`ActivityLog.tsx`).

- [ ] **Step 1: Create the type file**

Create `src/types/audit-log.ts`:

```typescript
export type AuditEntityType = 'account' | 'entry';

export interface AuditLogEntry {
  id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  tab: string | null;
  before_data: Record<string, unknown>;
  actor_id: string | null;
  actor_email: string;
  restored_at: string | null;
  restored_by_email: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors (this file has no dependents yet).

- [ ] **Step 3: Commit**

```bash
git add src/types/audit-log.ts
git commit -m "feat(audit): add AuditLogEntry type"
```

---

## Task 3: Snapshot logging in queries.ts write functions

**Files:**
- Modify: `src/lib/queries.ts`

**Interfaces:**
- Consumes: `AuditEntityType` from `src/types/audit-log.ts` (Task 2).
- Produces: `currentActor()` and `logChange()` internal helpers, used again in Task 4.

- [ ] **Step 1: Add the `AuditEntityType` import**

At the top of `src/lib/queries.ts`, after the existing type imports (currently ending at line 7 with `import type { BrandEntry, TabKpis } from '../types/brand-entry';`), add:

```typescript
import type { AuditEntityType } from '../types/audit-log';
```

- [ ] **Step 2: Add `currentActor` and `logChange` helpers**

Find this existing block (around line 413-419):

```typescript
// Email of the signed-in user, for attributing dashboard edits in the Log.
// Returns null if there's no session (shouldn't happen behind auth, but the
// column is nullable so unattributed edits degrade gracefully).
async function currentUserEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}
```

Add immediately after it:

```typescript
interface Actor {
  id: string | null;
  email: string | null;
}

// Session id + email in one call, for stamping delete_log/edit_log rows.
async function currentActor(): Promise<Actor> {
  const { data } = await supabase.auth.getSession();
  return { id: data.session?.user.id ?? null, email: data.session?.user.email ?? null };
}

// Snapshots a row into delete_log or edit_log immediately before it's
// deleted/updated, so it can be restored later.
async function logChange(
  table: 'delete_log' | 'edit_log',
  entityType: AuditEntityType,
  entityId: string,
  beforeData: object,
  actor: Actor,
  tab?: string,
): Promise<void> {
  const { error } = await supabase.from(table).insert({
    entity_type: entityType,
    entity_id: entityId,
    tab: tab ?? null,
    before_data: beforeData,
    actor_id: actor.id,
    actor_email: actor.email ?? '',
  });
  if (error) throw error;
}
```

- [ ] **Step 3: Wrap `updateEntryData` with edit logging**

Replace:

```typescript
export async function updateEntryData(
  id: string,
  tab: string,
  fields: Record<string, string | null>,
): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('data')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const mergedData = { ...(existing.data as Record<string, string | null>), ...fields };
  const syncTag = crypto.randomUUID();
  const { error: upErr } = await supabase
    .from('entries')
    .update({ data: mergedData, last_edited_by: 'dashboard', last_edited_email: await currentUserEmail(), last_sync_tag: syncTag })
    .eq('id', id);
  if (upErr) throw upErr;

  invalidateTabCache(tab);
}
```

With:

```typescript
export async function updateEntryData(
  id: string,
  tab: string,
  fields: Record<string, string | null>,
): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const actor = await currentActor();
  await logChange('edit_log', 'entry', id, existing, actor, existing.tab as string);

  const mergedData = { ...(existing.data as Record<string, string | null>), ...fields };
  const syncTag = crypto.randomUUID();
  const { error: upErr } = await supabase
    .from('entries')
    .update({ data: mergedData, last_edited_by: 'dashboard', last_edited_email: actor.email, last_sync_tag: syncTag })
    .eq('id', id);
  if (upErr) throw upErr;

  invalidateTabCache(tab);
}
```

- [ ] **Step 4: Wrap `updateMentionStatus` with edit logging**

Replace:

```typescript
export async function updateMentionStatus(id: string, status: MentionStatus): Promise<void> {
  // Read existing entry to get current data blob, tab, and sheet_row_id.
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('tab, sheet_row_id, data')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const mergedData = {
    ...(existing.data as Record<string, string | null>),
    status,
  };

  const syncTag = crypto.randomUUID();
  const { error: upErr } = await supabase
    .from('entries')
    .update({ data: mergedData, last_edited_by: 'dashboard', last_edited_email: await currentUserEmail(), last_sync_tag: syncTag })
    .eq('id', id);
  if (upErr) throw upErr;
}
```

With:

```typescript
export async function updateMentionStatus(id: string, status: MentionStatus): Promise<void> {
  // Read existing entry to get current data blob, tab, and sheet_row_id.
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const actor = await currentActor();
  await logChange('edit_log', 'entry', id, existing, actor, existing.tab as string);

  const mergedData = {
    ...(existing.data as Record<string, string | null>),
    status,
  };

  const syncTag = crypto.randomUUID();
  const { error: upErr } = await supabase
    .from('entries')
    .update({ data: mergedData, last_edited_by: 'dashboard', last_edited_email: actor.email, last_sync_tag: syncTag })
    .eq('id', id);
  if (upErr) throw upErr;
}
```

- [ ] **Step 5: Wrap `deleteEntries` with delete logging (one row per id)**

Replace:

```typescript
export async function deleteEntries(ids: string[], tab: string): Promise<void> {
  const { error } = await supabase.from('entries').delete().in('id', ids);
  if (error) throw error;
  invalidateTabCache(tab);
}
```

With:

```typescript
export async function deleteEntries(ids: string[], tab: string): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('*')
    .in('id', ids);
  if (selErr) throw selErr;

  const actor = await currentActor();
  if (existing && existing.length > 0) {
    const { error: logErr } = await supabase.from('delete_log').insert(
      existing.map((row) => ({
        entity_type: 'entry' as const,
        entity_id: row.id,
        tab: row.tab,
        before_data: row,
        actor_id: actor.id,
        actor_email: actor.email ?? '',
      })),
    );
    if (logErr) throw logErr;
  }

  const { error } = await supabase.from('entries').delete().in('id', ids);
  if (error) throw error;
  invalidateTabCache(tab);
}
```

- [ ] **Step 6: Wrap `moveEntryToTab` with edit logging**

Replace:

```typescript
export async function moveEntryToTab(id: string, oldTab: string, newTab: string): Promise<void> {
  const { error } = await supabase.from('entries').update({ tab: newTab }).eq('id', id);
  if (error) throw error;
  invalidateTabCache(oldTab);
  invalidateTabCache(newTab);
}
```

With:

```typescript
export async function moveEntryToTab(id: string, oldTab: string, newTab: string): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const actor = await currentActor();
  await logChange('edit_log', 'entry', id, existing, actor, oldTab);

  const { error } = await supabase.from('entries').update({ tab: newTab }).eq('id', id);
  if (error) throw error;
  invalidateTabCache(oldTab);
  invalidateTabCache(newTab);
}
```

- [ ] **Step 7: Wrap `updateProfile` with edit logging**

Replace:

```typescript
export async function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, 'approved' | 'role'>>,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}
```

With:

```typescript
export async function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, 'approved' | 'role'>>,
): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Account not found — it may have been deleted.');

  const actor = await currentActor();
  await logChange('edit_log', 'account', id, existing, actor);

  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 8: Wrap `deleteProfile` with delete logging**

Replace:

```typescript
export async function deleteProfile(id: string): Promise<void> {
  const { error, count } = await supabase
    .from('profiles')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) throw error;
  if (count === 0) throw new Error('Delete had no effect — the "admins can delete profiles" RLS policy may not be applied in your Supabase project.');
}
```

With:

```typescript
export async function deleteProfile(id: string): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Account not found — it may already be deleted.');

  const actor = await currentActor();
  await logChange('delete_log', 'account', id, existing, actor);

  const { error, count } = await supabase
    .from('profiles')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) throw error;
  if (count === 0) throw new Error('Delete had no effect — the "admins can delete profiles" RLS policy may not be applied in your Supabase project.');
}
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors. Fix any type issues before continuing (in particular, double check `currentUserEmail` is still used by `insertEntry` and wasn't accidentally removed).

- [ ] **Step 10: Manual verification against the live Supabase project**

In the app (dev server or deployed), as any approved user:
1. Edit one field on an existing entry in a brand tab.
2. In the Supabase SQL editor, run: `select * from edit_log where entity_type = 'entry' order by created_at desc limit 1;`
   Expected: one row with `before_data` containing the entry's pre-edit state.
3. Delete that same entry.
4. Run: `select * from delete_log where entity_type = 'entry' order by created_at desc limit 1;`
   Expected: one row with `before_data` containing the entry's full pre-delete state.
5. As an admin, approve/revoke or role-change a test account on `/admin/users`, then delete a disposable test account.
6. Confirm matching rows appear in `edit_log`/`delete_log` with `entity_type = 'account'`.

- [ ] **Step 11: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat(audit): snapshot rows into delete_log/edit_log before mutation"
```

---

## Task 4: Restore + read functions in queries.ts

**Files:**
- Modify: `src/lib/queries.ts`

**Interfaces:**
- Consumes: `AuditLogEntry` from `src/types/audit-log.ts` (Task 2); `currentActor`, `logChange`, `invalidateTabCache` from Task 3 / existing code.
- Produces: `fetchEditLog(limit?): Promise<AuditLogEntry[]>`, `fetchDeleteLog(limit?): Promise<AuditLogEntry[]>`, `restoreEditedEntity(logId: string): Promise<void>`, `restoreDeletedEntity(logId: string): Promise<void>` — consumed by Task 5 (`ActivityLog.tsx`).

- [ ] **Step 1: Add the `AuditLogEntry` import**

In `src/lib/queries.ts`, change the import added in Task 3 Step 1 from:

```typescript
import type { AuditEntityType } from '../types/audit-log';
```

To:

```typescript
import type { AuditEntityType, AuditLogEntry } from '../types/audit-log';
```

- [ ] **Step 2: Add fetch + restore functions**

Find the end of `fetchAdminLogs` (currently ends around line 683, right before the `// Full check status summary` comment block). Add immediately after `fetchAdminLogs`'s closing brace:

```typescript
export async function fetchEditLog(limit = 200): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('edit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditLogEntry[];
}

export async function fetchDeleteLog(limit = 200): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('delete_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditLogEntry[];
}

export async function restoreDeletedEntity(logId: string): Promise<void> {
  const { data: log, error: selErr } = await supabase
    .from('delete_log')
    .select('*')
    .eq('id', logId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!log) throw new Error('Log entry not found.');
  if (log.restored_at) throw new Error('This item has already been restored.');

  const table = log.entity_type === 'account' ? 'profiles' : 'entries';
  const { error: insErr } = await supabase.from(table).insert(log.before_data);
  if (insErr) throw insErr;

  const actor = await currentActor();
  const { error: updErr, count } = await supabase
    .from('delete_log')
    .update({ restored_at: new Date().toISOString(), restored_by_email: actor.email }, { count: 'exact' })
    .eq('id', logId)
    .is('restored_at', null);
  if (updErr) throw updErr;
  if (!count) throw new Error('This item was already restored by someone else.');

  if (log.entity_type === 'entry') invalidateTabCache(log.tab as string);
}

export async function restoreEditedEntity(logId: string): Promise<void> {
  const { data: log, error: selErr } = await supabase
    .from('edit_log')
    .select('*')
    .eq('id', logId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!log) throw new Error('Log entry not found.');
  if (log.restored_at) throw new Error('This item has already been restored.');

  const table = log.entity_type === 'account' ? 'profiles' : 'entries';
  const { data: current, error: curErr } = await supabase
    .from(table)
    .select('*')
    .eq('id', log.entity_id)
    .maybeSingle();
  if (curErr) throw curErr;
  if (!current) throw new Error('This row no longer exists — restore the delete first.');

  const actor = await currentActor();

  // Snapshot the state right before the restore so the restore itself can be undone later.
  await logChange('edit_log', log.entity_type as AuditEntityType, log.entity_id, current, actor, log.tab ?? undefined);

  // Only revert the fields an edit can actually change — never blindly copy
  // back sync-internal bookkeeping (last_sync_tag, updated_at, sheet_row_id):
  // an old last_sync_tag could confuse the Sheet sync's echo-loop protection,
  // and updated_at should reflect the restore happening now, not the past.
  const beforeData = log.before_data as Record<string, unknown>;
  const patchFields =
    log.entity_type === 'account'
      ? { approved: beforeData.approved, role: beforeData.role }
      : {
          data: beforeData.data,
          tab: beforeData.tab,
          updated_at: new Date().toISOString(),
          last_edited_by: 'dashboard',
          last_edited_email: actor.email,
        };

  const { error: restoreErr } = await supabase
    .from(table)
    .update(patchFields)
    .eq('id', log.entity_id);
  if (restoreErr) throw restoreErr;

  const { error: updErr, count } = await supabase
    .from('edit_log')
    .update({ restored_at: new Date().toISOString(), restored_by_email: actor.email }, { count: 'exact' })
    .eq('id', logId)
    .is('restored_at', null);
  if (updErr) throw updErr;
  if (!count) throw new Error('This item was already restored by someone else.');

  if (log.entity_type === 'entry') {
    invalidateTabCache(current.tab as string);
    invalidateTabCache(beforeData.tab as string);
  }
}
```

This also correctly reverts a `moveEntryToTab` edit (its snapshot's `tab` is the pre-move tab, so restoring it moves the row back), not just field-data edits.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Manual verification against the live Supabase project**

Using the `edit_log`/`delete_log` rows created in Task 3 Step 10 (or fresh ones), call these functions from the browser console on the running app (`window` won't have them directly — instead, temporarily test via the SQL editor by simulating the two writes restore performs, OR proceed to Task 5 and verify through the UI once it exists). Skip a standalone check here if that's simpler — Task 5's manual verification covers this end-to-end.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat(audit): add fetchEditLog/fetchDeleteLog and restore functions"
```

---

## Task 5: Edits & Deletes tabs on ActivityLog page

**Files:**
- Modify: `src/pages/ActivityLog.tsx`

**Interfaces:**
- Consumes: `fetchEditLog`, `fetchDeleteLog`, `restoreEditedEntity`, `restoreDeletedEntity` from `src/lib/queries.ts` (Task 4); `AuditLogEntry` from `src/types/audit-log.ts` (Task 2); `useAuth` from `src/contexts/AuthContext.tsx` (existing, provides `isAdmin` and `profile`); `Toast`/`ToastKind` from `src/components/Toast.tsx` (existing).

- [ ] **Step 1: Replace the full file contents**

Replace the entire contents of `src/pages/ActivityLog.tsx` with:

```typescript
import { useEffect, useState } from 'react';
import {
  AlertCircle, ChevronLeft, ChevronRight, Loader2, Pencil, RotateCcw,
  ShieldCheck, ShieldOff, Trash2, UserCheck, UserX,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchRecentEdits, fetchAdminLogs, fetchEditLog, fetchDeleteLog,
  restoreEditedEntity, restoreDeletedEntity,
  type EditEvent, type AdminLogEvent, type AdminAction,
} from '../lib/queries';
import type { AuditLogEntry } from '../types/audit-log';
import Toast, { type ToastKind } from '../components/Toast';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type FeedItem =
  | { kind: 'edit'; data: EditEvent }
  | { kind: 'admin'; data: AdminLogEvent };

const ACTION_META: Record<AdminAction, { label: string; icon: React.ReactNode; color: string }> = {
  approve:      { label: 'User approved',       icon: <UserCheck className="size-4 shrink-0" />,  color: 'text-green-500' },
  revoke:       { label: 'Access revoked',       icon: <UserX className="size-4 shrink-0" />,      color: 'text-amber-500' },
  remove:       { label: 'User removed',         icon: <Trash2 className="size-4 shrink-0" />,     color: 'text-rose-500' },
  make_admin:   { label: 'Promoted to admin',    icon: <ShieldCheck className="size-4 shrink-0" />, color: 'text-violet-500' },
  remove_admin: { label: 'Admin role removed',   icon: <ShieldOff className="size-4 shrink-0" />,  color: 'text-slate-400' },
};

function ActivityFeed() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The two sources are independent: entry edits always exist, but admin_logs
    // may not be provisioned in every environment. Use allSettled so a missing
    // admin_logs table degrades to an edits-only feed instead of blanking the
    // whole page — only surface an error when BOTH sources fail.
    Promise.allSettled([fetchRecentEdits(100), fetchAdminLogs(100)])
      .then(([editsRes, adminRes]) => {
        if (editsRes.status === 'rejected' && adminRes.status === 'rejected') {
          const reason = editsRes.reason;
          setError(reason instanceof Error ? reason.message : 'Failed to load log');
          return;
        }
        const edits = editsRes.status === 'fulfilled' ? editsRes.value : [];
        const adminLogs = adminRes.status === 'fulfilled' ? adminRes.value : [];
        const items: FeedItem[] = [
          ...edits.map((e): FeedItem => ({ kind: 'edit', data: e })),
          ...adminLogs.map((a): FeedItem => ({ kind: 'admin', data: a })),
        ];
        items.sort((a, b) => {
          const ta = a.kind === 'edit' ? a.data.updated_at : a.data.created_at;
          const tb = b.kind === 'edit' ? b.data.updated_at : b.data.created_at;
          return tb.localeCompare(ta);
        });
        setFeed(items);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <AlertCircle className="size-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (feed.length === 0) {
    return <p className="text-sm text-slate-400">No activity yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {feed.map((item) => {
        if (item.kind === 'edit') {
          const edit = item.data;
          return (
            <li
              key={`edit-${edit.id}`}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
            >
              <Pencil className="mt-0.5 size-4 shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800">
                  Entry edited{edit.editor ? <span className="font-normal text-slate-500"> by {edit.editor}</span> : null}
                </span>
                <p className="mt-0.5 text-xs text-slate-500">
                  {edit.tab} · {edit.account ?? '—'}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{relativeTime(edit.updated_at)}</span>
            </li>
          );
        }

        const log = item.data;
        const meta = ACTION_META[log.action];
        return (
          <li
            key={`admin-${log.id}`}
            className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
          >
            <span className={`mt-0.5 ${meta.color}`}>{meta.icon}</span>
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-slate-800">{meta.label}</span>
              <p className="mt-0.5 text-xs text-slate-500">
                {log.target_email} · by {log.actor_email}
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-400">{relativeTime(log.created_at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

const AUDIT_PAGE_SIZE = 25;

function entityLabel(entry: AuditLogEntry): string {
  if (entry.entity_type === 'account') {
    const before = entry.before_data as { email?: string };
    return before.email ?? 'Unknown account';
  }
  const before = entry.before_data as { data?: Record<string, string | null> };
  const data = before.data ?? {};
  const name = data['Account Name'] ?? data['Account'] ?? data['Brand Name'] ?? data['Brand'];
  return [entry.tab, name].filter(Boolean).join(' · ') || 'Unknown row';
}

function AuditTab({ kind }: { kind: 'edits' | 'deletes' }) {
  const { isAdmin, profile } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPage(1);
    const fetcher = kind === 'edits' ? fetchEditLog : fetchDeleteLog;
    fetcher(200)
      .then(setEntries)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load log'))
      .finally(() => setLoading(false));
  }, [kind]);

  async function handleRestore(id: string) {
    setRestoringId(id);
    setConfirmId(null);
    try {
      if (kind === 'edits') await restoreEditedEntity(id);
      else await restoreDeletedEntity(id);
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, restored_at: new Date().toISOString(), restored_by_email: profile?.email ?? null }
            : e,
        ),
      );
      setToast({ message: 'Restored.', kind: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Restore failed', kind: 'error' });
    } finally {
      setRestoringId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <AlertCircle className="size-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">No {kind} recorded yet.</p>;
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / AUDIT_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageEntries = entries.slice((safePage - 1) * AUDIT_PAGE_SIZE, safePage * AUDIT_PAGE_SIZE);

  return (
    <div>
      <ul className="space-y-2">
        {pageEntries.map((entry) => {
          const isRestoring = restoringId === entry.id;
          const isExpanded = expandedId === entry.id;
          return (
            <li key={entry.id} className="rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-start gap-3">
                {kind === 'deletes'
                  ? <Trash2 className="mt-0.5 size-4 shrink-0 text-rose-500" />
                  : <Pencil className="mt-0.5 size-4 shrink-0 text-violet-500" />}
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800">
                    {entry.entity_type === 'account' ? 'Account' : 'Row'} {kind === 'deletes' ? 'deleted' : 'edited'}
                    <span className="font-normal text-slate-500"> by {entry.actor_email}</span>
                  </span>
                  <p className="mt-0.5 text-xs text-slate-500">{entityLabel(entry)}</p>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="mt-1 text-xs text-violet-600 hover:underline"
                  >
                    {isExpanded ? 'Hide details' : 'View details'}
                  </button>
                  {isExpanded && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                      {JSON.stringify(entry.before_data, null, 2)}
                    </pre>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-slate-400">{relativeTime(entry.created_at)}</span>
                  {isAdmin && (
                    entry.restored_at ? (
                      <span className="text-xs text-emerald-600">
                        Restored{entry.restored_by_email ? ` by ${entry.restored_by_email}` : ''}
                      </span>
                    ) : isRestoring ? (
                      <Loader2 className="size-4 animate-spin text-slate-400" />
                    ) : confirmId === entry.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => handleRestore(entry.id)}
                          className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-violet-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmId(entry.id)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-50 transition-colors"
                      >
                        <RotateCcw className="size-3.5" />
                        Restore
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {entries.length > AUDIT_PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span className="tabular-nums">
            {(safePage - 1) * AUDIT_PAGE_SIZE + 1}–{Math.min(safePage * AUDIT_PAGE_SIZE, entries.length)} of {entries.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-violet-50 transition-colors"
            >
              <ChevronLeft className="size-4" /> Prev
            </button>
            <span className="px-1 tabular-nums">{safePage} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-violet-50 transition-colors"
            >
              Next <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}

const LOG_TABS = ['activity', 'edits', 'deletes'] as const;
type LogTab = (typeof LOG_TABS)[number];

export default function ActivityLog() {
  const [tab, setTab] = useState<LogTab>('activity');

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Log</h1>

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {LOG_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors',
              tab === t ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'activity' && <ActivityFeed />}
      {tab === 'edits' && <AuditTab kind="edits" />}
      {tab === 'deletes' && <AuditTab kind="deletes" />}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors. Fix any type issues before continuing.

- [ ] **Step 3: Manual verification in the browser**

Run the dev server and log in as an approved non-admin user, then as an admin, to check both roles:

```bash
npm run dev
```

1. Navigate to `/log`. Confirm three tabs render: Activity, Edits, Deletes.
2. **Activity tab:** confirm it looks identical to before this change (existing edits + admin-action feed).
3. **As a non-admin approved user:** open the Edits/Deletes tabs. Confirm entry rows appear with no Restore button, and confirm no account rows appear (RLS should filter them out).
4. **As an admin:** edit a test entry, then open the Edits tab — confirm the edit appears with actor email, tab/brand label, "View details" (expand to see the JSON snapshot), and a Restore button.
5. Click Restore, confirm the confirmation prompt, confirm it. Verify: the row's field reverts to its pre-edit value on the brand tab page, the Edits tab entry now shows "Restored by \<your email\>", and a **new** edit_log row appears (capturing the state right before the restore).
6. Delete a disposable test entry, open the Deletes tab, click Restore, confirm the row reappears in its original tab with its original data.
7. Repeat delete+restore for a disposable test account on `/admin/users` (approve it first if needed, then delete, then restore from the Deletes tab, and confirm it reappears in the admin users list).
8. Confirm pagination controls appear only when more than 25 rows exist in a tab (create test data if needed, or accept this check is deferred until real volume accumulates).

- [ ] **Step 4: Commit**

```bash
git add src/pages/ActivityLog.tsx
git commit -m "feat(audit): add Edits/Deletes tabs with admin restore to /log"
```

---

## Task 6: Documentation

**Files:**
- Modify: `docs/task-history.md`

- [ ] **Step 1: Append the completed-task entry**

Open `docs/task-history.md`. Before the final `*Last updated: ...*` line, insert (after Task 83):

```markdown
## Task 84: Delete/Edit Audit Log with Restore

**Date:** July 2, 2026

Added full audit logging for account (profiles) and row (entries) deletes and edits, with admin-only restore. Previously both were permanent — a delete left no trace, and an edit only stamped who/when without keeping the prior value.

- New `delete_log`/`edit_log` tables (kept separate so rare deletes aren't buried under routine edit volume) snapshot the full row immediately before every delete/update in `queries.ts`, covering `deleteEntries`, `updateEntryData`, `updateMentionStatus`, `moveEntryToTab`, `deleteProfile`, and `updateProfile`.
- `/log` (`ActivityLog.tsx`) gained "Edits" and "Deletes" tabs alongside its existing feed, each with an admin-only Restore action; restoring an edit itself writes a new edit_log row so it can be undone again.
- RLS split by entity type: entry rows follow the existing anyone-can-read `entries` policy, account rows are admin-only-read like `admin_logs`. Restoring is admin-only for both, enforced at the RLS level for accounts (new `profiles` insert policy) and via the audit table's admin-only update policy plus the UI gate for entries.
- Spec: `docs/superpowers/specs/2026-07-02-delete-edit-audit-restore-design.md`. Plan: `docs/superpowers/plans/2026-07-02-delete-edit-audit-restore.md`.

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/task-history.md
git commit -m "docs: record Task 84 delete/edit audit log with restore"
```

---

## Self-Review

**Spec coverage:**
- ✅ Section 1 (Data model, delete_log/edit_log schema + RLS split by entity_type) → Task 1
- ✅ Section 2 (write-path snapshot logging for all 6 functions) → Task 3
- ✅ Section 3 (restore logic, race-safe via `restored_at is null` check) → Task 4
- ✅ Section 4 (UI tabs, 25-row pagination, admin-only restore button, visibility split) → Task 5
- ✅ Section 5 (error handling: snapshot-then-write ordering, toast surfacing, no DELETE policy) → Tasks 3–5
- ✅ Section 6 (scope: no create-logging, no cleanup job) → reflected throughout, not contradicted anywhere
- ✅ Section 7 (verification via npm run build + manual click-through) → each task's verification steps

**Placeholder scan:** None found — every step has literal file contents or exact commands.

**Type consistency:**
- `AuditEntityType`/`AuditLogEntry` defined in Task 2, imported identically in Task 3 (`AuditEntityType`) and Task 4/5 (`AuditLogEntry`) ✅
- `currentActor`/`logChange` defined in Task 3, used with identical signatures in Task 4 (`restoreEditedEntity`'s `logChange` call) ✅
- `fetchEditLog`/`fetchDeleteLog`/`restoreEditedEntity`/`restoreDeletedEntity` defined in Task 4, imported with matching names in Task 5 ✅
- `AuditTab` prop shape (`{ kind: 'edits' | 'deletes' }`) matches both call sites in `ActivityLog`'s default export ✅
