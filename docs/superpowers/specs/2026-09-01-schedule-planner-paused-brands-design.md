# Schedule Planner — Paused / Noted Brands Section

## Problem

Schedule Planner's active grid has no way to represent a brand that's
deliberately not being posted to right now (client on hold, brand under
review, seasonal pause, etc.) other than leaving it in the grid looking
identical to any other active brand, or hiding it entirely via
`schedule_hidden_brands` (which has no UI, no reason, and makes the brand
invisible everywhere on the page — you lose the ability to see what/where/
when it last posted).

## Goal

A new, whole-brand-level pause: a brand can be marked paused with a reason
and an optional since/until date range (blank `until` = indefinite/
permanent). A paused brand:
- disappears from the active grid (not included in future
  planning/generation/PMS sync), and
- reappears in a new "Paused / Noted Brands" section below the active grid,
  showing its reason, since/until, and its last known post status+date per
  platform (from real entry data already loaded for the tab).

This is purely a Schedule Planner display/scheduling concern. It must never
affect Score Summary, Overview, or Brand Tabs — those pages never read this
table.

## Data model

New table `schedule_brand_pauses`, same shape/RLS pattern as every other
Schedule-Planner-scoped flag table (`schedule_hidden_brands`,
`schedule_platform_restrictions`):

```sql
create table public.schedule_brand_pauses (
  id            uuid primary key default gen_random_uuid(),
  tab           text not null,
  brand         text not null,
  brand_key     text generated always as (lower(btrim(brand))) stored,
  reason        text not null,
  paused_since  date not null,
  paused_until  date,              -- null = indefinite/permanent
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (tab, brand_key)
);

alter table public.schedule_brand_pauses enable row level security;

create policy "anyone can read schedule_brand_pauses"
  on public.schedule_brand_pauses for select using (true);
create policy "approved users can insert schedule_brand_pauses"
  on public.schedule_brand_pauses for insert with check (public.is_approved());
create policy "approved users can update schedule_brand_pauses"
  on public.schedule_brand_pauses for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete schedule_brand_pauses"
  on public.schedule_brand_pauses for delete using (public.is_approved());
```

One row per (tab, brand) — editing a pause upserts the same row rather than
creating a second one.

`paused_until` passing does **not** auto-clear the row (confirmed with user:
manual unpause only — the date is informational).

## Exclusion wiring

`scheduleBrandConfig.ts`'s `getSchedulableBrandPlatforms`/
`resolveBrandPlatforms` is already the single choke point that excludes
hidden/restricted/removed-platform brands from the active grid, weekly
auto-generation/auto-pause, and all 3 PMS sync directions (push, pull,
status). Rather than widening that function's signature across every call
site, a paused brand is treated as another "hidden" row at the point where
rows are fetched: everywhere `fetchScheduleHiddenBrands` +
`buildHiddenBrandSet` are called together, also fetch
`fetchScheduleBrandPauses` and pass both arrays in:
`buildHiddenBrandSet([...hiddenRows, ...pausedRows])`.

Call sites to update (all already fetch hidden-brand rows today):
- `src/components/TabScheduleSection.tsx` (main grid tabCtx load)
- `src/pages/SchedulePlanner.tsx` (landing-grid preview)
- `src/lib/scheduler/pmsSync.ts` (×2: status-resolve, push/pull)
- `supabase/functions/generate-weekly-schedule/index.ts` (weekly cron)

Net effect: a paused brand vanishes from the active grid, is skipped by
generation/auto-pause, is skipped by PMS sync, and is already excluded from
the landing-grid preview's counts — all via the existing mechanism, zero new
exclusion logic to keep in sync. Score Summary/Overview/Brand Tabs never
import this table, so global aggregation is untouched by construction.

Existing `brand_schedule`/`schedule_pms_links` rows for a newly-paused brand
are left as-is (not deleted) — same accepted behavior `schedule_hidden_brands`
already has; they simply stop being touched going forward.

`brand_platform_pause` (auto-pause) and `brand_platform_override` (manual
per-platform override) are untouched — this is a new, independent,
whole-brand mechanism layered on top.

## Query functions (`src/lib/queries.ts`)

```ts
export interface ScheduleBrandPause {
  id: string;
  tab: string;
  brand: string;
  brand_key: string;
  reason: string;
  paused_since: string; // ISO date
  paused_until: string | null;
  created_by: string | null;
  created_at: string;
}

fetchScheduleBrandPauses(tab, client?): Promise<ScheduleBrandPause[]>
pauseScheduleBrand(tab, brand, { reason, pausedSince, pausedUntil }): Promise<void>
  // upsert onConflict: 'tab,brand_key', created_by = currentUserEmail()
unpauseScheduleBrand(tab, brandKey): Promise<void>
  // delete where tab, brand_key
```

Mirrors the existing `setBrandPlatformOverride`/`clearBrandPlatformOverride`
pattern exactly.

## Last-post-per-platform helper (`src/lib/scheduler/scheduleUtils.ts`)

```ts
export function buildLastPostIndex(
  entries: Entry[],
): Map<string, Partial<Record<Platform, { status: string; dateISO: string }>>>
```

Mirrors `buildAgentIndex`'s "most-recently-updated wins" pattern but keyed
per `(brandKey, platform)` using `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS`
+ `parsePostDate` (the same building blocks `buildDateStatusIndex` already
uses) — for each platform, keeps the entry with the latest parsed post date.
Runs off `tabCtx.entries`, already loaded for the tab; no new query.

## UI

- **Pause action**: small icon/button next to the brand name in the main
  grid's sticky Brand column (alongside the existing removed-platform
  badge), opening `PauseBrandModal.tsx` (same shape as the existing
  `AddPlatformModal`/`PauseDaysModal`): Reason (required text), Paused
  since (date, defaults to today), Paused until (optional date, blank =
  "Permanent"). Reused for editing an existing pause (pre-filled).
- **New section**: `PausedBrandsSection.tsx`, rendered below the main table
  inside each tab's own `TabScheduleSection` card, only when that tab has
  ≥1 paused brand. Table listing, per paused brand: name, reason,
  since → until (or "Permanent"), one cell per the tab's active platforms
  showing last known status + date (from `buildLastPostIndex`), and
  Edit/Unpause actions. Filtered by the same `search`/`agentFilter` toolbar
  props the main grid already uses, for consistency.
- Section heading: **"Paused / Noted Brands"**.
- Gated on `isApproved` for the Pause/Edit/Unpause actions, same as every
  other write action on this page; visible read-only to anyone otherwise.

## Testing

- `scheduleUtils.test.ts`: `buildLastPostIndex` (multiple entries per
  brand+platform, picks latest by date; blank/unparseable dates ignored).
- `scheduleBrandConfig.test.ts` or call-site tests: a brand present in
  `schedule_brand_pauses` resolves to zero schedulable platforms, same as
  one in `schedule_hidden_brands`.
- `queries.test.ts`: `fetchScheduleBrandPauses`/`pauseScheduleBrand`/
  `unpauseScheduleBrand` round-trip.
- Component-level: a paused brand is absent from `filteredBrands` (main
  grid) and present in the new section's list.
