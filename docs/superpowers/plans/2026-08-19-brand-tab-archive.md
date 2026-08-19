# Brand Tab Archive (Reversible Delete + Reason) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any Brand Tab — hardcoded or self-service/dynamic — be archived (hidden, reversibly, with a required reason) instead of only self-service tabs being hard-deletable as today, and reach that exclusion consistently across every surface that reads tab data.

**Architecture:** A new `tab_archive_log` audit table (shaped like `delete_log`/`edit_log` but keyed by `tab` text instead of a uuid, since a hardcoded tab has no row/uuid anywhere) drives a new in-memory `archivedTabRegistry.ts` module that splices archived tab names out of `OPERATIONAL_TABS` in place — the same proven mechanism `dynamicTabRegistry.ts` already uses, which is what gives every existing `OPERATIONAL_TABS` reader a live update for free. The old dynamic-tab-only hard-delete path (`deleteCustomTab`) is removed and replaced everywhere by this one archive mechanism.

**Tech Stack:** Vite 6 · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres + RLS) · Deno Edge Functions · Vitest

**Spec:** `docs/superpowers/specs/2026-08-19-brand-tab-archive-design.md`

## Global Constraints

- Archive is the only mechanism, for every tab, hardcoded and dynamic alike — no hard-delete path exists anywhere after this plan (the old `deleteCustomTab` is removed, not kept alongside).
- A reason is required to archive a tab; there is no reason field on unarchive.
- Access gate for every new write path is `isApproved` — not admin-only.
- Reach: fully excluded — Sidebar, Overview, Score Summary, Schedule Planner (including its weekly cron + PMS push), and Ask AI. Verified explicitly in Task 10's live check, not assumed.
- Reason/restore visibility is Activity Log only — no separate "Archived Tabs" admin page.
- The two Edge Function changes (`generate-weekly-schedule`, `ai-assistant`) are code changes now; their `supabase functions deploy` steps stay documented, pending, manual steps — matching this project's established practice for both functions already.

---

### Task 1: Migration — `tab_archive_log` table

**Files:**
- Create: `supabase/migrations/20260819150000_add_tab_archive_log.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Brand Tab archive (reversible delete + reason)
-- (docs/superpowers/specs/2026-08-19-brand-tab-archive-design.md): a fresh,
-- standalone audit table, shaped like the existing delete_log/edit_log but
-- keyed by `tab` (text) instead of `entity_id` (uuid) -- a hardcoded tab has
-- no row/uuid anywhere to key off, unlike an entry or account. Deliberately
-- not reusing delete_log, to avoid touching its already-shipped, already-
-- tested entry/account restore code.
create table public.tab_archive_log (
  id                 uuid primary key default gen_random_uuid(),
  tab                text not null,
  reason             text not null,
  actor_email        text not null,
  created_at         timestamptz not null default now(),
  restored_at        timestamptz,
  restored_by_email  text
);

-- only one *active* (non-restored) archive row per tab at a time
create unique index tab_archive_log_active_idx
  on public.tab_archive_log (tab) where restored_at is null;

alter table public.tab_archive_log enable row level security;

-- Same access model as every other tab-management table in this feature
-- area (tab_hidden_platforms, tab_toolbar_filters, custom_tabs): any
-- approved user, not admin-only. No delete policy -- this is an append-only
-- audit table, matching the existing delete_log/edit_log precedent, which
-- also has no delete policy.
create policy "approved users can read tab_archive_log"
  on public.tab_archive_log for select using (public.is_approved());
create policy "approved users can insert tab_archive_log"
  on public.tab_archive_log for insert with check (public.is_approved());
create policy "approved users can restore tab_archive_log"
  on public.tab_archive_log for update
  using (public.is_approved()) with check (public.is_approved());
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: migration `20260819150000_add_tab_archive_log` applied successfully. If this checkout isn't linked to the Supabase project, note that explicitly and treat this as a pending-deploy item — do not block the rest of this plan on it, since every later task's automated tests mock the Supabase client.

- [ ] **Step 3: Verify live**

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'tab_archive_log'
order by ordinal_position;
```

Expected: `id` (uuid), `tab` (text), `reason` (text), `actor_email` (text), `created_at`/`restored_at` (timestamp with time zone), `restored_by_email` (text).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260819150000_add_tab_archive_log.sql
git commit -m "feat: add tab_archive_log table for reversible Brand Tab archiving"
```

---

### Task 2: `src/lib/archivedTabRegistry.ts` — in-memory archive registry

**Files:**
- Create: `src/lib/archivedTabRegistry.ts`
- Create: `src/lib/archivedTabRegistry.test.ts`

**Interfaces:**
- Consumes: `OPERATIONAL_TABS` (from `./tabs.ts`, already exported).
- Produces: `archiveTabLocally(tab: string): void`, `unarchiveTabLocally(tab: string): void`, `applyArchivedTabs(rows: { tab: string }[]): void`, `resetArchivedTabs(): void`, `isTabArchived(tab: string): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/archivedTabRegistry.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { OPERATIONAL_TABS } from './tabs';
import {
  archiveTabLocally, unarchiveTabLocally, applyArchivedTabs, resetArchivedTabs, isTabArchived,
} from './archivedTabRegistry';

describe('archivedTabRegistry', () => {
  afterEach(() => {
    resetArchivedTabs();
  });

  it('archiveTabLocally removes a hardcoded tab from OPERATIONAL_TABS and marks it archived', () => {
    expect(OPERATIONAL_TABS).toContain('Hanan');
    archiveTabLocally('Hanan');
    expect(OPERATIONAL_TABS).not.toContain('Hanan');
    expect(isTabArchived('Hanan')).toBe(true);
  });

  it('unarchiveTabLocally restores a hardcoded tab to OPERATIONAL_TABS', () => {
    archiveTabLocally('Hanan');
    unarchiveTabLocally('Hanan');
    expect(OPERATIONAL_TABS).toContain('Hanan');
    expect(isTabArchived('Hanan')).toBe(false);
  });

  it('archiveTabLocally also works for a dynamic tab name not currently in OPERATIONAL_TABS', () => {
    expect(() => archiveTabLocally('Some Dynamic Tab')).not.toThrow();
    expect(isTabArchived('Some Dynamic Tab')).toBe(true);
    expect(OPERATIONAL_TABS).not.toContain('Some Dynamic Tab');
  });

  it('applyArchivedTabs archives every row in the list', () => {
    applyArchivedTabs([{ tab: 'Hanan' }, { tab: 'Wizard of Odds' }]);
    expect(isTabArchived('Hanan')).toBe(true);
    expect(isTabArchived('Wizard of Odds')).toBe(true);
  });

  it('resetArchivedTabs unarchives everything and restores original OPERATIONAL_TABS membership', () => {
    archiveTabLocally('Hanan');
    archiveTabLocally('Wizard of Odds');
    resetArchivedTabs();
    expect(isTabArchived('Hanan')).toBe(false);
    expect(isTabArchived('Wizard of Odds')).toBe(false);
    expect(OPERATIONAL_TABS).toContain('Hanan');
    expect(OPERATIONAL_TABS).toContain('Wizard of Odds');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- archivedTabRegistry.test.ts`
Expected: FAIL — `Cannot find module './archivedTabRegistry'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/archivedTabRegistry.ts`:

```ts
// Brand Tab archive (reversible delete + reason)
// (docs/superpowers/specs/2026-08-19-brand-tab-archive-design.md): archiving
// a tab -- hardcoded or dynamic -- splices it out of OPERATIONAL_TABS in
// place, the same proven mechanism dynamicTabRegistry.ts's
// register/unregisterDynamicTab already use, which is what gives every one
// of OPERATIONAL_TABS' existing readers (Sidebar, Overview, Score Summary,
// Schedule Planner, both entry modals, BrandGroup) a live update with zero
// call-site changes.
//
// Same Deno-safety constraints as dynamicTabRegistry.ts/tab-configs.ts (no
// React/npm imports, no I/O) -- this module is also imported by the
// generate-weekly-schedule Edge Function.
import { OPERATIONAL_TABS } from './tabs.ts';

const archivedTabNames = new Set<string>();

// Own small private copy of the notify helper -- same event name as
// dynamicTabRegistry.ts's and tab-configs.ts's own copies, so Sidebar.tsx's
// one listener covers all three (see dynamicTabRegistry.ts's own comment on
// this pattern). Guarded the same way: Supabase's real Edge Runtime defines
// a bare `window` global, so `typeof window !== 'undefined'` alone isn't
// proof `dispatchEvent` is safe to call.
function notifyTabPlatformsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('tab-platforms-changed'));
  }
}

export function archiveTabLocally(tab: string): void {
  archivedTabNames.add(tab);
  const idx = OPERATIONAL_TABS.indexOf(tab);
  if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1);
  notifyTabPlatformsChanged();
}

export function unarchiveTabLocally(tab: string): void {
  archivedTabNames.delete(tab);
  if (!OPERATIONAL_TABS.includes(tab)) OPERATIONAL_TABS.push(tab);
  notifyTabPlatformsChanged();
}

export function applyArchivedTabs(rows: { tab: string }[]): void {
  for (const row of rows) archiveTabLocally(row.tab);
}

// Needed by generate-weekly-schedule, whose Edge isolate is reused across
// invocations -- without this, a tab unarchived since the last invocation
// would incorrectly stay excluded from that run's generation loop forever
// (the same isolate-state bug class as dynamicTabRegistry.ts's
// resetDynamicTabs already guards against).
export function resetArchivedTabs(): void {
  for (const tab of Array.from(archivedTabNames)) unarchiveTabLocally(tab);
}

export function isTabArchived(tab: string): boolean {
  return archivedTabNames.has(tab);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- archivedTabRegistry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/archivedTabRegistry.ts src/lib/archivedTabRegistry.test.ts
git commit -m "feat: add in-memory archivedTabRegistry (splices OPERATIONAL_TABS)"
```

---

### Task 3: `queries.ts` — archive/unarchive queries, remove `deleteCustomTab`

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/queries.test.ts`

**Interfaces:**
- Produces: `archiveTab(tab: string, reason: string): Promise<void>`, `unarchiveTab(logId: string): Promise<void>`, `interface ArchivedTabRow { tab: string }`, `fetchArchivedTabs(client?): Promise<ArchivedTabRow[]>`, `interface TabArchivedEvent { id: string; tab: string; reason: string; actorEmail: string; createdAt: string; restoredAt: string | null; restoredByEmail: string | null }`, `fetchRecentTabArchives(limit?): Promise<TabArchivedEvent[]>`.
- Removes: `deleteCustomTab` (and its 5 existing tests).

- [ ] **Step 1: Write the failing tests**

In `src/lib/queries.test.ts`, remove `deleteCustomTab` from the top import list (line 42) and add the new names in its place:

```ts
  archiveTab,
  unarchiveTab,
  fetchArchivedTabs,
  fetchRecentTabArchives,
```

Delete the entire `describe('fetchCustomTabs / createCustomTab / deleteCustomTab', ...)` block's 5 `deleteCustomTab`-specific tests (the `it('deleteCustomTab ...')` blocks starting at what is currently line 893 through line 958, i.e. everything from `it('deleteCustomTab blocks deletion...'` through the closing of `it('deleteCustomTab throws when the delete affected zero rows...')`), keeping the block's other tests (`fetchCustomTabs`, `createCustomTab`, `updateCustomTabPlatforms`) and its closing `});` intact. Rename the `describe` block itself to `describe('fetchCustomTabs / createCustomTab / updateCustomTabPlatforms', ...)`.

Add these new test blocks (placed after the existing `describe('fetchToolbarFilters / setToolbarFilters', ...)` block):

```ts
describe('archiveTab / unarchiveTab / fetchArchivedTabs / fetchRecentTabArchives', () => {
  it('archiveTab inserts a row with the current actor email', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ insert });
    await archiveTab('Rooster Partners', 'No longer partnered');
    expect(insert).toHaveBeenCalledWith({
      tab: 'Rooster Partners',
      reason: 'No longer partnered',
      actor_email: '',
    });
  });

  it('archiveTab throws a friendly error when the tab is already archived', async () => {
    const insert = vi.fn().mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    singletonFrom.mockReturnValue({ insert });
    await expect(archiveTab('Rooster Partners', 'x')).rejects.toThrow('"Rooster Partners" is already archived.');
  });

  it('unarchiveTab sets restored_at/restored_by_email and succeeds', async () => {
    const is = vi.fn().mockResolvedValue({ error: null, count: 1 });
    const eq = vi.fn().mockReturnValue({ is });
    const update = vi.fn().mockReturnValue({ eq });
    singletonFrom.mockReturnValue({ update });
    await unarchiveTab('log-1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ restored_by_email: null }),
      { count: 'exact' },
    );
    expect(eq).toHaveBeenCalledWith('id', 'log-1');
    expect(is).toHaveBeenCalledWith('restored_at', null);
  });

  it('unarchiveTab throws when zero rows were affected (already unarchived)', async () => {
    const is = vi.fn().mockResolvedValue({ error: null, count: 0 });
    const eq = vi.fn().mockReturnValue({ is });
    const update = vi.fn().mockReturnValue({ eq });
    singletonFrom.mockReturnValue({ update });
    await expect(unarchiveTab('log-1')).rejects.toThrow('already been unarchived');
  });

  it('fetchArchivedTabs returns only active (non-restored) rows', async () => {
    const is = vi.fn().mockResolvedValue({ data: [{ tab: 'Rooster Partners' }], error: null });
    const select = vi.fn().mockReturnValue({ is });
    singletonFrom.mockReturnValue({ select });
    const rows = await fetchArchivedTabs();
    expect(select).toHaveBeenCalledWith('tab');
    expect(is).toHaveBeenCalledWith('restored_at', null);
    expect(rows).toEqual([{ tab: 'Rooster Partners' }]);
  });

  it('fetchRecentTabArchives maps all rows (active and restored) to the event shape', async () => {
    singletonFrom.mockReturnValue(
      chain({
        data: [{
          id: 'log-1', tab: 'Rooster Partners', reason: 'x', actor_email: 'a@b.com',
          created_at: '2026-08-19T00:00:00Z', restored_at: null, restored_by_email: null,
        }],
        error: null,
      }),
    );
    const rows = await fetchRecentTabArchives();
    expect(rows).toEqual([{
      id: 'log-1', tab: 'Rooster Partners', reason: 'x', actorEmail: 'a@b.com',
      createdAt: '2026-08-19T00:00:00Z', restoredAt: null, restoredByEmail: null,
    }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- queries.test.ts`
Expected: FAIL — `archiveTab`/`unarchiveTab`/`fetchArchivedTabs`/`fetchRecentTabArchives` not exported; `deleteCustomTab` import error resolved once removed.

- [ ] **Step 3: Implement in `queries.ts`**

Remove the entire `deleteCustomTab` function (currently the block starting `export async function deleteCustomTab(name: string): Promise<void> {` through its closing `}`, immediately after `setToolbarFilters` and before `fetchHiddenTabPlatforms`).

In its place, insert:

```ts
export async function archiveTab(tab: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('tab_archive_log')
    .insert({ tab, reason, actor_email: (await currentUserEmail()) ?? '' });
  if (error) {
    if (error.code === '23505') throw new Error(`"${tab}" is already archived.`);
    throw error;
  }
}

export async function unarchiveTab(logId: string): Promise<void> {
  const actorEmail = await currentUserEmail();
  const { error, count } = await supabase
    .from('tab_archive_log')
    .update({ restored_at: new Date().toISOString(), restored_by_email: actorEmail }, { count: 'exact' })
    .eq('id', logId)
    .is('restored_at', null);
  if (error) throw error;
  if (!count) throw new Error('This tab has already been unarchived.');
}

export interface ArchivedTabRow {
  tab: string;
}

export async function fetchArchivedTabs(client: SupabaseClient = supabase): Promise<ArchivedTabRow[]> {
  const { data, error } = await client
    .from('tab_archive_log')
    .select('tab')
    .is('restored_at', null);
  if (error) throw error;
  return (data ?? []) as ArchivedTabRow[];
}

export interface TabArchivedEvent {
  id: string;
  tab: string;
  reason: string;
  actorEmail: string;
  createdAt: string;
  restoredAt: string | null;
  restoredByEmail: string | null;
}

export async function fetchRecentTabArchives(limit = 50): Promise<TabArchivedEvent[]> {
  const { data, error } = await supabase
    .from('tab_archive_log')
    .select('id, tab, reason, actor_email, created_at, restored_at, restored_by_email')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    tab: row.tab as string,
    reason: row.reason as string,
    actorEmail: row.actor_email as string,
    createdAt: row.created_at as string,
    restoredAt: (row.restored_at as string | null) ?? null,
    restoredByEmail: (row.restored_by_email as string | null) ?? null,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- queries.test.ts`
Expected: PASS (6 new tests, all existing tests in this file still pass — the 5 removed `deleteCustomTab` tests are gone, not failing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: replace deleteCustomTab hard-delete with archiveTab/unarchiveTab"
```

---

### Task 4: `tabValidation.ts` — reject a name matching a currently-archived tab

**Files:**
- Modify: `src/lib/tabValidation.ts`
- Modify: `src/lib/tabValidation.test.ts`

**Interfaces:**
- Consumes: `isTabArchived` (from Task 2's `archivedTabRegistry.ts`).

- [ ] **Step 1: Write the failing test**

In `src/lib/tabValidation.test.ts`, add to the top imports:

```ts
import { archiveTabLocally, unarchiveTabLocally } from './archivedTabRegistry';
```

Add inside the existing `describe('validateNewTabName', ...)` block (after the existing `beforeEach`):

```ts
  it('rejects a name matching a currently-archived tab', () => {
    archiveTabLocally('Old Archived Tab');
    expect(validateNewTabName('Old Archived Tab')).toBe(
      '"Old Archived Tab" is currently archived — unarchive it, or choose a different name.',
    );
    unarchiveTabLocally('Old Archived Tab');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tabValidation.test.ts`
Expected: FAIL — the archived-tab candidate does not get rejected (falls through to `null`, since nothing yet checks archived state).

- [ ] **Step 3: Write the implementation**

In `src/lib/tabValidation.ts`, add the import:

```ts
import { isTabArchived } from './archivedTabRegistry';
```

Insert a new check immediately after the existing hardcoded/`OPERATIONAL_TABS` collision check and before the slug-collision check:

```ts
  const collision = OPERATIONAL_TABS.includes(trimmed) || trimmed in TAB_COLUMN_CONFIGS;
  if (collision) return `A tab named "${trimmed}" already exists.`;
  // Once an archived *dynamic* tab is spliced out of OPERATIONAL_TABS, the
  // check above stops seeing it -- without this, a new tab could be created
  // with the exact same name while the archived one's custom_tabs row and
  // entries still exist.
  if (isTabArchived(trimmed)) {
    return `"${trimmed}" is currently archived — unarchive it, or choose a different name.`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tabValidation.test.ts`
Expected: PASS (9 tests — the existing 8 plus this new one)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabValidation.ts src/lib/tabValidation.test.ts
git commit -m "fix: reject a new/renamed tab name matching a currently-archived tab"
```

---

### Task 5: `AuthContext.tsx` — bootstrap wiring

**Files:**
- Modify: `src/contexts/AuthContext.tsx`

**Interfaces:**
- Consumes: `fetchArchivedTabs` (Task 3), `applyArchivedTabs` (Task 2).

- [ ] **Step 1: Update imports**

Change:

```ts
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchToolbarFilters } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
import { registerHiddenTabPlatforms, registerToolbarFilters } from '../lib/tab-configs';
```

to:

```ts
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchToolbarFilters, fetchArchivedTabs } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
import { registerHiddenTabPlatforms, registerToolbarFilters } from '../lib/tab-configs';
import { applyArchivedTabs } from '../lib/archivedTabRegistry';
```

- [ ] **Step 2: Extend the bootstrap `Promise.all`**

Change:

```ts
        Promise.all([
          fetchProfile(s.user.id),
          fetchCustomTabs().catch((err) => {
            console.error('Failed to fetch custom tabs:', err);
            return [];
          }),
          fetchHiddenTabPlatforms().catch((err) => {
            console.error('Failed to fetch hidden tab platforms:', err);
            return [];
          }),
          fetchToolbarFilters().catch((err) => {
            console.error('Failed to fetch toolbar filters:', err);
            return [];
          }),
        ]).then(([p, customTabs, hiddenPlatforms, toolbarFilters]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          registerHiddenTabPlatforms(hiddenPlatforms);
          registerToolbarFilters(toolbarFilters);
          setProfile(p);
          setLoading(false);
        });
```

to:

```ts
        Promise.all([
          fetchProfile(s.user.id),
          fetchCustomTabs().catch((err) => {
            console.error('Failed to fetch custom tabs:', err);
            return [];
          }),
          fetchHiddenTabPlatforms().catch((err) => {
            console.error('Failed to fetch hidden tab platforms:', err);
            return [];
          }),
          fetchToolbarFilters().catch((err) => {
            console.error('Failed to fetch toolbar filters:', err);
            return [];
          }),
          fetchArchivedTabs().catch((err) => {
            console.error('Failed to fetch archived tabs:', err);
            return [];
          }),
        ]).then(([p, customTabs, hiddenPlatforms, toolbarFilters, archivedTabs]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          registerHiddenTabPlatforms(hiddenPlatforms);
          registerToolbarFilters(toolbarFilters);
          // Must run after registerDynamicTabs: a dynamic tab archived since
          // its custom_tabs row was created gets registered (added back to
          // OPERATIONAL_TABS) and then immediately archived again (removed)
          // in that order -- reversed, it would incorrectly reappear.
          applyArchivedTabs(archivedTabs);
          setProfile(p);
          setLoading(false);
        });
```

- [ ] **Step 3: Run the full suite and build**

Run: `npm test` then `npm run build`
Expected: both pass — `AuthContext.test.ts` only covers `fetchProfile` directly (matching this project's existing convention of not unit-testing the bootstrap wiring itself), so no test changes are needed here.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "feat: fetch and apply archived tabs at session bootstrap"
```

---

### Task 6: `BrandGroup.tsx` — Archive button/modal, retire hard-delete, archived-tab guard

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `archiveTab` (Task 3), `archiveTabLocally`, `isTabArchived` (Task 2).

- [ ] **Step 1: Update imports**

Change the `lucide-react` import (line 3-7):

```ts
import {
  CheckCircle2, XCircle, Circle, Building2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Search, X, Check, CalendarDays, Plus, RefreshCw, Loader2, Star, Trash2, Pencil,
} from 'lucide-react';
```

to (swap `Trash2` for `Archive`):

```ts
import {
  CheckCircle2, XCircle, Circle, Building2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Search, X, Check, CalendarDays, Plus, RefreshCw, Loader2, Star, Archive, Pencil,
} from 'lucide-react';
```

Change the `queries` import (line 21) to drop `deleteCustomTab` and add `archiveTab`:

```ts
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, triggerAgStatusCheck, triggerCgStatusCheck, triggerWoStatusCheck, insertEntry, deleteEntries, moveEntryToTab, fetchRemovedPlatformBrands, setBrandPlatformRemoved, fetchBrandPlatformOverrides, setBrandPlatformOverride, clearBrandPlatformOverride, fetchAllEntries, archiveTab, type StatusCheckScope } from '../lib/queries';
```

Change the `dynamicTabRegistry` import (line 22) to drop `unregisterDynamicTab` (no longer called from this file — archiving never touches the dynamic-tab column registry, only `OPERATIONAL_TABS` membership) and keep `isDynamicTab` (still used by `EditBrandTabModal`'s own logic elsewhere in this file):

```ts
import { isDynamicTab } from '../lib/dynamicTabRegistry';
```

Add a new import line directly after it:

```ts
import { archiveTabLocally, isTabArchived } from '../lib/archivedTabRegistry';
```

- [ ] **Step 2: Rename the delete-tab state to archive-tab state, add a reason field**

Change:

```ts
  const [showDeleteTabModal, setShowDeleteTabModal] = useState(false);
  const [deleteTabConfirmText, setDeleteTabConfirmText] = useState('');
  const [deletingTab, setDeletingTab] = useState(false);
  const [deleteTabError, setDeleteTabError] = useState<string | null>(null);
```

to:

```ts
  const [showArchiveTabModal, setShowArchiveTabModal] = useState(false);
  const [archiveTabConfirmText, setArchiveTabConfirmText] = useState('');
  const [archiveTabReason, setArchiveTabReason] = useState('');
  const [archivingTab, setArchivingTab] = useState(false);
  const [archiveTabError, setArchiveTabError] = useState<string | null>(null);
```

- [ ] **Step 3: Update the Escape-to-close effect**

Change:

```ts
  // Escape-to-close for the delete-tab confirmation dialog — a document-level
  // listener rather than relying on focus already being inside the dialog
  // (matches the pattern this project's other modals use).
  useEffect(() => {
    if (!showDeleteTabModal) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowDeleteTabModal(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showDeleteTabModal]);
```

to:

```ts
  // Escape-to-close for the archive-tab confirmation dialog — a document-level
  // listener rather than relying on focus already being inside the dialog
  // (matches the pattern this project's other modals use).
  useEffect(() => {
    if (!showArchiveTabModal) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowArchiveTabModal(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showArchiveTabModal]);
```

- [ ] **Step 4: Replace `handleConfirmDeleteTab` with `handleConfirmArchiveTab`**

Change:

```ts
  async function handleConfirmDeleteTab() {
    if (deleteTabConfirmText.trim().toLowerCase() !== 'yes') return;
    setDeleteTabError(null);
    setDeletingTab(true);
    try {
      await deleteCustomTab(decodedTab);
      unregisterDynamicTab(decodedTab);
      setShowDeleteTabModal(false);
      navigate('/');
    } catch (err) {
      setDeleteTabError(err instanceof Error ? err.message : 'Failed to delete tab');
    } finally {
      setDeletingTab(false);
    }
  }
```

to:

```ts
  async function handleConfirmArchiveTab() {
    if (archiveTabConfirmText.trim().toLowerCase() !== 'yes') return;
    if (!archiveTabReason.trim()) return;
    setArchiveTabError(null);
    setArchivingTab(true);
    try {
      await archiveTab(decodedTab, archiveTabReason.trim());
      archiveTabLocally(decodedTab);
      setShowArchiveTabModal(false);
      navigate('/');
    } catch (err) {
      setArchiveTabError(err instanceof Error ? err.message : 'Failed to archive tab');
    } finally {
      setArchivingTab(false);
    }
  }
```

- [ ] **Step 5: Add the archived-tab guard, right after the existing error guard**

Change:

```ts
  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  return (
```

to:

```ts
  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  if (isTabArchived(decodedTab)) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
        <p>This Brand Tab has been archived.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-2 text-blue-600 hover:underline"
        >
          Back to Overview
        </button>
      </div>
    );
  }

  return (
```

- [ ] **Step 6: Update the trash/archive toolbar button**

Change:

```tsx
          {isApproved && isDynamicTab(decodedTab) && (
            <Tooltip content={`Delete ${tabDisplayName(decodedTab)}`}>
              <button
                type="button"
                onClick={() => { setDeleteTabError(null); setDeleteTabConfirmText(''); setShowDeleteTabModal(true); }}
                className="inline-flex items-center justify-center rounded-md border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <Trash2 className="size-4" />
              </button>
            </Tooltip>
          )}
```

to:

```tsx
          {isApproved && (
            <Tooltip content={`Archive ${tabDisplayName(decodedTab)}`}>
              <button
                type="button"
                onClick={() => {
                  setArchiveTabError(null);
                  setArchiveTabConfirmText('');
                  setArchiveTabReason('');
                  setShowArchiveTabModal(true);
                }}
                className="inline-flex items-center justify-center rounded-md border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <Archive className="size-4" />
              </button>
            </Tooltip>
          )}
```

- [ ] **Step 7: Replace the delete-tab modal with the archive-tab modal**

Change:

```tsx
      {showDeleteTabModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !deletingTab && setShowDeleteTabModal(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Delete "{tabDisplayName(decodedTab)}"?</h2>
            <p className="text-xs text-slate-500">This cannot be undone. Deletion is blocked if the tab still has any entries.</p>
            <div className="space-y-1">
              <label className="text-xs text-slate-600">
                Type <span className="font-semibold text-slate-800">yes</span> to confirm
              </label>
              <input
                type="text"
                autoFocus
                value={deleteTabConfirmText}
                onChange={(e) => setDeleteTabConfirmText(e.target.value)}
                placeholder="yes"
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>
            {deleteTabError && <p className="text-xs text-rose-600">{deleteTabError}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteTabModal(false)}
                disabled={deletingTab}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTab}
                disabled={deleteTabConfirmText.trim().toLowerCase() !== 'yes' || deletingTab}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingTab ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
```

to:

```tsx
      {showArchiveTabModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !archivingTab && setShowArchiveTabModal(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Archive "{tabDisplayName(decodedTab)}"?</h2>
            <p className="text-xs text-slate-500">
              It will disappear from the dashboard for everyone until it's unarchived — no entries or data are deleted.
            </p>
            <div className="space-y-1">
              <label className="text-xs text-slate-600">Reason (required)</label>
              <textarea
                value={archiveTabReason}
                onChange={(e) => setArchiveTabReason(e.target.value)}
                rows={2}
                placeholder="Why is this tab being archived?"
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-600">
                Type <span className="font-semibold text-slate-800">yes</span> to confirm
              </label>
              <input
                type="text"
                value={archiveTabConfirmText}
                onChange={(e) => setArchiveTabConfirmText(e.target.value)}
                placeholder="yes"
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>
            {archiveTabError && <p className="text-xs text-rose-600">{archiveTabError}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowArchiveTabModal(false)}
                disabled={archivingTab}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmArchiveTab}
                disabled={archiveTabConfirmText.trim().toLowerCase() !== 'yes' || !archiveTabReason.trim() || archivingTab}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {archivingTab ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 8: Run the full suite and build**

Run: `npm test` then `npm run build`
Expected: both pass — no remaining reference to `deleteCustomTab`, `Trash2` (for this button), `showDeleteTabModal`, or `unregisterDynamicTab` in this file.

- [ ] **Step 9: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: replace per-tab hard-delete with Archive (all tabs, required reason)"
```

---

### Task 7: `ActivityLog.tsx` — archive events in the feed, unarchive in Deletes

**Files:**
- Modify: `src/pages/ActivityLog.tsx`

**Interfaces:**
- Consumes: `fetchRecentTabArchives`, `unarchiveTab` (Task 3), `unarchiveTabLocally` (Task 2).

- [ ] **Step 1: Update imports**

Change:

```ts
import {
  AlertCircle, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, RotateCcw,
  ShieldCheck, ShieldOff, Trash2, UserCheck, UserX,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchRecentEdits, fetchAdminLogs, fetchRecentTabCreations, fetchEditLog, fetchDeleteLog, fetchWatchdogEvents,
  restoreEditedEntity, restoreDeletedEntity,
  type EditEvent, type AdminLogEvent, type AdminAction, type TabCreatedEvent, type WatchdogEvent,
} from '../lib/queries';
import { registerDynamicTabs, type DynamicTabPlatform } from '../lib/dynamicTabRegistry';
```

to:

```ts
import {
  AlertCircle, Archive, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, RotateCcw,
  ShieldCheck, ShieldOff, Trash2, UserCheck, UserX,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchRecentEdits, fetchAdminLogs, fetchRecentTabCreations, fetchRecentTabArchives, fetchEditLog, fetchDeleteLog, fetchWatchdogEvents,
  restoreEditedEntity, restoreDeletedEntity, unarchiveTab,
  type EditEvent, type AdminLogEvent, type AdminAction, type TabCreatedEvent, type TabArchivedEvent, type WatchdogEvent,
} from '../lib/queries';
import { registerDynamicTabs, type DynamicTabPlatform } from '../lib/dynamicTabRegistry';
import { unarchiveTabLocally } from '../lib/archivedTabRegistry';
```

- [ ] **Step 2: Add the new `FeedItem` kind and merge it into `ActivityFeed`**

Change:

```ts
type FeedItem =
  | { kind: 'edit'; data: EditEvent }
  | { kind: 'admin'; data: AdminLogEvent }
  | { kind: 'tab_created'; data: TabCreatedEvent };
```

to:

```ts
type FeedItem =
  | { kind: 'edit'; data: EditEvent }
  | { kind: 'admin'; data: AdminLogEvent }
  | { kind: 'tab_created'; data: TabCreatedEvent }
  | { kind: 'tab_archived'; data: TabArchivedEvent };
```

Change the `ActivityFeed` effect body:

```ts
    Promise.allSettled([fetchRecentEdits(100), fetchAdminLogs(100), fetchRecentTabCreations(100)])
      .then(([editsRes, adminRes, tabsRes]) => {
        if (editsRes.status === 'rejected' && adminRes.status === 'rejected' && tabsRes.status === 'rejected') {
          const reason = editsRes.reason;
          setError(reason instanceof Error ? reason.message : 'Failed to load log');
          return;
        }
        const edits = editsRes.status === 'fulfilled' ? editsRes.value : [];
        const adminLogs = adminRes.status === 'fulfilled' ? adminRes.value : [];
        const tabsCreated = tabsRes.status === 'fulfilled' ? tabsRes.value : [];
        const items: FeedItem[] = [
          ...edits.map((e): FeedItem => ({ kind: 'edit', data: e })),
          ...adminLogs.map((a): FeedItem => ({ kind: 'admin', data: a })),
          ...tabsCreated.map((t): FeedItem => ({ kind: 'tab_created', data: t })),
        ];
        items.sort((a, b) => {
          const ta = a.kind === 'edit' ? a.data.updated_at : a.kind === 'admin' ? a.data.created_at : a.data.createdAt;
          const tb = b.kind === 'edit' ? b.data.updated_at : b.kind === 'admin' ? b.data.created_at : b.data.createdAt;
          return tb.localeCompare(ta);
        });
        setFeed(items);
      })
      .finally(() => setLoading(false));
```

to:

```ts
    Promise.allSettled([fetchRecentEdits(100), fetchAdminLogs(100), fetchRecentTabCreations(100), fetchRecentTabArchives(100)])
      .then(([editsRes, adminRes, tabsRes, archivesRes]) => {
        if (
          editsRes.status === 'rejected' && adminRes.status === 'rejected' &&
          tabsRes.status === 'rejected' && archivesRes.status === 'rejected'
        ) {
          const reason = editsRes.reason;
          setError(reason instanceof Error ? reason.message : 'Failed to load log');
          return;
        }
        const edits = editsRes.status === 'fulfilled' ? editsRes.value : [];
        const adminLogs = adminRes.status === 'fulfilled' ? adminRes.value : [];
        const tabsCreated = tabsRes.status === 'fulfilled' ? tabsRes.value : [];
        const tabsArchived = archivesRes.status === 'fulfilled' ? archivesRes.value : [];
        const items: FeedItem[] = [
          ...edits.map((e): FeedItem => ({ kind: 'edit', data: e })),
          ...adminLogs.map((a): FeedItem => ({ kind: 'admin', data: a })),
          ...tabsCreated.map((t): FeedItem => ({ kind: 'tab_created', data: t })),
          ...tabsArchived.map((t): FeedItem => ({ kind: 'tab_archived', data: t })),
        ];
        items.sort((a, b) => {
          const timeOf = (i: FeedItem) =>
            i.kind === 'edit' ? i.data.updated_at :
            i.kind === 'admin' ? i.data.created_at :
            i.kind === 'tab_created' ? i.data.createdAt :
            i.data.createdAt;
          return timeOf(b).localeCompare(timeOf(a));
        });
        setFeed(items);
      })
      .finally(() => setLoading(false));
```

Add a new render branch immediately after the existing `if (item.kind === 'tab_created') { ... }` block, before the trailing `const log = item.data;` admin-log fallback:

```tsx
        if (item.kind === 'tab_archived') {
          const archived = item.data;
          return (
            <li
              key={`tab-archived-${archived.id}`}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
            >
              <Archive className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800">
                  Brand Tab archived
                  <span className="font-normal text-slate-500"> by {archived.actorEmail}</span>
                </span>
                <p className="mt-0.5 text-xs text-slate-500">{tabDisplayName(archived.tab)} · {archived.reason}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{relativeTime(archived.createdAt)}</span>
            </li>
          );
        }
```

- [ ] **Step 3: Add the `ArchivedTabsSection` component**

Insert this new component immediately after the closing `}` of `AuditTab` (before `function ServerHealthFeed()`):

```tsx
function ArchivedTabsSection() {
  const { isApproved, profile } = useAuth();
  const [entries, setEntries] = useState<TabArchivedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  useEffect(() => {
    fetchRecentTabArchives(200)
      .then(setEntries)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load archived tabs'))
      .finally(() => setLoading(false));
  }, []);

  async function handleUnarchive(entry: TabArchivedEvent) {
    setRestoringId(entry.id);
    setConfirmId(null);
    try {
      await unarchiveTab(entry.id);
      unarchiveTabLocally(entry.tab);
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id
            ? { ...e, restoredAt: new Date().toISOString(), restoredByEmail: profile?.email ?? null }
            : e,
        ),
      );
      setToast({ message: 'Unarchived.', kind: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Unarchive failed', kind: 'error' });
    } finally {
      setRestoringId(null);
    }
  }

  if (loading) {
    return <div className="h-14 animate-pulse rounded-lg bg-slate-100" />;
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
    return <p className="text-sm text-slate-400">No archived tabs.</p>;
  }

  return (
    <div>
      <ul className="space-y-2">
        {entries.map((entry) => {
          const isRestoring = restoringId === entry.id;
          return (
            <li key={entry.id} className="rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-start gap-3">
                <Archive className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800">
                    Brand Tab archived
                    <span className="font-normal text-slate-500"> by {entry.actorEmail}</span>
                  </span>
                  <p className="mt-0.5 text-xs text-slate-500">{tabDisplayName(entry.tab)} — {entry.reason}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-slate-400">{relativeTime(entry.createdAt)}</span>
                  {isApproved && (
                    entry.restoredAt ? (
                      <span className="text-xs text-emerald-600">
                        Unarchived{entry.restoredByEmail ? ` by ${entry.restoredByEmail}` : ''}
                      </span>
                    ) : isRestoring ? (
                      <Loader2 className="size-4 animate-spin text-slate-400" />
                    ) : confirmId === entry.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => handleUnarchive(entry)}
                          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-blue-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmId(entry.id)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <RotateCcw className="size-3.5" />
                        Unarchive
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Render `ArchivedTabsSection` inside the "deletes" tab**

Change:

```tsx
      {tab === 'activity' && <ActivityFeed />}
      {tab === 'edits' && <AuditTab kind="edits" />}
      {tab === 'deletes' && <AuditTab kind="deletes" />}
      {tab === 'server health' && isServerHealthOwner && <ServerHealthFeed />}
```

to:

```tsx
      {tab === 'activity' && <ActivityFeed />}
      {tab === 'edits' && <AuditTab kind="edits" />}
      {tab === 'deletes' && (
        <div className="space-y-6">
          <AuditTab kind="deletes" />
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Archived Brand Tabs</h2>
            <ArchivedTabsSection />
          </div>
        </div>
      )}
      {tab === 'server health' && isServerHealthOwner && <ServerHealthFeed />}
```

- [ ] **Step 5: Run the full suite and build**

Run: `npm test` then `npm run build`
Expected: both pass. No new test file for this page (matches this project's existing convention of verifying `ActivityLog.tsx` via build + live check, same as `BrandGroup.tsx`/`AddBrandTabModal.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/pages/ActivityLog.tsx
git commit -m "feat: show Brand Tab archive events in Activity Log, unarchive from Deletes"
```

---

### Task 8: `generate-weekly-schedule` — exclude archived tabs from the weekly cron

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts`

**Interfaces:**
- Consumes: `fetchArchivedTabs` (Task 3), `resetArchivedTabs`, `applyArchivedTabs` (Task 2).

- [ ] **Step 1: Update imports**

Change:

```ts
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, invalidateTabCache, fetchCustomTabs, fetchHiddenTabPlatforms } from '../../../src/lib/queries.ts';
```

to:

```ts
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, invalidateTabCache, fetchCustomTabs, fetchHiddenTabPlatforms, fetchArchivedTabs } from '../../../src/lib/queries.ts';
```

Change:

```ts
import { registerDynamicTabs, resetDynamicTabs } from '../../../src/lib/dynamicTabRegistry.ts';
```

to (add a new import line directly after it):

```ts
import { registerDynamicTabs, resetDynamicTabs } from '../../../src/lib/dynamicTabRegistry.ts';
import { applyArchivedTabs, resetArchivedTabs } from '../../../src/lib/archivedTabRegistry.ts';
```

- [ ] **Step 2: Apply archived-tab exclusion before the generation loop**

Change:

```ts
  const hiddenPlatforms = await fetchHiddenTabPlatforms(client).catch((err) => {
    console.error('[generate-weekly-schedule] failed to fetch hidden tab platforms:', err);
    return [];
  });
  resetHiddenTabPlatforms();
  registerHiddenTabPlatforms(hiddenPlatforms);
  // Computed in the runtime's local zone (UTC on Supabase Edge). This is
```

to:

```ts
  const hiddenPlatforms = await fetchHiddenTabPlatforms(client).catch((err) => {
    console.error('[generate-weekly-schedule] failed to fetch hidden tab platforms:', err);
    return [];
  });
  resetHiddenTabPlatforms();
  registerHiddenTabPlatforms(hiddenPlatforms);
  // Same reset-then-apply shape as the dynamic-tab/hidden-platform registries
  // above, same reason: a tab unarchived since the last invocation must not
  // stay excluded forever in a reused isolate. Runs after registerDynamicTabs
  // (above) for the same ordering reason AuthContext.tsx's bootstrap applies
  // it after registering dynamic tabs.
  const archivedTabs = await fetchArchivedTabs(client).catch((err) => {
    console.error('[generate-weekly-schedule] failed to fetch archived tabs:', err);
    return [];
  });
  resetArchivedTabs();
  applyArchivedTabs(archivedTabs);
  // Computed in the runtime's local zone (UTC on Supabase Edge). This is
```

- [ ] **Step 3: Verify Deno type-checks**

Run: `deno check supabase/functions/generate-weekly-schedule/index.ts`
Expected: clean (no new errors). This function's own test suite (`index_test.ts`) tests `buildTabContext`/`generateAllTabs`/`generateForTab` as injectable, pure-ish functions — it does not (and, following this project's existing convention, should not) unit-test the top-level `Deno.serve` wiring itself; the archived-tab exclusion logic this wiring calls into is already covered by Task 2's `archivedTabRegistry.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts
git commit -m "feat: exclude archived tabs from the weekly schedule generation cron"
```

---

### Task 9: `ai-assistant/tools.ts` — exclude archived tabs from every tool

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
- Modify: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Produces: `buildArchivedTabNameSet(rows: { tab: string; restored_at: string | null }[]): Set<string>` (exported, pure, testable).

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/ai-assistant/tools_test.ts`, add `buildArchivedTabNameSet` to the top import list:

```ts
import {
  pick,
  parseScore,
  mapEntrySummary,
  entryMatches,
  matchesStatus,
  scoreSummary,
  redactSensitive,
  runTool,
  successRateByField,
  ratingLabel,
  normalizeBrandKey,
  platformRemovedKey,
  buildRemovedPlatformBrandSet,
  buildArchivedTabNameSet,
  isSensitiveField,
  collectFieldNames,
  matchesFieldFilters,
  groupByField,
  reviewTextsByStatus,
  EntryRow,
} from './tools.ts';
```

Add these tests (placed after the existing `buildRemovedPlatformBrandSet`-related tests, anywhere in the file):

```ts
Deno.test('buildArchivedTabNameSet includes only rows with no restored_at', () => {
  const set = buildArchivedTabNameSet([
    { tab: 'Rooster Partners', restored_at: null },
    { tab: 'Hanan', restored_at: '2026-08-19T00:00:00Z' },
  ]);
  assertEquals(set.has('Rooster Partners'), true);
  assertEquals(set.has('Hanan'), false);
});

Deno.test('list_tabs excludes an archived tab via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: {} },
      { id: '2', tab: 'Hanan', data: {} },
    ],
    tab_archive_log: [{ tab: 'Hanan', restored_at: null }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'list_tabs', {});
  assertEquals(result.tabs, ['Rooster Partners']);
});

Deno.test('query_entries excludes rows from an archived tab via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: { Brand: 'Acme' } },
      { id: '2', tab: 'Hanan', data: { Brand: 'Beta' } },
    ],
    tab_archive_log: [{ tab: 'Hanan', restored_at: null }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {});
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].tab, 'Rooster Partners');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env --allow-net supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — `buildArchivedTabNameSet` is not exported by `tools.ts`; `list_tabs`/`query_entries` don't yet exclude anything.

- [ ] **Step 3: Implement in `tools.ts`**

Add this pure helper and its impure wrapper immediately after the existing `fetchRemovedPlatformBrandSet` function:

```ts
export function buildArchivedTabNameSet(rows: { tab: string; restored_at: string | null }[]): Set<string> {
  return new Set(rows.filter((r) => !r.restored_at).map((r) => r.tab));
}

async function fetchArchivedTabNameSet(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase.from('tab_archive_log').select('tab, restored_at');
  if (error) throw error;
  return buildArchivedTabNameSet(data ?? []);
}
```

In `runTool`, change the `list_tabs` branch:

```ts
  if (name === 'list_tabs') {
    const { data, error } = await supabase.from('entries').select('tab');
    if (error) throw error;
    return { tabs: [...new Set((data ?? []).map((r: any) => r.tab))].sort() };
  }
```

to:

```ts
  if (name === 'list_tabs') {
    const [{ data, error }, archivedSet] = await Promise.all([
      supabase.from('entries').select('tab'),
      fetchArchivedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const tabs = [...new Set((data ?? []).map((r: any) => r.tab))].filter((t) => !archivedSet.has(t));
    return { tabs: tabs.sort() };
  }
```

Change the `query_entries` branch's query section:

```ts
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    let rows: EntryRow[] = data ?? [];
    if (args?.status) rows = rows.filter((e) => matchesStatus(e, args.status));
```

to:

```ts
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, archivedSet] = await Promise.all([q, fetchArchivedTabNameSet(supabase)]);
    if (error) throw error;
    let rows: EntryRow[] = (data ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab));
    if (args?.status) rows = rows.filter((e) => matchesStatus(e, args.status));
```

Change the `get_score_summary` branch:

```ts
  if (name === 'get_score_summary') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, removedSet] = await Promise.all([q, fetchRemovedPlatformBrandSet(supabase)]);
    if (error) throw error;
```

to:

```ts
  if (name === 'get_score_summary') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, removedSet, archivedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const data = (rawData ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab));
```

Since the existing code below this point references a local `data` variable directly (not `rawData`), rename the destructured `data` to `rawData` in the `Promise.all` line above instead, i.e. the full replacement is:

```ts
  if (name === 'get_score_summary') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data: rawData, error }, removedSet, archivedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const data = (rawData ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab));
```

Apply the exact same `data: rawData` → filtered `data` rename to the `get_success_rate_by_field` branch, which has the identical shape:

```ts
  if (name === 'get_success_rate_by_field') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, removedSet] = await Promise.all([q, fetchRemovedPlatformBrandSet(supabase)]);
    if (error) throw error;
```

becomes:

```ts
  if (name === 'get_success_rate_by_field') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data: rawData, error }, removedSet, archivedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const data = (rawData ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab));
```

Change the `get_schedule` branch:

```ts
    if (args?.tab) q = q.eq('tab', args.tab);
    if (args?.week_start) q = q.eq('week_start', args.week_start);
    const [{ data, error }, hiddenSet, restrictionMap, removedSet] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
      fetchRemovedPlatformBrandSet(supabase),
    ]);
    if (error) throw error;
    return { schedule: filterHiddenOrRestricted(data ?? [], hiddenSet, restrictionMap, removedSet) };
  }
```

to:

```ts
    if (args?.tab) q = q.eq('tab', args.tab);
    if (args?.week_start) q = q.eq('week_start', args.week_start);
    const [{ data, error }, hiddenSet, restrictionMap, removedSet, archivedSet] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
      fetchRemovedPlatformBrandSet(supabase),
      fetchArchivedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((r: any) => !archivedSet.has(r.tab));
    return { schedule: filterHiddenOrRestricted(rows, hiddenSet, restrictionMap, removedSet) };
  }
```

Change the `get_paused_combos` branch:

```ts
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, hiddenSet, restrictionMap, removedSet] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
      fetchRemovedPlatformBrandSet(supabase),
    ]);
    if (error) throw error;
    return { paused: filterHiddenOrRestricted(data ?? [], hiddenSet, restrictionMap, removedSet) };
  }
```

to:

```ts
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, hiddenSet, restrictionMap, removedSet, archivedSet] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
      fetchRemovedPlatformBrandSet(supabase),
      fetchArchivedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((r: any) => !archivedSet.has(r.tab));
    return { paused: filterHiddenOrRestricted(rows, hiddenSet, restrictionMap, removedSet) };
  }
```

Change the `get_review_texts` branch's query section:

```ts
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    q = q.order('id').limit(1000);
    const [{ data, error }, removedSet] = await Promise.all([q, fetchRemovedPlatformBrandSet(supabase)]);
    if (error) throw error;
    const { reviews, total } = reviewTextsByStatus(data ?? [], args.platform, args.status, removedSet);
```

to:

```ts
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    q = q.order('id').limit(1000);
    const [{ data, error }, removedSet, archivedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab));
    const { reviews, total } = reviewTextsByStatus(rows, args.platform, args.status, removedSet);
```

Finally, update `list_tabs`'s own tool description to disclose the exclusion, matching the anti-hallucination wording Task 220 already established for hidden/restricted/removed brands:

```ts
      name: 'list_tabs',
      description: 'List the distinct brand-group tabs available.',
```

to:

```ts
      name: 'list_tabs',
      description: 'List the distinct brand-group tabs available. An archived tab is silently ' +
        'excluded — if a user asks about a tab not in this list, say it may have been archived ' +
        'rather than concluding it never existed.',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-env --allow-net supabase/functions/ai-assistant/tools_test.ts`
Expected: PASS (3 new tests, all existing tests in this file still pass).

- [ ] **Step 5: Verify Deno type-checks**

Run: `deno check supabase/functions/ai-assistant/tools.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: exclude archived tabs from every Ask AI tool"
```

**Known, deliberate boundary:** `get_removed_platform_flags` (lists `removed_platform_brands` rows, not review data) and `get_entry` (single-row lookup by id, not tab-scoped from the caller's perspective) are not touched by this task — a stale flag or a direct id lookup on an archived tab is low-impact trivia, not the "model asserts an archived tab doesn't exist" or "returns an archived tab's data as current" hallucination risk the other 7 tools carry. Left out of scope deliberately; note it in Task 10's task-history entry rather than expanding this task.

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npm test` then `npm run build`
Expected: full suite passes (existing count plus the new tests added across Tasks 2, 3, 4), build succeeds with no TypeScript errors.

- [ ] **Step 2: Grep for any remaining reference to the retired hard-delete path**

Run: `grep -rn "deleteCustomTab\|showDeleteTabModal\|unregisterDynamicTab" src/pages/BrandGroup.tsx`
Expected: no results.

- [ ] **Step 3: Verify Overview/Score Summary/exports inherit the exclusion for free**

Run: `grep -rln "OPERATIONAL_TABS" src/pages/Overview.tsx src/pages/ScoreSummary.tsx src/lib/brandExport.ts src/lib/scoreSummaryExport.ts`

For each file that does **not** appear in the result, read it and confirm how it enumerates tabs — if it has its own independent tab-enumeration path (the same drift class Task 219 found with `TAB_ICONS`), that file needs its own explicit `isTabArchived`-based filter added as a follow-up fix in this same task, not deferred.

- [ ] **Step 4: Live verification**

Using a throwaway dynamic tab and one real, low-traffic hardcoded tab — not a high-traffic hardcoded tab like Rooster Partners, given archiving hides real data:

1. Archive GRG - Gulf Recovery Group (14 entries) with a reason via the pencil area's new Archive button. Confirm it vanishes from the Sidebar, Overview, and Score Summary immediately, with no reload.
2. Navigate directly to `/brands/gulf-recovery-group`. Confirm the "This Brand Tab has been archived" message renders instead of the table.
3. Open the Log page's "deletes" tab. Confirm the new "Archived Brand Tabs" section shows the archive event with its reason. Click Unarchive, confirm it. Confirm GRG reappears in the Sidebar/Overview/Score Summary with no reload, and that navigating to its URL now shows its real data again.
4. Create a throwaway dynamic tab (e.g. "Archive Verify Tab", TP only, no entries needed). Archive it with a reason via the same button. Confirm the same reach as steps 1-2.
5. While it's still archived, try creating a new tab named exactly "Archive Verify Tab" via "+ Add Brand Tab". Confirm it's rejected with the new collision message naming the archived state.
6. Unarchive "Archive Verify Tab" from the Log page. Confirm it reappears.
7. Clean up "Archive Verify Tab" via a manual SQL delete in the Supabase SQL editor (`delete from custom_tabs where name = 'Archive Verify Tab';` — there is no in-app way to remove it anymore, per this plan's accepted trade-off) — first confirming via `select` that it has zero rows in `entries`.
8. Ask AI: ask "what brand tabs exist?" and confirm the currently-archived-during-testing tab (if still archived at the time of this check) doesn't appear — skip this step if step 6 above already unarchived everything before reaching here. **This step alone doesn't require a fresh Ask AI deploy** — `runTool`'s dispatch logic can be exercised directly via a local Deno script or by trusting Task 9's own test suite; a live chat-widget check additionally requires the pending `supabase functions deploy ai-assistant` step, which stays documented as pending (see Global Constraints).

- [ ] **Step 5: Update `docs/task-history.md`**

Append an entry documenting this task per this project's standing PMS/task-history workflow — summarize what shipped, the migration applied (or still pending, if `supabase db push` wasn't run live in Task 1), the two Edge Function deploys that remain pending (`generate-weekly-schedule`, already pending before this task; `ai-assistant`, code changed in this task, deploy pending), and the live verification performed in Step 4 — including the result of Step 3's Overview/Score Summary/exports check (fixed in-task if any drift was found, or confirmed clean).
