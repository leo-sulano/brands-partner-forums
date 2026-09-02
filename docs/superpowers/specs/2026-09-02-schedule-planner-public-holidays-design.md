# Schedule Planner — Public Holiday Blocking + Workload Rebalance

**Date:** 2026-09-02
**Status:** Design approved, pending spec review
**Tier:** 3 (touches `schedulerEngine.ts` / `schedulerService.ts` / date semantics / logic duplicated in `ai-assistant/tools.ts`)

## Problem

The Schedule Planner auto-generates each week's brand/platform posting schedule across
Monday–Friday, load-balanced via `leastLoadedDay` in `schedulerEngine.ts`. It has no concept
of a public holiday: on a day the team does not work, it still schedules posts. There is also
no way for the team to mark a day as non-working — including **local / city holidays that are
not national**, which no static list could anticipate.

Two things are wanted:

1. **Block public holidays** — no posts scheduled on a holiday weekday, for both
   auto-generation and manual editing.
2. **Keep the workload balanced** — a platform's weekly post count is preserved and
   redistributed evenly across the remaining working days, not simply dropped.

## Scope

### In scope

- A user-editable `public_holidays` Supabase table (date + name), seeded with fixed-date
  Philippine national non-working holidays.
- A "Public Holidays" management modal on the Schedule Planner page (approved users add /
  remove any date, including local holidays).
- `schedulerEngine.ts` gains an `unavailableDays: Weekday[]` input and excludes those days
  from assignment, redistributing load across the rest.
- `schedulerService.ts` (`ensureWeekGenerated`) converts the week's holidays into
  `unavailableDays` and passes them to the engine.
- Holiday data threaded through `TabContext`, fetched by `SchedulePlanner.tsx` /
  `TabScheduleSection.tsx` and the `generate-weekly-schedule` edge function's
  `buildTabContext`, exactly like `removedPlatformBrandSet` / `overrideMap` /
  `hiddenBrandSet` already are.
- Calendar UI: holiday weekday columns render greyed, header shows the holiday name,
  `ScheduleCell` on a holiday date is read-only (no click-to-cycle, no "+ Add Platform").
  Mini-calendar / landing-grid preview grey the day too.
- CSV/Excel export: one new `Holidays This Week` column.
- Ask AI `get_schedule` tool: returns the week's holidays and its description notes holiday
  weekdays are never scheduled. `supabase functions deploy ai-assistant` deferred and
  flagged as a pending manual step.

### Out of scope / accepted limitations

- **Past / already-generated weeks are not rewritten.** Adding a holiday only affects
  weeks generated after the change. Matches the project's standing "never rewrite history"
  norm.
- **A holiday that already has chips** (a legacy `platform = null` week, or a chip added
  before the date was listed) still renders those chips, read-only, and never auto-deletes
  them.
- **PMS pull-direction**: a human dragging a linked PMS task's due date onto a holiday
  still writes that `brand_schedule` day via `weekdayAndWeekStartFor` /
  `setBrandScheduleDay`. Left unguarded, same spirit as the existing "due date moved onto a
  weekend" nuance. Documented as a known limitation.
- **No force-post-on-holiday override.** Holiday cells are fully read-only, per the
  approved design.
- **Special *working* holidays are intentionally excluded.** The list holds non-working
  days only. The seed contains only that class, and the modal's help text says so.
- **Region is global, not per-tab.** A "local holiday" is local to where the *team* sits,
  so it stops the whole team's workload regardless of which tab is being scheduled.
- **Movable national holidays are not seeded** (Holy Week, National Heroes Day, Eid'l Fitr,
  Eid'l Adha, Chinese New Year, EDSA anniversary). The team adds these — and any local
  holiday — through the modal. This is the deliberate tradeoff of not depending on an
  external API or a yearly code change.

## Data model

### New table: `public_holidays`

```sql
create table public.public_holidays (
  id         uuid primary key default gen_random_uuid(),
  date       date not null unique,
  name       text not null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.public_holidays enable row level security;

-- Anyone authenticated can read (same as every other schedule-config table).
create policy "public_holidays_select" on public.public_holidays
  for select using (true);

-- Approved users only for writes (mirrors removed_platform_brands /
-- schedule_hidden_brands / brand_platform_override policy shape). All four
-- policies added together per the project's RLS rule — a missing DELETE
-- policy silently no-ops deletes.
create policy "public_holidays_insert" on public.public_holidays
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved)
  );
create policy "public_holidays_update" on public.public_holidays
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved)
  );
create policy "public_holidays_delete" on public.public_holidays
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved)
  );
```

(The exact approved-user predicate is copied verbatim from the most recent existing
schedule-config table's migration during implementation, not hand-written, so it can't
drift from the project's current RLS convention.)

### Seed (same migration)

Fixed-date PH national non-working holidays for **2026 and 2027**:

| date | name |
|------|------|
| 2026-01-01 / 2027-01-01 | New Year's Day |
| 2026-04-09 / 2027-04-09 | Araw ng Kagitingan |
| 2026-05-01 / 2027-05-01 | Labor Day |
| 2026-06-12 / 2027-06-12 | Independence Day |
| 2026-08-21 / 2027-08-21 | Ninoy Aquino Day |
| 2026-11-30 / 2027-11-30 | Bonifacio Day |
| 2026-12-08 / 2027-12-08 | Feast of the Immaculate Conception |
| 2026-12-25 / 2027-12-25 | Christmas Day |
| 2026-12-30 / 2027-12-30 | Rizal Day |
| 2026-12-31 / 2027-12-31 | Last Day of the Year |

`insert ... on conflict (date) do nothing` so re-running the migration (or a team member
having already added one of these manually) is safe.

The migration file carries a comment: *"Starter set only — fixed-date national non-working
holidays. Movable national holidays and all local/city holidays are added by the team
through the Public Holidays modal. Do NOT add special *working* days here."*

## Components

### `src/lib/publicHolidays.ts` (new — pure, Deno-safe)

No hardcoded holiday array; operates on rows passed in.

```ts
import { WEEKDAYS, type Weekday, toISODate } from './scheduleBrands.ts';

export interface PublicHoliday {
  date: string;  // 'YYYY-MM-DD'
  name: string;
}

// All holidays whose date falls on Mon–Fri of the given week.
export function holidaysInWeek(weekStartISO: string, holidays: PublicHoliday[]): PublicHoliday[];

// The weekday enum values (['wednesday', ...]) blocked by a holiday that week.
export function holidayWeekdaysForWeek(weekStartISO: string, holidays: PublicHoliday[]): Weekday[];

// Same result from a bare Set of ISO date strings — this is what
// schedulerService.ts calls, so it never has to fabricate {name:''} objects
// from its TabContext.holidayDates set. holidayWeekdaysForWeek is implemented
// in terms of this.
export function holidayWeekdaysForDateSet(weekStartISO: string, dates: Set<string>): Weekday[];

// Convenience: the holiday on an exact date, or undefined.
export function holidayOn(dateISO: string, holidays: PublicHoliday[]): PublicHoliday | undefined;

// Set of ISO date strings, for O(1) membership tests in the UI and the service.
export function buildHolidayDateSet(rows: PublicHoliday[]): Set<string>;
```

- Weekend holidays are naturally ignored (Schedule Planner has no Sat/Sun columns).
- Week-day mapping computed the same local-time way as `scheduleBrands.ts` (`.split('-')`
  + `new Date(y, m-1, d)`), never `Date.parse` / `toISOString`, to avoid the documented
  UTC-rollback bug.
- `.ts` extensions on the one import — this file is reachable from the
  `generate-weekly-schedule` Deno bundle via the scheduler chain.
- Unit-tested (`publicHolidays.test.ts`): a Wednesday holiday resolves to
  `['wednesday']`; a Saturday holiday resolves to `[]`; a holiday outside the week
  resolves to `[]`; two holidays in one week resolve to both weekdays.

### `src/lib/queries.ts`

```ts
export async function fetchPublicHolidays(client?: SupabaseClient): Promise<PublicHoliday[]>;
export async function addPublicHoliday(date: string, name: string, client?: SupabaseClient): Promise<void>;
export async function deletePublicHoliday(id: string, client?: SupabaseClient): Promise<void>;
```

- `fetchPublicHolidays` selects `id, date, name` ordered by `date`. Same optional-injected-
  client signature as the other scheduler query functions so the edge function can pass its
  service-role client.
- `deletePublicHoliday` checks the affected-row count (per the project's "Supabase silently
  no-ops blocked deletes" rule) and throws if zero.

### `src/lib/scheduler/schedulerEngine.ts`

```ts
export interface SchedulerInput {
  // ...existing...
  unavailableDays: Weekday[];   // NEW — holiday weekdays for this week
}
```

- `generateWeekSchedule`: `const availableDays = WEEKDAYS.filter(d => !input.unavailableDays.includes(d));`
- `dayCounts` keeps all five keys at `0` (unchanged literal) — holiday days simply never
  get picked, so their count stays 0; this avoids an incomplete `Record<Weekday, number>`.
- `selectDays`: both `preferredPool` and the `overallAvailable` set are intersected with
  `availableDays` (the engine threads `availableDays` into `selectDays`, replacing its
  current unconditional `[...WEEKDAYS]` / `WEEKDAYS.filter(...)` references). The existing
  `DAY_SLACK` spillover logic then runs unchanged on the smaller pool.
- If `availableDays.length === 0` → `generateWeekSchedule` returns `[]` (nothing scheduled
  that week).
- **Workload rebalance is emergent, not new code**: because `leastLoadedDay` already
  spreads posts across whatever days are in the pool, removing a day just means the same
  weekly post count lands on the remaining days, still balanced. A platform only loses
  posts when `postsPerWeek > availableDays.length` (e.g. a week with 4 holidays and TP's
  2/wk → 1 post). The existing `if (overallAvailable.length === 0) break;` guard already
  handles "more slots than days".
- Tests (`schedulerEngine.test.ts`): holiday day never appears in any slot; TP 2/wk with
  Thursday blocked still produces 2 slots on available days; a 4-holiday week caps each
  platform at 1; a 5-holiday week produces no slots.

### `src/lib/scheduler/schedulerService.ts`

- `TabContext` gains `holidayDates?: Set<string>` (ISO date strings). Optional, defaulting
  to "no holidays", same convention as `removedPlatformBrandSet` etc.
- `ensureWeekGenerated`: `const unavailableDays = holidayWeekdaysForDateSet(weekStart,
  ctx.holidayDates ?? new Set());` — passed straight into `generateWeekSchedule`.
- `recalculatePauses` is **unchanged** — it reads entry status and writes pause rows, it
  never assigns weekdays. A holiday has no bearing on whether a brand/platform should be
  paused.
- `buildCarryover` is unchanged (and currently disabled). Carryover counts, if ever
  re-enabled, flow through the same reduced `selectDays` pool automatically.
- Tests (`schedulerService.test.ts`): `ensureWeekGenerated` with a `holidayDates` set
  containing a Wednesday in `weekStart`'s week writes no `wednesday: 'active'` for any row;
  the same combos still get their full weekly count on other days.

### `generate-weekly-schedule` edge function

- `buildTabContext` adds `fetchPublicHolidays(client)` to its `Promise.all` and sets
  `holidayDates: buildHolidayDateSet(rows)` on the returned `TabContext`.
- No other change — `ensureWeekGenerated` does the rest. The Monday cron automatically
  respects holidays once redeployed.
- **Redeploy required** (`supabase functions deploy generate-weekly-schedule`) — flagged as
  a pending manual step, consistent with this function's existing deploy caveats. Until
  redeployed the cron ignores holidays (the page-visit trigger, which runs the new
  frontend code, does not).
- `deno check --no-lock --node-modules-dir=none --config .../deno.json .../index.ts` must
  pass (the import-map-exercising form noted in the function's own header comment).

### Calendar UI — `SchedulePlanner.tsx` / `TabScheduleSection.tsx` / `calendarRenderer.tsx`

- Both page components fetch `fetchPublicHolidays()` alongside their existing schedule
  fetches and hold a `holidayDateSet: Set<string>` in state. `TabScheduleSection` also puts
  `holidayDates` on the `TabContext` it passes to `recalculatePauses` /
  `ensureWeekGenerated` (currently it builds a fresh `ctx` object at
  `TabScheduleSection.tsx:335` — add the field there and to the brands-loading `setTabCtx`).
- For each rendered weekday column, the parent computes the column's real calendar date
  (it already does, via `columnsForWeek` / `col.weekStartISO` + weekday index) and looks up
  `holidayOn(colDateISO, holidays)`.
- `ScheduleCellProps` gains `holidayName?: string` (present ⇒ this cell's date is a
  holiday). Threaded the same way `isPastDay` already is.
- `ScheduleCell` when `holidayName` is set:
  - `clickable` is forced `false` (no `onToggle` / `onSetStatus` / `onCancel` wiring).
  - The "+ Add Platform" button (`calendarRenderer.tsx:396`) is not rendered.
  - Cell background greyed; a small "Holiday" tag + the name shown (tooltip via the shared
    `Tooltip` component, matching the page's other tooltips).
  - Any existing chips still render, visually dimmed, non-interactive.
- Column header (weekday + date) shows a holiday marker + name when that column is a
  holiday.
- Mini-calendar / landing-grid preview (`TabScheduleSection`'s preview grid): the holiday
  day cell is greyed with the name; `countActivePlatformSlots` already returns 0 there so
  the count strip is consistent.
- `AddPlatformModal` is never opened for a holiday cell (button removed), so no change
  needed inside it.

### Export — `src/lib/scheduler/scheduleExport.ts`

- `SCHEDULE_EXPORT_HEADERS` gains a trailing `'Holidays This Week'`.
- `ScheduleExportBrandData` is per-brand/row; the holiday list is per-week, not per-row.
  Add an optional `holidaysThisWeek?: string` to `ScheduleExportBrandData` (the caller,
  which knows the week, joins names with `, `) OR pass it once into
  `buildScheduleExportRows(data, holidaysThisWeek?)`. Prefer the function parameter — it's
  genuinely week-level, not brand-level. Every row gets the same value in the new column.
- Test (`scheduleExport.test.ts`): with two holidays that week, every emitted row's last
  cell is `"New Year's Day, Rizal Day"`; with none it is `""`.

### Ask AI — `supabase/functions/ai-assistant/tools.ts`

- `get_schedule` response gains `holidays: { date: string; name: string }[]` for the
  requested `week_start`, built by importing `holidaysInWeek` from
  `src/lib/publicHolidays.ts` (real shared import, **not** a re-implementation) after
  fetching rows with the function's existing supabase client.
- The tool's `description` gains a sentence: *"Weekdays that fall on a public holiday are
  never scheduled; the `holidays` array lists any such days in the requested week."*
- `tools_test.ts`: a fixture week containing a holiday returns it in `holidays` and no
  schedule row lands on that weekday.
- Per the cross-dashboard rule, this is done in the same task. Only the **deploy**
  (`supabase functions deploy ai-assistant`) is deferred and flagged.

## Data flow

```
                    public_holidays table  (edited via modal or Supabase)
                              │
         ┌────────────────────┼─────────────────────────────┐
         │ fetchPublicHolidays│                             │ fetchPublicHolidays
         ▼                    ▼                             ▼
 SchedulePlanner.tsx   TabScheduleSection.tsx      generate-weekly-schedule
 / TabScheduleSection      │  holidayDates on           buildTabContext
   holidayDateSet          │  TabContext                  holidayDates on TabContext
   (UI: grey + read-only)  ▼                                   │
                    ensureWeekGenerated ◄────────────────────── ┘
                       holidayWeekdaysForWeek(weekStart, …)
                              │ unavailableDays: Weekday[]
                              ▼
                    generateWeekSchedule (pure)
                       availableDays = WEEKDAYS − unavailableDays
                       leastLoadedDay balances over availableDays
                              │ slots (never on a holiday weekday)
                              ▼
                    brand_schedule rows  →  calendar, export, PMS push, Ask AI
```

## Error handling

- `fetchPublicHolidays` failure in `TabScheduleSection`'s flag load: routed through the
  existing `withFlagFallback` wrapper so a transient failure sets `flagsLoaded = false` and
  **gates the scheduler-invocation effect** — the same protection the other exclusion sets
  get. A stale/empty holiday set must never cause `ensureWeekGenerated` to schedule onto a
  holiday it should have blocked. The section still renders best-effort with whatever
  loaded.
- `generate-weekly-schedule`: `fetchPublicHolidays` failure should **fail the tab's
  generation** for that run (throw, caught by `generateAllTabs`'s per-tab `try/catch`),
  not silently proceed with no holidays — same reasoning. It is not a "best-effort
  informational" fetch like `fetchBrandAgentAssignments`.
- Modal add/delete errors surface as a toast; the list refetches on success.
- Duplicate date on add: the DB unique constraint rejects it; the modal shows "That date
  is already listed."

## Testing

- Unit: `publicHolidays.test.ts`, `schedulerEngine.test.ts` (new holiday cases),
  `schedulerService.test.ts` (new holiday cases), `scheduleExport.test.ts` (new column),
  `tools_test.ts` (Ask AI).
- `npm run build` clean.
- `deno check` clean for both Deno consumers (`generate-weekly-schedule`, `ai-assistant`).
- Whole-branch review (Tier 3) before merge — specifically checking that Overview / Score
  Summary / Brand Tabs are genuinely unaffected (they read entry status, not the plan) and
  that the calendar grid, mini-calendar, count strip, and export all agree on which days
  are holidays.
- Live Playwright check: on a tab whose current or next week contains a seeded holiday,
  confirm (a) no chip is generated on that weekday, (b) the platform's other posts still
  add up to its weekly count, (c) the holiday column is greyed / read-only with the name
  shown, (d) adding a fresh local holiday via the modal for a future week and revisiting
  that week blocks the day, (e) removing it re-opens the day.

## Deployment checklist

1. `supabase db push` — creates + seeds `public_holidays`.
2. `git push origin main` — frontend (page fetch, modal, engine, service, export).
3. `supabase functions deploy generate-weekly-schedule` — Monday cron respects holidays.
4. `supabase functions deploy ai-assistant` — `get_schedule` returns holidays.
5. Vercel Production redeploy (automatic on push).

Steps 3 and 4 are flagged pending-manual, consistent with this project's edge-function
deploy history. The frontend and cron degrade safely without them (frontend fully works
from step 2; cron just ignores holidays until step 3).
