# Run History — Brand Drilldown as a Table

**Date:** 2026-07-02
**Status:** Approved

## Problem

On the Check Status page's run-history table ([RunHistoryTable.tsx](../../../src/components/RunHistoryTable.tsx)), expanding a run that touched brand-level tabs shows each affected brand as an inline pill: a rose "N" badge (the brand's *cumulative* removed total, from `removedBrandCounts`) plus, if that brand has newly-removed entries this run, a separate darker "+N new" button that expands a list of individual removed accounts. Two numbers — cumulative total and this-run delta — are crammed into one pill with no visible "published" figure at all, and the flex-wrap pill layout doesn't scan well once more than a couple of brands are affected in one tab.

## Goal

Replace the per-brand pill row with a proper 3-column table (Brand | Published | Removed) per affected tab, where "Removed" means *this run's new removals* (not the cumulative total), and "Published" is the brand's current whole/total published count. Keep the existing click-to-expand behavior for seeing exactly which accounts were newly removed.

## Design

### Data model change

[queries.ts:907-960](../../../src/lib/queries.ts#L907-L960) — `TabStatusRow` currently tracks `removedBrandCounts: Record<string, number>` (cumulative removed count per brand) but has no per-brand published figure; `brands: string[]` is just a flat name list with no status split.

Add `publishedBrandCounts: Record<string, number>`, populated in the same entry loop that already builds `removedBrandCounts` (`fetchAllTabsStatusSummary`, queries.ts:938-955): when `statuses.some(isLiveStatus)` is true and a brand column resolves, bump `publishedBrandCounts.set(brand, (get(brand) ?? 0) + 1)` — mirrors the existing removed-side logic exactly.

This field rides along in the `summary` JSONB already stored on `full_check_runs.summary` (schemaless column, no migration needed). Runs recorded before this ships won't have the field in their stored JSON; the UI treats a missing entry as `0`.

### UI change

[RunHistoryTable.tsx:169-214](../../../src/components/RunHistoryTable.tsx#L169-L214) — the `rb.length > 0` branch that renders the arrow + per-brand pill spans is replaced with a `<table>`, nested under the existing tab header line (tab link, `X pub` pill, `X rem` pill, tab-level `+N new` pill — all unchanged).

```
Brand              Published   Removed
SilverPlay Casino         42         6
BetSite XYZ                8         1
```

- **Row source**: brands present in `diffGroups["<tab>::<brand>"]` for this tab (i.e., brands with ≥1 newly-removed entry *this run*) — not `row.removedBrands` (which includes brands with old cumulative removals but nothing new). A brand with removals from a prior run and none new this run gets no row.
- **Published** cell: `publishedBrandCounts[brand] ?? 0` — the brand's current whole total, not diffed.
- **Removed** cell: `diffGroups["<tab>::<brand>"].length` — count of that brand's newly-removed entries this run.
- **Click-to-expand**: clicking a brand's row (or its Removed cell) toggles `expandedBrand` (existing `Set<string>` state, same `` `${run.id}::${tab}::${brand}` `` key) exactly as today. When open, an extra `<tr>` (`colSpan=2`, nested under the 2-column table) lists each newly-removed entry:
  ```
  account_name — {TP|AG|CG} removed → (link opens in new tab)
  ```
  Same data (`newRows` from `diffGroups`), same link/target/rel attributes as today (RunHistoryTable.tsx:196-207), just rendered as a table row instead of an inline `<a>` stack.
- Rows sorted alphabetically by brand name (matches today's `removedBrands.sort()` behavior via `.sort()` on the derived key list).
- Table styling matches the outer run-history table: `text-xs`, uppercase `tracking-wide text-slate-500` header row on a `bg-slate-50` background, numeric columns right-aligned with `tabular-nums`.
- Tabs with no recognizable brand column (Trybet, HazEmirates UAE, etc.) keep showing only the tab-level header line — no table underneath, same as today (no brand keys exist in `diffGroups` for these tabs beyond the empty-brand aggregate key).
- This table only ever appears for tabs already passing the existing `rowsToShow` filter (tabs with `tabDiffRows(...).length > 0`) — no new gating logic needed at the tab level.

### Data flow / edge cases

- No changes to the diffing logic (`diffRemovedEntries`, `removedEntriesDiff.ts`), the two-run fetch in `toggleRun`, or the `expandedRun`/`expandedBrand` state shapes — this change only touches (a) one new counter map in the data layer, and (b) the markup/row-source for the per-brand section.
- Old runs missing `publishedBrandCounts` in their stored `summary` render `0` in the Published column rather than crashing (optional chaining, `?? 0`).
- If a run has no prior run to diff against (baseline), no brand table renders anywhere in that row — same as today's baseline treatment, since `diffGroups` is never computed without a `prevRun`.

### Testing

- No changes needed to `removedEntriesDiff.test.ts` (diffing logic untouched).
- Manual verification: expand a run with known newly-removed brands, confirm the table lists only brands with new removals this run (not ones with only historical removals), Published shows the correct whole-brand total, Removed shows the new-this-run count, and clicking a row still expands the correct individual account/platform links.

## Out of scope

- Changing the tab-level header line (tab name, `X pub`/`X rem` totals, tab-level `+N new` badge) — unchanged.
- Any change to how "published" or "removed" status is classified at the entry level.
- Retention/cleanup of `full_check_removed_entries` or `full_check_runs` — unrelated to this change.
- Showing brands with zero new removals in the table (considered and rejected — see Design > Row source).
