# Brand Tab Filter Persistence — Design

## Problem

`BrandGroup.tsx` (the `/brands/:tab` page, e.g. "BITP") holds its search text,
brand/agent/proxy/country filters, status/platform/rating filters, date range,
page number, and page size entirely in `useState`. Navigating away to any
other page and back remounts the page fresh, so all of that resets to blank
defaults — the user has to re-apply Brand/Agent/etc. filters every time they
return to a tab. Sort order does *not* have this problem today: it already
persists per-tab via `localStorage` (`sortStorageKey`/`readSortFromStorage`,
[BrandGroup.tsx:620](../../../src/pages/BrandGroup.tsx#L620)).

## Goal

Restore the entire filter/search/page view exactly as the user left it when
they return to a brand tab, for the current browser session only. Each tab
remembers its own filters independently. Sort order (already persisted) and
row checkbox selection are unaffected. No other page is in scope.

## Design

### Storage

A new per-tab `sessionStorage` snapshot, following the same shape as the
existing sort-storage helpers but covering the full filter set:

```ts
function filterStorageKey(tab: string): string;
type StoredFilters = {
  search: string;
  brandFilter: string;
  statusFilter: 'all' | 'live' | 'removed' | 'done' | 'on-pause' | 'pending' | 'not-done';
  platformFilter: 'all' | 'tp' | 'ag' | 'cg' | 'wo';
  ratingFilter: number | 'unrated' | 'any' | null;
  agentFilter: string;
  proxyFilter: string;
  countryFilter: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};
function readFiltersFromStorage(tab: string): Partial<StoredFilters>;
function writeFiltersToStorage(tab: string, filters: StoredFilters): void;
```

Both read and write swallow errors (JSON parse failures, quota/private-mode
exceptions) the same way `readSortFromStorage` does today — a storage failure
degrades to "filters don't persist," never a crash.

`sessionStorage` (not `localStorage`) is deliberate: selections survive
navigating to other pages and back, but reset once the browser tab/window is
closed.

### Restore priority: URL param → remembered value → hard default

Score Summary and Overview already deep-link into brand tabs with explicit
query params (e.g. `/brands/bitp?platform=tp&status=removed`,
[ScoreSummaryPanel.tsx](../../../src/components/ScoreSummaryPanel.tsx),
[Overview.tsx:259](../../../src/pages/Overview.tsx#L259)). Those explicit
links must keep winning over whatever was last remembered for that tab, so
every field is resolved as: **URL query param (if present) → sessionStorage
value (if present) → hard default** (`''` / `'all'` / `null` / `1` / `25`).

### Integration points in `BrandGroup.tsx`

1. **`useState` initializers** (currently hardcoded blanks at
   [BrandGroup.tsx:654-682](../../../src/pages/BrandGroup.tsx#L654-L682)) read
   through the merge logic above instead, the same way `sortCol`/`sortDir`
   already initialize from `readSortFromStorage`.
2. **Tab-change reset block**
   ([BrandGroup.tsx:800-825](../../../src/pages/BrandGroup.tsx#L800-L825)) —
   which runs when the route's `:tab` param changes without a full remount —
   uses the same merge logic instead of hard-resetting every filter to blank.
3. **URL re-sync effect**
   ([BrandGroup.tsx:970-985](../../../src/pages/BrandGroup.tsx#L970-L985)),
   which re-derives platform/status/brand/rating from `searchParams` on every
   change so a second same-tab Score Summary link is picked up, gets a guard
   so it does not immediately re-run (and clobber the just-restored values)
   on the initial mount for a tab. It continues to fire normally for genuine
   same-tab URL changes after that.
4. **New write-back effect** — on any change to search/brandFilter/
   statusFilter/platformFilter/ratingFilter/agentFilter/proxyFilter/
   countryFilter/dateFrom/dateTo/page/pageSize, writes the full snapshot to
   `sessionStorage` under the current tab's key.

### Out of scope

- Row checkbox selection (`selectedIds`) — transient action state, not a
  "view."
- Sort order — already persisted, just via `localStorage` (indefinite)
  instead of `sessionStorage` (session-only). Not being changed.
- Any page other than `/brands/:tab` (e.g. Score Summary has its own
  separate shareable-URL filter mechanism already).

## Testing

- Set Brand/Agent/Status/Platform/Rating filters + search text + page 2 on a
  tab, navigate to Overview, navigate back — all values restored.
- Switch tabs via the sidebar without those filters set on the new tab —
  new tab shows its own remembered state (or defaults, if never set),
  unaffected by the previous tab's values.
- Click a Score Summary deep link into a tab that already has different
  remembered filters — the link's explicit params win.
- While on a tab, click a second Score Summary deep link for the same tab —
  still updates correctly (URL re-sync effect still fires post-mount).
- Close and reopen the browser (or start a new session) — filters reset to
  default (sessionStorage cleared), sort order does not (localStorage).
