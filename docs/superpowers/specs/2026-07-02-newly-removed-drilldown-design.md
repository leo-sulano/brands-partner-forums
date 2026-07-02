# Check Status — Per-Brand "Newly Removed" Drilldown

**Date:** 2026-07-02
**Status:** Approved

## Problem

On the Check Status page's run-history table ([SyncStatus.tsx](../../../src/pages/SyncStatus.tsx)), expanding a run shows per-brand pills like "Fortuneplay 77" — but that `77` is the **total** removed count for that brand at that point in time, not what changed in this run. Only the tab-level "+N new" badge reflects a delta between runs, and even that is naive arithmetic (`currentTotal - previousTotal`), which hides churn: if one review is reinstated while another is newly removed in the same run, the delta reads `0` even though two things happened. There is no way to see *which specific reviews* were newly removed, or to click through to them.

## Goal

Give each brand pill its own accurate "+N new" badge for that run, clickable to expand an inline list naming exactly which accounts/reviews newly flipped to removed — with a link to each. Because a shared team dashboard needs this history to be the same for every approved user regardless of whose browser ran the check, this also means moving full-check run history off `localStorage` and into Supabase.

## Design

### Data model (new tables)

Added via a new file in `supabase/migrations/`:

```sql
create table public.full_check_runs (
  id      uuid primary key default gen_random_uuid(),
  run_at  timestamptz not null default now(),
  scope   jsonb not null,  -- { tabsRun, tabsTotal, brandsRun, brandsTotal }
  summary jsonb not null   -- TabStatusRow[] — same shape rendered today
);
create index full_check_runs_run_at_idx on public.full_check_runs (run_at desc);

create table public.full_check_removed_entries (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.full_check_runs(id) on delete cascade,
  entry_id     uuid references public.entries(id) on delete set null,
  tab          text not null,
  brand        text,
  account_name text,
  platform     text not null check (platform in ('TP','AG','CG')),
  link         text,
  created_at   timestamptz not null default now()
);
create index full_check_removed_entries_run_idx on public.full_check_removed_entries (run_id, tab, brand);

alter table public.full_check_runs enable row level security;
alter table public.full_check_removed_entries enable row level security;

create policy "approved users can read full_check_runs"
  on public.full_check_runs for select using (public.is_approved());
create policy "approved users can insert full_check_runs"
  on public.full_check_runs for insert with check (public.is_approved());

create policy "approved users can read full_check_removed_entries"
  on public.full_check_removed_entries for select using (public.is_approved());
create policy "approved users can insert full_check_removed_entries"
  on public.full_check_removed_entries for insert with check (public.is_approved());
```

`full_check_runs` replaces the `fullCheckHistory` localStorage list (`SyncStatus.tsx:49-64`) — same `summary: TabStatusRow[]` shape, so today's pub/rem/pending counts and total-removed brand pills keep rendering exactly as they do now.

`full_check_removed_entries` is new: **one row per (entry, platform) currently in a removed-ish status**, written fresh on every run. A 3-platform entry (TP+AG+CG, e.g. Rooster Partners) that's removed on TP but still live on AG produces only a TP row. This is what makes the "account name + which platform + link" drilldown possible.

Old localStorage run history is not migrated — it has no entry-level detail to backfill anyway. History effectively restarts from the first run after this ships; `SyncStatus.tsx` stops reading `fullCheckHistory` entirely.

### Write path

In `queries.ts`, a new `recordFullCheckRun(scope)` function — `scope` is the same `{ tabsRun, tabsTotal, brandsRun, brandsTotal }` shape already computed in `handleFullCheck` today — called at the end of `handleFullCheck` (`SyncStatus.tsx:102-144`) in place of today's localStorage snapshot block:

```ts
export async function recordFullCheckRun(scope: RunScope): Promise<TabStatusRow[]> {
  const summary = await fetchAllTabsStatusSummary(ALL_TABS);
  const removedDetails = await fetchRemovedEntryDetails(ALL_TABS);

  const { data: run, error: runErr } = await supabase
    .from('full_check_runs')
    .insert({ scope, summary })
    .select('id')
    .single();
  if (runErr) throw runErr;

  if (removedDetails.length > 0) {
    const { error: detailErr } = await supabase
      .from('full_check_removed_entries')
      .insert(removedDetails.map((d) => ({ ...d, run_id: run.id })));
    if (detailErr) throw detailErr;
  }
  return summary;
}
```

`fetchRemovedEntryDetails(tabs)` is a new function that reuses the same raw-entries + header-detection code path as `fetchAllTabsStatusSummary` (`queries.ts:701-746`), but instead of tallying counts, for every entry classified as removed (same `isLiveStatus`/`isRemovedStatus` rules, `queries.ts:318-324`) emits one `{ entry_id, tab, brand, account_name, platform, link }` row per platform (TP/AG/CG present on that tab) whose own status matches `isRemovedStatus`.

Like `summary` today, this always covers **all tabs**, not just the ones actually re-checked in a custom-scoped run — consistent with how the existing aggregate counts already behave for partial runs (the "Custom — 1/10 tabs" badge communicates scope separately; the underlying counts are always a full re-read of DB state).

### Read path & diffing

- `SyncStatus.tsx` loads the last 30 rows from `full_check_runs` (`id, run_at, scope, summary`), ordered by `run_at desc`, replacing `loadHistory()`. All existing tab-level rendering (pub/rem/pending, total-removed brand pills) keeps reading from `summary` — unchanged.
- The diff only runs when a run row is expanded (`toggleRun`), not for all 30 runs up front: fetch `full_check_removed_entries` for just `run_id = current.id` and `run_id = previous.id` (two scoped queries, not the whole table).
- Group both result sets by `tab` → `brand`, keyed by `entry_id + platform` (falling back to `account_name + platform` when `entry_id` is null, e.g. an entry later deleted). "Newly removed" for a brand = keys present in the current run's group but absent from the previous run's group for that same tab/brand. This replaces today's `totRem - prevRem` arithmetic, which nets churn to zero.
- If there is no previous run (first run ever, or first run after this feature ships), no diff is computed and no "+N new" badges render anywhere — same as today's "(baseline)" treatment (`SyncStatus.tsx:270-274`).
- Tabs with no recognizable brand column (e.g. Trybet, HazEmirates UAE) write `brand: null` rows to `full_check_removed_entries`. This changes nothing from today: those tabs never render per-brand pills (`rb.length > 0` gate, `SyncStatus.tsx:317`), so there's no per-brand badge to attach to — only the tab-level "+N new" badge applies, computed the same way (grouping by `tab` alone).

### UI

- Brand pill gains its diffed "+N new" badge (replacing the current always-shown total-removed-based logic where applicable) — styled the same as today's tab-level badge (`bg-rose-600` pill, `SyncStatus.tsx:314-316`).
- A brand with removed entries but no new ones this run: shows its existing total-removed pill, no "+N new" badge, not expandable.
- Expanding a run row shows a small inline loading state under it while the two-run fetch resolves; a fetch failure shows an inline "Couldn't load removal details" message rather than breaking the table.
- Clicking a brand's "+N new" badge toggles that brand's own inline list open/closed (local component state, e.g. `expandedBrand: Set<string>` keyed by `` `${tab}::${brand}` ``), independent of other brands in the same run. Each row renders:

  ```
  account_name — {TP|AG|CG} removed → (link opens in new tab)
  ```

### Testing

- Unit test for the diff/grouping function: net-zero churn (one reinstated + one newly removed in the same run must show `+1 new`, not `0`), `entry_id`-null fallback to `account_name + platform`, multi-platform entries where only one platform flips.
- Manual verification: run a full check twice against seeded data with a known status flip, confirm the badge count and drilldown list match the expected accounts/platforms.

## Out of scope

- Retention/cleanup policy for `full_check_removed_entries` growth over time — not addressed now; revisit if row counts become a concern.
- Backfilling or migrating existing `localStorage` run history into the new tables.
- Changing how "removed" is classified at the entry level (still: none of the entry's platform statuses are live, and at least one matches `isRemovedStatus`) — this feature only adds platform-level detail for entries already classified removed under today's rules.
- AG/CG/WO-specific Selenium checkers or the scoped full-check picker (`FullCheckScopePicker.tsx`) — unaffected by this change.
