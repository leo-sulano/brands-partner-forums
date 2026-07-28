# Platform Breakdown Modal: Carry Status Filter to Brand Page

## Problem

On the Overview page, clicking a platform's Published or Removed legend/slice opens
`PlatformBreakdownModal` (`src/pages/Overview.tsx`), listing brand tabs with their
counts for that platform + status (e.g. "TRUSTPILOT — PUBLISHED" showing "TP Brand
Injection: 240", etc).

Clicking a brand row navigates to `/brands/:tab?platform=<platformKey>`. This carries
the platform filter but drops the status (Published/Removed) the user drilled in from.
The destination `BrandGroup` page loads with all statuses mixed together, so the user
has to manually re-apply the Published/Removed toggle to see what they came to look
at.

## Fix

Carry the status through the same query-param passthrough pattern already used for
`platform`, `brand`, and `rating`.

### 1. `src/pages/Overview.tsx` — `PlatformBreakdownModal`

The brand-row `<Link>` (around line 258) adds `status=${modal.kind}` to its `to=` URL:

```tsx
to={`/brands/${tabToSlug(r.tab)}?platform=${modal.platformKey}&status=${modal.kind}`}
```

`modal.kind` is already typed `'live' | 'removed'` — the exact string values
`BrandGroup`'s `statusFilter` state uses, so no translation/mapping is needed.

### 2. `src/pages/BrandGroup.tsx` — read `status` from the URL

`statusFilter` (line 616) is local-only state today. `platformFilter`, `brandFilter`,
and `ratingFilter` already follow a read-from-URL pattern; `statusFilter` gets the
same treatment:

- **Initial state** (near line 619, alongside `platformFilter`'s init): read
  `searchParams.get('status')`, and if it's one of the valid `statusFilter` union
  values (`'live' | 'removed' | 'done' | 'on-pause' | 'pending' | 'not-done'`), use it
  as the initial value; otherwise default to `'all'` as today.
- **Re-sync effect** (the existing `useEffect` at line 918 that re-syncs
  `platform`/`brand`/`rating` whenever `searchParams` changes on an already-mounted
  tab): add the same `status` read/set here, so navigating from one brand-row link to
  another (e.g., Published → Removed) while already on a `BrandGroup` page updates the
  filter instead of keeping the stale one — matching the existing comment about
  same-tab navigations.

## Out of scope

- No changes to `TotalBreakdownModal.tsx` (global Live/Removed/Total KPI drill-down,
  no brand list) or the in-page Published/Removed toggle buttons (`BrandGroup.tsx`
  lines ~1615/1623) — those already set the same `'live'`/`'removed'` values locally;
  this change only adds the URL as a second way to set them.
- No nested drill-down modal — brand rows continue to navigate to the existing
  `/brands/:tab` page, just with one more filter pre-applied.
- No changes to count computation in the modal itself (`rows` derivation at
  `Overview.tsx:208-213`) — that logic is unaffected.

## Testing

- Click Trustpilot Published slice/legend → click a brand row → land on
  `/brands/<tab>?platform=tp&status=live` with the Published filter already active and
  only published TP entries shown.
- Same for Removed.
- Manually navigating to a `/brands/:tab` URL with no `status` param still defaults to
  `'all'` (no regression for existing links/bookmarks that omit it).
- From an already-open `BrandGroup` page, clicking a different Overview modal link for
  the same tab (e.g. Published → Removed) updates the filter live via the re-sync
  effect, without a full remount.
