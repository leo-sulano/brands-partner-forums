# Intelligent Schedule Planner

## Problem

Schedule Planner (`docs/superpowers/specs/2026-07-30-schedule-planner-design.md`,
`2026-07-31-schedule-planner-per-week-design.md`) is today a manual per-week grid: staff click
a cell to cycle blank → active (✓) → paused → blank for a `(tab, brand, week)`, one status per
weekday, with no concept of *platform* (TP/AG/CG/WO) at all. The team wants it to become a
scheduling engine that automatically generates each week's plan from posting-frequency rules
per platform, detects and pauses a brand+platform after two consecutive Removed/Refused posts
and resumes it a week later, carries unfinished work forward from Brand Tabs whose prior week's
completion fell below 40%, and shows the result with platform icons instead of a bare checkmark
— while keeping today's layout (tab selector, brand search, Mon–Fri grid, week nav) intact.

This supersedes nothing from the two prior specs at the interaction level (search, sticky
columns, week nav, per-week storage) — it adds a platform dimension and an automation layer on
top of the same table shape and the same page.

## Current state (what exists today, confirmed by reading the code)

- `brand_schedule`: `(id, tab, brand, brand_key [generated], week_start, monday..friday [text,
  'active'|'paused'|null], updated_at)`, unique on `(tab, brand_key, week_start)`. No `platform`
  column. 1,133 rows across 43 weeks, all written by manual clicks or the historical XLSX
  import — none of them platform-specific.
- `src/lib/scheduleBrands.ts`: `BrandScheduleRow`, `scheduleFor`, `nextStatus` (3-state cycle),
  `withDayStatus` (pure updater), `toISODate`. No platform concept.
- `src/pages/SchedulePlanner.tsx`: brand list comes from `fetchRawEntriesByTab` +
  `fetchTabHeaders` (distinct brand values seen in the tab's raw `entries`), refetched only on
  tab change; schedule rows refetch on `[tab, weekStartISO]`; `handleCellClick` cycles and
  persists a single day via `setBrandScheduleDay`.
- Per-platform status lives entirely in `entries.data` (JSONB), one row roughly per posting
  instance. `src/lib/queries.ts` resolves per-tab status columns (`tpCol`/`agCol`/`cgCol`/
  `woCol`) and per-tab date columns are not resolved there; `src/lib/scoreSummary.ts` already
  has everything needed per platform: `PLATFORM_STATUS_KEYS`, `PLATFORM_DATE_KEYS` (`tp: ['Trust
  Pilot']`, `ag: ['Ask Gambler review added']`, `cg: ['Casino Guru review added']`, `wo:
  ['Wizard of Odds']`), `isLiveStatus`/`isRemovedStatus`, and `parsePostDate`. "Active platforms"
  for a tab is inferred dynamically from which status columns its headers contain — there is no
  static or stored "which platforms apply to this brand" table. Per CLAUDE.md: Rooster Partners,
  Revolution Casino, SilverPlay, and Hanan are 3-platform tabs; the rest are single-platform.
- `removed_platform_brands (tab, brand_key, platform)` is an unrelated concept — a delist flag,
  not a platform-applicability table.
- Nothing today auto-generates, auto-pauses, or auto-resumes anything. Every transition is a
  manual click.
- The spec's "WOO" is this codebase's `wo` (`Platform` type in `removedPlatformBrands.ts`,
  reused by `scoreSummary.ts`). We keep `wo`; UI label "Wizard of Odds (WO)".

## Data model

### `brand_schedule`: add a `platform` column

```sql
alter table public.brand_schedule
  add column platform text check (platform in ('tp', 'ag', 'cg', 'wo'));

alter table public.brand_schedule drop constraint brand_schedule_tab_brand_key_week_start_key;
alter table public.brand_schedule
  add constraint brand_schedule_tab_brand_key_platform_week_start_key
  unique (tab, brand_key, platform, week_start);
```

(Implementer: confirm the current constraint's exact name against the live schema before
dropping it — `20260731130000_add_brand_schedule_week_start.sql` names it
`brand_schedule_tab_brand_key_week_start_key`, Postgres's default name for that migration's
inline `unique (tab, brand_key, week_start)`, but confirm via `supabase db diff` or the table
editor first, per the same caution the prior spec used.)

`platform` stays nullable. The 1,133 existing rows keep `platform = null` — they predate
platform-awareness, and there is no reliable way to retroactively assign a platform to a
historical checkmark. They are not migrated, not deleted, and not regenerated. Every row this
feature writes going forward always has an explicit `platform`. `NULL` is a *legacy* marker, not
"all platforms" or "unset" — the engine and pause/completion logic never read or write it.

A composite unique index (`tab, brand_key, week_start`) with `platform is null` still holds
correctly under the new constraint (`unique (tab, brand_key, platform, week_start)` treats each
row's `NULL` as distinct per standard Postgres unique semantics, so legacy rows don't collide
with each other or with new platform-tagged rows for the same tab/brand/week).

No RLS policy change — the four existing policies aren't column-specific.

### New table: `brand_platform_pause`

One row = one currently-active pause.

```sql
create table public.brand_platform_pause (
  id                 uuid primary key default gen_random_uuid(),
  tab                text not null,
  brand              text not null,
  brand_key          text generated always as (lower(btrim(brand))) stored,
  platform           text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  paused_week_start  date not null,
  reason             text not null,
  created_at         timestamptz not null default now(),
  unique (tab, brand_key, platform)
);

alter table public.brand_platform_pause enable row level security;

create policy "anyone can read brand_platform_pause"
  on public.brand_platform_pause for select using (true);
create policy "approved users can insert brand_platform_pause"
  on public.brand_platform_pause for insert with check (public.is_approved());
create policy "approved users can update brand_platform_pause"
  on public.brand_platform_pause for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_platform_pause"
  on public.brand_platform_pause for delete using (public.is_approved());
```

`paused_week_start` is the Monday of the week the pause takes effect (i.e. the week the engine
must skip generating that brand+platform for). Resume is implicit: once the currently-viewed
week is later than `paused_week_start`, the row is stale — `schedulerService` deletes it and
treats that brand+platform as a priority-2 resume for the new week, rather than storing an
explicit "resumed" state anywhere.

Platform applicability per brand is **not** a new table — reused as-is from the existing per-tab
header inference (`tpCol`/`agCol`/`cgCol`/`woCol` in `fetchTabKpis`), applied uniformly to every
brand in that tab, matching the documented 3-platform-tabs-vs-single-platform-tabs split.

## Scheduler module (`src/lib/scheduler/`)

Four pure/orchestration files plus one presentational file, replacing nothing in
`scheduleBrands.ts` (it stays, still used for the manual-override click path — see below).

### `schedulerRules.ts` — configurable business rules, no logic

```ts
export interface PlatformRule {
  postsPerWeek: number;
  preferredDays?: Weekday[];       // e.g. wo: [monday, wednesday, friday]
  preferredDayPairs?: Weekday[][]; // e.g. tp: [[monday, thursday], [tuesday, friday]]
}

export const PLATFORM_RULES: Record<Platform, PlatformRule> = {
  tp: { postsPerWeek: 2, preferredDayPairs: [['monday', 'thursday'], ['tuesday', 'friday']] },
  ag: { postsPerWeek: 2 },
  cg: { postsPerWeek: 1 },
  wo: { postsPerWeek: 3, preferredDays: ['monday', 'wednesday', 'friday'] },
};

export const PAUSE_RULES = { consecutiveRemovedThreshold: 2, pauseDurationWeeks: 1 };
export const CARRYOVER_RULES = { completionThreshold: 0.40 };
```

Adding a 5th platform is one `PLATFORM_RULES` entry plus one `PLATFORM_STATUS_KEYS`/
`PLATFORM_DATE_KEYS` entry in `scoreSummary.ts` — no engine changes.

### `schedulerEngine.ts` — pure, no I/O, fully unit-testable

```ts
export interface SchedulerInput {
  tab: string;
  weekStart: string;
  brands: string[];                              // this tab's brand list (as SchedulePlanner.tsx already computes it)
  activePlatforms: Platform[];                    // this tab's platforms, from the existing per-tab header inference
  existingRows: BrandScheduleRow[];                // this week's rows already written (manual overrides live here)
  activePauses: { brand_key: string; platform: Platform }[];
  resumingPauses: { brand_key: string; platform: Platform }[];  // pauses expiring exactly at this weekStart
  carryover: { brand_key: string; platform: Platform; count: number }[]; // unfinished slots from last week's <40% tabs
}

export function generateWeekSchedule(input: SchedulerInput): BrandScheduleRow[];
```

Behavior:
- Never touches a `(brand_key, platform)` combination that already has an `existingRows` entry
  for this week with at least one non-null day — that combination is treated as pinned (manually
  set, or already generated) and left alone.
- Skips any `(brand_key, platform)` in `activePauses` entirely (no days assigned).
- Assigns days in priority order — carryover first (adds extra posts on top of the platform's
  normal `postsPerWeek` for that brand), then `resumingPauses` (normal `postsPerWeek`, marked so
  the UI can label "resumed"), then every remaining active brand×platform combination at its
  normal `postsPerWeek`.
- Day selection: try the platform's `preferredDays`/`preferredDayPairs` first; if the least-
  loaded of the preferred choices is still meaningfully more loaded than the week's least-loaded
  day overall, fall back to whichever weekday currently has the fewest assignments across the
  whole tab (a simple greedy least-filled-day heuristic), while still enforcing that a brand
  never gets the same platform twice in a day (trivially true — one `postsPerWeek` slot is
  assigned to at most one day each) and a brand never gets two *different* platforms forced onto
  the same day unless the tab has more platform-slots to place than open days that week.
- Output is the full set of `BrandScheduleRow`s for the week (existing pinned rows included
  unchanged, new rows added) — `schedulerService` diffs this against what it already fetched and
  only writes the rows that changed.

### `schedulerService.ts` — I/O orchestration, called from the page

```ts
export async function ensureWeekGenerated(tab: string, weekStart: string): Promise<void>;
export async function recalculatePauses(tab: string, weekStart: string): Promise<void>;
```

- `ensureWeekGenerated`: checks whether *any* platform-tagged row already exists for
  `(tab, weekStart)`; if so, no-op (a week is generated exactly once, never regenerated wholesale
  — satisfies "avoid regenerating the entire planner unnecessarily"). Otherwise gathers brands +
  `activePlatforms` (reusing the page's existing fetch), active `brand_platform_pause` rows,
  last week's per-tab completion (see below) to build `carryover`, calls `generateWeekSchedule`,
  and bulk-upserts only the newly-produced rows via a single `upsert(rows, { onConflict:
  'tab,brand_key,platform,week_start' })` call.
- `recalculatePauses`: for every `(brand, platform)` active in the tab, pulls that brand's
  `entries` rows with a non-empty status for that platform (reusing `PLATFORM_STATUS_KEYS`/
  `PLATFORM_DATE_KEYS` from `scoreSummary.ts`), sorts by `parsePostDate` descending, takes the
  two most recent. If both satisfy `isRemovedStatus` (already covers removed/refused/rejected —
  every combination in the spec's Removed/Refused table is covered by this one check) and no
  `brand_platform_pause` row exists yet for that `(brand_key, platform)`, inserts one with
  `paused_week_start = weekStart` and a `reason` string ("Two consecutive Removed/Refused
  posts"). If a pause row exists and its `paused_week_start` is before `weekStart`, deletes it
  (resume) — the deletion result is what feeds `resumingPauses` into the next
  `ensureWeekGenerated` call. This function only touches the brand+platform pairs it evaluates,
  never a whole-table sweep.
- Both are called once from `SchedulePlanner.tsx`'s existing `[tab, weekStartISO]` effect,
  awaited before `fetchBrandSchedule` — recalculate pauses, then ensure the week is generated
  (order matters: generation needs this week's fresh pause/resume state), then fetch and render
  as today.

### `scheduleUtils.ts` — new shared pure helpers (not a rename of `scheduleBrands.ts`)

Platform icon/color config (`PLATFORM_BADGE = { tp: {...}, ag: {...}, cg: {...}, wo: {...} }`,
short label + Tailwind classes), a `weeklyCompletion(tab, weekStart)` helper (scheduled vs.
completed slot counts for the Brand Tab Completion Rule — scheduled = count of that week's
platform-tagged `brand_schedule` rows × their non-null day count; completed = how many of those
same brand+platform+week combinations have an `entries` row whose status resolves `isDoneStatus`
via `queries.ts`'s existing classifier), and the least-loaded-day distribution helper used by the
engine.

### `calendarRenderer.tsx` — presentational only

`ScheduleCell` (badges + click → popover), `PausedPlatformIndicator` (the "⛔ paused" row
segment + tooltip), `SuccessRateBadge`. Extracted out of `SchedulePlanner.tsx`'s inline JSX; the
page keeps its data-fetching/orchestration role, these become its render helpers.

`scheduleBrands.ts` is untouched apart from one addition: `nextStatus`/`withDayStatus` need a
`platform` parameter threaded through (matching the `weekStart` precedent from the prior spec)
since a manual click now targets a specific `(brand, platform, day)`, not just `(brand, day)`.

## Automation rules

- **Generation**: exactly as `schedulerService.ensureWeekGenerated` above — priority carryover >
  resuming > normal > fill, least-loaded-day balancing, brand-tab-wide (not per-brand) fairness.
- **Pause/resume**: as `recalculatePauses` above — reuses `isRemovedStatus`, which already
  treats Removed and Refused as the same bucket, so every combination in the spec ("Removed →
  Removed", "Removed → Refused", "Refused → Removed") is one code path, not three.
- **Completion carryover**: per Brand Tab per week, `weeklyCompletion` gives `completed` /
  `scheduled`. If last week's ratio was below 0.40, every `(brand_key, platform)` slot from that
  week that didn't reach a Completed status is added to this week's `carryover` list — additive
  on top of the platform's normal weekly frequency, not a replacement.

## UI changes (existing layout, no redesign)

- Day cell: replaces ✓/Pause pill with small platform-code badges (TP/AG/CG/WO), deduplicated —
  3 TP posts on Monday still render one TP badge.
- Click on a cell opens a popover scoped to that cell: that brand's platform(s) scheduled that
  day with status (e.g. "Trustpilot — Scheduled"). Not a tab-wide, cross-brand day summary — the
  grid's grain stays one row per brand.
- Pause display: since rows stay per-brand (covering all that brand's platforms), a paused
  platform doesn't gray the whole row. Only that platform's badge is replaced, across all 5 days
  of that row, with a muted "⛔ Paused" indicator; hovering shows the reason and "Resumes Week of
  <date>" (derived from `paused_week_start + 7 days`). Other platforms in the same row render
  normally.
- New Success Rate column per brand row, reusing `computeSuccessRates` from `scoreSummary.ts`
  (all-time, matching Score Summary's default), colored green ≥80%, yellow 50–79%, red <50%,
  "—" when null (no decided outcome yet).
- Search stays instant client-side filtering over the brand list, unchanged.
- Manual override: clicking a platform's badge on a day still cycles blank → active → paused →
  blank for that specific `(brand, platform, day)`, persisted the same optimistic-update-then-
  rollback way as today. A manually-set cell is what `generateWeekSchedule` treats as pinned on
  future runs (see `existingRows` above) — it is never silently overwritten by regeneration,
  because a week is only ever generated once (`ensureWeekGenerated`'s no-op guard).

## Performance

Brand counts already reach into the thousands (Rooster Partners alone: ~2,429 raw `entries`
rows). `schedulerService` batch-fetches per tab, reusing the existing `fetchRawEntriesByTab` /
`fetchTabHeaders` calls the page already makes — no new per-brand round trips. Generation writes
are one bulk `upsert` call per week per tab, not one call per row. `recalculatePauses` fetches
each active brand+platform's entries once (already-loaded tab entries, filtered client-side by
brand+platform, not a new query per brand). Both operations are scoped to the single `(tab,
weekStart)` being viewed — never a full-table or full-history sweep — matching "recalculate only
affected Brand + Platform."

## Trigger (lazy, on page load / week navigation)

No new backend infrastructure. `ensureWeekGenerated` and `recalculatePauses` run from
`SchedulePlanner.tsx`'s existing `[tab, weekStartISO]` effect, guarded by the "does this week
already have platform rows" no-op check, so navigating back to an already-generated week costs
one existence check, not a regeneration. This means generation/pause-recalc only happens when
someone actually opens the page for that tab/week — acceptable since Schedule Planner is checked
regularly, and explicitly chosen over a `pg_cron` Edge Function to avoid new infrastructure and
error-monitoring surface.

## Known gap to verify during implementation

`scoreSummary.ts`'s `PLATFORM_DATE_KEYS.wo` is `['Wizard of Odds']` — a single hardcoded header
variant, unlike `tp`'s multi-variant `resolveHeader`-style matching in `queries.ts`. If a
WO-tracking tab's actual header differs in casing or wording, `pick()` (exact key match) misses
it, and `recalculatePauses` silently sees no dates for WO, ordering its entries arbitrarily
instead of by recency. Implementer should confirm the live header name for at least one WO tab
before relying on this for pause detection; if it doesn't match, either add the real variant to
`PLATFORM_DATE_KEYS.wo` or add case-insensitive resolution there (small, isolated fix either
way).

## Rollout (phased)

1. **Migration + engine scaffolding** — schema changes (`platform` column,
   `brand_platform_pause` table), `src/lib/scheduler/` module with `schedulerRules.ts` and
   `schedulerEngine.ts` fully unit-tested in isolation (no I/O, no UI change, nothing wired into
   the page yet).
2. **Wire generation into the page** — `schedulerService` built and called from
   `SchedulePlanner.tsx`'s existing effect; cells render with a minimal platform-badge treatment
   so generated data is visible and verifiable, but popover/pause-indicator/Success-Rate polish
   isn't built yet.
3. **Full UI** — `calendarRenderer.tsx` pieces: popover, pause indicator with tooltip, Success
   Rate column, final badge styling.
4. **Completion carryover** — enabled last, since it needs at least one fully platform-generated
   week's data to compute "last week's completion" against; turning it on earlier would carry
   over against legacy (`platform = null`) weeks, which have no meaningful per-platform
   scheduled/completed count.

## Out of scope

- No change to the 1,133 legacy (`platform = null`) rows — not migrated, not deleted, not
  regenerated, rendered read-only in today's old checkmark style if a legacy week is viewed.
- No day-summary / cross-brand popover (the mockup's "Trustpilot: WinMega, Lucky7even,
  FortunePlay" grouping) — per-cell popover only, matching the existing per-brand-row grid.
- No `pg_cron` / server-side automation — lazy on-page-load generation only.
- No change to how "active platforms per tab" is determined — reuses the existing per-tab header
  inference as-is, not a new per-brand platform-applicability table.
- No change to the check-status Selenium pipeline, `entries` schema, or how TP/AG/CG/WO statuses
  get written — the scheduler only *reads* that data.

## Testing

- `schedulerEngine.generateWeekSchedule` unit tests: normal-priority distribution respects each
  platform's `postsPerWeek` and preferred days/pairs when load allows; carryover and resuming
  pauses win priority over normal generation; paused brand+platform combinations get zero days;
  pinned (`existingRows`) combinations are never overwritten; load-balancing falls back to
  least-filled-day when preferred days are already saturated.
- `schedulerService.recalculatePauses`: two consecutive removed-classified posts (in any of the
  three combinations) inserts a pause; a pause whose week has passed is deleted on the next call;
  a single Removed post (not two consecutive) does not pause.
- `ensureWeekGenerated` is a true no-op (no writes) on a week that already has platform rows.
- Manual override: clicking a platform badge still cycles and persists correctly, and survives
  the next `ensureWeekGenerated` no-op call for that week.
- Full test suite and build both pass before this is considered done.
