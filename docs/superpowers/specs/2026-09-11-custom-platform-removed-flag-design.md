# Custom Platform "Page Removed" Flag — Design

## Context

Custom Platforms (Task 325, 2026-09-07) let any approved user define a new
review platform beyond the built-in TP/AG/CG/WO and enable it on any tab.
Its own design deliberately scoped custom platforms to the Overview and
Brand Tabs KPI slice only, and named three surfaces as explicit non-goals
for a later pass: Schedule Planner, Ask AI, and a `removed_platform_brands`-
style "flag a brand's page as removed, exclude it from KPIs" mechanism.

This spec covers the third of those three: the removed-flag mechanism.
(Schedule Planner and Ask AI parity are separate, later sub-projects — not
in scope here.)

Today, a custom platform's counts can never be excluded from KPIs the way a
built-in platform's can. `computeCustomPlatformCounts` (`src/lib/
customPlatforms.ts`) takes only `(entries, platform, fromISO, toISO)` — no
brand column, no removal-exclusion set — so there is no way to say "this
brand's page on this custom platform was delisted, don't count it."

## Goals

- A brand's page on a specific custom platform can be flagged "removed,"
  independent of that brand's standing on any other platform (built-in or
  custom) — mirroring exactly what `removed_platform_brands` already does
  for TP/AG/CG/WO.
- Full parity with the built-in mechanism: KPI exclusion (Overview + Brand
  Tabs summary cards), a badge next to the brand name, an Edit Entry
  checkbox, an Edit Brand Tab bulk-management section, a CSV/Excel export
  column, and the same "Brand Removed" notification email on a fresh flag.
- Non-goals (separate future sub-projects, not touched here): Schedule
  Planner, Ask AI, `custom_platforms.max_score` (already deferred by Task
  325's own non-goals).

## Data model

New table, structurally mirroring `removed_platform_brands` but keyed by
`platform_id` (uuid) instead of the closed `platform` enum, since a custom
platform has no fixed code to check against:

```sql
create table public.removed_custom_platform_brands (
  id            uuid primary key default gen_random_uuid(),
  tab           text not null,
  brand         text not null,
  brand_key     text generated always as (lower(btrim(brand))) stored,
  platform_id   uuid not null references public.custom_platforms(id) on delete restrict,
  removed_by    text,
  removed_at    timestamptz not null default now(),
  unique (tab, brand_key, platform_id)
);

alter table public.removed_custom_platform_brands enable row level security;

create policy "anyone can read removed_custom_platform_brands"
  on public.removed_custom_platform_brands for select using (true);
create policy "approved users can insert removed_custom_platform_brands"
  on public.removed_custom_platform_brands for insert with check (public.is_approved());
create policy "approved users can update removed_custom_platform_brands"
  on public.removed_custom_platform_brands for update using (public.is_approved());
create policy "approved users can delete removed_custom_platform_brands"
  on public.removed_custom_platform_brands for delete using (public.is_approved());
```

`on delete restrict` mirrors `tab_custom_platforms`'s existing FK behavior —
a custom platform can't be deleted while a brand is flagged removed on it
(must be un-flagged first).

Kept as a **separate table** from `removed_platform_brands` rather than
widening that table's `platform` column to a polymorphic either/or, because
the two are resolved completely differently in the app
(`getTabPlatforms(tab): Platform[]` vs.
`getTabCustomPlatforms(tab): CustomPlatformConfig[]`), and nothing needs to
query "every removed flag regardless of platform kind" in one shot.

**Accepted edge case, matching existing precedent:** disabling a custom
platform for a tab (deleting its `tab_custom_platforms` row) does not clean
up any `removed_custom_platform_brands` rows for that tab — a stale flag
row is simply inert (nothing reads it once the platform is no longer
enabled for that tab) until/unless the platform is re-enabled. This mirrors
how this project already leaves stale rows behind in comparable situations
(e.g. hidden/restricted schedule combos) rather than adding cleanup
triggers.

## Shared save/notify logic — extract, don't duplicate

The part of the built-in mechanism worth getting right exactly once is
`src/lib/platformRemovedActions.ts`'s flag-diffing / date-parsing /
notify-trigger logic, not the storage. Rather than writing a second copy of
that ~140-line module for custom platforms, its core is extracted into a
generic engine both paths call:

- A new generic function (same file) takes a list of entries shaped
  `{ key, shortLabel, wasRemoved, willBeRemoved, dateText?, priorIso?,
  write }` (naming matches the existing `savePlatformRemoved` local
  variables it's extracted from), where `write(removed, removedAtIso?)` is
  supplied by the caller. It owns the one copy of: "did state change vs.
  did just the date change," date parsing, and firing `notify`/`syncStatus`
  on a fresh flag.
- `savePlatformRemoved` (existing, used by built-ins today) becomes a thin
  wrapper building those generic entries from `Platform[]`, with `write`
  bound to `setBrandPlatformRemoved` — **zero behavior change** for
  existing call sites, verified by keeping its existing tests green
  unmodified.
- A new `saveCustomPlatformRemoved` (same file) builds the same generic
  entries from `CustomPlatformConfig[]`, with `write` bound to the new
  `setCustomPlatformBrandRemoved`.
- `deriveRemovedModalInitial` gets the same treatment: a new
  `deriveCustomPlatformRemovedModalInitial` sibling, sharing whatever of
  the seeding logic is common.
- `PlatformRemovedBadge` generalizes from `{ platform: Platform }` to
  `{ shortLabel, label, removedAtLabel? }` — existing call sites pass
  `PLATFORM_LABEL[platform]`/`PLATFORM_SHORT_LABEL[platform]` explicitly
  (one-line change), new custom-platform call sites pass the
  `CustomPlatformConfig`'s `name`/`shortLabel` directly.

New sibling modules, mirroring existing ones exactly:
- `src/lib/removedCustomPlatformBrands.ts` — `customPlatformRemovedKey(tab,
  brand, platformId)`, `buildRemovedCustomPlatformBrandSet`,
  `buildRemovedCustomPlatformBrandDateMap` (mirrors
  `removedPlatformBrands.ts`).
- `queries.ts` gains `fetchRemovedCustomPlatformBrands`,
  `fetchRemovedCustomPlatformBrandsForTab`, `setCustomPlatformBrandRemoved`
  — mirroring the built-in trio exactly (same upsert/delete shape, same
  `onConflict: 'tab,brand_key,platform_id'`).

The notify-email and PMS-status-sync triggers end up genuinely shared code
(same `notify`/`syncStatus` writer functions, same call site in the generic
engine) — a future fix to that logic covers both automatically. Only the
storage/lookup (table, key format, config source) stays separate, which is
the part that actually has to be.

## Wiring into existing surfaces

**KPI exclusion.** `computeCustomPlatformCounts` (`src/lib/
customPlatforms.ts`) gains `brandCol: string`, `tab: string`, and
`removedCustomPlatformBrands: Set<string>` params, skipping a flagged
brand's rows for that platform — the same shape as `classifyEntry`'s
existing `isPlatformFlagged` check for built-ins. Its two real call sites
both thread the new set through, fetching `fetchRemovedCustomPlatformBrands()`
right alongside the existing `fetchRemovedPlatformBrands()` call:
- `computeTabKpisFromEntries` (`queries.ts`) → Overview's per-tab
  custom-platform cards.
- `BrandGroup.tsx`'s own tab-summary computation (~line 1710) → Brand Tabs'
  custom-platform summary cards.

**Badge.** `removedPlatformBadges(brandName)` in `BrandGroup.tsx` (renders
one `PlatformRemovedBadge` per flagged built-in platform next to a brand's
name) extends to also map over `getTabCustomPlatforms(decodedTab)`,
checking the new set/key and rendering the same (now-generalized) badge
component with the custom platform's `name`/`shortLabel`.

**Edit Entry checkbox.** One checkbox per custom platform enabled on the
tab, "`<name>` page removed," alongside the existing built-in checkboxes,
wired through `saveCustomPlatformRemoved` exactly like the existing
checkboxes call `savePlatformRemoved` today.

**Edit Brand Tab → "Removed platform pages" section.**
`TabRemovedPlatformsSection` extends to also list/manage custom-platform
flags for that tab's brands, reusing the same generalized derive/save
engine.

**Export.** The synthetic `"<Platform> Page Removed Status"` CSV/Excel
columns (`BrandGroup.tsx`'s export) gain one more per enabled custom
platform, `"<name> Page Removed Status"`, built the same way the 4 built-in
ones already are.

**Notification email.** A fresh custom-platform flag fires the same
`notifyBrandRemoved` call the built-in path uses, with `platformShortLabel`
set to the custom platform's own `shortLabel` (the payload field is
already a plain `string`, not `Platform`-typed, so no change needed there).

## Testing

- `removedCustomPlatformBrands.test.ts` — key builder + set/date-map
  builders, mirroring `removedPlatformBrands`'s existing test coverage (if
  any) or `customPlatforms.test.ts`'s style.
- `customPlatforms.test.ts` — extend `computeCustomPlatformCounts`'s
  existing tests with removal-exclusion cases.
- `platformRemovedActions.test.ts` — extend to cover the new generic
  engine via both the built-in wrapper (regression: existing tests must
  still pass unmodified) and the new custom-platform wrapper.
- `queries.test.ts` — new tests for the three new fetch/set functions,
  mirroring the built-in trio's existing tests.
- No new Deno/Edge Function tests — this sub-project touches only frontend
  + Postgres; no Edge Function changes (Ask AI/Schedule Planner parity are
  out of scope).

## Deployment

- `supabase db push` (new migration).
- `git push origin main` (frontend).
- No Edge Function deploy needed for this sub-project.
