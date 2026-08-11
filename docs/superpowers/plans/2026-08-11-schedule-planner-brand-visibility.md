# Schedule Planner — Per-Brand Hide & Platform Restriction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let specific (tab, brand) pairs be fully hidden from the Schedule Planner, or restricted to exactly one schedulable platform, without touching Score Summary, Brand Tabs, `getTabPlatforms`, or existing `brand_schedule`/`brand_platform_pause` rows.

**Architecture:** Two new Supabase tables (row-existence-is-the-flag, same shape as `removed_platform_brands`) feed a single pure resolver function, `getSchedulableBrandPlatforms`, that both the browser page (`SchedulePlanner.tsx`) and the Deno Edge Function (`generate-weekly-schedule`) call through the shared `schedulerService.ts` — so display and auto-generation/auto-pause can never disagree about which platforms a brand may use.

**Tech Stack:** React 19 + TypeScript (Vite, frontend), Deno (Supabase Edge Function), Supabase Postgres + RLS, Vitest (frontend tests), Deno.test (Edge Function tests).

**PMS task:** "Update Brand Scheduling Planner" (`cmsnccbz7000004lgo38rfbae`, In Progress)
**Spec:** `docs/superpowers/specs/2026-08-11-schedule-planner-brand-visibility-design.md`

## Global Constraints

- DB-seeded configuration only — no admin UI to toggle hide/restrict (confirmed with user).
- Must not change `removed_platform_brands`, Score Summary (`scoreSummary.ts`), Brand Tabs (`BrandGroup.tsx`), or `getTabPlatforms` (`tab-configs.ts`).
- Must not modify or delete any existing `brand_schedule`/`brand_platform_pause` row — only future auto-generation/auto-pause evaluation is affected.
- New tables follow the existing `removed_platform_brands`/`brand_platform_override` pattern exactly: generated `brand_key` (`lower(btrim(brand))`), all 4 RLS policies (anyone can read; approved users insert/update/delete via `public.is_approved()`), even though no UI writes to them yet.
- TypeScript strict mode; no `any` without a comment explaining why.
- `tsc --noEmit` checks nothing in this repo (root tsconfig is references-only) — always verify with `npm run build`.
- Exact seed brand values (verified live against `entries.data.Brands` via the Supabase REST API, not guessed from the PMS task text): `Novadreams`, `Novadreams2` (Rooster Partners), `Midasluck`, `Revolution1`, `God Of Casino` (Revolution Casino). Matching is case/whitespace-insensitive (`brand_key`), so exact casing doesn't need to match — exact absence/presence of internal spaces does (`Revolution1` has none; `God Of Casino` is the real name behind the task's "GOC" shorthand).

---

### Task 1: Database migration — hide & restriction tables + seed data

**Files:**
- Create: `supabase/migrations/20260811150000_add_schedule_brand_visibility.sql`

**Interfaces:**
- Produces: tables `schedule_hidden_brands (tab, brand, brand_key, created_at)` and `schedule_platform_restrictions (tab, brand, brand_key, allowed_platform, created_at)`, each readable via `select tab, brand [, allowed_platform] from ... where tab = ...`. Task 3's `fetchScheduleHiddenBrands`/`fetchScheduleRestrictedBrands` query these tables and column names exactly.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260811150000_add_schedule_brand_visibility.sql
-- Schedule Planner per-brand hide/restrict (docs/superpowers/specs/2026-08-11-schedule-planner-brand-visibility-design.md):
--
-- schedule_hidden_brands: a brand's row existence here means it must never
-- appear in the Schedule Planner grid at all -- distinct from
-- removed_platform_brands, which also affects Score Summary/Brand Tabs and
-- is keyed per-platform, not per-brand.
--
-- schedule_platform_restrictions: a brand's row existence here means it may
-- only be scheduled on `allowed_platform`, for Schedule Planner purposes
-- only (auto-generation, auto-pause, and the day-cell grid) -- Score
-- Summary/Brand Tabs still show the brand's data on every platform normally.
--
-- Both are DB-seeded only for this task -- no admin UI exists yet to toggle
-- them, but RLS is kept complete (all 4 policies) to match every other flag
-- table in this project, so a future UI or manual edit doesn't hit a
-- missing-policy surprise.

create table public.schedule_hidden_brands (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  brand      text not null,
  brand_key  text generated always as (lower(btrim(brand))) stored,
  created_at timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.schedule_hidden_brands enable row level security;

create policy "anyone can read schedule_hidden_brands"
  on public.schedule_hidden_brands for select using (true);
create policy "approved users can insert schedule_hidden_brands"
  on public.schedule_hidden_brands for insert with check (public.is_approved());
create policy "approved users can update schedule_hidden_brands"
  on public.schedule_hidden_brands for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_hidden_brands"
  on public.schedule_hidden_brands for delete using (public.is_approved());

create table public.schedule_platform_restrictions (
  id               uuid primary key default gen_random_uuid(),
  tab              text not null,
  brand            text not null,
  brand_key        text generated always as (lower(btrim(brand))) stored,
  allowed_platform text not null check (allowed_platform in ('tp', 'ag', 'cg', 'wo')),
  created_at       timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.schedule_platform_restrictions enable row level security;

create policy "anyone can read schedule_platform_restrictions"
  on public.schedule_platform_restrictions for select using (true);
create policy "approved users can insert schedule_platform_restrictions"
  on public.schedule_platform_restrictions for insert with check (public.is_approved());
create policy "approved users can update schedule_platform_restrictions"
  on public.schedule_platform_restrictions for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_platform_restrictions"
  on public.schedule_platform_restrictions for delete using (public.is_approved());

-- Seed data for PMS task "Update Brand Scheduling Planner". Brand values are
-- the exact live entries.data.Brands strings (verified via REST, not the
-- PMS task's shorthand): "GOC" = God Of Casino, "Revolution 1" = Revolution1
-- (no space). Case/whitespace differences from the PMS task text elsewhere
-- (Novadreams vs "NovaDreams") don't matter -- brand_key normalizes both.

insert into public.schedule_hidden_brands (tab, brand) values
  ('Rooster Partners', 'Novadreams'),
  ('Revolution Casino', 'Midasluck'),
  ('Revolution Casino', 'Revolution1');

insert into public.schedule_platform_restrictions (tab, brand, allowed_platform) values
  ('Rooster Partners', 'Novadreams2', 'tp'),
  ('Revolution Casino', 'God Of Casino', 'ag');
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: migration applies cleanly (this checkout is already linked — `supabase/.temp/project-ref` exists). If `supabase db push` fails due to missing CLI auth in this environment, apply the file's SQL manually via the Supabase Dashboard's SQL Editor instead, then continue to Step 3 regardless of which path was used.

- [ ] **Step 3: Verify the seed rows landed, via the same read-only REST pattern used during design**

Run (values already known-good from this session's design phase — reuse the same `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from `.env`):

```bash
URL=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
curl -s "$URL/rest/v1/schedule_hidden_brands?select=tab,brand" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
curl -s "$URL/rest/v1/schedule_platform_restrictions?select=tab,brand,allowed_platform" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: first call returns exactly 3 rows (Rooster Partners/Novadreams, Revolution Casino/Midasluck, Revolution Casino/Revolution1); second returns exactly 2 rows (Rooster Partners/Novadreams2 → tp, Revolution Casino/God Of Casino → ag).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260811150000_add_schedule_brand_visibility.sql
git commit -m "feat: add schedule_hidden_brands/schedule_platform_restrictions tables, seed 5 brands"
```

---

### Task 2: `src/lib/scheduleBrandConfig.ts` — shared platform resolver

**Files:**
- Create: `src/lib/scheduleBrandConfig.ts`
- Test: `src/lib/scheduleBrandConfig.test.ts`

**Interfaces:**
- Consumes: `normalizeBrandKey`, `type Platform` from `./removedPlatformBrands.ts` (already exist — `normalizeBrandKey(brand: string): string`, `type Platform = 'tp' | 'ag' | 'cg' | 'wo'`).
- Produces: `scheduleBrandKey(tab: string, brand: string): string`; `buildHiddenBrandSet(rows: { tab: string; brand: string }[]): Set<string>`; `buildPlatformRestrictionMap(rows: { tab: string; brand: string; allowed_platform: Platform }[]): Map<string, Platform>`; `getSchedulableBrandPlatforms(tab: string, brand: string, tabPlatforms: Platform[], hiddenSet: Set<string>, restrictionMap: Map<string, Platform>): Platform[]` — used by Task 4 (`schedulerService.ts`), Task 5 (`SchedulePlanner.tsx`), Task 6 (`generate-weekly-schedule/index.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/scheduleBrandConfig.test.ts
import { describe, it, expect } from 'vitest';
import {
  scheduleBrandKey,
  buildHiddenBrandSet,
  buildPlatformRestrictionMap,
  getSchedulableBrandPlatforms,
} from './scheduleBrandConfig';

describe('scheduleBrandKey', () => {
  it('matches regardless of brand casing or surrounding whitespace', () => {
    expect(scheduleBrandKey('Rooster Partners', 'Novadreams')).toBe(scheduleBrandKey('Rooster Partners', '  NOVADREAMS  '));
  });

  it('treats the same brand name in different tabs as distinct', () => {
    expect(scheduleBrandKey('Rooster Partners', 'Novadreams')).not.toBe(scheduleBrandKey('Revolution Casino', 'Novadreams'));
  });
});

describe('buildHiddenBrandSet / getSchedulableBrandPlatforms (hide)', () => {
  it('returns no schedulable platforms for a hidden brand', () => {
    const hiddenSet = buildHiddenBrandSet([{ tab: 'Rooster Partners', brand: 'Novadreams' }]);
    const result = getSchedulableBrandPlatforms(
      'Rooster Partners', 'Novadreams', ['tp', 'ag', 'cg'], hiddenSet, new Map(),
    );
    expect(result).toEqual([]);
  });

  it('matches a hidden brand regardless of casing', () => {
    const hiddenSet = buildHiddenBrandSet([{ tab: 'Rooster Partners', brand: 'Novadreams' }]);
    const result = getSchedulableBrandPlatforms(
      'Rooster Partners', 'NOVADREAMS', ['tp'], hiddenSet, new Map(),
    );
    expect(result).toEqual([]);
  });

  it('does not hide a brand with the same name on a different tab', () => {
    const hiddenSet = buildHiddenBrandSet([{ tab: 'Rooster Partners', brand: 'Novadreams' }]);
    const result = getSchedulableBrandPlatforms(
      'Revolution Casino', 'Novadreams', ['tp'], hiddenSet, new Map(),
    );
    expect(result).toEqual(['tp']);
  });
});

describe('buildPlatformRestrictionMap / getSchedulableBrandPlatforms (restrict)', () => {
  it('narrows a restricted brand down to its single allowed platform', () => {
    const restrictionMap = buildPlatformRestrictionMap([
      { tab: 'Rooster Partners', brand: 'Novadreams2', allowed_platform: 'tp' },
    ]);
    const result = getSchedulableBrandPlatforms(
      'Rooster Partners', 'Novadreams2', ['tp', 'ag', 'cg'], new Set(), restrictionMap,
    );
    expect(result).toEqual(['tp']);
  });

  it('returns no platforms if the allowed platform is not actually active on the tab', () => {
    const restrictionMap = buildPlatformRestrictionMap([
      { tab: 'Revolution Casino', brand: 'God Of Casino', allowed_platform: 'wo' },
    ]);
    const result = getSchedulableBrandPlatforms(
      'Revolution Casino', 'God Of Casino', ['tp', 'ag', 'cg'], new Set(), restrictionMap,
    );
    expect(result).toEqual([]);
  });

  it('leaves an unrestricted, unhidden brand unchanged', () => {
    const result = getSchedulableBrandPlatforms(
      'Rooster Partners', 'Rocketspin', ['tp', 'ag', 'cg'], new Set(), new Map(),
    );
    expect(result).toEqual(['tp', 'ag', 'cg']);
  });

  it('hide takes precedence over a restriction on the same brand', () => {
    const hiddenSet = buildHiddenBrandSet([{ tab: 'X', brand: 'Both' }]);
    const restrictionMap = buildPlatformRestrictionMap([{ tab: 'X', brand: 'Both', allowed_platform: 'tp' }]);
    const result = getSchedulableBrandPlatforms('X', 'Both', ['tp', 'ag'], hiddenSet, restrictionMap);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- scheduleBrandConfig`
Expected: FAIL — `Cannot find module './scheduleBrandConfig'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/scheduleBrandConfig.ts
// A brand can be fully hidden from Schedule Planner (schedule_hidden_brands)
// or restricted to a single platform for scheduling purposes only
// (schedule_platform_restrictions) -- both Schedule-Planner-scoped, distinct
// from removed_platform_brands (which also affects Score Summary/Brand
// Tabs and is keyed per-platform, not per-brand).
// getSchedulableBrandPlatforms is the single place this is resolved, so
// SchedulePlanner.tsx (display), the generate-weekly-schedule Edge Function,
// and schedulerService.ts (auto-generation/pause) can't drift out of sync.

import { normalizeBrandKey, type Platform } from './removedPlatformBrands.ts';

export function scheduleBrandKey(tab: string, brand: string): string {
  return `${tab}::${normalizeBrandKey(brand)}`;
}

export function buildHiddenBrandSet(rows: { tab: string; brand: string }[]): Set<string> {
  return new Set(rows.map((r) => scheduleBrandKey(r.tab, r.brand)));
}

export function buildPlatformRestrictionMap(
  rows: { tab: string; brand: string; allowed_platform: Platform }[],
): Map<string, Platform> {
  return new Map(rows.map((r) => [scheduleBrandKey(r.tab, r.brand), r.allowed_platform]));
}

export function getSchedulableBrandPlatforms(
  tab: string,
  brand: string,
  tabPlatforms: Platform[],
  hiddenSet: Set<string>,
  restrictionMap: Map<string, Platform>,
): Platform[] {
  if (hiddenSet.has(scheduleBrandKey(tab, brand))) return [];
  const restriction = restrictionMap.get(scheduleBrandKey(tab, brand));
  if (restriction) return tabPlatforms.filter((p) => p === restriction);
  return tabPlatforms;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- scheduleBrandConfig`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleBrandConfig.ts src/lib/scheduleBrandConfig.test.ts
git commit -m "feat: add getSchedulableBrandPlatforms resolver for Schedule Planner hide/restrict"
```

---

### Task 3: `src/lib/queries.ts` — fetch functions for the new tables

**Files:**
- Modify: `src/lib/queries.ts` (add near the existing `fetchRemovedPlatformBrands`/`fetchBrandPlatformOverrides`, around line 213-221 and 722-729)
- Test: `src/lib/queries.test.ts` (extend existing `describe('queries.ts injectable Supabase client', ...)` block)

**Interfaces:**
- Consumes: `Platform` type from `./removedPlatformBrands.ts` (already imported in `queries.ts`); the module-level `supabase` client and `SupabaseClient` type already imported in `queries.ts`.
- Produces: `fetchScheduleHiddenBrands(tab: string, client?: SupabaseClient): Promise<{ tab: string; brand: string }[]>`; `fetchScheduleRestrictedBrands(tab: string, client?: SupabaseClient): Promise<{ tab: string; brand: string; allowed_platform: Platform }[]>` — consumed by Task 5 (`SchedulePlanner.tsx`) and Task 6 (`generate-weekly-schedule/index.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/queries.test.ts`, inside the existing `describe('queries.ts injectable Supabase client', ...)` block (after the `fetchBrandPlatformOverrides` test, using the file's existing `chain()` helper and `singletonFrom` mock):

```typescript
  it('fetchScheduleHiddenBrands uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchScheduleHiddenBrands('X', { from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('schedule_hidden_brands');
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('fetchScheduleHiddenBrands falls back to the singleton when no client is passed', async () => {
    singletonFrom.mockReturnValue(chain({ data: [], error: null }));
    await fetchScheduleHiddenBrands('X');
    expect(singletonFrom).toHaveBeenCalledWith('schedule_hidden_brands');
  });

  it('fetchScheduleRestrictedBrands uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({
      data: [{ tab: 'X', brand: 'GOC', allowed_platform: 'ag' }],
      error: null,
    }));
    const rows = await fetchScheduleRestrictedBrands('X', { from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('schedule_platform_restrictions');
    expect(singletonFrom).not.toHaveBeenCalled();
    expect(rows).toEqual([{ tab: 'X', brand: 'GOC', allowed_platform: 'ag' }]);
  });
```

And add `fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands` to the existing `import { ... } from './queries';` list at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- queries.test.ts`
Expected: FAIL — `fetchScheduleHiddenBrands`/`fetchScheduleRestrictedBrands` are not exported from `./queries`.

- [ ] **Step 3: Add the implementation to `src/lib/queries.ts`**

Insert immediately after the existing `fetchRemovedPlatformBrands` function (after its closing `}` around line 221):

```typescript
export async function fetchScheduleHiddenBrands(
  tab: string,
  client: SupabaseClient = supabase,
): Promise<{ tab: string; brand: string }[]> {
  const { data, error } = await client
    .from('schedule_hidden_brands')
    .select('tab, brand')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string }[];
}

export async function fetchScheduleRestrictedBrands(
  tab: string,
  client: SupabaseClient = supabase,
): Promise<{ tab: string; brand: string; allowed_platform: Platform }[]> {
  const { data, error } = await client
    .from('schedule_platform_restrictions')
    .select('tab, brand, allowed_platform')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string; allowed_platform: Platform }[];
}
```

(`Platform` and `SupabaseClient`/`supabase` are already imported at the top of `queries.ts` — no new imports needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add fetchScheduleHiddenBrands/fetchScheduleRestrictedBrands"
```

---

### Task 4: Wire into `schedulerService.ts` — auto-generation & auto-pause respect hide/restrict

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts`
- Test: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes: `getSchedulableBrandPlatforms`, `scheduleBrandKey` from `../scheduleBrandConfig.ts` (Task 2).
- Produces: `TabContext` gains two new optional fields, `hiddenBrandSet?: Set<string>` and `platformRestrictionMap?: Map<string, Platform>` — consumed by Task 5 (`SchedulePlanner.tsx`) and Task 6 (`generate-weekly-schedule/index.ts`), both of which build a `TabContext` object.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduler/schedulerService.test.ts`. First, add this import near the top (alongside the existing `platformRemovedKey`/`overrideKey` imports):

```typescript
import { scheduleBrandKey } from '../scheduleBrandConfig';
```

Then add these tests inside `describe('recalculatePauses', ...)`, after the existing "does not evaluate or pause a brand+platform whose page is flagged removed" test:

```typescript
  it('does not evaluate or pause a brand whose brand is hidden from Schedule Planner', async () => {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp'],
      entries: [
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
      ],
      hiddenBrandSet: new Set([scheduleBrandKey('BITP', 'WinMega')]),
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
  });

  it('only evaluates a platform-restricted brand for its allowed platform, skipping the rest', async () => {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp', 'ag'],
      entries: [
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        entry({ Brands: 'WinMega', 'AG Review Status': 'removed', 'Ask Gambler review added': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'AG Review Status': 'refused', 'Ask Gambler review added': '2026-07-24' }),
      ],
      platformRestrictionMap: new Map([[scheduleBrandKey('BITP', 'WinMega'), 'ag']]),
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    // Both TP and AG independently qualify for the consecutive-removed pause
    // trigger, but WinMega is restricted to AG only -- TP must never be
    // evaluated or paused.
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith('BITP', 'WinMega', 'ag', '2026-08-03', expect.any(String), undefined);
  });
```

And inside `describe('ensureWeekGenerated', ...)`, after the existing "does not generate rows for a brand+platform flagged removed" test:

```typescript
  it('does not generate rows for a brand hidden from Schedule Planner, but still generates for others', async () => {
    const ctx: TabContext = {
      brands: ['WinMega', 'BrandB'],
      activePlatforms: ['tp'],
      entries: [],
      hiddenBrandSet: new Set([scheduleBrandKey('BITP', 'WinMega')]),
    };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'BrandB', week_start: '2026-08-03', platform: 'tp' });
  });

  it('only generates rows for a platform-restricted brand\'s allowed platform', async () => {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['tp', 'ag'],
      entries: [],
      platformRestrictionMap: new Map([[scheduleBrandKey('BITP', 'WinMega'), 'ag']]),
    };
    await ensureWeekGenerated('BITP', '2026-08-03', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'WinMega', week_start: '2026-08-03', platform: 'ag' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- schedulerService.test.ts`
Expected: FAIL — new tests fail (e.g. `upsertBrandPlatformPause` called for the hidden/wrong-platform combo, or `TabContext` type error on `hiddenBrandSet`/`platformRestrictionMap` not existing).

- [ ] **Step 3: Implement in `src/lib/scheduler/schedulerService.ts`**

Add the import (alongside the existing `import { normalizeBrandKey, platformRemovedKey, type Platform } from '../removedPlatformBrands.ts';` at the top):

```typescript
import { getSchedulableBrandPlatforms } from '../scheduleBrandConfig.ts';
```

Extend the `TabContext` interface (add after the existing `overrideMap?: Map<string, OverrideState>;` field):

```typescript
  // Keys from scheduleBrandKey(tab, brand) for every brand hidden from
  // Schedule Planner entirely (schedule_hidden_brands). Optional, same
  // "defaults to nothing hidden" convention as the other two sets/maps.
  hiddenBrandSet?: Set<string>;
  // scheduleBrandKey(tab, brand) -> the one platform this brand may be
  // scheduled on (schedule_platform_restrictions). Optional, same
  // "defaults to unrestricted" convention.
  platformRestrictionMap?: Map<string, Platform>;
```

In `recalculatePauses`, add two new local bindings alongside the existing `removedSet`/`overrideMap` locals (right after `const overrideMap = ctx.overrideMap ?? new Map<string, OverrideState>();`):

```typescript
  const hiddenSet = ctx.hiddenBrandSet ?? new Set<string>();
  const restrictionMap = ctx.platformRestrictionMap ?? new Map<string, Platform>();
```

Inside the `for (const brand of ctx.brands) {` loop, compute the brand's schedulable platforms once (right after the existing `const brandKey = normalizeBrandKey(brand);` line):

```typescript
    const schedulablePlatforms = getSchedulableBrandPlatforms(tab, brand, ctx.activePlatforms, hiddenSet, restrictionMap);
```

Then, inside the `for (const platform of ctx.activePlatforms) {` loop, add a new skip check immediately after the existing `if (removedSet.has(platformRemovedKey(tab, brand, platform))) continue;` line:

```typescript
      if (!schedulablePlatforms.includes(platform)) continue;
```

In `ensureWeekGenerated`, add the same two local bindings right after the existing `const removedSet = ctx.removedPlatformBrandSet ?? new Set<string>();` line:

```typescript
  const hiddenSet = ctx.hiddenBrandSet ?? new Set<string>();
  const restrictionMap = ctx.platformRestrictionMap ?? new Map<string, Platform>();
```

Then extend the existing removed-combo-building loop to also collect excluded combos (replace the existing loop body):

```typescript
  const removedCombos: PinnedCombo[] = [];
  const excludedCombos: PinnedCombo[] = [];
  for (const brand of ctx.brands) {
    const brandKey = normalizeBrandKey(brand);
    const schedulablePlatforms = getSchedulableBrandPlatforms(tab, brand, ctx.activePlatforms, hiddenSet, restrictionMap);
    for (const platform of ctx.activePlatforms) {
      if (removedSet.has(platformRemovedKey(tab, brand, platform))) {
        removedCombos.push({ brandKey, platform });
      } else if (!schedulablePlatforms.includes(platform)) {
        excludedCombos.push({ brandKey, platform });
      }
    }
  }
```

Finally, update the `pinnedBrandPlatforms` array passed into `generateWeekSchedule` to include `excludedCombos`:

```typescript
    pinnedBrandPlatforms: [...alreadyHasRowCombos, ...removedCombos, ...excludedCombos],
```

No changes needed to `buildCarryover` — a hidden/restricted combo is pinned before `generateWeekSchedule` ever runs, the same mechanism that already suppresses removed-platform combos without `buildCarryover` needing to know about them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- schedulerService.test.ts`
Expected: PASS (all existing tests plus the 4 new ones).

- [ ] **Step 5: Run the full frontend test suite to check for regressions**

Run: `npm test`
Expected: PASS, no regressions elsewhere.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
git commit -m "feat: schedulerService respects Schedule Planner hide/restrict for pause + auto-generation"
```

---

### Task 5: Wire into `SchedulePlanner.tsx` — grid respects hide/restrict

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- Consumes: `fetchScheduleHiddenBrands`, `fetchScheduleRestrictedBrands` (Task 3); `buildHiddenBrandSet`, `buildPlatformRestrictionMap`, `getSchedulableBrandPlatforms` (Task 2); `TabContext`'s new `hiddenBrandSet`/`platformRestrictionMap` fields (Task 4).
- Produces: no new exports — this is the page's own internal wiring. `brandPlatforms(brand)` (already the single choke point every other function in this file reads through) now also reflects hide/restrict, and `filteredBrands` (which already drops any brand whose `brandPlatforms(brand)` is empty) picks up hidden brands for free.

This project has no page-level (`*.test.tsx`) test suite for `SchedulePlanner.tsx` — verification for this task is `npm run build` plus the manual read-through in Step 3, matching this codebase's existing convention for page-wiring changes (unit tests cover the `lib/` logic; pages are verified by build + live check).

- [ ] **Step 1: Add imports**

In `src/pages/SchedulePlanner.tsx`, extend the existing `import { ... } from '../lib/queries';` block (around line 6-15) to add `fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands,`. Add a new import line after the existing `import { buildOverrideMap, type OverrideState } from '../lib/scheduleOverrides';` (line 18):

```typescript
import { buildHiddenBrandSet, buildPlatformRestrictionMap, getSchedulableBrandPlatforms } from '../lib/scheduleBrandConfig';
```

- [ ] **Step 2: Extend `tabCtx` state shape**

In the `tabCtx` state type (around line 117-124), add two fields after the existing `overrideMap: Map<string, OverrideState>;`:

```typescript
    hiddenBrandSet: Set<string>;
    platformRestrictionMap: Map<string, Platform>;
```

- [ ] **Step 3: Fetch the new data in the tab-load effect**

In the tab-load effect (around line 187-192), extend the `Promise.all` array to fetch both new tables (mirroring the existing `.catch(() => [])` fallback pattern used for `fetchRemovedPlatformBrands`/`fetchBrandPlatformOverrides`):

```typescript
        const [rawEntries, headers, removedPlatformBrandRows, overrideRows, hiddenBrandRows, restrictedBrandRows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          fetchRemovedPlatformBrands().catch(() => [] as { tab: string; brand: string; platform: Platform }[]),
          fetchBrandPlatformOverrides(tab).catch(() => []),
          fetchScheduleHiddenBrands(tab).catch(() => []),
          fetchScheduleRestrictedBrands(tab).catch(() => []),
        ]);
```

Then extend the `setTabCtx({...})` call (around line 206-213) to build and store the new set/map:

```typescript
        setTabCtx({
          tab,
          brands: uniqueBrands,
          activePlatforms: platforms,
          entries: rawEntries,
          removedPlatformBrandSet: buildRemovedPlatformBrandSet(removedPlatformBrandRows),
          overrideMap: buildOverrideMap(overrideRows),
          hiddenBrandSet: buildHiddenBrandSet(hiddenBrandRows),
          platformRestrictionMap: buildPlatformRestrictionMap(restrictedBrandRows),
        });
```

- [ ] **Step 4: Thread the new fields into the `TabContext` passed to the scheduler**

In the schedule-loading effect, where `ctx: TabContext` is built (around line 263-269), add the two new fields:

```typescript
          const ctx: TabContext = {
            brands: tabCtx!.brands,
            activePlatforms: tabCtx!.activePlatforms,
            entries: tabCtx!.entries,
            removedPlatformBrandSet: tabCtx!.removedPlatformBrandSet,
            overrideMap: tabCtx!.overrideMap,
            hiddenBrandSet: tabCtx!.hiddenBrandSet,
            platformRestrictionMap: tabCtx!.platformRestrictionMap,
          };
```

- [ ] **Step 5: Apply the resolver in `brandPlatforms`**

Replace the existing `brandPlatforms` function body (around line 314-317):

```typescript
  function brandPlatforms(brand: string): Platform[] {
    const removedSet = tabCtx?.removedPlatformBrandSet ?? new Set<string>();
    const hiddenSet = tabCtx?.hiddenBrandSet ?? new Set<string>();
    const restrictionMap = tabCtx?.platformRestrictionMap ?? new Map<string, Platform>();
    const schedulable = getSchedulableBrandPlatforms(tab, brand, activePlatforms, hiddenSet, restrictionMap);
    return schedulable.filter((p) => !removedSet.has(platformRemovedKey(tab, brand, p)));
  }
```

A hidden brand's `brandPlatforms(brand)` now returns `[]`, which the existing `filteredBrands` (line 355-360, unmodified) already drops from the grid via its `brandPlatforms(b).length > 0` filter — no separate hide-check needed there.

- [ ] **Step 6: Verify with a build**

Run: `npm run build`
Expected: PASS, no TypeScript errors (`tsc -b && vite build`).

- [ ] **Step 7: Manual read-through self-check**

Re-read the edited `tabCtx` state declaration, the tab-load effect, the scheduler `ctx` construction, and `brandPlatforms` together, confirming: (a) every place that builds a `TabContext` object now includes `hiddenBrandSet`/`platformRestrictionMap`; (b) `brandPlatforms` is still the only place platform filtering happens (no other function in the file reimplements this logic); (c) `filteredBrands` needs no direct edit.

- [ ] **Step 8: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: SchedulePlanner grid respects per-brand hide/restrict"
```

---

### Task 6: Wire into `generate-weekly-schedule` Edge Function — cron path stays consistent

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts`
- Test: `supabase/functions/generate-weekly-schedule/index_test.ts`

**Interfaces:**
- Consumes: `fetchScheduleHiddenBrands`, `fetchScheduleRestrictedBrands` (Task 3, already re-exported from `../../../src/lib/queries.ts` since Task 3 added them there); `buildHiddenBrandSet`, `buildPlatformRestrictionMap` (Task 2, from `../../../src/lib/scheduleBrandConfig.ts`); `TabContext`'s new fields (Task 4).
- Produces: `buildTabContext` output now includes `hiddenBrandSet`/`platformRestrictionMap`, so this weekly-cron path (once deployed) can never silently diverge from the browser path in `SchedulePlanner.tsx` — the exact class of drift this project's cross-dashboard-consistency rule exists to prevent.

This function is not yet deployed (per `CLAUDE.md`'s Known Issues — the migration/deploy for `generate-weekly-schedule` itself is still pending), but its code must stay correct and tested so it's ready whenever that deploy happens.

- [ ] **Step 1: Write the failing tests**

Add to `supabase/functions/generate-weekly-schedule/index_test.ts`, after the existing "buildTabContext populates overrideMap from its table" test:

```typescript
Deno.test('buildTabContext populates hiddenBrandSet from schedule_hidden_brands', async () => {
  const client = fakeClient({
    entries: [entry('Rooster Partners', '1', { Brands: 'Novadreams' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [],
    schedule_hidden_brands: [{ tab: 'Rooster Partners', brand: 'Novadreams' }],
    schedule_platform_restrictions: [],
  });
  const ctx = await buildTabContext('Rooster Partners', client);
  assertEquals(ctx.hiddenBrandSet?.has('Rooster Partners::novadreams'), true);
});

Deno.test('buildTabContext populates platformRestrictionMap from schedule_platform_restrictions', async () => {
  const client = fakeClient({
    entries: [entry('Revolution Casino', '1', { Brands: 'God Of Casino' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [],
    schedule_hidden_brands: [],
    schedule_platform_restrictions: [{ tab: 'Revolution Casino', brand: 'God Of Casino', allowed_platform: 'ag' }],
  });
  const ctx = await buildTabContext('Revolution Casino', client);
  assertEquals(ctx.platformRestrictionMap?.get('Revolution Casino::god of casino'), 'ag');
});
```

- [ ] **Step 2: Run the Deno tests to verify they fail**

Run: `deno test --allow-env --allow-net supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: FAIL — `ctx.hiddenBrandSet`/`ctx.platformRestrictionMap` are `undefined` (not yet populated by `buildTabContext`).

- [ ] **Step 3: Implement in `supabase/functions/generate-weekly-schedule/index.ts`**

Extend the imports (lines 15-17):

```typescript
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, invalidateTabCache } from '../../../src/lib/queries.ts';
import { buildRemovedPlatformBrandSet, type Platform } from '../../../src/lib/removedPlatformBrands.ts';
import { buildOverrideMap } from '../../../src/lib/scheduleOverrides.ts';
import { buildHiddenBrandSet, buildPlatformRestrictionMap } from '../../../src/lib/scheduleBrandConfig.ts';
```

Update `buildTabContext` (lines 30-54):

```typescript
export async function buildTabContext(tab: string, client: SupabaseClient): Promise<TabContext> {
  const [rawEntries, headers, removedPlatformBrandRows, overrideRows, hiddenBrandRows, restrictedBrandRows] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchTabHeaders(tab, client),
    fetchRemovedPlatformBrands(client),
    fetchBrandPlatformOverrides(tab, client),
    fetchScheduleHiddenBrands(tab, client),
    fetchScheduleRestrictedBrands(tab, client),
  ]);
  const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? getBrandNameCol(tab);
  const uniqueBrands = [...new Set(
    rawEntries
      .map((e) => e.data[brandCol])
      .filter((v): v is string => !!v && v.trim() !== ''),
  )].sort();
  if (uniqueBrands.length === 0 && TAB_DEFAULT_BRAND[tab]) uniqueBrands.push(TAB_DEFAULT_BRAND[tab]);

  return {
    brands: uniqueBrands,
    activePlatforms: getTabPlatforms(tab),
    entries: rawEntries,
    removedPlatformBrandSet: buildRemovedPlatformBrandSet(
      removedPlatformBrandRows as { tab: string; brand: string; platform: Platform }[],
    ),
    overrideMap: buildOverrideMap(overrideRows),
    hiddenBrandSet: buildHiddenBrandSet(hiddenBrandRows),
    platformRestrictionMap: buildPlatformRestrictionMap(restrictedBrandRows),
  };
}
```

- [ ] **Step 4: Run the Deno tests to verify they pass**

Run: `deno test --allow-env --allow-net supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run `deno check`**

Run: `deno check --no-lock --node-modules-dir=none --config supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index.ts`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts supabase/functions/generate-weekly-schedule/index_test.ts
git commit -m "feat: generate-weekly-schedule cron path respects Schedule Planner hide/restrict"
```

---

### Task 7: Final verification, docs, and PMS sync

**Files:**
- Modify: `docs/task-history.md` (append new entry)
- Modify: `.claude/pms-synced-tasks.txt` (pre-register the new entry's number)

**Interfaces:** none — this task only runs verification commands and updates project bookkeeping.

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm test`
Expected: PASS, full suite green (no regressions from Tasks 1-6).

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: PASS (`tsc -b && vite build`).

- [ ] **Step 3: Re-verify the migration's seed data is still exactly as expected**

Reuse the same commands as Task 1 Step 3. Expected: still exactly 3 rows in `schedule_hidden_brands`, 2 in `schedule_platform_restrictions`, matching the table in the design spec.

- [ ] **Step 4: Determine the next task-history.md number**

Run: `grep -oE "^## Task [0-9]+" docs/task-history.md | sort -t' ' -k3 -n | tail -1`
Expected output as of this plan's writing: `## Task 204` — so this task becomes **Task 205**. If a concurrent session has since added a higher number, use the next number after whatever is actually latest instead of 205.

- [ ] **Step 5: Append the task-history.md entry**

Add a new `## Task 205: Update Brand Scheduling Planner — Per-Brand Hide & Platform Restriction` section at the end of `docs/task-history.md` (following the file's existing entry format — `**Date:**` line, then a prose description), covering: the two new tables and their seed rows (Novadreams/Midasluck/Revolution1 hidden; Novadreams2 restricted to TP, God Of Casino restricted to AG), the `getSchedulableBrandPlatforms` shared resolver, and that both the browser page and the not-yet-deployed `generate-weekly-schedule` Edge Function were updated to keep them consistent. Note the live-data verification finding (GOC = God Of Casino, "Revolution 1" = Revolution1 with no space) since it's a real, non-obvious gotcha for anyone editing these tables later.

- [ ] **Step 6: Pre-register the new task number so the Stop hook doesn't create a duplicate PMS task**

This PMS task already exists (`cmsnccbz7000004lgo38rfbae`, created directly by the user, currently In Progress) — it must be moved to Review/QA directly (Step 7), not have a second, duplicate task auto-created from the new task-history.md entry by `.claude/scripts/ship-to-pms.ps1`'s Stop hook. Append the number chosen in Step 4 (e.g. `205`) as a new line at the end of `.claude/pms-synced-tasks.txt`.

- [ ] **Step 7: Move the existing PMS task to Review/QA with a label**

```bash
TOKEN=$(grep PMS_API_TOKEN .env | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Origin: https://pms-nu-eight.vercel.app" \
  -d '{"columnId":"cmpe8l7g5000404l7n0yw9tua","position":0}' \
  "https://pms-nu-eight.vercel.app/api/tasks/cmsnccbz7000004lgo38rfbae/move"
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"labelIds":["cmqjmmtl9000004lbbuly4jj7"]}' \
  "https://pms-nu-eight.vercel.app/api/tasks/cmsnccbz7000004lgo38rfbae"
```

Expected: both calls return 200 with the task now in Review/QA (`cmpe8l7g5000404l7n0yw9tua`) carrying the Feature label (`cmqjmmtl9000004lbbuly4jj7`).

- [ ] **Step 8: Commit**

```bash
git add docs/task-history.md .claude/pms-synced-tasks.txt
git commit -m "docs: record Task 205 (Schedule Planner hide/restrict) in task history"
```

## Self-Review Notes

- **Spec coverage:** hide (Task 1 seed + Task 2/4/5/6 logic), restrict-to-one-platform (same), "don't affect other config" (Tasks 1/4 explicitly leave `removed_platform_brands`/existing `brand_schedule` rows untouched), live-brand-name verification (Task 1's seed values), no admin UI (confirmed, not built) — all covered.
- **Placeholder scan:** no TBD/TODO; every step has complete code or an exact command.
- **Type consistency:** `Platform`, `TabContext`, `getSchedulableBrandPlatforms`'s signature, and `scheduleBrandKey` are used identically across Tasks 2, 4, 5, and 6 — checked against each task's own "Produces"/"Consumes" line.
