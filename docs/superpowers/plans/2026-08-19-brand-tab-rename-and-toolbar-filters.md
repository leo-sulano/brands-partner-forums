# Brand Tab Rename + Customizable Toolbar Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a dynamic (self-service) Brand Tab be renamed, and let any tab's toolbar (Brand/Agent/Proxy/Country/Status/Platform filters) be customized to show only a chosen subset — both from the existing "Edit Platforms" pencil button (broadened into "Edit Brand Tab"), and from the "+ Add Brand Tab" creation flow.

**Architecture:** A new sparse `tab_toolbar_filters` table (one row per customized tab, same shape as the existing `tab_hidden_platforms`) drives an in-memory allow-list registry in `tab-configs.ts`, read by `BrandGroup.tsx`'s toolbar rendering. A new `rename_custom_tab` Postgres RPC does the actual rename: it updates `custom_tabs.name` and, via `information_schema` introspection (not a hardcoded table list), the `tab` column of every other table keyed by it, in one atomic transaction. The frontend mirrors this with a `renameDynamicTab` helper in `dynamicTabRegistry.ts` that atomically swaps the in-memory registry entry.

**Tech Stack:** Vite 6 · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres + RLS) · Vitest

**Spec:** `docs/superpowers/specs/2026-08-19-brand-tab-rename-and-toolbar-filters-design.md`

## Global Constraints

- Rename is dynamic-tab-only. Hardcoded tabs (the 11 in `TAB_COLUMN_CONFIGS`) can never be renamed.
- Toolbar filter customization applies to **all** tabs, hardcoded and dynamic.
- Filter allow-list is explicit and layers on top of (does not replace) each filter's existing data-cardinality auto-hide check.
- No row in `tab_toolbar_filters` for a tab means all 6 filters are allowed — nothing changes for any existing tab on deploy day.
- Access gate for every new write path is `isApproved` (matching `is_approved()` in Postgres) — not admin-only.
- The 6 filter keys, exactly: `brand`, `agent`, `proxy`, `country`, `status`, `platform`.

---

### Task 1: `validateNewTabName` shared helper + `AddBrandTabModal` refactor

**Files:**
- Create: `src/lib/tabValidation.ts`
- Create: `src/lib/tabValidation.test.ts`
- Modify: `src/components/AddBrandTabModal.tsx`

**Interfaces:**
- Produces: `validateNewTabName(name: string): string | null` — returns a user-facing error message, or `null` if the name is valid. Trims internally.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tabValidation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { validateNewTabName } from './tabValidation';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';

describe('validateNewTabName', () => {
  beforeEach(() => {
    unregisterDynamicTab('Sunset Partners');
  });

  it('rejects a blank name', () => {
    expect(validateNewTabName('   ')).toBe('Enter a tab name.');
  });

  it('rejects a name that collides with a hardcoded tab', () => {
    expect(validateNewTabName('Hanan')).toBe('A tab named "Hanan" already exists.');
  });

  it('rejects a name that collides with an already-registered dynamic tab', () => {
    registerDynamicTabs([{ name: 'Sunset Partners', platforms: ['tp'] }]);
    expect(validateNewTabName('Sunset Partners')).toBe('A tab named "Sunset Partners" already exists.');
  });

  it('rejects a name that produces the same URL slug as an existing tab', () => {
    expect(validateNewTabName('Gulf Recovery Group')).toBe(
      '"Gulf Recovery Group" produces the same URL as an existing tab. Pick a more distinct name.',
    );
  });

  it('rejects a name containing /, ? or #', () => {
    expect(validateNewTabName('Foo/Bar')).toBe('A tab name cannot contain /, ? or #.');
    expect(validateNewTabName('Foo?Bar')).toBe('A tab name cannot contain /, ? or #.');
    expect(validateNewTabName('Foo#Bar')).toBe('A tab name cannot contain /, ? or #.');
  });

  it('accepts a genuinely new, distinct name', () => {
    expect(validateNewTabName('Sunset Partners')).toBeNull();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateNewTabName('  Hanan  ')).toBe('A tab named "Hanan" already exists.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tabValidation.test.ts`
Expected: FAIL — `Cannot find module './tabValidation'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/tabValidation.ts`:

```ts
import { TAB_COLUMN_CONFIGS } from './tab-configs';
import { OPERATIONAL_TABS, tabToSlug } from './tabs';

// Shared by AddBrandTabModal (create) and EditBrandTabModal (rename) so the
// two can't drift on what makes a candidate Brand Tab name valid — both
// write into custom_tabs.name, which becomes a live URL slug and a literal
// key across a dozen other tables (see renameCustomTab / the
// rename_custom_tab RPC in queries.ts).
export function validateNewTabName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a tab name.';
  const collision = OPERATIONAL_TABS.includes(trimmed) || trimmed in TAB_COLUMN_CONFIGS;
  if (collision) return `A tab named "${trimmed}" already exists.`;
  // A tab's URL is /brands/<tabToSlug(name)>, and slugToTab resolves a slug
  // back to the *first* matching tab — so a name that only collides by slug
  // (e.g. "Gulf Recovery Group" → gulf-recovery-group, already claimed by
  // 'GRG - Gulf Recovery Group' via SLUG_OVERRIDES) would create a tab that
  // is permanently unreachable, silently landing on the other tab instead.
  if (OPERATIONAL_TABS.some((t) => tabToSlug(t) === tabToSlug(trimmed))) {
    return `"${trimmed}" produces the same URL as an existing tab. Pick a more distinct name.`;
  }
  // '/' would split the route, '?' and '#' would terminate the path — any of
  // them breaks /brands/:tab for the new tab.
  if (/[/?#]/.test(trimmed)) return 'A tab name cannot contain /, ? or #.';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tabValidation.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Refactor `AddBrandTabModal.tsx` to use the shared helper**

In `src/components/AddBrandTabModal.tsx`, add the import:

```ts
import { validateNewTabName } from '../lib/tabValidation';
```

Replace the existing inline validation block inside `handleSubmit` (the `trimmed`/`collision`/slug-collision/forbidden-chars checks) with:

```ts
async function handleSubmit() {
  const trimmed = name.trim();
  const nameError = validateNewTabName(trimmed);
  if (nameError) {
    setError(nameError);
    return;
  }
  if (platforms.length === 0) {
    setError('Select at least one platform to track.');
    return;
  }
  setSubmitting(true);
  setError(null);
  try {
    await createCustomTab(trimmed, platforms);
    onCreated(trimmed, platforms);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to create tab');
    setSubmitting(false);
  }
}
```

(This is a pure extraction — no behavior change yet. The `TAB_COLUMN_CONFIGS`/`OPERATIONAL_TABS`/`tabToSlug` imports that are now unused in this file can be removed.)

- [ ] **Step 6: Run the full test suite and build**

Run: `npm test` then `npm run build`
Expected: both pass, same test count as before this task (no new component tests for this modal — matches this project's existing convention of verifying these modals via build + live check, not RTL tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/tabValidation.ts src/lib/tabValidation.test.ts src/components/AddBrandTabModal.tsx
git commit -m "refactor: extract validateNewTabName shared helper from AddBrandTabModal"
```

---

### Task 2: Toolbar filter registry in `tab-configs.ts`

**Files:**
- Modify: `src/lib/tab-configs.ts`
- Modify: `src/lib/tab-configs.test.ts`

**Interfaces:**
- Produces: `type ToolbarFilterKey = 'brand' | 'agent' | 'proxy' | 'country' | 'status' | 'platform'`; `TOOLBAR_FILTER_LIST: { key: ToolbarFilterKey; label: string }[]`; `ALL_TOOLBAR_FILTERS: ToolbarFilterKey[]`; `getEnabledToolbarFilters(tab: string): ToolbarFilterKey[]`; `registerToolbarFilters(rows: { tab: string; enabled_filters: ToolbarFilterKey[] }[]): void`; `unregisterToolbarFilters(tab: string): void`; `resetToolbarFilters(): void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/tab-configs.test.ts` (extend the existing import list at the top of the file to include `getEnabledToolbarFilters, registerToolbarFilters, unregisterToolbarFilters, resetToolbarFilters, ALL_TOOLBAR_FILTERS`):

```ts
describe('toolbar filter overrides', () => {
  beforeEach(() => {
    resetToolbarFilters();
  });

  afterAll(() => {
    resetToolbarFilters();
  });

  it('returns all 6 filters for a tab with no override row', () => {
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(ALL_TOOLBAR_FILTERS);
  });

  it('narrows to exactly the registered set', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['brand', 'status'] }]);
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(['brand', 'status']);
  });

  it('does not affect a different tab', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['brand'] }]);
    expect(getEnabledToolbarFilters('Hanan')).toEqual(ALL_TOOLBAR_FILTERS);
  });

  it('unregisterToolbarFilters reverts a tab to the all-6 default', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['brand'] }]);
    unregisterToolbarFilters('Rooster Partners');
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(ALL_TOOLBAR_FILTERS);
  });

  it('resetToolbarFilters clears every tab\'s override', () => {
    registerToolbarFilters([
      { tab: 'Rooster Partners', enabled_filters: ['brand'] },
      { tab: 'Hanan', enabled_filters: ['status'] },
    ]);
    resetToolbarFilters();
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(ALL_TOOLBAR_FILTERS);
    expect(getEnabledToolbarFilters('Hanan')).toEqual(ALL_TOOLBAR_FILTERS);
  });

  it('re-registering the same tab replaces its set rather than merging', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['brand', 'agent'] }]);
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: ['status'] }]);
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual(['status']);
  });

  it('allows registering an empty filter set', () => {
    registerToolbarFilters([{ tab: 'Rooster Partners', enabled_filters: [] }]);
    expect(getEnabledToolbarFilters('Rooster Partners')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tab-configs.test.ts`
Expected: FAIL — `getEnabledToolbarFilters is not a function` (or similar import error)

- [ ] **Step 3: Implement in `tab-configs.ts`**

Insert this block immediately after the closing `}` of `getTabPlatforms` (right before the `// Set once by dynamicTabRegistry.ts` comment):

```ts
export type ToolbarFilterKey = 'brand' | 'agent' | 'proxy' | 'country' | 'status' | 'platform';

// Single source of truth for the toolbar-filter checkbox list shown by both
// AddBrandTabModal (create) and EditBrandTabModal (edit), mirroring how
// PLATFORM_LIST (dynamicTabRegistry.ts) is the one shared source for the
// platform checkbox list.
export const TOOLBAR_FILTER_LIST: { key: ToolbarFilterKey; label: string }[] = [
  { key: 'brand', label: 'Brand' },
  { key: 'agent', label: 'Agent' },
  { key: 'proxy', label: 'Proxy' },
  { key: 'country', label: 'Country' },
  { key: 'status', label: 'Status' },
  { key: 'platform', label: 'Platform' },
];

export const ALL_TOOLBAR_FILTERS: ToolbarFilterKey[] = TOOLBAR_FILTER_LIST.map((f) => f.key);

// In-memory registry of each tab's toolbar filter allow-list
// (docs/superpowers/specs/2026-08-19-brand-tab-rename-and-toolbar-filters-design.md).
// A tab absent from this map has no override — every filter is allowed,
// still subject to each dropdown's own data-cardinality auto-hide check in
// BrandGroup.tsx. Populated at session bootstrap (AuthContext.tsx), same
// pattern as hiddenTabPlatforms above.
const toolbarFilterOverrides: Record<string, Set<ToolbarFilterKey>> = {};

export function registerToolbarFilters(rows: { tab: string; enabled_filters: ToolbarFilterKey[] }[]): void {
  for (const row of rows) {
    toolbarFilterOverrides[row.tab] = new Set(row.enabled_filters);
  }
  notifyTabPlatformsChanged();
}

export function unregisterToolbarFilters(tab: string): void {
  delete toolbarFilterOverrides[tab];
  notifyTabPlatformsChanged();
}

export function resetToolbarFilters(): void {
  for (const key of Object.keys(toolbarFilterOverrides)) delete toolbarFilterOverrides[key];
}

// Returns the toolbar filters currently allowed for a tab — every filter if
// the tab has no override row, else exactly the registered set (which may
// be empty, meaning no filter dropdowns show at all).
export function getEnabledToolbarFilters(tab: string): ToolbarFilterKey[] {
  const override = toolbarFilterOverrides[tab];
  return override ? ALL_TOOLBAR_FILTERS.filter((f) => override.has(f)) : [...ALL_TOOLBAR_FILTERS];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tab-configs.test.ts`
Expected: PASS (7 new tests, all existing tests in this file still pass)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "feat: add per-tab toolbar filter allow-list registry"
```

---

### Task 3: `renameDynamicTab` in `dynamicTabRegistry.ts`

**Files:**
- Modify: `src/lib/dynamicTabRegistry.ts`
- Modify: `src/lib/dynamicTabRegistry.test.ts`

**Interfaces:**
- Consumes: `TAB_COLUMN_CONFIGS` (already imported in this file), `buildDynamicTabColumns` (already defined in this file).
- Produces: `renameDynamicTab(oldName: string, newName: string, platforms: DynamicTabPlatform[]): void`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/dynamicTabRegistry.test.ts` (extend the top import to include `renameDynamicTab`):

```ts
describe('renameDynamicTab', () => {
  beforeEach(() => {
    unregisterDynamicTab('Test Dynamic Tab');
    unregisterDynamicTab('Renamed Dynamic Tab');
    unregisterDynamicTab('Second Dynamic Tab');
  });

  it('renames a registered tab in place, preserving its OPERATIONAL_TABS position', () => {
    registerDynamicTabs([
      { name: 'Second Dynamic Tab', platforms: ['tp'] },
      { name: 'Test Dynamic Tab', platforms: ['tp', 'ag'] },
    ]);
    const idxBefore = OPERATIONAL_TABS.indexOf('Test Dynamic Tab');
    renameDynamicTab('Test Dynamic Tab', 'Renamed Dynamic Tab', ['tp', 'ag']);
    expect(OPERATIONAL_TABS.indexOf('Renamed Dynamic Tab')).toBe(idxBefore);
    expect(OPERATIONAL_TABS).not.toContain('Test Dynamic Tab');
    expect(isDynamicTab('Test Dynamic Tab')).toBe(false);
    expect(isDynamicTab('Renamed Dynamic Tab')).toBe(true);
    expect(getDynamicTabColumns('Renamed Dynamic Tab')).toEqual(buildDynamicTabColumns(['tp', 'ag']));
  });

  it('is a no-op when the old name was never registered as a dynamic tab', () => {
    const before = [...OPERATIONAL_TABS];
    renameDynamicTab('Never Registered', 'Also Never', ['tp']);
    expect(OPERATIONAL_TABS).toEqual(before);
    expect(isDynamicTab('Also Never')).toBe(false);
  });

  it('refuses to rename into a hardcoded tab name, leaving the original registered', () => {
    registerDynamicTabs([{ name: 'Test Dynamic Tab', platforms: ['tp'] }]);
    renameDynamicTab('Test Dynamic Tab', 'Hanan', ['tp']);
    expect(isDynamicTab('Test Dynamic Tab')).toBe(true);
    expect(OPERATIONAL_TABS.filter((t) => t === 'Hanan').length).toBe(1);
    expect(getTabColumns('Hanan')).toEqual(TAB_COLUMN_CONFIGS['Hanan']);
  });

  it('refuses to rename a hardcoded tab', () => {
    const before = [...OPERATIONAL_TABS];
    renameDynamicTab('Hanan', 'Hanan Renamed', ['tp']);
    expect(OPERATIONAL_TABS).toEqual(before);
    expect(isDynamicTab('Hanan Renamed')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dynamicTabRegistry.test.ts`
Expected: FAIL — `renameDynamicTab is not a function`

- [ ] **Step 3: Implement in `dynamicTabRegistry.ts`**

Insert this function immediately after `unregisterDynamicTab`'s closing `}` (before `resetDynamicTabs`):

```ts
// Renames a previously-registered dynamic tab in place: removes the old key
// from both dynamicTabColumns and OPERATIONAL_TABS and adds the new one
// with the same platform set, at the same array position, firing exactly
// one tab-platforms-changed event — doing this as a separate unregister
// then register would leave a window where neither name is registered,
// which a listener firing in between (e.g. Sidebar's tabsVersion bump)
// could render against.
export function renameDynamicTab(oldName: string, newName: string, platforms: DynamicTabPlatform[]): void {
  if (!(oldName in dynamicTabColumns)) return;
  if (newName in TAB_COLUMN_CONFIGS) return;
  delete dynamicTabColumns[oldName];
  dynamicTabColumns[newName] = buildDynamicTabColumns(platforms);
  const idx = OPERATIONAL_TABS.indexOf(oldName);
  if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1, newName);
  else if (!OPERATIONAL_TABS.includes(newName)) OPERATIONAL_TABS.push(newName);
  notifyTabPlatformsChanged();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dynamicTabRegistry.test.ts`
Expected: PASS (4 new tests, all existing tests in this file still pass)

- [ ] **Step 5: Commit**

```bash
git add src/lib/dynamicTabRegistry.ts src/lib/dynamicTabRegistry.test.ts
git commit -m "feat: add renameDynamicTab to the in-memory dynamic tab registry"
```

---

### Task 4: Migration — `tab_toolbar_filters` table

**Files:**
- Create: `supabase/migrations/20260819100000_add_tab_toolbar_filters.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Per-tab toolbar filter customization
-- (docs/superpowers/specs/2026-08-19-brand-tab-rename-and-toolbar-filters-design.md):
-- a sparse opt-in overlay, same shape as tab_hidden_platforms — a row's
-- existence means that tab's toolbar is restricted to exactly the filters
-- listed; no row means all 6 filters are allowed (still subject to each
-- filter's own auto-hide-on-sparse-data rule in BrandGroup.tsx).
create table public.tab_toolbar_filters (
  tab              text primary key,
  enabled_filters  text[] not null,
  updated_by       text,
  updated_at       timestamptz not null default now(),
  constraint tab_toolbar_filters_valid_keys check (
    enabled_filters <@ array['brand','agent','proxy','country','status','platform']::text[]
  )
);

alter table public.tab_toolbar_filters enable row level security;

create policy "anyone can read tab_toolbar_filters"
  on public.tab_toolbar_filters for select using (true);
create policy "approved users can insert tab_toolbar_filters"
  on public.tab_toolbar_filters for insert with check (public.is_approved());
create policy "approved users can update tab_toolbar_filters"
  on public.tab_toolbar_filters for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete tab_toolbar_filters"
  on public.tab_toolbar_filters for delete using (public.is_approved());
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: migration `20260819100000_add_tab_toolbar_filters` applied successfully. If this checkout isn't linked to the Supabase project (`supabase link --project-ref <ref>` not yet run here), note that explicitly and treat this as a pending-deploy item alongside the RPC in Task 5 — do not block the rest of this plan on it, since every later task's automated tests mock the Supabase client.

- [ ] **Step 3: Verify live**

In the Supabase SQL editor (or via `supabase db push`'s own success output), confirm:

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'tab_toolbar_filters'
order by ordinal_position;
```

Expected: `tab` (text), `enabled_filters` (ARRAY), `updated_by` (text), `updated_at` (timestamp with time zone).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260819100000_add_tab_toolbar_filters.sql
git commit -m "feat: add tab_toolbar_filters table"
```

---

### Task 5: Migration — `rename_custom_tab` RPC

**Files:**
- Create: `supabase/migrations/20260819110000_add_rename_custom_tab_function.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Atomically renames a dynamic (custom_tabs-backed) Brand Tab across every
-- table keyed by its name
-- (docs/superpowers/specs/2026-08-19-brand-tab-rename-and-toolbar-filters-design.md).
-- Discovers every table with a `tab` text column via information_schema
-- rather than a hardcoded list — this project has already renamed
-- tab-scoped tables more than once (removed_tp_brands -> removed_platform_brands),
-- and a hardcoded list here would silently stop covering a newly added one.
create or replace function public.rename_custom_tab(old_name text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;

  if not exists (select 1 from public.custom_tabs where name = old_name) then
    raise exception '"%" is not a custom tab', old_name;
  end if;
  if exists (select 1 from public.custom_tabs where name = new_name) then
    raise exception 'a tab named "%" already exists', new_name;
  end if;

  update public.custom_tabs set name = new_name where name = old_name;

  for rec in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'tab'
      and table_name <> 'custom_tabs'
  loop
    execute format('update public.%I set tab = $1 where tab = $2', rec.table_name)
      using new_name, old_name;
  end loop;
end;
$$;

grant execute on function public.rename_custom_tab(text, text) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: migration `20260819110000_add_rename_custom_tab_function` applied successfully. Same caveat as Task 4 if this checkout isn't linked.

- [ ] **Step 3: Verify live with a real, disposable dynamic tab**

Using the Supabase SQL editor (as the same admin/approved role the app runs as, e.g. via `set role authenticated; set request.jwt.claims = ...` or simply as the signed-in app user through the app itself later in Task 10's live check) — for now, a quick service-role sanity check is enough:

```sql
insert into public.custom_tabs (name, platforms, created_by) values ('Plan Test Tab', array['tp'], 'plan-test@example.com');
insert into public.entries (tab, sheet_row_id, data) values ('Plan Test Tab', 'plan-test-row-1', '{}'::jsonb);

select public.rename_custom_tab('Plan Test Tab', 'Plan Test Tab Renamed');

select tab from public.entries where sheet_row_id = 'plan-test-row-1'; -- expect 'Plan Test Tab Renamed'
select name from public.custom_tabs where name = 'Plan Test Tab Renamed'; -- expect 1 row
select name from public.custom_tabs where name = 'Plan Test Tab'; -- expect 0 rows

-- cleanup
delete from public.entries where sheet_row_id = 'plan-test-row-1';
delete from public.custom_tabs where name = 'Plan Test Tab Renamed';
```

Expected: the `entries` row's `tab` value follows the rename, and `custom_tabs` reflects only the new name. Clean up the disposable rows afterward either way.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260819110000_add_rename_custom_tab_function.sql
git commit -m "feat: add rename_custom_tab RPC for atomic dynamic tab renaming"
```

---

### Task 6: `queries.ts` — toolbar filter queries + `renameCustomTab` + `createCustomTab` filters param

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `ALL_TOOLBAR_FILTERS`, `type ToolbarFilterKey` (from Task 2's `tab-configs.ts`).
- Produces: `fetchToolbarFilters(client?): Promise<{ tab: string; enabled_filters: ToolbarFilterKey[] }[]>`; `setToolbarFilters(tab: string, enabledFilters: ToolbarFilterKey[]): Promise<void>`; `renameCustomTab(oldName: string, newName: string): Promise<void>`; `createCustomTab(name, platforms, enabledFilters?: ToolbarFilterKey[]): Promise<void>` (extended signature, backward compatible — third param optional).

- [ ] **Step 1: Write the failing tests**

First, extend the test file's mock setup so `supabase.rpc` is mockable. In `src/lib/queries.test.ts`, change:

```ts
const { singletonFrom } = vi.hoisted(() => ({ singletonFrom: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: {
    from: singletonFrom,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
```

to:

```ts
const { singletonFrom, singletonRpc } = vi.hoisted(() => ({ singletonFrom: vi.fn(), singletonRpc: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: {
    from: singletonFrom,
    rpc: singletonRpc,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
```

Add `renameCustomTab, fetchToolbarFilters, setToolbarFilters,` to the existing named import from `./queries` near the top of the file (alongside `createCustomTab, updateCustomTabPlatforms, deleteCustomTab,`).

Then add these tests, right after the existing `describe('fetchCustomTabs / createCustomTab / deleteCustomTab', ...)` block closes:

```ts
describe('renameCustomTab', () => {
  beforeEach(() => {
    singletonRpc.mockReset();
  });

  it('calls the rename_custom_tab RPC with old and new names', async () => {
    singletonRpc.mockResolvedValue({ error: null });
    await renameCustomTab('Acme Tab', 'Acme Tab Renamed');
    expect(singletonRpc).toHaveBeenCalledWith('rename_custom_tab', {
      old_name: 'Acme Tab',
      new_name: 'Acme Tab Renamed',
    });
  });

  it('throws the RPC error', async () => {
    singletonRpc.mockResolvedValue({ error: new Error('a tab named "X" already exists') });
    await expect(renameCustomTab('Acme Tab', 'X')).rejects.toThrow('a tab named "X" already exists');
  });
});

describe('fetchToolbarFilters / setToolbarFilters', () => {
  it('fetchToolbarFilters maps rows to tab/enabled_filters', async () => {
    singletonFrom.mockReturnValue(
      chain({ data: [{ tab: 'Acme Tab', enabled_filters: ['brand', 'status'] }], error: null }),
    );
    const rows = await fetchToolbarFilters();
    expect(rows).toEqual([{ tab: 'Acme Tab', enabled_filters: ['brand', 'status'] }]);
  });

  it('setToolbarFilters upserts by tab', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ upsert });
    await setToolbarFilters('Acme Tab', ['brand', 'status']);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'Acme Tab', enabled_filters: ['brand', 'status'] }),
      { onConflict: 'tab' },
    );
  });

  it('setToolbarFilters throws on error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: new Error('db down') });
    singletonFrom.mockReturnValue({ upsert });
    await expect(setToolbarFilters('Acme Tab', ['brand'])).rejects.toThrow('db down');
  });
});

describe('createCustomTab with enabledFilters', () => {
  it('does not write tab_toolbar_filters when enabledFilters is omitted', async () => {
    const insert = vi.fn().mockReturnValue({ then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }) });
    const upsert = vi.fn();
    singletonFrom.mockImplementation((table: string) => {
      if (table === 'custom_tabs') return { insert };
      if (table === 'tab_toolbar_filters') return { upsert };
      throw new Error(`unexpected table: ${table}`);
    });
    await createCustomTab('Acme Tab', ['tp']);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not write tab_toolbar_filters when enabledFilters equals the full default set', async () => {
    const insert = vi.fn().mockReturnValue({ then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }) });
    const upsert = vi.fn();
    singletonFrom.mockImplementation((table: string) => {
      if (table === 'custom_tabs') return { insert };
      if (table === 'tab_toolbar_filters') return { upsert };
      throw new Error(`unexpected table: ${table}`);
    });
    await createCustomTab('Acme Tab', ['tp'], ['brand', 'agent', 'proxy', 'country', 'status', 'platform']);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('writes tab_toolbar_filters when enabledFilters narrows the default set', async () => {
    const insert = vi.fn().mockReturnValue({ then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }) });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockImplementation((table: string) => {
      if (table === 'custom_tabs') return { insert };
      if (table === 'tab_toolbar_filters') return { upsert };
      throw new Error(`unexpected table: ${table}`);
    });
    await createCustomTab('Acme Tab', ['tp'], ['brand', 'status']);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'Acme Tab', enabled_filters: ['brand', 'status'] }),
      { onConflict: 'tab' },
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- queries.test.ts`
Expected: FAIL — `renameCustomTab`/`fetchToolbarFilters`/`setToolbarFilters` not exported, `singletonRpc` undefined errors.

- [ ] **Step 3: Implement in `queries.ts`**

Extend the existing `tab-configs.ts` import (line 5) from:

```ts
import { getTabColumns, getBrandNameCol, getTabPlatforms } from './tab-configs.ts';
```

to:

```ts
import { getTabColumns, getBrandNameCol, getTabPlatforms, ALL_TOOLBAR_FILTERS, type ToolbarFilterKey } from './tab-configs.ts';
```

Then replace the existing `createCustomTab` function with:

```ts
export async function createCustomTab(
  name: string,
  platforms: DynamicTabPlatform[],
  enabledFilters?: ToolbarFilterKey[],
): Promise<void> {
  const actor = await currentActor();
  const { error } = await supabase
    .from('custom_tabs')
    .insert({ name, platforms, created_by: actor.email });
  if (error) {
    if (error.code === '23505') throw new Error(`A tab named "${name}" already exists.`);
    throw error;
  }
  // Only write a tab_toolbar_filters row when the creator actually narrowed
  // from the default — keeps the table sparse, matching tab_hidden_platforms'
  // "no row means default" shape, and means most tab creations (which never
  // touch this section of the modal) write nothing extra at all.
  if (enabledFilters && !isDefaultFilterSet(enabledFilters)) {
    await setToolbarFilters(name, enabledFilters);
  }
}

function isDefaultFilterSet(filters: ToolbarFilterKey[]): boolean {
  return filters.length === ALL_TOOLBAR_FILTERS.length
    && ALL_TOOLBAR_FILTERS.every((f) => filters.includes(f));
}
```

Immediately after `updateCustomTabPlatforms` (before `deleteCustomTab`), add:

```ts
export async function renameCustomTab(oldName: string, newName: string): Promise<void> {
  const { error } = await supabase.rpc('rename_custom_tab', { old_name: oldName, new_name: newName });
  if (error) throw error;
}

export interface ToolbarFilterRow {
  tab: string;
  enabled_filters: ToolbarFilterKey[];
}

export async function fetchToolbarFilters(client: SupabaseClient = supabase): Promise<ToolbarFilterRow[]> {
  const { data, error } = await client.from('tab_toolbar_filters').select('tab, enabled_filters');
  if (error) throw error;
  return (data ?? []) as ToolbarFilterRow[];
}

export async function setToolbarFilters(tab: string, enabledFilters: ToolbarFilterKey[]): Promise<void> {
  const { error } = await supabase
    .from('tab_toolbar_filters')
    .upsert({ tab, enabled_filters: enabledFilters, updated_by: await currentUserEmail() }, { onConflict: 'tab' });
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- queries.test.ts`
Expected: PASS (9 new tests, all existing tests in this file still pass — the `singletonRpc` addition must not break any test that doesn't reference `.rpc`, since `updateOwnAvatar`'s existing call path isn't exercised by any current test in this file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add renameCustomTab, toolbar filter queries, and createCustomTab filters param"
```

---

### Task 7: `AuthContext.tsx` bootstrap wiring

**Files:**
- Modify: `src/contexts/AuthContext.tsx`

**Interfaces:**
- Consumes: `fetchToolbarFilters` (Task 6), `registerToolbarFilters` (Task 2).

- [ ] **Step 1: Update imports**

Change:

```ts
import { fetchCustomTabs, fetchHiddenTabPlatforms } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
import { registerHiddenTabPlatforms } from '../lib/tab-configs';
```

to:

```ts
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchToolbarFilters } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
import { registerHiddenTabPlatforms, registerToolbarFilters } from '../lib/tab-configs';
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
        ]).then(([p, customTabs, hiddenPlatforms]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          registerHiddenTabPlatforms(hiddenPlatforms);
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
        ]).then(([p, customTabs, hiddenPlatforms, toolbarFilters]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          registerHiddenTabPlatforms(hiddenPlatforms);
          registerToolbarFilters(toolbarFilters);
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
git commit -m "feat: fetch and register toolbar filter overrides at session bootstrap"
```

---

### Task 8: `AddBrandTabModal.tsx` filter checkboxes + `Sidebar.tsx` wiring

**Files:**
- Modify: `src/components/AddBrandTabModal.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `TOOLBAR_FILTER_LIST`, `ALL_TOOLBAR_FILTERS`, `type ToolbarFilterKey`, `registerToolbarFilters` (Task 2), `createCustomTab` with 3rd param (Task 6).
- Produces: `AddBrandTabModal`'s `onCreated` prop signature becomes `(name: string, platforms: DynamicTabPlatform[], enabledFilters: ToolbarFilterKey[]) => void`.

- [ ] **Step 1: Rewrite `AddBrandTabModal.tsx`**

Replace the full file with:

```tsx
// src/components/AddBrandTabModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createCustomTab } from '../lib/queries';
import { PLATFORM_LIST, type DynamicTabPlatform } from '../lib/dynamicTabRegistry';
import { TOOLBAR_FILTER_LIST, ALL_TOOLBAR_FILTERS, type ToolbarFilterKey } from '../lib/tab-configs';
import { validateNewTabName } from '../lib/tabValidation';

interface Props {
  onCreated: (name: string, platforms: DynamicTabPlatform[], enabledFilters: ToolbarFilterKey[]) => void;
  onClose: () => void;
}

export default function AddBrandTabModal({ onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [platforms, setPlatforms] = useState<DynamicTabPlatform[]>([]);
  const [filters, setFilters] = useState<ToolbarFilterKey[]>(() => [...ALL_TOOLBAR_FILTERS]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every close affordance (Escape, the X button, the backdrop) is inert while
  // a create is in flight — closing mid-submit would let createCustomTab's
  // insert land server-side with no local registerDynamicTabs call and no
  // navigation, leaving the tab in the DB but invisible until a page reload.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

  function handleRequestClose() {
    if (submitting) return;
    onClose();
  }

  function togglePlatform(p: DynamicTabPlatform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function toggleFilter(f: ToolbarFilterKey) {
    setFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    const nameError = validateNewTabName(trimmed);
    if (nameError) {
      setError(nameError);
      return;
    }
    if (platforms.length === 0) {
      setError('Select at least one platform to track.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createCustomTab(trimmed, platforms, filters);
      onCreated(trimmed, platforms, filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tab');
      setSubmitting(false);
    }
  }

  // z-50, not z-40: this modal is opened from inside the mobile drawer
  // (z-[45] backdrop / z-50 panel), so anything lower renders behind it and
  // makes the whole feature unreachable on a phone.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleRequestClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Add Brand Tab</h2>
          <button
            onClick={handleRequestClose}
            disabled={submitting}
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
              onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) handleSubmit(); }}
              placeholder="e.g. Sunset Partners"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Platforms</label>
            {PLATFORM_LIST.map(({ key, label }) => (
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

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Toolbar Filters</label>
            {TOOLBAR_FILTER_LIST.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 mb-1.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.includes(key)}
                  onChange={() => toggleFilter(key)}
                  className="size-4"
                />
                {label}
              </label>
            ))}
            <p className="mt-1 text-xs text-slate-400">
              Choose which filter dropdowns appear on this tab's toolbar. You can change this later.
            </p>
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

- [ ] **Step 2: Update `Sidebar.tsx`**

Change the tab-configs import:

```ts
import { getTabPlatforms } from '../lib/tab-configs';
```

to:

```ts
import { getTabPlatforms, registerToolbarFilters, type ToolbarFilterKey } from '../lib/tab-configs';
```

Change `handleTabCreated`:

```ts
  function handleTabCreated(name: string, platforms: DynamicTabPlatform[]) {
    registerDynamicTabs([{ name, platforms }]);
    setShowAddTab(false);
    navigate(`/brands/${tabToSlug(name)}`);
    onClose?.();
  }
```

to:

```ts
  function handleTabCreated(name: string, platforms: DynamicTabPlatform[], enabledFilters: ToolbarFilterKey[]) {
    registerDynamicTabs([{ name, platforms }]);
    registerToolbarFilters([{ tab: name, enabled_filters: enabledFilters }]);
    setShowAddTab(false);
    navigate(`/brands/${tabToSlug(name)}`);
    onClose?.();
  }
```

- [ ] **Step 3: Run the full suite and build**

Run: `npm test` then `npm run build`
Expected: both pass. No new test files for these two components (matches this project's existing convention of verifying them via build + live check).

- [ ] **Step 4: Commit**

```bash
git add src/components/AddBrandTabModal.tsx src/components/Sidebar.tsx
git commit -m "feat: add toolbar filter selection to Add Brand Tab"
```

---

### Task 9: `EditBrandTabModal.tsx` (renamed from `EditBrandTabPlatformsModal.tsx`) + `BrandGroup.tsx` wiring

**Files:**
- Create: `src/components/EditBrandTabModal.tsx`
- Delete: `src/components/EditBrandTabPlatformsModal.tsx`
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `validateNewTabName` (Task 1), `TOOLBAR_FILTER_LIST`/`getEnabledToolbarFilters`/`registerToolbarFilters`/`type ToolbarFilterKey` (Task 2), `renameDynamicTab` (Task 3), `renameCustomTab`/`setToolbarFilters` (Task 6).
- Produces: default-exported `EditBrandTabModal` component. Its `onUpdated` prop signature is `(renamedTo?: string) => void` — called with the new name if a rename happened, `undefined` otherwise, so the caller (`BrandGroup.tsx`) knows whether to navigate.

This task is deliberately one commit, not two: creating `EditBrandTabModal.tsx` without also updating its one caller (`BrandGroup.tsx`, which still imports the deleted `EditBrandTabPlatformsModal`) leaves the build broken, so both changes land together.

- [ ] **Step 1: Create `EditBrandTabModal.tsx`**

```tsx
// src/components/EditBrandTabModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
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

interface Props {
  tabName: string;
  onUpdated: (renamedTo?: string) => void;
  onClose: () => void;
}

export default function EditBrandTabModal({ tabName, onUpdated, onClose }: Props) {
  const dynamic = isDynamicTab(tabName);
  // Checkbox universe: a dynamic tab can gain a genuinely new platform, so it
  // always offers all 4. A hardcoded tab's schema is permanently fixed — it
  // can only ever hide/show what it already has real columns for.
  const toggleable: DynamicTabPlatform[] = dynamic
    ? PLATFORM_LIST.map((p) => p.key)
    : (getTabPlatformsUnfiltered(tabName) as DynamicTabPlatform[]);
  const [name, setName] = useState(tabName);
  const [platforms, setPlatforms] = useState<DynamicTabPlatform[]>(
    () => getTabPlatforms(tabName) as DynamicTabPlatform[],
  );
  const [filters, setFilters] = useState<ToolbarFilterKey[]>(
    () => getEnabledToolbarFilters(tabName),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

  function handleRequestClose() {
    if (submitting) return;
    onClose();
  }

  function togglePlatform(p: DynamicTabPlatform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function toggleFilter(f: ToolbarFilterKey) {
    setFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  async function handleSubmit() {
    const trimmedName = name.trim();
    const isRename = dynamic && trimmedName !== tabName;
    if (isRename) {
      const nameError = validateNewTabName(trimmedName);
      if (nameError) {
        setError(nameError);
        return;
      }
    }
    if (platforms.length === 0) {
      setError('Select at least one platform to track.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let currentTabName = tabName;
      if (isRename) {
        await renameCustomTab(tabName, trimmedName);
        renameDynamicTab(tabName, trimmedName, platforms);
        currentTabName = trimmedName;
      }
      if (dynamic) {
        await updateCustomTabPlatforms(currentTabName, platforms);
        registerDynamicTabs([{ name: currentTabName, platforms }]);
      } else {
        const before = new Set(getTabPlatforms(currentTabName));
        const after = new Set(platforms);
        for (const p of toggleable) {
          const wasVisible = before.has(p);
          const nowVisible = after.has(p);
          if (wasVisible === nowVisible) continue;
          await setTabPlatformHidden(currentTabName, p, !nowVisible);
          if (nowVisible) unregisterHiddenTabPlatform(currentTabName, p);
          else registerHiddenTabPlatforms([{ tab: currentTabName, platform: p }]);
        }
      }
      await setToolbarFilters(currentTabName, filters);
      registerToolbarFilters([{ tab: currentTabName, enabled_filters: filters }]);
      onUpdated(isRename ? currentTabName : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tab');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleRequestClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Edit Brand Tab</h2>
          <button
            onClick={handleRequestClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tab name</label>
            {dynamic ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <>
                <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">{tabName}</p>
                <p className="mt-1 text-xs text-slate-400">Hardcoded tabs can't be renamed.</p>
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Platforms</label>
            {PLATFORM_LIST.filter((p) => toggleable.includes(p.key)).map(({ key, label }) => (
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
            <p className="mt-1 text-xs text-slate-400">
              Unchecking a platform hides its columns and data — nothing is deleted, and re-checking it brings everything back.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Toolbar Filters</label>
            {TOOLBAR_FILTER_LIST.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 mb-1.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.includes(key)}
                  onChange={() => toggleFilter(key)}
                  className="size-4"
                />
                {label}
              </label>
            ))}
            <p className="mt-1 text-xs text-slate-400">
              Choose which filter dropdowns appear on this tab's toolbar. A filter can still stay hidden if the tab's data doesn't have enough distinct values.
            </p>
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the old file**

Run: `git rm src/components/EditBrandTabPlatformsModal.tsx`

- [ ] **Step 3: Update `BrandGroup.tsx` imports**

Change:

```ts
import EditBrandTabPlatformsModal from '../components/EditBrandTabPlatformsModal';
```

to:

```ts
import EditBrandTabModal from '../components/EditBrandTabModal';
```

Change:

```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount, getBrandGroup, BRAND_COLS, TABLE_HIDDEN_COLS, PLATFORM_SCORE_COLS, accountUsageKey } from '../lib/tab-configs';
```

to:

```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount, getBrandGroup, BRAND_COLS, TABLE_HIDDEN_COLS, PLATFORM_SCORE_COLS, accountUsageKey, getEnabledToolbarFilters } from '../lib/tab-configs';
```

- [ ] **Step 4: Compute `enabledFilters`**

Immediately after the closing of the `activePlatforms` computation (the `})();` line right after the `hasMultiPlatform`/`getTabPlatforms` block), add:

```ts
  // Which of the 6 toolbar filter dropdowns this tab allows — an explicit
  // allow-list on top of (never wider than) each dropdown's own
  // data-cardinality auto-hide check below.
  const enabledFilters = getEnabledToolbarFilters(decodedTab);
```

- [ ] **Step 5: Update the pencil button's tooltip and modal usage**

Change:

```tsx
          {isApproved && (
            <Tooltip content={`Edit ${tabDisplayName(decodedTab)}'s platforms`}>
              <button
                type="button"
                onClick={() => setShowEditPlatformsModal(true)}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-blue-50 hover:text-slate-700 transition-colors"
              >
                <Pencil className="size-4" />
              </button>
            </Tooltip>
          )}
```

to:

```tsx
          {isApproved && (
            <Tooltip content={`Edit ${tabDisplayName(decodedTab)}`}>
              <button
                type="button"
                onClick={() => setShowEditPlatformsModal(true)}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-blue-50 hover:text-slate-700 transition-colors"
              >
                <Pencil className="size-4" />
              </button>
            </Tooltip>
          )}
```

Change:

```tsx
      {showEditPlatformsModal && (
        <EditBrandTabPlatformsModal
          tabName={decodedTab}
          onClose={() => setShowEditPlatformsModal(false)}
          onUpdated={() => {
            setShowEditPlatformsModal(false);
            reloadRef.current();
          }}
        />
      )}
```

to:

```tsx
      {showEditPlatformsModal && (
        <EditBrandTabModal
          tabName={decodedTab}
          onClose={() => setShowEditPlatformsModal(false)}
          onUpdated={(renamedTo) => {
            setShowEditPlatformsModal(false);
            if (renamedTo) {
              navigate(`/brands/${tabToSlug(renamedTo)}`);
            } else {
              reloadRef.current();
            }
          }}
        />
      )}
```

- [ ] **Step 6: Guard the 6 toolbar filter dropdowns**

Change:

```tsx
          {uniqueBrands.length > 1 && !NO_BRAND_FILTER_TABS.has(decodedTab) && (
            <MultiSelectDropdown
              noun="brand"
```

to:

```tsx
          {uniqueBrands.length > 1 && !NO_BRAND_FILTER_TABS.has(decodedTab) && enabledFilters.includes('brand') && (
            <MultiSelectDropdown
              noun="brand"
```

Change:

```tsx
          {uniqueAgents.length > 1 && (
            <MultiSelectDropdown
              noun="agent"
```

to:

```tsx
          {uniqueAgents.length > 1 && enabledFilters.includes('agent') && (
            <MultiSelectDropdown
              noun="agent"
```

Change:

```tsx
          {uniqueProxies.length > 1 && (
            <MultiSelectDropdown
              noun="proxie"
```

to:

```tsx
          {uniqueProxies.length > 1 && enabledFilters.includes('proxy') && (
            <MultiSelectDropdown
              noun="proxie"
```

Change:

```tsx
          {uniqueCountries.length > 1 && (
            <MultiSelectDropdown
              noun="countrie"
```

to:

```tsx
          {uniqueCountries.length > 1 && enabledFilters.includes('country') && (
            <MultiSelectDropdown
              noun="countrie"
```

Change:

```tsx
          <MultiSelectDropdown
            noun="statuse"
            values={statusFilter}
            onChange={(v) => { setStatusFilter(v as StatusValue[]); setPage(1); }}
            options={STATUS_MULTI_OPTS}
          />
```

to:

```tsx
          {enabledFilters.includes('status') && (
            <MultiSelectDropdown
              noun="statuse"
              values={statusFilter}
              onChange={(v) => { setStatusFilter(v as StatusValue[]); setPage(1); }}
              options={STATUS_MULTI_OPTS}
            />
          )}
```

Change:

```tsx
          {activePlatforms.length > 1 && (
            <MultiSelectDropdown
              noun="platform"
```

to:

```tsx
          {activePlatforms.length > 1 && enabledFilters.includes('platform') && (
            <MultiSelectDropdown
              noun="platform"
```

- [ ] **Step 7: Run the full suite and build**

Run: `npm test` then `npm run build`
Expected: both pass — no remaining reference to the deleted `EditBrandTabPlatformsModal` anywhere.

- [ ] **Step 8: Commit**

```bash
git add src/components/EditBrandTabModal.tsx src/pages/BrandGroup.tsx
git commit -m "feat: broaden Edit Platforms into Edit Brand Tab (rename + toolbar filters)"
```

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npm test` then `npm run build`
Expected: full suite passes (existing count + the ~20 new tests added across Tasks 1, 2, 3, 6), build succeeds with no TypeScript errors.

- [ ] **Step 2: Grep for any remaining reference to the old modal name**

Run: `grep -rn "EditBrandTabPlatformsModal" src/`
Expected: no results.

- [ ] **Step 3: Live verification (per this project's standing bar for UI changes)**

Using a throwaway dynamic tab, not an existing production tab with real entries, given the number of tables a rename touches:

1. Create a throwaway dynamic tab via the updated "+ Add Brand Tab" flow with a couple of toolbar filters unchecked (e.g. leave only Brand and Status checked). Confirm its toolbar shows only Brand and Status immediately after creation, with no reload.
2. Add 2-3 entries to it via "Add Review Account" so it has real, distinct Brand/Agent/Proxy/Country/Status values.
3. Rename it via the pencil → Edit Brand Tab modal. Confirm: the URL updates to the new slug, the Sidebar link updates with no reload, the entries are still visible and correctly attributed to the tab under its new name, and the toolbar filter selection (Brand + Status only) is unchanged after the rename.
4. Re-open Edit Brand Tab and widen the toolbar filters back to all 6. Confirm all 6 dropdowns now show (each still independently subject to its own data-cardinality auto-hide).
5. Toggle a filter off on a real, low-entry-count hardcoded tab (not a high-traffic one like Rooster Partners) — confirm the dropdown disappears regardless of that tab's real data cardinality — then restore it to all-6 afterward.
6. Delete the throwaway dynamic tab via the existing delete flow to clean up.

- [ ] **Step 4: Update `docs/task-history.md`**

Append an entry documenting this task per this project's standing PMS/task-history workflow (see the project's own `feedback_pms_task_workflow`/`project_pms_workflow` conventions) — summarize what shipped, the migrations applied (or still pending, if `supabase db push` wasn't run live in Task 4/5), and the live verification performed in Step 3.
