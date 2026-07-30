# Schedule Planner Per-Week Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Schedule Planner track a real, independent status per calendar week instead of one recurring Mon–Fri template, and backfill all 42 weeks of history from `csv/Scheduled_Planner.xlsx`.

**Architecture:** Add a `week_start date` column to the existing `brand_schedule` table (widening its uniqueness key to `tab, brand_key, week_start`), thread a `weekStart` parameter through the existing helper/query functions and the page's data-loading effect, then run a one-time historical import script against all 42 dated sheets in the source spreadsheet.

**Tech Stack:** Vite · React 19 · TypeScript · Supabase (Postgres) · Vitest · Node (one-off migration script, not part of the app).

**Spec:** `docs/superpowers/specs/2026-07-31-schedule-planner-per-week-design.md`

## Global Constraints

- This supersedes `docs/superpowers/specs/2026-07-30-schedule-planner-design.md`'s "one recurring template, week nav is cosmetic" decision — week nav must now trigger a real refetch, and a cell's status only applies to the week it was set in.
- Brand-key matching still goes through `normalizeBrandKey` (`src/lib/removedPlatformBrands.ts`) — unchanged.
- `week_start` is always an ISO date string `'YYYY-MM-DD'` representing the Monday of that week, both in the DB column and in every function signature that takes it.
- No read-only-history rule — every week, past or future, is editable exactly the same way.
- `brand_schedule`'s existing unique constraint (from `20260730120000_add_brand_schedule.sql`'s inline `unique (tab, brand_key)`) is named `brand_schedule_tab_brand_key_key` — this is Postgres's deterministic default name for an unnamed 2-column unique constraint (`<table>_<col1>_<col2>_key`), and this exact codebase already relied on that same convention for `removed_tp_brands_tab_brand_key` in `20260729140000_add_removed_tp_brands_update_policy.sql`.
- `npm run build` is the only real type-check in this repo (root `tsconfig.json` is references-only).
- This codebase has no component-test framework — page-level verification is build + manual browser check, not new automated tests. Only pure `src/lib/*.ts` helpers get Vitest unit tests.

---

### Task 1: `week_start` migration

**Files:**
- Create: `supabase/migrations/20260731130000_add_brand_schedule_week_start.sql`

**Interfaces:**
- Produces: `brand_schedule.week_start date not null`, unique on `(tab, brand_key, week_start)`.

- [ ] **Step 1: Write the migration**

```sql
-- Schedule Planner moves from one recurring Mon-Fri template per (tab, brand)
-- to real per-week tracking (docs/superpowers/specs/2026-07-31-schedule-planner-per-week-design.md),
-- matching how the source spreadsheet (csv/Scheduled_Planner.xlsx) actually
-- tracked a distinct status per calendar week. Existing rows were all
-- written during the week of 2026-07-27 (the initial csv migration plus
-- some live usage on TP Brand Injection) -- backfill them to that week
-- before the column becomes NOT NULL, so nothing already saved is lost or
-- silently reassigned to the wrong week.

alter table public.brand_schedule add column week_start date;
update public.brand_schedule set week_start = '2026-07-27' where week_start is null;
alter table public.brand_schedule alter column week_start set not null;

alter table public.brand_schedule drop constraint brand_schedule_tab_brand_key_key;
alter table public.brand_schedule
  add constraint brand_schedule_tab_brand_key_week_start_key
  unique (tab, brand_key, week_start);
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: reports `20260731130000_add_brand_schedule_week_start.sql` applied, no errors. If the `drop constraint` step fails because the constraint name doesn't match, stop and report NEEDS_CONTEXT with the actual error — do not guess a different name silently, since a wrong guess could drop the wrong constraint.

- [ ] **Step 3: Verify the backfill**

Run a read-only check (e.g. a small Node script using `@supabase/supabase-js` with the anon key, since `brand_schedule` select is public) confirming every existing row now has `week_start = '2026-07-27'` and the total row count is unchanged from before the migration.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260731130000_add_brand_schedule_week_start.sql
git commit -m "feat: add week_start to brand_schedule for per-week tracking"
```

---

### Task 2: `src/lib/scheduleBrands.ts` — week-scoped matching (TDD)

**Files:**
- Modify: `src/lib/scheduleBrands.ts`
- Modify: `src/lib/scheduleBrands.test.ts`

**Interfaces:**
- Produces (used by Task 3):
  - `interface BrandScheduleRow` gains `week_start: string`
  - `scheduleFor(rows: BrandScheduleRow[], tab: string, brand: string, weekStart: string): BrandScheduleRow | undefined`
  - `withDayStatus(rows: BrandScheduleRow[], tab: string, brand: string, weekStart: string, day: Weekday, status: DayStatus): BrandScheduleRow[]`
  - `nextStatus` and `WEEKDAYS`/`Weekday`/`DayStatus` are unchanged.

- [ ] **Step 1: Update the tests to the new signatures (TDD — these must fail first)**

Replace the full contents of `src/lib/scheduleBrands.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { scheduleFor, nextStatus, withDayStatus, type BrandScheduleRow } from './scheduleBrands';

const row: BrandScheduleRow = {
  tab: 'Hanan',
  brand_key: 'pribet.com',
  week_start: '2026-07-27',
  monday: 'active',
  tuesday: null,
  wednesday: 'paused',
  thursday: null,
  friday: null,
};

describe('scheduleFor', () => {
  it('matches regardless of brand casing or surrounding whitespace', () => {
    expect(scheduleFor([row], 'Hanan', '  PRIBET.COM  ', '2026-07-27')).toBe(row);
  });

  it('returns undefined when no row matches the tab', () => {
    expect(scheduleFor([row], 'Trybet', 'Pribet.com', '2026-07-27')).toBeUndefined();
  });

  it('returns undefined when no row matches the brand', () => {
    expect(scheduleFor([row], 'Hanan', 'WinMega.com', '2026-07-27')).toBeUndefined();
  });

  it('returns undefined when no row matches the week', () => {
    expect(scheduleFor([row], 'Hanan', 'Pribet.com', '2026-08-03')).toBeUndefined();
  });
});

describe('nextStatus', () => {
  it('cycles blank -> active -> paused -> blank', () => {
    expect(nextStatus(null)).toBe('active');
    expect(nextStatus('active')).toBe('paused');
    expect(nextStatus('paused')).toBeNull();
  });
});

describe('withDayStatus', () => {
  it('creates a new row when the brand has none yet this week', () => {
    const result = withDayStatus([], 'Hanan', 'Pribet.com', '2026-07-27', 'monday', 'active');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tab: 'Hanan', brand_key: 'pribet.com', week_start: '2026-07-27', monday: 'active', tuesday: null,
    });
  });

  it('updates only the given day on an existing row for that week', () => {
    const result = withDayStatus([row], 'Hanan', 'Pribet.com', '2026-07-27', 'tuesday', 'active');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ monday: 'active', tuesday: 'active', wednesday: 'paused' });
  });

  it('matches the existing row regardless of brand casing', () => {
    const result = withDayStatus([row], 'Hanan', '  PRIBET.COM  ', '2026-07-27', 'friday', 'paused');
    expect(result).toHaveLength(1);
    expect(result[0].friday).toBe('paused');
  });

  it('leaves other tabs/brands rows untouched', () => {
    const other: BrandScheduleRow = {
      tab: 'Trybet', brand_key: 'trybet', week_start: '2026-07-27',
      monday: null, tuesday: null, wednesday: null, thursday: null, friday: null,
    };
    const result = withDayStatus([row, other], 'Hanan', 'Pribet.com', '2026-07-27', 'monday', 'paused');
    expect(result.find((r) => r.tab === 'Trybet')).toEqual(other);
  });

  it('creates a separate row for a different week rather than updating the existing one', () => {
    const result = withDayStatus([row], 'Hanan', 'Pribet.com', '2026-08-03', 'monday', 'active');
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.week_start === '2026-07-27')).toEqual(row);
    expect(result.find((r) => r.week_start === '2026-08-03')).toMatchObject({ monday: 'active' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- scheduleBrands`
Expected: FAIL — the old `scheduleFor`/`withDayStatus` signatures take fewer arguments, so TypeScript/Vitest will error (extra argument / missing `week_start` in the fixture's assigned type will not compile against the old `BrandScheduleRow`).

- [ ] **Step 3: Update the implementation**

Replace the full contents of `src/lib/scheduleBrands.ts` with:

```ts
import { normalizeBrandKey } from './removedPlatformBrands';

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
export const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export type DayStatus = 'active' | 'paused' | null;

export interface BrandScheduleRow {
  tab: string;
  brand_key: string;
  week_start: string;
  monday: DayStatus;
  tuesday: DayStatus;
  wednesday: DayStatus;
  thursday: DayStatus;
  friday: DayStatus;
}

export function scheduleFor(
  rows: BrandScheduleRow[],
  tab: string,
  brand: string,
  weekStart: string,
): BrandScheduleRow | undefined {
  const key = normalizeBrandKey(brand);
  return rows.find((r) => r.tab === tab && r.brand_key === key && r.week_start === weekStart);
}

export function nextStatus(current: DayStatus): DayStatus {
  if (current === null) return 'active';
  if (current === 'active') return 'paused';
  return null;
}

// Returns a new array with the (tab, brand, weekStart)'s `day` column set to
// `status`, creating a blank row first if none exists yet for that week.
// Pure — callers use this for both the optimistic local update and its
// rollback on save failure.
export function withDayStatus(
  rows: BrandScheduleRow[],
  tab: string,
  brand: string,
  weekStart: string,
  day: Weekday,
  status: DayStatus,
): BrandScheduleRow[] {
  const key = normalizeBrandKey(brand);
  const idx = rows.findIndex((r) => r.tab === tab && r.brand_key === key && r.week_start === weekStart);
  if (idx === -1) {
    const blank: BrandScheduleRow = {
      tab,
      brand_key: key,
      week_start: weekStart,
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
    };
    return [...rows, { ...blank, [day]: status }];
  }
  const updated = [...rows];
  updated[idx] = { ...updated[idx], [day]: status };
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- scheduleBrands`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleBrands.ts src/lib/scheduleBrands.test.ts
git commit -m "feat: scope scheduleBrands matching and status-cycling to a week"
```

---

### Task 3: `src/lib/queries.ts` + `src/pages/SchedulePlanner.tsx` — wire `week_start` through

Combined into one task because `queries.ts`'s signature change breaks every call site in
`SchedulePlanner.tsx` — splitting them would leave the build broken between two separate
task commits for no benefit, since neither half is independently reviewable or testable.

**Files:**
- Modify: `src/lib/queries.ts:629-654` (the existing `fetchBrandSchedule`/`setBrandScheduleDay` block)
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- Consumes: `BrandScheduleRow` (now includes `week_start`), `scheduleFor`, `withDayStatus`, `Weekday`, `DayStatus` from Task 2.
- Produces:
  - `fetchBrandSchedule(tab: string, weekStart: string): Promise<BrandScheduleRow[]>`
  - `setBrandScheduleDay(tab: string, brand: string, weekStart: string, day: Weekday, status: DayStatus): Promise<void>`

- [ ] **Step 1: Replace the two functions**

Before (`src/lib/queries.ts:629-654`):

```ts
export async function fetchBrandSchedule(tab: string): Promise<BrandScheduleRow[]> {
  const { data, error } = await supabase
    .from('brand_schedule')
    .select('tab, brand_key, monday, tuesday, wednesday, thursday, friday')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as BrandScheduleRow[];
}

// Upserts on (tab, brand_key) — only the one `day` column (plus updated_at)
// is included in the payload, so PostgREST's generated
// `ON CONFLICT ... DO UPDATE SET` only touches that column, leaving the
// other four weekdays on the row exactly as they were.
export async function setBrandScheduleDay(
  tab: string,
  brand: string,
  day: Weekday,
  status: DayStatus,
): Promise<void> {
  const { error } = await supabase
    .from('brand_schedule')
    .upsert(
      { tab, brand, [day]: status, updated_at: new Date().toISOString() },
      { onConflict: 'tab,brand_key' },
    );
  if (error) throw error;
}
```

After:

```ts
export async function fetchBrandSchedule(tab: string, weekStart: string): Promise<BrandScheduleRow[]> {
  const { data, error } = await supabase
    .from('brand_schedule')
    .select('tab, brand_key, week_start, monday, tuesday, wednesday, thursday, friday')
    .eq('tab', tab)
    .eq('week_start', weekStart);
  if (error) throw error;
  return (data ?? []) as BrandScheduleRow[];
}

// Upserts on (tab, brand_key, week_start) — only the one `day` column (plus
// updated_at) is included in the payload, so PostgREST's generated
// `ON CONFLICT ... DO UPDATE SET` only touches that column, leaving the
// other four weekdays on that week's row exactly as they were.
export async function setBrandScheduleDay(
  tab: string,
  brand: string,
  weekStart: string,
  day: Weekday,
  status: DayStatus,
): Promise<void> {
  const { error } = await supabase
    .from('brand_schedule')
    .upsert(
      { tab, brand, week_start: weekStart, [day]: status, updated_at: new Date().toISOString() },
      { onConflict: 'tab,brand_key,week_start' },
    );
  if (error) throw error;
}
```

- [ ] **Step 2: Add a `toISODate` helper to `SchedulePlanner.tsx`**

Before:

```tsx
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
```

After:

```tsx
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

- [ ] **Step 3: Fetch by week and refetch on week change**

Before:

```tsx
        const [rawEntries, headers, rows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          fetchBrandSchedule(tab),
        ]);
```

After:

```tsx
        const [rawEntries, headers, rows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          fetchBrandSchedule(tab, toISODate(weekStart)),
        ]);
```

Before:

```tsx
    return () => {
      canceled = true;
    };
  }, [tab]);
```

After:

```tsx
    return () => {
      canceled = true;
    };
  }, [tab, weekStart]);
```

- [ ] **Step 4: Thread `weekStart` through the click handler**

Before:

```tsx
  async function handleCellClick(brand: string, day: Weekday) {
    if (!isApproved) return;
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand)?.[day] ?? null;
    const next = nextStatus(currentStatus);

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, day, next));
    try {
      await setBrandScheduleDay(tab, brand, day, next);
    } catch (err) {
      setScheduleRows((prev) => withDayStatus(prev, tab, brand, day, currentStatus));
      setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
    }
  }
```

After:

```tsx
  async function handleCellClick(brand: string, day: Weekday) {
    if (!isApproved) return;
    const weekStartISO = toISODate(weekStart);
    const currentStatus: DayStatus = scheduleFor(scheduleRows, tab, brand, weekStartISO)?.[day] ?? null;
    const next = nextStatus(currentStatus);

    setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, day, next));
    try {
      await setBrandScheduleDay(tab, brand, weekStartISO, day, next);
    } catch (err) {
      setScheduleRows((prev) => withDayStatus(prev, tab, brand, weekStartISO, day, currentStatus));
      setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
    }
  }
```

- [ ] **Step 5: Thread `weekStart` through the render**

Before:

```tsx
                filteredBrands.map((brand) => {
                  const row = scheduleFor(scheduleRows, tab, brand);
                  return (
```

After:

```tsx
                filteredBrands.map((brand) => {
                  const row = scheduleFor(scheduleRows, tab, brand, toISODate(weekStart));
                  return (
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors — this is the first point in the task where the build is expected to be green, now that both `queries.ts` and `SchedulePlanner.tsx` agree on the new signatures.

- [ ] **Step 7: Manually verify**

Run `npm run dev`, sign in, open Schedule Planner:
1. On a tab whose brands already have data for the week of Jul 27–31 (e.g. Rooster Partners), confirm the grid looks identical to before this change.
2. Click Next week (jumps to Aug 3–7) — confirm the grid goes blank (no data exists yet for that week).
3. Click a cell in that blank week to set it to ✓, reload the page, confirm it's still ✓ for Aug 3–7.
4. Click Previous week back to Jul 27–31, confirm the original data is untouched (the Aug 3–7 edit didn't leak into this week).
5. Click Today, confirm it returns to Jul 27–31 with the original data intact.

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries.ts src/pages/SchedulePlanner.tsx
git commit -m "feat: make Schedule Planner track and edit data per calendar week"
```

---

### Task 4: Historical import (all 42 weeks)

**Files:** none in the repo — this is a one-time data operation via a temporary script (created and deleted within this task, same pattern as the original spreadsheet migration), not a permanent addition to the codebase.

**Note for whoever executes this plan:** this task is data-migration judgment work (matching 9+ months of brand-roster drift against current live data, sheet by sheet), not mechanical code transcription — per this project's standing practice, execute it directly rather than dispatching to a fresh subagent that would have to re-derive all of the context below from scratch on a live production write.

**Reference data:**

The complete sheet-name → `week_start` mapping (verified: 41 of 42 sheets land exactly 7 days apart on a Monday matching the sheet's own name; the one exception, `"9-12 Dec"`, is a one-day naming typo in the source file — its computed Monday, `2025-12-08`, is used instead of a literal reading of "9"):

| Sheet name | week_start |
|---|---|
| Scheduled Planner 27July-31July | 2026-07-27 |
| Scheduled Planner 20July-24July | 2026-07-20 |
| Scheduled Planner 13July-17July | 2026-07-13 |
| Scheduled Planner 6July-10July | 2026-07-06 |
| Scheduled Planner 29June-3July | 2026-06-29 |
| Scheduled Planner 22June-26June | 2026-06-22 |
| Scheduled Planner 15June-19June | 2026-06-15 |
| Scheduled Planner 8June-12June | 2026-06-08 |
| Scheduled Planner 1June-5June | 2026-06-01 |
| Scheduled Planner 25May-29May | 2026-05-25 |
| Scheduled Planner 18May-22May | 2026-05-18 |
| Scheduled Planner 11May-15May | 2026-05-11 |
| Scheduled Planner 4May-8May | 2026-05-04 |
| Scheduled Planner 27Apr-1May | 2026-04-27 |
| Scheduled Planner 20Apr-24Apr | 2026-04-20 |
| Scheduled Planner 13Apr-17Apr | 2026-04-13 |
| Scheduled Planner 6Apr-10Apr | 2026-04-06 |
| Scheduled Planner 30Mar-3Apr | 2026-03-30 |
| Scheduled Planner 23Mar-27Mar | 2026-03-23 |
| Scheduled Planner 16Mar-20Mar | 2026-03-16 |
| Scheduled Planner 9Mar-13Mar | 2026-03-09 |
| Scheduled Planner 02Mar-6Mar | 2026-03-02 |
| Scheduled Planner 23Feb-27Feb | 2026-02-23 |
| Scheduled Planner 16Feb-20Feb | 2026-02-16 |
| Scheduled Planner 9Feb-13Feb | 2026-02-09 |
| Scheduled Planner 2Feb-6Feb | 2026-02-02 |
| Scheduled Planner 26Jan-30Jan | 2026-01-26 |
| Scheduled Planner 19Jan-23Jan | 2026-01-19 |
| Scheduled Planner 12Jan-16Jan | 2026-01-12 |
| Scheduled Planner 5Jan-09Jan | 2026-01-05 |
| Scheduled Planner 29Dec-02 Jan | 2025-12-29 |
| Scheduled Planner 22-26 Dec | 2025-12-22 |
| Scheduled Planner 15-19 Dec | 2025-12-15 |
| Scheduled Planner 9-12 Dec | 2025-12-08 (typo in sheet name; see note above) |
| Scheduled Planner 1-5 Dec | 2025-12-01 |
| Scheduled Planner 24-28 Nov | 2025-11-24 |
| Scheduled Planner 17-21 Nov | 2025-11-17 |
| Scheduled Planner 10-14 Nov | 2025-11-10 |
| Scheduled Planner 3-7 Nov | 2025-11-03 |
| Scheduled Planner 27-31 Oct | 2025-10-27 |
| Scheduled Planner 20-25 Oct | 2025-10-20 |
| Scheduled Planner 13-17 Oct | 2025-10-13 |

The undated `"Scheduled Planner"` sheet (no date in its name, brand set doesn't match any of today's 11 tabs — "Medier Brands", "Midasluck", "Bit Coin") is excluded, same as it was from the current-week migration.

**Live per-tab brand lists** (for matching sheet brand names to a tab; re-fetch fresh rather than trusting this as static, since entries may have changed since this plan was written — same query used for the original migration):

```js
// One-off script, e.g. scripts/tmp-fetch-brands.mjs, run via `node scripts/tmp-fetch-brands.mjs`
// from the repo root (so node_modules resolves) — delete when done.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const SUPABASE_URL = 'https://krxnupmhfiduduvvlumc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kuWqqYdxhcN1_GHhIFa4mA_PcV0XPs-';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const OPERATIONAL_TABS = [
  'TP Brand Injection', 'TP Affiliate', 'Rooster Partners', 'Revolution Casino',
  'Trybet', 'SilverPlay', 'SuprPlay Limited', 'HazEmirates UAE', 'Hanan',
  'Wizard of Odds', 'GRG - Gulf Recovery Group',
];
const BRAND_COLS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name'];

async function main() {
  const out = {};
  for (const tab of OPERATIONAL_TABS) {
    const { data, error } = await supabase.from('entries').select('data').eq('tab', tab);
    if (error) { out[tab] = { error: error.message }; continue; }
    const rows = data ?? [];
    let brandCol = null;
    for (const col of BRAND_COLS) {
      if (rows.some((r) => r.data && r.data[col] != null && String(r.data[col]).trim() !== '')) {
        brandCol = col;
        break;
      }
    }
    const brands = brandCol
      ? [...new Set(rows.map((r) => r.data[brandCol]).filter((v) => v != null && String(v).trim() !== ''))].sort()
      : [];
    out[tab] = { brandCol, brandCount: brands.length, brands };
  }
  fs.writeFileSync('brand-lists.json', JSON.stringify(out, null, 2));
  console.log('done');
}

main();
```

- [ ] **Step 1: Parse every sheet into a dry-run dataset**

For each of the 42 sheets (via `openpyxl` or a JS xlsx reader), for every non-empty data row: column A is the brand name, columns B–F are Monday–Friday. Normalize cell values: `'✔'` → `active`; any case-insensitive variant containing "pause" (`'Pause'`, `'ON PAUSE'`, `'Pause permanently'` in the notes column — the notes column itself, typically column G, is never migrated) → `paused`; blank/`None` → no value for that day. Match each brand against the live per-tab brand lists:
   - A group under a label naming a known tab (`"Rooster Brands"` → Rooster Partners, `"SuprNation Brands"` → SuprPlay Limited, `"Hanan Brands"` → Hanan, `"Wizard of Odds"` → Wizard of Odds) belongs to that tab.
   - An unlabeled group's tab is inferred the same way the current-week migration did it: by which tab's live brand list its brands belong to.
   - Correct brand spelling to the live entries value when there's a clear normalized match (e.g. `"Novadreams2"` → `"Novadreams"`, `"Trybet"` → `"Trybet.com"`).
   - Any brand/group with no live-tab match at all (expect more of these in older sheets as tab rosters have drifted over 9 months) is skipped for that week — record it in a skip log, don't guess a tab for it.
   - A brand present in a sheet with all five days blank contributes no row at all for that week (blank = no row, consistent with the shipped semantics).

- [ ] **Step 2: Review the dry-run output before writing anything**

Print (don't yet write to Supabase) a summary: total rows to be written per week, and the full skip list (brand name + sheet it appeared in). Sanity-check a handful of weeks against the source spreadsheet directly (e.g. open a sheet in the middle of the range and confirm the parsed brand/day values match what's actually in the cells) before proceeding.

- [ ] **Step 3: Write the rows**

Authenticate via `supabase.auth.signInWithPassword` using the `CAPTURE_EMAIL`/`CAPTURE_PASSWORD` env vars already in `.env` (same approach as the original migration — `brand_schedule` writes require `is_approved()`, which an anon-key-only client can't satisfy). For each `(tab, brand, week_start)` from the reviewed dataset, upsert with `onConflict: 'tab,brand_key,week_start'` and all five day columns explicit (`null` for blank days) in one call per row — this is a fresh row for nearly every `(brand, week)` combination, so a full-row upsert is correct here (unlike the single-day partial upserts `setBrandScheduleDay` does for live edits).

- [ ] **Step 4: Verify**

Query `brand_schedule` directly (anon key, select is public) and confirm:
- Total row count matches what Step 2's dry run reported it would write, plus whatever pre-existing rows were untouched (e.g. the current week's 41 rows already backfilled by Task 1 — the current week's sheet should reproduce equivalent data, not duplicate rows, since it upserts on the same `(tab, brand_key, week_start)` key already in the table).
- Spot-check 2–3 specific `(tab, brand, week_start)` combinations against the source spreadsheet by hand.
- Delete the temporary script(s) used for this task; confirm `git status` shows no stray files.

- [ ] **Step 5: Report**

No commit for this task (no repo files change) — report to the user: total rows written, total weeks covered, the full skip list, and confirmation that the verification queries in Step 4 passed.
