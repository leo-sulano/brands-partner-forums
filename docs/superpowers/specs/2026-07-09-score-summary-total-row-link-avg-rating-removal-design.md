# Score Summary: clickable Total row, remove Avg/Rating columns

## Problem

`ScoreSummaryPanel.tsx` renders two tables per platform: a per-tab-group
`SummaryTable` (brand rows + a `tfoot` "Total" row) and, when more than one
group is visible at once, a cross-group `GrandTotal` ("All brands") bar. Both
already show an `Avg` and a `Rating` (Excellent/Great/.../Bad pill) column,
computed from `summarizeCounts()` in `scoreSummary.ts`.

Following the recent clickable-navigation work (`2026-07-08-score-summary-clickable-navigation-design.md`),
individual brand names and non-zero star-count cells now link into
`BrandGroup.tsx`. The `SummaryTable`'s "Total" label, however, is still plain
text — there's no way to jump from a group's aggregate row into that group's
brand(s). Separately, the `Avg`/`Rating` columns are no longer wanted in
either table, for any platform.

## Goal

1. The per-group "Total" row becomes clickable:
   - Group has exactly 1 brand → links to that brand's page, identical target
     to clicking the brand name (`/brands/<tab>?platform=<platform>&brand=<brand>`).
   - Group has multiple brands → links to the group's page with no brand
     filter (`/brands/<tab>?platform=<platform>`), landing on every brand in
     that group.
2. The cross-group `GrandTotal` ("All brands") row stays plain text — it
   spans unrelated groups/tabs, so there is no single destination for it.
3. The `Avg` and `Rating` columns are removed entirely from both tables,
   across all four platforms (TP/AG/CG/WO) — same component, so removing
   the columns there covers every platform uniformly.

## Design

All changes are in `src/components/ScoreSummaryPanel.tsx`.

### 1. Clickable Total row (`SummaryTable`)

The `tfoot`'s "Total" `<td>` becomes a `Link`, reusing the same
`tabToSlug()` + query-param pattern already used for brand names:

- `rows.length === 1` → `` `/brands/${tabToSlug(rows[0].tab)}?platform=${platform}&brand=${encodeURIComponent(rows[0].brand)}` `` — identical href to that single brand's own link.
- `rows.length > 1` → `` `/brands/${tabToSlug(rows[0].tab)}?platform=${platform}` `` (no `brand` param). All rows in a `SummaryTable` share the same `tab`, so `rows[0].tab` is safe to read.

Styled the same as the brand-name link (`font-medium text-slate-800
hover:text-violet-600 hover:underline`) so it visually reads as clickable
the same way brand names do.

### 2. `GrandTotal` stays non-interactive

No change to its "All brands" label — confirmed out of scope. It keeps
rendering as plain text.

### 3. Remove `Avg` and `Rating` columns

In both `SummaryTable` and `GrandTotal`:

- Drop the `Avg` and `Rating` `<th>` cells from the header row.
- Drop the corresponding `<td>` cells from every body row (`SummaryTable`)
  and the totals row (`GrandTotal`).
- Drop the two trailing `<col className="w-24" />` / `<col className="w-32"
  />` entries from `SummaryColgroup` (shared by both tables).
- Remove the now-unused `LABEL_PILL` map and the `RatingLabel` type import —
  nothing renders a rating pill after this change.

`computeColumnTotals()` / `ColumnTotals` and `BrandSummary` (`scoreSummary.ts`)
keep computing `average`/`label`/`rated` as before; only what
`ScoreSummaryPanel.tsx` renders changes. `summarizeCounts()` and its test
coverage in `scoreSummary.test.ts` are untouched.

## Edge cases

- A group's Total link and its single brand's link must produce byte-identical
  hrefs (no accidental drift, e.g. missing `encodeURIComponent`).
- `SummaryColgroup` is shared between `SummaryTable` (which may show a
  `Group` column when `showGroup` is true) and `GrandTotal` — removing the two
  trailing columns must not shift the star/Unrtd/Total columns out of
  alignment in either table.

## Out of scope

- No change to `scoreSummary.ts`'s average/rating-label computation — it
  remains a tested, general-purpose utility even though nothing currently
  displays its output.
- No change to the `GrandTotal` bar beyond removing the two columns; it does
  not become clickable.
- No change to star-count cell or brand-name link behavior (already shipped).

## Testing

No frontend test suite covers `ScoreSummaryPanel.tsx` directly. Verification
is manual in the browser: for each platform (TP/AG/CG/WO), confirm the Avg
and Rating columns are gone from both the per-group table and the "All
brands" bar; click a single-brand group's Total (e.g. GRG) and confirm it
lands on that brand; click a multi-brand group's Total (e.g. Hanan) and
confirm it lands on the group's page with all brands visible. `npm run
build` for the type-check gate.
