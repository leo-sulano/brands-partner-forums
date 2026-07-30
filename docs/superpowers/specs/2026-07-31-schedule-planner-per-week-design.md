# Schedule Planner — Per-Week Data

## Problem

`docs/superpowers/specs/2026-07-30-schedule-planner-design.md` shipped Schedule Planner as one
recurring Mon–Fri template per `(tab, brand)` — deliberately not tied to any specific calendar
week, so the prev/next/Today buttons only changed the displayed date labels. That was a
reasonable simplification at design time, but the real spreadsheet this feature replaces
(`csv/Scheduled_Planner.xlsx`) tracks 42 distinct weekly sheets with genuinely different data
week to week. Now that the recurring-template behavior is visible in the running app, the
team wants real per-week tracking instead: navigating to a different week should show that
week's own statuses, and editing a cell should only affect the week currently being viewed.

This supersedes the "one recurring template" decision from the prior spec. Everything else
from that spec — the frozen Brand column, brand search filter, click-to-cycle blank→✓→Pause→
blank interaction, tab-scoped view, brand rows derived live from `entries` — is unchanged.

## Data model

Extend `brand_schedule` with a `week_start date` column (the Monday of the week that row
belongs to) rather than introducing a normalized per-cell table — this is a direct extension
of the shipped wide-row shape, not a redesign, so the existing partial-upsert-per-day pattern
(`ON CONFLICT ... DO UPDATE SET` touching only the payload's columns) carries over unchanged.

```sql
-- The 41 rows already in the table (30 from the initial spreadsheet migration + 11 from
-- real usage on TP Brand Injection) were all written this week — backfill them to this
-- week's Monday before the column becomes NOT NULL, so no existing data is lost or
-- silently reassigned to the wrong week.
alter table public.brand_schedule add column week_start date;
update public.brand_schedule set week_start = '2026-07-27' where week_start is null;
alter table public.brand_schedule alter column week_start set not null;

alter table public.brand_schedule drop constraint brand_schedule_tab_brand_key_key;
alter table public.brand_schedule
  add constraint brand_schedule_tab_brand_key_week_start_key
  unique (tab, brand_key, week_start);
```

(`brand_schedule_tab_brand_key_key` is Postgres's deterministic default name for an inline
`unique (tab, brand_key)` clause with no explicit constraint name — `<table>_<col1>_<col2>_key`
— exactly as declared in `20260730120000_add_brand_schedule.sql`. The implementer should still
confirm this against the live schema, e.g. via `supabase db diff` or the Supabase dashboard's
table editor, before running the `drop constraint`, as cheap insurance against drift.)

No change to the four RLS policies (select open, insert/update/delete gated on
`public.is_approved()`) — they aren't column-specific.

Past weeks remain fully editable — there's no read-only-history rule. Clicking a cell in any
week, past or future, works exactly the same way; the only thing that changes is which
week's row it reads from and writes to.

## `src/lib/scheduleBrands.ts`

`BrandScheduleRow` gains `week_start: string` (ISO date, `'YYYY-MM-DD'`).

`scheduleFor(rows, tab, brand, weekStart)` and `withDayStatus(rows, tab, brand, weekStart, day,
status)` both take `weekStart` as an added parameter and match on it alongside `tab`/
`brand_key`. `withDayStatus`'s blank-row constructor includes `week_start: weekStart`.

## `src/lib/queries.ts`

- `fetchBrandSchedule(tab, weekStart)` adds `.eq('week_start', weekStart)` to the existing
  query.
- `setBrandScheduleDay(tab, brand, weekStart, day, status)` adds `week_start: weekStart` to
  the upsert payload and changes `onConflict` to `'tab,brand_key,week_start'`.

## `src/pages/SchedulePlanner.tsx`

- A new helper `toISODate(date: Date): string` (`date.toISOString().slice(0, 10)`) converts
  the existing `weekStart: Date` state into the string the queries need.
- The data-loading `useEffect`'s dependency array changes from `[tab]` to `[tab, weekStart]`
  — clicking prev/next/Today now triggers a real refetch, not just a label change.
  `fetchBrandSchedule(tab, toISODate(weekStart))` replaces the current `fetchBrandSchedule(tab)`
  call.
- `handleCellClick` threads `weekStart` through to `scheduleFor`, `withDayStatus`, and
  `setBrandScheduleDay` at every call site.
- No other UI change — same frozen column, same search, same nav buttons, same cell
  rendering.

## Historical import

All 42 dated sheets in `csv/Scheduled_Planner.xlsx` get parsed and migrated (the 43rd,
undated "Scheduled Planner" sheet is excluded — its brand set, e.g. "Medier Brands" /
Midasluck / Bit Coin, doesn't correspond to any of today's 11 `OPERATIONAL_TABS`, so there's
no valid `tab` to assign those rows to).

Per sheet:
- Column A of each data row is the brand name; columns B–F are Monday–Friday (column count
  varies sheet to sheet — some have 8 columns, some 10 — but A is always brand and B–F are
  always the five weekdays regardless).
- `week_start` is derived from the sheet name (e.g. `"27July-31July"` → `2026-07-27`,
  `"13-17 Oct"` → `2025-10-13`), inferring the year from position in the sheet order: Oct–Dec
  sheets are 2025, Jan-onward sheets are 2026 (the workbook has no year in any sheet name, and
  the sheet order is continuous from `2025-10-13` through `2026-07-27` with no gaps other than
  the year rollover at `29Dec-02 Jan`).
- Brand names are corrected to match live `entries` data where there's a clear match (e.g.
  `"Novadreams2"` → `"Novadreams"`), same as the current-week migration.
- Cell values normalize the same way as before: `'✔'` → `active`, `'Pause'`/`'ON PAUSE'` →
  `paused`, blank → no value (`null`, or no row at all if every day for that brand that week is
  blank). Free-text note-column content (e.g. `"one time"`, `"tp page removed"`, `"Pause
  permanently"`) is not migrated — the schema has no field for it, same as before.
- Any brand/group that can't be confidently tied to one of the 11 current tabs — no group
  label naming a known tab, and no live-brand match — is skipped for that week, the same rule
  already applied to `BlissBursts` / `Trusted Casino UK` / `Trusted Casino CA` / `Betway` in
  the current week. This is expected to skip more brands in older sheets (tab rosters have
  drifted over 9+ months) — the exact skip list will be reported after parsing, not guessed
  up front.
- Where a sheet's group is unlabeled, the same positional inference used for the current
  week applies (an unlabeled group directly matches a tab via its brands' live-entries
  membership).

The current week's data written by this import is expected to exactly match what's already in
the table from the earlier migration (same source sheet, same rules) — this is a
re-derivation under the new schema, not new data for that week.

## Out of scope

- No change to which 4 brands were skipped in the current week's already-migrated data.
- No "lock past weeks" or audit trail for who changed a historical week's cell — same
  edit model for every week.
- No UI affordance for jumping directly to an arbitrary historical week (e.g. a date picker)
  — only sequential prev/next/Today, matching the shipped design.

## Testing

- After the migration, the 41 pre-existing rows all read `week_start = '2026-07-27'` and the
  current week's grid in the UI shows identical data to before this change.
- Navigating to a different week (e.g. one from the historical import) shows that week's own
  statuses, distinct from the current week's.
- Editing a cell in a past week does not change that same brand's cell in the current week,
  and vice versa.
- Editing a cell in a week with no prior data (a genuine gap between imported weeks, or a
  future week) creates a new row scoped to that week only.
- Full test suite and build both pass; the historical import's per-sheet brand-skip list is
  reported for review, not silently discarded.
