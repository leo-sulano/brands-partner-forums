# Schedule Planner Public Holidays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block Philippine public (non-working) holidays in the Schedule Planner so no reviews are auto-scheduled or manually placed on them, and redistribute that day's posts evenly across the remaining working days.

**Architecture:** A user-editable `public_holidays` Supabase table (seeded with fixed-date national non-working holidays) is fetched wherever the scheduler runs and threaded through `TabContext` exactly like the existing `hiddenBrandSet` / `overrideMap` exclusion sets. `ensureWeekGenerated` converts the current week's holidays into an `unavailableDays: Weekday[]` list; the pure `generateWeekSchedule` engine excludes those weekdays from its `leastLoadedDay` balancing, so the same weekly post count lands on the remaining days. The calendar grid, mini-calendar preview, CSV/Excel export, and the Ask AI `get_schedule` tool all surface holidays, and a "Public Holidays" modal lets approved users add local/ad-hoc holidays with no deploy.

**Tech Stack:** Vite 6 · React 19 · TypeScript (strict) · Tailwind v4 · Supabase (Postgres + RLS + Edge Functions / Deno) · Vitest · Recharts (unaffected)

**Spec:** `docs/superpowers/specs/2026-09-02-schedule-planner-public-holidays-design.md`

## Global Constraints

- TypeScript strict mode. No `any` unless commented why.
- All Supabase queries live in `src/lib/queries.ts`; pages/components import from there, never call `supabase.from(...)` directly (the Ask AI edge function is the established exception — it has its own query layer in `tools.ts`).
- Verify builds with `npm run build`, NOT `tsc --noEmit` (root tsconfig is references-only and checks nothing).
- Every new Supabase table gets ALL FOUR RLS policies (select/insert/update/delete) in the same migration — a missing DELETE policy silently no-ops deletes with no error. Use the project's `public.is_approved()` helper for write policies (see `supabase/migrations/20260901150000_add_schedule_brand_pauses.sql`).
- Files reachable from a Deno Edge Function's import graph (`src/lib/publicHolidays.ts`, `src/lib/scheduler/*`, `src/lib/scheduleBrands.ts`, `src/lib/queries.ts`) MUST use explicit `.ts` extensions on relative imports and must not reference browser globals (`window`, `document`) even behind a `typeof` guard.
- Local-time date math only: parse `'YYYY-MM-DD'` via `.split('-').map(Number)` + `new Date(y, m-1, d)`. NEVER `Date.parse('YYYY-MM-DD')` / `new Date(iso)` / `.toISOString().slice(0,10)` — those convert through UTC and roll the date back a day in Asia/Manila (UTC+8).
- Cross-dashboard consistency: Overview / Score Summary / Brand Tabs read entry status, not the plan, and must stay untouched. The calendar grid, mini-calendar, platform-count strip, export, and Ask AI must all agree on which days are holidays.
- Ask AI logic changes ship in the same task (with tests); only `supabase functions deploy ai-assistant` may be deferred and flagged.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `supabase/migrations/20260902120000_add_public_holidays.sql` | New table + 4 RLS policies + seed | 1 |
| `src/lib/publicHolidays.ts` | Pure `PublicHoliday` type + week/date helpers (Deno-safe) | 2 |
| `src/lib/publicHolidays.test.ts` | Unit tests for the helpers | 2 |
| `src/lib/queries.ts` | `fetchPublicHolidays` / `addPublicHoliday` / `deletePublicHoliday` | 3 |
| `src/lib/scheduler/schedulerEngine.ts` | `SchedulerInput.unavailableDays` + exclude from day selection | 4 |
| `src/lib/scheduler/schedulerEngine.test.ts` | Holiday exclusion + rebalance tests | 4 |
| `src/lib/scheduler/schedulerService.ts` | `TabContext.holidayDates` + derive `unavailableDays` | 5 |
| `src/lib/scheduler/schedulerService.test.ts` | Service-level holiday test | 5 |
| `supabase/functions/generate-weekly-schedule/index.ts` | `buildTabContext` fetches holidays | 6 |
| `src/lib/scheduler/calendarRenderer.tsx` | `ScheduleCell` `holidayName?` prop → greyed read-only cell | 7 |
| `src/components/TabScheduleSection.tsx` | Fetch holidays, thread into `TabContext` + per-column `holidayName` + header marker | 8 |
| `src/pages/SchedulePlanner.tsx` | Fetch holidays, pass date set to `TabPreviewCard`, open the modal | 9, 10 |
| `src/components/TabPreviewCard.tsx` | Grey holiday columns in the mini-calendar | 9 |
| `src/components/PublicHolidaysModal.tsx` | Add/remove holidays (approved users) | 10 |
| `src/lib/scheduler/scheduleExport.ts` | `Holidays This Week` export column | 11 |
| `src/lib/scheduler/scheduleExport.test.ts` | Export column test | 11 |
| `supabase/functions/ai-assistant/tools.ts` | `get_schedule` returns week holidays + description note | 12 |
| `supabase/functions/ai-assistant/tools_test.ts` | Ask AI holiday test | 12 |
| `docs/task-history.md`, `CLAUDE.md`, spec | Task log + Recent Changes + pending-deploy notes | 13 |

---

## Task 1: `public_holidays` table + RLS + seed

**Files:**
- Create: `supabase/migrations/20260902120000_add_public_holidays.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.public_holidays(id uuid, date date unique, name text, created_by text, created_at timestamptz)`, readable by anyone, writable by `public.is_approved()`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260902120000_add_public_holidays.sql`:

```sql
-- Schedule Planner public-holiday blocking
-- (docs/superpowers/specs/2026-09-02-schedule-planner-public-holidays-design.md).
--
-- One row per non-working public holiday. Global (not per-tab): a "local"
-- holiday here means local to where the team physically sits, so it stops
-- the whole team's posting workload regardless of which tab is scheduled.
-- The Schedule Planner scheduler reads this table, converts any holiday that
-- falls on a Mon-Fri of the week being generated into an "unavailable day",
-- and load-balances that week's posts across the remaining working days.
--
-- Seeded below with FIXED-DATE national non-working holidays for 2026-2027
-- only. Movable national holidays (Holy Week, National Heroes Day, Eid'l
-- Fitr, Eid'l Adha, Chinese New Year, EDSA anniversary) AND all local/city
-- holidays are added by the team through the Public Holidays modal in the
-- app. Do NOT add "special working" days here -- this table is non-working
-- days only.

create table public.public_holidays (
  id         uuid primary key default gen_random_uuid(),
  date       date not null unique,
  name       text not null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.public_holidays enable row level security;

create policy "anyone can read public_holidays"
  on public.public_holidays for select using (true);
create policy "approved users can insert public_holidays"
  on public.public_holidays for insert with check (public.is_approved());
create policy "approved users can update public_holidays"
  on public.public_holidays for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete public_holidays"
  on public.public_holidays for delete using (public.is_approved());

insert into public.public_holidays (date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-04-09', 'Araw ng Kagitingan'),
  ('2026-05-01', 'Labor Day'),
  ('2026-06-12', 'Independence Day'),
  ('2026-08-21', 'Ninoy Aquino Day'),
  ('2026-11-01', 'All Saints'' Day'),
  ('2026-11-30', 'Bonifacio Day'),
  ('2026-12-08', 'Feast of the Immaculate Conception'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-30', 'Rizal Day'),
  ('2026-12-31', 'Last Day of the Year'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-04-09', 'Araw ng Kagitingan'),
  ('2027-05-01', 'Labor Day'),
  ('2027-06-12', 'Independence Day'),
  ('2027-08-21', 'Ninoy Aquino Day'),
  ('2027-11-01', 'All Saints'' Day'),
  ('2027-11-30', 'Bonifacio Day'),
  ('2027-12-08', 'Feast of the Immaculate Conception'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-30', 'Rizal Day'),
  ('2027-12-31', 'Last Day of the Year')
on conflict (date) do nothing;
```

- [ ] **Step 2: Verify `public.is_approved()` exists**

Run: `grep -rl "function public.is_approved\|create.*is_approved" supabase/migrations/`
Expected: at least one match (the helper is used by `schedule_brand_pauses` and others). If it does NOT exist as `public.is_approved()`, instead copy the exact predicate used by the newest existing schedule-config table migration verbatim — do not hand-write a `profiles` subquery.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260902120000_add_public_holidays.sql
git commit -m "feat: add public_holidays table for Schedule Planner holiday blocking"
```

> Applying the migration (`supabase db push`) is a deploy step handled in Task 13's checklist, not here.

---

## Task 2: `src/lib/publicHolidays.ts` pure helpers

**Files:**
- Create: `src/lib/publicHolidays.ts`
- Test: `src/lib/publicHolidays.test.ts`

**Interfaces:**
- Consumes: `WEEKDAYS`, `Weekday`, `toISODate` from `./scheduleBrands.ts`.
- Produces:
  - `interface PublicHoliday { date: string; name: string }`
  - `holidaysInWeek(weekStartISO: string, holidays: PublicHoliday[]): PublicHoliday[]`
  - `holidayWeekdaysForWeek(weekStartISO: string, holidays: PublicHoliday[]): Weekday[]`
  - `holidayWeekdaysForDateSet(weekStartISO: string, dates: Set<string>): Weekday[]`
  - `holidayOn(dateISO: string, holidays: PublicHoliday[]): PublicHoliday | undefined`
  - `buildHolidayDateSet(rows: PublicHoliday[]): Set<string>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/publicHolidays.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  holidaysInWeek,
  holidayWeekdaysForWeek,
  holidayWeekdaysForDateSet,
  holidayOn,
  buildHolidayDateSet,
  type PublicHoliday,
} from './publicHolidays';

// Week of Monday 2026-09-07 .. Friday 2026-09-11.
const WEEK = '2026-09-07';

const HOLIDAYS: PublicHoliday[] = [
  { date: '2026-09-09', name: 'Wednesday Holiday' }, // in-week Wed
  { date: '2026-09-12', name: 'Saturday Holiday' },  // in-week Sat (no column)
  { date: '2026-09-16', name: 'Next Week Holiday' }, // out of week
];

describe('publicHolidays', () => {
  it('holidaysInWeek returns only Mon-Fri holidays inside the week', () => {
    expect(holidaysInWeek(WEEK, HOLIDAYS).map((h) => h.name)).toEqual(['Wednesday Holiday']);
  });

  it('holidayWeekdaysForWeek maps in-week holidays to weekday enum values', () => {
    expect(holidayWeekdaysForWeek(WEEK, HOLIDAYS)).toEqual(['wednesday']);
  });

  it('holidayWeekdaysForWeek returns [] when no holiday lands on a weekday of the week', () => {
    expect(holidayWeekdaysForWeek(WEEK, [{ date: '2026-09-12', name: 'Sat' }])).toEqual([]);
  });

  it('handles two holidays in one week', () => {
    const two: PublicHoliday[] = [
      { date: '2026-09-07', name: 'Mon' },
      { date: '2026-09-10', name: 'Thu' },
    ];
    expect(holidayWeekdaysForWeek(WEEK, two).sort()).toEqual(['monday', 'thursday']);
  });

  it('holidayWeekdaysForDateSet matches holidayWeekdaysForWeek for the same dates', () => {
    const set = new Set(['2026-09-09', '2026-09-12', '2026-09-16']);
    expect(holidayWeekdaysForDateSet(WEEK, set)).toEqual(['wednesday']);
  });

  it('holidayOn returns the holiday for an exact date, else undefined', () => {
    expect(holidayOn('2026-09-09', HOLIDAYS)?.name).toBe('Wednesday Holiday');
    expect(holidayOn('2026-09-08', HOLIDAYS)).toBeUndefined();
  });

  it('buildHolidayDateSet returns a set of ISO date strings', () => {
    const set = buildHolidayDateSet(HOLIDAYS);
    expect(set.has('2026-09-09')).toBe(true);
    expect(set.size).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/publicHolidays.test.ts`
Expected: FAIL — `Cannot find module './publicHolidays'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/publicHolidays.ts`:

```ts
import { WEEKDAYS, toISODate, type Weekday } from './scheduleBrands.ts';

export interface PublicHoliday {
  date: string; // 'YYYY-MM-DD'
  name: string;
}

// The five real calendar dates (Mon..Fri) of the week starting weekStartISO.
// Local-time only — never Date.parse on the ISO string (UTC rollback bug).
function weekdayDatesOf(weekStartISO: string): string[] {
  const [y, m, d] = weekStartISO.split('-').map(Number);
  const monday = new Date(y, m - 1, d);
  return WEEKDAYS.map((_, i) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);
    return toISODate(day);
  });
}

export function buildHolidayDateSet(rows: PublicHoliday[]): Set<string> {
  return new Set(rows.map((r) => r.date));
}

export function holidayOn(dateISO: string, holidays: PublicHoliday[]): PublicHoliday | undefined {
  return holidays.find((h) => h.date === dateISO);
}

export function holidaysInWeek(weekStartISO: string, holidays: PublicHoliday[]): PublicHoliday[] {
  const inWeek = new Set(weekdayDatesOf(weekStartISO));
  return holidays.filter((h) => inWeek.has(h.date));
}

export function holidayWeekdaysForDateSet(weekStartISO: string, dates: Set<string>): Weekday[] {
  const weekdayDates = weekdayDatesOf(weekStartISO);
  const out: Weekday[] = [];
  weekdayDates.forEach((iso, i) => {
    if (dates.has(iso)) out.push(WEEKDAYS[i]);
  });
  return out;
}

export function holidayWeekdaysForWeek(weekStartISO: string, holidays: PublicHoliday[]): Weekday[] {
  return holidayWeekdaysForDateSet(weekStartISO, buildHolidayDateSet(holidays));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/publicHolidays.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/publicHolidays.ts src/lib/publicHolidays.test.ts
git commit -m "feat: add publicHolidays helpers (week/date resolution)"
```

---

## Task 3: `queries.ts` — fetch / add / delete public holidays

**Files:**
- Modify: `src/lib/queries.ts` (add near `fetchScheduleHiddenBrands`, ~line 256; import `PublicHoliday` type at top with the other `src/lib` type imports)

**Interfaces:**
- Consumes: `PublicHoliday` from `./publicHolidays.ts`; `supabase`, `SupabaseClient` (already imported in `queries.ts`).
- Produces:
  - `fetchPublicHolidays(client?: SupabaseClient): Promise<(PublicHoliday & { id: string })[]>`
  - `addPublicHoliday(date: string, name: string, actorEmail: string | null, client?: SupabaseClient): Promise<void>`
  - `deletePublicHoliday(id: string, client?: SupabaseClient): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/queries.publicHolidays.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// Minimal chainable Supabase mock: from().select().order() resolves to { data, error }.
function mockClient(rows: unknown[]) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { from } as never;
}

describe('fetchPublicHolidays', () => {
  it('selects id,date,name ordered by date and returns the rows', async () => {
    const { fetchPublicHolidays } = await import('./queries');
    const rows = [{ id: 'a', date: '2026-01-01', name: "New Year's Day" }];
    const client = mockClient(rows);
    const result = await fetchPublicHolidays(client);
    expect(result).toEqual(rows);
  });
});
```

> If `queries.ts` has no existing unit-test file pattern that mocks the client this way, instead add these three functions with **no** dedicated test (matching how `fetchScheduleHiddenBrands` / `fetchScheduleRestrictedBrands` have none) and rely on Task 8's live verification. In that case skip Steps 1-2 and 4 here and just do Steps 3 and 5. Check first: `ls src/lib/queries*.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/queries.publicHolidays.test.ts`
Expected: FAIL — `fetchPublicHolidays` is not exported.

- [ ] **Step 3: Write the implementation**

At the top of `src/lib/queries.ts`, add to the existing import block:

```ts
import type { PublicHoliday } from './publicHolidays.ts';
```

After `fetchScheduleRestrictedBrands` (~line 278) add:

```ts
export async function fetchPublicHolidays(
  client: SupabaseClient = supabase,
): Promise<(PublicHoliday & { id: string })[]> {
  const { data, error } = await client
    .from('public_holidays')
    .select('id, date, name')
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as (PublicHoliday & { id: string })[];
}

export async function addPublicHoliday(
  date: string,
  name: string,
  actorEmail: string | null,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client
    .from('public_holidays')
    .insert({ date, name: name.trim(), created_by: actorEmail });
  if (error) throw error;
}

export async function deletePublicHoliday(
  id: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  // Supabase silently no-ops an RLS-blocked delete — assert a row was removed.
  const { data, error } = await client
    .from('public_holidays')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Holiday not deleted — you may not have permission.');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/queries.publicHolidays.test.ts`
Expected: PASS (or skipped per the Step 1 note).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.publicHolidays.test.ts
git commit -m "feat: add fetch/add/delete public holiday query functions"
```

---

## Task 4: Engine — `unavailableDays` input

**Files:**
- Modify: `src/lib/scheduler/schedulerEngine.ts` (`SchedulerInput`, `generateWeekSchedule`, `selectDays`)
- Test: `src/lib/scheduler/schedulerEngine.test.ts`

**Interfaces:**
- Consumes: `WEEKDAYS`, `Weekday` (already imported).
- Produces: `SchedulerInput.unavailableDays: Weekday[]` — holiday weekdays that must receive zero slots. `generateWeekSchedule` never assigns a slot on a day in this list and redistributes that platform's remaining posts across the other weekdays, load-balanced. Returns `[]` when every weekday is unavailable.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduler/schedulerEngine.test.ts` (the `baseInput` const at the top does NOT include `unavailableDays` yet — add it there too: `unavailableDays: []`). New cases inside the `describe` block:

```ts
  it('never assigns a slot on an unavailable (holiday) weekday', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['tp'],
      unavailableDays: ['thursday'],
    };
    const days = slotsFor(generateWeekSchedule(input), 'WinMega', 'tp').map((s) => s.day);
    expect(days).not.toContain('thursday');
  });

  it('preserves the weekly post count when a preferred day is unavailable (redistributes)', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['tp'], // 2 posts/week
      unavailableDays: ['thursday'],
    };
    expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'tp')).toHaveLength(2);
  });

  it('balances load across only the available days', () => {
    const input: SchedulerInput = {
      brands: ['A', 'B', 'C', 'D', 'E'],
      activePlatforms: ['ag'], // 2/week each -> 10 slots
      pinnedBrandPlatforms: [],
      pausedBrandPlatforms: [],
      resumingBrandPlatforms: [],
      carryover: [],
      unavailableDays: ['friday'],
    };
    const counts: Record<string, number> = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 };
    for (const s of generateWeekSchedule(input)) counts[s.day] += 1;
    expect(counts.friday).toBe(0);
    // 10 slots across 4 available days, balanced: within 1 of each other.
    const active = [counts.monday, counts.tuesday, counts.wednesday, counts.thursday];
    expect(Math.max(...active) - Math.min(...active)).toBeLessThanOrEqual(1);
  });

  it('caps posts when fewer available days remain than the platform frequency', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['wo'], // 1/week — unaffected
      unavailableDays: ['monday', 'tuesday', 'wednesday', 'thursday'],
    };
    const slots = slotsFor(generateWeekSchedule(input), 'WinMega', 'wo');
    expect(slots).toHaveLength(1);
    expect(slots[0].day).toBe('friday');
  });

  it('returns no slots at all when every weekday is unavailable', () => {
    const input: SchedulerInput = {
      ...baseInput,
      activePlatforms: ['tp', 'ag', 'cg', 'wo'],
      unavailableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    };
    expect(generateWeekSchedule(input)).toHaveLength(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/schedulerEngine.test.ts`
Expected: FAIL — TS error "unavailableDays is missing" and/or holiday days still assigned.

- [ ] **Step 3: Implement**

In `src/lib/scheduler/schedulerEngine.ts`:

1. Add to `SchedulerInput`:

```ts
export interface SchedulerInput {
  brands: string[];
  activePlatforms: Platform[];
  pinnedBrandPlatforms: PinnedCombo[];
  pausedBrandPlatforms: PinnedCombo[];
  resumingBrandPlatforms: PinnedCombo[];
  carryover: CarryoverItem[];
  // Weekdays that fall on a public holiday this week — receive zero slots.
  // The engine redistributes each platform's normal weekly post count across
  // the remaining days via the same leastLoadedDay balancing.
  unavailableDays: Weekday[];
}
```

2. Change `selectDays` to take the available-day list and confine both pools to it:

```ts
function selectDays(
  rule: PlatformRule,
  numSlots: number,
  dayCounts: Record<Weekday, number>,
  availableDays: Weekday[],
): Weekday[] {
  const preferredPool: Weekday[] = (rule.preferredDayPairs
    ? [...new Set(rule.preferredDayPairs.flat())]
    : rule.preferredDays
      ? [...rule.preferredDays]
      : [...WEEKDAYS]
  ).filter((d) => availableDays.includes(d));

  const chosen: Weekday[] = [];
  for (let i = 0; i < numSlots; i++) {
    const overallAvailable = availableDays.filter((d) => !chosen.includes(d));
    if (overallAvailable.length === 0) break;
    const preferredAvailable = preferredPool.filter((d) => !chosen.includes(d));

    let pick: Weekday;
    if (preferredAvailable.length === 0) {
      pick = leastLoadedDay(dayCounts, overallAvailable);
    } else {
      const preferredBest = leastLoadedDay(dayCounts, preferredAvailable);
      const overallBest = leastLoadedDay(dayCounts, overallAvailable);
      pick = dayCounts[preferredBest] - dayCounts[overallBest] >= DAY_SLACK ? overallBest : preferredBest;
    }
    chosen.push(pick);
    dayCounts[pick] += 1;
  }
  return chosen;
}
```

3. In `generateWeekSchedule`, compute `availableDays` once and pass it through `assign`:

```ts
export function generateWeekSchedule(input: SchedulerInput): ScheduledSlot[] {
  const dayCounts: Record<Weekday, number> = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 };
  const availableDays = WEEKDAYS.filter((d) => !input.unavailableDays.includes(d));
  const slots: ScheduledSlot[] = [];
  const brandKeys = input.brands.map((brand) => ({ brand, brandKey: normalizeBrandKey(brand) }));
  // ...carryoverMap unchanged...

  function assign(brand: string, brandKey: string, platform: Platform, numSlots: number) {
    if (numSlots <= 0) return;
    if (availableDays.length === 0) return;
    const days = selectDays(PLATFORM_RULES[platform], numSlots, dayCounts, availableDays);
    for (const day of days) slots.push({ brand, brandKey, platform, day });
  }
  // ...rest unchanged...
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/schedulerEngine.test.ts`
Expected: PASS (all prior tests + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/schedulerEngine.ts src/lib/scheduler/schedulerEngine.test.ts
git commit -m "feat: exclude holiday weekdays from schedule generation + rebalance"
```

---

## Task 5: Service — `TabContext.holidayDates` → engine

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts` (`TabContext`, `ensureWeekGenerated`, imports)
- Test: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes: `holidayWeekdaysForDateSet` from `../publicHolidays.ts`; `SchedulerInput.unavailableDays` (Task 4).
- Produces: `TabContext.holidayDates?: Set<string>` (ISO date strings; optional, defaults to "no holidays"). `ensureWeekGenerated` passes the derived `unavailableDays` into `generateWeekSchedule`. `recalculatePauses` is unchanged.

- [ ] **Step 1: Write the failing test**

Find how `schedulerService.test.ts` builds a `TabContext` and calls `ensureWeekGenerated` (search for `ensureWeekGenerated(`). Add one test alongside the existing ones, following that file's existing mock-client + fixture style. Skeleton (adapt the fixture wiring to match the file):

```ts
it('ensureWeekGenerated never writes an active status on a holiday weekday', async () => {
  // weekStart Monday 2026-09-07; 2026-09-09 (Wed) is a holiday.
  const ctx = makeCtx({
    brands: ['WinMega'],
    activePlatforms: ['ag'], // AG = 2/week, no preferred days
    entries: [],
    holidayDates: new Set(['2026-09-09']),
  });
  const client = makeMockClient(/* no existing brand_schedule rows */);
  await ensureWeekGenerated('TP Brand Injection', '2026-09-07', ctx, [], client);

  const written = capturedUpsertRows(client); // the rows passed to bulkUpsertBrandSchedule
  const agRow = written.find((r) => r.platform === 'ag');
  expect(agRow.wednesday).toBeNull();
  // still got its full weekly count on the other days
  const activeDays = ['monday', 'tuesday', 'thursday', 'friday'].filter((d) => agRow[d] === 'active');
  expect(activeDays).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: FAIL — `holidayDates` not a known `TabContext` field / Wednesday still written.

- [ ] **Step 3: Implement**

In `src/lib/scheduler/schedulerService.ts`:

1. Add the import (keep alphabetical-ish grouping with the other `../` imports):

```ts
import { holidayWeekdaysForDateSet } from '../publicHolidays.ts';
```

2. Add to `TabContext`:

```ts
  // ISO date strings ('YYYY-MM-DD') of every public holiday. Any that falls
  // on a Mon-Fri of the week being generated becomes an unavailable day for
  // the engine. Optional — defaults to "no holidays" — same convention as
  // removedPlatformBrandSet / overrideMap / hiddenBrandSet above.
  holidayDates?: Set<string>;
```

3. In `ensureWeekGenerated`, just before the `generateWeekSchedule({ ... })` call:

```ts
  const unavailableDays = holidayWeekdaysForDateSet(weekStart, ctx.holidayDates ?? new Set());

  const slots = generateWeekSchedule({
    brands: ctx.brands,
    activePlatforms: ctx.activePlatforms,
    pinnedBrandPlatforms: [...alreadyHasRowCombos, ...removedCombos, ...excludedCombos],
    pausedBrandPlatforms,
    resumingBrandPlatforms: resumedThisWeek,
    carryover,
    unavailableDays,
  });
```

4. Search the rest of the repo for other `generateWeekSchedule({` call sites and add `unavailableDays: []` (or a real value) so the build stays green:

Run: `grep -rn "generateWeekSchedule(" src/ supabase/`
Expected call sites: `schedulerService.ts` (done above) and `schedulerEngine.test.ts` (done in Task 4). If any other exists, pass `unavailableDays: []`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: PASS.

- [ ] **Step 5: Full scheduler suite + build**

Run: `npx vitest run src/lib/scheduler/ && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
git commit -m "feat: thread public holidays through TabContext into schedule generation"
```

---

## Task 6: `generate-weekly-schedule` edge function fetches holidays

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts` (`buildTabContext`)

**Interfaces:**
- Consumes: `fetchPublicHolidays` (Task 3), `buildHolidayDateSet` (Task 2), `TabContext.holidayDates` (Task 5).
- Produces: the cron path now respects holidays once redeployed.

- [ ] **Step 1: Add imports**

In `supabase/functions/generate-weekly-schedule/index.ts`, extend the existing `queries.ts` import and add the helper import:

```ts
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, fetchBrandAgentAssignments, fetchPublicHolidays, invalidateTabCache } from '../../../src/lib/queries.ts';
import { buildHolidayDateSet } from '../../../src/lib/publicHolidays.ts';
```

- [ ] **Step 2: Fetch + attach in `buildTabContext`**

Add `fetchPublicHolidays(client)` to the `Promise.all` array and destructure it, then set it on the returned context:

```ts
  const [rawEntries, headers, removedPlatformBrandRows, overrideRows, hiddenBrandRows, restrictedBrandRows, holidayRows] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchTabHeaders(tab, client),
    fetchRemovedPlatformBrands(client),
    fetchBrandPlatformOverrides(tab, client),
    fetchScheduleHiddenBrands(tab, client),
    fetchScheduleRestrictedBrands(tab, client),
    fetchPublicHolidays(client),
  ]);
```

```ts
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
    holidayDates: buildHolidayDateSet(holidayRows),
  };
```

> Note: this fetch is NOT wrapped in a best-effort `.catch()` — a failed holiday fetch must fail the tab's generation for that run (caught by `generateAllTabs`'s per-tab `try/catch`), never silently proceed and schedule onto a holiday. This matches how `fetchRawEntriesByTab` / `fetchTabHeaders` are treated here, not how `fetchBrandAgentAssignments` (purely informational) is.

- [ ] **Step 3: Deno type-check**

Run:
```
deno check --no-lock --node-modules-dir=none \
  --config supabase/functions/generate-weekly-schedule/deno.json \
  supabase/functions/generate-weekly-schedule/index.ts
```
Expected: no errors. (If `deno` is unavailable in the environment, note it and rely on Task 13's deploy-time check.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean (the frontend build also compiles the shared `src/lib` files this function imports).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts
git commit -m "feat: generate-weekly-schedule respects public holidays"
```

---

## Task 7: `ScheduleCell` holiday-day rendering

**Files:**
- Modify: `src/lib/scheduler/calendarRenderer.tsx` (`ScheduleCellProps`, `ScheduleCell` body)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ScheduleCellProps.holidayName?: string`. When set, the cell renders greyed, shows a "Holiday" tag + the name (via the shared `Tooltip`), renders no "+ Add Platform" button, and is non-interactive. Existing chips still render, dimmed. Callers still pass `onToggle` etc. — they are simply never wired to a click.

- [ ] **Step 1: Add the prop**

In `interface ScheduleCellProps`, after `isPastDay: boolean;`:

```ts
  // Set when this cell's calendar date is a public holiday. The cell renders
  // greyed and read-only (no cycle, no "+ Add Platform"); the name is shown
  // on hover. Any pre-existing chips (a legacy week, or a chip added before
  // this date was listed as a holiday) still render, dimmed — never deleted.
  holidayName?: string;
```

- [ ] **Step 2: Make the cell read-only + greyed when `holidayName` is set**

In the `ScheduleCell` function body, find `const clickable = isApproved;` (~line 278) and change to:

```ts
  const clickable = isApproved && !holidayName;
```

Find the `{isApproved && addable.length > 0 && (` block (~line 396) that renders the "+ Add Platform" button and change its guard to:

```ts
  {isApproved && !holidayName && addable.length > 0 && (
```

Wrap the cell's outer container so a holiday day is visually greyed and carries a tooltip. Locate the top-level returned element of `ScheduleCell` (the outer `<div>`), add a class toggle and a wrapping `Tooltip`. Example (adapt to the actual outer element / existing `Tooltip` usage in this file):

```tsx
  const content = (
    <div className={`flex flex-col gap-1 ${holidayName ? 'opacity-40' : ''}`}>
      {/* ...existing cell body... */}
    </div>
  );

  if (holidayName) {
    return (
      <Tooltip content={`Public holiday · ${holidayName}`}>
        <div className="rounded bg-slate-100 px-1 py-0.5">
          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Holiday
          </span>
          {content}
        </div>
      </Tooltip>
    );
  }
  return content;
```

> `Tooltip` is already imported in this file (used elsewhere). If the outer element is not a `<div>` or the structure differs, keep the intent: greyed background + "Holiday" label + name tooltip + the existing body unchanged beneath it.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Run the scheduler UI test suite (if the file has one)**

Run: `npx vitest run src/lib/scheduler/`
Expected: green (no existing test should break — the prop is optional).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/calendarRenderer.tsx
git commit -m "feat: render Schedule Planner holiday days greyed and read-only"
```

---

## Task 8: `TabScheduleSection` — fetch, thread, and mark holidays

**Files:**
- Modify: `src/components/TabScheduleSection.tsx`

**Interfaces:**
- Consumes: `fetchPublicHolidays` (Task 3), `buildHolidayDateSet` / `holidayOn` / `PublicHoliday` (Task 2), `TabContext.holidayDates` (Task 5), `ScheduleCell` `holidayName` (Task 7).
- Produces: holidays fetched once per tab load, held in state, put on the `TabContext` passed to `recalculatePauses` / `ensureWeekGenerated`, and passed per-column into each `ScheduleCell`. The weekday-number header row marks holiday columns.

- [ ] **Step 1: Add imports + state**

Add imports:

```ts
import { fetchPublicHolidays } from '../lib/queries';
import { buildHolidayDateSet, holidayOn, type PublicHoliday } from '../lib/publicHolidays';
```

Add state near the other schedule state (e.g. next to `pauses` / `cancellations`):

```ts
const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
const holidayDateSet = useMemo(() => buildHolidayDateSet(holidays), [holidays]);
```

- [ ] **Step 2: Fetch holidays in the brand-loading effect**

In the brand-loading effect's `Promise.all` (the one around line 255 that also fetches `fetchRemovedPlatformBrands` etc.), add `fetchPublicHolidays()` — wrapped in `withFlagFallback` so a transient failure sets `flagsLoaded = false` and gates the scheduler-invocation effect (same protection the other exclusion sets get):

```ts
        const [rawEntries, headers, removedPlatformBrandRows, overrideRows, hiddenBrandRows, restrictedBrandRows, agentAssignmentRows, holidayRows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          withFlagFallback(fetchRemovedPlatformBrands()),
          withFlagFallback(fetchBrandPlatformOverrides(tab)),
          withFlagFallback(fetchScheduleHiddenBrands(tab)),
          withFlagFallback(fetchScheduleRestrictedBrands(tab)),
          fetchBrandAgentAssignments(tab).catch(() => []),
          withFlagFallback(fetchPublicHolidays()),
        ]);
```

Then, alongside the existing `setTabCtx({ ... })`, also:

```ts
        if (canceled) return;
        setHolidays(holidayRows);
```

- [ ] **Step 3: Put `holidayDates` on the scheduler `TabContext`**

In the schedule-loading effect where the local `const ctx: TabContext = { ... }` is built (~line 335), add:

```ts
          const ctx: TabContext = {
            brands: tabCtx!.brands,
            activePlatforms: tabCtx!.activePlatforms,
            entries: tabCtx!.entries,
            removedPlatformBrandSet: tabCtx!.removedPlatformBrandSet,
            overrideMap: tabCtx!.overrideMap,
            hiddenBrandSet: tabCtx!.hiddenBrandSet,
            platformRestrictionMap: tabCtx!.platformRestrictionMap,
            holidayDates: holidayDateSet,
          };
```

Add `holidayDateSet` to that effect's dependency array.

> The `TabCtxState` object set by `setTabCtx` does not itself need a `holidayDates` field — `holidays` is separate React state and the scheduler `ctx` is assembled fresh in this effect. This mirrors how `agentAssignments` is already handled separately from `tabCtx`.

- [ ] **Step 4: Pass `holidayName` into every `ScheduleCell`**

In the day-cell render loop (~line 1120, inside `columns.map((col) => { ... })`), compute the holiday for the column's real date and pass it:

```tsx
                    {columns.map((col) => {
                      const dayISO = col.iso;
                      const holidayName = holidayOn(dayISO, holidays)?.name;
                      const { rowsByPlatform, pausesByPlatform, pausedByPlatform } = computeCellData(brand, col.weekStartISO);
                      // ...existing computeRemovedByPlatform etc...
                      return (
                        <td key={col.iso} className="px-3 py-2 text-left align-top">
                          <ScheduleCell
                            /* ...existing props... */
                            isApproved={isApproved && !isLegacyWeekAt(col.weekStartISO)}
                            holidayName={holidayName}
                            /* ...existing handlers... */
                          />
```

- [ ] **Step 5: Mark holiday columns in the header**

In the weekday-number header row (`columns.map((col) => ( <th ...>{Number(col.iso.slice(8, 10))}</th> ))`, ~line 1046), grey the holiday column and add a tooltip:

```tsx
              {columns.map((col) => {
                const h = holidayOn(col.iso, holidays);
                return (
                  <th
                    key={col.iso}
                    className={`sticky z-[25] px-3 py-1 text-center text-xs font-medium will-change-transform ${h ? 'bg-slate-200 text-slate-400' : 'bg-slate-50 text-slate-500'}`}
                    style={{ top: toolbarHeight + monthHeaderHeight + weekdayHeaderHeight }}
                    title={h ? `Public holiday · ${h.name}` : undefined}
                  >
                    {Number(col.iso.slice(8, 10))}
                  </th>
                );
              })}
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "feat: fetch + mark public holidays in the Schedule Planner grid"
```

---

## Task 9: `SchedulePlanner` + `TabPreviewCard` — grey holiday columns in the mini-calendar

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx` (fetch holidays, pass a date set to `TabPreviewCard`)
- Modify: `src/components/TabPreviewCard.tsx` (`Props`, header + body column render)

**Interfaces:**
- Consumes: `fetchPublicHolidays` (Task 3), `buildHolidayDateSet` (Task 2).
- Produces: `TabPreviewCard` `Props.holidayDateSet: Set<string>`; holiday columns render greyed in the preview mini-calendar. Counts already read 0 there (`countActivePlatformSlots`), so nothing else changes.

- [ ] **Step 1: Fetch holidays in `SchedulePlanner.tsx`**

Add import + state + a fetch effect (the page already has similar one-shot fetch effects, e.g. `paused_tabs`):

```ts
import { fetchPublicHolidays } from '../lib/queries';
import { buildHolidayDateSet, type PublicHoliday } from '../lib/publicHolidays';
```

```ts
const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
const holidayDateSet = useMemo(() => buildHolidayDateSet(holidays), [holidays]);

useEffect(() => {
  let canceled = false;
  fetchPublicHolidays()
    .then((rows) => { if (!canceled) setHolidays(rows); })
    .catch(() => { /* preview greying is cosmetic — ignore a transient failure */ });
  return () => { canceled = true; };
}, []);
```

- [ ] **Step 2: Pass it to both `TabPreviewCard` render sites**

Both `<TabPreviewCard ... />` usages (~line 720 and ~line 769) get:

```tsx
  holidayDateSet={holidayDateSet}
```

- [ ] **Step 3: Accept + use the prop in `TabPreviewCard.tsx`**

Add to `interface Props`:

```ts
  holidayDateSet: Set<string>;
```

Destructure it in the component signature, then in BOTH the weekday-letter header row and the weekday-number header row (`allRangeColumns.map((col) => ( <th key={col.iso} ...> ))`, ~lines 105 and 114), and in the body cell map (~line 144, `allRangeColumns.map((col) => { ... })`), grey the holiday column. Header example:

```tsx
              {allRangeColumns.map((col) => (
                <th
                  key={col.iso}
                  className={`px-1 py-1 text-center font-medium whitespace-nowrap ${holidayDateSet.has(col.iso) ? 'bg-slate-200 text-slate-400' : ''}`}
                >
                  {WEEKDAY_LABELS[col.weekday][0]}
                </th>
              ))}
```

Body cell example (keep the existing `<td>` content; just add the class):

```tsx
                <td
                  key={col.iso}
                  className={`px-0.5 py-1 text-center ${holidayDateSet.has(col.iso) ? 'bg-slate-100' : ''}`}
                >
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean. (If any other `TabPreviewCard` consumer exists — `grep -rn "TabPreviewCard" src/` — pass it `holidayDateSet={new Set()}` or a real set.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/SchedulePlanner.tsx src/components/TabPreviewCard.tsx
git commit -m "feat: grey public-holiday columns in the Schedule Planner preview grid"
```

---

## Task 10: "Public Holidays" management modal

**Files:**
- Create: `src/components/PublicHolidaysModal.tsx`
- Modify: `src/pages/SchedulePlanner.tsx` (toolbar button + modal wiring + refetch on close)

**Interfaces:**
- Consumes: `fetchPublicHolidays` / `addPublicHoliday` / `deletePublicHoliday` (Task 3), `useAuth` (for approved gate + actor email), the shared `Toast` component.
- Produces: `<PublicHolidaysModal open onClose />` — lists all holidays (date · name · Remove), an add form (date input + name input + Add). On any mutation it refetches and calls `onChanged()` so the page updates its `holidays` state.

- [ ] **Step 1: Create the modal**

Create `src/components/PublicHolidaysModal.tsx`. Follow `PauseDaysModal.tsx` for structure (backdrop, `Esc`/overlay close via the `useEffect` keydown pattern, z-index above the mobile drawer — check `PauseDaysModal.tsx`'s wrapper classes and reuse them verbatim):

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchPublicHolidays, addPublicHoliday, deletePublicHoliday } from '../lib/queries';
import type { PublicHoliday } from '../lib/publicHolidays';
import Toast from './Toast';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

type Row = PublicHoliday & { id: string };

export default function PublicHolidaysModal({ open, onClose, onChanged }: Props) {
  const { profile } = useAuth();
  const isApproved = !!profile?.approved;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: 'error' | 'success' } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchPublicHolidays()
      .then(setRows)
      .catch((e) => setToast({ message: e instanceof Error ? e.message : 'Failed to load', kind: 'error' }))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  async function refetch() {
    const fresh = await fetchPublicHolidays();
    setRows(fresh);
    onChanged();
  }

  async function handleAdd() {
    if (!date || !name.trim()) return;
    setBusy(true);
    try {
      await addPublicHoliday(date, name, profile?.email ?? null);
      setDate('');
      setName('');
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add';
      setToast({ message: /duplicate|unique/i.test(msg) ? 'That date is already listed.' : msg, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await deletePublicHoliday(id);
      await refetch();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Failed to remove', kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Public Holidays</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Non-working days only. No reviews are scheduled on these dates and the week's
          workload is spread across the remaining days. Add local / city holidays here too.
        </p>

        {isApproved && (
          <div className="mb-4 flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-sm" />
            <input type="text" value={name} placeholder="Holiday name"
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
            <button onClick={handleAdd} disabled={busy || !date || !name.trim()}
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
              Add
            </button>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <p className="py-4 text-center text-sm text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No holidays listed.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-slate-700"><span className="font-mono text-slate-500">{r.date}</span> — {r.name}</span>
                  {isApproved && (
                    <button onClick={() => handleDelete(r.id)} disabled={busy}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50">
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {toast && <Toast message={toast.message} kind={toast.kind} onDone={() => setToast(null)} />}
    </div>
  );
}
```

> Verify the real prop names of `useAuth()` (`profile.approved`, `profile.email`) and `Toast` (`kind` vs `type`, `onDone` vs `onClose`) against existing usage in `PauseDaysModal.tsx` / `AddPlatformModal.tsx` and adjust. Match `PauseDaysModal.tsx`'s exact backdrop wrapper/z-index classes rather than the placeholder above if they differ.

- [ ] **Step 2: Wire the toolbar button in `SchedulePlanner.tsx`**

Add state:

```ts
const [holidaysModalOpen, setHolidaysModalOpen] = useState(false);
```

Add a button in the Schedule Planner toolbar area (near the week nav / export controls):

```tsx
<button
  onClick={() => setHolidaysModalOpen(true)}
  className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
>
  Public Holidays
</button>
```

Render the modal (top level of the page's JSX), refreshing the page's `holidays` state on change:

```tsx
<PublicHolidaysModal
  open={holidaysModalOpen}
  onClose={() => setHolidaysModalOpen(false)}
  onChanged={() => {
    fetchPublicHolidays().then(setHolidays).catch(() => {});
  }}
/>
```

Add the import:

```ts
import PublicHolidaysModal from '../components/PublicHolidaysModal';
```

- [ ] **Step 3: Build + manual smoke**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/PublicHolidaysModal.tsx src/pages/SchedulePlanner.tsx
git commit -m "feat: Public Holidays management modal on the Schedule Planner"
```

---

## Task 11: Export — `Holidays This Week` column

**Files:**
- Modify: `src/lib/scheduler/scheduleExport.ts`
- Test: `src/lib/scheduler/scheduleExport.test.ts`
- Modify: the export call site (search `buildScheduleExportRows(` — currently in `TabScheduleSection.tsx` and/or `SchedulePlanner.tsx`)

**Interfaces:**
- Consumes: `holidaysInWeek` (Task 2).
- Produces: `buildScheduleExportRows(data: ScheduleExportBrandData[], holidaysThisWeek?: string): string[][]` — every emitted row gains a trailing cell equal to `holidaysThisWeek ?? ''`. `SCHEDULE_EXPORT_HEADERS` gains a trailing `'Holidays This Week'`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scheduler/scheduleExport.test.ts`:

```ts
it('adds a Holidays This Week column carrying the joined holiday names', () => {
  const data = [{
    brand: 'WinMega',
    platforms: ['tp' as const],
    rowsByPlatform: {},
    pausesByPlatform: {},
    removedPlatforms: [],
  }];
  const rows = buildScheduleExportRows(data, "New Year's Day, Rizal Day");
  expect(SCHEDULE_EXPORT_HEADERS[SCHEDULE_EXPORT_HEADERS.length - 1]).toBe('Holidays This Week');
  expect(rows[0][rows[0].length - 1]).toBe("New Year's Day, Rizal Day");
});

it('leaves the Holidays This Week column blank when none passed', () => {
  const data = [{
    brand: 'WinMega',
    platforms: ['tp' as const],
    rowsByPlatform: {},
    pausesByPlatform: {},
    removedPlatforms: [],
  }];
  const rows = buildScheduleExportRows(data);
  expect(rows[0][rows[0].length - 1]).toBe('');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scheduler/scheduleExport.test.ts`
Expected: FAIL — header length / trailing cell mismatch.

- [ ] **Step 3: Implement**

In `src/lib/scheduler/scheduleExport.ts`:

```ts
export const SCHEDULE_EXPORT_HEADERS = [
  'Brand', 'Platform', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Paused This Week', 'Page Removed',
  'Mon Evidence', 'Tue Evidence', 'Wed Evidence', 'Thu Evidence', 'Fri Evidence',
  'Holidays This Week',
];
```

```ts
export function buildScheduleExportRows(
  data: ScheduleExportBrandData[],
  holidaysThisWeek = '',
): string[][] {
  const rows: string[][] = [];
  for (const { brand, platforms, rowsByPlatform, pausesByPlatform, removedPlatforms, evidenceByPlatform } of data) {
    for (const platform of platforms) {
      const row = rowsByPlatform[platform];
      const evidence = evidenceByPlatform?.[platform];
      rows.push([
        brand,
        PLATFORM_FULL_LABEL[platform],
        dayStatusLabel(row?.monday),
        dayStatusLabel(row?.tuesday),
        dayStatusLabel(row?.wednesday),
        dayStatusLabel(row?.thursday),
        dayStatusLabel(row?.friday),
        pausesByPlatform[platform] ? 'Y' : 'N',
        removedPlatforms.includes(platform) ? 'Y' : 'N',
        ...WEEKDAYS.map((wd) => evidenceLabel(evidence?.[wd])),
        holidaysThisWeek,
      ]);
    }
  }
  return rows;
}
```

- [ ] **Step 4: Update the call site(s)**

Run: `grep -rn "buildScheduleExportRows(" src/`
At each call site, compute the week's holidays and pass the joined names. The caller has the displayed week (`weekStartISO`) and (after Task 8/9) a `holidays` array in scope:

```ts
import { holidaysInWeek } from '../lib/publicHolidays';
// ...
const holidaysThisWeek = holidaysInWeek(weekStartISO, holidays).map((h) => h.name).join(', ');
const rows = buildScheduleExportRows(exportData, holidaysThisWeek);
```

> If the export runs over a multi-week date range rather than a single week, pass the union across all weeks in range: `[...new Set(columns.flatMap((c) => holidayOn(c.iso, holidays)?.name ? [holidayOn(c.iso, holidays)!.name] : []))].join(', ')`.

- [ ] **Step 5: Run test + build**

Run: `npx vitest run src/lib/scheduler/scheduleExport.test.ts && npm run build`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/scheduleExport.ts src/lib/scheduler/scheduleExport.test.ts src/components/TabScheduleSection.tsx src/pages/SchedulePlanner.tsx
git commit -m "feat: add Holidays This Week column to the Schedule Planner export"
```

---

## Task 12: Ask AI — `get_schedule` returns the week's holidays

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (`get_schedule` description + handler; imports)
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `holidaysInWeek` from `../../../src/lib/publicHolidays.ts` (real shared import, not a re-port).
- Produces: `get_schedule` result shape gains `holidays: { date: string; name: string }[]` for the requested `week_start`. Description gains a sentence about holiday weekdays never being scheduled.

- [ ] **Step 1: Add the import**

At the top of `supabase/functions/ai-assistant/tools.ts`, with the other `../../../src/lib/` imports:

```ts
import { holidaysInWeek } from '../../../src/lib/publicHolidays.ts';
```

- [ ] **Step 2: Update the `get_schedule` description**

Append to the existing `description` string (before the closing quote):

```
' Weekdays that fall on a public holiday are never scheduled; the "holidays" ' +
'array in the result lists any public holiday in the requested week.'
```

- [ ] **Step 3: Update the handler**

In the `if (name === 'get_schedule') { ... }` block (~line 1433), also fetch holidays and include them:

```ts
    const [{ data, error }, hiddenSet, restrictionMap, removedSet, archivedSet, pausedSet, holidayRows] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
      fetchRemovedPlatformBrandSet(supabase),
      fetchArchivedTabNameSet(supabase),
      fetchPausedTabNameSet(supabase),
      supabase.from('public_holidays').select('date, name'),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((r: any) => !archivedSet.has(r.tab) && !pausedSet.has(r.tab));
    const holidays = holidaysInWeek(args.week_start, (holidayRows.data ?? []) as { date: string; name: string }[]);
    return {
      schedule: filterHiddenOrRestricted(rows, hiddenSet, restrictionMap, removedSet),
      holidays,
    };
```

- [ ] **Step 4: Add a test**

In `supabase/functions/ai-assistant/tools_test.ts`, follow the file's existing `get_schedule` test setup (mock supabase). Add a case: a `public_holidays` row for a Wednesday in the requested week is returned in `result.holidays` and the mocked `brand_schedule` rows contain no `wednesday: 'active'`. If the test harness can't easily mock the extra `public_holidays` select, at minimum assert `result.holidays` is defined and is an array for a normal call.

- [ ] **Step 5: Deno check + tests**

Run:
```
deno test --allow-env --allow-net supabase/functions/ai-assistant/tools_test.ts
deno check --no-lock --node-modules-dir=none --config supabase/functions/ai-assistant/deno.json supabase/functions/ai-assistant/tools.ts
```
Expected: pass / clean. (If `deno` unavailable, note it; the deploy in Task 13 will surface any bundler issue.)

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: Ask AI get_schedule reports the week's public holidays"
```

---

## Task 13: Whole-branch review, docs, deploy checklist

**Files:**
- Modify: `docs/task-history.md` (new `## Task N: ...` heading — REQUIRED literal format or the PMS sync skips it)
- Modify: `CLAUDE.md` (Recent Changes entry + Known Issues pending-deploy bullet)

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run && npm run build`
Expected: all green. Note the total test count.

- [ ] **Step 2: Whole-branch self-review (Tier 3)**

Re-read the full diff against the spec. Explicitly confirm:
- Overview / Score Summary / Brand Tabs code is untouched (they read entry status, not the plan).
- `recalculatePauses` is unchanged.
- The calendar grid, the weekday-number header, `TabPreviewCard`, the platform-count strip, and the export all key off the same `holidays` / `holidayDateSet` data for the same dates.
- Every `generateWeekSchedule(` call site passes `unavailableDays`.
- No `Date.parse` / `new Date(iso)` / `toISOString().slice` introduced anywhere in the new date math.
- New `src/lib` files reachable from Deno use `.ts` import extensions and no browser globals.
- The `fetchPublicHolidays` call in `generate-weekly-schedule/buildTabContext` is NOT `.catch()`-swallowed; the one in `TabScheduleSection` IS routed through `withFlagFallback`.

Fix anything that fails these checks before proceeding.

- [ ] **Step 3: `docs/task-history.md` entry**

Append a new section (literal `## Task N: <title>` heading, `---` divider before it, per the PMS-sync format rules):

```markdown
---

## Task N: Schedule Planner — block public holidays + rebalance weekly workload

New `public_holidays` table (date + name, 4 RLS policies via public.is_approved(),
seeded with fixed-date PH national non-working holidays for 2026-2027). Fetched
into TabContext.holidayDates alongside the existing exclusion sets; ensureWeekGenerated
converts the week's holidays to SchedulerInput.unavailableDays and the pure
generateWeekSchedule engine excludes those weekdays from its leastLoadedDay
balancing, so a platform's weekly post count is preserved and redistributed across
the remaining working days (only reduced when postsPerWeek > days left). Calendar
grid + weekday header + TabPreviewCard mini-calendar render holiday columns greyed;
ScheduleCell on a holiday date is read-only (reuses the legacy-week isApproved=false
pattern + a new holidayName prop, no "+ Add Platform"). New "Public Holidays" modal
on the Schedule Planner toolbar lets approved users add local / ad-hoc holidays with
no deploy. CSV/Excel export gains a "Holidays This Week" column. Ask AI get_schedule
returns the week's holidays and its description notes holiday weekdays are never
scheduled. recalculatePauses and every entry-status-based surface (Overview, Score
Summary, Brand Tabs) untouched. Full suite (<N> tests) and build pass.

Spec: docs/superpowers/specs/2026-09-02-schedule-planner-public-holidays-design.md
Plan: docs/superpowers/plans/2026-09-02-schedule-planner-public-holidays.md

Pending manual deploy:
1. supabase db push  (creates + seeds public_holidays)
2. git push origin main  (frontend)
3. supabase functions deploy generate-weekly-schedule  (Monday cron respects holidays)
4. supabase functions deploy ai-assistant  (get_schedule returns holidays)
Frontend + cron degrade safely without 3/4: the page works fully after step 2; the
cron just ignores holidays until step 3.
```

- [ ] **Step 4: `CLAUDE.md` Recent Changes + Known Issues**

Add a dated Recent Changes bullet at the top of that list summarising the above in this file's house style, and a Known Issues bullet capturing the accepted limitations from the spec (past weeks not rewritten; PMS pull-direction can still write a holiday day; no force-post override; movable/local holidays are team-maintained).

- [ ] **Step 5: Commit**

```bash
git add docs/task-history.md CLAUDE.md
git commit -m "docs: log Schedule Planner public-holiday blocking (Task N)"
```

- [ ] **Step 6: Deploy (requires production credentials — do only when authorised)**

```bash
supabase db push
git push origin main
supabase functions deploy generate-weekly-schedule
supabase functions deploy ai-assistant
supabase functions list   # confirm both ACTIVE with a new version
```

- [ ] **Step 7: Live verification (Playwright, after deploy)**

On a tab whose current or next week contains a seeded holiday:
1. No chip is generated on the holiday weekday; the platform's other posts still sum to its weekly count.
2. The holiday column is greyed, the weekday-number header shows the name on hover, `ScheduleCell` rejects click-to-cycle and shows no "+ Add Platform".
3. Add a local holiday via the modal for a future week's weekday, revisit that week → the day is now blocked and greyed.
4. Remove it → the day is schedulable again on the next generation.
5. Export the schedule → the `Holidays This Week` column carries the name(s).
6. Ask AI "what's scheduled for <tab> the week of <Monday>" → response includes the holiday.
7. Confirm Overview / Score Summary / Brand Tabs numbers for that tab are unchanged.

---

## Self-Review (plan author)

**Spec coverage:**
- Table + RLS + seed → Task 1 ✓
- Pure helpers → Task 2 ✓
- Query layer → Task 3 ✓
- Engine `unavailableDays` + rebalance → Task 4 ✓
- Service `TabContext.holidayDates` → Task 5 ✓
- `generate-weekly-schedule` fetch → Task 6 ✓
- Read-only greyed calendar cells → Task 7 (cell) + Task 8 (wiring/header) ✓
- Mini-calendar / preview greying → Task 9 ✓
- Management modal → Task 10 ✓
- Export column → Task 11 ✓
- Ask AI `get_schedule` → Task 12 ✓
- `recalculatePauses` unchanged → asserted in Task 5 interface note + Task 13 Step 2 ✓
- Accepted limitations documented → Task 13 Step 4 ✓
- Deploy checklist → Task 13 Step 6 ✓

**Placeholder scan:** All code steps carry real code. UI-structural steps (Task 7 Step 2, Task 8 Step 5, Task 10 Step 1) give concrete code plus an explicit "adapt to the real element/prop names" instruction because the exact surrounding JSX wasn't fully read — acceptable for a component-integration task, not a logic task.

**Type consistency:** `PublicHoliday { date; name }` used identically in Tasks 2, 3, 8, 9, 10, 12. `holidayDates: Set<string>` on `TabContext` (Task 5) matches `buildHolidayDateSet` return (Task 2) and the edge-function assignment (Task 6) and the `TabScheduleSection` `ctx` assembly (Task 8). `unavailableDays: Weekday[]` on `SchedulerInput` (Task 4) consumed only by Task 5. `buildScheduleExportRows(data, holidaysThisWeek?)` signature consistent between Task 11 Steps 3 and 4. `holidayName?: string` prop (Task 7) set by Task 8 Step 4.
