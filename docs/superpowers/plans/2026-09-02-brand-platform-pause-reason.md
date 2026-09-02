# Brand+Platform Pause: Reason, Duration, and a Discoverable Summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user durably pause a brand on one or more platforms — permanently or until a chosen date — with a required reason, from the Schedule Planner itself, and make every currently-active pause (manual or auto-detected) visible in one discoverable list.

**Architecture:** Extend the existing `brand_platform_override` table (the only pause mechanism that already persists across weeks) with `reason`/`resume_at`. Thread the custom reason into the `brand_platform_pause` row `recalculatePauses` already writes, and teach that same function to auto-expire a periodic override. Fix two pre-existing "is this override-driven" checks that string-match a hardcoded reason (would silently misfire the moment reasons become custom text). Add two new Schedule Planner modals wired into `TabScheduleSection.tsx`.

**Tech Stack:** React + TypeScript, Supabase (Postgres + RLS), Vitest, Deno (edge function tests).

**Spec:** `docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md`

## Global Constraints

- `resume_at` auto-expiry is **week-granular**, matching every other pause-lifecycle check in `schedulerService.ts` — a resume date is treated as "passed" once it falls on or before the Sunday of the week being evaluated (`weekStart + 6 days`), not compared day-for-day.
- Reason is required (client-side, in the new modal) only when a save adds at least one *newly* checked platform — never required for a save that only clears/unchecks.
- The Edit Entry modal's existing "Force Paused/Force Active" dropdown (`EditEntryModal.tsx`, `BrandGroup.tsx`) is **not touched** — it keeps calling `setBrandPlatformOverride` with no reason/duration, by explicit user decision.
- `paused_tabs.paused_until` (a different, unrelated whole-tab-pause feature) is explicitly informational and does not auto-clear — do not make `brand_platform_override.resume_at` behave the same way; they are intentionally different.
- No new cron. Auto-expiry is evaluated lazily inside `recalculatePauses`, exactly like every existing pause type's cleanup-on-tab-visit model.

---

### Task 1: Migration — add `reason`/`resume_at` to `brand_platform_override`

**Files:**
- Create: `supabase/migrations/20260902130000_add_brand_platform_override_reason_and_resume_at.sql`

**Interfaces:**
- Produces: two new nullable columns, `brand_platform_override.reason text` and `brand_platform_override.resume_at date`. No RLS change (existing 4 policies already cover them).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260902130000_add_brand_platform_override_reason_and_resume_at.sql
-- Extends brand_platform_override (docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md's
-- migration, 20260807110000_add_flagged_platform_brands_and_override.sql) with a
-- reason and an optional auto-resume date, per
-- docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md.
--
-- Both nullable. reason is null for the pre-existing Edit Entry "Force
-- Paused" path (no UI there collects one) and for every 'active' override.
-- resume_at is null for a permanent pause; set for a periodic one --
-- recalculatePauses (src/lib/scheduler/schedulerService.ts) auto-clears the
-- override once resume_at has passed, evaluated lazily (tab visit, or the
-- Monday generate-weekly-schedule cron), the same lazy-cleanup model every
-- other pause type in this app already uses. Deliberately NOT the same
-- "purely informational, never auto-clears" behavior as paused_tabs.paused_until
-- (a different, unrelated whole-tab-pause feature) -- see the spec's
-- "Explicitly out of scope" section.

alter table public.brand_platform_override
  add column reason text,
  add column resume_at date;
```

- [ ] **Step 2: Apply it locally / confirm it's queued for the live project**

Run: `supabase db push` (or confirm via `supabase migration list` that this file is present and pending, if `db push` isn't runnable in this environment — note it in the final task's pending-deploy list either way).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260902130000_add_brand_platform_override_reason_and_resume_at.sql
git commit -m "feat: add reason/resume_at columns to brand_platform_override"
```

---

### Task 2: `scheduleOverrides.ts` — consolidate into one `OverrideDetails` map

**Files:**
- Modify: `src/lib/scheduleOverrides.ts`
- Test: `src/lib/scheduleOverrides.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface OverrideDetails { state: OverrideState; reason: string | null; resumeAt: string | null; setBy: string | null }` and `export function buildOverrideMap(rows: { tab: string; brand_key: string; platform: Platform; override_state: OverrideState; reason: string | null; resume_at: string | null; set_by: string | null }[]): Map<string, OverrideDetails>`. `buildOverrideSetByMap` is deleted — every later task reads `.setBy` off the same map entry instead.

- [ ] **Step 1: Write the failing test — replace the two old test blocks with one**

Replace the full contents of `src/lib/scheduleOverrides.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { overrideKey, buildOverrideMap } from './scheduleOverrides';

describe('overrideKey', () => {
  it('combines tab, brand_key, and platform', () => {
    expect(overrideKey('BITP', 'winmega', 'tp')).toBe('BITP::winmega::tp');
  });
});

describe('buildOverrideMap', () => {
  it('maps each row to its full details, keyed by brand_key (not raw brand)', () => {
    const map = buildOverrideMap([
      { tab: 'BITP', brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'Client requested a break', resume_at: '2026-09-30', set_by: 'leo@optinetsolutions.com' },
      { tab: 'Hanan', brand_key: 'pribet.com', platform: 'ag', override_state: 'active', reason: null, resume_at: null, set_by: null },
    ]);
    expect(map.get(overrideKey('BITP', 'winmega', 'tp'))).toEqual({
      state: 'pause', reason: 'Client requested a break', resumeAt: '2026-09-30', setBy: 'leo@optinetsolutions.com',
    });
    expect(map.get(overrideKey('Hanan', 'pribet.com', 'ag'))).toEqual({
      state: 'active', reason: null, resumeAt: null, setBy: null,
    });
    expect(map.size).toBe(2);
  });

  it('defaults reason/resume_at/set_by to null when the row omits them (a null/blank set_by is never coerced to an empty string)', () => {
    const map = buildOverrideMap([
      { tab: 'BITP', brand_key: 'rocketspin', platform: 'ag', override_state: 'pause', reason: null, resume_at: null, set_by: '' },
    ]);
    expect(map.get(overrideKey('BITP', 'rocketspin', 'ag'))).toEqual({
      state: 'pause', reason: null, resumeAt: null, setBy: '',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/scheduleOverrides.test.ts`
Expected: FAIL — `buildOverrideSetByMap` import error, and `buildOverrideMap`'s current return shape doesn't match `.toEqual`.

- [ ] **Step 3: Rewrite `scheduleOverrides.ts`**

Replace the full contents of `src/lib/scheduleOverrides.ts` with:

```ts
// A manual override lets ops force a brand+platform's schedule state,
// beating whatever recalculatePauses' automatic detection would otherwise
// compute (docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md).
// 'pause' forces a pause regardless of auto conditions; 'active' forces
// continued posting even if auto-detection would otherwise pause it.
// Unlike removedPlatformBrands (boolean presence), this carries state, so
// the shared helper here builds a Map, not a Set.
//
// Keyed by brand_key (not raw brand) because the source table
// (brand_platform_override, like brand_platform_pause) only stores the
// generated brand_key column, not the original brand string.
//
// reason/resumeAt (docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md)
// are only meaningful when state === 'pause'. reason is null for the
// pre-existing Edit Entry "Force Paused" path (which never collects one) and
// for every 'active' override. resumeAt is null for a permanent pause; an
// ISO date for a periodic one recalculatePauses auto-expires.
//
// Everything (state, reason, resumeAt, who-set-it) lives in one map now,
// not split across a second parallel buildOverrideSetByMap the way this file
// used to -- two lookups for the same key that could silently drift is
// exactly the class of bug the reason/resumeAt addition would have made
// worse, not better, if kept split.

import type { Platform } from './removedPlatformBrands.ts';

export type OverrideState = 'pause' | 'active';

export interface OverrideDetails {
  state: OverrideState;
  reason: string | null;
  resumeAt: string | null;
  setBy: string | null;
}

export function overrideKey(tab: string, brandKey: string, platform: Platform): string {
  return `${tab}::${brandKey}::${platform}`;
}

export function buildOverrideMap(
  rows: {
    tab: string;
    brand_key: string;
    platform: Platform;
    override_state: OverrideState;
    reason: string | null;
    resume_at: string | null;
    set_by: string | null;
  }[],
): Map<string, OverrideDetails> {
  return new Map(
    rows.map((r) => [
      overrideKey(r.tab, r.brand_key, r.platform),
      { state: r.override_state, reason: r.reason ?? null, resumeAt: r.resume_at ?? null, setBy: r.set_by ?? null },
    ]),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/scheduleOverrides.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleOverrides.ts src/lib/scheduleOverrides.test.ts
git commit -m "refactor: consolidate brand_platform_override lookup into one OverrideDetails map"
```

---

### Task 3: `queries.ts` — persist and fetch `reason`/`resume_at`

**Files:**
- Modify: `src/lib/queries.ts` (`BrandPlatformOverride` interface, `fetchBrandPlatformOverrides`, `setBrandPlatformOverride` — around lines 1158-1183)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BrandPlatformOverride` gains `reason: string | null; resume_at: string | null`. `setBrandPlatformOverride(tab: string, brand: string, platform: Platform, state: 'pause' | 'active', opts?: { reason?: string | null; resumeAt?: string | null }): Promise<void>` — `opts` omitted means both persisted as `null` (covers the existing Edit Entry call site, unchanged).

- [ ] **Step 1: Write the failing test**

In `src/lib/queries.test.ts`, replace the existing `'setBrandPlatformOverride upserts into brand_platform_override'` test (the one currently asserting only `tab`/`brand`/`platform`/`override_state`) with:

```ts
  it('setBrandPlatformOverride upserts into brand_platform_override with reason/resume_at defaulting to null', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ upsert });
    await setBrandPlatformOverride('X', 'WinMega', 'tp', 'pause');
    expect(singletonFrom).toHaveBeenCalledWith('brand_platform_override');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'X', brand: 'WinMega', platform: 'tp', override_state: 'pause', reason: null, resume_at: null }),
      { onConflict: 'tab,brand_key,platform' },
    );
  });

  it('setBrandPlatformOverride persists a custom reason and resume_at when passed', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ upsert });
    await setBrandPlatformOverride('X', 'WinMega', 'tp', 'pause', { reason: 'Client requested a break', resumeAt: '2026-09-30' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'X', brand: 'WinMega', platform: 'tp', override_state: 'pause', reason: 'Client requested a break', resume_at: '2026-09-30' }),
      { onConflict: 'tab,brand_key,platform' },
    );
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/queries.test.ts -t "setBrandPlatformOverride"`
Expected: FAIL — first test fails because today's upsert payload has no `reason`/`resume_at` keys at all (an `objectContaining` check on absent keys with value `null` fails); second fails because `setBrandPlatformOverride` doesn't accept a 5th argument yet.

- [ ] **Step 3: Update `queries.ts`**

Replace lines 1158-1183 (the `BrandPlatformOverride` interface through `setBrandPlatformOverride`) with:

```ts
export interface BrandPlatformOverride {
  tab: string;
  brand_key: string;
  platform: Platform;
  override_state: 'pause' | 'active';
  // Who set the override (currentUserEmail() at set time) — surfaced in the
  // Schedule Planner tooltip so a forced pause/active can say who forced it,
  // not just that it's forced.
  set_by: string | null;
  // reason/resume_at (docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md)
  // are only ever meaningful when override_state === 'pause'. Both null for
  // the pre-existing Edit Entry "Force Paused" path and for any 'active'
  // override.
  reason: string | null;
  resume_at: string | null;
}

export async function fetchBrandPlatformOverrides(tab: string, client: SupabaseClient = supabase): Promise<BrandPlatformOverride[]> {
  const { data, error } = await client
    .from('brand_platform_override')
    .select('tab, brand_key, platform, override_state, set_by, reason, resume_at')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as BrandPlatformOverride[];
}

export async function setBrandPlatformOverride(
  tab: string,
  brand: string,
  platform: Platform,
  state: 'pause' | 'active',
  opts?: { reason?: string | null; resumeAt?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('brand_platform_override')
    .upsert(
      {
        tab,
        brand,
        platform,
        override_state: state,
        set_by: await currentUserEmail(),
        reason: opts?.reason ?? null,
        resume_at: opts?.resumeAt ?? null,
      },
      { onConflict: 'tab,brand_key,platform' },
    );
  if (error) throw error;
}
```

(`clearBrandPlatformOverride` immediately below is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts -t "setBrandPlatformOverride"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: persist reason/resume_at on brand_platform_override"
```

---

### Task 4: `schedulerService.ts` — thread the reason, auto-expire periodic overrides

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts` (`TabContext.overrideMap` type, `recalculatePauses` — lines 32-60 and 163-260)
- Test: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes: `OverrideDetails` from Task 2.
- Produces: `TabContext.overrideMap?: Map<string, OverrideDetails>` (was `Map<string, OverrideState>`). `recalculatePauses`'s external signature is unchanged.

- [ ] **Step 1: Update the type import and `TabContext`**

In `src/lib/scheduler/schedulerService.ts`, change line 15:

```ts
// before
import { overrideKey, type OverrideState } from '../scheduleOverrides.ts';
// after
import { overrideKey, type OverrideDetails } from '../scheduleOverrides.ts';
```

And update the `TabContext.overrideMap` field (currently around line 41-46):

```ts
  // Every (tab, brand_key, platform) with a manually-set override, beating
  // whatever the automatic checks below would otherwise compute. 'active'
  // forces continued posting (deletes/skips any pause); 'pause' forces a
  // pause unconditionally (with a custom reason and an optional auto-resume
  // date — see recalculatePauses below). Optional, same "defaults to nothing
  // overridden" convention as the other two sets.
  overrideMap?: Map<string, OverrideDetails>;
```

- [ ] **Step 2: Write the failing tests — reason threading and periodic auto-expiry**

In `src/lib/scheduler/schedulerService.test.ts`, first update every existing `overrideMap: new Map([[overrideKey(...), 'active']])` / `'pause'` literal (6 occurrences, in the `describe('manual override', ...)` block) to the new object shape. For example, the first one (currently):

```ts
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), 'active']]),
```

becomes:

```ts
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), { state: 'active', reason: null, resumeAt: null, setBy: null }]]),
```

Apply the same mechanical change to all 6 occurrences (2 with `'active'`, 4 with `'pause'`) inside `describe('manual override', ...)`. The 3 `upsertBrandPlatformPause` assertions currently expecting the literal `'Manually paused'` string (in the `'pause'`-state tests) stay expecting `'Manually paused'` for now, since those tests don't set a `reason` — a `reason: null` override still falls back to the generic string.

Then add two new `it` blocks inside `describe('manual override', ...)`, after the existing `"override 'pause' wins over consecutive-removed..."` test:

```ts
    it("override 'pause' with a custom reason is upserted verbatim, not the generic fallback", async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), { state: 'pause', reason: 'Client requested a break', resumeAt: null, setBy: 'leo@optinetsolutions.com' }]]),
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Client requested a break', undefined,
      );
    });

    it("a permanent override ('pause' with resumeAt: null) never auto-expires", async () => {
      queries.fetchActiveBrandPlatformPauses.mockResolvedValue([
        { tab: 'BITP', brand_key: 'winmega', platform: 'tp', paused_week_start: '2026-08-03', reason: 'Client requested a break' },
      ]);
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [],
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), { state: 'pause', reason: 'Client requested a break', resumeAt: null, setBy: 'leo@optinetsolutions.com' }]]),
      };
      // Simulate the following week too — a permanent override must still
      // re-assert itself, never resuming on its own.
      const resumedThisWeek = await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(resumedThisWeek).toEqual([]);
      const resumedNextWeek = await recalculatePauses('BITP', '2026-08-10', ctx);
      expect(resumedNextWeek).toEqual([]);
      expect(queries.clearBrandPlatformOverride).not.toHaveBeenCalled();
    });

    it("a periodic override ('pause' with a resumeAt) auto-expires once its week's Sunday has passed, clearing the override and resuming", async () => {
      queries.fetchActiveBrandPlatformPauses.mockResolvedValue([
        { tab: 'BITP', brand_key: 'winmega', platform: 'tp', paused_week_start: '2026-08-03', reason: 'Two-week break' },
      ]);
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [],
        // resumeAt is a Wednesday inside the week being evaluated below
        // (2026-08-12, within the 2026-08-10..2026-08-16 week) — should
        // already count as expired that same week, not one week later.
        overrideMap: new Map([[overrideKey('BITP', 'winmega', 'tp'), { state: 'pause', reason: 'Two-week break', resumeAt: '2026-08-12', setBy: 'leo@optinetsolutions.com' }]]),
      };
      const resumedTooEarly = await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(resumedTooEarly).toEqual([]);
      const resumed = await recalculatePauses('BITP', '2026-08-10', ctx);
      expect(queries.clearBrandPlatformOverride).toHaveBeenCalledWith('BITP', 'winmega', 'tp', undefined);
      expect(queries.deleteBrandPlatformPause).toHaveBeenCalledWith('BITP', 'winmega', 'tp', undefined);
      expect(resumed).toEqual([{ brandKey: 'winmega', platform: 'tp' }]);
    });
```

Add `clearBrandPlatformOverride: vi.fn()` to the `queries` hoisted mock object at the top of the file (currently `fetchBrandSchedule`, `bulkUpsertBrandSchedule`, `fetchActiveBrandPlatformPauses`, `upsertBrandPlatformPause`, `deleteBrandPlatformPause`), and import `clearBrandPlatformOverride` alongside the others if the mock object needs it referenced — it's a `vi.fn()` inside `vi.hoisted`, no separate import needed since `vi.mock('../queries', ...)` spreads `queries` over the real module's exports.

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: FAIL on the 2 new tests (`recalculatePauses` doesn't know about `resumeAt` yet, and doesn't call `clearBrandPlatformOverride` at all); the 6 updated literals should already pass once Task 2/3 land since `.state`/`.reason` access doesn't exist in `recalculatePauses` yet, so this step will show a TypeScript error via `vi.mock`'s `queries.clearBrandPlatformOverride` not existing until Step 4's import update — confirm the failure is about the missing expiry behavior, not a syntax error, before moving on.

- [ ] **Step 4: Implement the reason threading and periodic auto-expiry**

In `src/lib/scheduler/schedulerService.ts`, update the import at line 4-9 to add `clearBrandPlatformOverride`:

```ts
import {
  isDoneStatus,
  fetchBrandSchedule,
  bulkUpsertBrandSchedule,
  fetchActiveBrandPlatformPauses,
  upsertBrandPlatformPause,
  deleteBrandPlatformPause,
  clearBrandPlatformOverride,
} from '../queries.ts';
```

Then replace the override-handling block inside `recalculatePauses` (currently):

```ts
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
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, PERSISTENT_PAUSE_REASONS.manual, client);
        continue;
      }
```

with:

```ts
      const override = overrideMap.get(overrideKey(tab, brandKey, platform));
      const existingPause = pauses.find((p) => p.brand_key === brandKey && p.platform === platform);

      // A periodic override ('pause' with a resumeAt) auto-expires once its
      // resume date has passed relative to the week being evaluated — checked
      // BEFORE the override === 'pause' branch below, so an expired periodic
      // pause is treated as if the override no longer existed at all this
      // week (falls through to the auto-detection chain further down, same
      // as override === undefined), not re-applied. Week-granular, matching
      // every other pause-lifecycle check in this function: a resumeAt
      // anywhere within the week being evaluated already counts as
      // "passed" (compared against that week's Sunday), so a periodic pause
      // resumes as soon as this same week is next evaluated, not one week
      // later.
      if (override?.state === 'pause' && override.resumeAt && override.resumeAt <= weekEndSunday(weekStart)) {
        await clearBrandPlatformOverride(tab, brandKey, platform, client);
        if (existingPause) {
          await deleteBrandPlatformPause(tab, brandKey, platform, client);
          resumed.push({ brandKey, platform });
        }
        continue;
      }
      if (override?.state === 'active') {
        if (existingPause) {
          await deleteBrandPlatformPause(tab, brandKey, platform, client);
          resumed.push({ brandKey, platform });
        }
        continue;
      }
      if (override?.state === 'pause') {
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, override.reason?.trim() || PERSISTENT_PAUSE_REASONS.manual, client);
        continue;
      }
```

Add the small `weekEndSunday` helper right above `last30DaysRange` (same file, same local-date-parsing style that function already uses to avoid the UTC-conversion bug documented on `toISODate`):

```ts
// The Sunday ending the week that starts on weekStart, as an ISO date
// string — used to decide whether a periodic override's resumeAt has
// "passed" for the week currently being evaluated (see recalculatePauses).
// Parsed/formatted as a local date, matching last30DaysRange below, to avoid
// the UTC-conversion bug documented on toISODate in scheduleBrands.ts.
function weekEndSunday(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const sunday = new Date(y, m - 1, d + 6);
  const yyyy = sunday.getFullYear();
  const mm = String(sunday.getMonth() + 1).padStart(2, '0');
  const dd = String(sunday.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: PASS (all tests, including the 6 mechanically-updated literals and the 3 new ones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
git commit -m "feat: thread custom pause reason through recalculatePauses and auto-expire periodic overrides"
```

---

### Task 5: `calendarRenderer.tsx` — fix the reason-string-matching discriminator

**Files:**
- Modify: `src/lib/scheduler/calendarRenderer.tsx` (`ScheduleStatusIconProps`, `titleFor` — lines 463-507)

**Interfaces:**
- Consumes: nothing new from earlier tasks directly (this is a standalone presentational fix, wired up by Task 6).
- Produces: `ScheduleStatusIconProps` gains a top-level optional `pauseResumeAt?: string | null` (`undefined` = not override-driven / today's existing auto-detected wording; `null` = override-driven, permanent; an ISO date string = override-driven, periodic — "Resumes `<date>`").

- [ ] **Step 1: Update the type and `titleFor`**

Change the `ScheduleStatusIconProps` type (currently):

```ts
type ScheduleStatusIconProps = { agent?: string; pausedBy?: string; clickable: boolean; onClick: () => void } & (
```

to:

```ts
type ScheduleStatusIconProps = { agent?: string; pausedBy?: string; pauseResumeAt?: string | null; clickable: boolean; onClick: () => void } & (
```

Replace `titleFor`'s `'system'` branch (currently):

```ts
function titleFor(props: ScheduleStatusIconProps): string {
  if (props.source === 'system') {
    const { pause } = props;
    // "Manually paused" (Task 7) persists for as long as the override stays
    // set -- its paused_week_start gets re-upserted to the current week on
    // every recalculatePauses run, so unlike a real auto-detected pause it
    // doesn't actually auto-resume next week. Showing "Resumes week of ..."
    // for it would be misleading.
    const autoExpires = pause.reason !== PERSISTENT_PAUSE_REASONS.manual;
    return autoExpires
      ? `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`
      : `Reason: ${pause.reason}\nStays paused until manually cleared`;
  }
```

with:

```ts
function titleFor(props: ScheduleStatusIconProps): string {
  if (props.source === 'system') {
    const { pause, pauseResumeAt } = props;
    // pauseResumeAt is only ever passed (even as null) when this pause is
    // driven by a brand_platform_override row — resolved directly from the
    // override map by the caller, NOT by comparing pause.reason against the
    // generic PERSISTENT_PAUSE_REASONS.manual string. That string comparison
    // is what this replaced: once a manual override can carry a custom
    // reason (docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md),
    // every custom-reason pause would otherwise misreport as auto-detected.
    // undefined -> auto-detected, unchanged "Resumes week of ..." wording.
    // null -> override-driven, permanent. A date string -> override-driven,
    // periodic, with its own real resume date instead of the generic
    // one-week-later estimate the auto-detected branch uses.
    if (pauseResumeAt === undefined) {
      return `Reason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`;
    }
    if (pauseResumeAt === null) {
      return `Reason: ${pause.reason}\nStays paused until manually cleared`;
    }
    return `Reason: ${pause.reason}\nResumes ${resumeAtLabel(pauseResumeAt)}`;
  }
```

Add `resumeAtLabel` next to the existing `resumeWeekLabel` helper (a few lines above `titleFor`):

```ts
function resumeAtLabel(resumeAt: string): string {
  const [y, m, d] = resumeAt.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
```

Update `ScheduleStatusIcon`'s destructure (currently `const { platform, agent, pausedBy, clickable, onClick } = props;`) to also pull `pauseResumeAt` if needed by any later rendering — it isn't used outside `titleFor`, so no change needed there; `titleFor(props)` already receives the whole `props` object.

`PERSISTENT_PAUSE_REASONS` is still imported and used elsewhere in this file? Check: search the file for any other reference before removing the import. If `PERSISTENT_PAUSE_REASONS.manual` is no longer referenced anywhere in `calendarRenderer.tsx` after this change, remove the now-unused `import { PERSISTENT_PAUSE_REASONS } from './schedulerRules';` (line 7) — otherwise the build's lint/typecheck will flag an unused import.

- [ ] **Step 2: Verify with the build (no dedicated test file for this presentational component, matching this codebase's established convention — verified via `npm run build` and Task 6's live check)**

Run: `npm run build`
Expected: clean build, no unused-import or type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduler/calendarRenderer.tsx
git commit -m "fix: stop deriving pause auto-expiry wording from a reason-string comparison"
```

---

### Task 6: `TabScheduleSection.tsx` — wire the override map, fix the discriminator, add `refreshPauseState`

**Files:**
- Modify: `src/components/TabScheduleSection.tsx`

**Interfaces:**
- Consumes: `OverrideDetails` (Task 2), `setBrandPlatformOverride`'s new `opts` param and `clearBrandPlatformOverride`/`deleteBrandPlatformPause` (already exported from `queries.ts`), `ScheduleStatusIconProps.pauseResumeAt` (Task 5).
- Produces: `refreshPauseState(): Promise<void>` (re-runs `recalculatePauses` + refetches `pauses`/`overrideMap`) and a `brandByKey: Map<string, string>` lookup — both consumed by Task 7 and Task 8.

- [ ] **Step 1: Update imports**

Change line 28 (currently `import { buildOverrideMap, buildOverrideSetByMap, overrideKey, type OverrideState } from '../lib/scheduleOverrides';`) to:

```ts
import { buildOverrideMap, overrideKey, type OverrideDetails } from '../lib/scheduleOverrides';
```

Add `setBrandPlatformOverride`, `clearBrandPlatformOverride`, and `deleteBrandPlatformPause` to the existing `from '../lib/queries'` import block (currently listing `fetchRawEntriesByTab, fetchTabHeaders, fetchBrandSchedule, setBrandScheduleDay, fetchActiveBrandPlatformPauses, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, ...`):

```ts
  fetchRawEntriesByTab,
  fetchTabHeaders,
  fetchBrandSchedule,
  setBrandScheduleDay,
  fetchActiveBrandPlatformPauses,
  fetchRemovedPlatformBrands,
  fetchBrandPlatformOverrides,
  setBrandPlatformOverride,
  clearBrandPlatformOverride,
  deleteBrandPlatformPause,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  fetchBrandAgentAssignments,
  fetchScheduleCancellations,
  recordScheduleCancellation,
  clearScheduleCancellation,
  fetchPublicHolidays,
  type BrandPlatformPause,
  type BrandAgentAssignmentRow,
  type ScheduleCancellation,
```

- [ ] **Step 2: Update the `tabCtx` state type**

Change (currently, inside the `useState<{...}>` type):

```ts
    overrideMap: Map<string, OverrideState>;
    // Display-only "who forced this override" lookup (brand_platform_override
    // .set_by) — kept separate from overrideMap since schedulerService.ts's
    // pause-resolution logic only ever needs the OverrideState, not the actor.
    overrideSetByMap: Map<string, string>;
```

to:

```ts
    overrideMap: Map<string, OverrideDetails>;
```

- [ ] **Step 3: Update the load effect's `overrideMap`/`overrideSetByMap` construction**

Find the `setTabCtx({ ... overrideMap: buildOverrideMap(overrideRows), overrideSetByMap: buildOverrideSetByMap(overrideRows), ... })` line (around line 299) and change it to:

```ts
          overrideMap: buildOverrideMap(overrideRows),
```

(deleting the `overrideSetByMap: buildOverrideSetByMap(overrideRows),` line entirely).

- [ ] **Step 4: Fix `computeCellData`'s discriminator and add `resumeAtByPlatform`**

Replace the `pausedByFor` function and `computeCellData` (currently lines 740-776) with:

```ts
  // colWeekStartISO defaults to weekStartISO (the nav's own week) so every
  // existing call site that only ever cared about one week — the trailing
  // Paused-column summary, Export — can keep calling this with no argument.
  // The day-cell render loop below passes each column's own week explicitly.
  function computeCellData(brand: string, colWeekStartISO: string = weekStartISO): {
    rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>;
    pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>>;
    // Who forced the pause — only populated when this platform's active
    // pause is override-driven (checked directly against tabCtx.overrideMap,
    // NOT by comparing the pause's own reason text against a generic
    // constant — see calendarRenderer.tsx's titleFor for why that string
    // comparison was a bug waiting to happen once reasons became custom
    // text).
    pausedByPlatform: Partial<Record<Platform, string>>;
    // undefined = not override-driven (auto-detected, or no pause at all for
    // this exact week); null = override-driven, permanent; an ISO date =
    // override-driven, periodic. Threaded straight into ScheduleStatusIcon's
    // pauseResumeAt prop.
    resumeAtByPlatform: Partial<Record<Platform, string | null>>;
  } {
    const brandKey = normalizeBrandKey(brand);
    const rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>> = {};
    const pausesByPlatform: Partial<Record<Platform, BrandPlatformPause>> = {};
    const pausedByPlatform: Partial<Record<Platform, string>> = {};
    const resumeAtByPlatform: Partial<Record<Platform, string | null>> = {};
    for (const platform of brandPlatforms(brand)) {
      const r = scheduleFor(scheduleRows, tab, brand, colWeekStartISO, platform);
      if (r) rowsByPlatform[platform] = r;
      const p = pauses.find(
        (x) => x.brand_key === brandKey && x.platform === platform && x.paused_week_start === colWeekStartISO,
      );
      if (p) {
        pausesByPlatform[platform] = p;
        const override = tabCtx?.overrideMap.get(overrideKey(tab, brandKey, platform));
        if (override?.state === 'pause') {
          resumeAtByPlatform[platform] = override.resumeAt;
          if (override.setBy) pausedByPlatform[platform] = override.setBy;
        }
      }
    }
    return { rowsByPlatform, pausesByPlatform, pausedByPlatform, resumeAtByPlatform };
  }
```

- [ ] **Step 5: Thread `resumeAtByPlatform` into the `ScheduleStatusIcon` call site**

Find the render loop's `const { rowsByPlatform: weekRowsByPlatform, pausesByPlatform: weekPausesByPlatform, pausedByPlatform: weekPausedByPlatform } = computeCellData(brand);` (around line 1109) and add the new field:

```ts
                const { rowsByPlatform: weekRowsByPlatform, pausesByPlatform: weekPausesByPlatform, pausedByPlatform: weekPausedByPlatform, resumeAtByPlatform: weekResumeAtByPlatform } = computeCellData(brand);
```

Then find the `'system'` `ScheduleStatusIcon` call (around line 1216):

```ts
                            <ScheduleStatusIcon key={platform} platform={platform} source="system" pause={weekPausesByPlatform[platform] as BrandPlatformPause} agent={agent} pausedBy={weekPausedByPlatform[platform]} clickable={clickable} onClick={onClick} />
```

and add `pauseResumeAt`:

```ts
                            <ScheduleStatusIcon key={platform} platform={platform} source="system" pause={weekPausesByPlatform[platform] as BrandPlatformPause} agent={agent} pausedBy={weekPausedByPlatform[platform]} pauseResumeAt={weekResumeAtByPlatform[platform]} clickable={clickable} onClick={onClick} />
```

- [ ] **Step 6: Add `brandByKey` and `refreshPauseState`**

Near the other `useMemo` index builders (the cluster around `countryIndex`/`accountIndex`/`agentIndex`, roughly lines 580-645), add:

```ts
  // Reverse lookup from a normalized brand_key back to its real display
  // brand string — brand_platform_pause/brand_platform_override rows only
  // ever store brand_key, but the Paused Brands summary (Task 8) needs the
  // real display name to show alongside it.
  const brandByKey = useMemo(
    () => new Map((tabCtx?.brands ?? []).map((b) => [normalizeBrandKey(b), b])),
    [tabCtx?.brands],
  );
```

Then, in place of the deleted `pausedByFor` function (Step 4 already removed it as part of rewriting `computeCellData` — add this new function in the same spot):

```ts
  // Re-applies the override table's current effect onto brand_platform_pause
  // for the current week (the same write path recalculatePauses already
  // performs on every tab load) and refetches this component's own copies of
  // `pauses`/`tabCtx.overrideMap`, so a Pause Brand save or a Resume Now
  // click is reflected on the grid immediately rather than waiting for the
  // next tab visit. Both PlatformPauseModal's save handler (Task 7) and the
  // Paused Brands summary's Resume Now action (Task 8) call this after their
  // own direct writes.
  async function refreshPauseState() {
    if (!tabCtx) return;
    await recalculatePauses(tab, weekStartISO, tabCtx);
    const [freshPauses, freshOverrideRows] = await Promise.all([
      fetchActiveBrandPlatformPauses(tab),
      fetchBrandPlatformOverrides(tab),
    ]);
    setPauses(freshPauses);
    setTabCtx((prev) => (prev ? { ...prev, overrideMap: buildOverrideMap(freshOverrideRows) } : prev));
  }
```

- [ ] **Step 7: Verify with the build**

Run: `npm run build`
Expected: clean build. `pausedByFor` and `buildOverrideSetByMap` should have zero remaining references anywhere in this file.

- [ ] **Step 8: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "refactor: resolve override-driven pause detail from the override map directly, add refreshPauseState"
```

---

### Task 7: "Pause Brand" action — `PlatformPauseModal.tsx` + wiring

**Files:**
- Create: `src/components/PlatformPauseModal.tsx`
- Modify: `src/components/TabScheduleSection.tsx`

**Interfaces:**
- Consumes: `refreshPauseState`, `brandPlatforms`, `computeCellData`, `overrideKey`, `normalizeBrandKey` (all already present after Task 6), `setBrandPlatformOverride`/`clearBrandPlatformOverride`/`deleteBrandPlatformPause` (Task 6 imports).
- Produces: `PlatformPauseModal`'s props — `{ brand: string; platforms: Platform[]; initialCheckedPlatforms: Platform[]; autoPauseReasonByPlatform: Partial<Record<Platform, string>>; initialReason: string; initialResumeAt: string | null; todayISO: string; busy: boolean; onSave: (checkedPlatforms: Platform[], reason: string, resumeAt: string | null) => void; onClose: () => void }`.

- [ ] **Step 1: Create `PlatformPauseModal.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import PausedBadgeIcon from './PausedBadgeIcon';
import { PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';

interface Props {
  brand: string;
  platforms: Platform[];
  initialCheckedPlatforms: Platform[];
  // A platform currently auto-paused (no override) shows an inline note for
  // visibility — checking it still creates a real override on top, exactly
  // as recalculatePauses already prioritizes override over auto-detection.
  autoPauseReasonByPlatform: Partial<Record<Platform, string>>;
  initialReason: string;
  initialResumeAt: string | null;
  todayISO: string;
  busy: boolean;
  onSave: (checkedPlatforms: Platform[], reason: string, resumeAt: string | null) => void;
  onClose: () => void;
}

// Pause Brand action
// (docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md):
// a durable, reasoned pause across one or more platforms for a brand, on top
// of brand_platform_override. Distinct from PauseDaysModal (a per-day toggle
// scoped only to the currently-viewed week) — this is the mechanism that
// actually persists across weeks, which is the whole point of this feature.
export default function PlatformPauseModal({ brand, platforms, initialCheckedPlatforms, autoPauseReasonByPlatform, initialReason, initialResumeAt, todayISO, busy, onSave, onClose }: Props) {
  const [checked, setChecked] = useState<Set<Platform>>(() => new Set(initialCheckedPlatforms));
  const [durationMode, setDurationMode] = useState<'permanent' | 'until'>(initialResumeAt ? 'until' : 'permanent');
  const [resumeAt, setResumeAt] = useState(initialResumeAt ?? '');
  const [reason, setReason] = useState(initialReason);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function toggle(platform: Platform) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  const initialSet = new Set(initialCheckedPlatforms);
  const hasNewPause = [...checked].some((p) => !initialSet.has(p));
  const reasonMissing = hasNewPause && !reason.trim();
  const dateMissing = hasNewPause && durationMode === 'until' && !resumeAt;
  const canSave = !busy && !reasonMissing && !dateMissing;

  function handleSave() {
    if (!canSave) return;
    onSave([...checked], reason.trim(), durationMode === 'until' ? resumeAt : null);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <PausedBadgeIcon className="size-4" />
              Pause brand
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{brand}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-3 space-y-1.5">
          {platforms.map((platform) => (
            <label key={platform} className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={checked.has(platform)}
                onChange={() => toggle(platform)}
                className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
              />
              <img
                src={PLATFORM_FAVICON[platform]}
                alt={platform}
                className="size-3.5 rounded-sm"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <span className="flex-1">{PLATFORM_FULL_LABEL[platform]}</span>
              {!checked.has(platform) && autoPauseReasonByPlatform[platform] && (
                <span className="text-[11px] font-normal text-amber-600">currently auto-paused</span>
              )}
            </label>
          ))}
        </div>

        <div className="px-5 pb-3 space-y-2">
          <div className="flex gap-3 text-sm text-slate-700">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="duration" checked={durationMode === 'permanent'} onChange={() => setDurationMode('permanent')} />
              Permanent
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="duration" checked={durationMode === 'until'} onChange={() => setDurationMode('until')} />
              Until a date
            </label>
          </div>
          {durationMode === 'until' && (
            <input
              type="date"
              value={resumeAt}
              min={todayISO}
              onChange={(e) => setResumeAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
            />
          )}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required to pause)"
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pt-2 pb-5">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `TabScheduleSection.tsx` — imports and state**

Add the import (near the other component imports, e.g. after `import PauseDaysModal from './PauseDaysModal';`):

```ts
import PlatformPauseModal from './PlatformPauseModal';
```

Add new state near `pauseDaysTarget` (around line 149):

```ts
  const [pauseModalTarget, setPauseModalTarget] = useState<{ brand: string } | null>(null);
  const [pauseModalBusy, setPauseModalBusy] = useState(false);
```

- [ ] **Step 3: Add the trigger button in the brand row**

Find the brand-name cell (around line 1146):

```tsx
                      {flaggedRemovedPlatforms(brand).map((p) => <RemovedPlatformIcon key={p} platform={p} />)}
```

Add a button immediately after it:

```tsx
                      {flaggedRemovedPlatforms(brand).map((p) => <RemovedPlatformIcon key={p} platform={p} />)}
                      {isApproved && (
                        <button
                          type="button"
                          onClick={() => setPauseModalTarget({ brand })}
                          className="ml-1.5 shrink-0 rounded-md p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                          title={`Pause ${brand}`}
                          aria-label={`Pause ${brand}`}
                        >
                          <PausedBadgeIcon className="size-3.5" />
                        </button>
                      )}
```

This needs `PausedBadgeIcon` imported — add `import PausedBadgeIcon from './PausedBadgeIcon';` alongside the other component imports.

- [ ] **Step 4: Compute the modal's data and save handler**

Add these functions near `refreshPauseState` (Task 6, Step 6):

```ts
  function computePauseModalData(brand: string): { platforms: Platform[]; checkedPlatforms: Platform[]; autoPauseReasonByPlatform: Partial<Record<Platform, string>>; initialReason: string; initialResumeAt: string | null } {
    const brandKey = normalizeBrandKey(brand);
    const platforms = brandPlatforms(brand);
    const { pausesByPlatform } = computeCellData(brand);
    const checkedPlatforms: Platform[] = [];
    const autoPauseReasonByPlatform: Partial<Record<Platform, string>> = {};
    let initialReason = '';
    let initialResumeAt: string | null = null;
    for (const platform of platforms) {
      const override = tabCtx?.overrideMap.get(overrideKey(tab, brandKey, platform));
      if (override?.state === 'pause') {
        checkedPlatforms.push(platform);
        if (!initialReason && override.reason) {
          initialReason = override.reason;
          initialResumeAt = override.resumeAt;
        }
      } else if (pausesByPlatform[platform]) {
        autoPauseReasonByPlatform[platform] = pausesByPlatform[platform]!.reason;
      }
    }
    return { platforms, checkedPlatforms, autoPauseReasonByPlatform, initialReason, initialResumeAt };
  }

  async function handleSavePauseModal(brand: string, checkedPlatforms: Platform[], reason: string, resumeAt: string | null) {
    const brandKey = normalizeBrandKey(brand);
    const nowChecked = new Set(checkedPlatforms);
    const { checkedPlatforms: previouslyChecked } = computePauseModalData(brand);
    const wasChecked = new Set(previouslyChecked);
    setPauseModalBusy(true);
    try {
      for (const platform of brandPlatforms(brand)) {
        const was = wasChecked.has(platform);
        const now = nowChecked.has(platform);
        if (was === now) continue;
        if (now) {
          await setBrandPlatformOverride(tab, brand, platform, 'pause', { reason, resumeAt });
        } else {
          await clearBrandPlatformOverride(tab, brandKey, platform);
          await deleteBrandPlatformPause(tab, brandKey, platform);
        }
      }
      await refreshPauseState();
      setPauseModalTarget(null);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Failed to update pause', kind: 'error' });
    } finally {
      setPauseModalBusy(false);
    }
  }
```

- [ ] **Step 5: Render the modal**

Near where `PauseDaysModal` is rendered (the `{pauseDaysTarget && pauseDaysModalData && (...)}` block, around line 1264), add:

```tsx
      {pauseModalTarget && (() => {
        const data = computePauseModalData(pauseModalTarget.brand);
        return (
          <PlatformPauseModal
            brand={pauseModalTarget.brand}
            platforms={data.platforms}
            initialCheckedPlatforms={data.checkedPlatforms}
            autoPauseReasonByPlatform={data.autoPauseReasonByPlatform}
            initialReason={data.initialReason}
            initialResumeAt={data.initialResumeAt}
            todayISO={todayISO}
            busy={pauseModalBusy}
            onSave={(checked, reason, resumeAt) => handleSavePauseModal(pauseModalTarget.brand, checked, reason, resumeAt)}
            onClose={() => setPauseModalTarget(null)}
          />
        );
      })()}
```

- [ ] **Step 6: Verify with the build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add src/components/PlatformPauseModal.tsx src/components/TabScheduleSection.tsx
git commit -m "feat: add Pause Brand action to Schedule Planner"
```

---

### Task 8: "Paused Brands" summary — `PausedBrandsModal.tsx` + wiring

**Files:**
- Create: `src/components/PausedBrandsModal.tsx`
- Modify: `src/components/TabScheduleSection.tsx`

**Interfaces:**
- Consumes: `pauses`, `tabCtx.overrideMap`, `brandByKey` (Task 6), `refreshPauseState` (Task 6), `clearBrandPlatformOverride`/`deleteBrandPlatformPause` (Task 6 imports).
- Produces: `PausedBrandsModal`'s exported `PausedBrandRow` type, reused nowhere else.

- [ ] **Step 1: Create `PausedBrandsModal.tsx`**

```tsx
import { useEffect } from 'react';
import { X } from 'lucide-react';
import PausedBadgeIcon from './PausedBadgeIcon';
import { PLATFORM_FAVICON, type Platform } from '../lib/removedPlatformBrands';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';

export interface PausedBrandRow {
  brand: string;
  brandKey: string;
  platform: Platform;
  reason: string;
  since: string;
  // null when permanent or auto-detected; an ISO date when override-driven
  // and periodic.
  until: string | null;
  // null for an auto-detected pause (there's no override to attribute).
  setBy: string | null;
  isOverrideDriven: boolean;
}

interface Props {
  open: boolean;
  rows: PausedBrandRow[];
  busy: boolean;
  onResume: (row: PausedBrandRow) => void;
  onClose: () => void;
}

// Paused Brands summary (docs/superpowers/specs/2026-09-02-brand-platform-pause-reason-design.md)
// — the piece that directly answers "why didn't we notice it came back": a
// permanent pause never expires and never silently reverts, so this is
// where it stays listed until someone explicitly resumes it.
export default function PausedBrandsModal({ open, rows, busy, onResume, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <PausedBadgeIcon className="size-4" />
              Paused brands
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Every brand+platform currently paused on this tab — a permanent pause stays listed
              here until someone resumes it.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto px-4 pb-2">
          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No brands paused on this tab.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={`${r.brandKey}::${r.platform}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-slate-800">
                      <img
                        src={PLATFORM_FAVICON[r.platform]}
                        alt={r.platform}
                        className="size-3.5 rounded-sm"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      {r.brand} <span className="text-slate-400">— {PLATFORM_FULL_LABEL[r.platform]}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.reason}
                      {r.until && <> — resumes {r.until}</>}
                      {!r.until && r.isOverrideDriven && <> — permanent</>}
                      {r.setBy && <> — set by {r.setBy}</>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onResume(r)}
                    disabled={busy}
                    className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Resume Now
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end px-5 pt-2 pb-5">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `TabScheduleSection.tsx` — imports and state**

Add the import:

```ts
import PausedBrandsModal, { type PausedBrandRow } from './PausedBrandsModal';
```

Add state near `pauseModalTarget` (Task 7, Step 2):

```ts
  const [pausedBrandsOpen, setPausedBrandsOpen] = useState(false);
  const [pausedBrandsBusy, setPausedBrandsBusy] = useState(false);
```

- [ ] **Step 3: Build the rows and the Resume Now handler**

Add near `refreshPauseState` (Task 6, Step 6):

```ts
  const pausedBrandsRows: PausedBrandRow[] = pauses.map((p) => {
    const override = tabCtx?.overrideMap.get(overrideKey(tab, p.brand_key, p.platform));
    const isOverrideDriven = override?.state === 'pause';
    return {
      brand: brandByKey.get(p.brand_key) ?? p.brand_key,
      brandKey: p.brand_key,
      platform: p.platform,
      reason: p.reason,
      since: p.paused_week_start,
      until: isOverrideDriven ? override.resumeAt : null,
      setBy: isOverrideDriven ? override.setBy : null,
      isOverrideDriven,
    };
  });

  async function handleResumeNow(row: PausedBrandRow) {
    setPausedBrandsBusy(true);
    try {
      if (row.isOverrideDriven) await clearBrandPlatformOverride(tab, row.brandKey, row.platform);
      await deleteBrandPlatformPause(tab, row.brandKey, row.platform);
      await refreshPauseState();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Failed to resume', kind: 'error' });
    } finally {
      setPausedBrandsBusy(false);
    }
  }
```

- [ ] **Step 4: Add the toolbar button and render the modal**

Find the header row's button group (around line 976-1018, containing `ExportMenuButton` and the Remove button) and add a new button before `ExportMenuButton`:

```tsx
              <button
                type="button"
                onClick={() => setPausedBrandsOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <PausedBadgeIcon className="size-3.5" />
                Paused Brands{pausedBrandsRows.length > 0 && ` (${pausedBrandsRows.length})`}
              </button>
```

Then render the modal near the other modal renders (e.g. right after the `PlatformPauseModal` block from Task 7):

```tsx
      <PausedBrandsModal
        open={pausedBrandsOpen}
        rows={pausedBrandsRows}
        busy={pausedBrandsBusy}
        onResume={handleResumeNow}
        onClose={() => setPausedBrandsOpen(false)}
      />
```

- [ ] **Step 5: Verify with the build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/components/PausedBrandsModal.tsx src/components/TabScheduleSection.tsx
git commit -m "feat: add Paused Brands summary panel to Schedule Planner"
```

---

### Task 9: `generate-weekly-schedule` — mechanical test update and `deno check`

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index_test.ts`

**Interfaces:**
- Consumes: `OverrideDetails` shape (Task 2) — `buildTabContext` itself needs no code change, since it just passes `fetchBrandPlatformOverrides`'s rows straight into `buildOverrideMap`.

- [ ] **Step 1: Update the one test that inspects `overrideMap`'s shape**

In `supabase/functions/generate-weekly-schedule/index_test.ts`, change:

```ts
Deno.test('buildTabContext populates overrideMap from its table', async () => {
  const client = fakeClient({
    entries: [entry('Hanan', '1', { Brands: 'WinMega' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [{ tab: 'Hanan', brand_key: 'winmega', platform: 'tp', override_state: 'pause' }],
  });
  const ctx = await buildTabContext('Hanan', client);
  assertEquals(ctx.overrideMap?.get('Hanan::winmega::tp'), 'pause');
});
```

to:

```ts
Deno.test('buildTabContext populates overrideMap from its table', async () => {
  const client = fakeClient({
    entries: [entry('Hanan', '1', { Brands: 'WinMega' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [{ tab: 'Hanan', brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'Client requested a break', resume_at: null, set_by: 'leo@optinetsolutions.com' }],
  });
  const ctx = await buildTabContext('Hanan', client);
  assertEquals(ctx.overrideMap?.get('Hanan::winmega::tp'), {
    state: 'pause', reason: 'Client requested a break', resumeAt: null, setBy: 'leo@optinetsolutions.com',
  });
});
```

The other `brand_platform_override: []` occurrences in this file (lines 51, 64, 86, 99, 112) need no change — an empty array needs no shape update.

- [ ] **Step 2: Run the Deno test suite**

Run: `cd supabase/functions/generate-weekly-schedule && deno test --allow-env --allow-net index_test.ts` (or the project's established equivalent command for this function — check `docs/task-history.md` for the exact invocation this function's own prior tasks used if this one errors).
Expected: PASS.

- [ ] **Step 3: Run `deno check` against this function to confirm no bundler-visible type break**

Run: `deno check --no-lock --node-modules-dir=none --config supabase/functions/generate-weekly-schedule/deno.json supabase/functions/generate-weekly-schedule/index.ts`
Expected: clean — `buildTabContext`'s `ctx.overrideMap` assignment needs no code change since `buildOverrideMap`'s return type flows through the `TabContext` type import automatically.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index_test.ts
git commit -m "test: update generate-weekly-schedule's overrideMap assertion for the new OverrideDetails shape"
```

---

### Task 10: Full suite, whole-branch review, live verification, docs

**Files:**
- Modify: `docs/task-history.md`, `CLAUDE.md` (Dynamic State sections)

- [ ] **Step 1: Run the full frontend suite and build**

Run: `npm run build && npx vitest run`
Expected: PASS, 0 failures. Confirm the test count only grew by the counts added in Tasks 2-4 (no accidental scan of a stray worktree — see this project's own known `Vitest Scans Stray Worktrees` gotcha if the count looks inflated).

- [ ] **Step 2: Whole-branch review**

Read every file touched across Tasks 1-9 together (not just per-task) and confirm, per the spec's own checklist:
- `brand_platform_pause.reason` now carries the real custom text end to end (Task 4 upserts it; Task 6/7's tooltip and Task 8's summary both display `pause.reason`/`row.reason` verbatim — no remaining hardcoded "Manually paused" string anywhere except as the documented fallback).
- Every former `overrideMap.get(...) === 'active'|'pause'` comparison across the whole codebase (`schedulerService.ts`, `TabScheduleSection.tsx`) was updated to `.state === ...` — grep for `overrideMap.get(` and confirm no leftover bare-string comparison remains.
- `buildOverrideSetByMap` and `pausedByFor` have zero remaining references anywhere (`grep -rn "buildOverrideSetByMap\|pausedByFor" src supabase`).
- Ask AI (`supabase/functions/ai-assistant/tools.ts`'s `get_paused_combos`) needs no change — confirm by re-reading it that it still only reads `brand_platform_pause.reason`, never `brand_platform_override` directly.
- The Edit Entry modal (`EditEntryModal.tsx`, `BrandGroup.tsx`) is untouched — confirm no diff exists in either file.

- [ ] **Step 3: Live Playwright verification against Rooster Partners / Spinjo**

Using this session's real credentials (`.env`'s `CAPTURE_EMAIL`/`CAPTURE_PASSWORD`), against the Schedule Planner's Rooster Partners tab:

1. Open Spinjo's row, click the new pause icon, check one platform, enter a reason and an until-date a few days out, Save. Confirm: the grid shows it dimmed/paused for that platform; the new "Paused Brands" button's count incremented; opening that panel shows Spinjo with the right reason and until-date.
2. Click "Resume Now" on that row. Confirm it disappears from the panel and the grid's chip returns to active immediately (no reload needed).
3. Repeat step 1 with "Permanent" instead of an until-date. Confirm the panel shows it with no until-date. Navigate to the next week (Prev/Next) and back — confirm it's still paused (this is the exact behavior that was reported broken).
4. Clean up: Resume Now the permanent test pause so Spinjo is left exactly as it was found.

Record the outcome of each step; if any step fails, treat it as systematic-debugging territory (root-cause before patching), not a quick tweak.

- [ ] **Step 4: Update `docs/task-history.md`**

Append a new `## Task <next number>: Brand+Platform Pause Reason/Duration + Paused Brands Summary` entry (following this file's existing entry format) summarizing: the root cause found (day-cycling via `PauseDaysModal` doesn't persist across weeks, unlike `brand_platform_override`), the schema addition, the fixed reason-string-matching bug in `calendarRenderer.tsx`/`TabScheduleSection.tsx`, the two new modals, and the live-verification result from Step 3. Note the pending migration deploy (`supabase db push`) if it wasn't applied live in Task 1.

- [ ] **Step 5: Update `CLAUDE.md`'s Dynamic State → Recent Changes**

Add a dated entry (today's date) mirroring the task-history entry at a summary level, per this project's established convention — check the most recent entries in that section for exact tone/format before writing.

- [ ] **Step 6: Final commit**

```bash
git add docs/task-history.md CLAUDE.md
git commit -m "docs: log brand+platform pause reason/duration task"
```
