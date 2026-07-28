# Tab Display Rename (FTP / BITP) + Per-Brand Success Rate

## Background

Two small, unrelated changes requested together:

1. Rename how the "TP Affiliate" and "TP Brand Injection" tabs are *displayed* to
   "FTP" and "BITP" respectively.
2. Add a per-brand "Success Rate" percentage to the Score Summary page.

## 1. Display-only tab rename

**Scope decision:** display-only. The canonical tab identifier — the `tab` column
value stored in Supabase, the URL slug (`/brands/tp-affiliate`,
`/brands/tp-brand-injection`), `OPERATIONAL_TABS` entries in `src/lib/tabs.ts`,
`tab-configs.ts` keys, the EC2 Python status-checker (`scripts/check_review_status.py`
and friends, which query Supabase by exact tab string), and Apps Script are all
**unchanged**. Only what a user reads on screen changes.

**Implementation:** add a display-name lookup to `src/lib/tabs.ts`:

```ts
const TAB_DISPLAY_NAMES: Partial<Record<OperationalTab, string>> = {
  'TP Affiliate': 'FTP',
  'TP Brand Injection': 'BITP',
};

export function tabDisplayName(tab: string): string {
  return TAB_DISPLAY_NAMES[tab as OperationalTab] ?? tab;
}
```

Apply `tabDisplayName()` at every site currently rendering the raw tab string:

- `src/components/Sidebar.tsx` — nav item label (line ~135) and collapsed-state
  tooltip `title` (line ~131).
- `src/components/Topbar.tsx` — page header `title` on `/brands/:tab` routes
  (line ~99).
- `src/pages/Overview.tsx` — brand summary card title (line ~433),
  `TotalBreakdownModal` row label (line ~175), `PlatformBreakdownModal` row label
  (line ~271).
- `src/components/ScoreSummaryPanel.tsx` — group section header (line ~303),
  collapse/expand `aria-label` (line ~312), per-row tab cell (line ~400),
  `TabFilterDropdown` option list + selected-value chip (the dropdown's `value`
  stays the raw canonical tab string for filtering; only the rendered text
  changes).
- `src/components/BrandTabsModal.tsx` — tab list item label (line ~56).
- `src/components/AddReviewAccountModal.tsx` and
  `src/components/EditEntryModal.tsx` — `TAB_OPTS` dropdown `label` field (value
  stays the canonical tab string).

Everywhere a tab name is used as a *key* (route param, DB filter, config lookup,
`localStorage` key, sort-storage key) is untouched — only rendered `label`/`title`/
text nodes change.

## 2. Per-brand Success Rate in Score Summary

A new "Success Rate" figure per brand, shown alongside the existing star-rating
table in `ScoreSummaryPanel`/`SummaryTable`.

**Definition:** `live / (live + removed) × 100` for the currently-selected platform,
computed per brand. This mirrors the existing convention in
`fetchTabKpis` (`src/lib/queries.ts`), where a tab's KPI `total` is already defined
as `live + removed` — pending/done/on-pause/not-done rows are excluded from the
denominator entirely (they're not yet a decided outcome, so they can't yet count as
"success" or "failure").

**Status classification:** reuse the same status-column resolution the star table
already has (`PLATFORM_STATUS_KEYS` in `src/lib/scoreSummary.ts`), but classify
every row's status (not just `published`) using predicates mirroring
`isLiveStatus`/`isRemovedStatus` in `src/lib/queries.ts`:

```ts
function isLiveStatus(s: string) {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}
function isRemovedStatus(s: string) {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}
```

(Duplicated locally in `scoreSummary.ts` rather than imported, matching the existing
`BRAND_KEYS` comment convention of "kept aligned with X, verify before assuming
still in sync" — `queries.ts` is Supabase-coupled and not meant to be imported into
this pure data-transform module.)

**New function**, in `src/lib/scoreSummary.ts`:

```ts
export interface SuccessRate {
  live: number;
  removed: number;
  rate: number | null; // null when live + removed === 0
}

export function computeSuccessRates(
  entries: Entry[],
  platform: Platform,
): Map<string, SuccessRate> // keyed by `${tab} ${brand}`, same key shape as computeScoreSummary's bucket
```

This iterates **all** entries for the brand/tab/platform (not just `published` ones,
unlike `computeScoreSummary`) and does **not** apply the date-range filter — the
post-date column (`Trust Pilot date`, etc.) is typically only populated once a
review is published, so a Removed/Refused/Pending row often has no date. Honoring
the panel's date-range filter would silently exclude those rows from the
denominator and skew the rate upward. Success Rate always reflects the brand's full
history on the selected platform, regardless of the date-range picker. It does
respect the Platform selector and the Tab filter (only look at rows for the
selected tab, if one is chosen).

**Wiring:** `ScoreSummaryPanel` computes `computeSuccessRates(entries, platform)`
once (`useMemo`, alongside the existing `computeScoreSummary` call) and looks up
each `BrandSummary` row's rate by the same `${tab} ${brand}` key when rendering
`SummaryTable`. Per-group Total row and the grand total sum `live`/`removed` across
their rows first, then compute one weighted rate — not an average of percentages.

**Display:** a new right-aligned column after "Total", showing e.g. `82% (14/17)`
— percentage plus the raw `live/(live+removed)` counts — tinted with the same
green/amber/red convention used elsewhere on the page (≥80% emerald, 50–79% amber,
<50% rose; dash/muted when `rate` is `null`, i.e. no decided outcome yet).

## Out of scope

- No changes to the DB schema, migrations, URL routing, or any external script.
- No change to how the existing star-rating table counts (still Published-only,
  still respects the date-range filter).
- No new filter UI — Success Rate always reflects the platform + tab filters
  already on the page, with the one carve-out (ignores date range) explained above.
