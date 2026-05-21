# Overview Page Redesign

**Date:** 2026-05-21
**Status:** Approved

## Problem

The current Overview page renders forum-mention KPIs (total mentions, last 7 days, top forum, trending keyword) and charts driven by the `mentions` table. That table is unused — all real data lives in the `entries` table. The Overview does not reflect the dashboard's actual purpose: monitoring brand review accounts across 8 operational tabs and 3 platforms (TP, AG, CG).

## Goal

Replace the Overview with an ops-focused summary that answers "everything okay? where do I need to go?" in under 5 seconds.

## Design

### Section 1 — Global KPI Row

Four `KpiCard` components across the top of the page.

| Card | Value | Hint |
|------|-------|------|
| Total Accounts | Sum of `total` across all 8 tabs | "across all brand tabs" |
| Live Reviews | Sum of `live` across all tabs | "active across TP / AG / CG" |
| Removed | Sum of `removed` across all tabs | "across all tabs" |
| Last Sync | Most recent `sync_runs.started_at`, formatted as relative time | `"last run: success"` / `"last run: error"` as plain hint string |

### Section 2 — Tab Summary Grid

An 8-card responsive grid: 4 columns (desktop ≥1024px), 2 columns (tablet ≥640px), 1 column (mobile).

Each card:
- **Tab name** as heading — entire card is a `<Link>` to `/brands/:encodedTab`
- Three inline stat chips: `Total · Live · Removed`
- Thin horizontal progress bar: green fill = live%, red fill = removed%, grey = remainder
- Hover: slight lift (`shadow-md`, `translate-y-[-2px]`, transition)

The bar uses simple inline `style={{ width: '${pct}%' }}` spans inside a relative container — no new chart library.

### Section 3 — Recent Sync Activity

Compact table at the bottom showing the last 5 `sync_runs` rows.

Columns: **Tab** · **Direction** · **Status** · **Rows Upserted** · **Started At**

Status is rendered as an inline pill with Tailwind classes (not `StatusBadge`, which only handles mention statuses). Mapping: `success` → green, `error` → red, `running` → amber, `skipped` → grey.

Direction values mapped to readable labels: `sheet_to_db` → "Sheet → DB", `db_to_sheet` → "DB → Sheet", `initial_import` → "Initial Import".

### What Is Removed

The following content is fully replaced:
- All 4 current KPI cards (mentions-based)
- `TimeSeriesChart` (mentions per day)
- `TopList` for top forums
- `TopList` for trending keywords
- `MentionsTable` for recent mentions

The query call sites in `Overview.tsx` are replaced (`fetchMentionCounts`, `fetchMentionsPerDay`, `fetchTopForums`, `fetchTrendingKeywords`, `fetchRecentMentions` are no longer called from this page). The functions remain in `queries.ts` — `MentionDetail` still uses `fetchMentionById` and `updateMentionStatus`.

## Data Fetching

All data loaded in a single `Promise.all` on mount:

```ts
const [kpisPerTab, recentSyncs] = await Promise.all([
  Promise.all(OPERATIONAL_TABS.map(tab => fetchTabKpis(tab).then(k => ({ tab, ...k })))),
  fetchSyncRuns(5),
]);
```

Aggregate globals derived client-side from `kpisPerTab`:
```ts
const totalAccounts = kpisPerTab.reduce((s, t) => s + t.total, 0);
const totalLive     = kpisPerTab.reduce((s, t) => s + t.live,  0);
const totalRemoved  = kpisPerTab.reduce((s, t) => s + t.removed, 0);
```

No real-time subscription needed on Overview (BrandGroup pages already have it).

## Components

No new components. Uses existing:
- `KpiCard` — global KPIs
- `StatusBadge` — sync run status
- `Link` (React Router) — tab cards

Tab summary cards and the sync table are inlined in `Overview.tsx` — they are simple enough that extracting components would be premature.

## Error Handling

If `Promise.all` rejects, show the existing error banner pattern already used in `Overview.tsx`. Individual tab KPI failures are swallowed per-tab (tab card shows `--` for counts) so a single bad tab doesn't blank the whole page.

## File Changes

| File | Change |
|------|--------|
| `src/pages/Overview.tsx` | Full rewrite of data fetching + render |
| `src/lib/queries.ts` | No changes (all needed queries already exist) |
| `src/types/` | No changes |
| `src/components/` | No new components |
