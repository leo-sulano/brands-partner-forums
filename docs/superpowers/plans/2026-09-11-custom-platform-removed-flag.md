# Custom Platform "Page Removed" Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a brand's page on a user-defined custom platform be flagged "removed" (delisted), excluding it from KPIs — full parity with the existing built-in `removed_platform_brands` mechanism (badge, Edit Entry checkbox, Edit Brand Tab bulk section, CSV/Excel export column, notification email).

**Architecture:** A new `removed_custom_platform_brands` table (keyed by `custom_platforms.id` instead of the closed `Platform` union) sits alongside the existing `removed_platform_brands` table. The tricky diff/notify logic in `platformRemovedActions.ts` is extracted into a generic engine both the built-in and custom paths call, so that logic is never duplicated — only storage/lookup stays separate. UI components (`PlatformRemovedBadge`, `PlatformRemovedModal`) generalize their props from `{ platform: Platform }` to plain descriptor shapes so both paths render through the same components.

**Tech Stack:** React 19, TypeScript, Supabase (Postgres + supabase-js), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-custom-platform-removed-flag-design.md`

## Global Constraints

- Every new/modified exported function in `src/lib` keeps the existing project convention: no `any`, injectable `SupabaseClient` param defaulting to the shared singleton (matching `fetchRemovedPlatformBrands`'s existing shape).
- `savePlatformRemoved`'s existing test suite (`platformRemovedActions.test.ts`) must pass **unmodified** after the Task 5 refactor — this proves the extraction didn't change built-in behavior.
- `computeTabKpisFromEntries`/`fetchTabKpis`'s new parameter goes at the **end** of the parameter list with a default value, so none of the ~40 existing positional call sites in `queries.test.ts` need updating.
- No Edge Function changes and no `supabase functions deploy` in this plan — Schedule Planner and Ask AI parity are separate, out-of-scope sub-projects (see spec Non-goals).
- Verify with `npm run build`, not `tsc --noEmit` — the root tsconfig is references-only and `tsc --noEmit` checks nothing in this repo.

---

### Task 1: Migration — `removed_custom_platform_brands` table

**Files:**
- Create: `supabase/migrations/20260911120000_add_removed_custom_platform_brands.sql`

**Interfaces:**
- Produces: table `removed_custom_platform_brands(id, tab, brand, brand_key, platform_id, removed_by, removed_at)`, unique on `(tab, brand_key, platform_id)`, `platform_id references custom_platforms(id) on delete restrict`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260911120000_add_removed_custom_platform_brands.sql
-- A brand's page on a custom (user-defined) platform can be delisted
-- entirely, independent of any single review's status -- the same concept
-- removed_platform_brands covers for the 4 built-in platforms, generalized
-- here for a custom platform identified by custom_platforms.id instead of a
-- closed platform code. Spec:
-- docs/superpowers/specs/2026-09-11-custom-platform-removed-flag-design.md

create table public.removed_custom_platform_brands (
  id            uuid primary key default gen_random_uuid(),
  tab           text not null,
  brand         text not null,
  brand_key     text generated always as (lower(btrim(brand))) stored,
  platform_id   uuid not null references public.custom_platforms(id) on delete restrict,
  removed_by    text,
  removed_at    timestamptz not null default now(),
  unique (tab, brand_key, platform_id)
);

alter table public.removed_custom_platform_brands enable row level security;

create policy "anyone can read removed_custom_platform_brands"
  on public.removed_custom_platform_brands for select using (true);
create policy "approved users can insert removed_custom_platform_brands"
  on public.removed_custom_platform_brands for insert with check (public.is_approved());
create policy "approved users can update removed_custom_platform_brands"
  on public.removed_custom_platform_brands for update using (public.is_approved());
create policy "approved users can delete removed_custom_platform_brands"
  on public.removed_custom_platform_brands for delete using (public.is_approved());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260911120000_add_removed_custom_platform_brands.sql
git commit -m "feat: add removed_custom_platform_brands table"
```

Note: do NOT run `supabase db push` yet — deployment happens once, in Task 13, after all frontend code is ready.

---

### Task 2: `removedCustomPlatformBrands.ts` — key builder module

**Files:**
- Create: `src/lib/removedCustomPlatformBrands.ts`
- Test: `src/lib/removedCustomPlatformBrands.test.ts`

**Interfaces:**
- Consumes: `normalizeBrandKey` from `./removedPlatformBrands.ts`.
- Produces: `customPlatformRemovedKey(tab: string, brand: string, platformId: string): string`, `buildRemovedCustomPlatformBrandSet(rows: { tab: string; brand: string; platform_id: string }[]): Set<string>`, `buildRemovedCustomPlatformBrandDateMap(rows: { tab: string; brand: string; platform_id: string; removed_at: string }[]): Map<string, string>` — consumed by Tasks 3, 4, 9, 10, 12.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/removedCustomPlatformBrands.test.ts
import { describe, it, expect } from 'vitest';
import {
  customPlatformRemovedKey,
  buildRemovedCustomPlatformBrandSet,
  buildRemovedCustomPlatformBrandDateMap,
} from './removedCustomPlatformBrands';

describe('customPlatformRemovedKey', () => {
  it('joins tab, normalized brand, and platform id', () => {
    expect(customPlatformRemovedKey('BITP', 'Brand X', 'p1')).toBe('BITP::brand x::p1');
  });

  it('normalizes case and whitespace on the brand only', () => {
    expect(customPlatformRemovedKey('BITP', '  Brand X  ', 'p1')).toBe('BITP::brand x::p1');
  });
});

describe('buildRemovedCustomPlatformBrandSet', () => {
  it('builds one key per row', () => {
    const set = buildRemovedCustomPlatformBrandSet([
      { tab: 'BITP', brand: 'Brand X', platform_id: 'p1' },
      { tab: 'Hanan', brand: 'Brand Y', platform_id: 'p2' },
    ]);
    expect(set.has('BITP::brand x::p1')).toBe(true);
    expect(set.has('Hanan::brand y::p2')).toBe(true);
    expect(set.size).toBe(2);
  });
});

describe('buildRemovedCustomPlatformBrandDateMap', () => {
  it('maps each key to its removed_at', () => {
    const map = buildRemovedCustomPlatformBrandDateMap([
      { tab: 'BITP', brand: 'Brand X', platform_id: 'p1', removed_at: '2026-09-05' },
    ]);
    expect(map.get('BITP::brand x::p1')).toBe('2026-09-05');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/removedCustomPlatformBrands.test.ts`
Expected: FAIL — `Cannot find module './removedCustomPlatformBrands'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/removedCustomPlatformBrands.ts
//
// A brand's page on a custom (user-defined) platform can be delisted
// entirely, independent of any single review's status and independent of
// that brand's standing on any other platform (built-in or custom) -- the
// same concept removedPlatformBrands.ts covers for TP/AG/CG/WO, generalized
// here for a custom platform identified by its custom_platforms.id instead
// of the closed Platform union. Flagged (tab, brand, platform_id) triples
// live in the `removed_custom_platform_brands` table. Kept as a separate
// table/module from removedPlatformBrands.ts rather than widening that
// module's closed Platform union -- see
// docs/superpowers/specs/2026-09-11-custom-platform-removed-flag-design.md.
import { normalizeBrandKey } from './removedPlatformBrands.ts';

export { normalizeBrandKey };

export function customPlatformRemovedKey(tab: string, brand: string, platformId: string): string {
  return `${tab}::${normalizeBrandKey(brand)}::${platformId}`;
}

export function buildRemovedCustomPlatformBrandSet(
  rows: { tab: string; brand: string; platform_id: string }[],
): Set<string> {
  return new Set(rows.map((r) => customPlatformRemovedKey(r.tab, r.brand, r.platform_id)));
}

export function buildRemovedCustomPlatformBrandDateMap(
  rows: { tab: string; brand: string; platform_id: string; removed_at: string }[],
): Map<string, string> {
  return new Map(rows.map((r) => [customPlatformRemovedKey(r.tab, r.brand, r.platform_id), r.removed_at]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/removedCustomPlatformBrands.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/removedCustomPlatformBrands.ts src/lib/removedCustomPlatformBrands.test.ts
git commit -m "feat: add removedCustomPlatformBrands key builder module"
```

---

### Task 3: `queries.ts` — fetch/set trio for the new table

**Files:**
- Modify: `src/lib/queries.ts` (add near `fetchRemovedPlatformBrands`/`fetchRemovedPlatformBrandsForTab` around line 249-281, and near `setBrandPlatformRemoved` around line 1193-1213)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `normalizeBrandKey` (already imported in queries.ts from `./removedPlatformBrands.ts`), `currentUserEmail` (already defined/used in queries.ts by `setBrandPlatformRemoved`).
- Produces: `fetchRemovedCustomPlatformBrands(client?): Promise<{ tab, brand, platform_id, removed_at }[]>`, `RemovedCustomPlatformBrandRow` interface (`{ tab, brand, platform_id, removed_at, removed_by }`), `fetchRemovedCustomPlatformBrandsForTab(tab, client?): Promise<RemovedCustomPlatformBrandRow[]>`, `setCustomPlatformBrandRemoved(tab, brand, platformId, removed, removedAt?): Promise<void>` — consumed by Tasks 5, 7, 8, 9, 10, 12.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/queries.test.ts`, in the `import { ... } from './queries'` block near the top (alongside `fetchRemovedPlatformBrands`), add `fetchRemovedCustomPlatformBrands`, `setCustomPlatformBrandRemoved`. Then add these tests right after the existing `fetchRemovedPlatformBrands` tests (after line 289, before `it('bulkUpsertBrandSchedule uses the passed-in client for the upsert' ...`):

```typescript
  it('fetchRemovedCustomPlatformBrands uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchRemovedCustomPlatformBrands({ from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('removed_custom_platform_brands');
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('fetchRemovedCustomPlatformBrands selects removed_at alongside tab/brand/platform_id', async () => {
    const selectSpy = vi.fn().mockReturnValue({
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
    });
    const fakeFrom = vi.fn().mockReturnValue({ select: selectSpy });
    await fetchRemovedCustomPlatformBrands({ from: fakeFrom } as any);
    expect(selectSpy).toHaveBeenCalledWith('tab, brand, platform_id, removed_at');
  });

  it('setCustomPlatformBrandRemoved upserts a payload keyed by tab/brand_key/platform_id when removed=true', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ upsert });
    await setCustomPlatformBrandRemoved('BITP', 'Brand X', 'p1', true, '2026-09-05');
    expect(singletonFrom).toHaveBeenCalledWith('removed_custom_platform_brands');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'BITP', brand: 'Brand X', platform_id: 'p1', removed_at: '2026-09-05' }),
      { onConflict: 'tab,brand_key,platform_id' },
    );
  });

  it('setCustomPlatformBrandRemoved deletes the row keyed by brand_key when removed=false', async () => {
    const eq3 = vi.fn().mockResolvedValue({ error: null });
    const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const del = vi.fn().mockReturnValue({ eq: eq1 });
    singletonFrom.mockReturnValue({ delete: del });
    await setCustomPlatformBrandRemoved('BITP', 'Brand X', 'p1', false);
    expect(singletonFrom).toHaveBeenCalledWith('removed_custom_platform_brands');
    expect(eq1).toHaveBeenCalledWith('tab', 'BITP');
    expect(eq2).toHaveBeenCalledWith('brand_key', 'brand x');
    expect(eq3).toHaveBeenCalledWith('platform_id', 'p1');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts -t "RemovedCustomPlatformBrands|CustomPlatformBrandRemoved"`
Expected: FAIL — `fetchRemovedCustomPlatformBrands`/`setCustomPlatformBrandRemoved` are not exported

- [ ] **Step 3: Write the implementation**

In `src/lib/queries.ts`, add right after `fetchRemovedPlatformBrandsForTab` (after line 281):

```typescript
export async function fetchRemovedCustomPlatformBrands(
  client: SupabaseClient = supabase,
): Promise<{ tab: string; brand: string; platform_id: string; removed_at: string }[]> {
  const { data, error } = await client
    .from('removed_custom_platform_brands')
    .select('tab, brand, platform_id, removed_at');
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string; platform_id: string; removed_at: string }[];
}

export interface RemovedCustomPlatformBrandRow {
  tab: string;
  brand: string;
  platform_id: string;
  removed_at: string;
  removed_by: string | null;
}

// Tab-scoped sibling of fetchRemovedCustomPlatformBrands above, carrying
// removed_by too -- mirrors fetchRemovedPlatformBrandsForTab exactly, feeds
// the Edit Brand Tab "Removed platform pages" section's custom-platform rows.
export async function fetchRemovedCustomPlatformBrandsForTab(
  tab: string,
  client: SupabaseClient = supabase,
): Promise<RemovedCustomPlatformBrandRow[]> {
  const { data, error } = await client
    .from('removed_custom_platform_brands')
    .select('tab, brand, platform_id, removed_at, removed_by')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as RemovedCustomPlatformBrandRow[];
}
```

And right after `setBrandPlatformRemoved` (after line 1213):

```typescript
// Mirrors setBrandPlatformRemoved exactly, for a custom platform identified
// by its custom_platforms.id instead of the closed Platform union.
export async function setCustomPlatformBrandRemoved(
  tab: string, brand: string, platformId: string, removed: boolean, removedAt?: string,
): Promise<void> {
  const brandKey = normalizeBrandKey(brand);
  if (removed) {
    const payload: { tab: string; brand: string; platform_id: string; removed_by: string | null; removed_at?: string } = {
      tab, brand, platform_id: platformId, removed_by: await currentUserEmail(),
    };
    if (removedAt) payload.removed_at = removedAt;
    const { error } = await supabase
      .from('removed_custom_platform_brands')
      .upsert(payload, { onConflict: 'tab,brand_key,platform_id' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('removed_custom_platform_brands')
      .delete()
      .eq('tab', tab)
      .eq('brand_key', brandKey)
      .eq('platform_id', platformId);
    if (error) throw error;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts -t "RemovedCustomPlatformBrands|CustomPlatformBrandRemoved"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add fetch/set functions for removed_custom_platform_brands"
```

---

### Task 4: `customPlatforms.ts` — KPI exclusion

**Files:**
- Modify: `src/lib/customPlatforms.ts`
- Test: `src/lib/customPlatforms.test.ts`

**Interfaces:**
- Consumes: `customPlatformRemovedKey` from `./removedCustomPlatformBrands.ts` (Task 2).
- Produces: `computeCustomPlatformCounts(entries, platform, tab, brandCol, fromISO?, toISO?, removedCustomPlatformBrands?)` — new signature, consumed by Tasks 7 and 9.

- [ ] **Step 1: Write the failing test**

Update the 4 existing calls in `src/lib/customPlatforms.test.ts` to the new argument order (insert `'Test Tab', null` after `YELP`), and add 2 new exclusion tests:

```typescript
import { describe, it, expect } from 'vitest';
import { computeCustomPlatformCounts, type CustomPlatformConfig } from './customPlatforms';
import { customPlatformRemovedKey, buildRemovedCustomPlatformBrandSet } from './removedCustomPlatformBrands';
import type { Entry } from '../types/entry';

function entry(data: Record<string, string | null>): Entry {
  return {
    id: crypto.randomUUID(),
    tab: 'Test Tab',
    sheet_row_id: '',
    data,
    updated_at: '',
    last_edited_by: 'dashboard',
    last_sync_tag: null,
  };
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
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', null);
    expect(result).toEqual({ total: 2, live: 1, removed: 1, successRate: 50 });
  });

  it('ignores a different platform\'s status column on the same entry', () => {
    const entries = [entry({ 'TP Review Status': 'Published', 'Yelp Review Status': '' })];
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', null);
    expect(result).toEqual({ total: 0, live: 0, removed: 0, successRate: null });
  });

  it('excludes a row outside the date range', () => {
    const entries = [
      entry({ 'Yelp Review Status': 'Published', 'Yelp Review Added': '01/01/2026' }),
      entry({ 'Yelp Review Status': 'Published', 'Yelp Review Added': '01/06/2026' }),
    ];
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', null, '2026-05-01', '2026-06-30');
    expect(result.total).toBe(1);
  });

  it('always includes a row with no recorded date, matching the built-in platforms\' rule', () => {
    const entries = [entry({ 'Yelp Review Status': 'Removed' })];
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', null, '2026-05-01', '2026-06-30');
    expect(result.total).toBe(1);
  });

  it('excludes a brand flagged removed on this custom platform', () => {
    const entries = [
      entry({ 'Brand Name': 'Flagged Co', 'Yelp Review Status': 'Published' }),
      entry({ 'Brand Name': 'Other Co', 'Yelp Review Status': 'Published' }),
    ];
    const removed = buildRemovedCustomPlatformBrandSet([{ tab: 'Test Tab', brand: 'Flagged Co', platform_id: 'p1' }]);
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', 'Brand Name', undefined, undefined, removed);
    expect(result).toEqual({ total: 1, live: 1, removed: 0, successRate: 100 });
  });

  it('does not exclude the same brand flagged removed on a DIFFERENT custom platform', () => {
    const entries = [entry({ 'Brand Name': 'Flagged Co', 'Yelp Review Status': 'Published' })];
    const removed = buildRemovedCustomPlatformBrandSet([{ tab: 'Test Tab', brand: 'Flagged Co', platform_id: 'p2-other' }]);
    const result = computeCustomPlatformCounts(entries, YELP, 'Test Tab', 'Brand Name', undefined, undefined, removed);
    expect(result.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/customPlatforms.test.ts`
Expected: FAIL — argument count/order mismatch and missing exclusion behavior

- [ ] **Step 3: Write the implementation**

Replace `computeCustomPlatformCounts` in `src/lib/customPlatforms.ts`:

```typescript
import type { Entry } from '../types/entry.ts';
import { pick, isLiveStatus, isRemovedStatus, isoToDate, startOfDay, endOfDay, passesDateFilter, rateFromCounts, successRatePct } from './scoreSummary.ts';
import { customPlatformRemovedKey } from './removedCustomPlatformBrands.ts';

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
// "in range" means anywhere else in the app. removedCustomPlatformBrands
// mirrors classifyEntry's isPlatformFlagged check in queries.ts for the
// built-in platforms (see removedCustomPlatformBrands.ts).
export function computeCustomPlatformCounts(
  entries: Entry[],
  platform: CustomPlatformConfig,
  tab: string,
  brandCol: string | null,
  fromISO?: string,
  toISO?: string,
  removedCustomPlatformBrands: Set<string> = new Set(),
): CustomPlatformCounts {
  const fromDate = fromISO ? isoToDate(fromISO) : null;
  const toDate = toISO ? isoToDate(toISO) : null;
  const fromBound = fromDate ? startOfDay(fromDate) : null;
  const toBound = toDate ? endOfDay(toDate) : null;

  let live = 0;
  let removed = 0;
  for (const e of entries) {
    if (!passesDateFilter(e.data, [platform.dateColumn], fromBound, toBound)) continue;
    const brand = brandCol ? (e.data[brandCol] ?? '').trim() : '';
    if (brand && removedCustomPlatformBrands.has(customPlatformRemovedKey(tab, brand, platform.id))) continue;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/customPlatforms.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/customPlatforms.ts src/lib/customPlatforms.test.ts
git commit -m "feat: exclude removed-flagged brands from custom platform KPI counts"
```

---

### Task 5: `platformRemovedActions.ts` — extract shared engine, add custom-platform path

**Files:**
- Modify: `src/lib/platformRemovedActions.ts`
- Test: `src/lib/platformRemovedActions.test.ts`

**Interfaces:**
- Consumes: `customPlatformRemovedKey` (Task 2), `setCustomPlatformBrandRemoved` (Task 3), `CustomPlatformConfig` (from `./customPlatforms.ts`).
- Produces: `saveCustomPlatformRemoved(params, writers?): Promise<{ notifyFailures: string[] }>`, `deriveCustomPlatformRemovedModalInitial(tab, brand, eligiblePlatforms, existingSet, existingDateMap): { checkedPlatformIds: string[]; initialDateTexts: Record<string, string> }`, `CustomPlatformRemovedWriters` interface — consumed by Task 10 and Task 12. `savePlatformRemoved`/`deriveRemovedModalInitial`'s existing public signatures are UNCHANGED.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/platformRemovedActions.test.ts`, after the existing `describe('deriveRemovedModalInitial', ...)` block (do not modify anything above it):

```typescript
import { saveCustomPlatformRemoved, deriveCustomPlatformRemovedModalInitial } from './platformRemovedActions';
import {
  customPlatformRemovedKey,
  buildRemovedCustomPlatformBrandSet,
  buildRemovedCustomPlatformBrandDateMap,
} from './removedCustomPlatformBrands';
import type { CustomPlatformConfig } from './customPlatforms';

const YELP: CustomPlatformConfig = {
  id: 'p1', tab: 'BITP', name: 'Yelp', shortLabel: 'YP',
  statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
};
const G2: CustomPlatformConfig = {
  id: 'p2', tab: 'BITP', name: 'G2', shortLabel: 'G2',
  statusColumn: 'G2 Review Status', dateColumn: 'G2 Review Added', maxScore: null,
};
const CUSTOM_PLATS = [YELP, G2];

function existingCustom(rows: { tab: string; brand: string; platform_id: string; removed_at: string }[]) {
  return {
    existingSet: buildRemovedCustomPlatformBrandSet(rows),
    existingDateMap: buildRemovedCustomPlatformBrandDateMap(rows),
  };
}

describe('saveCustomPlatformRemoved', () => {
  it('flags a newly-checked custom platform removed and notifies + syncs status', async () => {
    const { calls, writers } = fakeWriters();
    const result = await saveCustomPlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: CUSTOM_PLATS, checkedPlatformIds: ['p1'],
      dateTexts: {}, ...existingCustom([]),
    }, writers as never);
    expect(calls[0]).toEqual(['setRemoved', TAB, 'Brand X', 'p1', true, undefined]);
    expect(calls[1][0]).toBe('notify');
    expect(calls[2]).toEqual(['syncStatus', TAB]);
    expect(result.notifyFailures).toEqual([]);
  });

  it('unchecking a flagged custom platform clears it with no notify/sync', async () => {
    const { calls, writers } = fakeWriters();
    await saveCustomPlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: CUSTOM_PLATS, checkedPlatformIds: [],
      dateTexts: {}, ...existingCustom([{ tab: TAB, brand: 'Brand X', platform_id: 'p1', removed_at: '2026-09-05' }]),
    }, writers as never);
    expect(calls).toEqual([['setRemoved', TAB, 'Brand X', 'p1', false, undefined]]);
  });

  it('does not re-write an unchanged existing flag with the same displayed date', async () => {
    const { calls, writers } = fakeWriters();
    await saveCustomPlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: CUSTOM_PLATS, checkedPlatformIds: ['p1'],
      dateTexts: { p1: '05/09/2026' },
      ...existingCustom([{ tab: TAB, brand: 'Brand X', platform_id: 'p1', removed_at: '2026-09-05' }]),
    }, writers as never);
    expect(calls).toEqual([]);
  });

  it('records a notify failure but still keeps the flag write and fires the status sync', async () => {
    const { calls, writers } = fakeWriters(async () => { throw new Error('email down'); });
    const result = await saveCustomPlatformRemoved({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: CUSTOM_PLATS, checkedPlatformIds: ['p1'],
      dateTexts: {}, ...existingCustom([]),
    }, writers as never);
    expect(calls.map((c) => c[0])).toEqual(['setRemoved', 'notify', 'syncStatus']);
    expect(result.notifyFailures).toEqual(['p1']);
  });
});

describe('deriveCustomPlatformRemovedModalInitial', () => {
  it('checks currently-flagged custom platforms and seeds their display dates', () => {
    const { existingSet, existingDateMap } = existingCustom([
      { tab: TAB, brand: 'Brand X', platform_id: 'p2', removed_at: '2026-09-05' },
    ]);
    const res = deriveCustomPlatformRemovedModalInitial(TAB, 'Brand X', CUSTOM_PLATS, existingSet, existingDateMap);
    expect(res.checkedPlatformIds).toEqual(['p2']);
    expect(res.initialDateTexts).toEqual({ p2: '05/09/2026' });
  });

  it('returns empty state when nothing is flagged', () => {
    const { existingSet, existingDateMap } = existingCustom([]);
    const res = deriveCustomPlatformRemovedModalInitial(TAB, 'Brand X', CUSTOM_PLATS, existingSet, existingDateMap);
    expect(res).toEqual({ checkedPlatformIds: [], initialDateTexts: {} });
  });
});
```

Note: `fakeWriters`'s returned `writers.setRemoved` is a generic `(...a: unknown[]) => Promise<void>` stub already defined earlier in the file — it works unmodified for the custom-platform path since `saveCustomPlatformRemoved` calls `writers.setRemoved(tab, brand, platform.id, removed, removedAtIso)` with the same argument shape (a string 3rd argument instead of a `Platform` literal, which the stub doesn't care about).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/platformRemovedActions.test.ts`
Expected: PASS for all pre-existing tests (unmodified), FAIL for the new ones — `saveCustomPlatformRemoved`/`deriveCustomPlatformRemovedModalInitial` are not exported

- [ ] **Step 3: Extract the generic engine and refactor `savePlatformRemoved`**

Replace the body of `src/lib/platformRemovedActions.ts` from `export async function savePlatformRemoved` through the end of that function (the existing lines ~43-115) with:

```typescript
import { setBrandPlatformRemoved, setCustomPlatformBrandRemoved } from './queries';
import { notifyBrandRemoved, type NotifyBrandRemovedPayload } from './brandRemovedNotification';
import { syncTabStatusToPms } from './schedulePmsSync';
import { platformRemovedKey, type Platform } from './removedPlatformBrands';
import { customPlatformRemovedKey } from './removedCustomPlatformBrands';
import { PLATFORM_SHORT_LABEL } from './scoreSummary';
import { formatCellValue } from './format';
import { dateTextToIsoDate } from './dateUtils';
import { tabDisplayName, tabToSlug } from './tabs';
import { SITE_URL } from './supabase';
import type { CustomPlatformConfig } from './customPlatforms';

export interface PlatformRemovedWriters {
  setRemoved: typeof setBrandPlatformRemoved;
  notify: (payload: NotifyBrandRemovedPayload) => Promise<void>;
  syncStatus: (tab: string) => Promise<void>;
}

const defaultWriters: PlatformRemovedWriters = {
  setRemoved: setBrandPlatformRemoved,
  notify: notifyBrandRemoved,
  syncStatus: syncTabStatusToPms,
};

export interface CustomPlatformRemovedWriters {
  setRemoved: typeof setCustomPlatformBrandRemoved;
  notify: (payload: NotifyBrandRemovedPayload) => Promise<void>;
  syncStatus: (tab: string) => Promise<void>;
}

const defaultCustomWriters: CustomPlatformRemovedWriters = {
  setRemoved: setCustomPlatformBrandRemoved,
  notify: notifyBrandRemoved,
  syncStatus: syncTabStatusToPms,
};

export interface SavePlatformRemovedResult {
  notifyFailures: Platform[];
}

export interface SaveCustomPlatformRemovedResult {
  notifyFailures: string[];
}

// One shared descriptor shape for a single platform's (built-in or custom)
// removal-flag change -- the ONLY copy of the diff/date-parsing/notify logic,
// called by both savePlatformRemoved and saveCustomPlatformRemoved below so
// that logic can never drift between the two. `write` and `onNotifyFailure`
// are pre-bound closures so this function itself never needs to know
// whether it's handling a built-in Platform or a custom platform id.
interface RemovalFlagDescriptor {
  shortLabel: string;
  wasRemoved: boolean;
  willBeRemoved: boolean;
  dateText?: string;
  priorIso?: string;
  write: (removed: boolean, removedAtIso?: string) => Promise<void>;
  onNotifyFailure: () => void;
}

async function applyRemovalFlagChanges(
  tab: string,
  brand: string,
  descriptors: RemovalFlagDescriptor[],
  writers: { notify: (payload: NotifyBrandRemovedPayload) => Promise<void>; syncStatus: (tab: string) => Promise<void> },
): Promise<void> {
  let flaggedAnyRemoved = false;
  for (const d of descriptors) {
    const stateChanged = d.wasRemoved !== d.willBeRemoved;
    const dateText = d.dateText?.trim();
    const priorDateDisplay = d.priorIso ? formatCellValue(d.priorIso) : undefined;
    const dateChanged = d.willBeRemoved && !stateChanged && !!dateText && dateText !== priorDateDisplay;
    if (!stateChanged && !dateChanged) continue;
    const removedAtIso = d.willBeRemoved && dateText ? dateTextToIsoDate(dateText) ?? undefined : undefined;
    await d.write(d.willBeRemoved, removedAtIso);
    if (d.willBeRemoved && stateChanged) {
      flaggedAnyRemoved = true;
      try {
        await writers.notify({
          brand,
          tabLabel: tabDisplayName(tab),
          platformShortLabel: d.shortLabel,
          removedAtLabel: removedAtIso ? formatCellValue(removedAtIso) : formatCellValue(new Date().toISOString()),
          brandTabUrl: `${SITE_URL}/brands/${tabToSlug(tab)}?brand=${encodeURIComponent(brand)}`,
        });
      } catch {
        d.onNotifyFailure();
      }
    }
  }
  if (flaggedAnyRemoved) writers.syncStatus(tab).catch(() => {});
}

export async function savePlatformRemoved(
  params: {
    tab: string;
    lookupTab?: string;
    brand: string;
    eligiblePlatforms: Platform[];
    checkedPlatforms: Platform[];
    dateTexts: Partial<Record<Platform, string>>;
    existingSet: ReadonlySet<string>;
    existingDateMap: ReadonlyMap<string, string>;
  },
  writers: PlatformRemovedWriters = defaultWriters,
): Promise<SavePlatformRemovedResult> {
  const { tab, brand, eligiblePlatforms, checkedPlatforms, dateTexts, existingSet, existingDateMap } = params;
  const lookupTab = params.lookupTab ?? tab;
  const nowChecked = new Set(checkedPlatforms);
  const notifyFailures: Platform[] = [];
  const descriptors: RemovalFlagDescriptor[] = eligiblePlatforms.map((platform) => {
    const key = platformRemovedKey(lookupTab, brand, platform);
    return {
      shortLabel: PLATFORM_SHORT_LABEL[platform],
      wasRemoved: existingSet.has(key),
      willBeRemoved: nowChecked.has(platform),
      dateText: dateTexts[platform],
      priorIso: existingDateMap.get(key),
      write: (removed, removedAtIso) => writers.setRemoved(tab, brand, platform, removed, removedAtIso),
      onNotifyFailure: () => notifyFailures.push(platform),
    };
  });
  await applyRemovalFlagChanges(tab, brand, descriptors, writers);
  return { notifyFailures };
}

// Mirrors savePlatformRemoved exactly, for custom (user-defined) platforms
// identified by custom_platforms.id instead of the closed Platform union.
// Shares the same applyRemovalFlagChanges engine, so the diff/date-parsing/
// notify logic can't drift between the two paths.
export async function saveCustomPlatformRemoved(
  params: {
    tab: string;
    lookupTab?: string;
    brand: string;
    eligiblePlatforms: CustomPlatformConfig[];
    checkedPlatformIds: string[];
    dateTexts: Record<string, string>;
    existingSet: ReadonlySet<string>;
    existingDateMap: ReadonlyMap<string, string>;
  },
  writers: CustomPlatformRemovedWriters = defaultCustomWriters,
): Promise<SaveCustomPlatformRemovedResult> {
  const { tab, brand, eligiblePlatforms, checkedPlatformIds, dateTexts, existingSet, existingDateMap } = params;
  const lookupTab = params.lookupTab ?? tab;
  const nowChecked = new Set(checkedPlatformIds);
  const notifyFailures: string[] = [];
  const descriptors: RemovalFlagDescriptor[] = eligiblePlatforms.map((platform) => {
    const key = customPlatformRemovedKey(lookupTab, brand, platform.id);
    return {
      shortLabel: platform.shortLabel,
      wasRemoved: existingSet.has(key),
      willBeRemoved: nowChecked.has(platform.id),
      dateText: dateTexts[platform.id],
      priorIso: existingDateMap.get(key),
      write: (removed, removedAtIso) => writers.setRemoved(tab, brand, platform.id, removed, removedAtIso),
      onNotifyFailure: () => notifyFailures.push(platform.id),
    };
  });
  await applyRemovalFlagChanges(tab, brand, descriptors, writers);
  return { notifyFailures };
}

export function deriveRemovedModalInitial(
  tab: string,
  brand: string,
  eligiblePlatforms: Platform[],
  existingSet: ReadonlySet<string>,
  existingDateMap: ReadonlyMap<string, string>,
): { checkedPlatforms: Platform[]; initialDateTexts: Partial<Record<Platform, string>> } {
  const checkedPlatforms: Platform[] = [];
  const initialDateTexts: Partial<Record<Platform, string>> = {};
  for (const platform of eligiblePlatforms) {
    const key = platformRemovedKey(tab, brand, platform);
    if (existingSet.has(key)) {
      checkedPlatforms.push(platform);
      const iso = existingDateMap.get(key);
      if (iso) initialDateTexts[platform] = formatCellValue(iso);
    }
  }
  return { checkedPlatforms, initialDateTexts };
}

// Mirrors deriveRemovedModalInitial exactly, for custom platforms.
export function deriveCustomPlatformRemovedModalInitial(
  tab: string,
  brand: string,
  eligiblePlatforms: CustomPlatformConfig[],
  existingSet: ReadonlySet<string>,
  existingDateMap: ReadonlyMap<string, string>,
): { checkedPlatformIds: string[]; initialDateTexts: Record<string, string> } {
  const checkedPlatformIds: string[] = [];
  const initialDateTexts: Record<string, string> = {};
  for (const platform of eligiblePlatforms) {
    const key = customPlatformRemovedKey(tab, brand, platform.id);
    if (existingSet.has(key)) {
      checkedPlatformIds.push(platform.id);
      const iso = existingDateMap.get(key);
      if (iso) initialDateTexts[platform.id] = formatCellValue(iso);
    }
  }
  return { checkedPlatformIds, initialDateTexts };
}
```

Keep the file's existing top-of-file doc comment (lines 1-13) as-is above these imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/platformRemovedActions.test.ts`
Expected: PASS (all pre-existing tests + 6 new tests, 15 total)

- [ ] **Step 5: Commit**

```bash
git add src/lib/platformRemovedActions.ts src/lib/platformRemovedActions.test.ts
git commit -m "refactor: extract shared removal-flag engine, add custom platform path"
```

---

### Task 6: `PlatformRemovedBadge.tsx` — generalize props

**Files:**
- Modify: `src/components/PlatformRemovedBadge.tsx`
- Modify: `src/pages/BrandGroup.tsx:1247` (existing call site)

**Interfaces:**
- Produces: `PlatformRemovedBadge({ shortLabel: string; label: string; removedAtLabel?: string })` — consumed by Task 9.

- [ ] **Step 1: Generalize the component**

Replace `src/components/PlatformRemovedBadge.tsx` in full:

```tsx
import { X } from 'lucide-react';
import Tooltip from './Tooltip';

// A 2-letter platform code with a small red circle-X superscript (like a
// trademark mark), shown next to a brand name whose page on that specific
// platform has been delisted entirely — distinct from the outlined rose
// "Removed" status pill (see BrandGroup.tsx's StatusBadge) which reflects one
// review's status, not the brand's page existing at all. A brand can show
// more than one of these side by side if it's been delisted on more than one
// platform independently. Takes plain label/shortLabel strings (not a
// Platform union) so it renders identically for a built-in platform
// (PLATFORM_LABEL[p]/PLATFORM_SHORT_LABEL[p]) and a custom platform
// (its own name/shortLabel).
export default function PlatformRemovedBadge({ shortLabel, label, removedAtLabel }: { shortLabel: string; label: string; removedAtLabel?: string }) {
  return (
    <Tooltip
      content={removedAtLabel ? `${label} page removed on ${removedAtLabel}` : `${label} page removed`}
      className="relative ml-1.5 shrink-0 items-center text-[11px] font-semibold leading-none text-slate-600"
    >
      {shortLabel}
      <span className="absolute -right-1.5 -top-1 flex size-2.5 items-center justify-center rounded-full bg-rose-600">
        <X className="size-1.5 text-white" strokeWidth={4} />
      </span>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Update the existing call site**

In `src/pages/BrandGroup.tsx`, replace line 1247:

```typescript
      return <PlatformRemovedBadge key={p} platform={p} removedAtLabel={date ? formatCellValue(date) : undefined} />;
```

with:

```typescript
      return <PlatformRemovedBadge key={p} shortLabel={PLATFORM_SHORT_LABEL[p]} label={PLATFORM_LABEL[p]} removedAtLabel={date ? formatCellValue(date) : undefined} />;
```

(`PLATFORM_LABEL` and `PLATFORM_SHORT_LABEL` are already imported in this file from `../lib/scoreSummary` — see the existing import at line 33.)

- [ ] **Step 3: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/components/PlatformRemovedBadge.tsx src/pages/BrandGroup.tsx
git commit -m "refactor: generalize PlatformRemovedBadge to plain label props"
```

---

### Task 7: `queries.ts` — thread exclusion set through `computeTabKpisFromEntries`/`fetchTabKpis`

**Files:**
- Modify: `src/lib/queries.ts` (the two functions, and their `computeCustomPlatformCounts` call site around line 762-765)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `computeCustomPlatformCounts`'s new signature (Task 4), `getTabCustomPlatforms`/`registerTabCustomPlatforms`/`resetTabCustomPlatforms` from `./customPlatformRegistry`.
- Produces: `computeTabKpisFromEntries(..., removedCustomPlatformBrands?: Set<string>)`, `fetchTabKpis(..., removedCustomPlatformBrands?: Set<string>)` — both gain the new param as the LAST positional argument with a default, so all ~40 existing positional call sites in `queries.test.ts` keep working unmodified. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/queries.test.ts`, inside the `describe('computeTabKpisFromEntries', ...)` block (after the last existing test in that block, before its closing `});`):

```typescript
  it('excludes a brand flagged removed on a custom platform enabled for this tab', () => {
    registerTabCustomPlatforms([{
      id: 'p1', tab: 'TP Affiliate', name: 'Yelp', shortLabel: 'YP',
      statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
    }]);
    try {
      const entries = [
        entry('1', { 'URL PAGE': 'Flagged Co', 'Yelp Review Status': 'Published' }),
        entry('2', { 'URL PAGE': 'Other Co', 'Yelp Review Status': 'Published' }),
      ];
      const removedCustom = buildRemovedCustomPlatformBrandSet([{ tab: 'TP Affiliate', brand: 'Flagged Co', platform_id: 'p1' }]);
      const kpis = computeTabKpisFromEntries(
        entries, rawHeaders, 'TP Affiliate', 'URL PAGE', undefined, undefined, new Set(),
        undefined, undefined, undefined, removedCustom,
      )!;
      const yelp = kpis.customPlatforms.find((c) => c.platform.id === 'p1')!;
      expect(yelp.total).toBe(1);
    } finally {
      resetTabCustomPlatforms();
    }
  });
```

This uses the `entry(id, data)` helper and `rawHeaders` fixture already defined at the top of the `describe('computeTabKpisFromEntries', ...)` block (lines 513-518) — do not redefine them. Add two new imports at the top of `queries.test.ts`: `registerTabCustomPlatforms, resetTabCustomPlatforms` from `./customPlatformRegistry`, and `buildRemovedCustomPlatformBrandSet` from `./removedCustomPlatformBrands`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/queries.test.ts -t "custom platform enabled for this tab"`
Expected: FAIL — `kpis.customPlatforms` is empty or the extra argument is ignored

- [ ] **Step 3: Write the implementation**

In `src/lib/queries.ts`, update `computeTabKpisFromEntries`'s signature (around line 696-705) to add the new trailing parameter:

```typescript
export function computeTabKpisFromEntries(
  entries: Entry[],
  rawHeaders: string[],
  tab: string,
  brandCol: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  removedPlatformBrands: Set<string>,
  countryFilter?: string[],
  proxyFilter?: string[],
  platformFilter?: Platform[],
  removedCustomPlatformBrands: Set<string> = new Set(),
): TabKpis | null {
```

(Keep the rest of the function body unchanged up to the `computeCustomPlatformCounts` call.) Update that call (around line 762-765):

```typescript
  const customPlatforms = getTabCustomPlatforms(tab).map((platform) => ({
    platform,
    ...computeCustomPlatformCounts(filteredEntries, platform, tab, brandCol, dateFrom, dateTo, removedCustomPlatformBrands),
  }));
```

Update `fetchTabKpis`'s signature (around line 779-793):

```typescript
export async function fetchTabKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedPlatformBrands: Set<string> = new Set(),
  countryFilter?: string[],
  proxyFilter?: string[],
  platformFilter?: Platform[],
  removedCustomPlatformBrands: Set<string> = new Set(),
): Promise<TabKpis | null> {
  const [allEntries, rawHeaders] = await Promise.all([
    fetchAllTabEntries(tab),
    fetchTabHeaders(tab),
  ]);
  const brandCol = getBrandNameCol(tab);
  return computeTabKpisFromEntries(allEntries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter, proxyFilter, platformFilter, removedCustomPlatformBrands);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS (every existing test in the file plus the new one — confirms the trailing-default-param approach didn't break any of the ~40 existing positional `computeTabKpisFromEntries` calls)

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: thread removed-custom-platform-brands set through tab KPI computation"
```

---

### Task 8: `Overview.tsx` — fetch and thread the exclusion set

**Files:**
- Modify: `src/pages/Overview.tsx`

**Interfaces:**
- Consumes: `fetchRemovedCustomPlatformBrands` (Task 3), `buildRemovedCustomPlatformBrandSet` (Task 2), `fetchTabKpis`'s new trailing param (Task 7).

- [ ] **Step 1: Add the fetch and thread it through**

In `src/pages/Overview.tsx`, add to the existing import from `../lib/queries` (find the line importing `fetchRemovedPlatformBrands`) the name `fetchRemovedCustomPlatformBrands`, and add a new import:

```typescript
import { buildRemovedCustomPlatformBrandSet } from '../lib/removedCustomPlatformBrands';
```

In `loadData` (around lines 561-598), replace:

```typescript
      const removedPlatformBrands = await fetchRemovedPlatformBrands()
        .then(buildRemovedPlatformBrandSet)
        .catch(() => new Set<string>());
```

with:

```typescript
      const [removedPlatformBrands, removedCustomPlatformBrands] = await Promise.all([
        fetchRemovedPlatformBrands().then(buildRemovedPlatformBrandSet).catch(() => new Set<string>()),
        fetchRemovedCustomPlatformBrands().then(buildRemovedCustomPlatformBrandSet).catch(() => new Set<string>()),
      ]);
```

Then update the `fetchTabKpis` call (a few lines below) to pass the new set as the 8th argument:

```typescript
          fetchTabKpis(
            tab,
            dateFrom || undefined,
            dateTo || undefined,
            removedPlatformBrands,
            countryFilter,
            proxyFilter,
            platformFilter,
            removedCustomPlatformBrands,
          )
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors

- [ ] **Step 3: Manual check**

There is no dedicated `Overview.test.tsx` in this repo (page-level components are verified via build, per this project's established convention — see `feedback_verify_with_npm_build.md`). Confirm by reading the changed `loadData` function once more that both fetches are wrapped in their own `.catch()` (fail-open), matching the existing pattern, so a `removed_custom_platform_brands` fetch failure can't take down Overview's whole KPI load.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat: exclude removed-flagged custom platform brands from Overview KPIs"
```

---

### Task 9: `BrandGroup.tsx` — KPI exclusion + badge (part A)

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `fetchRemovedCustomPlatformBrands` (Task 3), `customPlatformRemovedKey`/`buildRemovedCustomPlatformBrandSet`/`buildRemovedCustomPlatformBrandDateMap` (Task 2), `computeCustomPlatformCounts`'s new signature (Task 4), `PlatformRemovedBadge`'s new props (Task 6).
- Produces: `removedCustomPlatformBrandSet`, `removedCustomPlatformBrandDateMap`, `removedCustomPlatformsFor(brandName)`, `removedCustomPlatformDateFor(brandName, platformId)` — consumed by Task 12.

- [ ] **Step 1: Add imports**

In `src/pages/BrandGroup.tsx`, add to the existing `import { ... } from '../lib/queries'` line: `fetchRemovedCustomPlatformBrands`. Add a new import:

```typescript
import {
  customPlatformRemovedKey,
  buildRemovedCustomPlatformBrandSet,
  buildRemovedCustomPlatformBrandDateMap,
} from '../lib/removedCustomPlatformBrands';
```

`getTabCustomPlatforms` and `type CustomPlatformConfig` are already imported from `'../lib/customPlatformRegistry'` (line 29) — no change needed there.

- [ ] **Step 2: Fetch the new table alongside the existing one**

Add new state near line 626 (right after `removedPlatformBrandRows`):

```typescript
  const [removedCustomPlatformBrandRows, setRemovedCustomPlatformBrandRows] = useState<{ tab: string; brand: string; platform_id: string; removed_at: string }[]>([]);
```

In the `useEffect` around lines 789-793, add a parallel fetch right after the existing `fetchRemovedPlatformBrands()` call:

```typescript
    fetchRemovedCustomPlatformBrands()
      .then((rows) => { if (!canceled) setRemovedCustomPlatformBrandRows(rows); })
      .catch(() => { /* badge is decorative -- a failed fetch just means no badges render */ });
```

- [ ] **Step 3: Add the memos and helpers**

Right after the existing `removedPlatformBrandDateMap`/`removedPlatformDateFor` block (after line 1241), add:

```typescript
  const removedCustomPlatformBrandSet = useMemo(
    () => buildRemovedCustomPlatformBrandSet(removedCustomPlatformBrandRows),
    [removedCustomPlatformBrandRows],
  );
  function isCustomPlatformRemoved(brandName: string | null | undefined, platformId: string): boolean {
    return !!brandName && removedCustomPlatformBrandSet.has(customPlatformRemovedKey(decodedTab, brandName, platformId));
  }
  const removedCustomPlatformBrandDateMap = useMemo(
    () => buildRemovedCustomPlatformBrandDateMap(removedCustomPlatformBrandRows),
    [removedCustomPlatformBrandRows],
  );
  function removedCustomPlatformDateFor(brandName: string | null | undefined, platformId: string): string | undefined {
    return brandName ? removedCustomPlatformBrandDateMap.get(customPlatformRemovedKey(decodedTab, brandName, platformId)) : undefined;
  }
  // Every custom platform enabled on this tab that's currently flagged for
  // this brand -- mirrors removedPlatformsFor for built-ins.
  function removedCustomPlatformsFor(brandName: string | null | undefined): CustomPlatformConfig[] {
    if (!brandName) return [];
    return getTabCustomPlatforms(decodedTab).filter((p) => isCustomPlatformRemoved(brandName, p.id));
  }
```

- [ ] **Step 4: Extend the badge helper**

Replace `removedPlatformBadges` (lines 1244-1248):

```typescript
  function removedPlatformBadges(brandName: string | null | undefined) {
    return removedPlatformsFor(brandName).map((p) => {
      const date = removedPlatformDateFor(brandName, p);
      return <PlatformRemovedBadge key={p} platform={p} removedAtLabel={date ? formatCellValue(date) : undefined} />;
    });
  }
```

with:

```typescript
  function removedPlatformBadges(brandName: string | null | undefined) {
    const builtIn = removedPlatformsFor(brandName).map((p) => {
      const date = removedPlatformDateFor(brandName, p);
      return <PlatformRemovedBadge key={p} shortLabel={PLATFORM_SHORT_LABEL[p]} label={PLATFORM_LABEL[p]} removedAtLabel={date ? formatCellValue(date) : undefined} />;
    });
    const custom = removedCustomPlatformsFor(brandName).map((p) => {
      const date = removedCustomPlatformDateFor(brandName, p.id);
      return <PlatformRemovedBadge key={p.id} shortLabel={p.shortLabel} label={p.name} removedAtLabel={date ? formatCellValue(date) : undefined} />;
    });
    return [...builtIn, ...custom];
  }
```

(This also completes Task 6's badge-generalization call-site update for this function — the `platform={p}` prop from before is now `shortLabel={PLATFORM_SHORT_LABEL[p]} label={PLATFORM_LABEL[p]}`.)

- [ ] **Step 5: Wire exclusion into the tab-summary KPI computation**

Replace lines 1710-1714:

```typescript
  const tabCustomPlatforms = getTabCustomPlatforms(decodedTab);
  const customPlatformCounts = tabCustomPlatforms.map((platform) => ({
    platform,
    ...computeCustomPlatformCounts(ratingFiltered, platform, dateActive ? dateFrom : undefined, dateActive ? dateTo : undefined),
  }));
```

with:

```typescript
  const tabCustomPlatforms = getTabCustomPlatforms(decodedTab);
  const customPlatformCounts = tabCustomPlatforms.map((platform) => ({
    platform,
    ...computeCustomPlatformCounts(
      ratingFiltered, platform, decodedTab, brandCol,
      dateActive ? dateFrom : undefined, dateActive ? dateTo : undefined,
      removedCustomPlatformBrandSet,
    ),
  }));
```

- [ ] **Step 6: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: exclude removed-flagged custom platform brands from Brand Tabs KPIs and badge"
```

---

### Task 10: `PlatformRemovedModal.tsx` + `TabRemovedPlatformsSection.tsx` — Edit Brand Tab bulk section

**Files:**
- Modify: `src/components/PlatformRemovedModal.tsx`
- Modify: `src/lib/tabRemovedPlatforms.ts`
- Test: `src/lib/tabRemovedPlatforms.test.ts` (extend if it exists, else create alongside the existing `deriveTabRemovedPlatformRows` export — check first)
- Modify: `src/components/TabRemovedPlatformsSection.tsx`

**Interfaces:**
- Consumes: `saveCustomPlatformRemoved`/`deriveCustomPlatformRemovedModalInitial` (Task 5), `fetchRemovedCustomPlatformBrandsForTab` (Task 3), `getTabCustomPlatforms` (existing), `buildRemovedCustomPlatformBrandSet`/`buildRemovedCustomPlatformBrandDateMap` (Task 2).
- Produces: `deriveTabRemovedCustomPlatformRows(rows): TabRemovedCustomPlatformRow[]`, `PlatformRemovedModal`'s new generic `RemovableFlagOption[]` prop shape.

- [ ] **Step 1: Add `deriveTabRemovedCustomPlatformRows` with a test**

First check whether `src/lib/tabRemovedPlatforms.test.ts` already exists (it may, mirroring `deriveTabRemovedPlatformRows`). If it exists, add the new test to it; otherwise create it.

```typescript
// Add to src/lib/tabRemovedPlatforms.test.ts (create the file with this
// import block if it doesn't already exist):
import { describe, it, expect } from 'vitest';
import { deriveTabRemovedCustomPlatformRows } from './tabRemovedPlatforms';

describe('deriveTabRemovedCustomPlatformRows', () => {
  it('shapes and sorts rows by brand then platform id', () => {
    const rows = deriveTabRemovedCustomPlatformRows([
      { brand: 'Zeta Co', platform_id: 'p1', removed_at: '2026-09-01', removed_by: 'a@x.com' },
      { brand: 'Alpha Co', platform_id: 'p2', removed_at: '2026-09-02', removed_by: null },
    ]);
    expect(rows).toEqual([
      { brand: 'Alpha Co', platformId: 'p2', removedAt: '2026-09-02', removedBy: null },
      { brand: 'Zeta Co', platformId: 'p1', removedAt: '2026-09-01', removedBy: 'a@x.com' },
    ]);
  });
});
```

Run: `npx vitest run src/lib/tabRemovedPlatforms.test.ts` — expect FAIL (`deriveTabRemovedCustomPlatformRows` not exported).

Add to `src/lib/tabRemovedPlatforms.ts` (after the existing `deriveTabRemovedPlatformRows`):

```typescript
export interface TabRemovedCustomPlatformRow {
  brand: string;
  platformId: string;
  removedAt: string;
  removedBy: string | null;
}

// Mirrors deriveTabRemovedPlatformRows exactly, for custom-platform rows
// (removed_custom_platform_brands), keyed by platform_id instead of a
// Platform code.
export function deriveTabRemovedCustomPlatformRows(
  rows: { brand: string; platform_id: string; removed_at: string; removed_by: string | null }[],
): TabRemovedCustomPlatformRow[] {
  return rows
    .map((r) => ({ brand: r.brand, platformId: r.platform_id, removedAt: r.removed_at, removedBy: r.removed_by }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.platformId.localeCompare(b.platformId));
}
```

Run: `npx vitest run src/lib/tabRemovedPlatforms.test.ts` — expect PASS.

- [ ] **Step 2: Generalize `PlatformRemovedModal`'s props**

Replace `src/components/PlatformRemovedModal.tsx` in full:

```tsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { isValidDateText } from '../lib/dateUtils';

export interface RemovableFlagOption {
  key: string;
  label: string;
  favicon?: string;
}

interface Props {
  brand: string;
  platforms: RemovableFlagOption[];
  initialCheckedKeys: string[];
  // Free-text DD/MM/YYYY (or YYYY-MM-DD) per option key, same display format
  // as the Edit Entry modal's own Page Removed date field. Unlike a pause's
  // single shared reason/date, each option here carries its own date, since
  // one brand's pages can have been delisted on different platforms on
  // different days.
  initialDateTexts: Record<string, string>;
  // Tailwind z-index class for the full-screen overlay — Edit Brand Tab opens
  // this from inside its own z-50 modal, matching PlatformPauseModal's
  // overlayZClass pattern.
  overlayZClass?: string;
  busy: boolean;
  onSave: (checkedKeys: string[], dateTexts: Record<string, string>) => void;
  onClose: () => void;
}

// Flag a brand's platform page(s) as removed — same function as the Edit
// Entry modal's per-row "Page Removed Status" checkbox + date, just reached
// from the Edit Brand Tab side without needing to open one specific entry
// first. Generic over `RemovableFlagOption` so the same modal renders both
// built-in platforms (key = Platform code, favicon set) and custom platforms
// (key = custom_platforms.id, no favicon) side by side in one picker. Both
// kinds write through src/lib/platformRemovedActions.ts (savePlatformRemoved /
// saveCustomPlatformRemoved) — see
// docs/superpowers/specs/2026-09-11-custom-platform-removed-flag-design.md.
export default function PlatformRemovedModal({ brand, platforms, initialCheckedKeys, initialDateTexts, overlayZClass = 'z-40', busy, onSave, onClose }: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initialCheckedKeys));
  const [dateTexts, setDateTexts] = useState<Record<string, string>>(initialDateTexts);
  const [dateErrors, setDateErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleSave() {
    const invalid = [...checked].filter((key) => !isValidDateText(dateTexts[key] ?? ''));
    if (invalid.length > 0) {
      setDateErrors(new Set(invalid));
      return;
    }
    if (busy) return;
    onSave([...checked], dateTexts);
  }

  return (
    <div className={`fixed inset-0 ${overlayZClass} flex items-center justify-center p-4`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Platform Page Removed Status</h2>
            <p className="text-xs text-slate-400 mt-0.5">{brand}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-2">
          {platforms.map((option) => {
            const isChecked = checked.has(option.key);
            return (
              <div key={option.key}>
                <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(option.key)}
                    className="size-4 rounded border-slate-300 text-rose-600 focus:ring-rose-400"
                  />
                  {option.favicon && (
                    <img
                      src={option.favicon}
                      alt={option.label}
                      className="size-3.5 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span className="flex-1">{option.label}</span>
                </label>
                {isChecked && (
                  <input
                    type="text"
                    value={dateTexts[option.key] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDateTexts((prev) => ({ ...prev, [option.key]: val }));
                    }}
                    onBlur={() =>
                      setDateErrors((prev) => {
                        const next = new Set(prev);
                        if (!isValidDateText(dateTexts[option.key] ?? '')) next.add(option.key); else next.delete(option.key);
                        return next;
                      })
                    }
                    placeholder="Removed on DD/MM/YYYY (optional)"
                    className={`mt-1.5 w-full rounded-lg border px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none ${
                      dateErrors.has(option.key) ? 'border-rose-300 focus:border-rose-400' : 'border-slate-200 focus:border-blue-400'
                    }`}
                  />
                )}
                {dateErrors.has(option.key) && (
                  <p className="mt-1 text-xs text-rose-600">Enter a valid date (DD/MM/YYYY or YYYY-MM-DD) or leave it blank.</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="rounded-md bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `TabRemovedPlatformsSection.tsx` to combine built-in and custom platforms**

Replace `src/components/TabRemovedPlatformsSection.tsx` in full:

```tsx
// src/components/TabRemovedPlatformsSection.tsx
//
// "Removed platform pages" section inside EditBrandTabModal — the same
// per-platform "flagged removed, with a date" function the Edit Entry
// modal's Page Removed Status checkboxes already offer, reached here
// directly from the Brand Tab instead of needing to open one specific entry
// first. Writes go through src/lib/platformRemovedActions.ts's
// savePlatformRemoved (built-in platforms) and saveCustomPlatformRemoved
// (custom platforms) — shared with BrandGroup.tsx's Edit Entry save path so
// the surfaces (and the notification email + PMS status sync that come with
// a fresh flag) can never drift. Built-in and custom platforms render in one
// combined list/picker via PlatformRemovedModal's generic RemovableFlagOption
// shape.
import { useEffect, useMemo, useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import PlatformRemovedModal, { type RemovableFlagOption } from './PlatformRemovedModal';
import SelectDropdown from './SelectDropdown';
import {
  fetchRemovedPlatformBrandsForTab, fetchRemovedCustomPlatformBrandsForTab,
  type RemovedPlatformBrandRow, type RemovedCustomPlatformBrandRow,
} from '../lib/queries';
import {
  savePlatformRemoved, deriveRemovedModalInitial,
  saveCustomPlatformRemoved, deriveCustomPlatformRemovedModalInitial,
} from '../lib/platformRemovedActions';
import {
  buildRemovedPlatformBrandSet,
  buildRemovedPlatformBrandDateMap,
  PLATFORM_FAVICON,
  type Platform,
} from '../lib/removedPlatformBrands';
import {
  buildRemovedCustomPlatformBrandSet,
  buildRemovedCustomPlatformBrandDateMap,
} from '../lib/removedCustomPlatformBrands';
import { deriveTabRemovedPlatformRows, deriveTabRemovedCustomPlatformRows } from '../lib/tabRemovedPlatforms';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import { getTabPlatforms } from '../lib/tab-configs';
import { getTabCustomPlatforms, type CustomPlatformConfig } from '../lib/customPlatformRegistry';
import { formatCellValue } from '../lib/format';

interface Props {
  tabName: string;
  brands: string[];
  onChildModalOpenChange: (open: boolean) => void;
}

type CombinedRow =
  | { kind: 'builtin'; brand: string; platform: Platform; label: string; favicon: string; removedAt: string; removedBy: string | null }
  | { kind: 'custom'; brand: string; platformId: string; label: string; removedAt: string; removedBy: string | null };

export default function TabRemovedPlatformsSection({ tabName, brands, onChildModalOpenChange }: Props) {
  const [rows, setRows] = useState<RemovedPlatformBrandRow[]>([]);
  const [customRows, setCustomRows] = useState<RemovedCustomPlatformBrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingBrand, setAddingBrand] = useState('');
  const [pickerBrand, setPickerBrand] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const tabPlatforms = useMemo(() => getTabPlatforms(tabName) as Platform[], [tabName]);
  const tabCustomPlatforms = useMemo(() => getTabCustomPlatforms(tabName), [tabName]);
  const customPlatformById = useMemo(
    () => new Map<string, CustomPlatformConfig>(tabCustomPlatforms.map((p) => [p.id, p])),
    [tabCustomPlatforms],
  );

  useEffect(() => {
    onChildModalOpenChange(pickerBrand !== null);
  }, [pickerBrand, onChildModalOpenChange]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const [data, customData] = await Promise.all([
          fetchRemovedPlatformBrandsForTab(tabName),
          fetchRemovedCustomPlatformBrandsForTab(tabName),
        ]);
        if (canceled) return;
        setRows(data);
        setCustomRows(customData);
        setLoadError(false);
      } catch {
        if (!canceled) setLoadError(true);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, [tabName]);

  const existingSet = useMemo(() => buildRemovedPlatformBrandSet(rows), [rows]);
  const existingDateMap = useMemo(() => buildRemovedPlatformBrandDateMap(rows), [rows]);
  const existingCustomSet = useMemo(() => buildRemovedCustomPlatformBrandSet(customRows), [customRows]);
  const existingCustomDateMap = useMemo(() => buildRemovedCustomPlatformBrandDateMap(customRows), [customRows]);

  const combinedRows: CombinedRow[] = useMemo(() => [
    ...deriveTabRemovedPlatformRows(rows).map((r) => ({
      kind: 'builtin' as const, ...r, label: PLATFORM_FULL_LABEL[r.platform], favicon: PLATFORM_FAVICON[r.platform],
    })),
    ...deriveTabRemovedCustomPlatformRows(customRows).map((r) => ({
      kind: 'custom' as const, ...r, label: customPlatformById.get(r.platformId)?.name ?? r.platformId,
    })),
  ].sort((a, b) => a.brand.localeCompare(b.brand)), [rows, customRows, customPlatformById]);

  const hasRows = !loading && !loadError && combinedRows.length > 0;

  async function refresh() {
    const [data, customData] = await Promise.all([
      fetchRemovedPlatformBrandsForTab(tabName),
      fetchRemovedCustomPlatformBrandsForTab(tabName),
    ]);
    setRows(data);
    setCustomRows(customData);
  }

  async function handleRestore(row: CombinedRow) {
    setBusy(true);
    setError(null);
    let cleared = false;
    try {
      if (row.kind === 'builtin') {
        await savePlatformRemoved({
          tab: tabName, brand: row.brand, eligiblePlatforms: [row.platform], checkedPlatforms: [],
          dateTexts: {}, existingSet, existingDateMap,
        });
      } else {
        const platform = customPlatformById.get(row.platformId);
        await saveCustomPlatformRemoved({
          tab: tabName, brand: row.brand,
          eligiblePlatforms: platform ? [platform] : [],
          checkedPlatformIds: [], dateTexts: {},
          existingSet: existingCustomSet, existingDateMap: existingCustomDateMap,
        });
      }
      cleared = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to restore');
    } finally {
      setBusy(false);
    }
    if (cleared) {
      try {
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Restored, but failed to refresh the list');
      }
    }
  }

  async function handleSaveRemoved(brand: string, checkedKeys: string[], dateTexts: Record<string, string>) {
    setBusy(true);
    setError(null);
    const checkedPlatforms = tabPlatforms.filter((p) => checkedKeys.includes(p));
    const checkedPlatformIds = tabCustomPlatforms.map((p) => p.id).filter((id) => checkedKeys.includes(id));
    try {
      const [builtInResult, customResult] = await Promise.all([
        savePlatformRemoved({
          tab: tabName, brand, eligiblePlatforms: tabPlatforms, checkedPlatforms,
          dateTexts, existingSet, existingDateMap,
        }),
        saveCustomPlatformRemoved({
          tab: tabName, brand, eligiblePlatforms: tabCustomPlatforms, checkedPlatformIds,
          dateTexts, existingSet: existingCustomSet, existingDateMap: existingCustomDateMap,
        }),
      ]);
      if (builtInResult.notifyFailures.length + customResult.notifyFailures.length > 0) {
        setError(`${brand}'s page was flagged removed, but the notification email failed to send.`);
      }
      setPickerBrand(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update removed status');
    } finally {
      setBusy(false);
    }
    try {
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saved, but failed to refresh the list');
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => hasRows && setExpanded((v) => !v)}
        disabled={!hasRows}
        className="mb-1.5 flex w-full items-center justify-between gap-1 text-left enabled:cursor-pointer"
      >
        <span className="text-xs font-medium text-slate-500">
          Removed platform pages{hasRows ? ` (${combinedRows.length})` : ''}
        </span>
        {hasRows && (
          <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        )}
      </button>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : loadError ? (
        <p className="text-xs text-rose-600">Failed to load removed platform pages.</p>
      ) : combinedRows.length === 0 ? (
        <p className="text-xs text-slate-400">No platform pages flagged removed on this tab.</p>
      ) : expanded ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {combinedRows.map((r) => (
            <li key={r.kind === 'builtin' ? `${r.brand}::${r.platform}` : `${r.brand}::${r.platformId}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium text-slate-800">
                  {r.kind === 'builtin' && (
                    <img
                      src={r.favicon}
                      alt={r.label}
                      className="size-3.5 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span className="truncate">{r.brand}</span>
                  <span className="text-slate-400">— {r.label}</span>
                </div>
                <div className="text-xs text-slate-500">
                  Removed {formatCellValue(r.removedAt)}
                  {r.removedBy && <> — flagged by {r.removedBy}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRestore(r)}
                disabled={busy}
                className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && brands.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1">
            <SelectDropdown
              value={addingBrand}
              onChange={setAddingBrand}
              options={[...brands].sort((a, b) => a.localeCompare(b)).map((b) => ({ value: b, label: b }))}
              placeholder="— select a brand to flag —"
              searchable
            />
          </div>
          <button
            type="button"
            disabled={!addingBrand}
            onClick={() => { setPickerBrand(addingBrand); setAddingBrand(''); }}
            className="shrink-0 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Flag removed…
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}

      {pickerBrand && (() => {
        const init = deriveRemovedModalInitial(tabName, pickerBrand, tabPlatforms, existingSet, existingDateMap);
        const customInit = deriveCustomPlatformRemovedModalInitial(tabName, pickerBrand, tabCustomPlatforms, existingCustomSet, existingCustomDateMap);
        const options: RemovableFlagOption[] = [
          ...tabPlatforms.map((p) => ({ key: p, label: PLATFORM_FULL_LABEL[p], favicon: PLATFORM_FAVICON[p] })),
          ...tabCustomPlatforms.map((p) => ({ key: p.id, label: p.name })),
        ];
        return (
          <PlatformRemovedModal
            brand={pickerBrand}
            platforms={options}
            initialCheckedKeys={[...init.checkedPlatforms, ...customInit.checkedPlatformIds]}
            initialDateTexts={{ ...init.initialDateTexts, ...customInit.initialDateTexts }}
            overlayZClass="z-[60]"
            busy={busy}
            onSave={(checked, dateTexts) => handleSaveRemoved(pickerBrand, checked, dateTexts)}
            onClose={() => setPickerBrand(null)}
          />
        );
      })()}
    </div>
  );
}
```

- [ ] **Step 4: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add src/components/PlatformRemovedModal.tsx src/components/TabRemovedPlatformsSection.tsx src/lib/tabRemovedPlatforms.ts src/lib/tabRemovedPlatforms.test.ts
git commit -m "feat: combine built-in and custom platforms in the Edit Brand Tab removed-pages section"
```

---

### Task 11: `EditEntryModal.tsx` — custom platform checkbox

**Files:**
- Modify: `src/components/EditEntryModal.tsx`

**Interfaces:**
- Consumes: `getTabCustomPlatforms`, `type CustomPlatformConfig` (from `../lib/customPlatformRegistry`).
- Produces: `onSave` callback gains two new optional trailing params `removedCustomPlatforms?: string[]`, `removedCustomPlatformDateTexts?: Record<string, string>`; two new optional props `initialRemovedCustomPlatforms?: string[]`, `initialRemovedCustomPlatformDates?: Record<string, string>` — consumed by Task 12.

- [ ] **Step 1: Add the import and generalize `renderSectionFields`**

Add to the imports at the top of `src/components/EditEntryModal.tsx`:

```typescript
import { getTabCustomPlatforms, type CustomPlatformConfig } from '../lib/customPlatformRegistry';
```

Replace `renderSectionFields` (lines 386-395):

```typescript
  function renderSectionFields(sectionHeaders: string[], platform: Platform, cols: 5 | 6 = 6) {
    return sectionHeaders.flatMap((h) => {
      const out = [renderField(h, cols)];
      if (h === PLATFORM_ADDED_HEADER[platform]) out.push(renderPageRemovedField(platform));
      return out;
    });
  }
```

with a generalized version that accepts a list of insertions instead of one fixed platform:

```typescript
  interface FieldInsertion {
    afterHeader: string;
    field: JSX.Element;
  }

  function renderSectionFields(sectionHeaders: string[], insertions: FieldInsertion[], cols: 5 | 6 = 6) {
    return sectionHeaders.flatMap((h) => {
      const out = [renderField(h, cols)];
      const match = insertions.find((i) => i.afterHeader === h);
      if (match) out.push(match.field);
      return out;
    });
  }
```

- [ ] **Step 2: Update the 4 existing `renderSectionFields` call sites**

Replace each call (Account Details ~line 498, Trust Pilot/WO ~line 508, AskGamblers ~line 545, Casino Guru ~line 578 — find each by searching for `renderSectionFields(` in the file):

```typescript
renderSectionFields(reorderAccountFields(sections.account), 'wo', 5)
```
→
```typescript
renderSectionFields(reorderAccountFields(sections.account), [
  { afterHeader: PLATFORM_ADDED_HEADER.wo, field: renderPageRemovedField('wo') },
  ...tabCustomPlatforms.map((p) => ({ afterHeader: p.dateColumn, field: renderCustomPlatformRemovedField(p) })),
], 5)
```

```typescript
renderSectionFields(sections.tp, 'tp')
```
→
```typescript
renderSectionFields(sections.tp, [{ afterHeader: PLATFORM_ADDED_HEADER.tp, field: renderPageRemovedField('tp') }])
```

```typescript
renderSectionFields(sections.ag, 'ag')
```
→
```typescript
renderSectionFields(sections.ag, [{ afterHeader: PLATFORM_ADDED_HEADER.ag, field: renderPageRemovedField('ag') }])
```

```typescript
renderSectionFields(sections.cg, 'cg')
```
→
```typescript
renderSectionFields(sections.cg, [{ afterHeader: PLATFORM_ADDED_HEADER.cg, field: renderPageRemovedField('cg') }])
```

- [ ] **Step 3: Add custom-platform state, props, and render function**

Add to the `Props` interface (lines 64-84):

```typescript
  onSave: (
    fields: Record<string, string | null>,
    newTab?: string,
    removedPlatforms?: Platform[],
    overrides?: Partial<Record<Platform, 'pause' | 'active'>>,
    removedPlatformDateTexts?: Partial<Record<Platform, string>>,
    removedCustomPlatforms?: string[],
    removedCustomPlatformDateTexts?: Record<string, string>,
  ) => Promise<void>;
```

and, in the same interface:

```typescript
  initialRemovedCustomPlatforms?: string[];
  initialRemovedCustomPlatformDates?: Record<string, string>;
```

Add `initialRemovedCustomPlatforms, initialRemovedCustomPlatformDates` to the destructured component props (line 103).

Add new state right after the existing `removedDateErrors`/`overrides` state (around line 126-128):

```typescript
  const [removedCustomPlatforms, setRemovedCustomPlatforms] = useState<Set<string>>(new Set(initialRemovedCustomPlatforms ?? []));
  const [removedCustomPlatformDateTexts, setRemovedCustomPlatformDateTexts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (initialRemovedCustomPlatformDates) {
      for (const id of Object.keys(initialRemovedCustomPlatformDates)) {
        const iso = initialRemovedCustomPlatformDates[id];
        if (iso) init[id] = formatCellValue(iso);
      }
    }
    return init;
  });
  const [removedCustomDateErrors, setRemovedCustomDateErrors] = useState<Set<string>>(new Set());
  const tabCustomPlatforms: CustomPlatformConfig[] = currentTab ? getTabCustomPlatforms(currentTab) : [];
```

Add the render function right after `renderPageRemovedField` (after line 384, before `renderSectionFields`):

```typescript
  function renderCustomPlatformRemovedField(platform: CustomPlatformConfig) {
    const checked = removedCustomPlatforms.has(platform.id);
    return (
      <div key={`removed-custom-${platform.id}`}>
        <label className="mb-1.5 block text-xs font-medium text-slate-500">
          {platform.shortLabel} Page Removed Status
        </label>
        <div className="flex h-[38px] items-center gap-2 rounded-md border border-slate-200 px-3">
          <input
            type="checkbox"
            checked={checked}
            disabled={saving}
            onChange={(e) =>
              setRemovedCustomPlatforms((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(platform.id); else next.delete(platform.id);
                return next;
              })
            }
            className="rounded border-slate-300 text-rose-600 focus:ring-rose-400"
          />
          <input
            type="text"
            value={removedCustomPlatformDateTexts[platform.id] ?? ''}
            disabled={saving || !checked}
            onChange={(e) => {
              const val = e.target.value;
              setRemovedCustomPlatformDateTexts((prev) => ({ ...prev, [platform.id]: val }));
            }}
            onBlur={() =>
              setRemovedCustomDateErrors((prev) => {
                const next = new Set(prev);
                if (checked && !isValidDateText(removedCustomPlatformDateTexts[platform.id] ?? '')) next.add(platform.id);
                else next.delete(platform.id);
                return next;
              })
            }
            placeholder="DD/MM/YYYY"
            className={`w-full min-w-0 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400 ${
              removedCustomDateErrors.has(platform.id) ? 'text-rose-600' : ''
            }`}
          />
        </div>
        {removedCustomDateErrors.has(platform.id) && (
          <p className="mt-1 text-xs text-rose-600">Enter a valid date (DD/MM/YYYY or YYYY-MM-DD) or leave it blank.</p>
        )}
      </div>
    );
  }
```

- [ ] **Step 4: Validate and pass through on save**

In `handleSave` (lines 169-199), right after the existing `invalidRemovedDates` check (after line 187, before `setSaving(true)`), add:

```typescript
    const invalidRemovedCustomDates = [...removedCustomPlatforms].filter(
      (id) => !isValidDateText(removedCustomPlatformDateTexts[id] ?? ''),
    );
    if (invalidRemovedCustomDates.length > 0) {
      setRemovedCustomDateErrors(new Set(invalidRemovedCustomDates));
      setError('Enter a valid Page Removed date (DD/MM/YYYY or YYYY-MM-DD) or leave it blank.');
      return;
    }
```

Update the `onSave` call (line 193):

```typescript
      await onSave(out, tabChanged, [...removedPlatforms], overrides, removedPlatformDateTexts, [...removedCustomPlatforms], removedCustomPlatformDateTexts);
```

- [ ] **Step 5: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "feat: add custom platform Page Removed Status checkbox to Edit Entry"
```

---

### Task 12: `BrandGroup.tsx` — wire Edit Entry props/save handler + export columns (part B)

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: everything from Tasks 5, 9, 11.

- [ ] **Step 1: Compute and pass the new `EditEntryModal` props**

Right after the existing `initialRemovedPlatformDatesForEditEntry` computation (after line 1969), add:

```typescript
  const initialRemovedCustomPlatformsForEditEntry: string[] =
    editEntry && brandCol ? removedCustomPlatformsFor(editEntry.data[brandCol]).map((p) => p.id) : [];
  const initialRemovedCustomPlatformDatesForEditEntry: Record<string, string> =
    editEntry && brandCol
      ? Object.fromEntries(
          removedCustomPlatformsFor(editEntry.data[brandCol])
            .map((p) => [p.id, removedCustomPlatformDateFor(editEntry.data[brandCol], p.id)])
            .filter((pair): pair is [string, string] => !!pair[1]),
        )
      : {};
```

In the `<EditEntryModal ...>` JSX (around lines 3037-3039), add the two new props right after `initialRemovedPlatformDates`:

```tsx
          initialRemovedCustomPlatforms={initialRemovedCustomPlatformsForEditEntry}
          initialRemovedCustomPlatformDates={initialRemovedCustomPlatformDatesForEditEntry}
```

- [ ] **Step 2: Extend the `onSave` handler**

Update the `onSave` callback's parameter list (line 3041):

```tsx
          onSave={async (fields, newTab, removedPlatforms, overrides, removedPlatformDateTexts, removedCustomPlatforms, removedCustomPlatformDateTexts) => {
```

Right after the existing built-in-platform block closes (after the `if (removedPlatforms !== undefined) { ... }` block, i.e. right after line 3086's closing `}`, and BEFORE the `if (overrides !== undefined) { ... }` block), add a sibling block:

```typescript
                if (removedCustomPlatforms !== undefined) {
                  const { notifyFailures: customNotifyFailures } = await saveCustomPlatformRemoved({
                    tab: targetTab,
                    lookupTab: decodedTab,
                    brand: brandName,
                    eligiblePlatforms: getTabCustomPlatforms(decodedTab),
                    checkedPlatformIds: removedCustomPlatforms,
                    dateTexts: removedCustomPlatformDateTexts ?? {},
                    existingSet: removedCustomPlatformBrandSet,
                    existingDateMap: removedCustomPlatformBrandDateMap,
                  });
                  for (const id of customNotifyFailures) {
                    const label = getTabCustomPlatforms(decodedTab).find((p) => p.id === id)?.shortLabel ?? id;
                    setToast({
                      message: `${brandName}'s ${label} page was flagged removed, but the notification email failed to send.`,
                      kind: 'error',
                    });
                  }
                }
```

(This mirrors the built-in block's own `setToast({ message: ..., kind: 'error' })` call at lines 3081-3084 exactly, substituting the custom platform's label and id.)

Add the import for `saveCustomPlatformRemoved` alongside the existing `savePlatformRemoved` import (line 34):

```typescript
import { savePlatformRemoved, saveCustomPlatformRemoved } from '../lib/platformRemovedActions';
```

- [ ] **Step 3: Extend the export columns**

Replace line 1182:

```typescript
  const removedStatusHeaders = getTabPlatforms(decodedTab).map((p) => `${PLATFORM_SHORT_LABEL[p]} Page Removed Status`);
```

with:

```typescript
  const removedStatusHeaders = [
    ...getTabPlatforms(decodedTab).map((p) => `${PLATFORM_SHORT_LABEL[p]} Page Removed Status`),
    ...getTabCustomPlatforms(decodedTab).map((p) => `${p.shortLabel} Page Removed Status`),
  ];
```

Update the export row-value resolver (lines 2036-2051) to also resolve a custom-platform column — insert a new branch right after the existing `removedStatusPlatform` branch (after line 2043's closing `}`, before the score-column branch):

```typescript
              const removedCustomStatusPlatform = getTabCustomPlatforms(decodedTab)
                .find((p) => `${p.shortLabel} Page Removed Status` === header);
              if (removedCustomStatusPlatform && brandCol) {
                const brandName = entry.data[brandCol];
                const date = removedCustomPlatformDateFor(brandName, removedCustomStatusPlatform.id);
                return date ? formatCellValue(date) : '';
              }
```

- [ ] **Step 4: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: wire custom platform removed-flag into Edit Entry save and export"
```

---

### Task 13: Full verification and deployment

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: every test passes, including all tests added in Tasks 2-5, 7, and 10, and every pre-existing test unmodified (especially `platformRemovedActions.test.ts`'s original `savePlatformRemoved`/`deriveRemovedModalInitial` tests, confirming Task 5's extraction is behavior-preserving).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 3: Self-review the diff against the spec**

Read through `git diff main` (or the equivalent) and confirm every item in the spec's "Wiring into existing surfaces" section has a corresponding change: KPI exclusion (Overview + Brand Tabs), badge, Edit Entry checkbox, Edit Brand Tab section, export column, notification email.

- [ ] **Step 4: Deploy**

```bash
git push origin main
```

Then apply the migration:

```bash
supabase db push
```

Confirm via `supabase migration list` that `20260911120000_add_removed_custom_platform_brands` shows as applied. No Edge Function deploy is needed for this sub-project.

- [ ] **Step 5: Document in CLAUDE.md**

Add a "Recent Changes" entry to `CLAUDE.md` under Dynamic State, describing this feature (custom platform removed-flag parity: badge, Edit Entry checkbox, Edit Brand Tab section, export column, KPI exclusion in Overview + Brand Tabs, notification email — first of the three Custom Platforms parity sub-projects; Schedule Planner and Ask AI parity remain deferred, as before). Commit it.

```bash
git add CLAUDE.md
git commit -m "docs: record custom platform removed-flag feature in CLAUDE.md"
git push origin main
```
