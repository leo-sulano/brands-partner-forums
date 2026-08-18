# Self-Service Brand Tab Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any approved user create (and delete) a Brand Tab from inside
the dashboard — no code change or deploy required — while leaving the 11
existing hardcoded tabs and all platform (TP/AG/CG/WO) logic untouched.

**Architecture:** A new `custom_tabs` Supabase table is the source of truth
for dynamically-created tabs. A new pure, Deno-safe module
(`src/lib/dynamicTabRegistry.ts`) generates each dynamic tab's column list
from one canonical template and holds an in-memory registry that
`tab-configs.ts`'s getters fall back to. `OPERATIONAL_TABS`
(`src/lib/tabs.ts`) is mutated in place on registration/unregistration, so
every one of its ~12 existing consumers (Sidebar, Overview, Score Summary,
Schedule Planner, both entry modals, BrandGroup) picks up a dynamic tab with
zero call-site changes. The frontend registers dynamic tabs once during
`AuthContext`'s session bootstrap (before `ProtectedRoute` stops showing its
loading spinner); the one Edge Function that actually imports
`tab-configs.ts`/`tabs.ts` (`generate-weekly-schedule`) registers them once
per invocation.

**Tech Stack:** React 19 · TypeScript · Supabase (Postgres + RLS) · Vitest ·
Deno (Edge Function)

**Spec:** `docs/superpowers/specs/2026-08-18-self-service-brand-tab-creation-design.md`

## Global Constraints

- Existing 11 tabs in `TAB_COLUMN_CONFIGS` (`src/lib/tab-configs.ts`) are
  never modified.
- Any approved user (not admin-only) can create or delete a dynamic tab —
  gate on `useAuth().isApproved`, same as Schedule Planner/Score Summary.
- Deleting a dynamic tab is blocked while it has any `entries` row —
  server-side guard in `deleteCustomTab`, not just a client-side check.
- `dynamicTabRegistry.ts` must stay free of React/npm-package imports and
  I/O — it is imported by the same Deno Edge Function that already imports
  `tab-configs.ts`/`tabs.ts`.
- `TP` is always included in a dynamic tab's platform set; `AG`/`CG` are
  optional. `WO` is never offered (Wizard of Odds' column shape is a special
  case in `tab-configs.ts` unrelated to the standard template).
- Full existing test suite and `npm run build` must pass after every task.

---

### Task 1: `custom_tabs` migration

**Files:**
- Create: `supabase/migrations/20260818130000_add_custom_tabs.sql`

**Interfaces:**
- Produces: table `public.custom_tabs(id uuid, name text unique, platforms
  text[], created_by text, created_at timestamptz)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260818130000_add_custom_tabs.sql
-- Self-service Brand Tab creation
-- (docs/superpowers/specs/2026-08-18-self-service-brand-tab-creation-design.md):
--
-- custom_tabs is the source of truth for dynamically-created Brand Tabs —
-- the 11 legacy tabs stay hardcoded in src/lib/tab-configs.ts and never
-- appear here. `platforms` is validated at the application layer
-- (src/lib/dynamicTabRegistry.ts) rather than a check constraint, since the
-- allowed set only needs to stay in sync with one TypeScript module, not
-- with every possible future writer of this table.
--
-- All four RLS policies are defined explicitly even though the v1 UI only
-- exercises select/insert/delete, matching every other flag/config table in
-- this project (see schedule_pms_links, brand_schedule).

create table public.custom_tabs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  platforms  text[] not null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.custom_tabs enable row level security;

create policy "anyone can read custom_tabs"
  on public.custom_tabs for select using (true);
create policy "approved users can insert custom_tabs"
  on public.custom_tabs for insert with check (public.is_approved());
create policy "approved users can update custom_tabs"
  on public.custom_tabs for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete custom_tabs"
  on public.custom_tabs for delete using (public.is_approved());
```

- [ ] **Step 2: Apply locally if a dev Supabase link exists, otherwise note it as pending**

Run: `supabase db push` (if this checkout has a linked project —
see `project_supabase_worktree_link` memory). If no live credential is
available in this session, leave the migration file committed and flag it
as a pending manual deploy step in the final task-history write-up, same
pattern as every other recent migration in this project.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260818130000_add_custom_tabs.sql
git commit -m "feat: add custom_tabs table for self-service Brand Tab creation"
```

---

### Task 2: `dynamicTabRegistry.ts` — column template + registry

**Files:**
- Create: `src/lib/dynamicTabRegistry.ts`
- Test: `src/lib/dynamicTabRegistry.test.ts`

**Interfaces:**
- Consumes: `OPERATIONAL_TABS` (`string[]`, exported mutable array) and
  `TAB_COLUMN_CONFIGS` (`Record<string, string[]>`) from `./tabs.ts` /
  `./tab-configs.ts`.
- Produces (for Task 3+):
  - `type DynamicTabPlatform = 'tp' | 'ag' | 'cg'`
  - `buildDynamicTabColumns(platforms: DynamicTabPlatform[]): string[]`
  - `registerDynamicTabs(rows: { name: string; platforms: DynamicTabPlatform[] }[]): void`
  - `unregisterDynamicTab(name: string): void`
  - `getDynamicTabColumns(tab: string): string[] | null`
  - `isDynamicTab(tab: string): boolean`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/dynamicTabRegistry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildDynamicTabColumns,
  registerDynamicTabs,
  unregisterDynamicTab,
  getDynamicTabColumns,
  isDynamicTab,
} from './dynamicTabRegistry';
import { OPERATIONAL_TABS } from './tabs';

describe('buildDynamicTabColumns', () => {
  it('always includes the TP-only base column set', () => {
    expect(buildDynamicTabColumns(['tp'])).toEqual([
      'Account', 'Country', 'Proxy Used', 'Account Name', 'Agent',
      'Brand Name', 'Brand Link', 'Trust Pilot', 'Link to the profile',
      'TP Review Status',
    ]);
  });

  it('appends the AG block when ag is selected', () => {
    const cols = buildDynamicTabColumns(['tp', 'ag']);
    expect(cols).toContain('Ask Gambler review added');
    expect(cols).toContain('AG Review Status');
    expect(cols).toContain('AG Review Link');
    expect(cols).toContain('AG User');
    expect(cols).not.toContain('Casino Guru review added');
  });

  it('appends the CG block when cg is selected', () => {
    const cols = buildDynamicTabColumns(['tp', 'cg']);
    expect(cols).toContain('Casino Guru review added');
    expect(cols).toContain('CG Review Status');
    expect(cols).toContain('CG Review Link');
    expect(cols).toContain('CG User');
  });

  it('appends AG before CG when both are selected, base columns first', () => {
    const cols = buildDynamicTabColumns(['tp', 'ag', 'cg']);
    expect(cols.indexOf('TP Review Status')).toBeLessThan(cols.indexOf('Ask Gambler review added'));
    expect(cols.indexOf('AG User')).toBeLessThan(cols.indexOf('Casino Guru review added'));
  });
});

describe('registerDynamicTabs / unregisterDynamicTab / getDynamicTabColumns / isDynamicTab', () => {
  beforeEach(() => {
    // Registry is module-level state — explicitly clear anything a prior
    // test registered so tests don't leak into each other.
    unregisterDynamicTab('Test Dynamic Tab');
    unregisterDynamicTab('Second Dynamic Tab');
  });

  it('is not a dynamic tab before registration', () => {
    expect(isDynamicTab('Test Dynamic Tab')).toBe(false);
    expect(getDynamicTabColumns('Test Dynamic Tab')).toBeNull();
  });

  it('registers a tab and makes its columns available', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    expect(isDynamicTab('Test Dynamic Tab')).toBe(true);
    expect(getDynamicTabColumns('Test Dynamic Tab')).toEqual(buildDynamicTabColumns(['tp']));
  });

  it('pushes a newly registered tab into OPERATIONAL_TABS exactly once', () => {
    const before = OPERATIONAL_TABS.length;
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    expect(OPERATIONAL_TABS).toContain('Test Dynamic Tab');
    expect(OPERATIONAL_TABS.length).toBe(before + 1);
    // Re-registering the same name must not duplicate the entry.
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'ag'] }]);
    expect(OPERATIONAL_TABS.filter((t) => t === 'Test Dynamic Tab').length).toBe(1);
    expect(getDynamicTabColumns('Test Dynamic Tab')).toEqual(buildDynamicTabColumns(['tp', 'ag']));
  });

  it('registers multiple tabs in one call', () => {
    registerDynamicTabs([
      { name: 'Test Dynamic Tab', platforms: ['tp'] },
      { name: 'Second Dynamic Tab', platforms: ['tp', 'cg'] },
    ]);
    expect(isDynamicTab('Test Dynamic Tab')).toBe(true);
    expect(isDynamicTab('Second Dynamic Tab')).toBe(true);
  });

  it('unregisterDynamicTab removes the tab from OPERATIONAL_TABS and the registry', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    unregisterDynamicTab('Test Dynamic Tab');
    expect(OPERATIONAL_TABS).not.toContain('Test Dynamic Tab');
    expect(isDynamicTab('Test Dynamic Tab')).toBe(false);
    expect(getDynamicTabColumns('Test Dynamic Tab')).toBeNull();
  });

  it('unregistering a tab that was never registered is a no-op', () => {
    expect(() => unregisterDynamicTab('Never Registered Tab')).not.toThrow();
  });

  it('never treats a hardcoded tab as dynamic', () => {
    expect(isDynamicTab('Hanan')).toBe(false);
    expect(getDynamicTabColumns('Hanan')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dynamicTabRegistry`
Expected: FAIL — `./dynamicTabRegistry` module does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/dynamicTabRegistry.ts
// Self-service Brand Tab creation
// (docs/superpowers/specs/2026-08-18-self-service-brand-tab-creation-design.md):
// generates a standard, internally-consistent column schema for any tab
// created via the "+ Add Brand Tab" flow, and holds an in-memory registry
// that tab-configs.ts's getters fall back to for a tab that isn't one of
// the 11 hardcoded entries in TAB_COLUMN_CONFIGS.
//
// This module has the same import-safety constraints as tab-configs.ts —
// no React/npm-package imports, no I/O — because it's imported by the
// generate-weekly-schedule Deno Edge Function alongside tab-configs.ts.
import { OPERATIONAL_TABS } from './tabs.ts';

export type DynamicTabPlatform = 'tp' | 'ag' | 'cg';

const BASE_COLUMNS = [
  'Account', 'Country', 'Proxy Used', 'Account Name', 'Agent',
  'Brand Name', 'Brand Link', 'Trust Pilot', 'Link to the profile',
  'TP Review Status',
];

const AG_COLUMNS = ['Ask Gambler review added', 'AG Review Status', 'AG Review Link', 'AG User'];
const CG_COLUMNS = ['Casino Guru review added', 'CG Review Status', 'CG Review Link', 'CG User'];

// Deterministic: same platform set always produces the same column list, in
// the same order, so a dynamic tab's schema can never drift between the
// creator's session and a later reload — matches the Hanan/Rooster Partners
// shape for multi-platform tabs and GRG's shape for TP-only.
export function buildDynamicTabColumns(platforms: DynamicTabPlatform[]): string[] {
  const cols = [...BASE_COLUMNS];
  if (platforms.includes('ag')) cols.push(...AG_COLUMNS);
  if (platforms.includes('cg')) cols.push(...CG_COLUMNS);
  return cols;
}

const dynamicTabColumns: Record<string, string[]> = {};

// Registers (or re-registers) one or more dynamic tabs — computes each
// one's column list via buildDynamicTabColumns and pushes any genuinely new
// name into OPERATIONAL_TABS *in place* (mutating the existing exported
// array, never reassigning the binding) so every one of its ~12 existing
// importers (Sidebar, Overview, Score Summary, Schedule Planner, both entry
// modals, BrandGroup) picks up the new tab with zero call-site changes.
export function registerDynamicTabs(rows: { name: string; platforms: DynamicTabPlatform[] }[]): void {
  for (const row of rows) {
    dynamicTabColumns[row.name] = buildDynamicTabColumns(row.platforms);
    if (!OPERATIONAL_TABS.includes(row.name)) OPERATIONAL_TABS.push(row.name);
  }
}

// Inverse of registerDynamicTabs, for the delete flow — removes the tab
// from both the column registry and OPERATIONAL_TABS. A no-op if the name
// was never registered.
export function unregisterDynamicTab(name: string): void {
  delete dynamicTabColumns[name];
  const idx = OPERATIONAL_TABS.indexOf(name);
  if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1);
}

export function getDynamicTabColumns(tab: string): string[] | null {
  return dynamicTabColumns[tab] ?? null;
}

export function isDynamicTab(tab: string): boolean {
  return tab in dynamicTabColumns;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dynamicTabRegistry`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/dynamicTabRegistry.ts src/lib/dynamicTabRegistry.test.ts
git commit -m "feat: add dynamic tab registry and column template generator"
```

---

### Task 3: Wire the registry into `tab-configs.ts`

**Files:**
- Modify: `src/lib/tab-configs.ts:216-218` (`getTabColumns`),
  `src/lib/tab-configs.ts:235-238` (`getBrandNameCol`),
  `src/lib/tab-configs.ts:649-668` (`hasMultiPlatform`, `getTabPlatforms`)
- Test: `src/lib/tab-configs.test.ts`

**Interfaces:**
- Consumes: `getDynamicTabColumns(tab: string): string[] | null` from Task 2.
- Produces: `getTabColumns`, `getBrandNameCol`, `hasMultiPlatform`,
  `getTabPlatforms` all now transparently resolve a dynamic tab exactly like
  a hardcoded one — no other file needs to know the difference.

- [ ] **Step 1: Write the failing tests**

```typescript
// Append to src/lib/tab-configs.test.ts
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';

describe('tab-configs.ts dynamic tab fallback', () => {
  beforeEach(() => {
    unregisterDynamicTab('Test Dynamic Tab');
  });

  it('getTabColumns falls back to a registered dynamic tab', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'ag'] }]);
    const cols = getTabColumns('Test Dynamic Tab');
    expect(cols).not.toBeNull();
    expect(cols).toContain('AG Review Status');
  });

  it('getTabColumns returns null for an unregistered, non-hardcoded tab', () => {
    expect(getTabColumns('Nonexistent Tab')).toBeNull();
  });

  it('getBrandNameCol resolves "Brand Name" for a dynamic tab', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    expect(getBrandNameCol('Test Dynamic Tab')).toBe('Brand Name');
  });

  it('hasMultiPlatform is true only when a dynamic tab has both AG and CG', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'ag'] }]);
    expect(hasMultiPlatform('Test Dynamic Tab')).toBe(false);
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'ag', 'cg'] }]);
    expect(hasMultiPlatform('Test Dynamic Tab')).toBe(true);
  });

  it('getTabPlatforms reflects a dynamic tab\'s selected platforms', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp', 'cg'] }]);
    expect(getTabPlatforms('Test Dynamic Tab')).toEqual(['tp', 'cg']);
  });

  it('a hardcoded tab is unaffected by the dynamic fallback', () => {
    expect(getTabColumns('Hanan')).toEqual(TAB_COLUMN_CONFIGS['Hanan']);
  });
});
```

Add `hasMultiPlatform` to the existing import line at the top of the test
file (it currently imports `getTabPlatforms` but not `hasMultiPlatform`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tab-configs`
Expected: FAIL — `getTabColumns('Test Dynamic Tab')` returns `null` instead
of the dynamic column list (no fallback wired up yet).

- [ ] **Step 3: Wire the fallback**

In `src/lib/tab-configs.ts`, add the import near the top (after the existing
imports):

```typescript
import { getDynamicTabColumns } from './dynamicTabRegistry.ts';
```

Replace `getTabColumns` (currently lines 216-218):

```typescript
export function getTabColumns(tab: string): string[] | null {
  return TAB_COLUMN_CONFIGS[tab] ?? getDynamicTabColumns(tab);
}
```

Replace `getBrandNameCol` (currently lines 235-238):

```typescript
export function getBrandNameCol(tab: string): string {
  const cols = getTabColumns(tab);
  return (cols && BRAND_COLS.find((c) => cols.includes(c))) || 'Brand Name';
}
```

Replace `hasMultiPlatform` and `getTabPlatforms` (currently lines 649-668):

```typescript
// Returns true if the tab has TP + AG + CG platform columns.
export function hasMultiPlatform(tab: string): boolean {
  const cols = getTabColumns(tab);
  if (!cols) return false;
  const set = new Set(cols);
  return set.has('AG Review Status') && set.has('CG Review Status');
}

// Returns the platforms active for a given tab. All tabs default to TP; WO/AG/CG are opt-in via column presence.
export function getTabPlatforms(tab: string): ('tp' | 'ag' | 'cg' | 'wo')[] {
  const cols = getTabColumns(tab);
  if (tab === 'Wizard of Odds') return ['wo'];
  const platforms: ('tp' | 'ag' | 'cg' | 'wo')[] = ['tp'];
  if (cols) {
    const set = new Set(cols);
    if (set.has('AG Review Status')) platforms.push('ag');
    if (set.has('CG Review Status')) platforms.push('cg');
  }
  return platforms;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tab-configs`
Expected: PASS

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: PASS (all existing tests still green — `getTabColumns` etc. are
widely used, so this step matters)

- [ ] **Step 6: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "feat: fall back to dynamic tab registry in tab-configs.ts getters"
```

---

### Task 4: `queries.ts` — fetch, create, delete

**Files:**
- Modify: `src/lib/queries.ts`
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `currentActor()` (existing, `src/lib/queries.ts`, returns
  `{ id: string | null; email: string | null }`), `DynamicTabPlatform` from
  Task 2.
- Produces (for Task 5+):
  - `interface CustomTabRow { name: string; platforms: DynamicTabPlatform[] }`
  - `fetchCustomTabs(client?: SupabaseClient): Promise<CustomTabRow[]>`
  - `createCustomTab(name: string, platforms: DynamicTabPlatform[]): Promise<void>`
    — throws `Error('A tab named "<name>" already exists.')` on a unique
    violation.
  - `deleteCustomTab(name: string): Promise<void>` — throws
    `Error('Cannot delete "<name>": it still has <n> entries.')` if
    `entries` has any row for that tab.

- [ ] **Step 1: Write the failing tests**

Add to the top of `src/lib/queries.test.ts`'s import list:

```typescript
import {
  // ...existing imports...
  fetchCustomTabs,
  createCustomTab,
  deleteCustomTab,
} from './queries';
```

Append:

```typescript
describe('fetchCustomTabs / createCustomTab / deleteCustomTab', () => {
  it('fetchCustomTabs maps rows to name/platforms', async () => {
    singletonFrom.mockReturnValue(
      chain({ data: [{ name: 'Acme Tab', platforms: ['tp', 'ag'] }], error: null }),
    );
    const rows = await fetchCustomTabs();
    expect(rows).toEqual([{ name: 'Acme Tab', platforms: ['tp', 'ag'] }]);
  });

  it('createCustomTab inserts with the current actor email', async () => {
    const insert = vi.fn().mockReturnValue({ then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }) });
    singletonFrom.mockReturnValue({ insert });
    await createCustomTab('Acme Tab', ['tp']);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme Tab', platforms: ['tp'] }),
    );
  });

  it('createCustomTab throws a friendly error on a duplicate name', async () => {
    const insert = vi.fn().mockReturnValue({
      then: (resolve: (v: { error: { code: string; message: string } }) => unknown) =>
        resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } }),
    });
    singletonFrom.mockReturnValue({ insert });
    await expect(createCustomTab('Acme Tab', ['tp'])).rejects.toThrow('A tab named "Acme Tab" already exists.');
  });

  it('deleteCustomTab blocks deletion when entries exist for the tab', async () => {
    singletonFrom.mockImplementation((table: string) => {
      if (table === 'entries') return chain({ data: null, error: null, count: 3 } as never);
      return chain({ data: null, error: null });
    });
    await expect(deleteCustomTab('Acme Tab')).rejects.toThrow('Cannot delete "Acme Tab": it still has 3 entries.');
  });

  it('deleteCustomTab deletes when the tab has zero entries', async () => {
    const del = vi.fn().mockReturnValue(chain({ data: null, error: null }));
    singletonFrom.mockImplementation((table: string) => {
      if (table === 'entries') return chain({ data: null, error: null, count: 0 } as never);
      return { delete: del, ...chain({ data: null, error: null }) };
    });
    await expect(deleteCustomTab('Acme Tab')).resolves.toBeUndefined();
  });
});
```

Update the shared `chain()` test helper at the top of the file to also
thread through a `count` field (needed for the entries-count check):

```typescript
function chain(result: { data: unknown; error: null; count?: number }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    then: (resolve: (v: { data: unknown; error: null; count?: number }) => unknown) => resolve(result),
  };
  return builder;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- queries`
Expected: FAIL — `fetchCustomTabs`/`createCustomTab`/`deleteCustomTab` are
not exported yet.

- [ ] **Step 3: Write the implementation**

Add near the end of `src/lib/queries.ts`, after `setBrandPlatformRemoved`
(the existing function ending around line 927):

```typescript
export interface CustomTabRow {
  name: string;
  platforms: DynamicTabPlatform[];
}

export async function fetchCustomTabs(client: SupabaseClient = supabase): Promise<CustomTabRow[]> {
  const { data, error } = await client.from('custom_tabs').select('name, platforms');
  if (error) throw error;
  return (data ?? []) as CustomTabRow[];
}

export async function createCustomTab(name: string, platforms: DynamicTabPlatform[]): Promise<void> {
  const actor = await currentActor();
  const { error } = await supabase
    .from('custom_tabs')
    .insert({ name, platforms, created_by: actor.email });
  if (error) {
    if (error.code === '23505') throw new Error(`A tab named "${name}" already exists.`);
    throw error;
  }
}

export async function deleteCustomTab(name: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from('entries')
    .select('id', { count: 'exact', head: true })
    .eq('tab', name);
  if (countError) throw countError;
  if (count && count > 0) {
    throw new Error(`Cannot delete "${name}": it still has ${count} ${count === 1 ? 'entry' : 'entries'}.`);
  }
  const { error } = await supabase.from('custom_tabs').delete().eq('name', name);
  if (error) throw error;
}
```

Add the import at the top of `src/lib/queries.ts`, alongside the other
`removedPlatformBrands.ts`/`scheduleBrands.ts`-style type imports:

```typescript
import type { DynamicTabPlatform } from './dynamicTabRegistry.ts';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- queries`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add fetchCustomTabs/createCustomTab/deleteCustomTab"
```

---

### Task 5: Load dynamic tabs during auth bootstrap

**Files:**
- Modify: `src/contexts/AuthContext.tsx:70-85` (the `if (s) { ... } else { ... }` branch)

**Interfaces:**
- Consumes: `fetchCustomTabs` (Task 4), `registerDynamicTabs` (Task 2).
- Produces: by the time `AuthContext`'s `loading` flips to `false`,
  `OPERATIONAL_TABS` already includes every row from `custom_tabs` — so
  `Sidebar` (which subscribes to `useAuth()` and re-renders when `loading`
  changes) renders the complete tab list on its very next render, and
  `ProtectedRoute`'s child routes (which don't render at all until
  `loading` is `false`) never call a `tab-configs.ts` getter for an
  unregistered dynamic tab.

- [ ] **Step 1: Write the failing test**

`AuthContext.tsx` has no existing test file — this task is a small,
narrowly-scoped change to an `if (s) { ... }` branch inside a `useEffect`
with no independently-testable pure function to unit test in isolation
(the same shape as the existing `fetchProfile` retry logic just above it,
which also has no dedicated test). Verify instead via the full suite
(Step 3) plus a manual smoke check (Step 4), consistent with how this file
has been changed in the past.

- [ ] **Step 2: Make the change**

In `src/contexts/AuthContext.tsx`, add the import at the top:

```typescript
import { fetchCustomTabs } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
```

Replace the `if (s) { ... } else { ... }` branch (currently lines 70-85):

```typescript
      if (s) {
        // A new session means the previously-fetched profile (if any) is stale
        // until this resolves — without this, a sign-in on an already-mounted
        // AuthProvider (loading already false from an earlier no-session check)
        // renders isApproved=false against the stale profile for the duration
        // of this fetch, flashing "Pending Approval" even for approved users.
        setLoading(true);
        Promise.all([fetchProfile(s.user.id), fetchCustomTabs()]).then(([p, customTabs]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          setProfile(p);
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
```

A `fetchCustomTabs()` failure here would reject the whole `Promise.all` and
leave `loading` stuck at `true` — deliberately consistent with how a
`fetchProfile` failure already behaves in the current code (that function
internally retries 3 times and only returns `null` on exhaustion, it never
rejects, so this is a pre-existing pattern being extended, not a new
failure mode).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`, sign in, confirm the app loads normally and the sidebar
still shows all 11 existing tabs (no dynamic tabs exist yet at this point
in the plan, so this just confirms the added `fetchCustomTabs()` call
doesn't break the existing load path against a `custom_tabs` table that
currently has zero rows).

- [ ] **Step 5: Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "feat: register dynamic tabs during auth session bootstrap"
```

---

### Task 6: `AddBrandTabModal.tsx`

**Files:**
- Create: `src/components/AddBrandTabModal.tsx`

**Interfaces:**
- Consumes: `createCustomTab` (Task 4), `TAB_COLUMN_CONFIGS` (existing,
  `src/lib/tab-configs.ts`), `OPERATIONAL_TABS` (existing, `src/lib/tabs.ts`).
- Produces: `<AddBrandTabModal onCreated={(name: string, platforms: DynamicTabPlatform[]) => void} onClose={() => void} />`
  — on successful creation, calls `onCreated(name, platforms)` with the full
  platform list including the forced `'tp'` entry (the caller, Task 7's
  `Sidebar.tsx`, is responsible for calling `registerDynamicTabs` and
  navigating) and does not close itself; the caller closes it via `onClose`.

- [ ] **Step 1: Write the component**

```typescript
// src/components/AddBrandTabModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createCustomTab } from '../lib/queries';
import { TAB_COLUMN_CONFIGS } from '../lib/tab-configs';
import { OPERATIONAL_TABS } from '../lib/tabs';
import type { DynamicTabPlatform } from '../lib/dynamicTabRegistry';

interface Props {
  onCreated: (name: string, platforms: DynamicTabPlatform[]) => void;
  onClose: () => void;
}

const OPTIONAL_PLATFORMS: { key: DynamicTabPlatform; label: string }[] = [
  { key: 'ag', label: 'AskGamblers' },
  { key: 'cg', label: 'Casino Guru' },
];

export default function AddBrandTabModal({ onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [platforms, setPlatforms] = useState<DynamicTabPlatform[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function togglePlatform(p: DynamicTabPlatform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a tab name.');
      return;
    }
    const collision = OPERATIONAL_TABS.includes(trimmed) || trimmed in TAB_COLUMN_CONFIGS;
    if (collision) {
      setError(`A tab named "${trimmed}" already exists.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fullPlatforms: DynamicTabPlatform[] = ['tp', ...platforms];
      await createCustomTab(trimmed, fullPlatforms);
      onCreated(trimmed, fullPlatforms);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tab');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Add Brand Tab</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tab name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="e.g. Sunset Partners"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Platforms</label>
            <div className="flex items-center gap-2 mb-1.5">
              <input type="checkbox" checked disabled className="size-4" />
              <span className="text-sm text-slate-500">Trust Pilot (always tracked)</span>
            </div>
            {OPTIONAL_PLATFORMS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 mb-1.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={platforms.includes(key)}
                  onChange={() => togglePlatform(key)}
                  className="size-4"
                />
                {label}
              </label>
            ))}
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Create Tab
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: PASS (no unused-import or type errors)

- [ ] **Step 3: Commit**

```bash
git add src/components/AddBrandTabModal.tsx
git commit -m "feat: add AddBrandTabModal component"
```

---

### Task 7: Wire creation + deletion into `Sidebar.tsx`

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `AddBrandTabModal` (Task 6), `registerDynamicTabs`,
  `unregisterDynamicTab`, `isDynamicTab` (Task 2), `deleteCustomTab`
  (Task 4).

- [ ] **Step 1: Add state, handlers, and the "+ Add Brand Tab" affordance**

In `src/components/Sidebar.tsx`, add imports:

```typescript
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import AddBrandTabModal from './AddBrandTabModal';
import { registerDynamicTabs, unregisterDynamicTab, isDynamicTab } from '../lib/dynamicTabRegistry';
import type { DynamicTabPlatform } from '../lib/dynamicTabRegistry';
import { deleteCustomTab } from '../lib/queries';
```

(`NavLink` is already imported from `react-router-dom` — add `useNavigate,
useLocation` to that same import line instead of a new one.)

Inside `Sidebar`, alongside the existing `useState` calls:

```typescript
  const { isAdmin, session, isApproved } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showAddTab, setShowAddTab] = useState(false);
  const [tabsVersion, setTabsVersion] = useState(0); // bumped to force a re-render after registerDynamicTabs/unregisterDynamicTab mutate OPERATIONAL_TABS in place
  const [deletingTab, setDeletingTab] = useState<string | null>(null); // tab pending delete confirmation
  const [tabActionError, setTabActionError] = useState<string | null>(null);
```

(`isApproved` is added to the existing `useAuth()` destructure alongside
`isAdmin, session`.)

Add handlers, right after the existing `handleToggleCollapsed` in
`Sidebar.tsx` is not applicable here — `handleToggleCollapsed` lives in
`App.tsx`'s `AppLayout`, not `Sidebar.tsx`. Add these as new functions
inside `Sidebar`, near the top of the component body:

```typescript
  function handleTabCreated(name: string, platforms: DynamicTabPlatform[]) {
    registerDynamicTabs([{ name, platforms }]);
    setTabsVersion((v) => v + 1);
    setShowAddTab(false);
    navigate(`/brands/${tabToSlug(name)}`);
    onClose?.();
  }

  async function handleConfirmDelete(name: string) {
    setTabActionError(null);
    try {
      await deleteCustomTab(name);
      unregisterDynamicTab(name);
      setTabsVersion((v) => v + 1);
      setDeletingTab(null);
      if (location.pathname === `/brands/${tabToSlug(name)}`) navigate('/');
    } catch (err) {
      setTabActionError(err instanceof Error ? err.message : 'Failed to delete tab');
    }
  }
```

- [ ] **Step 2: Render the trash icon for dynamic tabs and the "+ Add Brand Tab" button**

Replace the tab-list `{brandsOpen && OPERATIONAL_TABS.map((tab) => { ... })}`
block (currently lines 108-136) with a version wrapped in a `key={tabsVersion}`
container and with a trash icon for dynamic tabs. Calling `setTabsVersion`
after `registerDynamicTabs`/`unregisterDynamicTab` mutate `OPERATIONAL_TABS`
in place is what triggers the re-render in the first place (any `setState`
call re-runs the whole component body, so the `.map()` below always sees the
current array on its next render regardless of whether `tabsVersion`
appears inside it) — `key={tabsVersion}` on the wrapper is not required for
that, but is included anyway as a deliberate full-remount signal so no
`NavLink`/button retains stale internal state across a tab list change, and
so `tabsVersion` has a real, idiomatic use instead of sitting unread:

```typescript
        {brandsOpen && (
          <div key={tabsVersion} className="contents">
            {OPERATIONAL_TABS.map((tab) => {
              const Icon = TAB_ICONS[tab] ?? DEFAULT_TAB_ICON;
              const platforms = getTabPlatforms(tab);
              return (
                <div key={tab} className="group relative">
                  <NavLink
                    to={`/brands/${tabToSlug(tab)}`}
                    onClick={() => onClose?.()}
                    title={isCollapsed ? tabDisplayName(tab) : undefined}
                    className={({ isActive }) => linkClass(isActive, isCollapsed, true)}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!isCollapsed && <span className="truncate flex-1">{tabDisplayName(tab)}</span>}
                    {!isCollapsed && (
                      <span className="flex items-center gap-0.5 shrink-0">
                        {platforms.map((p) => (
                          <img
                            key={p}
                            src={PLATFORM_FAVICON[p]}
                            alt={p}
                            className="size-3.5 rounded-sm"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ))}
                      </span>
                    )}
                  </NavLink>
                  {!isCollapsed && isApproved && isDynamicTab(tab) && (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTabActionError(null); setDeletingTab(tab); }}
                      title={`Delete ${tabDisplayName(tab)}`}
                      className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isCollapsed && isApproved && (
          <button
            type="button"
            onClick={() => setShowAddTab(true)}
            className="w-full flex items-center gap-3 py-2 px-3 text-sm text-slate-400 hover:text-white hover:bg-blue-500/20 rounded-l-[10px] transition-colors"
          >
            <Plus className="size-4 shrink-0" />
            Add Brand Tab
          </button>
        )}
```

`className="contents"` (Tailwind's `display: contents`) keeps this wrapper
from affecting the existing flex/spacing layout of the surrounding `<nav>` —
it participates in layout as if the `<div>` weren't there at all.

- [ ] **Step 3: Render the modal and the delete-confirmation / error UI**

At the end of `Sidebar`'s returned JSX, right before the final closing
`</>` (after the mobile drawer block, currently ending at line 273):

```typescript
      {showAddTab && (
        <AddBrandTabModal onCreated={handleTabCreated} onClose={() => setShowAddTab(false)} />
      )}

      {deletingTab && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeletingTab(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Delete "{tabDisplayName(deletingTab)}"?</h2>
            <p className="text-xs text-slate-500">This cannot be undone. Deletion is blocked if the tab still has any entries.</p>
            {tabActionError && <p className="text-xs text-rose-600">{tabActionError}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeletingTab(null)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDelete(deletingTab)}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
```

(This replaces the file's final `    </>` with the block above ending in
`    </>` — the fragment's closing tag moves down to wrap the two new
conditionally-rendered blocks.)

- [ ] **Step 4: Run the full suite and build**

Run: `npm test && npm run build`
Expected: PASS

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`, sign in as an approved user. Click "+ Add Brand Tab",
create a tab named "Smoke Test Tab" with AG checked, confirm: (a) the modal
closes and the app navigates to `/brands/smoke-test-tab`, (b) the new tab
now appears in the sidebar with a TP + AG favicon pair, (c) reloading the
page still shows it (proves `AuthContext` registration works, not just the
local `registerDynamicTabs` call from the modal). Then hover the tab, click
its trash icon, confirm the delete confirmation shows, confirm deleting it
removes it from the sidebar and navigates back to `/`. Finally, add an entry
to a fresh dynamic tab via "Add Review Account" and confirm attempting to
delete that tab now shows the "still has 1 entry" error instead of
deleting.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: wire Brand Tab creation and deletion into Sidebar"
```

---

### Task 8: Register dynamic tabs in `generate-weekly-schedule`

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts:118-132`

**Interfaces:**
- Consumes: `fetchCustomTabs` (Task 4, already Deno-safe — it only uses the
  injected `SupabaseClient`), `registerDynamicTabs` (Task 2).

- [ ] **Step 1: Write the failing test**

Check whether a test file already exists for this function's `Deno.serve`
handler:

Run: `ls supabase/functions/generate-weekly-schedule/*.test.ts`

The existing tests in this directory (per the project's task history) cover
`buildTabContext`/`generateForTab`/`generateAllTabs` as exported, injectable
functions — the `Deno.serve` handler body itself is a thin wrapper with no
existing direct test, matching the pattern in Task 5. Verify this task via
the full Deno suite (Step 3) instead of a new handler-level test.

- [ ] **Step 2: Make the change**

Add the import at the top of `supabase/functions/generate-weekly-schedule/index.ts`,
alongside the existing `src/lib/*.ts` imports:

```typescript
import { fetchCustomTabs } from '../../../src/lib/queries.ts';
import { registerDynamicTabs } from '../../../src/lib/dynamicTabRegistry.ts';
```

(`fetchCustomTabs` is added to the existing `fetchRawEntriesByTab, ...`
import line from `queries.ts` rather than a new line.)

Replace the `Deno.serve` handler (currently lines 118-132):

```typescript
Deno.serve(async (_req: Request): Promise<Response> => {
  const client = createClient(SUPABASE_URL, SERVICE_ROLE);
  const customTabs = await fetchCustomTabs(client);
  registerDynamicTabs(customTabs);
  // Computed in the runtime's local zone (UTC on Supabase Edge). This is
  // only correct because the migration's cron
  // (supabase/migrations/20260805100000_add_generate_weekly_schedule_cron.sql)
  // is scheduled at `0 1 * * 1` UTC = 09:00 Asia/Manila Monday, safely past
  // local midnight. Changing the cron time, or manually invoking this
  // function before 09:00 Manila on a Monday (00:00-08:00 Manila = 16:00-24:00
  // UTC Sunday), will silently compute the *previous* week instead.
  const weekStart = toISODate(mondayOf(new Date()));
  const results = await generateAllTabs(OPERATIONAL_TABS, weekStart, client);
  return new Response(JSON.stringify({ weekStart, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 3: Run the Deno suite**

Run:
```bash
deno test --allow-env --allow-net --no-lock --node-modules-dir=none \
  --config supabase/functions/generate-weekly-schedule/deno.json \
  supabase/functions/generate-weekly-schedule/
```
Expected: PASS. (Per `project_stray_...`/Known Issues context in this
project, local `deno check`/`deno test` for this function is already known
to fail on unrelated pre-existing extensionless-import errors in
`countryFlags.ts`/`reviewRemovalAssessment.ts` — if that's still the case,
confirm this task's change isn't the cause by checking the failure is the
same pre-existing `TS2307` shape, not a new error referencing
`dynamicTabRegistry.ts` or `queries.ts`'s `fetchCustomTabs`.)

- [ ] **Step 4: Run `npm test` and `npm run build` from the repo root**

Run: `npm test && npm run build`
Expected: PASS (confirms the frontend side is unaffected by this
Deno-specific task).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts
git commit -m "feat: register dynamic tabs in generate-weekly-schedule"
```

---

## Post-implementation (not a coding task)

- If a live Supabase credential was unavailable during Task 1, flag
  `20260818130000_add_custom_tabs.sql` as a pending manual `supabase db push`
  in the final task-history write-up, same pattern as every other recent
  migration in this project.
- Live-verify the create → sidebar-appears → reload-persists → delete-blocked
  → delete-succeeds flow against real Supabase data once the migration is
  applied, since Task 7's Step 5 manual check can only be done once Task 1's
  migration is live.
