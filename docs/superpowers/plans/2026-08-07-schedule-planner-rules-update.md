# Schedule Planner Rules Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update Schedule Planner's auto-pause logic per new per-platform business rules — Wizard of Odds drops to 1 post/week, the success-rate pause check switches from an all-time to a calendar-month-to-date window, a new manual "flagged via email" toggle becomes a third pause trigger, and a new manual pause/force-active override sits above all automatic detection.

**Architecture:** Two new Supabase tables (`flagged_platform_brands`, `brand_platform_override`), each mirroring the existing `removed_platform_brands`/`brand_platform_pause` shape. `TabContext` (`src/lib/scheduler/schedulerService.ts`) gains two new optional fields; `recalculatePauses` is restructured to check the override map first, then the (now three-trigger, monthly-windowed) automatic detection. Both call sites — `SchedulePlanner.tsx`'s page-visit effect and the `generate-weekly-schedule` Edge Function's Monday cron — fetch the two new tables and thread them into `TabContext` identically to how `removedPlatformBrandSet` already flows through both today. UI additions are confined to the existing Edit Entry modal (new checkboxes/select, same pattern as the existing "page removed" checkboxes) — no new pages or grid redesign.

**Tech Stack:** Vite/React/TypeScript, Supabase (Postgres + Deno Edge Functions), Vitest (frontend) + Deno test (edge function), Tailwind v4.

## Global Constraints

- Logic-only change — no new views, no calendar-grid redesign. UI additions reuse the existing Edit Entry modal pattern.
- Every new DB table follows the existing 4-policy RLS shape used by `removed_platform_brands`/`brand_platform_pause`: anyone can read, approved users can insert/update/delete (`public.is_approved()`).
- Brand matching everywhere is via the generated `brand_key` column (`lower(btrim(brand))`), never raw `brand` string — matches every existing flag/pause table in this codebase.
- `recalculatePauses`/`ensureWeekGenerated` must keep accepting an optional `client: SupabaseClient` last param and forwarding it to every query call — both the browser and the Edge Function share this code and each needs its own client threaded through (existing pattern, do not break it).
- Spec: `docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md`.

---

### Task 1: Database migration — two new tables

**Files:**
- Create: `supabase/migrations/20260807110000_add_flagged_platform_brands_and_override.sql`

**Interfaces:**
- Produces: tables `public.flagged_platform_brands (id, tab, brand, brand_key, platform, flagged_by, flagged_at)` and `public.brand_platform_override (id, tab, brand, brand_key, platform, override_state, set_by, created_at)`, both unique on `(tab, brand_key, platform)`, both with the standard 4 RLS policies.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260807110000_add_flagged_platform_brands_and_override.sql
-- Schedule Planner rules update (docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md):
--
-- flagged_platform_brands: a manual "ops received an email saying this
-- brand+platform was flagged" toggle. No automated email detection exists,
-- so this is purely operator-set, same shape/semantics as
-- removed_platform_brands (a row's mere existence is the flag). One of three
-- OR-conditions recalculatePauses now checks (alongside two-consecutive-
-- removed and the monthly success-rate check).
--
-- brand_platform_override: a manual override that beats whatever
-- recalculatePauses' automatic detection would otherwise compute for a
-- brand+platform combo. 'pause' forces a pause regardless of auto
-- conditions; 'active' forces continued posting even if auto-detection
-- would otherwise pause it (e.g. a client wants a review pushed despite a
-- low score). A row's mere existence is the override; no row means "auto"
-- (today's behavior, unchanged). Unlike an auto-detected pause, an override
-- does not auto-expire after a week — it persists until the row is deleted.

create table public.flagged_platform_brands (
  id          uuid primary key default gen_random_uuid(),
  tab         text not null,
  brand       text not null,
  brand_key   text generated always as (lower(btrim(brand))) stored,
  platform    text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  flagged_by  text,
  flagged_at  timestamptz not null default now(),
  unique (tab, brand_key, platform)
);

alter table public.flagged_platform_brands enable row level security;

create policy "anyone can read flagged_platform_brands"
  on public.flagged_platform_brands for select using (true);
create policy "approved users can insert flagged_platform_brands"
  on public.flagged_platform_brands for insert with check (public.is_approved());
create policy "approved users can update flagged_platform_brands"
  on public.flagged_platform_brands for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete flagged_platform_brands"
  on public.flagged_platform_brands for delete using (public.is_approved());

create table public.brand_platform_override (
  id              uuid primary key default gen_random_uuid(),
  tab             text not null,
  brand           text not null,
  brand_key       text generated always as (lower(btrim(brand))) stored,
  platform        text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  override_state  text not null check (override_state in ('pause', 'active')),
  set_by          text,
  created_at      timestamptz not null default now(),
  unique (tab, brand_key, platform)
);

alter table public.brand_platform_override enable row level security;

create policy "anyone can read brand_platform_override"
  on public.brand_platform_override for select using (true);
create policy "approved users can insert brand_platform_override"
  on public.brand_platform_override for insert with check (public.is_approved());
create policy "approved users can update brand_platform_override"
  on public.brand_platform_override for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_platform_override"
  on public.brand_platform_override for delete using (public.is_approved());
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: `Applying migration 20260807110000_add_flagged_platform_brands_and_override.sql...` then success, no errors. (Confirmed reachable this session via `supabase db push --dry-run` → "Remote database is up to date" before this migration existed.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260807110000_add_flagged_platform_brands_and_override.sql
git commit -m "feat(db): add flagged_platform_brands and brand_platform_override tables"
```

---

### Task 2: Shared key/map helpers

**Files:**
- Create: `src/lib/flaggedPlatformBrands.ts`
- Create: `src/lib/flaggedPlatformBrands.test.ts`
- Create: `src/lib/scheduleOverrides.ts`
- Create: `src/lib/scheduleOverrides.test.ts`

**Interfaces:**
- Consumes: `Platform`, `normalizeBrandKey` from `./removedPlatformBrands.ts` (already exist).
- Produces: `platformFlaggedKey(tab, brand, platform): string`, `buildFlaggedPlatformBrandSet(rows): Set<string>`; `type OverrideState = 'pause' | 'active'`, `overrideKey(tab, brandKey, platform): string`, `buildOverrideMap(rows): Map<string, OverrideState>`. These are the exact names Tasks 3, 4/5/6/7, 8, and 9 all import.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/flaggedPlatformBrands.test.ts
import { describe, it, expect } from 'vitest';
import { platformFlaggedKey, buildFlaggedPlatformBrandSet } from './flaggedPlatformBrands';

describe('platformFlaggedKey', () => {
  it('normalizes brand casing/whitespace but keeps tab and platform exact', () => {
    expect(platformFlaggedKey('BITP', '  WinMega  ', 'tp')).toBe(platformFlaggedKey('BITP', 'winmega', 'tp'));
    expect(platformFlaggedKey('BITP', 'WinMega', 'tp')).not.toBe(platformFlaggedKey('BITP', 'WinMega', 'ag'));
  });
});

describe('buildFlaggedPlatformBrandSet', () => {
  it('builds one key per row', () => {
    const set = buildFlaggedPlatformBrandSet([
      { tab: 'BITP', brand: 'WinMega', platform: 'tp' },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'ag' },
    ]);
    expect(set.has(platformFlaggedKey('BITP', 'WinMega', 'tp'))).toBe(true);
    expect(set.has(platformFlaggedKey('Hanan', 'Pribet.com', 'ag'))).toBe(true);
    expect(set.size).toBe(2);
  });
});
```

```typescript
// src/lib/scheduleOverrides.test.ts
import { describe, it, expect } from 'vitest';
import { overrideKey, buildOverrideMap } from './scheduleOverrides';

describe('overrideKey', () => {
  it('combines tab, brand_key, and platform', () => {
    expect(overrideKey('BITP', 'winmega', 'tp')).toBe('BITP::winmega::tp');
  });
});

describe('buildOverrideMap', () => {
  it('maps each row to its override_state, keyed by brand_key (not raw brand)', () => {
    const map = buildOverrideMap([
      { tab: 'BITP', brand_key: 'winmega', platform: 'tp', override_state: 'pause' },
      { tab: 'Hanan', brand_key: 'pribet.com', platform: 'ag', override_state: 'active' },
    ]);
    expect(map.get(overrideKey('BITP', 'winmega', 'tp'))).toBe('pause');
    expect(map.get(overrideKey('Hanan', 'pribet.com', 'ag'))).toBe('active');
    expect(map.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/flaggedPlatformBrands.test.ts src/lib/scheduleOverrides.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write the implementations**

```typescript
// src/lib/flaggedPlatformBrands.ts
// A brand+platform can be manually flagged after ops receives an email
// notification about it — there's no automated email-parsing in this
// system, so this is purely an operator-set toggle, same shape as
// removed_platform_brands (a row's mere existence is the flag). This key
// format is the single shared definition every reader (the Edit Entry
// checkbox, recalculatePauses' third pause trigger) goes through so they
// can't drift out of sync with each other or with the
// flagged_platform_brands table.

import { normalizeBrandKey, type Platform } from './removedPlatformBrands.ts';

export function platformFlaggedKey(tab: string, brand: string, platform: Platform): string {
  return `${tab}::${normalizeBrandKey(brand)}::${platform}`;
}

export function buildFlaggedPlatformBrandSet(
  rows: { tab: string; brand: string; platform: Platform }[],
): Set<string> {
  return new Set(rows.map((r) => platformFlaggedKey(r.tab, r.brand, r.platform)));
}
```

```typescript
// src/lib/scheduleOverrides.ts
// A manual override lets ops force a brand+platform's schedule state,
// beating whatever recalculatePauses' automatic detection would otherwise
// compute (docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md).
// 'pause' forces a pause regardless of auto conditions; 'active' forces
// continued posting even if auto-detection would otherwise pause it.
// Unlike flaggedPlatformBrands/removedPlatformBrands (boolean presence),
// this carries a state, so the shared helper here builds a Map, not a Set.
//
// Keyed by brand_key (not raw brand) because the source table
// (brand_platform_override, like brand_platform_pause) only stores the
// generated brand_key column, not the original brand string.

import type { Platform } from './removedPlatformBrands.ts';

export type OverrideState = 'pause' | 'active';

export function overrideKey(tab: string, brandKey: string, platform: Platform): string {
  return `${tab}::${brandKey}::${platform}`;
}

export function buildOverrideMap(
  rows: { tab: string; brand_key: string; platform: Platform; override_state: OverrideState }[],
): Map<string, OverrideState> {
  return new Map(rows.map((r) => [overrideKey(r.tab, r.brand_key, r.platform), r.override_state]));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/flaggedPlatformBrands.test.ts src/lib/scheduleOverrides.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/flaggedPlatformBrands.ts src/lib/flaggedPlatformBrands.test.ts src/lib/scheduleOverrides.ts src/lib/scheduleOverrides.test.ts
git commit -m "feat(scheduler): add flagged-brand and override key/map helpers"
```

---

### Task 3: `queries.ts` — CRUD for the two new tables

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `platformFlaggedKey`/`OverrideState` types are not needed directly here (queries.ts works with raw rows); `normalizeBrandKey`, `type Platform` already imported in queries.ts.
- Produces: `fetchFlaggedPlatformBrands(client?)`, `setBrandPlatformFlagged(tab, brand, platform, flagged)`, `fetchBrandPlatformOverrides(tab, client?)`, `setBrandPlatformOverride(tab, brand, platform, state)`, `clearBrandPlatformOverride(tab, brandKey, platform)`, and exported `interface BrandPlatformOverride { tab, brand_key, platform, override_state }` — these exact names are what Tasks 8 and 9 import.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/queries.test.ts` (extend the existing `import` list and the existing `describe` block):

```typescript
import {
  fetchBrandSchedule,
  fetchActiveBrandPlatformPauses,
  fetchRemovedPlatformBrands,
  bulkUpsertBrandSchedule,
  fetchFlaggedPlatformBrands,
  fetchBrandPlatformOverrides,
} from './queries';
```

```typescript
  it('fetchFlaggedPlatformBrands uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchFlaggedPlatformBrands({ from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('flagged_platform_brands');
    expect(singletonFrom).not.toHaveBeenCalled();
  });

  it('fetchBrandPlatformOverrides uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({ data: [], error: null }));
    await fetchBrandPlatformOverrides('X', { from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('brand_platform_override');
    expect(singletonFrom).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: FAIL — `fetchFlaggedPlatformBrands`/`fetchBrandPlatformOverrides` not exported yet.

- [ ] **Step 3: Add the query functions**

Add to `src/lib/queries.ts`, directly after the existing `setBrandPlatformRemoved` function (~line 630):

```typescript
export async function fetchFlaggedPlatformBrands(
  client: SupabaseClient = supabase,
): Promise<{ tab: string; brand: string; platform: Platform }[]> {
  const { data, error } = await client
    .from('flagged_platform_brands')
    .select('tab, brand, platform');
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string; platform: Platform }[];
}

// Mirrors setBrandPlatformRemoved exactly: matches/deletes via the
// generated brand_key column so a stored brand value that differs only in
// case/whitespace from the one passed in here still matches the existing
// row instead of silently no-oping.
export async function setBrandPlatformFlagged(tab: string, brand: string, platform: Platform, flagged: boolean): Promise<void> {
  const brandKey = normalizeBrandKey(brand);
  if (flagged) {
    const { error } = await supabase
      .from('flagged_platform_brands')
      .upsert({ tab, brand, platform, flagged_by: await currentUserEmail() }, { onConflict: 'tab,brand_key,platform' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('flagged_platform_brands')
      .delete()
      .eq('tab', tab)
      .eq('brand_key', brandKey)
      .eq('platform', platform);
    if (error) throw error;
  }
}

export interface BrandPlatformOverride {
  tab: string;
  brand_key: string;
  platform: Platform;
  override_state: 'pause' | 'active';
}

export async function fetchBrandPlatformOverrides(tab: string, client: SupabaseClient = supabase): Promise<BrandPlatformOverride[]> {
  const { data, error } = await client
    .from('brand_platform_override')
    .select('tab, brand_key, platform, override_state')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as BrandPlatformOverride[];
}

export async function setBrandPlatformOverride(tab: string, brand: string, platform: Platform, state: 'pause' | 'active'): Promise<void> {
  const { error } = await supabase
    .from('brand_platform_override')
    .upsert({ tab, brand, platform, override_state: state, set_by: await currentUserEmail() }, { onConflict: 'tab,brand_key,platform' });
  if (error) throw error;
}

export async function clearBrandPlatformOverride(tab: string, brandKey: string, platform: Platform): Promise<void> {
  const { error } = await supabase
    .from('brand_platform_override')
    .delete()
    .eq('tab', tab)
    .eq('brand_key', brandKey)
    .eq('platform', platform);
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat(queries): add CRUD for flagged_platform_brands and brand_platform_override"
```

---

### Task 4: Wizard of Odds frequency change (3/wk → 1/wk)

**Files:**
- Modify: `src/lib/scheduler/schedulerRules.ts`
- Modify: `src/lib/scheduler/schedulerEngine.test.ts`

**Interfaces:**
- Produces: `PLATFORM_RULES.wo` now `{ postsPerWeek: 1 }` (no `preferredDays`), matching `cg`'s shape.

- [ ] **Step 1: Update the failing test first**

In `src/lib/scheduler/schedulerEngine.test.ts`, replace the existing WO test (currently asserting 3 fixed days):

```typescript
  it('assigns WO exactly 1 post, load-balanced with no fixed preferred day', () => {
    const input: SchedulerInput = { ...baseInput, activePlatforms: ['wo'] };
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'wo')).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/scheduler/schedulerEngine.test.ts`
Expected: FAIL — current `PLATFORM_RULES.wo.postsPerWeek` is still 3, so `slotsFor(...)` has length 3, not 1.

- [ ] **Step 3: Update `PLATFORM_RULES.wo`**

In `src/lib/scheduler/schedulerRules.ts`, replace:

```typescript
  wo: { postsPerWeek: 3, preferredDays: ['monday', 'wednesday', 'friday'] },
```

with:

```typescript
  // Reduced from 3/wk to 1/wk per the 2026-08-07 rules update (see
  // docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md).
  // No preferredDays — load-balanced across the week, same as cg's 1/wk.
  wo: { postsPerWeek: 1 },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/scheduler/schedulerEngine.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full scheduler test directory to catch any other WO-day assumptions**

Run: `npx vitest run src/lib/scheduler/`
Expected: PASS — if any other test elsewhere assumed WO's 3 fixed days, fix its assertion the same way (assert count/load-balancing, not fixed days) before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/schedulerRules.ts src/lib/scheduler/schedulerEngine.test.ts
git commit -m "feat(scheduler): reduce Wizard of Odds to 1 post/week"
```

---

### Task 5: Success-rate pause check — monthly window instead of all-time

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts`
- Modify: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes: `resolvePreset` is NOT reused directly (it defaults to real wall-clock `now`, which would make tests non-deterministic and would be semantically wrong for a past/future `weekStart`) — instead a new local `monthToDateRange(weekStartISO): DateRange` derives the month from `weekStart` itself, the same pattern `shiftWeek` in this file already uses to parse an ISO date string into a local `Date`.
- Produces: `computeSuccessRates(ctx.entries, platform, new Set(), monthToDateRange(weekStart))` replaces today's `computeSuccessRates(ctx.entries, platform)` call inside `recalculatePauses`. Reason string changes from `` `Success rate below ${threshold}% (${pct}% over ${decided} posts)` `` to `` `Success rate below ${threshold}% this month (${pct}% over ${decided} posts)` ``.

- [ ] **Step 1: Update the existing success-rate tests to use dates within the month-to-date window**

In `src/lib/scheduler/schedulerService.test.ts`, replace the entire `describe('success-rate trigger', ...)` block (the one starting at the existing line ~152) with:

```typescript
  describe('success-rate trigger (monthly window)', () => {
    it('pauses a brand+platform whose current-month-to-date success rate is below 40% with at least 5 decided posts', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // Most recent post is Published, so the consecutive-removed check
          // (top 2 by date) never fires here — isolates the success-rate path.
          // weekStart below is 2026-08-17, so the month-to-date window is
          // Aug 1-17 -- every date here falls inside it.
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-17', 'Success rate below 40% this month (20% over 5 posts)', undefined,
      );
    });

    it('does not pause on a low current-month rate with fewer than 5 decided posts', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('does not pause at exactly 40% (boundary is strictly-below)', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('prefers the consecutive-removed reason when both triggers are true at once', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // Top 2 most recent are both Removed (fires consecutive-removed)
          // AND the month-to-date rate is 1/5 = 20% (would also fire
          // success-rate) -- only one pause row/reason should result.
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-17', 'Two consecutive Removed/Refused posts', undefined,
      );
    });

    it('does not insert a success-rate pause for a combo that already has a row for the week', async () => {
      queries.fetchBrandSchedule.mockResolvedValue([
        { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-17', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      ]);
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('merges success rates across different brand casings within the month window', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'winmega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'winmega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'winmega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      // 2 live + 3 removed = 5 decided, rate exactly 40% -> no pause (boundary)
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('does not pause when the all-time rate is low but the current-month rate is at or above 40%', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // 10 old, out-of-window (July) Removed posts -- would tank an
          // all-time rate, but must be excluded entirely from the month-to-
          // date window (Aug 1-17).
          ...Array.from({ length: 10 }, (_, i) =>
            entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': `2026-07-${String(i + 1).padStart(2, '0')}` })),
          // This month: 4 live + 1 removed = 5 decided, 80% -- top 2 by date
          // (Aug16, Aug14) are both Published, so consecutive-removed doesn't fire either.
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('pauses when the current-month rate is low even though the all-time rate looks fine', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // 10 old, out-of-window (July) Published posts -- would make an
          // all-time rate look healthy, but must be excluded from the
          // month-to-date window.
          ...Array.from({ length: 10 }, (_, i) =>
            entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': `2026-07-${String(i + 1).padStart(2, '0')}` })),
          // This month: 1 live + 4 removed = 5 decided, 20% -- top 2 by date
          // (Aug16 Published, Aug14 Removed) are not both removed, so this
          // isolates the success-rate trigger from consecutive-removed.
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-16' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-14' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-12' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-10' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-08' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-17', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-17', 'Success rate below 40% this month (20% over 5 posts)', undefined,
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: FAIL — `recalculatePauses` still computes an all-time rate, so the new/updated assertions (dated in August, or explicitly proving month-vs-all-time) don't match.

- [ ] **Step 3: Add `monthToDateRange` and wire it into the rate computation**

In `src/lib/scheduler/schedulerService.ts`, update the import from `../scoreSummary.ts` to also bring in `type DateRange`:

```typescript
import {
  PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, parsePostDate,
  computeSuccessRates, successRatePct, type SuccessRate, type DateRange,
} from '../scoreSummary.ts';
```

Add this function directly above `recalculatePauses` (near `shiftWeek`, which already parses an ISO date string the same way):

```typescript
// The success-rate pause check uses the calendar month containing
// `weekStart`, not real wall-clock "now" -- recalculatePauses is only ever
// invoked for the actual current week in production (both call sites gate
// on that), so this is equivalent to "this month" there, while also making
// the check deterministic for a fixed weekStart in tests, and correct if
// this is ever invoked for a non-current week. Parses weekStart as a local
// date the same way shiftWeek below does, to avoid the UTC-conversion bug
// documented on toISODate in scheduleBrands.ts.
function monthToDateRange(weekStart: string): DateRange {
  const [y, m, d] = weekStart.split('-').map(Number);
  return { from: new Date(y, m - 1, 1), to: new Date(y, m - 1, d) };
}
```

Update the `ratesByPlatform` computation inside `recalculatePauses` from:

```typescript
  const ratesByPlatform = new Map(
    ctx.activePlatforms.map((platform) => [platform, normalizedRates(computeSuccessRates(ctx.entries, platform), tab)]),
  );
```

to:

```typescript
  const monthRange = monthToDateRange(weekStart);
  const ratesByPlatform = new Map(
    ctx.activePlatforms.map((platform) => [platform, normalizedRates(computeSuccessRates(ctx.entries, platform, new Set(), monthRange), tab)]),
  );
```

Update the pause-reason message inside the `lowSuccessRate` branch from:

```typescript
          `Success rate below ${PAUSE_RULES.successRateThreshold}% (${pct}% over ${decided} posts)`,
```

to:

```typescript
          `Success rate below ${PAUSE_RULES.successRateThreshold}% this month (${pct}% over ${decided} posts)`,
```

- [ ] **Step 4: Update `PAUSE_RULES`'s doc comment**

In `src/lib/scheduler/schedulerRules.ts`, replace the `PAUSE_RULES.successRateThreshold` comment block's opening lines (the ones describing "all-time, unwindowed rate") with:

```typescript
  // A brand+platform combo also pauses when its CURRENT-MONTH-TO-DATE
  // success rate (see computeSuccessRates in scoreSummary.ts, called with a
  // month-to-date DateRange from recalculatePauses in schedulerService.ts)
  // is strictly below this percentage, once it has at least
  // minDecidedPostsForRateCheck decided (live+removed) posts within that
  // window. Independent of, and lower-priority than, the
  // consecutiveRemovedThreshold rule above and the flagged-via-email check
  // -- see recalculatePauses in schedulerService.ts. Changed from an
  // all-time to a monthly window 2026-08-07 (see
  // docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md)
  // -- this was the previously-known-broken all-time oscillation issue's
  // fix, not a new one being introduced.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: PASS (all tests, including the 2 new monthly-vs-all-time tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts src/lib/scheduler/schedulerRules.ts
git commit -m "feat(scheduler): switch success-rate pause check to a calendar-month-to-date window"
```

---

### Task 6: Flagged-via-email pause trigger

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts`
- Modify: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes: `platformFlaggedKey` from `../flaggedPlatformBrands.ts` (Task 2).
- Produces: `TabContext` gains `flaggedPlatformBrandSet?: Set<string>`. When a brand+platform's key is in that set, `recalculatePauses` inserts a pause with reason `'Flagged via email notification'`, checked before the consecutive-removed and success-rate triggers.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduler/schedulerService.test.ts`, add the import:

```typescript
import { platformFlaggedKey } from '../flaggedPlatformBrands';
```

Add a new `describe` block (after the `success-rate trigger` block, still inside `describe('recalculatePauses', ...)`):

```typescript
  describe('flagged-via-email trigger', () => {
    it('pauses a brand+platform flagged via email even with a healthy record', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' }),
        ],
        flaggedPlatformBrandSet: new Set([platformFlaggedKey('BITP', 'WinMega', 'tp')]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Flagged via email notification', undefined,
      );
    });

    it('does not pause a brand+platform absent from the flagged set', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' })],
        flaggedPlatformBrandSet: new Set([platformFlaggedKey('BITP', 'SomeoneElse', 'tp')]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('does not insert a flagged-via-email pause for a combo that already has a row for the week', async () => {
      queries.fetchBrandSchedule.mockResolvedValue([
        { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-03', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      ]);
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [],
        flaggedPlatformBrandSet: new Set([platformFlaggedKey('BITP', 'WinMega', 'tp')]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('prefers the flagged-via-email reason over consecutive-removed when both apply', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        ],
        flaggedPlatformBrandSet: new Set([platformFlaggedKey('BITP', 'WinMega', 'tp')]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Flagged via email notification', undefined,
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: FAIL — `TabContext` has no `flaggedPlatformBrandSet` field yet and nothing checks it.

- [ ] **Step 3: Wire the check into `recalculatePauses`**

In `src/lib/scheduler/schedulerService.ts`, add the import:

```typescript
import { platformFlaggedKey } from '../flaggedPlatformBrands.ts';
```

Extend the `TabContext` interface:

```typescript
export interface TabContext {
  brands: string[];
  activePlatforms: Platform[];
  entries: Entry[];
  removedPlatformBrandSet?: Set<string>;
  // Every (tab, brand, platform) manually flagged via the "flagged via
  // email" toggle -- a third OR-condition in the automatic pause check,
  // alongside two-consecutive-removed and the monthly success-rate
  // threshold. Optional, same "defaults to nothing flagged" convention as
  // removedPlatformBrandSet.
  flaggedPlatformBrandSet?: Set<string>;
}
```

Inside the `for (const platform of ctx.activePlatforms)` loop, add the `flaggedSet` lookup near the top of `recalculatePauses` (alongside the existing `removedSet` line):

```typescript
  const removedSet = ctx.removedPlatformBrandSet ?? new Set<string>();
  const flaggedSet = ctx.flaggedPlatformBrandSet ?? new Set<string>();
```

Insert the flagged check immediately after the existing `alreadyHasRow` guard, before the consecutive-removed check:

```typescript
      const alreadyHasRow = existingRows.some((r) => r.platform === platform && r.brand_key === brandKey);
      if (alreadyHasRow) continue;

      // Highest-priority automatic trigger -- an explicit, human-verified
      // email notification outranks the inferred consecutive-removed and
      // success-rate signals below.
      if (flaggedSet.has(platformFlaggedKey(tab, brand, platform))) {
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, 'Flagged via email notification', client);
        continue;
      }

      const recent = recentStatusesFor(ctx.entries, brandKey, platform).slice(0, 2);
```

(The rest of the loop — consecutive-removed then success-rate — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
git commit -m "feat(scheduler): add flagged-via-email pause trigger"
```

---

### Task 7: Manual override (pause / force-active) precedence

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts`
- Modify: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes: `overrideKey`, `type OverrideState` from `../scheduleOverrides.ts` (Task 2).
- Produces: `TabContext` gains `overrideMap?: Map<string, OverrideState>`. Checked immediately after the removed-platform skip and before every automatic trigger (flagged/consecutive-removed/success-rate). `'active'` deletes any existing pause for that combo and reports it in the returned `resumed` list; `'pause'` unconditionally upserts a pause row with reason `'Manually paused'`, bypassing the `alreadyHasRow` guard (a deliberate deviation — see Step 3's comment).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduler/schedulerService.test.ts`:

```typescript
import { overrideKey } from '../scheduleOverrides';
```

```typescript
  describe('manual override', () => {
    it("override 'active' clears an existing pause, reports it resumed, and skips auto-detection even with two consecutive removed posts", async () => {
      queries.fetchActiveBrandPlatformPauses.mockResolvedValue([
        { tab: 'BITP', brand_key: 'winmega', platform: 'tp', paused_week_start: '2026-08-03', reason: 'Two consecutive Removed/Refused posts' },
      ]);
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        ],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'active']]),
      };
      const resumed = await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.deleteBrandPlatformPause).toHaveBeenCalledWith('BITP', 'winmega', 'tp', undefined);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
      expect(resumed).toEqual([{ brandKey: 'winmega', platform: 'tp' }]);
    });

    it("override 'active' with no existing pause is a no-op that skips auto-detection", async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        ],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'active']]),
      };
      const resumed = await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.deleteBrandPlatformPause).not.toHaveBeenCalled();
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
      expect(resumed).toEqual([]);
    });

    it("override 'pause' unconditionally pauses even with a perfect record", async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' })],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'pause']]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Manually paused', undefined,
      );
    });

    it("override 'pause' bypasses the already-has-a-row-for-the-week guard (unlike auto-detection)", async () => {
      queries.fetchBrandSchedule.mockResolvedValue([
        { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-03', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      ]);
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'pause']]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Manually paused', undefined,
      );
    });

    it('a removed-platform-flagged combo is skipped even when it has an active override', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [],
        removedPlatformBrandSet: new Set([platformRemovedKey('BITP', 'WinMega', 'tp')]),
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'pause']]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
      expect(queries.deleteBrandPlatformPause).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: FAIL — `TabContext` has no `overrideMap` field yet.

- [ ] **Step 3: Wire override precedence into `recalculatePauses`**

In `src/lib/scheduler/schedulerService.ts`, add the import:

```typescript
import { overrideKey, type OverrideState } from '../scheduleOverrides.ts';
```

Extend `TabContext` again:

```typescript
  // Every (tab, brand_key, platform) with a manually-set override, beating
  // whatever the automatic checks below would otherwise compute. 'active'
  // forces continued posting (deletes/skips any pause); 'pause' forces a
  // pause unconditionally. Optional, same "defaults to nothing overridden"
  // convention as the other two sets.
  overrideMap?: Map<string, OverrideState>;
```

Add the `overrideMap` lookup alongside `removedSet`/`flaggedSet`:

```typescript
  const overrideMap = ctx.overrideMap ?? new Map<string, OverrideState>();
```

Insert the override check immediately after the `removedSet` skip, before the existing `const existing = pauses.find(...)` line:

```typescript
      if (removedSet.has(platformRemovedKey(tab, brand, platform))) continue;

      // Manual override beats every automatic check below -- checked before
      // the existing/alreadyHasRow/flagged/consecutive-removed/success-rate
      // chain entirely, not merged into it, since it's an explicit operator
      // decision rather than a background computation. 'pause' deliberately
      // does NOT respect the alreadyHasRow guard the auto path uses below
      // (that guard exists to protect the auto-detection heuristic from a
      // race with a week that's already been generated; a manual override
      // is an intentional action that should always take effect, even for
      // an already-generated week -- the pause row's mere existence dims
      // that week's cells regardless of whether brand_schedule already has
      // a row for it).
      const override = overrideMap.get(overrideKey(tab, brandKey, platform));
      const existingPause = pauses.find((p) => p.brand_key === brandKey && p.platform === platform);
      if (override === 'active') {
        if (existingPause) {
          await deleteBrandPlatformPause(tab, brandKey, platform, client);
          resumed.push({ brandKey, platform });
        }
        continue;
      }
      if (override === 'pause') {
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, 'Manually paused', client);
        continue;
      }

      const existing = pauses.find((p) => p.brand_key === brandKey && p.platform === platform);
```

(`existing` is now computed twice under a no-override combo — once as `existingPause` for the override check, once as `existing` for the pre-existing auto-resume logic right below. This is deliberate: `existingPause`/`existing` are logically the same lookup, but keeping them as two separate `const`s scoped to their own branches avoids threading one variable through both the new override branch and the pre-existing code below it, which stays untouched from here on.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: PASS (full file — this task's 5 new tests plus every pre-existing test in the file, none of which pass an `overrideMap`, so they all take the untouched "no override" path)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
git commit -m "feat(scheduler): add manual pause/force-active override, taking precedence over auto-detection"
```

---

### Task 8: Wire the new context fields into the Monday cron Edge Function

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts`
- Modify: `supabase/functions/generate-weekly-schedule/index_test.ts`

**Interfaces:**
- Consumes: `fetchFlaggedPlatformBrands`, `fetchBrandPlatformOverrides` (Task 3); `buildFlaggedPlatformBrandSet` (Task 2); `buildOverrideMap` (Task 2).
- Produces: `buildTabContext` now also populates `flaggedPlatformBrandSet` and `overrideMap` on the returned `TabContext`.

- [ ] **Step 1: Update the failing tests**

In `supabase/functions/generate-weekly-schedule/index_test.ts`, add `flagged_platform_brands` and `brand_platform_override` to each existing `fakeClient({...})` call's table map (both empty arrays, matching how `removed_platform_brands: []` is already listed), then add:

```typescript
Deno.test('buildTabContext populates flaggedPlatformBrandSet and overrideMap from their tables', async () => {
  const client = fakeClient({
    entries: [entry('Hanan', '1', { Brands: 'WinMega' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    flagged_platform_brands: [{ tab: 'Hanan', brand: 'WinMega', platform: 'tp' }],
    brand_platform_override: [{ tab: 'Hanan', brand_key: 'winmega', platform: 'tp', override_state: 'pause' }],
  });
  const ctx = await buildTabContext('Hanan', client);
  assertEquals(ctx.flaggedPlatformBrandSet?.size, 1);
  assertEquals(ctx.overrideMap?.get('Hanan::winmega::tp'), 'pause');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: FAIL — `buildTabContext`'s returned context has no `flaggedPlatformBrandSet`/`overrideMap` yet.

- [ ] **Step 3: Update `buildTabContext`**

In `supabase/functions/generate-weekly-schedule/index.ts`, update the imports:

```typescript
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchFlaggedPlatformBrands, fetchBrandPlatformOverrides, invalidateTabCache } from '../../../src/lib/queries.ts';
import { buildRemovedPlatformBrandSet, type Platform } from '../../../src/lib/removedPlatformBrands.ts';
import { buildFlaggedPlatformBrandSet } from '../../../src/lib/flaggedPlatformBrands.ts';
import { buildOverrideMap } from '../../../src/lib/scheduleOverrides.ts';
```

Update `buildTabContext`:

```typescript
export async function buildTabContext(tab: string, client: SupabaseClient): Promise<TabContext> {
  const [rawEntries, headers, removedPlatformBrandRows, flaggedPlatformBrandRows, overrideRows] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchTabHeaders(tab, client),
    fetchRemovedPlatformBrands(client),
    fetchFlaggedPlatformBrands(client),
    fetchBrandPlatformOverrides(tab, client),
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
    flaggedPlatformBrandSet: buildFlaggedPlatformBrandSet(
      flaggedPlatformBrandRows as { tab: string; brand: string; platform: Platform }[],
    ),
    overrideMap: buildOverrideMap(overrideRows),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-all supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts supabase/functions/generate-weekly-schedule/index_test.ts
git commit -m "feat(generate-weekly-schedule): wire flagged/override tables into TabContext"
```

---

### Task 9: Wire the new context fields into the Schedule Planner page

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- Consumes: `fetchFlaggedPlatformBrands`, `fetchBrandPlatformOverrides` (Task 3); `buildFlaggedPlatformBrandSet`, `buildOverrideMap` (Task 2).
- Produces: the page's `tabCtx` state gains `flaggedPlatformBrandSet: Set<string>` and `overrideMap: Map<string, OverrideState>`, threaded into the `TabContext` passed to `recalculatePauses`/`ensureWeekGenerated` exactly like `removedPlatformBrandSet` already is.

This page has no dedicated unit-test file (page-level component, consistent with how this codebase's other Schedule Planner UI wiring has historically only been live-verified against a real logged-in session, e.g. Tasks 164-171 in `docs/task-history.md`) — Step 4 below is a manual verification, not an automated test.

- [ ] **Step 1: Import the new fetchers/builders**

In `src/pages/SchedulePlanner.tsx`, update the `queries` import to add `fetchFlaggedPlatformBrands, fetchBrandPlatformOverrides`, and add:

```typescript
import { buildFlaggedPlatformBrandSet } from '../lib/flaggedPlatformBrands';
import { buildOverrideMap, type OverrideState } from '../lib/scheduleOverrides';
```

- [ ] **Step 2: Extend `tabCtx` state and its loading effect**

Update the `tabCtx` state type (currently `{ tab: string; brands: string[]; activePlatforms: Platform[]; entries: Entry[]; removedPlatformBrandSet: Set<string> }`):

```typescript
  const [tabCtx, setTabCtx] = useState<{
    tab: string;
    brands: string[];
    activePlatforms: Platform[];
    entries: Entry[];
    removedPlatformBrandSet: Set<string>;
    flaggedPlatformBrandSet: Set<string>;
    overrideMap: Map<string, OverrideState>;
  } | null>(null);
```

In the brand-loading effect, extend the `Promise.all` (currently fetching `rawEntries, headers, removedPlatformBrandRows`):

```typescript
        const [rawEntries, headers, removedPlatformBrandRows, flaggedPlatformBrandRows, overrideRows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          fetchRemovedPlatformBrands().catch(() => [] as { tab: string; brand: string; platform: Platform }[]),
          fetchFlaggedPlatformBrands().catch(() => [] as { tab: string; brand: string; platform: Platform }[]),
          fetchBrandPlatformOverrides(tab).catch(() => []),
        ]);
```

and extend the `setTabCtx` call:

```typescript
        setTabCtx({
          tab,
          brands: uniqueBrands,
          activePlatforms: platforms,
          entries: rawEntries,
          removedPlatformBrandSet: buildRemovedPlatformBrandSet(removedPlatformBrandRows),
          flaggedPlatformBrandSet: buildFlaggedPlatformBrandSet(flaggedPlatformBrandRows),
          overrideMap: buildOverrideMap(overrideRows),
        });
```

- [ ] **Step 3: Thread the two new fields into the scheduler-invocation `ctx`**

In the schedule-loading effect, update the `ctx: TabContext` object literal (currently `brands`, `activePlatforms`, `entries`, `removedPlatformBrandSet`):

```typescript
          const ctx: TabContext = {
            brands: tabCtx!.brands,
            activePlatforms: tabCtx!.activePlatforms,
            entries: tabCtx!.entries,
            removedPlatformBrandSet: tabCtx!.removedPlatformBrandSet,
            flaggedPlatformBrandSet: tabCtx!.flaggedPlatformBrandSet,
            overrideMap: tabCtx!.overrideMap,
          };
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, log in, open Schedule Planner, select a tab with an active week (current Monday-Friday). Confirm the page loads without console errors or a regression in the existing pause/chip display (no visible behavior change is expected yet from this task alone — the flagged/override tables are empty until Task 11 ships a way to write to them; this step only confirms the new fetches don't break the page).

- [ ] **Step 5: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat(schedule-planner): wire flagged/override tables into the page's TabContext"
```

---

### Task 10: Edit Entry modal — "flagged via email" checkbox and scheduling-override select

**Files:**
- Modify: `src/components/EditEntryModal.tsx`

**Interfaces:**
- Consumes: `PLATFORM_LABEL`, `type Platform` (already imported from `../lib/scoreSummary`).
- Produces: `EditEntryModal`'s `Props` gains `initialFlaggedPlatforms?: Platform[]` and `initialOverrides?: Partial<Record<Platform, 'pause' | 'active'>>`; `onSave`'s signature gains two trailing params: `flaggedPlatforms?: Platform[], overrides?: Partial<Record<Platform, 'pause' | 'active'>>`. Task 11 supplies these props and reads the two new `onSave` params.

- [ ] **Step 1: Extend `Props` and add the new state**

In `src/components/EditEntryModal.tsx`, update the `Props` interface:

```typescript
interface Props {
  entry: Entry;
  headers: string[];
  onClose: () => void;
  onSave: (
    fields: Record<string, string | null>,
    newTab?: string,
    removedPlatforms?: Platform[],
    flaggedPlatforms?: Platform[],
    overrides?: Partial<Record<Platform, 'pause' | 'active'>>,
  ) => Promise<void>;
  currentTab?: string;
  availableBrands?: string[];
  brandCol?: string | null;
  brandProfiles?: Record<string, Record<string, string>>;
  initialRemovedPlatforms?: Platform[];
  initialFlaggedPlatforms?: Platform[];
  initialOverrides?: Partial<Record<Platform, 'pause' | 'active'>>;
}
```

Update the component signature and add state, directly after the existing `removedPlatforms` state line:

```typescript
export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles, initialRemovedPlatforms, initialFlaggedPlatforms, initialOverrides }: Props) {
  const [removedPlatforms, setRemovedPlatforms] = useState<Set<Platform>>(new Set(initialRemovedPlatforms ?? []));
  const [flaggedPlatforms, setFlaggedPlatforms] = useState<Set<Platform>>(new Set(initialFlaggedPlatforms ?? []));
  const [overrides, setOverrides] = useState<Partial<Record<Platform, 'pause' | 'active'>>>(initialOverrides ?? {});
  const tabPlatforms = currentTab ? getTabPlatforms(currentTab) : [];
```

- [ ] **Step 2: Pass the new state through `handleSave`**

Update `handleSave`'s `onSave` call:

```typescript
      await onSave(out, tabChanged, [...removedPlatforms], [...flaggedPlatforms], overrides);
```

- [ ] **Step 3: Render the new controls**

In the JSX, immediately after the existing `{tabPlatforms.map((p) => ( <label>... page removed ...</label> ))}` block (still inside the same `col-span-2 ... sm:col-span-6` wrapper `div`), add:

```typescript
                  {tabPlatforms.map((p) => (
                    <label key={`flag-${p}`} className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                      <input
                        type="checkbox"
                        checked={flaggedPlatforms.has(p)}
                        disabled={saving}
                        onChange={(e) =>
                          setFlaggedPlatforms((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p); else next.delete(p);
                            return next;
                          })
                        }
                        className="rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                      />
                      {PLATFORM_LABEL[p]} flagged via email
                    </label>
                  ))}
                  {tabPlatforms.map((p) => (
                    <label key={`override-${p}`} className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                      {PLATFORM_LABEL[p]} scheduling:
                      <select
                        value={overrides[p] ?? 'auto'}
                        disabled={saving}
                        onChange={(e) => {
                          const v = e.target.value as 'auto' | 'pause' | 'active';
                          setOverrides((prev) => {
                            const next = { ...prev };
                            if (v === 'auto') delete next[p]; else next[p] = v;
                            return next;
                          });
                        }}
                        className="rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50"
                      >
                        <option value="auto">Auto</option>
                        <option value="pause">Force Paused</option>
                        <option value="active">Force Active</option>
                      </select>
                    </label>
                  ))}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "feat(edit-entry-modal): add flagged-via-email checkbox and scheduling override select"
```

---

### Task 11: Wire the two new controls into BrandGroup.tsx's save path

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `EditEntryModal`'s extended `Props`/`onSave` signature (Task 10); `fetchFlaggedPlatformBrands`, `setBrandPlatformFlagged`, `fetchBrandPlatformOverrides`, `setBrandPlatformOverride`, `clearBrandPlatformOverride` (Task 3); `platformFlaggedKey`, `buildFlaggedPlatformBrandSet` (Task 2); `overrideKey` (Task 2, for reading back current overrides).

- [ ] **Step 1: Fetch flagged/override rows alongside the existing removed-platform fetch**

In `src/pages/BrandGroup.tsx`, update the import line that currently pulls in `fetchRemovedPlatformBrands, setBrandPlatformRemoved`:

```typescript
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, triggerAgStatusCheck, triggerCgStatusCheck, triggerWoStatusCheck, insertEntry, deleteEntries, moveEntryToTab, fetchRemovedPlatformBrands, setBrandPlatformRemoved, fetchFlaggedPlatformBrands, setBrandPlatformFlagged, fetchBrandPlatformOverrides, setBrandPlatformOverride, clearBrandPlatformOverride, fetchAllEntries, type StatusCheckScope } from '../lib/queries';
import { platformRemovedKey, buildRemovedPlatformBrandSet } from '../lib/removedPlatformBrands';
import { platformFlaggedKey, buildFlaggedPlatformBrandSet } from '../lib/flaggedPlatformBrands';
import { overrideKey, buildOverrideMap, type OverrideState } from '../lib/scheduleOverrides';
```

Add new state, directly after the existing `removedPlatformBrandRows` state line:

```typescript
  const [removedPlatformBrandRows, setRemovedPlatformBrandRows] = useState<{ tab: string; brand: string; platform: Platform }[]>([]);
  const [flaggedPlatformBrandRows, setFlaggedPlatformBrandRows] = useState<{ tab: string; brand: string; platform: Platform }[]>([]);
  const [overrideRows, setOverrideRows] = useState<{ tab: string; brand_key: string; platform: Platform; override_state: OverrideState }[]>([]);
```

Extend the existing fetch effect (currently only calling `fetchRemovedPlatformBrands()`):

```typescript
  useEffect(() => {
    let canceled = false;
    fetchRemovedPlatformBrands()
      .then((rows) => { if (!canceled) setRemovedPlatformBrandRows(rows); })
      .catch(() => { /* badge is decorative -- a failed fetch just means no badges render */ });
    fetchFlaggedPlatformBrands()
      .then((rows) => { if (!canceled) setFlaggedPlatformBrandRows(rows); })
      .catch(() => { /* same -- decorative */ });
    fetchBrandPlatformOverrides(decodedTab)
      .then((rows) => { if (!canceled) setOverrideRows(rows); })
      .catch(() => { /* same -- decorative */ });
    return () => { canceled = true; };
  }, [reloadSeq, decodedTab]);
```

- [ ] **Step 2: Add the derived lookups, mirroring `removedPlatformBrandSet`/`removedPlatformsFor`**

Directly after the existing `removedPlatformBrandSet`/`isPlatformRemoved`/`removedPlatformsFor` block:

```typescript
  const flaggedPlatformBrandSet = useMemo(() => buildFlaggedPlatformBrandSet(flaggedPlatformBrandRows), [flaggedPlatformBrandRows]);
  function isPlatformFlagged(brandName: string | null | undefined, platform: Platform): boolean {
    return !!brandName && flaggedPlatformBrandSet.has(platformFlaggedKey(decodedTab, brandName, platform));
  }
  function flaggedPlatformsFor(brandName: string | null | undefined): Platform[] {
    if (!brandName) return [];
    return getTabPlatforms(decodedTab).filter((p) => isPlatformFlagged(brandName, p));
  }

  const overrideMap = useMemo(() => buildOverrideMap(overrideRows), [overrideRows]);
  function overridesFor(brandName: string | null | undefined): Partial<Record<Platform, OverrideState>> {
    if (!brandName) return {};
    const brandKey = normalizeBrandKey(brandName);
    const out: Partial<Record<Platform, OverrideState>> = {};
    for (const p of getTabPlatforms(decodedTab)) {
      const state = overrideMap.get(overrideKey(decodedTab, brandKey, p));
      if (state) out[p] = state;
    }
    return out;
  }
```

(`normalizeBrandKey` is already imported in this file via the existing `removedPlatformBrands` import — reuse it, don't re-import.)

- [ ] **Step 3: Compute the modal's initial props**

Directly after the existing `initialRemovedPlatformsForEditEntry` constant:

```typescript
  const initialFlaggedPlatformsForEditEntry: Platform[] =
    editEntry && brandCol ? flaggedPlatformsFor(editEntry.data[brandCol]) : [];
  const initialOverridesForEditEntry: Partial<Record<Platform, OverrideState>> =
    editEntry && brandCol ? overridesFor(editEntry.data[brandCol]) : {};
```

- [ ] **Step 4: Pass the new props and handle the new `onSave` params**

Update the `<EditEntryModal>` usage: add `initialFlaggedPlatforms={initialFlaggedPlatformsForEditEntry}` and `initialOverrides={initialOverridesForEditEntry}` alongside the existing `initialRemovedPlatforms={initialRemovedPlatformsForEditEntry}` prop.

Update the `onSave` handler's signature and body — it currently reads `async (fields, newTab, removedPlatforms) => { ... }`:

```typescript
          onSave={async (fields, newTab, removedPlatforms, flaggedPlatforms, overrides) => {
            if (newTab && newTab !== editEntry.tab) {
              await moveEntryToTab(editEntry.id, editEntry.tab, newTab);
            }
            await updateEntryData(editEntry.id, newTab ?? editEntry.tab, fields);
            setEntries((prev) =>
              prev.map((e) => (e.id === editEntry.id ? { ...e, data: { ...e.data, ...fields }, tab: newTab ?? e.tab } : e)),
            );
            if (brandCol && removedPlatforms !== undefined) {
              const targetTab = newTab ?? editEntry.tab;
              const brandName = fields[brandCol] ?? editEntry.data[brandCol];
              if (brandName) {
                const wasRemoved = new Set(initialRemovedPlatformsForEditEntry);
                const nowRemoved = new Set(removedPlatforms);
                for (const p of getTabPlatforms(decodedTab)) {
                  if (wasRemoved.has(p) !== nowRemoved.has(p)) {
                    await setBrandPlatformRemoved(targetTab, brandName, p, nowRemoved.has(p));
                  }
                }

                // Same diff-and-write-only-what-changed pattern as removedPlatforms
                // above -- avoids re-firing flagged_by/flagged_at (or set_by/
                // created_at) on every routine save of an already-flagged/
                // overridden brand's row.
                if (flaggedPlatforms !== undefined) {
                  const wasFlagged = new Set(initialFlaggedPlatformsForEditEntry);
                  const nowFlagged = new Set(flaggedPlatforms);
                  for (const p of getTabPlatforms(decodedTab)) {
                    if (wasFlagged.has(p) !== nowFlagged.has(p)) {
                      await setBrandPlatformFlagged(targetTab, brandName, p, nowFlagged.has(p));
                    }
                  }
                }
                if (overrides !== undefined) {
                  for (const p of getTabPlatforms(decodedTab)) {
                    const was = initialOverridesForEditEntry[p];
                    const now = overrides[p];
                    if (was === now) continue;
                    if (now === undefined) {
                      await clearBrandPlatformOverride(targetTab, normalizeBrandKey(brandName), p);
                    } else {
                      await setBrandPlatformOverride(targetTab, brandName, p, now);
                    }
                  }
                }
              }
            }
            reloadRef.current();
          }}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, log in, open a multi-platform brand tab (e.g. Rooster Partners), open Edit Entry on a row. Confirm the new "flagged via email" checkboxes and "scheduling" selects render per active platform, toggling and saving persists (reload the page and reopen the same entry to confirm the checked/selected state survived), and the existing "page removed" checkboxes still work unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat(brand-group): wire flagged-via-email and scheduling-override controls into Edit Entry save"
```

---

### Task 12: Pause tooltip wording — don't imply auto-resume for a manual override

**Files:**
- Modify: `src/lib/scheduler/calendarRenderer.tsx`

**Interfaces:**
- Consumes: `BrandPlatformPause` (already imported).

`PausedPlatformIndicator`'s tooltip currently always reads `` `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}` ``. A manually-paused or flagged-via-email row has its `paused_week_start` re-upserted to the current week on every `recalculatePauses` run for as long as the override/flag stays set (Tasks 6/7) — it does not actually auto-resume next week the way a real auto-detected pause does, so the "Resumes week of ..." line would be misleading for those two reasons specifically.

- [ ] **Step 1: Read the current implementation**

`src/lib/scheduler/calendarRenderer.tsx` around `PausedPlatformIndicator` (~line 155-168) currently:

```typescript
export function PausedPlatformIndicator({ platform, pause }: PausedPlatformIndicatorProps) {
  return (
    <div
      ...
      title={`Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`}
      ...
    >
      ...
      Paused
    </div>
  );
}
```

- [ ] **Step 2: Update the tooltip to skip the resume line for manually-driven reasons**

```typescript
export function PausedPlatformIndicator({ platform, pause }: PausedPlatformIndicatorProps) {
  // "Manually paused" (Task 7) and "Flagged via email notification" (Task 6)
  // both persist for as long as the override/flag stays set -- their
  // paused_week_start gets re-upserted to the current week on every
  // recalculatePauses run, so unlike a real auto-detected pause they don't
  // actually auto-resume next week. Showing "Resumes week of ..." for them
  // would be misleading.
  const autoExpires = pause.reason !== 'Manually paused' && pause.reason !== 'Flagged via email notification';
  const title = autoExpires
    ? `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`
    : `Reason: ${pause.reason}\nStays paused until manually cleared`;
  return (
    <div
      ...
      title={title}
      ...
    >
      ...
      Paused
    </div>
  );
}
```

(Keep every other prop/className/JSX child in the existing function exactly as-is — only the `title` computation changes.)

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scheduler/calendarRenderer.tsx
git commit -m "fix(schedule-planner): don't imply auto-resume in the tooltip for manually-driven pauses"
```

---

### Task 13: Full verification and task-history entry

**Files:**
- Modify: `docs/task-history.md`

- [ ] **Step 1: Run the full frontend test suite**

Run: `npx vitest run`
Expected: PASS, no regressions (existing suite was at 273 tests before this plan; expect that plus every new test added across Tasks 2-9 above).

- [ ] **Step 2: Run the Edge Function's Deno test suite**

Run: `deno test --allow-all supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: PASS.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (per `[[feedback_verify_with_npm_build]]` — `tsc --noEmit` alone doesn't check this repo's root tsconfig).

- [ ] **Step 4: Append a task-history.md entry**

Add a new `## Task <next-number>: ...` entry to `docs/task-history.md` (check the file's last task number first) summarizing: WO 3/wk → 1/wk, monthly (not all-time) success-rate pause window, new flagged-via-email trigger, new manual pause/force-active override with its own two new tables, and the two new Edit Entry modal controls — following this file's existing entry format (see any recent entry for the expected level of detail).

- [ ] **Step 5: Commit**

```bash
git add docs/task-history.md
git commit -m "docs: record Schedule Planner rules update task"
```
