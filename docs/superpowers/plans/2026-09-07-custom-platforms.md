# Custom Platforms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any approved user define a new review platform (name, short label, optional rating scale) and enable it on any Brand Tab — hardcoded or self-service-created — with no code change and no deploy; once enabled, its Live/Removed/Total/Success-Rate counts automatically appear in Overview and Brand Tabs.

**Architecture:** Two new tables (`custom_platforms`, `tab_custom_platforms`) back an additive, in-memory registry (`customPlatformRegistry.ts`) that overlays a tab's status/date columns onto `tab-configs.ts`'s existing `getTabColumns` resolver — the same resolver-injection pattern this project already uses for dynamic tabs (`dynamicTabRegistry.ts`) and hidden platforms. A separate pure compute engine (`customPlatforms.ts`) reuses the existing platform-agnostic classification helpers (`isLiveStatus`, `isRemovedStatus`, `passesDateFilter`) from `scoreSummary.ts` with zero new classification logic. TP/AG/CG/WO stay completely untouched.

**Tech Stack:** Vite 6, React 19, TypeScript, Tailwind v4, Supabase (Postgres + RLS), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-custom-platforms-design.md`

## Global Constraints

- The 4 built-in platforms (`Platform = 'tp'|'ag'|'cg'|'wo'`) are never modified, widened, or migrated onto the new mechanism — every existing `Record<Platform, ...>` type and function stays exactly as it is today.
- A custom platform's `status_column`/`date_column` are computed once at creation and frozen — no rename support in v1.
- Automated status-checking (scraping) is never built for a custom platform — status is always entered by hand.
- Schedule Planner, Ask AI (`supabase/functions/ai-assistant/`), Score Summary, and `removed_platform_brands` are NOT touched by this plan — explicitly deferred, per the spec's Non-goals.
- Status vocabulary for a custom platform is exactly: Published, Refused, Removed, Pending, Not Published, Done (matches `STATUS_OPTS` already used in `EditEntryModal.tsx`/`AddReviewAccountModal.tsx`).
- Every new/modified file that sits in `queries.ts`'s or `tab-configs.ts`'s import chain must stay Deno-safe (no React/npm-package imports) since both are imported by the `generate-weekly-schedule` Edge Function — use explicit `.ts` extensions on relative imports in any such file.
- Standard 4-policy RLS (anyone reads; approved users write) unless a table has no in-place updates, in which case skip the `update` policy.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260907120000_add_custom_platforms.sql`

**Interfaces:**
- Produces: `custom_platforms` table (`id`, `name`, `platform_key`, `short_label`, `status_column`, `date_column`, `max_score`, `created_by`, `created_at`) and `tab_custom_platforms` table (`id`, `tab`, `platform_id`, `enabled_by`, `enabled_at`).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260907120000_add_custom_platforms.sql
-- Lets any approved user define a new review platform (beyond the 4
-- built-in TP/AG/CG/WO) and enable it on any tab -- hardcoded or dynamic --
-- with no code change or deploy. Spec:
-- docs/superpowers/specs/2026-09-07-custom-platforms-design.md
--
-- status_column/date_column are computed once at creation time
-- ("<name> Review Status" / "<name> Review Added") and frozen -- renaming a
-- custom platform is not supported in v1 (see spec Non-goals), since that
-- would require rewriting the key across every entry on every tab that uses
-- it. `tab` on tab_custom_platforms is a plain text column named `tab`, so
-- rename_hardcoded_tab/rename_custom_tab (which discover every table with a
-- `tab` text column via information_schema) automatically keep it in sync on
-- a tab rename with no code change here -- same mechanism brand_catalog
-- already relies on.
create table public.custom_platforms (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  platform_key   text generated always as (lower(btrim(name))) stored,
  short_label    text not null,
  status_column  text not null,
  date_column    text not null,
  max_score      integer,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  constraint custom_platforms_platform_key_unique unique (platform_key),
  constraint custom_platforms_max_score_check check (max_score is null or max_score > 0)
);

alter table public.custom_platforms enable row level security;

create policy "anyone can read custom_platforms"
  on public.custom_platforms for select using (true);
create policy "approved users can insert custom_platforms"
  on public.custom_platforms for insert with check (public.is_approved());
create policy "approved users can delete custom_platforms"
  on public.custom_platforms for delete using (public.is_approved());

create table public.tab_custom_platforms (
  id           uuid primary key default gen_random_uuid(),
  tab          text not null,
  platform_id  uuid not null references public.custom_platforms(id) on delete restrict,
  enabled_by   text not null,
  enabled_at   timestamptz not null default now(),
  constraint tab_custom_platforms_unique unique (tab, platform_id)
);

alter table public.tab_custom_platforms enable row level security;

create policy "anyone can read tab_custom_platforms"
  on public.tab_custom_platforms for select using (true);
create policy "approved users can insert tab_custom_platforms"
  on public.tab_custom_platforms for insert with check (public.is_approved());
create policy "approved users can delete tab_custom_platforms"
  on public.tab_custom_platforms for delete using (public.is_approved());
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push` (requires this checkout to be linked via `supabase link --project-ref <ref>` first — see the project's memory on per-worktree Supabase linking if this is a fresh checkout).

Expected: migration applies with no errors; `supabase migration list` shows `20260907120000` applied.

- [ ] **Step 3: Verify live via a direct query**

Run (via the Supabase SQL Editor or `supabase db query`):
```sql
select table_name from information_schema.tables where table_name in ('custom_platforms', 'tab_custom_platforms');
```
Expected: both rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260907120000_add_custom_platforms.sql
git commit -m "feat: add custom_platforms and tab_custom_platforms tables"
```

---

### Task 2: Compute engine (`customPlatforms.ts`)

**Files:**
- Modify: `src/lib/scoreSummary.ts` (export 3 already-existing private functions, no behavior change)
- Create: `src/lib/customPlatforms.ts`
- Create: `src/lib/customPlatforms.test.ts`

**Interfaces:**
- Consumes: `pick`, `isLiveStatus`, `isRemovedStatus`, `isoToDate`, `rateFromCounts`, `successRatePct` (already exported from `scoreSummary.ts`), plus `passesDateFilter`/`startOfDay`/`endOfDay` (exported by this task).
- Produces: `CustomPlatformConfig` interface (re-exported from `customPlatformRegistry.ts` in Task 3 — defined here first since the compute engine needs it and has no other dependency), `computeCustomPlatformCounts(entries, platform, fromISO?, toISO?): CustomPlatformCounts`.

- [ ] **Step 1: Export the 3 helpers `customPlatforms.ts` needs**

In `src/lib/scoreSummary.ts`, change these 3 declarations (no other change — same bodies, same call sites, just made importable):

```ts
// was: function startOfDay(d: Date): Date {
export function startOfDay(d: Date): Date {
```
```ts
// was: function endOfDay(d: Date): Date {
export function endOfDay(d: Date): Date {
```
```ts
// was: function passesDateFilter(
export function passesDateFilter(
```

- [ ] **Step 2: Run the full suite to confirm the export change is behavior-neutral**

Run: `npm test -- scoreSummary`
Expected: all existing `scoreSummary.test.ts` cases still pass unchanged.

- [ ] **Step 3: Write the failing test for the compute engine**

```ts
// src/lib/customPlatforms.test.ts
import { describe, it, expect } from 'vitest';
import { computeCustomPlatformCounts, type CustomPlatformConfig } from './customPlatforms';
import type { Entry } from '../types/entry';

function entry(data: Record<string, string | null>): Entry {
  return { id: crypto.randomUUID(), tab: 'Test Tab', data, created_at: '', updated_at: '' } as Entry;
}

const YELP: CustomPlatformConfig = {
  id: 'p1',
  tab: 'Test Tab',
  name: 'Yelp',
  shortLabel: 'YP',
  statusColumn: 'Yelp Review Status',
  dateColumn: 'Yelp Review Added',
  maxScore: null,
};

describe('computeCustomPlatformCounts', () => {
  it('counts live, removed, and total from the platform-specific status column', () => {
    const entries = [
      entry({ 'Yelp Review Status': 'Published' }),
      entry({ 'Yelp Review Status': 'Removed' }),
      entry({ 'Yelp Review Status': 'Pending' }),
      entry({ 'Yelp Review Status': '' }),
    ];
    const result = computeCustomPlatformCounts(entries, YELP);
    expect(result).toEqual({ total: 2, live: 1, removed: 1, successRate: 50 });
  });

  it('ignores a different platform\'s status column on the same entry', () => {
    const entries = [entry({ 'TP Review Status': 'Published', 'Yelp Review Status': '' })];
    const result = computeCustomPlatformCounts(entries, YELP);
    expect(result).toEqual({ total: 0, live: 0, removed: 0, successRate: null });
  });

  it('excludes a row outside the date range', () => {
    const entries = [
      entry({ 'Yelp Review Status': 'Published', 'Yelp Review Added': '01/01/2026' }),
      entry({ 'Yelp Review Status': 'Published', 'Yelp Review Added': '01/06/2026' }),
    ];
    const result = computeCustomPlatformCounts(entries, YELP, '2026-05-01', '2026-06-30');
    expect(result.total).toBe(1);
  });

  it('always includes a row with no recorded date, matching the built-in platforms\' rule', () => {
    const entries = [entry({ 'Yelp Review Status': 'Removed' })];
    const result = computeCustomPlatformCounts(entries, YELP, '2026-05-01', '2026-06-30');
    expect(result.total).toBe(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- customPlatforms`
Expected: FAIL — `customPlatforms.ts` does not exist yet.

- [ ] **Step 5: Implement the compute engine**

```ts
// src/lib/customPlatforms.ts
import type { Entry } from '../types/entry.ts';
import { pick, isLiveStatus, isRemovedStatus, isoToDate, startOfDay, endOfDay, passesDateFilter, rateFromCounts, successRatePct } from './scoreSummary.ts';

export interface CustomPlatformConfig {
  id: string;
  tab: string;
  name: string;
  shortLabel: string;
  statusColumn: string;
  dateColumn: string;
  maxScore: number | null;
}

export interface CustomPlatformCounts {
  total: number;
  live: number;
  removed: number;
  successRate: number | null;
}

// Reuses the same classification helpers (isLiveStatus/isRemovedStatus) and
// the same date-filter semantics (undated rows always included) the 4
// built-in platforms use in scoreSummary.ts -- zero new classification
// logic, so a custom platform can't silently disagree with what "live" or
// "in range" means anywhere else in the app.
export function computeCustomPlatformCounts(
  entries: Entry[],
  platform: CustomPlatformConfig,
  fromISO?: string,
  toISO?: string,
): CustomPlatformCounts {
  const fromDate = fromISO ? isoToDate(fromISO) : null;
  const toDate = toISO ? isoToDate(toISO) : null;
  const fromBound = fromDate ? startOfDay(fromDate) : null;
  const toBound = toDate ? endOfDay(toDate) : null;

  let live = 0;
  let removed = 0;
  for (const e of entries) {
    if (!passesDateFilter(e.data, [platform.dateColumn], fromBound, toBound)) continue;
    const raw = (pick(e.data, [platform.statusColumn]) ?? '').trim().toLowerCase();
    if (!raw) continue;
    if (isLiveStatus(raw)) live++;
    else if (isRemovedStatus(raw)) removed++;
  }
  return {
    total: live + removed,
    live,
    removed,
    successRate: successRatePct(rateFromCounts(live, removed)),
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- customPlatforms`
Expected: PASS (all 4 cases).

- [ ] **Step 7: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/customPlatforms.ts src/lib/customPlatforms.test.ts
git commit -m "feat: add custom platform compute engine"
```

---

### Task 3: Registry (`customPlatformRegistry.ts`) and `getTabColumns` overlay

**Files:**
- Modify: `src/lib/tab-configs.ts` (add the overlay resolver, ~line 230)
- Modify: `src/lib/dateUtils.ts` (nothing structural — `DATE_ENTRY_HEADERS` just needs to stay a mutable `Set`, which it already is; confirm no change needed)
- Create: `src/lib/customPlatformRegistry.ts`
- Create: `src/lib/customPlatformRegistry.test.ts`

**Interfaces:**
- Consumes: `CustomPlatformConfig` (Task 2), `TAB_COLUMN_CONFIGS` and a new `setCustomPlatformColumnsResolver` setter in `tab-configs.ts`, `DATE_ENTRY_HEADERS` from `dateUtils.ts`.
- Produces: `registerTabCustomPlatforms(rows: CustomPlatformConfig[]): void`, `resetTabCustomPlatforms(): void`, `getTabCustomPlatforms(tab: string): CustomPlatformConfig[]`, `getCustomPlatformColumns(tab: string): string[]`.

- [ ] **Step 1: Add the overlay resolver hook to `tab-configs.ts`**

In `src/lib/tab-configs.ts`, replace:

```ts
// Returns the ordered column list for a tab, or null if no config exists.
export function getTabColumns(tab: string): string[] | null {
  return TAB_COLUMN_CONFIGS[resolveHardcodedTabKey(tab)] ?? (dynamicColumnsResolver ? dynamicColumnsResolver(tab) : null);
}
```

with:

```ts
let customPlatformColumnsResolver: ((tab: string) => string[]) | null = null;

// Injected by customPlatformRegistry.ts at module load (mirrors
// setDynamicColumnsResolver below) -- lets ANY tab, hardcoded or dynamic,
// gain extra columns for a custom platform without this file needing to
// know custom platforms exist. docs/superpowers/specs/2026-09-07-custom-platforms-design.md
export function setCustomPlatformColumnsResolver(fn: (tab: string) => string[]): void {
  customPlatformColumnsResolver = fn;
}

// Returns the ordered column list for a tab, or null if no config exists.
// Any columns from an enabled custom platform are appended after the tab's
// own base columns (hardcoded or dynamic) -- an overlay, not a replacement,
// so both kinds of tab get identical treatment.
export function getTabColumns(tab: string): string[] | null {
  const base = TAB_COLUMN_CONFIGS[resolveHardcodedTabKey(tab)] ?? (dynamicColumnsResolver ? dynamicColumnsResolver(tab) : null);
  if (!base) return null;
  const custom = customPlatformColumnsResolver ? customPlatformColumnsResolver(tab) : [];
  return custom.length ? [...base, ...custom] : base;
}
```

- [ ] **Step 2: Write the failing registry test**

```ts
// src/lib/customPlatformRegistry.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { registerTabCustomPlatforms, resetTabCustomPlatforms, getTabCustomPlatforms, getCustomPlatformColumns } from './customPlatformRegistry';
import { getTabColumns, getTabPlatforms } from './tab-configs';
import { registerDynamicTabs, unregisterDynamicTab } from './dynamicTabRegistry';
import { DATE_ENTRY_HEADERS } from './dateUtils';

const YELP = {
  id: 'p1', tab: 'Hanan', name: 'Yelp', shortLabel: 'YP',
  statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
};

afterEach(() => {
  resetTabCustomPlatforms();
  unregisterDynamicTab('Custom Platform Test Tab');
});

describe('customPlatformRegistry', () => {
  it('getTabCustomPlatforms returns [] when nothing is registered for a tab', () => {
    expect(getTabCustomPlatforms('Hanan')).toEqual([]);
  });

  it('appends a registered platform\'s columns after a hardcoded tab\'s base columns', () => {
    const before = getTabColumns('Hanan')!;
    registerTabCustomPlatforms([YELP]);
    const after = getTabColumns('Hanan')!;
    expect(after).toEqual([...before, 'Yelp Review Status', 'Yelp Review Added']);
  });

  it('appends after a dynamic tab\'s generated columns too', () => {
    registerDynamicTabs([{ name: 'Custom Platform Test Tab', platforms: ['tp'] }]);
    registerTabCustomPlatforms([{ ...YELP, tab: 'Custom Platform Test Tab' }]);
    expect(getTabColumns('Custom Platform Test Tab')).toContain('Yelp Review Status');
  });

  it('registers the date column into DATE_ENTRY_HEADERS', () => {
    registerTabCustomPlatforms([YELP]);
    expect(DATE_ENTRY_HEADERS.has('Yelp Review Added')).toBe(true);
  });

  it('never widens getTabPlatforms\'s built-in return type/value', () => {
    const before = getTabPlatforms('Hanan');
    registerTabCustomPlatforms([YELP]);
    expect(getTabPlatforms('Hanan')).toEqual(before);
  });

  it('resetTabCustomPlatforms clears every registration', () => {
    registerTabCustomPlatforms([YELP]);
    resetTabCustomPlatforms();
    expect(getTabCustomPlatforms('Hanan')).toEqual([]);
    expect(getCustomPlatformColumns('Hanan')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- customPlatformRegistry`
Expected: FAIL — `customPlatformRegistry.ts` does not exist yet.

- [ ] **Step 4: Implement the registry**

```ts
// src/lib/customPlatformRegistry.ts
// In-memory registry for custom platforms
// (docs/superpowers/specs/2026-09-07-custom-platforms-design.md), mirroring
// dynamicTabRegistry.ts's resolver-injection shape exactly: this module
// self-registers a resolver with tab-configs.ts so getTabColumns can append
// a custom platform's columns onto ANY tab (hardcoded or dynamic) with zero
// changes at tab-configs.ts's other call sites.
//
// Deno-safe (no React/npm imports) even though nothing in v1 actually
// imports it from a Deno context -- Schedule Planner/generate-weekly-schedule
// are explicit non-goals -- kept safe for a possible future Phase 2, matching
// every sibling registry module in src/lib.
import { setCustomPlatformColumnsResolver } from './tab-configs.ts';
import { DATE_ENTRY_HEADERS } from './dateUtils.ts';
import type { CustomPlatformConfig } from './customPlatforms.ts';

export type { CustomPlatformConfig };

const byTab: Record<string, CustomPlatformConfig[]> = {};

export function registerTabCustomPlatforms(rows: CustomPlatformConfig[]): void {
  for (const row of rows) {
    if (!byTab[row.tab]) byTab[row.tab] = [];
    byTab[row.tab].push(row);
    // Registers the date column for DD/MM/YYYY validation the same way the 4
    // built-in date columns already get it (dateUtils.ts) -- an in-place Set
    // mutation, same pattern as OPERATIONAL_TABS.push elsewhere in this
    // project, so every existing importer of DATE_ENTRY_HEADERS picks this up
    // with zero call-site changes.
    DATE_ENTRY_HEADERS.add(row.dateColumn);
  }
}

export function resetTabCustomPlatforms(): void {
  for (const tab of Object.keys(byTab)) delete byTab[tab];
}

export function getTabCustomPlatforms(tab: string): CustomPlatformConfig[] {
  return byTab[tab] ?? [];
}

export function getCustomPlatformColumns(tab: string): string[] {
  return getTabCustomPlatforms(tab).flatMap((p) => [p.statusColumn, p.dateColumn]);
}

setCustomPlatformColumnsResolver(getCustomPlatformColumns);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- customPlatformRegistry`
Expected: PASS (all 6 cases).

- [ ] **Step 6: Run full suite + build to confirm no regression on existing tab-configs consumers**

Run: `npm test && npm run build`
Expected: full suite green, build clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/customPlatformRegistry.ts src/lib/customPlatformRegistry.test.ts
git commit -m "feat: add custom platform registry with getTabColumns overlay"
```

---

### Task 4: Queries — fetch/create/enable/disable/delete

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `CustomPlatformConfig` (Task 2/3), `currentActor()` (already exists in `queries.ts`).
- Produces: `fetchCustomPlatforms(): Promise<{id, name, shortLabel, statusColumn, dateColumn, maxScore}[]>`, `fetchTabCustomPlatforms(): Promise<CustomPlatformConfig[]>` (every tab's enabled rows, joined — mirrors `fetchCustomTabs`' bootstrap shape), `createCustomPlatform(name, shortLabel, maxScore, tab): Promise<string>` (returns new platform id, also enables it on `tab`), `enableCustomPlatformOnTab(tab, platformId): Promise<void>`, `disableCustomPlatformOnTab(tab, platformId): Promise<void>`, `deleteCustomPlatform(id): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

This file mocks the Supabase client at module level (`vi.mock('./supabase', ...)`, a `singletonFrom` mock standing in for `supabase.from(...)`, per-test hand-built chains — see `createCustomTab`'s existing tests around line 1148 for the exact established pattern). Append a new `describe` block mirroring that pattern exactly:

```ts
describe('createCustomPlatform / enableCustomPlatformOnTab / deleteCustomPlatform', () => {
  it('rejects a name whose generated columns collide with a reserved column, before any DB call', async () => {
    // No mock setup at all -- the reserved-name check must run and throw
    // before createCustomPlatform ever calls supabase.from(...).
    await expect(createCustomPlatform('TP', 'TP2', null, 'Hanan')).rejects.toThrow(/reserved/i);
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('throws a friendly error on a duplicate platform name', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    singletonFrom.mockReturnValue({ insert });
    await expect(createCustomPlatform('Yelp', 'YP', null, 'Hanan')).rejects.toThrow('A platform named "Yelp" already exists.');
  });

  it('creates the platform then enables it on the given tab', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'p1' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const createInsert = vi.fn().mockReturnValue({ select });
    const enableInsert = vi.fn().mockReturnValue({ then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }) });
    singletonFrom.mockImplementation((table: string) =>
      table === 'custom_platforms' ? { insert: createInsert } : { insert: enableInsert },
    );
    const platform = await createCustomPlatform('Yelp', 'YP', null, 'Hanan');
    expect(platform).toEqual(expect.objectContaining({ id: 'p1', name: 'Yelp', statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added' }));
    expect(enableInsert).toHaveBeenCalledWith(expect.objectContaining({ tab: 'Hanan', platform_id: 'p1' }));
  });

  it('deleteCustomPlatform is blocked while any tab still has it enabled', async () => {
    const countChain = { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ count: 1, error: null }) }) };
    singletonFrom.mockReturnValue(countChain);
    await expect(deleteCustomPlatform('p1')).rejects.toThrow(/still enabled/i);
  });

  it('deleteCustomPlatform succeeds when no tab has it enabled', async () => {
    const countChain = { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ count: 0, error: null }) }) };
    const deleteChain = { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    singletonFrom.mockImplementation((table: string) => (table === 'tab_custom_platforms' ? countChain : deleteChain));
    await expect(deleteCustomPlatform('p1')).resolves.toBeUndefined();
  });
});
```

If any mocked chain shape above doesn't exactly match how the real `.from().select(...,{count:'exact',head:true}).eq(...)` call resolves in this project's actual `@supabase/supabase-js` version, adjust the mock (not the implementation) to match — the implementation in Step 3 below is the source of truth for what shape to mock.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- queries -t "custom platform"`
Expected: FAIL — functions don't exist yet.

- [ ] **Step 3: Implement the reserved-column check and CRUD functions**

Add to `src/lib/queries.ts` (near `fetchCustomTabs`/`createCustomTab`). First,
widen the existing `tab-configs.ts` import line (line 5) to also bring in
`TAB_COLUMN_CONFIGS` — it is not currently imported into this file and
`reservedColumnNames()` below needs it:

```ts
// was: import { getTabColumns, getBrandNameCol, getTabPlatforms, ALL_TOOLBAR_FILTERS, type ToolbarFilterKey } from './tab-configs.ts';
import { getTabColumns, getBrandNameCol, getTabPlatforms, ALL_TOOLBAR_FILTERS, TAB_COLUMN_CONFIGS, type ToolbarFilterKey } from './tab-configs.ts';
```

Then add the new import and functions:

```ts
import type { CustomPlatformConfig } from './customPlatforms.ts';

// Every column name already claimed by a hardcoded tab, so a new custom
// platform's generated status_column/date_column can never silently collide
// with real data. Built from TAB_COLUMN_CONFIGS (all 11 hardcoded tabs) plus
// a hand-kept mirror of dynamicTabRegistry.ts's own TP/AG/CG/WO column lists
// (not imported directly -- those arrays aren't exported there, and this is
// a best-effort safety net, not a security boundary; keep in sync if that
// file's lists change).
const RESERVED_DYNAMIC_TAB_COLUMNS = [
  'Account', 'Country', 'Proxy Used', 'Account Name', 'Agent', 'Brand Name', 'Brand Link',
  'Trust Pilot', 'Link to the profile', 'TP Review Status',
  'Ask Gambler review added', 'AG Review Status', 'AG Review Link', 'AG User',
  'Casino Guru review added', 'CG Review Status', 'CG Review Link', 'CG User',
  'Wizard of Odds', 'WoO Review Status', 'Wizard of OddsScore added', 'WO Review Link',
];

function reservedColumnNames(): Set<string> {
  const names = new Set<string>(RESERVED_DYNAMIC_TAB_COLUMNS);
  for (const cols of Object.values(TAB_COLUMN_CONFIGS)) for (const c of cols) names.add(c);
  return names;
}

export interface CustomPlatformSummary {
  id: string;
  name: string;
  shortLabel: string;
  statusColumn: string;
  dateColumn: string;
  maxScore: number | null;
}

export async function fetchCustomPlatforms(client: SupabaseClient = supabase): Promise<CustomPlatformSummary[]> {
  const { data, error } = await client
    .from('custom_platforms')
    .select('id, name, short_label, status_column, date_column, max_score');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    shortLabel: row.short_label as string,
    statusColumn: row.status_column as string,
    dateColumn: row.date_column as string,
    maxScore: (row.max_score as number | null) ?? null,
  }));
}

export async function fetchTabCustomPlatforms(client: SupabaseClient = supabase): Promise<CustomPlatformConfig[]> {
  const { data, error } = await client
    .from('tab_custom_platforms')
    .select('tab, custom_platforms(id, name, short_label, status_column, date_column, max_score)');
  if (error) throw error;
  return (data ?? [])
    .filter((row) => row.custom_platforms)
    .map((row) => {
      const p = row.custom_platforms as unknown as {
        id: string; name: string; short_label: string; status_column: string; date_column: string; max_score: number | null;
      };
      return {
        id: p.id, tab: row.tab as string, name: p.name, shortLabel: p.short_label,
        statusColumn: p.status_column, dateColumn: p.date_column, maxScore: p.max_score ?? null,
      };
    });
}

// Creates a new custom platform and immediately enables it on `tab` -- one
// action covers the common case (see AddCustomPlatformModal in Task 6).
// Returns the new platform's id so the caller can register it into the
// current session's registry without a refetch.
export async function createCustomPlatform(
  name: string,
  shortLabel: string,
  maxScore: number | null,
  tab: string,
): Promise<CustomPlatformConfig> {
  const trimmed = name.trim();
  const statusColumn = `${trimmed} Review Status`;
  const dateColumn = `${trimmed} Review Added`;
  const reserved = reservedColumnNames();
  if (reserved.has(statusColumn) || reserved.has(dateColumn)) {
    throw new Error(`"${trimmed}" collides with a reserved column name. Choose a different name.`);
  }
  const actor = await currentActor();
  const { data, error } = await supabase
    .from('custom_platforms')
    .insert({ name: trimmed, short_label: shortLabel, status_column: statusColumn, date_column: dateColumn, max_score: maxScore, created_by: actor.email })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(`A platform named "${trimmed}" already exists.`);
    throw error;
  }
  const id = data.id as string;
  await enableCustomPlatformOnTab(tab, id);
  return { id, tab, name: trimmed, shortLabel, statusColumn, dateColumn, maxScore };
}

export async function enableCustomPlatformOnTab(tab: string, platformId: string): Promise<void> {
  const actor = await currentActor();
  const { error } = await supabase
    .from('tab_custom_platforms')
    .insert({ tab, platform_id: platformId, enabled_by: actor.email });
  if (error) {
    if (error.code === '23505') return; // already enabled -- treat as success, matches upsert-like idempotency elsewhere in this file
    throw error;
  }
}

export async function disableCustomPlatformOnTab(tab: string, platformId: string): Promise<void> {
  const { error } = await supabase
    .from('tab_custom_platforms')
    .delete()
    .eq('tab', tab)
    .eq('platform_id', platformId);
  if (error) throw error;
}

export async function deleteCustomPlatform(id: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from('tab_custom_platforms')
    .select('id', { count: 'exact', head: true })
    .eq('platform_id', id);
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    throw new Error('This platform is still enabled on one or more tabs. Disable it everywhere first.');
  }
  const { error } = await supabase.from('custom_platforms').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- queries -t "custom platform"`
Expected: PASS.

- [ ] **Step 5: Run full suite + build**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add custom platform create/enable/disable/delete queries"
```

---

### Task 5: Bootstrap wiring (`AuthContext.tsx`)

**Files:**
- Modify: `src/contexts/AuthContext.tsx`

**Interfaces:**
- Consumes: `fetchTabCustomPlatforms` (Task 4), `registerTabCustomPlatforms` (Task 3).

- [ ] **Step 1: Add the fetch + registration**

In `src/contexts/AuthContext.tsx`:

Add to the import list:
```ts
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchToolbarFilters, fetchArchivedTabs, fetchPausedTabs, fetchTabIconOverrides, fetchHardcodedTabRenames, fetchTabCustomPlatforms } from '../lib/queries';
import { registerTabCustomPlatforms } from '../lib/customPlatformRegistry';
```

Add one more entry to the `Promise.all([...])` array, alongside the other `.catch(() => [])` fetches:
```ts
          fetchTabCustomPlatforms().catch((err) => {
            console.error('Failed to fetch tab custom platforms:', err);
            return [];
          }),
```

Add the corresponding destructured parameter and registration call in the `.then(...)` block:
```ts
        ]).then(([p, customTabs, hiddenPlatforms, toolbarFilters, archivedTabs, pausedTabs, tabIconOverrides, hardcodedTabRenames, tabCustomPlatforms]) => {
          if (!mounted) return;
          registerDynamicTabs(customTabs);
          registerHiddenTabPlatforms(hiddenPlatforms);
          registerToolbarFilters(toolbarFilters);
          registerTabCustomPlatforms(tabCustomPlatforms);
```
(insert `registerTabCustomPlatforms(tabCustomPlatforms);` right after `registerToolbarFilters(toolbarFilters);` — order-independent relative to the archive/pause/icon/rename calls that follow, same reasoning already documented for `registerTabIconOverrides`/`registerHardcodedTabRenames` in this block: none of those touch `OPERATIONAL_TABS` membership or custom platform state.)

- [ ] **Step 2: Build to confirm no type errors**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`, sign in, open the browser console — confirm no "Failed to fetch tab custom platforms" error logged (table is empty at this point, so the fetch should resolve to `[]` with no error).

- [ ] **Step 4: Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "feat: register custom platforms at session bootstrap"
```

---

### Task 6: Create & enable UI (`AddCustomPlatformModal.tsx` + wiring)

**Files:**
- Create: `src/components/AddCustomPlatformModal.tsx`
- Modify: `src/components/AddBrandTabModal.tsx`
- Modify: `src/components/EditBrandTabModal.tsx`

**Interfaces:**
- Consumes: `fetchCustomPlatforms`, `createCustomPlatform`, `enableCustomPlatformOnTab`, `disableCustomPlatformOnTab` (Task 4); `registerTabCustomPlatforms`, `getTabCustomPlatforms` (Task 3).
- Produces: `AddCustomPlatformModal` component, `onCreated: (platform: CustomPlatformConfig) => void` callback.

- [ ] **Step 1: Build `AddCustomPlatformModal.tsx`**

```tsx
// src/components/AddCustomPlatformModal.tsx
import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createCustomPlatform } from '../lib/queries';
import type { CustomPlatformConfig } from '../lib/customPlatforms';

interface Props {
  tab: string;
  onCreated: (platform: CustomPlatformConfig) => void;
  onClose: () => void;
}

export default function AddCustomPlatformModal({ tab, onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [shortLabel, setShortLabel] = useState('');
  const [maxScore, setMaxScore] = useState<'' | '5' | '10'>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmedName = name.trim();
    const trimmedLabel = shortLabel.trim().toUpperCase();
    if (!trimmedName) { setError('Enter a platform name.'); return; }
    if (!trimmedLabel) { setError('Enter a short label (2-4 characters).'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const platform = await createCustomPlatform(trimmedName, trimmedLabel, maxScore ? Number(maxScore) : null, tab);
      onCreated(platform);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create platform');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && onClose()} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-sm font-semibold text-slate-800">Add Custom Platform</h2>
          <button onClick={() => !submitting && onClose()} disabled={submitting} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 pb-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Platform name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Yelp"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Short label</label>
            <input
              type="text"
              value={shortLabel}
              onChange={(e) => setShortLabel(e.target.value)}
              placeholder="e.g. YP"
              maxLength={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Rating scale (optional)</label>
            <select
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value as '' | '5' | '10')}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">No star rating -- Live/Removed counts only</option>
              <option value="5">1-5 stars</option>
              <option value="10">1-10 stars</option>
            </select>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Create Platform
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `AddBrandTabModal.tsx`**

Add state and imports:
```ts
import { createCustomTab, upsertTabIconOverride, fetchCustomPlatforms } from '../lib/queries';
import { registerTabCustomPlatforms } from '../lib/customPlatformRegistry';
import type { CustomPlatformSummary } from '../lib/queries';
import AddCustomPlatformModal from './AddCustomPlatformModal';
```
```ts
const [customPlatforms, setCustomPlatforms] = useState<CustomPlatformSummary[]>([]);
const [enabledCustomPlatformIds, setEnabledCustomPlatformIds] = useState<string[]>([]);
const [showAddCustomPlatform, setShowAddCustomPlatform] = useState(false);

useEffect(() => {
  fetchCustomPlatforms().then(setCustomPlatforms).catch((err) => console.error('Failed to fetch custom platforms:', err));
}, []);
```

In the JSX, right after the `PLATFORM_LIST.map(...)` checkbox block (inside the same "Platforms" `<div>`), add:
```tsx
{customPlatforms.map((p) => (
  <label key={p.id} className="flex items-center gap-2 mb-1.5 text-sm text-slate-700 cursor-pointer">
    <input
      type="checkbox"
      checked={enabledCustomPlatformIds.includes(p.id)}
      onChange={() => setEnabledCustomPlatformIds((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])}
      className="size-4"
    />
    {p.name}
  </label>
))}
<button
  type="button"
  onClick={() => setShowAddCustomPlatform(true)}
  disabled={!name.trim()}
  title={!name.trim() ? 'Enter a tab name first' : undefined}
  className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
>
  + Add custom platform
</button>
{showAddCustomPlatform && (
  <AddCustomPlatformModal
    tab={name.trim()}
    onCreated={(platform) => {
      setCustomPlatforms((prev) => [...prev, { id: platform.id, name: platform.name, shortLabel: platform.shortLabel, statusColumn: platform.statusColumn, dateColumn: platform.dateColumn, maxScore: platform.maxScore }]);
      setEnabledCustomPlatformIds((prev) => [...prev, platform.id]);
      setShowAddCustomPlatform(false);
    }}
    onClose={() => setShowAddCustomPlatform(false)}
  />
)}
```

In `handleSubmit`, after the existing `await createCustomTab(...)` call succeeds, enable every checked custom platform on the just-created tab and register them locally:
```ts
      await createCustomTab(trimmed, platforms, filters);
      for (const id of enabledCustomPlatformIds) {
        const p = customPlatforms.find((cp) => cp.id === id);
        if (p) {
          registerTabCustomPlatforms([{ id: p.id, tab: trimmed, name: p.name, shortLabel: p.shortLabel, statusColumn: p.statusColumn, dateColumn: p.dateColumn, maxScore: p.maxScore }]);
        }
      }
```
(the platform created via `AddCustomPlatformModal` is already enabled server-side on whatever `tab` value (`name.trim()`) was current at the moment it was created — since the user could still edit the Tab Name field afterward before clicking "Create Tab", re-run `enableCustomPlatformOnTab(trimmed, id)` here for every id in `enabledCustomPlatformIds`, using the final `trimmed` name, rather than trusting the earlier enable call; add that as an explicit loop before the `registerTabCustomPlatforms` loop above, importing `enableCustomPlatformOnTab` from `../lib/queries`. Accepted residual edge case, not fixed by this plan: if the user creates a custom platform, THEN edits the Tab Name field to a different value, THEN submits, the earlier enable call's row (under the first name) is never cleaned up — a harmless orphaned `tab_custom_platforms` row with no entries ever attached to it, not visible anywhere in the UI. Requiring the name field to be filled before "+ Add custom platform" is enabled (above) closes the more common blank-name case; this narrower rename-after-create case is left undocumented-but-low-impact rather than adding more machinery to close it.)

- [ ] **Step 3: Wire into `EditBrandTabModal.tsx`**

Mirror Step 2's pattern: fetch `customPlatforms` on mount, seed `enabledCustomPlatformIds` from `getTabCustomPlatforms(tabName).map(p => p.id)`, render the same checkbox list + "+ Add custom platform" button (reusing `AddCustomPlatformModal` with `tab={tabName}`), and on save, diff `enabledCustomPlatformIds` against the initial set: for each newly-checked id call `enableCustomPlatformOnTab(tabName, id)`, for each newly-unchecked id call `disableCustomPlatformOnTab(tabName, id)`, then call `registerTabCustomPlatforms`/re-fetch to refresh the in-memory registry for the current session, and fire the existing `onUpdated()` callback so `BrandGroup.tsx` reloads.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`. Open "+ Add Brand Tab", click "+ Add custom platform", create "Yelp" with short label "YP" and no rating scale, check it, create the tab. Open Edit Brand Tab on a different (hardcoded) tab, confirm "Yelp" appears as a plain checkbox, check it, save. Confirm no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/AddCustomPlatformModal.tsx src/components/AddBrandTabModal.tsx src/components/EditBrandTabModal.tsx
git commit -m "feat: add UI to create and enable custom platforms per tab"
```

---

### Task 7: Entry fields in `AddReviewAccountModal.tsx`

**Files:**
- Modify: `src/components/AddReviewAccountModal.tsx`

**Interfaces:**
- Consumes: `getTabCustomPlatforms` (Task 3).
- Note: `EditEntryModal.tsx` needs **no changes** — it already renders every header in `getTabColumns(tab)` generically via `sectionOf`/`isStatusCol`, so a custom platform's 2 columns render and save automatically the moment `getTabColumns` includes them (Task 3). Confirm this explicitly in Step 4 below rather than skipping verification.

- [ ] **Step 1: Add the import and a per-selected-tab custom platform list**

```ts
import { getTabCustomPlatforms } from '../lib/customPlatformRegistry';
```

Right after `const showAgentField = getTabColumns(selectedTab)?.includes('Agent') ?? false;`, add:
```ts
const tabCustomPlatforms = getTabCustomPlatforms(selectedTab);
const customPlatformFields: FieldDef[] = tabCustomPlatforms.flatMap((p) => [
  { key: p.statusColumn, label: `${p.name} Status`, status: true },
  { key: p.dateColumn, label: `${p.name} Added` },
]);
```

- [ ] **Step 2: Initialize their values and clear them on tab change**

In the `fields` `useState` initializer, add a spread covering the *current* tab's custom platforms (mirrors the existing `ALL_KEYS`/`YES_NO_DEFAULTS` spreads):
```ts
  const [fields, setFields] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(ALL_KEYS.map((k) => [k, ''])),
    ...YES_NO_DEFAULTS,
    ...Object.fromEntries(getTabCustomPlatforms(currentTab).flatMap((p) => [[p.statusColumn, ''], [p.dateColumn, '']])),
    [getBrandNameCol(currentTab)]: '',
    [getBrandLinkCol(currentTab)]: '',
  }));
```

In `handleTabChange`, add a line clearing every custom platform field the *new* tab has (old-tab values simply won't be included in `saveFields` on submit, so they're inert, not incorrect — see Step 3):
```ts
  function handleTabChange(tab: string) {
    setSelectedTab(tab);
    setFields((s) => ({
      ...s,
      'Agent': '',
      [getBrandNameCol(tab)]: '',
      [getBrandLinkCol(tab)]: '',
      'Link to the profile': '',
      'Ask Gambler review added': '',
      'AG Review Status': '',
      'AG Review Link': '',
      'Casino Guru review added': '',
      'CG Review Status': '',
      'CG Review Link': '',
      ...Object.fromEntries(getTabCustomPlatforms(tab).flatMap((p) => [[p.statusColumn, ''], [p.dateColumn, '']])),
    }));
  }
```

- [ ] **Step 3: Include the fields in `saveFields`**

In `handleSave`, change:
```ts
    const saveFields = [
      ...(showAgentField ? [AGENT_FIELD] : []),
      brandField, ...(brandLinkField ? [brandLinkField] : []),
      ...ACCOUNT_FIELDS, ...TP_FIELDS,
      ...(isMulti ? [...AG_FIELDS, ...CG_FIELDS] : []),
      ...BEHAVIOR_EXTRA_FIELDS, ...YES_NO_FIELDS,
    ];
```
to:
```ts
    const saveFields = [
      ...(showAgentField ? [AGENT_FIELD] : []),
      brandField, ...(brandLinkField ? [brandLinkField] : []),
      ...ACCOUNT_FIELDS, ...TP_FIELDS,
      ...(isMulti ? [...AG_FIELDS, ...CG_FIELDS] : []),
      ...customPlatformFields,
      ...BEHAVIOR_EXTRA_FIELDS, ...YES_NO_FIELDS,
    ];
```

- [ ] **Step 4: Render the new section**

Right after the Casino Guru section's closing `</div>` (the block rendered `{isMulti && <>...CG_FIELDS.map(renderField)...</>}`) and before the Behavior Flags section, add:
```tsx
{customPlatformFields.length > 0 && (
  <div>
    <SectionHeading label="Custom Platforms" />
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
      {customPlatformFields.map(renderField)}
    </div>
  </div>
)}
```

- [ ] **Step 5: Manual smoke check (covers both modals)**

Run: `npm run dev`. Open Add Review Account on the tab from Task 6 that has Yelp enabled — confirm a "Custom Platforms" section renders with "Yelp Status" (dropdown) and "Yelp Added" (date text field, DD/MM/YYYY placeholder). Set both, save, confirm the entry was created with those 2 fields populated (check via Edit Entry on the new row). Then open Edit Entry directly on that same row and confirm the same 2 fields appear (in the Account Details section, since there's no dedicated Yelp bucket) and are editable — this is the "no code change needed" claim for `EditEntryModal.tsx`; if either field is missing here, treat it as a real bug in this task, not an acceptable gap.

- [ ] **Step 6: Commit**

```bash
git add src/components/AddReviewAccountModal.tsx
git commit -m "feat: render custom platform fields in Add Review Account"
```

---

### Task 8: Overview KPI data layer (`TabKpis.customPlatforms`)

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `getTabCustomPlatforms` (Task 3), `computeCustomPlatformCounts` (Task 2).
- Produces: `TabKpis.customPlatforms: { platform: CustomPlatformConfig; live: number; removed: number; total: number; successRate: number | null }[]` (new optional-shaped field, additive — every existing field on `TabKpis` is untouched).

- [ ] **Step 1: Write the failing test**

Find `computeTabKpisFromEntries`'s existing test block in `queries.test.ts` and add:
```ts
it('includes customPlatforms counts for any platform enabled on the tab', () => {
  registerTabCustomPlatforms([{ id: 'p1', tab: 'Hanan', name: 'Yelp', shortLabel: 'YP', statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null }]);
  const entries = [
    { id: '1', tab: 'Hanan', data: { 'Yelp Review Status': 'Published' } },
    { id: '2', tab: 'Hanan', data: { 'Yelp Review Status': 'Removed' } },
  ] as Entry[];
  const result = computeTabKpisFromEntries(entries, [], 'Hanan', 'Brands', undefined, undefined, new Set());
  expect(result?.customPlatforms).toEqual([
    { platform: expect.objectContaining({ name: 'Yelp' }), total: 2, live: 1, removed: 1, successRate: 50 },
  ]);
  resetTabCustomPlatforms();
});
```
(import `registerTabCustomPlatforms`/`resetTabCustomPlatforms` from `../lib/customPlatformRegistry` at the top of the test file if not already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- queries -t "customPlatforms counts"`
Expected: FAIL — `TabKpis` has no `customPlatforms` field yet.

- [ ] **Step 3: Implement**

Add one new import, and extend the one Task 4 already added (do NOT add a
second, separate import of `CustomPlatformConfig` — that would collide with
Task 4's `import type { CustomPlatformConfig } from './customPlatforms.ts';`
and fail as a duplicate identifier):
```ts
import { getTabCustomPlatforms } from './customPlatformRegistry.ts';
```
```ts
// was (added by Task 4): import type { CustomPlatformConfig } from './customPlatforms.ts';
import { computeCustomPlatformCounts, type CustomPlatformConfig } from './customPlatforms.ts';
```

Find the `TabKpis` interface (near `activePlatforms: ('tp' | 'ag' | 'cg' | 'wo')[];`, referenced in the earlier `computeTabKpisFromEntries` read) and add one field:
```ts
  customPlatforms: { platform: CustomPlatformConfig; total: number; live: number; removed: number; successRate: number | null }[];
```

In `computeTabKpisFromEntries`, right before its final `return { total: live + removed, ... }` statement, add:
```ts
  const customPlatforms = getTabCustomPlatforms(tab).map((platform) => ({
    platform,
    ...computeCustomPlatformCounts(filteredEntries, platform, dateFrom, dateTo),
  }));
```
and add `customPlatforms,` to the returned object (alongside the existing `tp`, `ag`, `cg`, `wo`, `activePlatforms`, ... fields).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- queries -t "customPlatforms counts"`
Expected: PASS.

- [ ] **Step 5: Run full suite + build**

Run: `npm test && npm run build`
Expected: green — confirm no other `TabKpis` consumer breaks from the new field (it's additive, so nothing should).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: compute custom platform counts into TabKpis"
```

---

### Task 9: Overview rendering

**Files:**
- Modify: `src/pages/Overview.tsx`

**Interfaces:**
- Consumes: `tabKpis.customPlatforms` (Task 8).

- [ ] **Step 1: Render one line per custom platform, per tab**

Find the block rendered at (originally) line ~958-972 of `Overview.tsx` — the `tabKpis?.activePlatforms.map((p) => (<Link ...>...</Link>))` block that renders each built-in platform's Live/Removed/Success-Rate line for a tab. Immediately after that `.map(...)` call's closing `))}`, add a sibling `.map(...)` over the new field:
```tsx
{tabKpis?.customPlatforms.map(({ platform, live, removed }) => (
  <div key={platform.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-slate-600">
    <span className="inline-flex shrink-0 items-center rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold leading-none text-slate-600">
      {platform.shortLabel}
    </span>
    <span className="whitespace-nowrap"><span className="font-medium text-emerald-600">{live}</span> live</span>
    <span className="whitespace-nowrap"><span className="font-medium text-rose-500">{removed}</span> removed</span>
    <SuccessRateBadge live={live} removed={removed} size="sm" />
  </div>
))}
```
(a plain `<div>`, not a `<Link>` — a custom platform has no `?platform=` filter support on Brand Tabs' toolbar in v1, so it isn't clickable like the built-in ones; this is a deliberate, documented v1 simplification, not an oversight.)

- [ ] **Step 2: Manual smoke check**

Run: `npm run dev`, open Overview, confirm the tab with Yelp enabled (from Task 6/7) shows a "YP · N live · N removed · success rate" line alongside its built-in platform lines, using the real counts from the entries created in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat: show custom platform counts on Overview's per-tab cards"
```

---

### Task 10: Brand Tabs (`BrandGroup.tsx`) rendering

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `getTabCustomPlatforms` (Task 3), `computeCustomPlatformCounts` (Task 2).

- [ ] **Step 1: Add the import and a computed list**

```ts
import { getTabCustomPlatforms } from '../lib/customPlatformRegistry';
import { computeCustomPlatformCounts } from '../lib/customPlatforms';
```

Immediately after the `displayTotals` computation (the `const displayTotals = (() => { ... })();` block), add:
```ts
  const tabCustomPlatforms = getTabCustomPlatforms(decodedTab);
  const customPlatformCounts = tabCustomPlatforms.map((platform) => ({
    platform,
    ...computeCustomPlatformCounts(ratingFiltered, platform, dateActive ? dateFrom : undefined, dateActive ? dateTo : undefined),
  }));
```

- [ ] **Step 2: Render a card row**

Immediately after the `{activePlatforms.length > 1 && (() => { ... })()}` block (the multi-platform card grid) and before the table container `<div className="rounded-b-lg ...">`, add:
```tsx
{customPlatformCounts.length > 0 && (
  <div className={`grid grid-cols-1 gap-3 ${customPlatformCounts.length === 1 ? 'sm:grid-cols-1' : customPlatformCounts.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} mt-[10px]`}>
    {customPlatformCounts.map(({ platform, live, removed }) => (
      <div key={platform.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{platform.name}</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Success Rate</span>
            <SuccessRateBadge live={live} removed={removed} />
          </span>
        </div>
        {loading ? (
          <div className="h-6 w-20 animate-pulse rounded bg-slate-200" />
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-semibold text-emerald-700">{live.toLocaleString()}</span>
              <span className="text-xs text-slate-400">Live</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-semibold text-rose-600">{removed.toLocaleString()}</span>
              <span className="text-xs text-slate-400">Removed</span>
            </div>
          </div>
        )}
      </div>
    ))}
  </div>
)}
```
(a plain, non-clickable card — no `platformFilter`/`statusFilter` wiring for a custom platform in v1, matching the same deliberate simplification as Overview's line.)

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`, open the Brand Tab with Yelp enabled, confirm a "Yelp" card renders below the existing platform cards with correct Live/Removed/Success-Rate numbers matching the entries created in Task 7. Change the date range toolbar filter to exclude those entries' dates and confirm the card's numbers update accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: show custom platform KPI cards on Brand Tabs"
```

---

## Post-plan: full verification

After Task 10, before considering this done:

- [ ] `npm run build` — must be clean (the project's `tsc --noEmit` root config is references-only and checks nothing; `npm run build` is the real check).
- [ ] `npm test` — full suite green.
- [ ] Live browser walkthrough of the full loop end to end, on real (or throwaway test) data: create a custom platform from a dynamic tab's Add Brand Tab flow, enable it on a second, hardcoded tab via Edit Brand Tab, add one entry with a Live status and one with a Removed status via Add Review Account on each tab, confirm both tabs' Overview lines and Brand Tabs cards report matching Live/Removed/Success-Rate numbers, confirm Edit Entry shows and can edit the same 2 fields, then delete the test entries and disable+delete the test platform to leave no residue.
- [ ] A final whole-branch review per this project's standing cross-dashboard-consistency rule (CLAUDE.md) — even though this plan deliberately keeps Schedule Planner/Ask AI/Score Summary untouched, confirm nothing in Tasks 1-10 accidentally widened `Platform`, touched `getTabPlatforms`, or otherwise leaked into those surfaces.
- [ ] Update this project's `docs/task-history.md` with a Recent Changes entry per this project's PMS workflow standing rule, and flag in Known Issues that Schedule Planner, Ask AI, Score Summary, and the removed-platform-brands flag do not recognize custom platforms yet (deliberate, documented v1 scope).
