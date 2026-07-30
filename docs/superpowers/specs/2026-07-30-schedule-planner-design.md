# Schedule Planner

## Problem

There's no in-app way to plan or record which weekdays a brand's outreach/posting work
happens vs. pauses. Today this lives in an external spreadsheet: brand-owner groups
("Rooster Brands", "SuprNation Brands", ...) each list their brands with a Monday–Friday
row of "✓" (active) / "Pause" / blank. This adds a native page for that: a per-tab weekly
grid, brand rows frozen on the left, editable by clicking cells, with a brand search filter
since a single tab (e.g. Rooster Partners) already has 10+ brands.

This is a purely manual planning calendar — one recurring Mon–Fri template per brand, not
tied to specific calendar weeks, and it does not drive the existing check-status automation
(EC2 cron). Next/previous-week navigation only changes the displayed date labels for
context; the underlying data is the same regardless of which week is showing.

## Data model

One new table, one row per `(tab, brand)`, with a fixed column per weekday — chosen over a
normalized `(tab, brand, weekday)` row-per-cell design because the weekday set is a fixed
domain constant (always exactly Mon–Fri, never more), so a wide row maps directly onto "one
brand's week" with no reshaping needed to render a grid row:

```sql
create table public.brand_schedule (
  id uuid primary key default gen_random_uuid(),
  tab text not null,
  brand_key text not null,
  monday text check (monday in ('active', 'paused')),
  tuesday text check (tuesday in ('active', 'paused')),
  wednesday text check (wednesday in ('active', 'paused')),
  thursday text check (thursday in ('active', 'paused')),
  friday text check (friday in ('active', 'paused')),
  updated_at timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.brand_schedule enable row level security;

create policy "brand_schedule_select" on public.brand_schedule
  for select using (true);
create policy "brand_schedule_insert" on public.brand_schedule
  for insert with check (public.is_approved());
create policy "brand_schedule_update" on public.brand_schedule
  for update using (public.is_approved());
create policy "brand_schedule_delete" on public.brand_schedule
  for delete using (public.is_approved());
```

No `brand_display` column: the page always gets its row labels live from `entries` (see
below), and only uses `brand_key` to look up that brand's schedule row. A `NULL` day column
and "no row for this brand at all" are equivalent — both render as a blank cell — so no
cleanup/delete-when-all-blank logic is needed; every cell click is a plain upsert.

`brand_key` reuses the existing `normalizeBrandKey` helper from
`src/lib/removedPlatformBrands.ts` (trim + lowercase), the same normalization already
relied on elsewhere to match brand values from `entries` regardless of casing or the known
trailing-space inconsistency in imported data.

## `src/lib/scheduleBrands.ts` (new)

```ts
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

export function scheduleFor(rows: BrandScheduleRow[], tab: string, brand: string): BrandScheduleRow | undefined;
export function nextStatus(current: DayStatus): DayStatus; // null -> 'active' -> 'paused' -> null
```

Mirrors how `removedPlatformBrands.ts` centralizes matching logic for its feature — every
reader of schedule data goes through `scheduleFor`, so the brand-key normalization can't
drift between call sites.

## `src/lib/queries.ts` (additions)

- `fetchBrandSchedule(tab: string): Promise<BrandScheduleRow[]>` — `select * from
  brand_schedule where tab = :tab`.
- `setBrandScheduleDay(tab: string, brand: string, day: Weekday, status: DayStatus):
  Promise<void>` — upserts on `(tab, brand_key)`, setting only the one `day` column (and
  `updated_at`); other days on the row are untouched. `status: null` is a normal upsert
  value (clears that one day), not a row delete.

## Page: `src/pages/SchedulePlanner.tsx` (new)

Added to `App.tsx`'s lazy routes as `/schedule-planner`, and to `Sidebar.tsx`'s "Admin"
section (alongside Score Summary and Log — open to any approved user, not admin-gated,
matching that section's existing access model).

**Layout:**
- A tab `<select>` (options = `OPERATIONAL_TABS`) at the top of the page, plus a search
  input, both feeding the frozen Brands column below.
- Week header: a prev-arrow / label / next-arrow control tracking a `weekStart` (a Monday
  `Date`) plus a "Today" button that resets it to the current week's Monday. Purely a
  label — `weekStart` never affects which data loads.
- Grid: one column per weekday (`WEEKDAYS`), header cell shows weekday name + the date
  derived from `weekStart` (e.g. "Mon Aug 3"). One row per brand.
- Brand rows: derived live from `entries` exactly like `BrandGroup.tsx` does today —
  `brandCol = BRAND_COLS.find(c => headers.includes(c))`, `uniqueBrands = [...new
  Set(entries.map(e => e.data[brandCol]).filter(...))].sort()`, with the same
  `TAB_DEFAULT_BRAND[tab]` single-implicit-brand fallback for tabs with no distinct brand
  column values. The search input filters this array client-side (case-insensitive
  substring). `fetchBrandSchedule(tab)` loads the corresponding `brand_schedule` rows in
  parallel; a brand with no matching row renders all 5 cells blank.
- Frozen Brands column: same sticky pattern already used in `BrandGroup.tsx` — `sticky
  left-0 z-10 bg-white` on the brand-name cell, `sticky top-0` on the header row. The
  whole grid lives in its own `overflow-auto` panel (not the page's outer scroll
  container), matching the existing "bounded self-scrolling panel" pattern — nesting a
  sticky element inside the page's own `overflow-y-auto <main>` breaks stickiness.

**Persistence of view state:** selected tab and search text are remembered in
`sessionStorage` (same rationale as the brand-tab filter persistence work: survive
navigating away and back, reset on browser close), keyed independently of `weekStart`,
which always defaults to the current real-world week on mount.

## Cell interaction

Click cycles a cell through blank → `active` → `paused` → blank
(`nextStatus`/`WEEKDAYS`), firing `setBrandScheduleDay` optimistically: the grid's local
state updates immediately, with rollback + a toast on failure (same optimistic-update
pattern used for the platform-removed checkboxes elsewhere in the app). Rendering:
- blank: empty cell, subtle hover background as an affordance that it's clickable.
- `active`: a green check mark.
- `paused`: a gray "Pause" text pill.

## Out of scope

- No per-calendar-week data — confirmed this is one recurring template; `weekStart` is
  cosmetic only.
- No automation link — nothing reads `brand_schedule` outside this page; the EC2
  check-status cron is untouched.
- No bulk actions (e.g. "set this brand paused all week") — single-cell clicks only.
- No cleanup of `brand_schedule` rows whose brand no longer appears in `entries` — same
  tolerance for orphaned rows the app already has elsewhere (e.g. removed-platform flags).

## Testing

- Selecting a tab with 10+ brands (e.g. Rooster Partners) shows one row per unique brand,
  frozen while scrolling horizontally through the weekday columns.
- Typing in the search box narrows the visible brand rows; clearing it restores the full
  list; a filter matching nothing shows a "No brands match" state.
- Clicking a blank cell shows a check mark, clicking again shows "Pause", clicking again
  returns to blank — and reloading the page (fresh fetch) shows the same state, confirming
  it persisted.
- Switching tabs and back, and navigating to another page and back, restores the
  previously selected tab and search text; switching to a tab never before visited shows
  its own (empty) defaults, unaffected by the previous tab.
- Clicking next-week/previous-week/Today changes only the displayed dates in the header —
  the grid's statuses do not change.
