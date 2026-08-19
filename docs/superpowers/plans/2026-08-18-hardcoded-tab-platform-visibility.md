# Hardcoded Brand Tab Platform Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an approved user hide/show a platform (TP/AG/CG/WO) that one of
the 11 hardcoded Brand Tabs already tracks, from the same "Edit Platforms"
button Task 236 shipped for self-service tabs — without ever letting a
hardcoded tab gain a platform it never had columns for, and without
deleting or touching any existing `entries.data`.

**Architecture:** A new table `tab_hidden_platforms` (row existence = hidden)
feeds a small in-memory registry inside `tab-configs.ts`. `getTabPlatforms()`
— already the single function every real consumer (Sidebar, BrandGroup,
Schedule Planner ×2, Overview, Topbar, EditEntryModal, and the
`generate-weekly-schedule` Edge Function) calls to learn a tab's platforms —
filters its existing result through that registry before returning, so this
one change reaches every consumer with zero other call-site changes. A
second, unfiltered getter exposes the tab's real platform set for the Edit
Platforms modal, which now branches on `isDynamicTab()` to either keep
Task 236's existing `custom_tabs.platforms` flow or hide/show against the
new table.

**Tech Stack:** Vite 6 · React 19 · TypeScript · Supabase (Postgres + Deno
Edge Functions) · Vitest

**Spec:** `docs/superpowers/specs/2026-08-18-hardcoded-tab-platform-visibility-design.md`

## Global Constraints

- `platform` values are always exactly one of `'tp' | 'ag' | 'cg' | 'wo'` —
  match the `check` constraint already used by every sibling table
  (`removed_platform_brands`, `schedule_platform_restrictions`,
  `brand_platform_override`).
- Every new table gets all 4 RLS policies (select/insert/update/delete),
  even if the UI only ever exercises a subset — standing project rule.
- A hardcoded tab's checkbox list in the Edit Platforms modal must only ever
  contain platforms it already tracks (`getTabPlatformsUnfiltered`) — never
  all 4 unconditionally. Only a *dynamic* tab can offer all 4 and thereby
  add a genuinely new one (Task 236's existing, unchanged behavior).
- At least one platform must remain visible after a save — same guard the
  dynamic-tab modal already enforces.
- `tab-configs.ts` must stay free of React/npm-package imports and any I/O
  — it's imported by the `generate-weekly-schedule` Deno Edge Function.
- `npm run build` and the full Vitest suite must pass after every task.

---

### Task 1: `tab_hidden_platforms` table + query functions

**Files:**
- Create: `supabase/migrations/20260818140000_add_tab_hidden_platforms.sql`
- Modify: `src/lib/queries.ts` (add two functions, near the existing
  `custom_tabs`/`removed_platform_brands` functions)
- Modify: `src/lib/queries.test.ts` (add tests)

**Interfaces:**
- Produces: `fetchHiddenTabPlatforms(client?: SupabaseClient): Promise<{ tab: string; platform: Platform }[]>`
- Produces: `setTabPlatformHidden(tab: string, platform: Platform, hidden: boolean): Promise<void>`
- Consumes: `Platform` type already imported in `queries.ts` from
  `./removedPlatformBrands.ts`; `currentUserEmail()`, an existing local
  `async function` in `queries.ts` (line ~719) that returns the signed-in
  user's email or `null`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260818140000_add_tab_hidden_platforms.sql
-- Hardcoded Brand Tab platform visibility
-- (docs/superpowers/specs/2026-08-18-hardcoded-tab-platform-visibility-design.md):
--
-- A row's existence here means that platform is currently hidden for that
-- tab -- same shape as removed_platform_brands/schedule_hidden_brands, both
-- already in this project. Applies to any tab (hardcoded or dynamic), but
-- in practice the UI only ever writes rows for the 11 hardcoded tabs --
-- dynamic tabs keep using custom_tabs.platforms (Task 236) since that
-- mechanism also controls which columns get generated in the first place,
-- which a hardcoded tab's fixed schema doesn't need.
--
-- No FK on `tab` -- a tab's identity is a free-text string everywhere else
-- in this project (entries.tab, custom_tabs.name).

create table public.tab_hidden_platforms (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  platform   text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  hidden_by  text,
  hidden_at  timestamptz not null default now(),
  unique (tab, platform)
);

alter table public.tab_hidden_platforms enable row level security;

create policy "anyone can read tab_hidden_platforms"
  on public.tab_hidden_platforms for select using (true);
create policy "approved users can insert tab_hidden_platforms"
  on public.tab_hidden_platforms for insert with check (public.is_approved());
create policy "approved users can update tab_hidden_platforms"
  on public.tab_hidden_platforms for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete tab_hidden_platforms"
  on public.tab_hidden_platforms for delete using (public.is_approved());
```

- [ ] **Step 2: Write the failing tests**

Find the `describe('fetchCustomTabs / createCustomTab / deleteCustomTab', ...)`
block in `src/lib/queries.test.ts` and add a new `describe` block directly
after it (same file, same `chain()`/`singletonFrom` test infra already set
up at the top of the file — no new imports needed beyond the two new
functions):

```ts
import {
  // ...existing imports...
  fetchHiddenTabPlatforms,
  setTabPlatformHidden,
} from './queries';
```

```ts
describe('fetchHiddenTabPlatforms / setTabPlatformHidden', () => {
  it('fetchHiddenTabPlatforms maps rows to tab/platform', async () => {
    singletonFrom.mockReturnValue(
      chain({ data: [{ tab: 'Rooster Partners', platform: 'ag' }], error: null }),
    );
    const rows = await fetchHiddenTabPlatforms();
    expect(rows).toEqual([{ tab: 'Rooster Partners', platform: 'ag' }]);
  });

  it('setTabPlatformHidden upserts a row when hiding', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ upsert });
    await setTabPlatformHidden('Rooster Partners', 'ag', true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'Rooster Partners', platform: 'ag' }),
      { onConflict: 'tab,platform' },
    );
  });

  it('setTabPlatformHidden deletes the row when un-hiding', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const del = vi.fn().mockReturnValue({ eq: eq1 });
    singletonFrom.mockReturnValue({ delete: del });
    await setTabPlatformHidden('Rooster Partners', 'ag', false);
    expect(del).toHaveBeenCalled();
    expect(eq1).toHaveBeenCalledWith('tab', 'Rooster Partners');
    expect(eq2).toHaveBeenCalledWith('platform', 'ag');
  });

  it('setTabPlatformHidden throws on a hide error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: new Error('db down') });
    singletonFrom.mockReturnValue({ upsert });
    await expect(setTabPlatformHidden('Rooster Partners', 'ag', true)).rejects.toThrow('db down');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: FAIL — `fetchHiddenTabPlatforms`/`setTabPlatformHidden` are not exported from `./queries`.

- [ ] **Step 4: Implement the two functions**

Add directly after the existing `deleteCustomTab` function in `src/lib/queries.ts`:

```ts
export async function fetchHiddenTabPlatforms(client: SupabaseClient = supabase): Promise<{ tab: string; platform: Platform }[]> {
  const { data, error } = await client
    .from('tab_hidden_platforms')
    .select('tab, platform');
  if (error) throw error;
  return (data ?? []) as { tab: string; platform: Platform }[];
}

// Hides or un-hides one platform on one tab (any tab, though in practice
// only ever called for a hardcoded tab — a dynamic tab keeps using
// updateCustomTabPlatforms/registerDynamicTabs instead, see Task 236).
// Never touches entries.data: a hidden platform's columns still exist and
// still hold real data, they simply stop being reported by
// getTabPlatforms() (src/lib/tab-configs.ts) until un-hidden again.
export async function setTabPlatformHidden(tab: string, platform: Platform, hidden: boolean): Promise<void> {
  if (hidden) {
    const { error } = await supabase
      .from('tab_hidden_platforms')
      .upsert({ tab, platform, hidden_by: await currentUserEmail() }, { onConflict: 'tab,platform' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('tab_hidden_platforms')
      .delete()
      .eq('tab', tab)
      .eq('platform', platform);
    if (error) throw error;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260818140000_add_tab_hidden_platforms.sql src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add tab_hidden_platforms table and query functions"
```

---

### Task 2: `tab-configs.ts` hidden-platform registry + `getTabPlatforms` filter

**Files:**
- Modify: `src/lib/tab-configs.ts:669-697` (the existing `getTabPlatforms` function)
- Modify: `src/lib/tab-configs.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (this task is pure in-memory state, no I/O).
- Produces: `getTabPlatformsUnfiltered(tab: string): ('tp'|'ag'|'cg'|'wo')[]`
  — the tab's real platform set, ignoring any hidden overrides.
- Produces: `registerHiddenTabPlatforms(rows: { tab: string; platform: 'tp'|'ag'|'cg'|'wo' }[]): void`
  — adds each row's platform to that tab's hidden set (merge, doesn't clear
  other tabs' state — same "only touch what's passed" shape as the existing
  `registerDynamicTabs` in `dynamicTabRegistry.ts`).
- Produces: `unregisterHiddenTabPlatform(tab: string, platform: 'tp'|'ag'|'cg'|'wo'): void`
  — removes one platform from one tab's hidden set (un-hide).
- Produces: `resetHiddenTabPlatforms(): void` — clears the whole registry
  (mirrors `resetDynamicTabs()`, for the per-invocation Edge Function reset
  in Task 5).
- Produces (behavior change): `getTabPlatforms(tab)` now returns
  `getTabPlatformsUnfiltered(tab)` minus whatever's currently registered as
  hidden for that tab. With zero hidden rows registered (the state at every
  test's start and in every already-deployed session until someone hides
  something), this is byte-for-byte identical to today's output.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `src/lib/tab-configs.test.ts`, directly after
the existing `describe('getTabPlatforms', ...)` block (~line 82). Add the
three new names to the existing import line at the top of the file:

```ts
import {
  TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount, getBrandGroup,
  getTabPlatforms, getTabPlatformsUnfiltered, registerHiddenTabPlatforms,
  unregisterHiddenTabPlatform, resetHiddenTabPlatforms,
  stripDupSuffix, accountUsageKey, hasMultiPlatform, getTabColumns, getBrandNameCol,
} from './tab-configs';
```

```ts
describe('getTabPlatforms / hidden platform overrides', () => {
  beforeEach(() => {
    resetHiddenTabPlatforms();
  });

  afterAll(() => {
    resetHiddenTabPlatforms();
  });

  it('is a no-op for every hardcoded tab when nothing is hidden', () => {
    expect(getTabPlatforms('Rooster Partners')).toEqual(['tp', 'ag', 'cg']);
    expect(getTabPlatforms('Wizard of Odds')).toEqual(['wo']);
    expect(getTabPlatforms('TP Brand Injection')).toEqual(['tp']);
  });

  it('filters a hidden platform out of getTabPlatforms', () => {
    registerHiddenTabPlatforms([{ tab: 'Rooster Partners', platform: 'ag' }]);
    expect(getTabPlatforms('Rooster Partners')).toEqual(['tp', 'cg']);
  });

  it('getTabPlatformsUnfiltered still reports a hidden platform as real', () => {
    registerHiddenTabPlatforms([{ tab: 'Rooster Partners', platform: 'ag' }]);
    expect(getTabPlatformsUnfiltered('Rooster Partners')).toEqual(['tp', 'ag', 'cg']);
  });

  it('unregisterHiddenTabPlatform restores a previously-hidden platform', () => {
    registerHiddenTabPlatforms([{ tab: 'Rooster Partners', platform: 'ag' }]);
    unregisterHiddenTabPlatform('Rooster Partners', 'ag');
    expect(getTabPlatforms('Rooster Partners')).toEqual(['tp', 'ag', 'cg']);
  });

  it('hiding one tab\'s platform does not affect another tab', () => {
    registerHiddenTabPlatforms([{ tab: 'Rooster Partners', platform: 'ag' }]);
    expect(getTabPlatforms('Hanan')).toEqual(['tp', 'ag', 'cg']);
  });

  it('resetHiddenTabPlatforms clears every tab\'s hidden set', () => {
    registerHiddenTabPlatforms([
      { tab: 'Rooster Partners', platform: 'ag' },
      { tab: 'Hanan', platform: 'cg' },
    ]);
    resetHiddenTabPlatforms();
    expect(getTabPlatforms('Rooster Partners')).toEqual(['tp', 'ag', 'cg']);
    expect(getTabPlatforms('Hanan')).toEqual(['tp', 'ag', 'cg']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/tab-configs.test.ts`
Expected: FAIL — `getTabPlatformsUnfiltered`, `registerHiddenTabPlatforms`,
`unregisterHiddenTabPlatform`, `resetHiddenTabPlatforms` are not exported.

- [ ] **Step 3: Implement the registry and refactor `getTabPlatforms`**

Replace the existing `getTabPlatforms` function (`src/lib/tab-configs.ts:669-697`) with:

```ts
// Computes a tab's real, unfiltered platform set — the logic
// getTabPlatforms always used before hidden-platform overrides existed. The
// 11 hardcoded tabs default to TP with WO/AG/CG opt-in via column presence
// (unchanged legacy rule — several hardcoded tabs use TP status column name
// variants, e.g. plain 'Review Status', that don't literally match 'TP
// Review Status', so TP can't safely be column-detected there). Dynamic
// tabs (self-service Brand Tab creation, src/lib/dynamicTabRegistry.ts)
// have no default platform at all — every platform, including TP, is
// derived purely from which columns buildDynamicTabColumns generated.
function computeRawTabPlatforms(tab: string): ('tp' | 'ag' | 'cg' | 'wo')[] {
  const cols = getTabColumns(tab);
  if (tab === 'Wizard of Odds') return ['wo'];
  if (tab in TAB_COLUMN_CONFIGS) {
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

// Exposed for the Edit Platforms modal (BrandGroup.tsx /
// EditBrandTabPlatformsModal.tsx), which must always offer every platform a
// tab has ever tracked as a checkbox — including one currently hidden —
// never just what's presently visible.
export function getTabPlatformsUnfiltered(tab: string): ('tp' | 'ag' | 'cg' | 'wo')[] {
  return computeRawTabPlatforms(tab);
}

// In-memory registry of platforms hidden per tab
// (docs/superpowers/specs/2026-08-18-hardcoded-tab-platform-visibility-design.md).
// Populated at session bootstrap (AuthContext.tsx) and, per-invocation, by
// the generate-weekly-schedule Edge Function — mirrors dynamicTabColumns'
// shape in dynamicTabRegistry.ts. A guarded window.dispatchEvent lives here
// too, not imported from dynamicTabRegistry.ts's own notifyDynamicTabsChanged,
// specifically to avoid a real circular import: dynamicTabRegistry.ts
// already imports FROM this file (setDynamicColumnsResolver), and tabs.ts
// (the only other candidate host) imports FROM this file too, so either
// direction would close a cycle. Small, deliberate duplication — same event
// name, same guard shape as the one in dynamicTabRegistry.ts.
const hiddenTabPlatforms: Record<string, Set<'tp' | 'ag' | 'cg' | 'wo'>> = {};

function notifyTabPlatformsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('tab-platforms-changed'));
  }
}

export function registerHiddenTabPlatforms(rows: { tab: string; platform: 'tp' | 'ag' | 'cg' | 'wo' }[]): void {
  for (const row of rows) {
    if (!hiddenTabPlatforms[row.tab]) hiddenTabPlatforms[row.tab] = new Set();
    hiddenTabPlatforms[row.tab].add(row.platform);
  }
  notifyTabPlatformsChanged();
}

export function unregisterHiddenTabPlatform(tab: string, platform: 'tp' | 'ag' | 'cg' | 'wo'): void {
  hiddenTabPlatforms[tab]?.delete(platform);
  notifyTabPlatformsChanged();
}

export function resetHiddenTabPlatforms(): void {
  for (const key of Object.keys(hiddenTabPlatforms)) delete hiddenTabPlatforms[key];
}

// Returns the platforms currently visible for a given tab —
// computeRawTabPlatforms's real set minus anything registered as hidden via
// registerHiddenTabPlatforms. A tab with nothing hidden gets back exactly
// computeRawTabPlatforms's result, unchanged from this function's behavior
// before hidden-platform overrides existed.
export function getTabPlatforms(tab: string): ('tp' | 'ag' | 'cg' | 'wo')[] {
  const raw = computeRawTabPlatforms(tab);
  const hidden = hiddenTabPlatforms[tab];
  return hidden ? raw.filter((p) => !hidden.has(p)) : raw;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/tab-configs.test.ts`
Expected: PASS (including every pre-existing test in this file — the
no-hidden-rows case must match exactly).

- [ ] **Step 5: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: PASS — nothing else in the app calls `computeRawTabPlatforms`
directly (it's not exported), so this is purely additive from every other
consumer's point of view.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "feat: add hidden-platform registry and filter to getTabPlatforms"
```

---

### Task 3: Rename the dynamic-tab-registry change event

**Files:**
- Modify: `src/lib/dynamicTabRegistry.ts`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the DOM event dispatched by `dynamicTabRegistry.ts`'s
  `registerDynamicTabs`/`unregisterDynamicTab` (already shipped in Task 236)
  is renamed from `'dynamic-tabs-changed'` to `'tab-platforms-changed'` —
  the same name `tab-configs.ts`'s new `notifyTabPlatformsChanged` (Task 2)
  already dispatches, so `Sidebar.tsx`'s one listener covers both dynamic
  tab create/delete/edit *and* hardcoded tab platform hide/unhide with a
  single subscription.

This is a plain rename with no behavior change — do it as a single
find/replace across the two files rather than a TDD cycle (no new
assertable behavior to test beyond what Task 236's existing tests already
cover for dynamic tabs, and Task 4/6 below will exercise the renamed event
end-to-end).

- [ ] **Step 1: Rename the dispatched event in `dynamicTabRegistry.ts`**

Find this function (added in Task 236):

```ts
function notifyDynamicTabsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('dynamic-tabs-changed'));
  }
}
```

Rename it and its event string, and update its two call sites
(`registerDynamicTabs`, `unregisterDynamicTab`):

```ts
// Notifies any mounted component that reads OPERATIONAL_TABS/dynamicTabColumns
// inline (e.g. Sidebar's platform-icon list) that the tab/platform registry
// changed, since mutating these module-level structures in place — by
// design, so every existing importer picks up a change with zero call-site
// changes — does NOT itself trigger a React re-render. Same event name as
// tab-configs.ts's own notifyTabPlatformsChanged (hidden hardcoded-tab
// platforms, docs/superpowers/specs/2026-08-18-hardcoded-tab-platform-visibility-design.md)
// so Sidebar.tsx's one listener covers both. Guarded the same way
// supabase.ts's SITE_URL learned to guard `window`: Supabase's real Edge
// Runtime defines a bare `window` global (so `typeof window !== 'undefined'`
// alone is not proof it's safe), but never a real `dispatchEvent`.
function notifyTabPlatformsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('tab-platforms-changed'));
  }
}
```

Update the two call sites inside `registerDynamicTabs` and
`unregisterDynamicTab` from `notifyDynamicTabsChanged();` to
`notifyTabPlatformsChanged();`.

- [ ] **Step 2: Update the listener in `Sidebar.tsx`**

Find:

```ts
  useEffect(() => {
    function handleChange() {
      setTabsVersion((v) => v + 1);
    }
    window.addEventListener('dynamic-tabs-changed', handleChange);
    return () => window.removeEventListener('dynamic-tabs-changed', handleChange);
  }, []);
```

Replace the two event-name strings:

```ts
  // Any tab/platform registry change — a dynamic tab created/edited/deleted
  // here or from a Brand Tab's own page (BrandGroup.tsx), or a hardcoded
  // tab's platform hidden/un-hidden — fires this event
  // (dynamicTabRegistry.ts's / tab-configs.ts's notify* functions), so this
  // is the one place Sidebar needs to listen rather than each call site
  // re-plumbing its own bump back up to this component.
  useEffect(() => {
    function handleChange() {
      setTabsVersion((v) => v + 1);
    }
    window.addEventListener('tab-platforms-changed', handleChange);
    return () => window.removeEventListener('tab-platforms-changed', handleChange);
  }, []);
```

- [ ] **Step 3: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: PASS — no test asserts the literal event-name string, so this is
a safe rename; confirm by grepping for any leftover `dynamic-tabs-changed`
reference:

Run: `grep -rn "dynamic-tabs-changed" src/`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dynamicTabRegistry.ts src/components/Sidebar.tsx
git commit -m "refactor: rename tab-registry change event to tab-platforms-changed"
```

---

### Task 4: Session bootstrap wiring (`AuthContext.tsx`)

**Files:**
- Modify: `src/contexts/AuthContext.tsx`

**Interfaces:**
- Consumes: `fetchHiddenTabPlatforms` (Task 1, from `../lib/queries`),
  `registerHiddenTabPlatforms` (Task 2, from `../lib/tab-configs`).

- [ ] **Step 1: Add the import**

At the top of `src/contexts/AuthContext.tsx`, alongside the existing:

```ts
import { fetchCustomTabs } from '../lib/queries';
import { registerDynamicTabs } from '../lib/dynamicTabRegistry';
```

add:

```ts
import { fetchHiddenTabPlatforms } from '../lib/queries';
import { registerHiddenTabPlatforms } from '../lib/tab-configs';
```

(Combine into the existing `from '../lib/queries'` import rather than a
second `import` line for that module.)

- [ ] **Step 2: Fetch and register alongside the existing custom-tabs fetch**

Find the existing bootstrap block:

```ts
        setLoading(true);
        Promise.all([
          fetchProfile(s.user.id),
          fetchCustomTabs().catch((err) => {
            console.error('Failed to fetch custom tabs:', err);
            return [];
          }),
        ]).then(([p, customTabs]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          setProfile(p);
          setLoading(false);
        });
```

Replace with a third parallel, fail-open fetch and its registration call:

```ts
        setLoading(true);
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

- [ ] **Step 3: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: PASS. `AuthContext.tsx` has no existing dedicated unit test file
in this project (confirmed by there being no `AuthContext.test.tsx`) — this
step is verified via the full suite + build + Task 7's live check, matching
this project's established pattern for auth-bootstrap code.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "feat: register hidden tab platforms at session bootstrap"
```

---

### Task 5: `generate-weekly-schedule` Edge Function wiring

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts`

**Interfaces:**
- Consumes: `fetchHiddenTabPlatforms` (Task 1, from
  `../../../src/lib/queries.ts`), `registerHiddenTabPlatforms` /
  `resetHiddenTabPlatforms` (Task 2, from `../../../src/lib/tab-configs.ts`).

- [ ] **Step 1: Add the imports**

Find:

```ts
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND, getTabPlatforms } from '../../../src/lib/tab-configs.ts';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, invalidateTabCache, fetchCustomTabs } from '../../../src/lib/queries.ts';
```

Replace with:

```ts
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND, getTabPlatforms, registerHiddenTabPlatforms, resetHiddenTabPlatforms } from '../../../src/lib/tab-configs.ts';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, invalidateTabCache, fetchCustomTabs, fetchHiddenTabPlatforms } from '../../../src/lib/queries.ts';
```

- [ ] **Step 2: Reset and register per invocation**

Find (already shipped, Task 232/236):

```ts
  const customTabs = await fetchCustomTabs(client).catch((err) => {
    console.error('[generate-weekly-schedule] failed to fetch custom tabs:', err);
    return [];
  });
  resetDynamicTabs();
  registerDynamicTabs(customTabs);
```

Add a mirrored block directly after it:

```ts
  const customTabs = await fetchCustomTabs(client).catch((err) => {
    console.error('[generate-weekly-schedule] failed to fetch custom tabs:', err);
    return [];
  });
  resetDynamicTabs();
  registerDynamicTabs(customTabs);
  // Same reset-then-register shape, same reason: this Edge isolate may be
  // warm from a prior invocation, and registerHiddenTabPlatforms only ever
  // adds to its in-memory registry (see tab-configs.ts) — without the reset
  // a platform un-hidden since the last invocation would incorrectly stay
  // hidden forever in a reused isolate.
  const hiddenPlatforms = await fetchHiddenTabPlatforms(client).catch((err) => {
    console.error('[generate-weekly-schedule] failed to fetch hidden tab platforms:', err);
    return [];
  });
  resetHiddenTabPlatforms();
  registerHiddenTabPlatforms(hiddenPlatforms);
```

- [ ] **Step 3: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: PASS. This Edge Function has its own Deno test suite
(`index_test.ts`) run separately via `deno test` — this repo's Vitest run
does not execute Deno tests, so also run:

Run: `cd supabase/functions/generate-weekly-schedule && deno check index.ts`
Expected: no type errors. (This function is not yet deployed — see
`CLAUDE.md`'s Known Issues — so this step is static verification only, not
a live-deploy check.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts
git commit -m "feat: respect hidden tab platforms in generate-weekly-schedule"
```

---

### Task 6: Edit Platforms modal — dual mode, and drop the dynamic-tab-only gate

**Files:**
- Modify: `src/components/EditBrandTabPlatformsModal.tsx`
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `setTabPlatformHidden` (Task 1), `getTabPlatforms` /
  `getTabPlatformsUnfiltered` / `registerHiddenTabPlatforms` /
  `unregisterHiddenTabPlatform` (Task 2), `isDynamicTab` /
  `updateCustomTabPlatforms` / `registerDynamicTabs` (already shipped,
  Task 236), `PLATFORM_LIST` (already shipped, Task 236).
- Produces (prop change): `EditBrandTabPlatformsModal`'s props shrink to
  `{ tabName: string; onUpdated: () => void; onClose: () => void }` — it no
  longer takes an `initialPlatforms` prop; it now derives everything itself
  from `tabName` via `isDynamicTab`/`getTabPlatforms`/`getTabPlatformsUnfiltered`.
  `BrandGroup.tsx`'s call site must be updated to match.

- [ ] **Step 1: Rewrite `EditBrandTabPlatformsModal.tsx`**

Replace the whole file:

```tsx
// src/components/EditBrandTabPlatformsModal.tsx
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { updateCustomTabPlatforms, setTabPlatformHidden } from '../lib/queries';
import {
  PLATFORM_LIST, registerDynamicTabs, isDynamicTab, type DynamicTabPlatform,
} from '../lib/dynamicTabRegistry';
import {
  getTabPlatforms, getTabPlatformsUnfiltered,
  registerHiddenTabPlatforms, unregisterHiddenTabPlatform,
} from '../lib/tab-configs';

interface Props {
  tabName: string;
  onUpdated: () => void;
  onClose: () => void;
}

export default function EditBrandTabPlatformsModal({ tabName, onUpdated, onClose }: Props) {
  const dynamic = isDynamicTab(tabName);
  // Checkbox universe: a dynamic tab can gain a genuinely new platform
  // (Task 236 — buildDynamicTabColumns just generates fresh, empty
  // columns for it), so it always offers all 4. A hardcoded tab's schema
  // is permanently fixed — it can only ever hide/show what it already has
  // real columns for, so its universe is its own real (unfiltered) set.
  const toggleable: DynamicTabPlatform[] = dynamic
    ? PLATFORM_LIST.map((p) => p.key)
    : (getTabPlatformsUnfiltered(tabName) as DynamicTabPlatform[]);
  const [platforms, setPlatforms] = useState<DynamicTabPlatform[]>(
    () => getTabPlatforms(tabName) as DynamicTabPlatform[],
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

  async function handleSubmit() {
    if (platforms.length === 0) {
      setError('Select at least one platform to track.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (dynamic) {
        await updateCustomTabPlatforms(tabName, platforms);
        registerDynamicTabs([{ name: tabName, platforms }]);
      } else {
        const before = new Set(getTabPlatforms(tabName));
        const after = new Set(platforms);
        for (const p of toggleable) {
          const wasVisible = before.has(p);
          const nowVisible = after.has(p);
          if (wasVisible === nowVisible) continue;
          await setTabPlatformHidden(tabName, p, !nowVisible);
          if (nowVisible) unregisterHiddenTabPlatform(tabName, p);
          else registerHiddenTabPlatforms([{ tab: tabName, platform: p }]);
        }
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update platforms');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleRequestClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Edit Platforms</h2>
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

- [ ] **Step 2: Update `BrandGroup.tsx`'s call site**

Find (the pencil button, ~line 1831):

```tsx
          {isApproved && isDynamicTab(decodedTab) && (
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

Drop the `isDynamicTab(decodedTab)` gate — the button now shows for every tab:

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

Leave the Delete-tab button's own `isApproved && isDynamicTab(decodedTab)`
gate (the very next block) completely unchanged — hardcoded tabs must never
be deletable.

Find the modal render (~line 1856):

```tsx
      {showEditPlatformsModal && (
        <EditBrandTabPlatformsModal
          tabName={decodedTab}
          initialPlatforms={getTabPlatforms(decodedTab) as DynamicTabPlatform[]}
          onClose={() => setShowEditPlatformsModal(false)}
          onUpdated={() => {
            setShowEditPlatformsModal(false);
            reloadRef.current();
          }}
        />
      )}
```

Drop the now-removed `initialPlatforms` prop:

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

If `DynamicTabPlatform` is no longer referenced anywhere else in
`BrandGroup.tsx` after this edit, remove it from the
`import { isDynamicTab, unregisterDynamicTab, type DynamicTabPlatform } from '../lib/dynamicTabRegistry';`
line at the top of the file (check with a grep for `DynamicTabPlatform` in
the file before removing — `npm run build`'s TypeScript check will also
catch an unused import either way).

- [ ] **Step 3: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/EditBrandTabPlatformsModal.tsx src/pages/BrandGroup.tsx
git commit -m "feat: allow hiding/showing platforms on hardcoded Brand Tabs too"
```

---

### Task 7: Live verification and task history

**Files:**
- Modify: `docs/task-history.md` (append an entry — standing project rule)

- [ ] **Step 1: Run the full suite and build one more time**

Run: `npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 2: Live-verify against the real dashboard**

Start the dev server (`npm run dev`), sign in (see `.env`'s
`CAPTURE_EMAIL`/`CAPTURE_PASSWORD`), and using Playwright (or manually):

1. Open a hardcoded tab that has more than one platform (e.g. Rooster
   Partners — TP/AG/CG) or, to avoid touching a high-traffic tab's live
   data, use the disposable "Testing" dynamic tab created for Task 236's own
   verification if it still exists and still has a hideable platform.
2. Click the pencil "Edit Platforms" button — confirm it now appears (it
   didn't before this plan) and confirm the checkbox list matches the tab's
   real tracked platforms exactly (never all 4 unconditionally for a
   hardcoded tab).
3. Uncheck one platform and save. Confirm, without reloading: that
   platform's KPI card disappears, its table columns disappear, it drops
   out of the "Check Status" platform dropdown, and the Sidebar's icon list
   for that tab updates live (proves the `tab-platforms-changed` rename in
   Task 3 still wires Sidebar to both dynamic-tab and hardcoded-tab
   changes).
4. Re-check the same platform and save. Confirm everything is restored
   exactly — same KPI numbers as before step 2 (proves entries.data was
   never touched).
5. If you used a real tab with live data (not a disposable test tab),
   confirm you end the walkthrough with every platform re-checked, matching
   the tab's state before you started — same "leave it exactly as you found
   it" discipline this project's task history already documents for every
   other live-data walkthrough.

- [ ] **Step 3: Append a `docs/task-history.md` entry**

Follow this project's existing entry format and voice (see any recent entry
in that file for the pattern) — summarize: the new `tab_hidden_platforms`
table, the `getTabPlatforms`/`getTabPlatformsUnfiltered` split and why it's
safe (no-op when nothing's hidden), the `tab-platforms-changed` event
rename and why (one Sidebar listener now covers both dynamic-tab changes
and hardcoded-tab platform hides), the deliberately-out-of-scope items from
the spec (Ask AI doesn't consult `getTabPlatforms` today; the Duplicate-row
modal's `hasMultiPlatform` check is unrelated and untouched), and the
result of the live verification in Step 2 (which tab, what was confirmed,
whether it was restored).

- [ ] **Step 4: Commit**

```bash
git add docs/task-history.md
git commit -m "docs: record hardcoded Brand Tab platform visibility in task history"
```
