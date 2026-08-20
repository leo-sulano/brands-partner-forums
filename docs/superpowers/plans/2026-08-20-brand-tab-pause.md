# Brand Tab Pause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin pause a whole Brand Tab from the existing Edit Brand Tab modal so it drops out of every cross-dashboard aggregation surface (Overview, Score Summary, Schedule Planner + its weekly cron/PMS push, Ask AI) while staying fully visible and usable on its own page and in the Sidebar.

**Architecture:** A new `paused_tabs` table (current-state-only, no history) backs a new Deno-safe `src/lib/pausedTabRegistry.ts` module. Unlike the existing Brand Tab Archive feature, this module deliberately does NOT splice tabs out of `OPERATIONAL_TABS` — it instead exposes `getActiveOperationalTabs()`, which every aggregation surface (Overview, Score Summary, Schedule Planner, the weekly cron) switches to in place of `OPERATIONAL_TABS`, while the Sidebar/BrandGroup/entry modals keep reading the full unfiltered list. Ask AI's `tools.ts` gets its own parallel exclusion set, mirroring the Archive feature's existing pattern exactly, since it never reads `OPERATIONAL_TABS`.

**Tech Stack:** Vite 6, React 19, TypeScript, Tailwind v4, Supabase (Postgres + Deno Edge Functions), Vitest, Deno test.

**Spec:** `docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md`

## Global Constraints

- Pause is whole-tab only (hardcoded or dynamic), never per-brand-within-a-tab.
- Admin-only (`isAdmin`), not approved-only — stricter than every other tab-management action in this feature area.
- No required reason, no confirmation modal, no audit/history log — current state only.
- The toggle lives inside the existing `EditBrandTabModal.tsx` as a Status select, visible only when the current user is an admin.
- A paused tab stays fully visible/clickable in the Sidebar (marked "Paused") and its own `BrandGroup.tsx` page, tab-switcher dropdown, and both entry-creation/edit modals' tab pickers are all left unfiltered on purpose.
- A paused tab is excluded from: Overview, Score Summary, Schedule Planner (dropdown, landing-grid preview, agent-options fetch, weekly cron + PMS push), and Ask AI's `tools.ts`.
- Reuse the existing `tab-platforms-changed` window event for live updates — do not invent a new event name.
- `src/lib/pausedTabRegistry.ts` must stay Deno-safe (no React/npm imports, no I/O) since `generate-weekly-schedule` imports it directly.
- Deploying `ai-assistant` and `generate-weekly-schedule` stays a documented pending manual step, per this project's established practice — do not run those deploys as part of this plan.

---

## Task 1: `paused_tabs` migration

**Files:**
- Create: `supabase/migrations/20260820120000_add_paused_tabs.sql`

**Interfaces:**
- Produces: table `public.paused_tabs (tab text primary key, paused_by_email text not null, paused_at timestamptz not null default now())`, readable by `is_approved()`, insertable/deletable by `is_admin()` only, no update policy.

- [ ] **Step 1: Write the migration file**

```sql
-- Brand Tab Pause (lightweight, reversible aggregation exclusion)
-- (docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md): a
-- current-state-only table -- a row's mere presence means that tab is
-- currently paused. Deliberately NOT shaped like tab_archive_log (no
-- reason, no restored_at/history) -- this is a quick, reversible toggle,
-- not an audited event. No UPDATE policy: a status change is always an
-- insert (pause) or a delete (unpause), never an update to an existing row.
create table public.paused_tabs (
  tab             text primary key,
  paused_by_email text not null,
  paused_at       timestamptz not null default now()
);

alter table public.paused_tabs enable row level security;

-- Read access is is_approved() (not is_admin()) because every consuming
-- surface -- the Sidebar badge, Overview/Score Summary/Schedule Planner
-- filtering -- is reached by any approved user, not just admins. Only the
-- toggle itself (insert/delete) is admin-gated, matching this feature's
-- "admin-only" decision -- stricter than every other tab-management policy
-- in this project (tab_hidden_platforms, tab_toolbar_filters, custom_tabs,
-- tab_archive_log all gate writes behind is_approved()).
create policy "approved users can read paused_tabs"
  on public.paused_tabs for select using (public.is_approved());
create policy "admins can insert paused_tabs"
  on public.paused_tabs for insert with check (public.is_admin());
create policy "admins can delete paused_tabs"
  on public.paused_tabs for delete using (public.is_admin());
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: migration applies cleanly with no errors. If no Supabase CLI link exists in this checkout, apply the same SQL manually via the Supabase SQL Editor instead, per this project's established fallback (see `docs/superpowers/specs/2026-08-19-brand-tab-archive-design.md`'s own precedent) — note which path was used when reporting this task done.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260820120000_add_paused_tabs.sql
git commit -m "feat: add paused_tabs table for Brand Tab Pause"
```

---

## Task 2: `src/lib/pausedTabRegistry.ts`

**Files:**
- Create: `src/lib/pausedTabRegistry.ts`
- Create: `src/lib/pausedTabRegistry.test.ts`

**Interfaces:**
- Consumes: `OPERATIONAL_TABS` from `./tabs.ts`.
- Produces: `pauseTabLocally(tab: string): void`, `unpauseTabLocally(tab: string): void`, `applyPausedTabs(rows: { tab: string }[]): void`, `resetPausedTabs(): void`, `isTabPaused(tab: string): boolean`, `getActiveOperationalTabs(): string[]` — every later task in this plan imports one or more of these.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/pausedTabRegistry.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { OPERATIONAL_TABS } from './tabs';
import {
  pauseTabLocally, unpauseTabLocally, applyPausedTabs, resetPausedTabs, isTabPaused,
  getActiveOperationalTabs,
} from './pausedTabRegistry';

describe('pausedTabRegistry', () => {
  afterEach(() => {
    resetPausedTabs();
  });

  it('pauseTabLocally marks a tab paused without removing it from OPERATIONAL_TABS', () => {
    expect(OPERATIONAL_TABS).toContain('Hanan');
    pauseTabLocally('Hanan');
    expect(OPERATIONAL_TABS).toContain('Hanan');
    expect(isTabPaused('Hanan')).toBe(true);
  });

  it('unpauseTabLocally clears paused state', () => {
    pauseTabLocally('Hanan');
    unpauseTabLocally('Hanan');
    expect(isTabPaused('Hanan')).toBe(false);
  });

  it('applyPausedTabs pauses every row in the list', () => {
    applyPausedTabs([{ tab: 'Hanan' }, { tab: 'Wizard of Odds' }]);
    expect(isTabPaused('Hanan')).toBe(true);
    expect(isTabPaused('Wizard of Odds')).toBe(true);
  });

  it('resetPausedTabs unpauses everything', () => {
    pauseTabLocally('Hanan');
    pauseTabLocally('Wizard of Odds');
    resetPausedTabs();
    expect(isTabPaused('Hanan')).toBe(false);
    expect(isTabPaused('Wizard of Odds')).toBe(false);
  });

  it('getActiveOperationalTabs excludes only paused tabs, leaving OPERATIONAL_TABS itself untouched', () => {
    pauseTabLocally('Hanan');
    const active = getActiveOperationalTabs();
    expect(active).not.toContain('Hanan');
    expect(active).toContain('Wizard of Odds');
    expect(active.length).toBe(OPERATIONAL_TABS.length - 1);
    expect(OPERATIONAL_TABS).toContain('Hanan');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/pausedTabRegistry.test.ts`
Expected: FAIL with "Cannot find module './pausedTabRegistry'" (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/pausedTabRegistry.ts
// Brand Tab Pause (lightweight, reversible aggregation exclusion)
// (docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md): unlike
// archivedTabRegistry.ts, pausing a tab deliberately does NOT splice it out
// of OPERATIONAL_TABS -- a paused tab must keep showing in the Sidebar
// (marked "Paused") and keep working normally on its own BrandGroup.tsx
// page. Instead, this module tracks paused state in its own Set and
// exposes getActiveOperationalTabs() as the one thing every cross-dashboard
// aggregation surface (Overview, Score Summary, Schedule Planner, the
// weekly cron) switches to in place of reading OPERATIONAL_TABS directly.
//
// Same Deno-safety constraints as archivedTabRegistry.ts/dynamicTabRegistry.ts
// (no React/npm imports, no I/O) -- this module is also imported by the
// generate-weekly-schedule Edge Function.
import { OPERATIONAL_TABS } from './tabs.ts';

const pausedTabNames = new Set<string>();

// Own small private copy of the notify helper -- same event name
// archivedTabRegistry.ts/dynamicTabRegistry.ts/tab-configs.ts already use,
// so Sidebar.tsx's and Topbar.tsx's one listener each picks up a
// pause/unpause immediately with no new listener code.
function notifyTabPlatformsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('tab-platforms-changed'));
  }
}

export function pauseTabLocally(tab: string): void {
  pausedTabNames.add(tab);
  notifyTabPlatformsChanged();
}

export function unpauseTabLocally(tab: string): void {
  pausedTabNames.delete(tab);
  notifyTabPlatformsChanged();
}

export function applyPausedTabs(rows: { tab: string }[]): void {
  for (const row of rows) pauseTabLocally(row.tab);
}

// Needed by generate-weekly-schedule, whose Edge isolate is reused across
// invocations -- without this, a tab unpaused since the last invocation
// would incorrectly stay excluded from that run's generation loop forever
// (the same isolate-state bug class resetDynamicTabs/resetArchivedTabs
// already guard against).
export function resetPausedTabs(): void {
  for (const tab of Array.from(pausedTabNames)) unpauseTabLocally(tab);
}

export function isTabPaused(tab: string): boolean {
  return pausedTabNames.has(tab);
}

// The one export every cross-dashboard aggregation surface switches to in
// place of reading OPERATIONAL_TABS directly. A paused tab's own page, its
// tab-switcher dropdown, and both entry-creation/edit modals deliberately
// keep reading OPERATIONAL_TABS unfiltered instead (see the design spec's
// "Deliberately NOT filtered" section).
export function getActiveOperationalTabs(): string[] {
  return OPERATIONAL_TABS.filter((t) => !isTabPaused(t));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/pausedTabRegistry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pausedTabRegistry.ts src/lib/pausedTabRegistry.test.ts
git commit -m "feat: add pausedTabRegistry module for Brand Tab Pause"
```

---

## Task 3: `queries.ts` — `pauseTab` / `unpauseTab` / `fetchPausedTabs`

**Files:**
- Modify: `src/lib/queries.ts` (insert after `fetchRecentTabArchives`, currently ending around line 1701, before `fetchHiddenTabPlatforms`)
- Modify: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `supabase` singleton and `currentUserEmail()` (both already defined earlier in `queries.ts`); `SupabaseClient` type (already imported at the top of the file).
- Produces: `pauseTab(tab: string): Promise<void>`, `unpauseTab(tab: string): Promise<void>`, `fetchPausedTabs(client?: SupabaseClient): Promise<PausedTabRow[]>` where `interface PausedTabRow { tab: string }` — consumed by Task 4 (`AuthContext.tsx`), Task 5 (`EditBrandTabModal.tsx`), and Task 10 (`generate-weekly-schedule`).

- [ ] **Step 1: Write the failing tests**

Add these imports to the existing `import { ... } from './queries';` block in `src/lib/queries.test.ts` (alongside the existing `archiveTab, unarchiveTab, fetchArchivedTabs, fetchRecentTabArchives,` line):

```typescript
  pauseTab,
  unpauseTab,
  fetchPausedTabs,
```

Then add this new `describe` block at the end of `src/lib/queries.test.ts`:

```typescript
describe('pauseTab / unpauseTab / fetchPausedTabs', () => {
  it('pauseTab inserts a row with the current actor email', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ insert });
    await pauseTab('Rooster Partners');
    expect(insert).toHaveBeenCalledWith({
      tab: 'Rooster Partners',
      paused_by_email: '',
    });
  });

  it('pauseTab silently no-ops when the tab is already paused (23505)', async () => {
    const insert = vi.fn().mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    singletonFrom.mockReturnValue({ insert });
    await expect(pauseTab('Rooster Partners')).resolves.toBeUndefined();
  });

  it('pauseTab throws on a real (non-duplicate) error', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
    singletonFrom.mockReturnValue({ insert });
    await expect(pauseTab('Rooster Partners')).rejects.toThrow('permission denied');
  });

  it('unpauseTab deletes the row for that tab', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn().mockReturnValue({ eq });
    singletonFrom.mockReturnValue({ delete: del });
    await unpauseTab('Rooster Partners');
    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('tab', 'Rooster Partners');
  });

  it('fetchPausedTabs returns all rows', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ tab: 'Rooster Partners' }], error: null });
    singletonFrom.mockReturnValue({ select });
    const rows = await fetchPausedTabs();
    expect(select).toHaveBeenCalledWith('tab');
    expect(rows).toEqual([{ tab: 'Rooster Partners' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts -t "pauseTab"`
Expected: FAIL with "pauseTab is not a function" / import error.

- [ ] **Step 3: Write the implementation**

Insert this block into `src/lib/queries.ts` immediately after `fetchRecentTabArchives`'s closing `}` (currently line 1701) and before `fetchHiddenTabPlatforms`:

```typescript
// Brand Tab Pause (docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md):
// a lightweight, reversible, current-state-only toggle -- deliberately
// distinct from archiveTab/unarchiveTab above (no reason, no history, no
// UPDATE policy on paused_tabs -- see that table's migration comment).
export async function pauseTab(tab: string): Promise<void> {
  const { error } = await supabase
    .from('paused_tabs')
    .insert({ tab, paused_by_email: (await currentUserEmail()) ?? '' });
  if (error && error.code !== '23505') throw error;
}

export async function unpauseTab(tab: string): Promise<void> {
  const { error } = await supabase
    .from('paused_tabs')
    .delete()
    .eq('tab', tab);
  if (error) throw error;
}

export interface PausedTabRow {
  tab: string;
}

export async function fetchPausedTabs(client: SupabaseClient = supabase): Promise<PausedTabRow[]> {
  const { data, error } = await client
    .from('paused_tabs')
    .select('tab');
  if (error) throw error;
  return (data ?? []) as PausedTabRow[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts -t "pauseTab"`
Expected: PASS (5 tests). Also run the full file to confirm no regressions: `npx vitest run src/lib/queries.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add pauseTab/unpauseTab/fetchPausedTabs to queries.ts"
```

---

## Task 4: `AuthContext.tsx` bootstrap wiring

**Files:**
- Modify: `src/contexts/AuthContext.tsx`

**Interfaces:**
- Consumes: `fetchPausedTabs` (Task 3, `../lib/queries`), `applyPausedTabs` (Task 2, `../lib/pausedTabRegistry`).
- Produces: nothing new consumed by later tasks — this just ensures `pausedTabNames` is populated at app bootstrap, matching how `applyArchivedTabs`/`registerDynamicTabs` already work. No dedicated unit test exists for this bootstrap wiring today (same as the Archive feature's own bootstrap change) — verified via the full build + live verification in Task 12.

- [ ] **Step 1: Update imports**

In `src/contexts/AuthContext.tsx`, change:

```typescript
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchToolbarFilters, fetchArchivedTabs } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
import { registerHiddenTabPlatforms, registerToolbarFilters } from '../lib/tab-configs';
import { applyArchivedTabs } from '../lib/archivedTabRegistry';
```

to:

```typescript
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchToolbarFilters, fetchArchivedTabs, fetchPausedTabs } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
import { registerHiddenTabPlatforms, registerToolbarFilters } from '../lib/tab-configs';
import { applyArchivedTabs } from '../lib/archivedTabRegistry';
import { applyPausedTabs } from '../lib/pausedTabRegistry';
```

- [ ] **Step 2: Add the parallel bootstrap fetch and apply it**

Change:

```typescript
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

to:

```typescript
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
          fetchPausedTabs().catch((err) => {
            console.error('Failed to fetch paused tabs:', err);
            return [];
          }),
        ]).then(([p, customTabs, hiddenPlatforms, toolbarFilters, archivedTabs, pausedTabs]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          registerHiddenTabPlatforms(hiddenPlatforms);
          registerToolbarFilters(toolbarFilters);
          // Must run after registerDynamicTabs: a dynamic tab archived since
          // its custom_tabs row was created gets registered (added back to
          // OPERATIONAL_TABS) and then immediately archived again (removed)
          // in that order -- reversed, it would incorrectly reappear.
          applyArchivedTabs(archivedTabs);
          // Order relative to applyArchivedTabs doesn't matter here (unlike
          // dynamic tabs vs. archive above): pausing never touches
          // OPERATIONAL_TABS membership, only pausedTabRegistry's own set.
          applyPausedTabs(pausedTabs);
          setProfile(p);
          setLoading(false);
        });
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds cleanly with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "feat: apply paused tabs during AuthContext bootstrap"
```

---

## Task 5: `EditBrandTabModal.tsx` — Status select

**Files:**
- Modify: `src/components/EditBrandTabModal.tsx`

**Interfaces:**
- Consumes: `useAuth` (`../contexts/AuthContext`), `isTabPaused`/`pauseTabLocally`/`unpauseTabLocally` (Task 2, `../lib/pausedTabRegistry`), `pauseTab`/`unpauseTab` (Task 3, `../lib/queries`).
- Produces: nothing new consumed elsewhere — this is the feature's admin-facing entry point. No dedicated component test exists for this modal today (same precedent as the rest of this modal's own platform/filter logic) — verified via build + live verification in Task 12.

- [ ] **Step 1: Update imports**

Change:

```typescript
import { updateCustomTabPlatforms, setTabPlatformHidden, renameCustomTab, setToolbarFilters } from '../lib/queries';
import {
  PLATFORM_LIST, registerDynamicTabs, renameDynamicTab, isDynamicTab, type DynamicTabPlatform,
} from '../lib/dynamicTabRegistry';
import {
  getTabPlatforms, getTabPlatformsUnfiltered,
  registerHiddenTabPlatforms, unregisterHiddenTabPlatform,
  getEnabledToolbarFilters, registerToolbarFilters,
  TOOLBAR_FILTER_LIST, type ToolbarFilterKey,
} from '../lib/tab-configs';
import { validateNewTabName } from '../lib/tabValidation';
```

to:

```typescript
import { updateCustomTabPlatforms, setTabPlatformHidden, renameCustomTab, setToolbarFilters, pauseTab, unpauseTab } from '../lib/queries';
import {
  PLATFORM_LIST, registerDynamicTabs, renameDynamicTab, isDynamicTab, type DynamicTabPlatform,
} from '../lib/dynamicTabRegistry';
import {
  getTabPlatforms, getTabPlatformsUnfiltered,
  registerHiddenTabPlatforms, unregisterHiddenTabPlatform,
  getEnabledToolbarFilters, registerToolbarFilters,
  TOOLBAR_FILTER_LIST, type ToolbarFilterKey,
} from '../lib/tab-configs';
import { validateNewTabName } from '../lib/tabValidation';
import { isTabPaused, pauseTabLocally, unpauseTabLocally } from '../lib/pausedTabRegistry';
import { useAuth } from '../contexts/AuthContext';
```

- [ ] **Step 2: Add admin check and Status state**

Change:

```typescript
export default function EditBrandTabModal({ tabName, onUpdated, onClose }: Props) {
  const dynamic = isDynamicTab(tabName);
```

to:

```typescript
export default function EditBrandTabModal({ tabName, onUpdated, onClose }: Props) {
  const { isAdmin } = useAuth();
  const dynamic = isDynamicTab(tabName);
  // Captured once at modal-open time: what to diff the Status select against
  // on submit. Only pauseTab/unpauseTab actually change this feature's real
  // state, so re-reading isTabPaused(tabName) later in the same render cycle
  // would be redundant, not more correct.
  const initialPaused = isTabPaused(tabName);
```

Then, alongside the existing `const [filters, setFilters] = useState<ToolbarFilterKey[]>(...)` state declaration, add:

```typescript
  const [status, setStatus] = useState<'active' | 'paused'>(initialPaused ? 'paused' : 'active');
```

- [ ] **Step 3: Wire the pause/unpause write into `handleSubmit`**

Change the end of `handleSubmit` from:

```typescript
      await setToolbarFilters(currentTabName, filters);
      registerToolbarFilters([{ tab: currentTabName, enabled_filters: filters }]);
      onUpdated(isRename ? currentTabName : undefined);
```

to:

```typescript
      await setToolbarFilters(currentTabName, filters);
      registerToolbarFilters([{ tab: currentTabName, enabled_filters: filters }]);
      if (isAdmin) {
        const wantsPaused = status === 'paused';
        if (wantsPaused && !initialPaused) {
          await pauseTab(currentTabName);
          pauseTabLocally(currentTabName);
        } else if (!wantsPaused && initialPaused) {
          await unpauseTab(currentTabName);
          unpauseTabLocally(currentTabName);
        }
      }
      onUpdated(isRename ? currentTabName : undefined);
```

- [ ] **Step 4: Add the Status field to the modal's JSX**

Change:

```typescript
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Toolbar Filters</label>
```

to:

```typescript
          {isAdmin && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'paused')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Paused tabs stay visible and fully usable here, but are excluded from Overview, Score Summary, Schedule Planner, and Ask AI.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Toolbar Filters</label>
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: builds cleanly with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/EditBrandTabModal.tsx
git commit -m "feat: add admin-only Status (pause) field to Edit Brand Tab modal"
```

---

## Task 6: Sidebar "Paused" badge

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `isTabPaused` (Task 2, `../lib/pausedTabRegistry`).

- [ ] **Step 1: Add the import**

Change:

```typescript
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
import { getTabPlatforms, registerToolbarFilters, type ToolbarFilterKey } from '../lib/tab-configs';
```

to:

```typescript
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
import { getTabPlatforms, registerToolbarFilters, type ToolbarFilterKey } from '../lib/tab-configs';
import { isTabPaused } from '../lib/pausedTabRegistry';
```

- [ ] **Step 2: Render the badge**

Change:

```typescript
                      <Icon className="size-4 shrink-0" />
                      {!isCollapsed && <span className="truncate flex-1">{tabDisplayName(tab)}</span>}
                      {!isCollapsed && (
                        <span className="flex items-center gap-0.5 shrink-0">
```

to:

```typescript
                      <Icon className="size-4 shrink-0" />
                      {!isCollapsed && <span className="truncate flex-1">{tabDisplayName(tab)}</span>}
                      {!isCollapsed && isTabPaused(tab) && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-400/20 text-amber-300">
                          Paused
                        </span>
                      )}
                      {!isCollapsed && (
                        <span className="flex items-center gap-0.5 shrink-0">
```

This reads live state on every render, and the surrounding `<div key={tabsVersion} className="contents">` wrapper (already present) already forces a full remount of this list on the existing `tab-platforms-changed` event — the same event `pauseTabLocally`/`unpauseTabLocally` (Task 2) fire — so the badge appears/disappears immediately with no extra listener code.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds cleanly with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: show a Paused badge in the Sidebar for paused Brand Tabs"
```

---

## Task 7: Topbar "Paused" badge

**Files:**
- Modify: `src/components/Topbar.tsx`

**Interfaces:**
- Consumes: `isTabPaused` (Task 2, `../lib/pausedTabRegistry`).

- [ ] **Step 1: Add the import**

Change:

```typescript
import { slugToTab, tabDisplayName } from '../lib/tabs';
import { getTabPlatforms } from '../lib/tab-configs';
```

to:

```typescript
import { slugToTab, tabDisplayName } from '../lib/tabs';
import { getTabPlatforms } from '../lib/tab-configs';
import { isTabPaused } from '../lib/pausedTabRegistry';
```

- [ ] **Step 2: Compute paused state and render the badge**

Change:

```typescript
  const platforms = brandTab ? getTabPlatforms(brandTab) : [];
```

to:

```typescript
  const platforms = brandTab ? getTabPlatforms(brandTab) : [];
  const paused = brandTab ? isTabPaused(brandTab) : false;
```

Then change:

```typescript
          <h1 className="hidden sm:block text-base font-semibold text-slate-800">{title}</h1>
          {platforms.length > 0 && (
            <div className="flex items-center gap-1">
              {platforms.map((p) => (
                <span key={p} className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${PLATFORM_BADGE_CLS[p]}`}>
                  <img src={PLATFORM_FAVICON[p]} alt={p} className="size-3" />
                  {p.toUpperCase()}
                </span>
              ))}
            </div>
          )}
```

to:

```typescript
          <h1 className="hidden sm:block text-base font-semibold text-slate-800">{title}</h1>
          {platforms.length > 0 && (
            <div className="flex items-center gap-1">
              {platforms.map((p) => (
                <span key={p} className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${PLATFORM_BADGE_CLS[p]}`}>
                  <img src={PLATFORM_FAVICON[p]} alt={p} className="size-3" />
                  {p.toUpperCase()}
                </span>
              ))}
            </div>
          )}
          {paused && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200">
              Paused
            </span>
          )}
```

This component already listens for `tab-platforms-changed` (existing `_tabsVersion` state/effect) and re-renders on it, so `paused` recomputes immediately after a pause/unpause with no further changes needed.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds cleanly with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Topbar.tsx
git commit -m "feat: show a Paused badge in the Topbar for a paused Brand Tab's own page"
```

---

## Task 8: `Overview.tsx` and `ScoreSummary.tsx` — switch to `getActiveOperationalTabs()`

**Files:**
- Modify: `src/pages/Overview.tsx`
- Modify: `src/pages/ScoreSummary.tsx`

**Interfaces:**
- Consumes: `getActiveOperationalTabs` (Task 2, `../lib/pausedTabRegistry`).

- [ ] **Step 1: `Overview.tsx` — update the import**

Change:

```typescript
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
```

to:

```typescript
import { tabToSlug, tabDisplayName } from '../lib/tabs';
import { getActiveOperationalTabs } from '../lib/pausedTabRegistry';
```

(`OPERATIONAL_TABS` has no other use in this file besides the two call sites below, so it's dropped from this import entirely.)

- [ ] **Step 2: `Overview.tsx` — switch both fetch loops**

Change (tab-level KPI loop):

```typescript
      const tabResults = (await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchTabKpis(
```

to:

```typescript
      const tabResults = (await Promise.all(
        getActiveOperationalTabs().map((tab) =>
          fetchTabKpis(
```

Change (brand-level KPI loop):

```typescript
      const groups = (await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchBrandKpis(
```

to:

```typescript
      const groups = (await Promise.all(
        getActiveOperationalTabs().map((tab) =>
          fetchBrandKpis(
```

- [ ] **Step 3: `ScoreSummary.tsx` — update the import and fetch call**

Change:

```typescript
import { fetchAllEntries, fetchRemovedPlatformBrands } from '../lib/queries';
import { buildRemovedPlatformBrandSet } from '../lib/removedPlatformBrands';
import { OPERATIONAL_TABS } from '../lib/tabs';
import type { Entry } from '../types/entry';
```

to:

```typescript
import { fetchAllEntries, fetchRemovedPlatformBrands } from '../lib/queries';
import { buildRemovedPlatformBrandSet } from '../lib/removedPlatformBrands';
import { getActiveOperationalTabs } from '../lib/pausedTabRegistry';
import type { Entry } from '../types/entry';
```

Change:

```typescript
    Promise.all([fetchAllEntries(OPERATIONAL_TABS), fetchRemovedPlatformBrands()])
```

to:

```typescript
    Promise.all([fetchAllEntries(getActiveOperationalTabs()), fetchRemovedPlatformBrands()])
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: builds cleanly with no TypeScript errors, and no unused-import warnings for `OPERATIONAL_TABS` in either file.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Overview.tsx src/pages/ScoreSummary.tsx
git commit -m "feat: exclude paused tabs from Overview and Score Summary aggregation"
```

---

## Task 9: `SchedulePlanner.tsx` — switch to `getActiveOperationalTabs()`

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- Consumes: `getActiveOperationalTabs` (Task 2, `../lib/pausedTabRegistry`).

- [ ] **Step 1: Update the import**

Change:

```typescript
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
```

to:

```typescript
import { tabDisplayName } from '../lib/tabs';
import { getActiveOperationalTabs } from '../lib/pausedTabRegistry';
```

- [ ] **Step 2: Switch the `TAB_OPTS` dropdown**

Change:

```typescript
  // Recomputed on every render (deliberately not memoized, and deliberately
  // not hoisted to module scope): OPERATIONAL_TABS is mutated in place when a
  // dynamic tab is created/deleted mid-session (src/lib/dynamicTabRegistry.ts),
  // and this is a long-lived page — a module-scope or useMemo([]) snapshot
  // would leave a newly-created tab missing from this dropdown until reload.
  const TAB_OPTS = OPERATIONAL_TABS.map((t) => ({ value: t, label: tabDisplayName(t) }));
```

to:

```typescript
  // Recomputed on every render (deliberately not memoized, and deliberately
  // not hoisted to module scope): OPERATIONAL_TABS is mutated in place when a
  // dynamic tab is created/deleted mid-session (src/lib/dynamicTabRegistry.ts),
  // and this is a long-lived page — a module-scope or useMemo([]) snapshot
  // would leave a newly-created tab missing from this dropdown until reload.
  // getActiveOperationalTabs() additionally drops any currently-paused tab —
  // a paused tab can't be selected to view or generate its schedule.
  const TAB_OPTS = getActiveOperationalTabs().map((t) => ({ value: t, label: tabDisplayName(t) }));
```

- [ ] **Step 3: Switch the `sessionStorage` restore filter**

Change:

```typescript
      return raw.split(',').filter((t) => (OPERATIONAL_TABS as string[]).includes(t));
```

to:

```typescript
      return raw.split(',').filter((t) => getActiveOperationalTabs().includes(t));
```

- [ ] **Step 4: Switch the agent-options fetch loop**

Change:

```typescript
      const agents = new Set<string>();
      await Promise.all(
        OPERATIONAL_TABS.map(async (t) => {
```

to:

```typescript
      const agents = new Set<string>();
      await Promise.all(
        getActiveOperationalTabs().map(async (t) => {
```

- [ ] **Step 5: Switch the preview-entries fetch loop**

Change:

```typescript
      const weeks = previewWeekKey ? previewWeekKey.split(',') : [];
      const entries = await Promise.all(
        OPERATIONAL_TABS.map(async (t) => {
```

to:

```typescript
      const weeks = previewWeekKey ? previewWeekKey.split(',') : [];
      const entries = await Promise.all(
        getActiveOperationalTabs().map(async (t) => {
```

- [ ] **Step 6: Switch the landing-grid preview cards**

Change:

```typescript
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {OPERATIONAL_TABS.map((t) => {
```

to:

```typescript
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {getActiveOperationalTabs().map((t) => {
```

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: builds cleanly with no TypeScript errors, no unused-import warning for `OPERATIONAL_TABS`.

- [ ] **Step 8: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: exclude paused tabs from Schedule Planner (dropdown, grid, previews)"
```

---

## Task 10: `generate-weekly-schedule` weekly cron

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts`

**Interfaces:**
- Consumes: `fetchPausedTabs` (Task 3, `../../../src/lib/queries.ts`), `applyPausedTabs`/`resetPausedTabs`/`getActiveOperationalTabs` (Task 2, `../../../src/lib/pausedTabRegistry.ts`).

- [ ] **Step 1: Update imports**

Change:

```typescript
import { OPERATIONAL_TABS, tabDisplayName } from '../../../src/lib/tabs.ts';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND, getTabPlatforms, registerHiddenTabPlatforms, resetHiddenTabPlatforms } from '../../../src/lib/tab-configs.ts';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, fetchBrandAgentAssignments, invalidateTabCache, fetchCustomTabs, fetchHiddenTabPlatforms, fetchArchivedTabs } from '../../../src/lib/queries.ts';
```

to:

```typescript
import { tabDisplayName } from '../../../src/lib/tabs.ts';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND, getTabPlatforms, registerHiddenTabPlatforms, resetHiddenTabPlatforms } from '../../../src/lib/tab-configs.ts';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, fetchBrandAgentAssignments, invalidateTabCache, fetchCustomTabs, fetchHiddenTabPlatforms, fetchArchivedTabs, fetchPausedTabs } from '../../../src/lib/queries.ts';
```

Then add, alongside the existing `import { applyArchivedTabs, resetArchivedTabs } from '../../../src/lib/archivedTabRegistry.ts';` line:

```typescript
import { applyPausedTabs, resetPausedTabs, getActiveOperationalTabs } from '../../../src/lib/pausedTabRegistry.ts';
```

- [ ] **Step 2: Reset and apply paused tabs each invocation**

Change:

```typescript
  const archivedTabs = await fetchArchivedTabs(client).catch((err) => {
    console.error('[generate-weekly-schedule] failed to fetch archived tabs:', err);
    return [];
  });
  resetArchivedTabs();
  applyArchivedTabs(archivedTabs);
```

to:

```typescript
  const archivedTabs = await fetchArchivedTabs(client).catch((err) => {
    console.error('[generate-weekly-schedule] failed to fetch archived tabs:', err);
    return [];
  });
  resetArchivedTabs();
  applyArchivedTabs(archivedTabs);
  // Same reset-then-apply shape as the archived-tab registry immediately
  // above, same reason: this Edge isolate may be warm from a prior
  // invocation, and applyPausedTabs only ever adds to pausedTabRegistry's
  // in-memory set -- without the reset, a tab unpaused since the last
  // invocation would incorrectly stay excluded forever in a reused isolate.
  const pausedTabs = await fetchPausedTabs(client).catch((err) => {
    console.error('[generate-weekly-schedule] failed to fetch paused tabs:', err);
    return [];
  });
  resetPausedTabs();
  applyPausedTabs(pausedTabs);
```

- [ ] **Step 3: Switch the per-tab generation loop**

Change:

```typescript
  const results = await generateAllTabs(OPERATIONAL_TABS, weekStart, client);
```

to:

```typescript
  const results = await generateAllTabs(getActiveOperationalTabs(), weekStart, client);
```

- [ ] **Step 4: Verify with Deno check**

Run: `deno check supabase/functions/generate-weekly-schedule/index.ts`
Expected: no type errors. (This function is not yet deployed — do not run `supabase functions deploy generate-weekly-schedule` as part of this task, per the Global Constraints.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts
git commit -m "feat: exclude paused tabs from the weekly schedule generation cron"
```

---

## Task 11: Ask AI (`ai-assistant/tools.ts`) exclusion

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
- Modify: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Produces: `buildPausedTabNameSet(rows: { tab: string }[]): Set<string>` (exported for the test file, mirroring `buildArchivedTabNameSet`).

- [ ] **Step 1: Write the failing tests**

Add `buildPausedTabNameSet` to the existing import block at the top of `supabase/functions/ai-assistant/tools_test.ts` (alongside `buildArchivedTabNameSet`):

```typescript
  buildArchivedTabNameSet,
  buildPausedTabNameSet,
```

Then add these tests, near the existing `buildArchivedTabNameSet`/`list_tabs excludes an archived tab`/`query_entries excludes rows from an archived tab` tests:

```typescript
Deno.test('buildPausedTabNameSet includes every row (current-state-only table)', () => {
  const set = buildPausedTabNameSet([{ tab: 'Rooster Partners' }]);
  assertEquals(set.has('Rooster Partners'), true);
  assertEquals(set.has('Hanan'), false);
});

Deno.test('list_tabs excludes a paused tab via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: {} },
      { id: '2', tab: 'Hanan', data: {} },
    ],
    tab_archive_log: [],
    paused_tabs: [{ tab: 'Hanan' }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'list_tabs', {});
  assertEquals(result.tabs, ['Rooster Partners']);
});

Deno.test('query_entries excludes rows from a paused tab via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: { Brand: 'Acme' } },
      { id: '2', tab: 'Hanan', data: { Brand: 'Beta' } },
    ],
    tab_archive_log: [],
    paused_tabs: [{ tab: 'Hanan' }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {});
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].tab, 'Rooster Partners');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd supabase/functions/ai-assistant && deno test --allow-env --allow-net`
Expected: FAIL — `buildPausedTabNameSet` is not exported / doesn't exist yet.

- [ ] **Step 3: Add `buildPausedTabNameSet` / `fetchPausedTabNameSet`**

In `supabase/functions/ai-assistant/tools.ts`, immediately after the existing `fetchArchivedTabNameSet` function (and its preceding comment block), add:

```typescript
// Paused-tab exclusion (Brand Tab Pause feature,
// docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md). Applied
// alongside archivedSet at the exact same 7 filter points archived-tab
// exclusion already covers: list_tabs, query_entries, get_score_summary,
// get_success_rate_by_field, get_schedule, get_paused_combos,
// get_review_texts. paused_tabs is current-state-only (no restored_at
// column) -- every row it returns is an active pause, unlike
// tab_archive_log which mixes active and historical rows.
export function buildPausedTabNameSet(rows: { tab: string }[]): Set<string> {
  return new Set(rows.map((r) => r.tab));
}

async function fetchPausedTabNameSet(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase.from('paused_tabs').select('tab');
  if (error) throw error;
  return buildPausedTabNameSet(data ?? []);
}
```

- [ ] **Step 4: Wire the exclusion into the 7 tool-dispatch sites**

In `runTool`, apply these 7 changes:

`list_tabs`:

```typescript
  if (name === 'list_tabs') {
    const q = supabase.from('entries').select('tab');
    const [{ data, error }, archivedSet, pausedSet] = await Promise.all([q, fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase)]);
    if (error) throw error;
    const tabs = [...new Set(((data ?? []) as any[]).map((r: any) => r.tab))].filter((t: string) => !archivedSet.has(t) && !pausedSet.has(t));
    return { tabs: tabs.sort() };
  }
```

`query_entries`:

```typescript
    let q = supabase.from('entries').select('id, tab, data, updated_at');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, archivedSet, pausedSet, assignmentRows] = await Promise.all([
      q,
      fetchArchivedTabNameSet(supabase),
      fetchPausedTabNameSet(supabase),
      fetchAgentAssignmentRows(supabase),
    ]);
    if (error) throw error;
    let rows: EntryRow[] = (data ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
```

`get_score_summary`:

```typescript
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data: rawData, error }, removedSet, archivedSet, pausedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const data = (rawData ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
```

`get_success_rate_by_field`:

```typescript
    let q = supabase.from('entries').select('id, tab, data, updated_at');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data: rawData, error }, removedSet, archivedSet, pausedSet, assignmentRows] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase), fetchAgentAssignmentRows(supabase),
    ]);
    if (error) throw error;
    const data = (rawData ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
```

`get_schedule`:

```typescript
    let q = supabase
      .from('brand_schedule')
      .select('tab, brand, platform, week_start, monday, tuesday, wednesday, thursday, friday');
    if (args?.tab) q = q.eq('tab', args.tab);
    if (args?.week_start) q = q.eq('week_start', args.week_start);
    const [{ data, error }, hiddenSet, restrictionMap, removedSet, archivedSet, pausedSet] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
      fetchRemovedPlatformBrandSet(supabase),
      fetchArchivedTabNameSet(supabase),
      fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((r: any) => !archivedSet.has(r.tab) && !pausedSet.has(r.tab));
```

`get_paused_combos`:

```typescript
    let q = supabase
      .from('brand_platform_pause')
      .select('tab, brand, platform, paused_week_start, reason');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, hiddenSet, restrictionMap, removedSet, archivedSet, pausedSet] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
      fetchRemovedPlatformBrandSet(supabase),
      fetchArchivedTabNameSet(supabase),
      fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((r: any) => !archivedSet.has(r.tab) && !pausedSet.has(r.tab));
```

`get_review_texts`:

```typescript
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    q = q.order('id').limit(1000);
    const [{ data, error }, removedSet, archivedSet, pausedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
```

Note: `get_paused_combos`'s own `paused` in its return key (`{ paused: filterHiddenOrRestricted(...) }`) refers to a brand+platform's scheduling pause (`brand_platform_pause` table) — an unrelated, pre-existing concept. Do not rename it; only the new `pausedSet`/`fetchPausedTabNameSet` (tab-level) is new here.

- [ ] **Step 5: Update tool descriptions**

In the tool schema list (the array before `runTool`), update the `list_tabs`, `query_entries`, `get_score_summary`, `get_success_rate_by_field`, `get_schedule`, `get_paused_combos`, and `get_review_texts` tool descriptions to mention pausing alongside archiving. For `list_tabs`, change:

```typescript
      description: 'List the distinct brand-group tabs available. An archived tab is silently ' +
        'excluded — if a user asks about a tab not in this list, say it may have been archived ' +
        'rather than concluding it never existed.',
```

to:

```typescript
      description: 'List the distinct brand-group tabs available. An archived or paused tab is ' +
        'silently excluded — if a user asks about a tab not in this list, say it may have been ' +
        'archived or paused rather than concluding it never existed.',
```

Apply the same "archived or paused" / "archived or paused rather than concluding it never existed" wording pattern to each of the other 6 tool descriptions wherever they currently say "archived" alone (search each of the 7 tool schema blocks for the word "archived" to find every spot).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd supabase/functions/ai-assistant && deno test --allow-env --allow-net`
Expected: PASS, including the 3 new tests, with no regressions in the existing archived-tab tests.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: exclude paused tabs from Ask AI tool results"
```

(Do not run `supabase functions deploy ai-assistant` as part of this task, per the Global Constraints — document it as a pending manual deploy step in the final task.)

---

## Task 12: Full verification and live check

**Files:** none (verification only)

- [ ] **Step 1: Run the full Vitest suite**

Run: `npm run test` (or `npx vitest run` if there is no dedicated `test` script — check `package.json` first)
Expected: all tests pass, including every test added in Tasks 2, 3.

- [ ] **Step 2: Run the full build**

Run: `npm run build`
Expected: builds cleanly with no TypeScript errors.

- [ ] **Step 3: Run the Ask AI Deno suite**

Run: `cd supabase/functions/ai-assistant && deno test --allow-env --allow-net`
Expected: all tests pass.

- [ ] **Step 4: Deno-check the weekly cron function**

Run: `deno check supabase/functions/generate-weekly-schedule/index.ts`
Expected: no type errors.

- [ ] **Step 5: Live verification (requires a real admin session against live Supabase data)**

Walk through the spec's own live-verification checklist:
1. As an admin, open a real, low-traffic hardcoded tab (e.g. "GRG - Gulf Recovery Group") and pause it via Edit Brand Tab's new Status field. Confirm the Sidebar shows a "Paused" badge immediately (no reload) while the tab stays clickable, and the Topbar shows the same badge next to the platform badges when viewing that tab.
2. Confirm the tab's own `BrandGroup.tsx` page still works fully — view, add, and edit an entry — while paused.
3. Navigate to Overview, Score Summary, and Schedule Planner; confirm the paused tab is absent from all three (KPI aggregates, tab dropdown/grid, landing-grid preview cards).
4. As a non-admin approved user, open the same tab's Edit Brand Tab modal; confirm no Status field is visible and the rest of the modal behaves identically to before this feature.
5. Unpause the tab; confirm it reappears in Overview/Score Summary/Schedule Planner and the Sidebar/Topbar badges disappear, all without a reload.

Record which of these were actually performed live vs. deferred (e.g. no live Supabase credentials available in this session) — follow this project's existing documentation convention (see `docs/task-history.md`'s prior entries) rather than claiming a live check that didn't happen.

- [ ] **Step 6: Update `docs/task-history.md`**

Append a new entry documenting this task, following the existing entries' format and level of detail (what shipped, what was deliberately left out of scope, what remains a pending manual deploy step — specifically: `supabase functions deploy ai-assistant` and the already-pending `generate-weekly-schedule` deploy, both required before the paused-tab exclusion in either is actually live).

- [ ] **Step 7: Commit**

```bash
git add docs/task-history.md
git commit -m "docs: record Brand Tab Pause task"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md` maps to a task above — data model (Task 1), registry mechanism (Task 2), `queries.ts` (Task 3), bootstrap (Task 4), UI toggle (Task 5), Sidebar/Topbar badges (Tasks 6-7), Overview/Score Summary/Schedule Planner reach (Tasks 8-9), the weekly cron (Task 10), Ask AI (Task 11), and the spec's own Testing section (Task 12).
- **Deliberately NOT filtered** surfaces (`BrandGroup.tsx`'s own page and tab-switcher dropdown, `AddReviewAccountModal.tsx`/`EditEntryModal.tsx`'s tab pickers, `BrandTabsModal.tsx`) intentionally have no task — this plan does not touch those files, matching the spec's explicit non-goal.
- **Type/name consistency check:** `pauseTabLocally`/`unpauseTabLocally`/`applyPausedTabs`/`resetPausedTabs`/`isTabPaused`/`getActiveOperationalTabs` (Task 2) are the exact names used by every later task (4-11); `pauseTab`/`unpauseTab`/`fetchPausedTabs`/`PausedTabRow` (Task 3) match what Tasks 4, 5, and 10 import; `buildPausedTabNameSet` (Task 11) matches what its own test file imports.
