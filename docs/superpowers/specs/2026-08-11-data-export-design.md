# Data Export — Design Spec

**Date:** 2026-08-11
**PMS Task:** "Data Export" (`cmsneceo7000204jr6sxzm3k2`, Feature/UI, Medium priority)

## Source requirements (PMS task description, verbatim)

> Add an Export function to each applicable dashboard tab, allowing users to export data based
> on the filters they have selected.
>
> Requirements:
> - Add an Export button to the specific dashboard tab.
> - If one or more filters are selected, export only the data matching the selected filter values.
> - If multiple values are selected within a filter, export data matching all selected values.
> - If no filters are selected, export all available data from that specific tab.
> - The export should only include data belonging to the current tab where the Export button is clicked.
> - The export should respect all active filters and selections.
> - Include all relevant columns available on the selected tab.
> - Export the data in a format suitable for analysis, such as CSV or Excel (.xlsx).
> - The export should not modify or affect the existing dashboard data.

## Scope (confirmed with user)

Export ships on exactly 3 pages — the ones with real filterable tabular/row data:

- **Brand Tabs** (`src/pages/BrandGroup.tsx`) — one Export button per tab, e.g. Rooster Partners, Hanan, etc.
- **Score Summary** (`src/components/ScoreSummaryPanel.tsx`)
- **Schedule Planner** (`src/pages/SchedulePlanner.tsx`)

Explicitly excluded (confirmed): Overview, Activity Log, Admin Users, Sync Status, Ask AI. Overview
has no raw row table anymore (KPI cards/aggregates only); Activity Log has no filters; Admin Users,
Sync Status, and Ask AI aren't row/column data users filter.

## Format

Both CSV and true `.xlsx` are supported, user's choice per click. New dependency: `xlsx` (SheetJS
community build) for the `.xlsx` path. CSV needs no dependency.

## UX

Each of the 3 pages gets a toolbar button — "Export" + a `Download` icon (`lucide-react`), styled
to match each page's existing filter-bar buttons. Clicking it opens a small 2-item popover:

- **Export as CSV**
- **Export as Excel (.xlsx)**

Either option immediately builds the file client-side from data already held in component state and
triggers a browser download. No network round-trip, no write to Supabase — read-only by
construction, satisfying "the export should not modify or affect the existing dashboard data."

## Shared utility: `src/lib/exportFile.ts`

Pure, unit-tested functions with no React/DOM dependency beyond the final download call:

```ts
buildCsv(headers: string[], rows: string[][]): string
// RFC-4180-style escaping: any field containing a comma, double-quote, or
// newline is wrapped in double quotes with internal quotes doubled.

buildWorkbook(sheetName: string, headers: string[], rows: string[][]): ArrayBuffer
// Thin wrapper over xlsx's utils.aoa_to_sheet + utils.book_new/book_append_sheet
// + write(..., { type: 'array' }).

downloadFile(filename: string, content: string | ArrayBuffer, mimeType: string): void
// Wraps content in a Blob, creates a temporary <a download> element, clicks it,
// revokes the object URL. Shared by both formats.
```

## Shared component: `src/components/ExportMenuButton.tsx`

```ts
interface Props {
  headers: string[];
  rows: string[][];      // already filtered/formatted by the caller
  filenameBase: string;  // e.g. "rooster-partners", "score-summary", "schedule-planner-hanan"
}
```

Renders the toolbar button + popover (same outside-click-to-close / portal pattern already used by
`SelectDropdown.tsx`, but as an action menu rather than a value picker). On click of either option,
calls `buildCsv`/`buildWorkbook` + `downloadFile` with a timestamped filename
(`${filenameBase}-YYYY-MM-DD.csv` / `.xlsx`). The component does no filtering or data
transformation itself — each page is responsible for handing it the exact headers/rows that match
what's currently on screen.

## Per-page data mapping

### Brand Tabs (`BrandGroup.tsx`)

- **Rows:** the full filtered+sorted set (`sorted`, computed pre-pagination) — not `pageRows`, so
  export is not limited to the current page. This already incorporates every active filter (search,
  brand, agent, proxy, country, status, platform, rating, date) via the existing filter pipeline.
- **Columns:** `visibleHeaders` (already narrows to the selected platform's own columns when a
  platform filter is active, and already handles the session-gated guest-column hiding).
- **Cell values:** a new pure, exported, unit-tested function `buildBrandRowsForExport(entries,
  visibleHeaders, tab)` mirrors what `CellValue` shows on screen:
  - `Country` → `getEntryCountry(entry.data, tab)` (derived, not the raw stored value — matches
    existing sort/render logic elsewhere in this file).
  - Link columns (`isLinkCol(header)`) → the real URL value, not the on-screen "View" label (more
    useful in a spreadsheet than a fixed label).
  - Everything else → `entry.data[header] ?? ''`, passed through `formatCellValue` for the same
    date normalization (`YYYY-MM-DD` → `DD/MM/YYYY`) already applied on screen.
- **Filename:** `${tabSlug}-YYYY-MM-DD`.

### Score Summary (`ScoreSummaryPanel.tsx`)

- **Rows:** `filteredBrands` (already respects the platform/date-range/tab-group filters this panel
  already computes).
- **Columns:** Tab, Brand, then the star columns (dynamic — matches `maxScore`/`showStars` for the
  currently selected platform(s); omitted entirely when 2+ platforms are selected, same as the
  on-screen table drops them), Unrated, Stars-Total, Published, Removed, Total, SR%.
- **Cell values:** pulled from the same `BrandSummary`/`successRates`/`tabSuccessRates` structures
  already in the component, formatted with the same `successRatePct` used on screen (so the
  exported percentage never disagrees with what's displayed).
- **Filename:** `score-summary-YYYY-MM-DD`.

### Schedule Planner (`SchedulePlanner.tsx`)

- **Scope:** the currently displayed week only, for the currently selected tab, respecting the
  brand search box — confirmed with user as "what you see is what you get," consistent with the
  other two pages. (Explicitly does *not* export the brand's full multi-week schedule history.)
- **Rows:** one row per (Brand, Platform) — `filteredBrands` × `brandPlatforms(brand)`.
- **Columns:** Brand, Platform, Mon, Tue, Wed, Thu, Fri (each: `Active` / `Paused` / blank, from
  `scheduleFor`/the existing `rowsByPlatform` lookup), Paused This Week (Y/N, from
  `pausesByPlatform`), Page Removed (Y/N, from `flaggedRemovedPlatforms`).
- **Filename:** `schedule-planner-${tabSlug}-${weekStartISO}`.
- **Note on "filters" here:** unlike the other two pages, this page's notion of "filter" is search
  + tab + displayed week rather than a multi-value filter set — called out explicitly since it's a
  different shape than Brand Tabs/Score Summary but still satisfies "respect all active filters and
  selections."

## Testing

- `exportFile.test.ts` — CSV escaping edge cases (embedded commas/quotes/newlines, empty rows,
  empty header/row lists); `buildWorkbook` sanity-checked by parsing the produced buffer back via
  `xlsx.read` and confirming headers/rows round-trip.
- `buildBrandRowsForExport` — unit tests for the two non-trivial column-value rules (Country
  derivation, link-column raw-URL override); everything else is a direct passthrough, not worth
  separately testing per column.
- Score Summary and Schedule Planner row-building: one focused test each (no derived columns, so a
  full suite isn't warranted).
- Per page: `npm run build` + a manual click-through (open the downloaded file, spot-check headers/
  row count/values against the visible table for at least one active-filter case and one
  no-filter case).

## Tiering (per this project's CLAUDE.md)

Tier 2 (light path): three independently-bounded UI additions plus one shared utility, none of
which touch `queries.ts`, `scoreSummary.ts` computation, or date/status/platform filtering
semantics — each page's export reads already-computed, already-filtered state. Gets a self-review
pass per page rather than the full spec→plan→subagent→whole-branch-review pipeline. A short plan
is still written (next step) because it's 3 coordinated surfaces + a shared utility, which is also
what makes this a good fit for parallel subagent dispatch, as requested.

## Out of scope

- No server-side export / no Edge Function — everything is a client-side Blob download.
- No column-customization UI — export always includes "all relevant columns" as currently visible.
- No export on Overview, Activity Log, Admin Users, Sync Status, or Ask AI (excluded by explicit
  scope decision above).
