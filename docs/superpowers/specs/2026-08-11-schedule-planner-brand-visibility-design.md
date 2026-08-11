# Schedule Planner — Per-Brand Hide & Platform Restriction

**PMS task:** "Update Brand Scheduling Planner" (`cmsnccbz7000004lgo38rfbae`, In Progress)

**Scope note:** DB-seeded configuration only — no admin UI to toggle these flags
(confirmed with user). Future brand additions/removals are done by editing the
new tables directly (or a follow-up task adds a UI). No change to
`getTabPlatforms`, Score Summary, Brand Tabs, or any existing `brand_schedule`/
`brand_platform_pause` row.

## Requirement (verbatim from PMS)

- Rooster Partners: NovaDreams — hide entirely from Schedule Planner. NovaDreams2 — schedule only for TP.
- Revolution Casino: GOC — schedule only for AG. Midasluck — hide entirely. Revolution 1 — hide entirely.
- Brands marked "Remove Brand Page" must not appear in the Schedule Planner.
- Brands marked "only TP"/"only AG" must only be schedulable for that one platform.
- Must not affect existing brand data or other scheduling configurations.

## Brand-name verification (live data check, confirmed with user)

Queried live `entries.data.Brands` via the Supabase REST API (anon key, read-only)
for both tabs before finalizing seed values — brand identity is exact-string
(case/whitespace-insensitive only, no fuzzy matching), so a wrong seed value
would silently no-op.

- Rooster Partners has `Novadreams` / `Novadreams2` (case differs from the task
  text, which normalizes fine — `brand_key` is `lower(btrim(brand))`).
- Revolution Casino has `God Of Casino`, `Midarion`, `Midasluck`, `Revolution
  Casino`, `Revolution1` — **no** literal "GOC" and **no** "Revolution 1" (with
  space). Confirmed with user: "GOC" = `God Of Casino`, "Revolution 1" =
  `Revolution1` (no space). `Midarion` is a distinct, separate brand — not
  touched by this task.

Final seed brand values (exact live strings):

| Tab | Brand | Action |
|---|---|---|
| Rooster Partners | Novadreams | Hide from Schedule Planner |
| Rooster Partners | Novadreams2 | Restrict to TP only |
| Revolution Casino | Midasluck | Hide from Schedule Planner |
| Revolution Casino | Revolution1 | Hide from Schedule Planner |
| Revolution Casino | God Of Casino | Restrict to AG only |

## Current behavior (for reference)

- Brand list per tab is derived dynamically from distinct `entries.data.Brands`
  values (`SchedulePlanner.tsx`'s tab-load effect) — no static per-tab brand
  config exists.
- `getTabPlatforms(tab)` (`src/lib/tab-configs.ts`) returns one platform set for
  the whole tab, driven by `TAB_COLUMN_CONFIGS`. No brand parameter — every
  brand on a tab starts from the same `activePlatforms` array.
- `SchedulePlanner.tsx`'s `brandPlatforms(brand)` is the single choke point that
  narrows `activePlatforms` down per brand today, subtracting only platforms
  flagged via the existing `removed_platform_brands` table (a cross-cutting flag
  that also affects Score Summary and Brand Tabs — unrelated to this task and
  not to be reused for it, since this task's hide/restrict must be Schedule
  Planner-only). Every renderer/handler in the page (`computeRemovedByPlatform`,
  `computeConfirmedByPlatform`, `ScheduleCell`'s `platforms` prop,
  `unscheduledPlatforms` for `AddPlatformModal`, pause/no-schedule derivations)
  reads through this one function.
- `filteredBrands` drops any brand whose `brandPlatforms(brand)` is empty — this
  is how a brand "disappears" today (only reachable by flagging every one of the
  tab's platforms removed, which has the unwanted side effects above).
- `schedulerService.ts`'s `recalculatePauses`/`ensureWeekGenerated` iterate
  `for (brand of ctx.brands) { for (platform of ctx.activePlatforms) { ... } }`,
  skipping combos found in `ctx.removedPlatformBrandSet` and treating them as
  "pinned" (already accounted for) so the weekly generator never assigns them
  real slots. This pinned-combo trick is the existing mechanism for "this
  combo should never be scheduled" and is reused below rather than duplicated.

## New data model

Two new tables, modeled directly on `removed_platform_brands`'s existing shape
(generated `brand_key`, same 4 RLS policies: anyone can read, approved users can
insert/update/delete — kept complete even though no UI writes to them yet, so a
future UI or manual edit doesn't hit a missing-policy surprise):

```sql
create table public.schedule_hidden_brands (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  brand      text not null,
  brand_key  text generated always as (lower(btrim(brand))) stored,
  created_at timestamptz not null default now(),
  unique (tab, brand_key)
);

create table public.schedule_platform_restrictions (
  id               uuid primary key default gen_random_uuid(),
  tab              text not null,
  brand            text not null,
  brand_key        text generated always as (lower(btrim(brand))) stored,
  allowed_platform text not null check (allowed_platform in ('tp','ag','cg','wo')),
  created_at       timestamptz not null default now(),
  unique (tab, brand_key)
);
```

Row existence is the flag — no boolean column needed. Seed data (the 5 rows
above) is inserted in the same migration.

## Single source of truth for platform resolution

New `src/lib/scheduleBrandConfig.ts`:

```ts
export function getSchedulableBrandPlatforms(
  tab: string,
  brand: string,
  tabPlatforms: Platform[],
  hiddenSet: Set<string>,
  restrictionMap: Map<string, Platform>,
): Platform[] {
  if (hiddenSet.has(hiddenBrandKey(tab, brand))) return [];
  const restriction = restrictionMap.get(platformRestrictionKey(tab, brand));
  if (restriction) return tabPlatforms.filter((p) => p === restriction);
  return tabPlatforms;
}
```

Plus `hiddenBrandKey`/`platformRestrictionKey` (same `${tab}::${normalizeBrandKey(brand)}`
shape as `platformRemovedKey`, reusing the existing `normalizeBrandKey` from
`removedPlatformBrands.ts`) and `buildHiddenBrandSet`/`buildPlatformRestrictionMap`
builders, mirroring `buildRemovedPlatformBrandSet`.

This is the only place "which platforms can this brand use" is decided. Both
consumers below call it — neither reimplements the logic — closing off the
exact class of drift bug this project has hit before (Task 180's independent
date-filter implementations disagreeing).

## Wiring

**`src/lib/queries.ts`** — `fetchScheduleHiddenBrands()` / `fetchScheduleRestrictedBrands()`
(fetch-all, no tab filter, mirroring `fetchRemovedPlatformBrands()`'s existing
pattern — `SchedulePlanner.tsx` already fetches once and filters client-side).

**`src/pages/SchedulePlanner.tsx`** — fetch both new tables alongside the
existing `fetchRemovedPlatformBrands`/`fetchBrandPlatformOverrides` calls in the
tab-load effect; store the built `Set`/`Map` in `tabCtx`. `brandPlatforms(brand)`
changes from:
```ts
activePlatforms.filter((p) => !removedSet.has(platformRemovedKey(tab, brand, p)))
```
to:
```ts
getSchedulableBrandPlatforms(tab, brand, activePlatforms, hiddenSet, restrictionMap)
  .filter((p) => !removedSet.has(platformRemovedKey(tab, brand, p)))
```
A hidden brand now returns `[]` here, which the existing `filteredBrands` "drop
brands with zero platforms" rule already removes from the grid — no separate
hide-check needed in `filteredBrands`.

**`src/lib/scheduler/schedulerService.ts`** — `TabContext` gains two more
optional fields, matching the existing `removedPlatformBrandSet`/`overrideMap`
convention (defaults to "nothing hidden/restricted" so existing callers/tests
don't need to thread empty collections through):
```ts
hiddenBrandSet?: Set<string>;
platformRestrictionMap?: Map<string, Platform>;
```
- `recalculatePauses`'s inner loop gains a check alongside the existing
  `removedSet.has(...)` skip: if `platform` is not in
  `getSchedulableBrandPlatforms(tab, brand, ctx.activePlatforms, hiddenSet, restrictionMap)`,
  `continue` (never evaluate that combo for a new pause; existing pause rows,
  if any, are left untouched — same "harmless while hidden" reasoning already
  documented for the removed-platform case).
- `ensureWeekGenerated`'s existing `removedCombos` loop gains a parallel
  `excludedCombos` loop built the same way (for each brand+platform where
  `getSchedulableBrandPlatforms` excludes that platform, push `{brandKey,
  platform}`), merged into the same `pinnedBrandPlatforms` array passed to
  `generateWeekSchedule`. No changes to `schedulerEngine.ts` — pinning is the
  existing mechanism for "never assign this combo," already proven for
  removed-platform brands.

## Out of scope

- No admin UI to toggle hide/restrict (confirmed — DB-seeded only).
- No change to `removed_platform_brands` semantics, Score Summary, or Brand Tabs.
- No change to `getTabPlatforms` (stays tab-wide; shared by non-Schedule-Planner
  consumers).
- No change to existing `brand_schedule`/`brand_platform_pause` rows — only
  future auto-generation/auto-pause evaluation is affected.
- No retroactive cleanup of past weeks' data for the 5 seeded brands.

## Testing approach

Follows this codebase's existing TDD/per-unit pattern:

- `scheduleBrandConfig.test.ts` (new) — `getSchedulableBrandPlatforms`: hidden
  brand → `[]`; restricted brand → single-element array intersected with tab
  platforms (restriction naming a platform the tab doesn't have → `[]`, not a
  crash); brand with neither flag → unchanged `tabPlatforms` passthrough.
- `schedulerService.test.ts` (extend existing) — a hidden brand's combos never
  get pinned into a fresh pause and never get a generated slot; a restricted
  brand only ever gets slots/pauses for its allowed platform; both interact
  correctly alongside the existing `removedPlatformBrandSet`/`overrideMap`
  (e.g. a restricted brand whose one allowed platform is also independently
  flagged removed via `removed_platform_brands` ends up with zero schedulable
  platforms, same as today's "removed on the only platform" case).
- Existing `SchedulePlanner.tsx`-adjacent tests (if any cover `brandPlatforms`)
  — extend to confirm a hidden/restricted brand no longer appears / only shows
  its allowed platform.

## Migration / seed verification

Since no DB credential exists in this session's implementation environment, the
migration is written to run via `supabase db push` as usual, and the seed rows
are checked afterward via the same anon-key REST read used during this design
(`entries` and the two new tables are both public-readable) — confirm exactly 5
rows total across the two new tables, matching the table above.
