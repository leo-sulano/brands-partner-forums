# Schedule Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Schedule Planner" page — a per-tab weekly grid (frozen Brands column, Mon–Fri, click-to-cycle blank/✓/Pause cells) backed by a new Supabase table.

**Architecture:** One new wide Supabase table (`brand_schedule`, one row per `(tab, brand)` with a status column per weekday) plus a matching-key helper module, two new query functions, and one new page wired into the existing router/sidebar. Brand rows are derived live from `entries` exactly like `BrandGroup.tsx` already does — no new brand-identity data of any kind.

**Tech Stack:** Vite · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres) · Vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-schedule-planner-design.md`

## Global Constraints

- One recurring Mon–Fri template per `(tab, brand)` — never per-calendar-week. Week prev/next/Today controls only change displayed date *labels*; they must never trigger a data refetch keyed by date.
- No automation link: nothing outside this feature reads `brand_schedule`. Do not touch the check-status Edge Functions or EC2 cron.
- Brand-key matching must go through `normalizeBrandKey` (`src/lib/removedPlatformBrands.ts`) — same lower+trim normalization already used for `removed_platform_brands`, for the same reason (real data has trailing-space brand values).
- Every new Supabase table gets all four RLS policies (select/insert/update/delete) — select open, the other three gated on `public.is_approved()` — per this project's standing rule that a missing UPDATE policy throws 42501 on upsert and a missing DELETE policy silently no-ops.
- This codebase has no component-test framework (no `*.test.tsx` anywhere) — only pure `src/lib/*.ts` helpers get Vitest unit tests. `SchedulePlanner.tsx` itself is verified via `npm run build` + manual browser check, not new automated tests. Don't introduce React Testing Library to work around this.
- `tsc --noEmit` alone proves nothing in this repo (root `tsconfig.json` is references-only) — every "verify the types" step must be `npm run build`.

---

### Task 1: `brand_schedule` migration

**Files:**
- Create: `supabase/migrations/20260730120000_add_brand_schedule.sql`

**Interfaces:**
- Produces: table `public.brand_schedule(id, tab, brand, brand_key, monday, tuesday, wednesday, thursday, friday, updated_at)`, unique on `(tab, brand_key)`, `brand_key` generated from `brand`.

- [ ] **Step 1: Write the migration**

```sql
-- Schedule Planner: which weekdays a brand's outreach/posting is active vs
-- paused. One recurring Mon-Fri template per (tab, brand) -- not tied to any
-- specific calendar week (docs/superpowers/specs/2026-07-30-schedule-planner-design.md).
-- A NULL day column means "not set" (renders as a blank cell); every write
-- is a plain upsert of one column -- unlike removed_platform_brands, row
-- existence itself carries no meaning here, so there's no delete-to-clear step.
--
-- brand_key is a generated, normalized (lower+trim) column, mirroring the
-- fix already applied to removed_platform_brands
-- (20260729140000_add_removed_tp_brands_update_policy.sql) so brand values
-- differing only in case/whitespace still match the same row.

create table public.brand_schedule (
  id          uuid primary key default gen_random_uuid(),
  tab         text not null,
  brand       text not null,
  brand_key   text generated always as (lower(btrim(brand))) stored,
  monday      text check (monday in ('active', 'paused')),
  tuesday     text check (tuesday in ('active', 'paused')),
  wednesday   text check (wednesday in ('active', 'paused')),
  thursday    text check (thursday in ('active', 'paused')),
  friday      text check (friday in ('active', 'paused')),
  updated_at  timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.brand_schedule enable row level security;

create policy "anyone can read brand_schedule"
  on public.brand_schedule for select using (true);
create policy "approved users can insert brand_schedule"
  on public.brand_schedule for insert with check (public.is_approved());
create policy "approved users can update brand_schedule"
  on public.brand_schedule for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_schedule"
  on public.brand_schedule for delete using (public.is_approved());
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: reports `20260730120000_add_brand_schedule.sql` applied, no errors. If it fails because the local checkout isn't linked to the Supabase project yet, run `supabase link --project-ref <ref>` first (see `project_supabase_worktree_link` — every fresh checkout needs its own link, it's gitignored).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260730120000_add_brand_schedule.sql
git commit -m "feat: add brand_schedule table for Schedule Planner"
```

---

### Task 2: `src/lib/scheduleBrands.ts` — matching + status helpers (TDD)

**Files:**
- Create: `src/lib/scheduleBrands.ts`
- Test: `src/lib/scheduleBrands.test.ts`

**Interfaces:**
- Consumes: `normalizeBrandKey(brand: string): string` from `src/lib/removedPlatformBrands.ts` (already exists).
- Produces (used by Tasks 3–6):
  - `type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday'`
  - `const WEEKDAYS: Weekday[]`
  - `type DayStatus = 'active' | 'paused' | null`
  - `interface BrandScheduleRow { tab: string; brand_key: string; monday: DayStatus; tuesday: DayStatus; wednesday: DayStatus; thursday: DayStatus; friday: DayStatus }`
  - `scheduleFor(rows: BrandScheduleRow[], tab: string, brand: string): BrandScheduleRow | undefined`
  - `nextStatus(current: DayStatus): DayStatus`
  - `withDayStatus(rows: BrandScheduleRow[], tab: string, brand: string, day: Weekday, status: DayStatus): BrandScheduleRow[]`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/scheduleBrands.test.ts
import { describe, it, expect } from 'vitest';
import { scheduleFor, nextStatus, withDayStatus, type BrandScheduleRow } from './scheduleBrands';

const row: BrandScheduleRow = {
  tab: 'Hanan',
  brand_key: 'pribet.com',
  monday: 'active',
  tuesday: null,
  wednesday: 'paused',
  thursday: null,
  friday: null,
};

describe('scheduleFor', () => {
  it('matches regardless of brand casing or surrounding whitespace', () => {
    expect(scheduleFor([row], 'Hanan', '  PRIBET.COM  ')).toBe(row);
  });

  it('returns undefined when no row matches the tab', () => {
    expect(scheduleFor([row], 'Trybet', 'Pribet.com')).toBeUndefined();
  });

  it('returns undefined when no row matches the brand', () => {
    expect(scheduleFor([row], 'Hanan', 'WinMega.com')).toBeUndefined();
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
  it('creates a new row when the brand has none yet', () => {
    const result = withDayStatus([], 'Hanan', 'Pribet.com', 'monday', 'active');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ tab: 'Hanan', brand_key: 'pribet.com', monday: 'active', tuesday: null });
  });

  it('updates only the given day on an existing row', () => {
    const result = withDayStatus([row], 'Hanan', 'Pribet.com', 'tuesday', 'active');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ monday: 'active', tuesday: 'active', wednesday: 'paused' });
  });

  it('matches the existing row regardless of brand casing', () => {
    const result = withDayStatus([row], 'Hanan', '  PRIBET.COM  ', 'friday', 'paused');
    expect(result).toHaveLength(1);
    expect(result[0].friday).toBe('paused');
  });

  it('leaves other tabs/brands rows untouched', () => {
    const other: BrandScheduleRow = {
      tab: 'Trybet', brand_key: 'trybet', monday: null, tuesday: null, wednesday: null, thursday: null, friday: null,
    };
    const result = withDayStatus([row, other], 'Hanan', 'Pribet.com', 'monday', 'paused');
    expect(result.find((r) => r.tab === 'Trybet')).toEqual(other);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- scheduleBrands`
Expected: FAIL with "Cannot find module './scheduleBrands'" (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/scheduleBrands.ts
import { normalizeBrandKey } from './removedPlatformBrands';

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
export const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export type DayStatus = 'active' | 'paused' | null;

export interface BrandScheduleRow {
  tab: string;
  brand_key: string;
  monday: DayStatus;
  tuesday: DayStatus;
  wednesday: DayStatus;
  thursday: DayStatus;
  friday: DayStatus;
}

export function scheduleFor(rows: BrandScheduleRow[], tab: string, brand: string): BrandScheduleRow | undefined {
  const key = normalizeBrandKey(brand);
  return rows.find((r) => r.tab === tab && r.brand_key === key);
}

export function nextStatus(current: DayStatus): DayStatus {
  if (current === null) return 'active';
  if (current === 'active') return 'paused';
  return null;
}

// Returns a new array with the (tab, brand)'s `day` column set to `status`,
// creating a blank row first if none exists yet. Pure — callers use this for
// both the optimistic local update and its rollback on save failure.
export function withDayStatus(
  rows: BrandScheduleRow[],
  tab: string,
  brand: string,
  day: Weekday,
  status: DayStatus,
): BrandScheduleRow[] {
  const key = normalizeBrandKey(brand);
  const idx = rows.findIndex((r) => r.tab === tab && r.brand_key === key);
  if (idx === -1) {
    const blank: BrandScheduleRow = {
      tab,
      brand_key: key,
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
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleBrands.ts src/lib/scheduleBrands.test.ts
git commit -m "feat: add scheduleBrands matching and status-cycling helpers"
```

---

### Task 3: `src/lib/queries.ts` — fetch/write the schedule

**Files:**
- Modify: `src/lib/queries.ts`

**Interfaces:**
- Consumes: `BrandScheduleRow`, `Weekday`, `DayStatus` from `src/lib/scheduleBrands.ts` (Task 2).
- Produces (used by Task 4 and Task 6):
  - `fetchBrandSchedule(tab: string): Promise<BrandScheduleRow[]>`
  - `setBrandScheduleDay(tab: string, brand: string, day: Weekday, status: DayStatus): Promise<void>`

- [ ] **Step 1: Add the import**

In `src/lib/queries.ts`, the existing import block starts:

```ts
import { supabase, SUPABASE_ANON_KEY, CHECK_STATUS_URL, CHECK_STATUS_BASE_URL, CHECK_STATUS_TOKEN, CHECK_AG_STATUS_URL, CHECK_AG_STATUS_BASE_URL } from './supabase';
import { inDateRange } from './dateUtils';
import { getTabColumns, getBrandNameCol } from './tab-configs';
import { platformRemovedKey, normalizeBrandKey, type Platform } from './removedPlatformBrands';
```

Add one line after it:

```ts
import type { BrandScheduleRow, Weekday, DayStatus } from './scheduleBrands';
```

- [ ] **Step 2: Add the two functions**

Add right after `setBrandPlatformRemoved` (before the `// TP/AG/CG/WO review status check triggers` section comment):

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

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (`tsc --noEmit` alone won't check this file — see Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat: add fetchBrandSchedule and setBrandScheduleDay queries"
```

---

### Task 4: `src/pages/SchedulePlanner.tsx` — read-only grid, routed

**Files:**
- Create: `src/pages/SchedulePlanner.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `fetchRawEntriesByTab`, `fetchTabHeaders`, `fetchBrandSchedule` (queries.ts); `BRAND_COLS`, `getBrandNameCol`, `TAB_DEFAULT_BRAND` (tab-configs.ts); `OPERATIONAL_TABS`, `tabDisplayName` (tabs.ts); `WEEKDAYS`, `scheduleFor`, `BrandScheduleRow`, `DayStatus`, `Weekday` (scheduleBrands.ts, Task 2).
- Produces: default-exported `SchedulePlanner` component, routed at `/schedule-planner`.

- [ ] **Step 1: Create the page**

```tsx
// src/pages/SchedulePlanner.tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { Search } from 'lucide-react';
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND } from '../lib/tab-configs';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchBrandSchedule } from '../lib/queries';
import { WEEKDAYS, scheduleFor, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};

const TAB_STORAGE_KEY = 'schedulePlanner.tab';
const SEARCH_STORAGE_KEY = 'schedulePlanner.search';

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekdayDate(monday: Date, index: number): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + index);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function SchedulePlanner() {
  const [tab, setTab] = useState<string>(() => {
    try {
      return sessionStorage.getItem(TAB_STORAGE_KEY) || OPERATIONAL_TABS[0];
    } catch {
      return OPERATIONAL_TABS[0];
    }
  });
  const [search, setSearch] = useState<string>(() => {
    try {
      return sessionStorage.getItem(SEARCH_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [weekStart] = useState<Date>(() => mondayOf(new Date()));
  const [brands, setBrands] = useState<string[]>([]);
  const [scheduleRows, setScheduleRows] = useState<BrandScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setToolbarHeight(entries[0].contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // sessionStorage unavailable (private mode, quota) — view just won't persist.
    }
  }, [tab]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SEARCH_STORAGE_KEY, search);
    } catch {
      // same as above
    }
  }, [search]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [rawEntries, headers, rows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          fetchBrandSchedule(tab),
        ]);
        if (canceled) return;
        const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? getBrandNameCol(tab);
        const uniqueBrands = [...new Set(
          rawEntries
            .map((e) => e.data[brandCol])
            .filter((v): v is string => !!v && v.trim() !== ''),
        )].sort();
        if (uniqueBrands.length === 0 && TAB_DEFAULT_BRAND[tab]) uniqueBrands.push(TAB_DEFAULT_BRAND[tab]);
        setBrands(uniqueBrands);
        setScheduleRows(rows);
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to load schedule');
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [tab]);

  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.toLowerCase().includes(q));
  }, [brands, search]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Schedule Planner</h1>
      {error && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
      )}

      <div className="rounded-b-lg border border-solid border-slate-200 bg-white shadow-sm flex flex-col max-h-[calc(100vh-220px)]">
        <div className="overflow-auto flex-1 min-h-0">
          <div ref={toolbarRef} className="sticky top-0 left-0 z-40 bg-white will-change-transform border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2">
              <select
                value={tab}
                onChange={(e) => setTab(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
              >
                {OPERATIONAL_TABS.map((t) => (
                  <option key={t} value={t}>{tabDisplayName(t)}</option>
                ))}
              </select>

              <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 flex-1 min-w-[160px] max-w-xs">
                <Search className="size-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search brands…"
                  className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
                />
              </div>

              <span className="ml-auto text-sm text-slate-600 whitespace-nowrap">
                Week of {formatWeekdayDate(weekStart, 0)} – {formatWeekdayDate(weekStart, 4)}
              </span>
            </div>
          </div>

          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th
                  className="sticky left-0 z-30 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 will-change-transform"
                  style={{ top: toolbarHeight }}
                >
                  Brand
                </th>
                {WEEKDAYS.map((day, i) => (
                  <th
                    key={day}
                    className="sticky z-[25] bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap will-change-transform"
                    style={{ top: toolbarHeight }}
                  >
                    {WEEKDAY_LABELS[day]} {formatWeekdayDate(weekStart, i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={WEEKDAYS.length + 1} className="px-4 py-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : filteredBrands.length === 0 ? (
                <tr>
                  <td colSpan={WEEKDAYS.length + 1} className="px-4 py-8 text-center text-slate-400">
                    No brands match.
                  </td>
                </tr>
              ) : (
                filteredBrands.map((brand) => {
                  const row = scheduleFor(scheduleRows, tab, brand);
                  return (
                    <tr key={brand} className="border-t border-slate-100 group">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-blue-50 px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                        {brand}
                      </td>
                      {WEEKDAYS.map((day) => {
                        const status: DayStatus = row ? row[day] : null;
                        return (
                          <td key={day} className="px-3 py-2 text-center">
                            {status === 'active' && (
                              <span className="text-emerald-600 font-semibold">✓</span>
                            )}
                            {status === 'paused' && (
                              <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                                Pause
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the route in `src/App.tsx`**

Before:

```tsx
const ScoreSummary = lazy(() => import('./pages/ScoreSummary'));
const AskAI        = lazy(() => import('./pages/AskAI'));
```

After:

```tsx
const ScoreSummary = lazy(() => import('./pages/ScoreSummary'));
const SchedulePlanner = lazy(() => import('./pages/SchedulePlanner'));
const AskAI        = lazy(() => import('./pages/AskAI'));
```

Before:

```tsx
            <Route path="/score-summary" element={<ScoreSummary />} />
            <Route path="/admin/users" element={<AdminUsers />} />
```

After:

```tsx
            <Route path="/score-summary" element={<ScoreSummary />} />
            <Route path="/schedule-planner" element={<SchedulePlanner />} />
            <Route path="/admin/users" element={<AdminUsers />} />
```

- [ ] **Step 3: Add the sidebar link in `src/components/Sidebar.tsx`**

Before:

```tsx
import {
  LayoutDashboard, ScrollText, BookOpen,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, ChevronLeft, ChevronUp, BarChart3, Bot, X, Star, LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
```

After:

```tsx
import {
  LayoutDashboard, ScrollText, BookOpen,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, ChevronLeft, ChevronUp, BarChart3, Bot, X, Star, LifeBuoy, CalendarDays,
  type LucideIcon,
} from 'lucide-react';
```

Before:

```tsx
                <NavLink
                  to="/log"
                  onClick={() => onClose?.()}
                  title={isCollapsed ? 'Log' : undefined}
                  className={({ isActive }) => linkClass(isActive, isCollapsed)}
                >
                  <ScrollText className="size-4" />
                  {!isCollapsed && 'Log'}
                </NavLink>
                {isAdmin && (
```

After:

```tsx
                <NavLink
                  to="/log"
                  onClick={() => onClose?.()}
                  title={isCollapsed ? 'Log' : undefined}
                  className={({ isActive }) => linkClass(isActive, isCollapsed)}
                >
                  <ScrollText className="size-4" />
                  {!isCollapsed && 'Log'}
                </NavLink>
                <NavLink
                  to="/schedule-planner"
                  onClick={() => onClose?.()}
                  title={isCollapsed ? 'Schedule Planner' : undefined}
                  className={({ isActive }) => linkClass(isActive, isCollapsed)}
                >
                  <CalendarDays className="size-4" />
                  {!isCollapsed && 'Schedule Planner'}
                </NavLink>
                {isAdmin && (
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, sign in, click "Schedule Planner" in the sidebar's Admin section. Confirm: the tab dropdown defaults to the first operational tab, brands for that tab render as rows, scrolling the table horizontally keeps the Brand column pinned on the left and the weekday header pinned on top, and typing in the search box narrows the rows.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SchedulePlanner.tsx src/App.tsx src/components/Sidebar.tsx
git commit -m "feat: add Schedule Planner page with frozen brand column and search filter"
```

---

### Task 5: Week navigation

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- No new exports/consumers — purely internal to the page component from Task 4.

- [ ] **Step 1: Add the nav icons to the import**

Before:

```tsx
import { Search } from 'lucide-react';
```

After:

```tsx
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
```

- [ ] **Step 2: Make `weekStart` settable**

Before:

```tsx
  const [weekStart] = useState<Date>(() => mondayOf(new Date()));
```

After:

```tsx
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
```

- [ ] **Step 3: Add an `addDays` helper**

Before:

```tsx
function formatWeekdayDate(monday: Date, index: number): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + index);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
```

After:

```tsx
function formatWeekdayDate(monday: Date, index: number): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + index);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
```

- [ ] **Step 4: Replace the static week label with nav controls**

Before:

```tsx
              <span className="ml-auto text-sm text-slate-600 whitespace-nowrap">
                Week of {formatWeekdayDate(weekStart, 0)} – {formatWeekdayDate(weekStart, 4)}
              </span>
```

After:

```tsx
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWeekStart((d) => addDays(d, -7))}
                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                  aria-label="Previous week"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-sm text-slate-600 whitespace-nowrap">
                  Week of {formatWeekdayDate(weekStart, 0)} – {formatWeekdayDate(weekStart, 4)}
                </span>
                <button
                  type="button"
                  onClick={() => setWeekStart((d) => addDays(d, 7))}
                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                  aria-label="Next week"
                >
                  <ChevronRight className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart(mondayOf(new Date()))}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Today
                </button>
              </div>
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Manually verify**

Run: `npm run dev`. On the Schedule Planner page, click the next-week arrow — the header dates advance by 7 days for all 5 columns, but the ✓/Pause cells (if any exist yet) do not change. Click previous-week twice, confirm dates go back correctly. Click "Today" and confirm it returns to the current week.

- [ ] **Step 7: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: add prev/next/today week navigation to Schedule Planner"
```

---

### Task 6: Click-to-cycle cell editing

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- Consumes: `setBrandScheduleDay` (queries.ts, Task 3); `nextStatus`, `withDayStatus` (scheduleBrands.ts, Task 2); `useAuth()` (`src/contexts/AuthContext.tsx`, existing — same hook `BrandGroup.tsx` uses for its `isApproved` gate).

- [ ] **Step 1: Add the new imports**

Before:

```tsx
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND } from '../lib/tab-configs';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchBrandSchedule } from '../lib/queries';
import { WEEKDAYS, scheduleFor, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
```

After:

```tsx
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND } from '../lib/tab-configs';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchBrandSchedule, setBrandScheduleDay } from '../lib/queries';
import { WEEKDAYS, scheduleFor, nextStatus, withDayStatus, type BrandScheduleRow, type DayStatus, type Weekday } from '../lib/scheduleBrands';
import { useAuth } from '../contexts/AuthContext';
import Toast, { type ToastKind } from '../components/Toast';
```

- [ ] **Step 2: Add `isApproved` and toast state**

Before:

```tsx
  const [error, setError] = useState<string | null>(null);
```

After:

```tsx
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const { isApproved } = useAuth();
```

- [ ] **Step 3: Add the click handler**

Before:

```tsx
  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.toLowerCase().includes(q));
  }, [brands, search]);

  return (
```

After:

```tsx
  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.toLowerCase().includes(q));
  }, [brands, search]);

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

  return (
```

- [ ] **Step 4: Wire the click handler onto each cell**

Before:

```tsx
                      {WEEKDAYS.map((day) => {
                        const status: DayStatus = row ? row[day] : null;
                        return (
                          <td key={day} className="px-3 py-2 text-center">
                            {status === 'active' && (
                              <span className="text-emerald-600 font-semibold">✓</span>
                            )}
                            {status === 'paused' && (
                              <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                                Pause
                              </span>
                            )}
                          </td>
                        );
                      })}
```

After:

```tsx
                      {WEEKDAYS.map((day) => {
                        const status: DayStatus = row ? row[day] : null;
                        return (
                          <td
                            key={day}
                            onClick={() => handleCellClick(brand, day)}
                            className={`px-3 py-2 text-center ${isApproved ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                          >
                            {status === 'active' && (
                              <span className="text-emerald-600 font-semibold">✓</span>
                            )}
                            {status === 'paused' && (
                              <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                                Pause
                              </span>
                            )}
                          </td>
                        );
                      })}
```

- [ ] **Step 5: Render the toast**

Before (end of file):

```tsx
        </div>
      </div>
    </div>
  );
}
```

After:

```tsx
        </div>
      </div>
      {toast && <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Manually verify**

Run: `npm run dev`, sign in as an approved user, open Schedule Planner. Click a blank cell: it shows "✓" immediately. Click again: it shows "Pause". Click again: it goes back to blank. Reload the page: the last-clicked state is still there (confirms it persisted to `brand_schedule`, not just local state). Switch tabs and back: the previously viewed tab's schedule still shows correctly.

- [ ] **Step 8: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: add click-to-cycle cell editing to Schedule Planner"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 8 new ones from Task 2, with no regressions in the rest of the suite.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: End-to-end manual check**

With `npm run dev` running, signed in as an approved user:
1. Open Schedule Planner from the sidebar. Confirm it appears in the "Admin" section alongside Score Summary and Log (not admin-only — sign in as a non-admin approved user if one is available, and confirm they can still see and use it).
2. Pick a tab with several brands (e.g. Rooster Partners). Confirm every brand from that tab's entries appears as a row.
3. Scroll the grid both directions — the Brand column and the weekday header both stay pinned.
4. Type a partial brand name into the search box — only matching rows remain; clear it — all rows return.
5. Click through a cell's three states and reload the page to confirm persistence (as in Task 6, Step 7).
6. Click next-week/previous-week/Today — only the date labels change, not any cell's status.
7. Switch to a different tab, set a cell, switch back — the tab's data loaded independently and is unaffected by the other tab's edits.

- [ ] **Step 4: Update `CLAUDE.md`**

Add a `### Recent Changes` entry (top of that list, per the existing format in `c:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Forums Dashboard\CLAUDE.md`) summarizing: new `brand_schedule` table, `/schedule-planner` route, what it does, and a link to the spec at `docs/superpowers/specs/2026-07-30-schedule-planner-design.md`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record Schedule Planner in CLAUDE.md"
```
