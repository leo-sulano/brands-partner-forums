# Hardcoded Brand Tab Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any of the 11 hardcoded Brand Tabs (`TAB_COLUMN_CONFIGS` in `src/lib/tab-configs.ts`) be truly renamed from the Edit Brand Tab modal, the same way a dynamic (`custom_tabs`-backed) tab already can — real identity change (URL slug, `entries.tab`, every other tab-keyed table), not a cosmetic label swap.

**Architecture:** A hardcoded tab's `TAB_COLUMN_CONFIGS` key never changes — it becomes a permanent internal "original name." A new DB table + RPC + in-memory registry maps that permanent key to the tab's current live name. Every place in the codebase that indexes a hardcoded-name-keyed map (column labels, brand-URL overrides, `TAB_ICONS`, etc.) resolves the incoming tab string back to its original key first via one shared `resolveHardcodedTabKey()` function before doing the lookup.

**Tech Stack:** React 19 + TypeScript (frontend), Supabase Postgres (RPC + RLS), Vitest, Deno (2 Edge Functions share the resolver via `tabRegistryBootstrap.ts`).

**Spec:** `docs/superpowers/specs/2026-09-01-hardcoded-tab-rename-design.md`

## Global Constraints

- A hardcoded tab's *original* `TAB_COLUMN_CONFIGS` key is permanently reserved — it can never be reused by a new dynamic tab or a later rename, even after the tab itself has been renamed away from it (unchanged existing rule in `tabValidation.ts`, verified by a new regression test in Task 4).
- Every new/modified file that is imported (directly or transitively) by `src/lib/tabRegistryBootstrap.ts` — i.e. `hardcodedTabRenameRegistry.ts`, `tab-configs.ts`, `queries.ts`, `tabs.ts` — MUST use explicit `.ts` extensions on its own relative imports of other such files (this project's Supabase deploy bundler rejects extensionless imports; see CLAUDE.md Known Issues). `tabIcons.ts` and React components are frontend-only and follow the existing extensionless convention already used in those files.
- No new npm dependencies.
- `rename_hardcoded_tab` is a **new, separate** RPC — never modify the existing `rename_custom_tab` function, which every dynamic-tab rename already depends on.

---

### Task 1: Database migrations — `hardcoded_tab_renames` table + `rename_hardcoded_tab` RPC

**Files:**
- Create: `supabase/migrations/20260901130000_add_hardcoded_tab_renames.sql`
- Create: `supabase/migrations/20260901140000_add_rename_hardcoded_tab_function.sql`

**Interfaces:**
- Produces: table `public.hardcoded_tab_renames(original_name text primary key, current_name text not null unique, updated_by text, updated_at timestamptz)`; RPC `public.rename_hardcoded_tab(old_name text, new_name text) returns void`, callable by `authenticated`.

- [ ] **Step 1: Write the table migration**

```sql
-- supabase/migrations/20260901130000_add_hardcoded_tab_renames.sql
-- Maps a hardcoded tab's permanent TAB_COLUMN_CONFIGS key (original_name) to
-- its current live name, so the 11 hardcoded tabs in
-- src/lib/tab-configs.ts can be truly renamed without a code deploy.
-- Mirrors tab_icon_overrides' shape and RLS exactly
-- (docs/superpowers/specs/2026-09-01-hardcoded-tab-rename-design.md).
-- A hardcoded tab that has never been renamed has no row here at all --
-- src/lib/hardcodedTabRenameRegistry.ts's resolveHardcodedTabKey() treats
-- "no row" as "current name == original name."
create table public.hardcoded_tab_renames (
  original_name text primary key,
  current_name  text not null unique,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

alter table public.hardcoded_tab_renames enable row level security;

create policy "anyone can read hardcoded_tab_renames"
  on public.hardcoded_tab_renames for select using (true);
create policy "approved users can insert hardcoded_tab_renames"
  on public.hardcoded_tab_renames for insert with check (public.is_approved());
create policy "approved users can update hardcoded_tab_renames"
  on public.hardcoded_tab_renames for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete hardcoded_tab_renames"
  on public.hardcoded_tab_renames for delete using (public.is_approved());
```

- [ ] **Step 2: Write the RPC migration**

```sql
-- supabase/migrations/20260901140000_add_rename_hardcoded_tab_function.sql
-- Atomically renames a hardcoded Brand Tab across every table keyed by its
-- name. A sibling to rename_custom_tab (20260819110000), never a
-- modification of it -- every existing dynamic-tab rename already depends
-- on that function behaving exactly as it does today. Reuses the same
-- information_schema-driven "find every table with a `tab` text column and
-- rewrite it" technique for the same reason that function does: this
-- project has already renamed tab-scoped tables more than once, and a
-- hardcoded list here would silently stop covering a newly added one.
create or replace function public.rename_hardcoded_tab(old_name text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_original text;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;

  -- Resolve old_name to its permanent original key: if old_name is already
  -- someone's current_name, this is at least the second rename of this tab
  -- -- reuse that row's original_name. Otherwise old_name IS the original
  -- key (first-ever rename of this tab).
  select original_name into v_original
  from public.hardcoded_tab_renames
  where current_name = old_name;

  if v_original is null then
    v_original := old_name;
  end if;

  if exists (select 1 from public.hardcoded_tab_renames where current_name = new_name)
     or exists (select 1 from public.custom_tabs where name = new_name) then
    raise exception 'a tab named "%" already exists', new_name;
  end if;

  insert into public.hardcoded_tab_renames (original_name, current_name)
  values (v_original, new_name)
  on conflict (original_name) do update set current_name = excluded.current_name, updated_at = now();

  for rec in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'tab'
      and table_name <> 'custom_tabs'
      and table_name <> 'hardcoded_tab_renames'
  loop
    execute format('update public.%I set tab = $1 where tab = $2', rec.table_name)
      using new_name, old_name;
  end loop;
end;
$$;

grant execute on function public.rename_hardcoded_tab(text, text) to authenticated;
```

- [ ] **Step 3: Verify both files are valid, self-contained SQL**

No local Supabase DB is available in this environment to run the migrations against. Read both
files back and confirm: table/column names match the RPC's references exactly; the RPC's
`information_schema` loop excludes both `custom_tabs` and the new `hardcoded_tab_renames` table
itself (the latter has no `tab` column, so this exclusion is redundant but explicit); RLS policy
names don't collide with any existing migration (grep the `supabase/migrations/` directory for
`hardcoded_tab_renames` and `rename_hardcoded_tab` to confirm no prior file already used these
names).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260901130000_add_hardcoded_tab_renames.sql supabase/migrations/20260901140000_add_rename_hardcoded_tab_function.sql
git commit -m "feat: add hardcoded_tab_renames table and rename_hardcoded_tab RPC"
```

---

### Task 2: `hardcodedTabRenameRegistry.ts` — the resolver registry

**Files:**
- Create: `src/lib/hardcodedTabRenameRegistry.ts`
- Test: `src/lib/hardcodedTabRenameRegistry.test.ts`

**Interfaces:**
- Produces: `resolveHardcodedTabKey(tab: string): string`, `isRenamedHardcodedTab(tab: string): boolean`, `registerHardcodedTabRenames(rows: { original_name: string; current_name: string }[]): void`, `renameHardcodedTabLocally(oldCurrentName: string, newCurrentName: string): void`, `resetHardcodedTabRenames(): void`.
- Consumes: nothing (dependency-free, no imports — same constraint as `tabIconOverrideRegistry.ts`, so `tab-configs.ts`, `tabs.ts`, and `tabIcons.ts` can all import this module directly without an import cycle, and Deno Edge Functions can import it safely).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/hardcodedTabRenameRegistry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveHardcodedTabKey, isRenamedHardcodedTab, registerHardcodedTabRenames,
  renameHardcodedTabLocally, resetHardcodedTabRenames,
} from './hardcodedTabRenameRegistry';

describe('hardcodedTabRenameRegistry', () => {
  beforeEach(() => {
    resetHardcodedTabRenames();
  });

  it('resolveHardcodedTabKey is a no-op passthrough for a tab never renamed', () => {
    expect(resolveHardcodedTabKey('Hanan')).toBe('Hanan');
  });

  it('isRenamedHardcodedTab is false for a tab never renamed', () => {
    expect(isRenamedHardcodedTab('Hanan')).toBe(false);
  });

  it('registerHardcodedTabRenames makes resolveHardcodedTabKey resolve the current name back to the original', () => {
    registerHardcodedTabRenames([{ original_name: 'TP Brand Injection', current_name: 'BITP Team' }]);
    expect(resolveHardcodedTabKey('BITP Team')).toBe('TP Brand Injection');
    expect(isRenamedHardcodedTab('BITP Team')).toBe(true);
  });

  it('resolveHardcodedTabKey on the original name itself is unaffected by a registered rename', () => {
    registerHardcodedTabRenames([{ original_name: 'TP Brand Injection', current_name: 'BITP Team' }]);
    expect(resolveHardcodedTabKey('TP Brand Injection')).toBe('TP Brand Injection');
  });

  it('renameHardcodedTabLocally moves a first-time rename from the original name', () => {
    renameHardcodedTabLocally('Rooster Partners', 'RP Group');
    expect(resolveHardcodedTabKey('RP Group')).toBe('Rooster Partners');
    expect(isRenamedHardcodedTab('RP Group')).toBe(true);
    expect(isRenamedHardcodedTab('Rooster Partners')).toBe(false);
  });

  it('renameHardcodedTabLocally moves a second rename, preserving the original key', () => {
    renameHardcodedTabLocally('Rooster Partners', 'RP Group');
    renameHardcodedTabLocally('RP Group', 'RP Group 2');
    expect(resolveHardcodedTabKey('RP Group 2')).toBe('Rooster Partners');
    expect(isRenamedHardcodedTab('RP Group')).toBe(false);
    expect(isRenamedHardcodedTab('RP Group 2')).toBe(true);
  });

  it('resetHardcodedTabRenames clears all registered renames', () => {
    registerHardcodedTabRenames([{ original_name: 'TP Brand Injection', current_name: 'BITP Team' }]);
    resetHardcodedTabRenames();
    expect(resolveHardcodedTabKey('BITP Team')).toBe('BITP Team');
    expect(isRenamedHardcodedTab('BITP Team')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hardcodedTabRenameRegistry`
Expected: FAIL — `hardcodedTabRenameRegistry` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/hardcodedTabRenameRegistry.ts
// Maps a hardcoded tab's permanent TAB_COLUMN_CONFIGS key ("original name")
// to its current live name (docs/superpowers/specs/2026-09-01-hardcoded-tab-rename-design.md).
// Dependency-free, like tabIconOverrideRegistry.ts, so tab-configs.ts,
// tabs.ts, and tabIcons.ts can all import this module directly without
// creating an import cycle, and Deno Edge Functions can import it safely.
//
// Every hardcoded-name-keyed map lookup in the codebase (TAB_COLUMN_LABELS,
// TAB_BRAND_SEQUENCE, TAB_ICONS, SLUG_OVERRIDES, etc.) must resolve its `tab`
// argument through resolveHardcodedTabKey() before indexing -- those maps
// are still keyed by each tab's permanent original name, never its
// possibly-renamed current name.
const originalToCurrentMap: Record<string, string> = {};
const currentToOriginalMap: Record<string, string> = {};

export function registerHardcodedTabRenames(
  rows: { original_name: string; current_name: string }[],
): void {
  for (const row of rows) {
    originalToCurrentMap[row.original_name] = row.current_name;
    currentToOriginalMap[row.current_name] = row.original_name;
  }
}

// Called locally right after a successful rename_hardcoded_tab RPC call --
// the same "server call, then local registry update" two-step every other
// tab-scoped registry in this codebase already uses (e.g.
// renameTabIconOverride alongside upsertTabIconOverride).
export function renameHardcodedTabLocally(oldCurrentName: string, newCurrentName: string): void {
  const original = currentToOriginalMap[oldCurrentName] ?? oldCurrentName;
  delete currentToOriginalMap[oldCurrentName];
  delete originalToCurrentMap[original];
  currentToOriginalMap[newCurrentName] = original;
  originalToCurrentMap[original] = newCurrentName;
}

// The one function every hardcoded-name-keyed map lookup in the codebase
// must resolve `tab` through before indexing. A no-op passthrough for any
// tab never renamed (the common case for 9 of the 11 hardcoded tabs, and
// every dynamic tab, which has no row here at all).
export function resolveHardcodedTabKey(tab: string): string {
  return currentToOriginalMap[tab] ?? tab;
}

// True once `tab` (a live/current name) is known to be the result of at
// least one real rename -- used by tabDisplayName() in tabs.ts to let a
// true rename supersede the older TAB_DISPLAY_NAMES cosmetic-alias
// mechanism.
export function isRenamedHardcodedTab(tab: string): boolean {
  return tab in currentToOriginalMap;
}

export function resetHardcodedTabRenames(): void {
  for (const key of Object.keys(originalToCurrentMap)) delete originalToCurrentMap[key];
  for (const key of Object.keys(currentToOriginalMap)) delete currentToOriginalMap[key];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- hardcodedTabRenameRegistry`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/hardcodedTabRenameRegistry.ts src/lib/hardcodedTabRenameRegistry.test.ts
git commit -m "feat: add hardcodedTabRenameRegistry with resolveHardcodedTabKey"
```

---

### Task 3: `queries.ts` — `fetchHardcodedTabRenames` / `renameHardcodedTab`

**Files:**
- Modify: `src/lib/queries.ts` (add near the existing `renameCustomTab`, around line 1956)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: nothing new (same `supabase` singleton every other function in this file uses).
- Produces: `fetchHardcodedTabRenames(client?: SupabaseClient): Promise<{ original_name: string; current_name: string }[]>`, `renameHardcodedTab(oldName: string, newName: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add to the existing import list at the top of `src/lib/queries.test.ts` (alongside `renameCustomTab`):

```ts
  renameCustomTab,
  fetchHardcodedTabRenames,
  renameHardcodedTab,
```

Add this new `describe` block right after the existing `describe('renameCustomTab', ...)` block (around line 1182):

```ts
describe('fetchHardcodedTabRenames / renameHardcodedTab', () => {
  beforeEach(() => {
    singletonRpc.mockReset();
  });

  it('fetchHardcodedTabRenames maps rows to original_name/current_name', async () => {
    singletonFrom.mockReturnValue(
      chain({ data: [{ original_name: 'TP Brand Injection', current_name: 'BITP Team' }], error: null }),
    );
    const rows = await fetchHardcodedTabRenames();
    expect(rows).toEqual([{ original_name: 'TP Brand Injection', current_name: 'BITP Team' }]);
  });

  it('renameHardcodedTab calls the rename_hardcoded_tab RPC with old and new names', async () => {
    singletonRpc.mockResolvedValue({ error: null });
    await renameHardcodedTab('TP Brand Injection', 'BITP Team');
    expect(singletonRpc).toHaveBeenCalledWith('rename_hardcoded_tab', {
      old_name: 'TP Brand Injection',
      new_name: 'BITP Team',
    });
  });

  it('renameHardcodedTab throws the RPC error', async () => {
    singletonRpc.mockResolvedValue({ error: new Error('a tab named "X" already exists') });
    await expect(renameHardcodedTab('Hanan', 'X')).rejects.toThrow('a tab named "X" already exists');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- queries.test`
Expected: FAIL — `fetchHardcodedTabRenames`/`renameHardcodedTab` are not exported from `./queries`.

- [ ] **Step 3: Write the implementation**

Insert immediately after the existing `renameCustomTab` function in `src/lib/queries.ts` (around line 1959):

```ts
export interface HardcodedTabRenameRow {
  original_name: string;
  current_name: string;
}

export async function fetchHardcodedTabRenames(
  client: SupabaseClient = supabase,
): Promise<HardcodedTabRenameRow[]> {
  const { data, error } = await client.from('hardcoded_tab_renames').select('original_name, current_name');
  if (error) throw error;
  return (data ?? []) as HardcodedTabRenameRow[];
}

export async function renameHardcodedTab(oldName: string, newName: string): Promise<void> {
  const { error } = await supabase.rpc('rename_hardcoded_tab', { old_name: oldName, new_name: newName });
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- queries.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add fetchHardcodedTabRenames/renameHardcodedTab query functions"
```

---

### Task 4: `tabs.ts` — `renameOperationalTab`, resolver-aware `tabToSlug`/`tabDisplayName`

**Files:**
- Modify: `src/lib/tabs.ts`
- Test: `src/lib/tabs.test.ts`
- Test: `src/lib/tabValidation.test.ts` (regression test for the permanently-reserved-original-name rule)

**Interfaces:**
- Consumes: `resolveHardcodedTabKey`, `isRenamedHardcodedTab`, `renameHardcodedTabLocally`, `resetHardcodedTabRenames` from `./hardcodedTabRenameRegistry.ts` (Task 2).
- Produces: `renameOperationalTab(oldName: string, newName: string): void`.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/lib/tabs.test.ts`:

```ts
// src/lib/tabs.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { tabDisplayName, tabToSlug, OPERATIONAL_TABS, renameOperationalTab } from './tabs';
import { renameHardcodedTabLocally, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';

describe('tabDisplayName', () => {
  afterEach(() => {
    resetHardcodedTabRenames();
  });

  it('renames TP Affiliate to FTP', () => {
    expect(tabDisplayName('TP Affiliate')).toBe('FTP');
  });

  it('renames TP Brand Injection to BITP', () => {
    expect(tabDisplayName('TP Brand Injection')).toBe('BITP');
  });

  it('returns every other tab unchanged', () => {
    expect(tabDisplayName('Hanan')).toBe('Hanan');
    expect(tabDisplayName('Wizard of Odds')).toBe('Wizard of Odds');
    expect(tabDisplayName('GRG - Gulf Recovery Group')).toBe('GRG - Gulf Recovery Group');
  });

  it('a true rename of a tab with a cosmetic alias supersedes the alias', () => {
    renameHardcodedTabLocally('TP Brand Injection', 'BITP Team');
    expect(tabDisplayName('BITP Team')).toBe('BITP Team');
  });

  it('a true rename of a tab with no cosmetic alias just returns the new name', () => {
    renameHardcodedTabLocally('Hanan', 'Hanan Group');
    expect(tabDisplayName('Hanan Group')).toBe('Hanan Group');
  });
});

describe('tabToSlug', () => {
  afterEach(() => {
    resetHardcodedTabRenames();
  });

  it('slugifies a plain tab name', () => {
    expect(tabToSlug('Hanan')).toBe('hanan');
  });

  it('uses the SLUG_OVERRIDES entry for GRG - Gulf Recovery Group', () => {
    expect(tabToSlug('GRG - Gulf Recovery Group')).toBe('gulf-recovery-group');
  });

  it('a renamed tab with a slug override keeps using the override, resolved by its original key', () => {
    renameHardcodedTabLocally('GRG - Gulf Recovery Group', 'Gulf Group Renamed');
    expect(tabToSlug('Gulf Group Renamed')).toBe('gulf-recovery-group');
  });

  it('a renamed tab with no slug override slugifies its new name', () => {
    renameHardcodedTabLocally('Hanan', 'Hanan Group');
    expect(tabToSlug('Hanan Group')).toBe('hanan-group');
  });
});

describe('renameOperationalTab', () => {
  afterEach(() => {
    const idx = OPERATIONAL_TABS.indexOf('Hanan Renamed');
    if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1, 'Hanan');
  });

  it('renames a hardcoded tab in place, preserving its OPERATIONAL_TABS position', () => {
    const idxBefore = OPERATIONAL_TABS.indexOf('Hanan');
    renameOperationalTab('Hanan', 'Hanan Renamed');
    expect(OPERATIONAL_TABS.indexOf('Hanan Renamed')).toBe(idxBefore);
    expect(OPERATIONAL_TABS).not.toContain('Hanan');
  });

  it('is a no-op when the old name is not currently in OPERATIONAL_TABS', () => {
    const before = [...OPERATIONAL_TABS];
    renameOperationalTab('Never A Real Tab', 'Also Never');
    expect(OPERATIONAL_TABS).toEqual(before);
  });
});
```

Add this regression test to `src/lib/tabValidation.test.ts`, in the existing `describe('validateNewTabName', ...)` block, and add the two new imports it needs:

```ts
import { validateNewTabName } from './tabValidation';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';
import { archiveTabLocally, unarchiveTabLocally } from './archivedTabRegistry';
import { renameOperationalTab } from './tabs';
import { renameHardcodedTabLocally, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';
```

```ts
  it('still rejects a hardcoded tab\'s original name even after that tab has been renamed away from it', () => {
    renameOperationalTab('Hanan', 'Hanan Renamed');
    renameHardcodedTabLocally('Hanan', 'Hanan Renamed');
    expect(validateNewTabName('Hanan')).toBe('A tab named "Hanan" already exists.');
    // cleanup: revert both the OPERATIONAL_TABS splice and the registry entry
    renameOperationalTab('Hanan Renamed', 'Hanan');
    resetHardcodedTabRenames();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tabs.test tabValidation.test`
Expected: FAIL — `renameOperationalTab` is not exported from `./tabs`; the new `tabToSlug`/`tabDisplayName` rename-interaction tests fail because neither function resolves through the registry yet.

- [ ] **Step 3: Write the implementation**

Modify `src/lib/tabs.ts`:

```ts
import { TAB_COLUMN_CONFIGS } from './tab-configs.ts';
import { resolveHardcodedTabKey, isRenamedHardcodedTab } from './hardcodedTabRenameRegistry.ts';
```

```ts
export function tabToSlug(tab: string): string {
  return SLUG_OVERRIDES[resolveHardcodedTabKey(tab) as OperationalTab] ?? tab.toLowerCase().replace(/\s+/g, '-');
}
```

```ts
export function tabDisplayName(tab: string): string {
  // A true rename (src/lib/hardcodedTabRenameRegistry.ts) always supersedes
  // the older TAB_DISPLAY_NAMES cosmetic alias below -- otherwise renaming
  // 'TP Brand Injection' would keep silently redisplaying it as "BITP"
  // everywhere, hiding the very rename the user just made.
  if (isRenamedHardcodedTab(tab)) return tab;
  return TAB_DISPLAY_NAMES[tab as OperationalTab] ?? tab;
}

// In-place OPERATIONAL_TABS splice for a hardcoded tab rename, mirroring
// dynamicTabRegistry.ts's renameDynamicTab splice exactly -- this is what
// lets every one of OPERATIONAL_TABS' ~12 existing importers (Sidebar,
// Overview, Score Summary, Schedule Planner, both entry modals, BrandGroup)
// pick up a hardcoded-tab rename with zero call-site changes.
export function renameOperationalTab(oldName: string, newName: string): void {
  const idx = OPERATIONAL_TABS.indexOf(oldName);
  if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1, newName);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tabs.test tabValidation.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabs.ts src/lib/tabs.test.ts src/lib/tabValidation.test.ts
git commit -m "feat: add renameOperationalTab and resolver-aware tabToSlug/tabDisplayName"
```

---

### Task 5: `tab-configs.ts` — resolve hardcoded-map lookups through the original key

**Files:**
- Modify: `src/lib/tab-configs.ts`
- Test: `src/lib/tab-configs.test.ts`

**Interfaces:**
- Consumes: `resolveHardcodedTabKey` from `./hardcodedTabRenameRegistry.ts` (Task 2).
- Produces: no new exports — `getTabColumns`, `getColLabel`, `getTabSequence`, `getTabSequenceCol`, `deriveTabBrands`, `getCountryForAccount`, `getBrandGroup`, `getBrandTpUrl`, `resolveBrandLink`, `getBrandLinkCol`, `getTabPlatformsUnfiltered`, `getTabPlatforms` all keep their existing signatures but now correctly resolve a renamed hardcoded tab.

- [ ] **Step 1: Write the failing tests**

Add to the top of `src/lib/tab-configs.test.ts`, alongside the existing imports:

```ts
import {
  TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount, getBrandGroup,
  getTabPlatforms, getTabPlatformsUnfiltered, registerHiddenTabPlatforms,
  unregisterHiddenTabPlatform, resetHiddenTabPlatforms,
  stripDupSuffix, accountUsageKey, hasMultiPlatform, getTabColumns, getBrandNameCol,
  getEnabledToolbarFilters, registerToolbarFilters, unregisterToolbarFilters, resetToolbarFilters, ALL_TOOLBAR_FILTERS,
  getColLabel, getTabSequence, getTabSequenceCol, getBrandTpUrl, getBrandLinkCol, resolveBrandLink,
} from './tab-configs';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';
import { renameHardcodedTabLocally, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';
```

Add this new `describe` block:

```ts
describe('hardcoded tab rename resolution', () => {
  afterEach(() => {
    resetHardcodedTabRenames();
  });

  it('getTabColumns resolves a renamed hardcoded tab back to its original column list', () => {
    renameHardcodedTabLocally('Hanan', 'Hanan Group');
    expect(getTabColumns('Hanan Group')).toEqual(TAB_COLUMN_CONFIGS['Hanan']);
  });

  it('getColLabel resolves a renamed hardcoded tab back to its per-tab label override', () => {
    renameHardcodedTabLocally('Wizard of Odds', 'WO Renamed');
    expect(getColLabel('User Name', 'WO Renamed')).toBe('WO User');
  });

  it('getTabSequence/getTabSequenceCol resolve a renamed hardcoded tab', () => {
    renameHardcodedTabLocally('TP Brand Injection', 'BITP Team');
    expect(getTabSequence('BITP Team')).toEqual(getTabSequence('TP Brand Injection'));
    expect(getTabSequenceCol('BITP Team')).toBe(getTabSequenceCol('TP Brand Injection'));
  });

  it('getCountryForAccount resolves a renamed hardcoded tab\'s default country', () => {
    renameHardcodedTabLocally('SuprPlay Limited', 'SuprPlay Renamed');
    expect(getCountryForAccount('not a delimited value', 'SuprPlay Renamed')).toBe('UK');
  });

  it('getBrandGroup resolves a renamed hardcoded tab (no groups configured today, still resolves without throwing)', () => {
    renameHardcodedTabLocally('TP Affiliate', 'FTP Renamed');
    expect(getBrandGroup('FTP Renamed', 'Any Brand')).toBeNull();
  });

  it('getBrandTpUrl/resolveBrandLink resolve a renamed tab\'s per-tab brand URL override', () => {
    renameHardcodedTabLocally('Wizard of Odds', 'WO Renamed');
    expect(getBrandTpUrl('lucky7even', 'WO Renamed')).toBe(getBrandTpUrl('lucky7even', 'Wizard of Odds'));
  });

  it('getBrandLinkCol resolves a renamed hardcoded tab\'s special-cased link column', () => {
    renameHardcodedTabLocally('Wizard of Odds', 'WO Renamed');
    expect(getBrandLinkCol('WO Renamed')).toBe('Link to the profile');
    renameHardcodedTabLocally('WO Renamed', 'Wizard of Odds');
    renameHardcodedTabLocally('TP Brand Injection', 'BITP Team');
    expect(getBrandLinkCol('BITP Team')).toBe('Brand / TP URL PAGE__href');
  });

  it('getTabPlatformsUnfiltered resolves a renamed Wizard of Odds tab to wo-only', () => {
    renameHardcodedTabLocally('Wizard of Odds', 'WO Renamed');
    expect(getTabPlatformsUnfiltered('WO Renamed')).toEqual(['wo']);
  });

  it('getTabPlatforms resolves a renamed multi-platform hardcoded tab', () => {
    renameHardcodedTabLocally('Hanan', 'Hanan Group');
    expect(getTabPlatforms('Hanan Group')).toEqual(getTabPlatforms('Hanan'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tab-configs.test`
Expected: FAIL — every new test in the `hardcoded tab rename resolution` block fails because none of the functions resolve through the registry yet (e.g. `getTabColumns('Hanan Group')` returns `null`).

- [ ] **Step 3: Write the implementation**

Add the import at the top of `src/lib/tab-configs.ts` (this file currently has zero imports — this is the first one, and it MUST use the `.ts` extension per this file's existing Deno-reachability constraint documented in its own file header comment):

```ts
import { resolveHardcodedTabKey } from './hardcodedTabRenameRegistry.ts';
```

Modify `getTabColumns` (currently `TAB_COLUMN_CONFIGS[tab] ?? (dynamicColumnsResolver ? dynamicColumnsResolver(tab) : null);`):

```ts
export function getTabColumns(tab: string): string[] | null {
  return TAB_COLUMN_CONFIGS[resolveHardcodedTabKey(tab)] ?? (dynamicColumnsResolver ? dynamicColumnsResolver(tab) : null);
}
```

Modify `getColLabel`:

```ts
export function getColLabel(header: string, tab?: string): string {
  const key = tab ? resolveHardcodedTabKey(tab) : undefined;
  if (key && TAB_COLUMN_LABELS[key]?.[header]) {
    return TAB_COLUMN_LABELS[key][header];
  }
  return COLUMN_LABELS[header] ?? header;
}
```

Modify `deriveTabBrands`'s `TAB_DEFAULT_BRAND[tab]` reference:

```ts
export function deriveTabBrands(tab: string, entries: { data: Record<string, string | null> }[], headers: string[]): string[] {
  const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? getBrandNameCol(tab);
  const uniqueBrands = [...new Set(
    entries
      .map((e) => e.data[brandCol])
      .filter((v): v is string => !!v && v.trim() !== ''),
  )].sort();
  if (uniqueBrands.length === 0 && TAB_DEFAULT_BRAND[resolveHardcodedTabKey(tab)]) {
    uniqueBrands.push(TAB_DEFAULT_BRAND[resolveHardcodedTabKey(tab)]);
  }
  return uniqueBrands;
}
```

Modify `getCountryForAccount`:

```ts
export function getCountryForAccount(account: string | null | undefined, tab: string): string {
  return deriveCountryFromAccount(account) || TAB_DEFAULT_COUNTRY[resolveHardcodedTabKey(tab)] || '';
}
```

Modify `getBrandGroup`:

```ts
export function getBrandGroup(tab: string, brand: string): string[] | null {
  const groups = TAB_BRAND_GROUPS[resolveHardcodedTabKey(tab)];
  if (!groups) return null;
  const trimmed = brand.trim();
  return groups.find((g) => g.some((v) => v.trim() === trimmed)) ?? null;
}
```

Modify `getTabSequence`/`getTabSequenceCol`:

```ts
export function getTabSequence(tab: string): string[] | null {
  return TAB_BRAND_SEQUENCE[resolveHardcodedTabKey(tab)] ?? null;
}

export function getTabSequenceCol(tab: string): string | null {
  return TAB_SEQUENCE_COL[resolveHardcodedTabKey(tab)] ?? null;
}
```

Modify `getBrandTpUrl`:

```ts
export function getBrandTpUrl(brandName: string, tab?: string): string | undefined {
  const key = brandName.toLowerCase().trim();
  const resolvedTab = tab ? resolveHardcodedTabKey(tab) : undefined;
  if (resolvedTab && TAB_BRAND_URLS[resolvedTab]?.[key]) return TAB_BRAND_URLS[resolvedTab][key];
  return BRAND_TP_URLS[key];
}
```

Modify `getBrandLinkCol` and `resolveBrandLink`:

```ts
export function getBrandLinkCol(tab: string): string {
  const key = resolveHardcodedTabKey(tab);
  if (key === 'TP Brand Injection') return 'Brand / TP URL PAGE__href';
  if (key === 'TP Affiliate') return 'URL PAGE__href';
  if (key === 'Wizard of Odds') return 'Link to the profile';
  return 'Brand Link';
}

export function resolveBrandLink(brand: string, tab: string, tabLocalValue?: string): string {
  if (resolveHardcodedTabKey(tab) === 'TP Affiliate') return tabLocalValue ?? '';
  return getBrandTpUrl(brand, tab) || tabLocalValue || '';
}
```

Modify `computeRawTabPlatforms`:

```ts
function computeRawTabPlatforms(tab: string): ('tp' | 'ag' | 'cg' | 'wo')[] {
  const cols = getTabColumns(tab);
  const key = resolveHardcodedTabKey(tab);
  if (key === 'Wizard of Odds') return ['wo'];
  if (key in TAB_COLUMN_CONFIGS) {
    const platforms: ('tp' | 'ag' | 'cg' | 'wo')[] = ['tp'];
    if (cols) {
      const set = new Set(cols);
      if (set.has('AG Review Status')) platforms.push('ag');
      if (set.has('CG Review Status')) platforms.push('cg');
    }
    return platforms;
  }
  if (!cols) return [];
  const set = new Set(cols);
  const platforms: ('tp' | 'ag' | 'cg' | 'wo')[] = [];
  if (set.has('TP Review Status')) platforms.push('tp');
  if (set.has('AG Review Status')) platforms.push('ag');
  if (set.has('CG Review Status')) platforms.push('cg');
  if (set.has('WoO Review Status')) platforms.push('wo');
  return platforms;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tab-configs.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "feat: resolve hardcoded-tab-keyed lookups in tab-configs.ts through original key"
```

---

### Task 6: `tabIcons.ts` — resolve `TAB_ICONS` lookup through the original key

**Files:**
- Modify: `src/lib/tabIcons.ts`
- Test: `src/lib/tabIcons.test.ts`

**Interfaces:**
- Consumes: `resolveHardcodedTabKey` from `./hardcodedTabRenameRegistry.ts` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tabIcons.test.ts`'s imports:

```ts
import { renameHardcodedTabLocally, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';
```

Add this test inside the existing `describe('resolveTabIconKind', ...)` block:

```ts
  it('resolves a renamed hardcoded tab back to its original TAB_ICONS entry', () => {
    renameHardcodedTabLocally('Hanan', 'Hanan Group');
    expect(resolveTabIconKind('Hanan Group')).toEqual({ kind: 'static', Icon: TAB_ICONS['Hanan'] });
    resetHardcodedTabRenames();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tabIcons.test`
Expected: FAIL — `resolveTabIconKind('Hanan Group')` falls back to `DEFAULT_TAB_ICON`, not `TAB_ICONS['Hanan']`.

- [ ] **Step 3: Write the implementation**

`tabIcons.ts` is frontend-only (not Deno-reachable, per its own file-header comment) — match the existing extensionless import convention already used for `./tabIconOverrideRegistry` in this file:

```ts
import { getTabIconOverride } from './tabIconOverrideRegistry';
import { resolveHardcodedTabKey } from './hardcodedTabRenameRegistry';
```

Modify `resolveTabIconKind`:

```ts
export function resolveTabIconKind(tab: string): ResolvedTabIcon {
  const override = getTabIconOverride(tab);
  if (override?.imageUrl) return { kind: 'image', url: override.imageUrl };
  if (override?.faviconDomain) return { kind: 'favicon', domain: override.faviconDomain };
  if (override?.icon && isKnownDynamicIconName(override.icon)) {
    return { kind: 'dynamic', name: override.icon };
  }
  const hardcoded = TAB_ICONS[resolveHardcodedTabKey(tab)];
  if (hardcoded) return { kind: 'static', Icon: hardcoded };
  return { kind: 'static', Icon: DEFAULT_TAB_ICON };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tabIcons.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabIcons.ts src/lib/tabIcons.test.ts
git commit -m "feat: resolve TAB_ICONS lookup through original hardcoded tab key"
```

---

### Task 7: `EditEntryModal.tsx` + `AddReviewAccountModal.tsx` — fix literal `'Wizard of Odds'` checks

**Files:**
- Modify: `src/components/EditEntryModal.tsx:226,456`
- Modify: `src/components/AddReviewAccountModal.tsx:189`

**Interfaces:**
- Consumes: `resolveHardcodedTabKey` from `../lib/hardcodedTabRenameRegistry` (Task 2).

These two files have no dedicated test file (this project has no `@testing-library/react` dependency — component-rendering tests aren't a pattern here, confirmed by `tabIcons.ts`'s own file comment). Verification is via `npm run build` (Task 9's build check covers this) and the manual live-check in Task 10.

- [ ] **Step 1: Fix `EditEntryModal.tsx`**

Add the import alongside the existing `../lib/tabs` import:

```tsx
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { resolveHardcodedTabKey } from '../lib/hardcodedTabRenameRegistry';
```

Change line 226 (`if (currentTab === 'Wizard of Odds') {`) to:

```tsx
    if (currentTab && resolveHardcodedTabKey(currentTab) === 'Wizard of Odds') {
```

Change line 456 (`<SectionHeading label={currentTab === 'Wizard of Odds' ? 'Wizard of Odds' : 'Trust Pilot'} />`) to:

```tsx
              <SectionHeading label={currentTab && resolveHardcodedTabKey(currentTab) === 'Wizard of Odds' ? 'Wizard of Odds' : 'Trust Pilot'} />
```

- [ ] **Step 2: Fix `AddReviewAccountModal.tsx`**

Add the import alongside the existing `../lib/tab-configs` import:

```tsx
import { hasMultiPlatform, getTabColumns, TAB_DEFAULT_BRAND, getCountryForAccount, getBrandNameCol, getBrandLinkCol, resolveBrandLink, getBrandAgUrl, getBrandCgUrl } from '../lib/tab-configs';
import { resolveHardcodedTabKey } from '../lib/hardcodedTabRenameRegistry';
```

Change line 189 (`f.key === 'Link to the profile' && selectedTab === 'Wizard of Odds' ? { ...f, label: 'Brand Link' } : f,`) to:

```tsx
    f.key === 'Link to the profile' && resolveHardcodedTabKey(selectedTab) === 'Wizard of Odds' ? { ...f, label: 'Brand Link' } : f,
```

- [ ] **Step 3: Verify the project still builds**

Run: `npm run build`
Expected: builds clean, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/EditEntryModal.tsx src/components/AddReviewAccountModal.tsx
git commit -m "fix: resolve literal Wizard of Odds tab checks through original key"
```

---

### Task 8: Bootstrap wiring — `tabRegistryBootstrap.ts` + `AuthContext.tsx`

**Files:**
- Modify: `src/lib/tabRegistryBootstrap.ts`
- Test: `src/lib/tabRegistryBootstrap.test.ts`
- Modify: `src/contexts/AuthContext.tsx`

**Interfaces:**
- Consumes: `fetchHardcodedTabRenames` from `./queries.ts` (Task 3); `registerHardcodedTabRenames`, `resetHardcodedTabRenames` from `./hardcodedTabRenameRegistry.ts` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tabRegistryBootstrap.test.ts`'s imports:

```ts
import { resolveHardcodedTabKey, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry';
```

Add `resetHardcodedTabRenames()` to the existing `afterEach` block (it already resets the other two module-global registries this file's tests touch):

```ts
  afterEach(() => {
    resetPausedTabs();
    resetHiddenTabPlatforms();
    resetHardcodedTabRenames();
  });
```

Modify the first test's `fakeClient` call to also serve `hardcoded_tab_renames`, and add the new assertion:

```ts
  it('applies fetched rows to all five registries', async () => {
    resetPausedTabs();
    resetHiddenTabPlatforms();
    resetHardcodedTabRenames();
    const client = fakeClient({
      custom_tabs: [],
      tab_hidden_platforms: [{ tab: 'Rooster Partners', platform: 'ag' }],
      tab_archive_log: [],
      paused_tabs: [{ tab: 'TP Brand Injection' }],
      hardcoded_tab_renames: [{ original_name: 'Hanan', current_name: 'Hanan Group' }],
    });
    await bootstrapTabRegistries(client, 'test');
    expect(isTabPaused('TP Brand Injection')).toBe(true);
    expect(getActiveOperationalTabs().includes('TP Brand Injection')).toBe(false);
    expect(getTabPlatforms('Rooster Partners').includes('ag')).toBe(false);
    expect(resolveHardcodedTabKey('Hanan Group')).toBe('Hanan');
  });
```

Add `hardcoded_tab_renames` failing-open in the second test's fake client stays covered automatically (its fallback branch returns `{ data: [], error: null }` for any table not named `paused_tabs`) — no change needed there, but add this new assertion to that same test to confirm the new fetch degrades open too:

```ts
    await expect(bootstrapTabRegistries(client, 'test')).resolves.toBeUndefined();
    expect(getActiveOperationalTabs().includes('TP Brand Injection')).toBe(true); // never got paused, fetch failed open
    expect(resolveHardcodedTabKey('Anything')).toBe('Anything'); // no rows fetched, resolver is a no-op
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tabRegistryBootstrap.test`
Expected: FAIL — `resolveHardcodedTabKey('Hanan Group')` returns `'Hanan Group'`, not `'Hanan'` (the bootstrap doesn't fetch/register hardcoded tab renames yet).

- [ ] **Step 3: Write the implementation**

Modify `src/lib/tabRegistryBootstrap.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { registerHiddenTabPlatforms, resetHiddenTabPlatforms } from './tab-configs.ts';
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchArchivedTabs, fetchPausedTabs, fetchHardcodedTabRenames } from './queries.ts';
import { registerDynamicTabs, resetDynamicTabs } from './dynamicTabRegistry.ts';
import { applyArchivedTabs, resetArchivedTabs } from './archivedTabRegistry.ts';
import { applyPausedTabs, resetPausedTabs } from './pausedTabRegistry.ts';
import { registerHardcodedTabRenames, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry.ts';

export async function bootstrapTabRegistries(client: SupabaseClient, logPrefix: string): Promise<void> {
  const customTabs = await fetchCustomTabs(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch custom tabs:`, err);
    return [];
  });
  resetDynamicTabs();
  registerDynamicTabs(customTabs);

  const hiddenPlatforms = await fetchHiddenTabPlatforms(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch hidden tab platforms:`, err);
    return [];
  });
  resetHiddenTabPlatforms();
  registerHiddenTabPlatforms(hiddenPlatforms);

  const archivedTabs = await fetchArchivedTabs(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch archived tabs:`, err);
    return [];
  });
  resetArchivedTabs();
  applyArchivedTabs(archivedTabs);

  const pausedTabs = await fetchPausedTabs(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch paused tabs:`, err);
    return [];
  });
  resetPausedTabs();
  applyPausedTabs(pausedTabs);

  // Fail-open, same convention as hiddenPlatforms above: a failed fetch
  // leaves the resolver a no-op for this tick (every tab reads as its own
  // original name), never blocking the other four registries.
  const hardcodedTabRenames = await fetchHardcodedTabRenames(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch hardcoded tab renames:`, err);
    return [];
  });
  resetHardcodedTabRenames();
  registerHardcodedTabRenames(hardcodedTabRenames);
}
```

Modify `src/contexts/AuthContext.tsx`: add `fetchHardcodedTabRenames` to the existing `import { ... } from '../lib/queries';` line, add `import { registerHardcodedTabRenames } from '../lib/hardcodedTabRenameRegistry';` alongside the existing `import { registerTabIconOverrides } from '../lib/tabIconOverrideRegistry';` line, add a new entry to the `Promise.all([...])` array, and register it in the `.then([...])` callback:

```tsx
import { fetchProfile, fetchCustomTabs, fetchHiddenTabPlatforms, fetchToolbarFilters, fetchArchivedTabs, fetchPausedTabs, fetchTabIconOverrides, fetchHardcodedTabRenames } from '../lib/queries';
import { registerHardcodedTabRenames } from '../lib/hardcodedTabRenameRegistry';
```

```tsx
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
          fetchTabIconOverrides().catch((err) => {
            console.error('Failed to fetch tab icon overrides:', err);
            return [];
          }),
          fetchHardcodedTabRenames().catch((err) => {
            console.error('Failed to fetch hardcoded tab renames:', err);
            return [];
          }),
        ]).then(([p, customTabs, hiddenPlatforms, toolbarFilters, archivedTabs, pausedTabs, tabIconOverrides, hardcodedTabRenames]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          registerHiddenTabPlatforms(hiddenPlatforms);
          registerToolbarFilters(toolbarFilters);
          applyArchivedTabs(archivedTabs);
          applyPausedTabs(pausedTabs);
          registerTabIconOverrides(tabIconOverrides);
          // Order-independent, same reasoning as tabIconOverrides above: a
          // rename applies to hardcoded tabs regardless of dynamic/archive/
          // pause state.
          registerHardcodedTabRenames(hardcodedTabRenames);
          setProfile(p);
          setLoading(false);
        });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tabRegistryBootstrap.test`
Expected: PASS

Then run the full suite to confirm nothing else broke:

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabRegistryBootstrap.ts src/lib/tabRegistryBootstrap.test.ts src/contexts/AuthContext.tsx
git commit -m "feat: bootstrap hardcoded_tab_renames in both Edge Function and browser registry init"
```

---

### Task 9: `EditBrandTabModal.tsx` — editable name field for hardcoded tabs

**Files:**
- Modify: `src/components/EditBrandTabModal.tsx`

**Interfaces:**
- Consumes: `renameHardcodedTab` from `../lib/queries` (Task 3); `renameHardcodedTabLocally` from `../lib/hardcodedTabRenameRegistry` (Task 2); `renameOperationalTab` from `../lib/tabs` (Task 4).

No dedicated test file exists for this component (same convention noted in Task 7). Verified via `npm run build` and the manual live-check in Task 10.

- [ ] **Step 1: Update imports**

```tsx
import { updateCustomTabPlatforms, upsertTabIconOverride, setTabPlatformHidden, renameCustomTab, renameHardcodedTab, setToolbarFilters, pauseTab, unpauseTab } from '../lib/queries';
import {
  PLATFORM_LIST, registerDynamicTabs, renameDynamicTab, isDynamicTab, type DynamicTabPlatform,
} from '../lib/dynamicTabRegistry';
import {
  getTabPlatforms, getTabPlatformsUnfiltered,
  registerHiddenTabPlatforms, unregisterHiddenTabPlatform,
  getEnabledToolbarFilters, registerToolbarFilters,
  TOOLBAR_FILTER_LIST, type ToolbarFilterKey,
} from '../lib/tab-configs';
import { computeInitialIconSelection, type TabIconSelection } from '../lib/tabIcons';
import { registerTabIconOverrides, renameTabIconOverride } from '../lib/tabIconOverrideRegistry';
import { renameHardcodedTabLocally } from '../lib/hardcodedTabRenameRegistry';
import { validateNewTabName } from '../lib/tabValidation';
import { isTabPaused, pauseTabLocally, unpauseTabLocally } from '../lib/pausedTabRegistry';
import { renameOperationalTab } from '../lib/tabs';
import { useAuth } from '../contexts/AuthContext';
import IconPicker from './IconPicker';
```

- [ ] **Step 2: Update `handleSubmit`'s rename gate and persistence branch**

Change `const isRename = dynamic && trimmedName !== tabName;` to:

```ts
    const isRename = trimmedName !== tabName;
```

Change the rename-persistence block inside `handleSubmit` (currently only calling `renameCustomTab`/`renameDynamicTab` when `isRename`) to branch on `dynamic`:

```ts
      let currentTabName = tabName;
      if (isRename) {
        if (dynamic) {
          await renameCustomTab(tabName, trimmedName);
          renameDynamicTab(tabName, trimmedName, platforms);
        } else {
          await renameHardcodedTab(tabName, trimmedName);
          renameHardcodedTabLocally(tabName, trimmedName);
          renameOperationalTab(tabName, trimmedName);
        }
        renameTabIconOverride(tabName, trimmedName);
        currentTabName = trimmedName;
      }
```

- [ ] **Step 3: Replace the locked-box name field with a real input for every tab**

Replace this block:

```tsx
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
                <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">{tabDisplayName(tabName)}</p>
                <p className="mt-1 text-xs text-slate-400">Hardcoded tabs can't be renamed.</p>
              </>
            )}
          </div>
```

with:

```tsx
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tab name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {!dynamic && (
              <p className="mt-1 text-xs text-slate-400">
                This tab has existing entries — renaming it updates every one of them and every dashboard link that points to it.
              </p>
            )}
          </div>
```

Note: `name`'s initial state is already `useState(tabName)` (unchanged). `tabDisplayName` had exactly one use in this file — the locked paragraph just removed — so it's dropped from the `../lib/tabs` import entirely (Step 1 above already shows the corrected import line, keeping only `renameOperationalTab`).

- [ ] **Step 4: Verify the project builds**

Run: `npm run build`
Expected: builds clean, no TypeScript errors, no unused-import warnings.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/EditBrandTabModal.tsx
git commit -m "feat: make hardcoded Brand Tab names editable in Edit Brand Tab"
```

---

### Task 10: Deploy migrations and live-verify

This task is manual (not TDD) — it applies the two Task 1 migrations to the live Supabase project and confirms the full rename flow end to end, including the `TAB_DISPLAY_NAMES`-supersession behavior called out in the spec.

**Files:** none (deploy + manual verification only).

- [ ] **Step 1: Confirm Supabase link for this checkout**

Run: `supabase status` (or `supabase link --project-ref <ref>` if this checkout/worktree hasn't been linked yet — every new worktree needs its own link, per this project's established convention).

- [ ] **Step 2: Apply the migrations**

Run: `supabase db push`
Expected: both `20260901130000_add_hardcoded_tab_renames.sql` and `20260901140000_add_rename_hardcoded_tab_function.sql` apply cleanly with no errors.

- [ ] **Step 3: Confirm the table and function exist**

Run: `supabase db query "select table_name from information_schema.tables where table_name = 'hardcoded_tab_renames';"`
Expected: one row returned.

Run: `supabase db query "select proname from pg_proc where proname = 'rename_hardcoded_tab';"`
Expected: one row returned.

- [ ] **Step 4: Live-verify a rename on a low-traffic hardcoded tab (not BITP/FTP first)**

Using the running app (`npm run dev`), open Edit Brand Tab on a hardcoded tab other than BITP/FTP (e.g. `HazEmirates UAE`, which per this project's brand list has few entries). Rename it, save, and confirm:
- The URL slug changes to match the new name.
- Sidebar, Overview, Score Summary, and Schedule Planner all show the new name with no stale references.
- The tab's existing entries and any scheduled/PMS-linked data are still associated with it under the new name.

- [ ] **Step 5: Live-verify the `TAB_DISPLAY_NAMES` supersession on BITP**

Open Edit Brand Tab on `TP Brand Injection` (shown today as "BITP" via the existing cosmetic alias). Rename it to something new (e.g. `BITP Team`). Confirm the sidebar/page title now show `BITP Team` everywhere — not silently reverting to the old "BITP" alias — since this is the exact scenario the spec's `isRenamedHardcodedTab` short-circuit exists to handle.

- [ ] **Step 6: Revert the test renames**

Rename both test tabs back to their original names via the same modal, confirming the round trip works cleanly (the RPC's "second rename reuses the stored original_name" branch).

- [ ] **Step 7: Update `docs/task-history.md` and `CLAUDE.md`'s Recent Changes**

Document the shipped feature per this project's standing convention (see CLAUDE.md's Dynamic State section for the expected format): what changed, why (the originating request), the key design decision (original-key/current-name indirection, the `TAB_DISPLAY_NAMES` supersession rule), and confirmation that migrations were applied and live-verified.
