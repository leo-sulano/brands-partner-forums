# Brand Drilldown Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-brand pill row under an expanded run-history entry with a Brand / Published / Removed table, where Removed reflects only this run's newly-removed entries.

**Architecture:** Add a `publishedBrandCounts` counter map to the existing per-tab summary computation in `queries.ts` (mirrors the existing `removedBrandCounts` counter exactly). Then, in `RunHistoryTable.tsx`, replace the inline flex-wrap brand pills with an HTML table whose rows come from the already-computed `diffGroups` (brands with ≥1 newly-removed entry this run), keeping the existing click-to-expand behavior for individual removed accounts.

**Tech Stack:** React 19 + TypeScript (strict), Tailwind v4, Vite, Vitest.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-02-brand-drilldown-table-design.md` — follow it exactly; do not add scope beyond it.
- No new test infrastructure: this codebase has no Supabase-mocking or React component-testing setup (only pure-function unit tests exist, e.g. `removedEntriesDiff.test.ts`). Both tasks below are verified via `npm run build` (strict TypeScript compile) plus manual browser verification, matching the sibling `tabDiffRows` helper and `fetchAllTabsStatusSummary`, which are also untested by unit tests today. Do not invent mocking scaffolding to force TDD here — that would be scope creep beyond the approved spec.
- `tsc --noEmit` alone is insufficient in this repo (root tsconfig is references-only) — always verify with `npm run build`.
- Do not touch the tab-level header line (tab name, `X pub`/`X rem` totals, tab-level `+N new` badge) — unchanged per spec.
- Do not change `diffRemovedEntries`, `removedEntriesDiff.ts`, or the two-run fetch in `toggleRun` — unchanged per spec.

---

### Task 1: Add per-brand published counts to the tab summary

**Files:**
- Modify: `src/lib/queries.ts:907-960`

**Interfaces:**
- Produces: `TabStatusRow.publishedBrandCounts?: Record<string, number>` — optional (older stored runs won't have it), maps brand name → current whole published count for that brand, populated by `fetchAllTabsStatusSummary`.

- [ ] **Step 1: Add the field to the `TabStatusRow` interface**

In `src/lib/queries.ts`, change:

```ts
export interface TabStatusRow {
  tab: string;
  published: number;
  removed: number;
  pending: number;
  brands: string[];
  removedBrands: string[];
  removedBrandCounts: Record<string, number>;
}
```

to:

```ts
export interface TabStatusRow {
  tab: string;
  published: number;
  removed: number;
  pending: number;
  brands: string[];
  removedBrands: string[];
  removedBrandCounts: Record<string, number>;
  publishedBrandCounts?: Record<string, number>;
}
```

The field is optional because runs recorded before this change was deployed have `summary` JSONB in Supabase without this key — consumers must handle `undefined`.

- [ ] **Step 2: Track published counts per brand in the counting loop**

In the same file, inside `fetchAllTabsStatusSummary`, change:

```ts
      let published = 0, removed = 0, pending = 0;
      const brandSet = new Set<string>();
      const removedBrandCounts = new Map<string, number>();

      for (const entry of entries) {
        const d = entry.data;
        const statuses = [tpCol, agCol, cgCol]
          .filter((c): c is string => !!c)
          .map((c) => (d[c] ?? '').toLowerCase());
        if (statuses.some(isLiveStatus)) published++;
        else if (statuses.some(isRemovedStatus)) {
          removed++;
          if (brandCol) {
            const brand = d[brandCol]?.trim();
            if (brand) removedBrandCounts.set(brand, (removedBrandCounts.get(brand) ?? 0) + 1);
          }
        } else if (statuses.some(isPendingStatus)) pending++;
        if (brandCol) {
          const brand = d[brandCol]?.trim();
          if (brand) brandSet.add(brand);
        }
      }

      const removedBrands = [...removedBrandCounts.keys()].sort();
      const removedBrandCountsObj = Object.fromEntries(removedBrandCounts);
      return { tab, published, removed, pending, brands: [...brandSet].sort(), removedBrands, removedBrandCounts: removedBrandCountsObj };
```

to:

```ts
      let published = 0, removed = 0, pending = 0;
      const brandSet = new Set<string>();
      const removedBrandCounts = new Map<string, number>();
      const publishedBrandCounts = new Map<string, number>();

      for (const entry of entries) {
        const d = entry.data;
        const statuses = [tpCol, agCol, cgCol]
          .filter((c): c is string => !!c)
          .map((c) => (d[c] ?? '').toLowerCase());
        if (statuses.some(isLiveStatus)) {
          published++;
          if (brandCol) {
            const brand = d[brandCol]?.trim();
            if (brand) publishedBrandCounts.set(brand, (publishedBrandCounts.get(brand) ?? 0) + 1);
          }
        } else if (statuses.some(isRemovedStatus)) {
          removed++;
          if (brandCol) {
            const brand = d[brandCol]?.trim();
            if (brand) removedBrandCounts.set(brand, (removedBrandCounts.get(brand) ?? 0) + 1);
          }
        } else if (statuses.some(isPendingStatus)) pending++;
        if (brandCol) {
          const brand = d[brandCol]?.trim();
          if (brand) brandSet.add(brand);
        }
      }

      const removedBrands = [...removedBrandCounts.keys()].sort();
      const removedBrandCountsObj = Object.fromEntries(removedBrandCounts);
      const publishedBrandCountsObj = Object.fromEntries(publishedBrandCounts);
      return {
        tab, published, removed, pending,
        brands: [...brandSet].sort(),
        removedBrands,
        removedBrandCounts: removedBrandCountsObj,
        publishedBrandCounts: publishedBrandCountsObj,
      };
```

- [ ] **Step 3: Verify the project still builds**

Run: `npm run build`
Expected: exits with no errors (strict TypeScript compile + Vite build succeed).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries.ts
git commit -m "$(cat <<'EOF'
feat: track per-brand published counts in tab summary

Mirrors the existing removedBrandCounts logic so the run-history
drilldown table can show a brand's whole published total, not just
its removed count.
EOF
)"
```

---

### Task 2: Replace per-brand pills with a Brand/Published/Removed table

**Files:**
- Modify: `src/components/RunHistoryTable.tsx:1-231`

**Interfaces:**
- Consumes: `TabStatusRow.publishedBrandCounts?: Record<string, number>` (Task 1), `RemovedEntryRow` from `../lib/removedEntriesDiff` (existing), `diffGroups: Record<string, RemovedEntryRow[]>` (existing, keyed by `` `${tab}::${brand ?? ''}` ``).
- Produces: new local helper `tabBrandGroups(diffGroups, tab): Array<{ brand: string; rows: RemovedEntryRow[] }>`, sorted alphabetically by brand, excluding the tab's brand-less aggregate key.

- [ ] **Step 1: Add the `tabBrandGroups` helper next to the existing `tabDiffRows` helper**

In `src/components/RunHistoryTable.tsx`, immediately after the existing `tabDiffRows` function (currently lines 19-24):

```ts
function tabDiffRows(diffGroups: Record<string, RemovedEntryRow[]>, tab: string): RemovedEntryRow[] {
  const prefix = `${tab}::`;
  return Object.entries(diffGroups)
    .filter(([key]) => key.startsWith(prefix))
    .flatMap(([, rows]) => rows);
}
```

add:

```ts
// One entry per brand with >=1 newly-removed row this run, sorted alphabetically.
// Excludes the tab's brand-less aggregate key (`${tab}::`), which has no brand to show a row for.
function tabBrandGroups(
  diffGroups: Record<string, RemovedEntryRow[]>,
  tab: string,
): Array<{ brand: string; rows: RemovedEntryRow[] }> {
  const prefix = `${tab}::`;
  return Object.entries(diffGroups)
    .filter(([key, rows]) => key.startsWith(prefix) && key !== prefix && rows.length > 0)
    .map(([key, rows]) => ({ brand: key.slice(prefix.length), rows }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
}
```

- [ ] **Step 2: Replace the per-brand pill rendering with the table**

Replace the entire block currently at lines 150-219 of `src/components/RunHistoryTable.tsx`:

```tsx
                      ) : rowsToShow.length === 0 ? (
                        <p className="py-2 text-xs text-slate-400">No newly removed entries in this run.</p>
                      ) : (
                        <div className="space-y-1">
                          {rowsToShow.map((row) => {
                            const rb = row.removedBrands ?? [];
                            const counts = row.removedBrandCounts ?? {};
                            const tabNewRows = tabDiffRows(diffGroups, row.tab);
                            return (
                              <div key={row.tab} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-xs">
                                <Link
                                  to={`/brands/${tabToSlug(row.tab)}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="min-w-[130px] font-medium text-slate-700 whitespace-nowrap hover:text-brand-600 hover:underline"
                                >{row.tab}</Link>
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 tabular-nums">{row.published} pub</span>
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700 tabular-nums">{row.removed} rem</span>
                                {tabNewRows.length > 0 && (
                                  <span className="rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white tabular-nums">+{tabNewRows.length} new</span>
                                )}
                                {rb.length > 0 && (
                                  <>
                                    <span className="text-slate-300">→</span>
                                    {rb.map((b) => {
                                      const groupKey = `${row.tab}::${b}`;
                                      const newRows = diffGroups[groupKey] ?? [];
                                      const brandKey = `${run.id}::${groupKey}`;
                                      const brandOpen = expandedBrand.has(brandKey);
                                      return (
                                        <span key={b} className="inline-flex flex-col gap-1">
                                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                                            {b}
                                            {counts[b] != null && (
                                              <span className="rounded-full bg-rose-200 px-1.5 py-px font-semibold tabular-nums">{counts[b]}</span>
                                            )}
                                            {newRows.length > 0 && (
                                              <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); toggleBrand(brandKey); }}
                                                className="ml-1 rounded-full bg-rose-600 px-1.5 py-px font-semibold text-white tabular-nums hover:bg-rose-700"
                                              >
                                                +{newRows.length} new
                                              </button>
                                            )}
                                          </span>
                                          {brandOpen && newRows.length > 0 && (
                                            <span className="ml-2 flex flex-col gap-0.5 border-l border-rose-200 pl-2">
                                              {newRows.map((r) => (
                                                <a
                                                  key={r.id}
                                                  href={r.link ?? undefined}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="text-rose-600 hover:underline"
                                                >
                                                  {r.account_name ?? 'Unknown account'} — {r.platform} removed
                                                </a>
                                              ))}
                                            </span>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
```

with:

```tsx
                      ) : rowsToShow.length === 0 ? (
                        <p className="py-2 text-xs text-slate-400">No newly removed entries in this run.</p>
                      ) : (
                        <div className="space-y-2">
                          {rowsToShow.map((row) => {
                            const tabNewRows = tabDiffRows(diffGroups, row.tab);
                            const brandGroups = tabBrandGroups(diffGroups, row.tab);
                            const publishedCounts = row.publishedBrandCounts ?? {};
                            return (
                              <div key={row.tab} className="py-1 text-xs">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <Link
                                    to={`/brands/${tabToSlug(row.tab)}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="min-w-[130px] font-medium text-slate-700 whitespace-nowrap hover:text-brand-600 hover:underline"
                                  >{row.tab}</Link>
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 tabular-nums">{row.published} pub</span>
                                  <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700 tabular-nums">{row.removed} rem</span>
                                  {tabNewRows.length > 0 && (
                                    <span className="rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white tabular-nums">+{tabNewRows.length} new</span>
                                  )}
                                </div>
                                {brandGroups.length > 0 && (
                                  <table className="mt-1.5 ml-2 w-full max-w-md border-collapse">
                                    <thead>
                                      <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                                        <th className="px-2 py-1 text-left font-medium">Brand</th>
                                        <th className="px-2 py-1 text-right font-medium">Published</th>
                                        <th className="px-2 py-1 text-right font-medium">Removed</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {brandGroups.map(({ brand, rows: newRows }) => {
                                        const brandKey = `${run.id}::${row.tab}::${brand}`;
                                        const brandOpen = expandedBrand.has(brandKey);
                                        return (
                                          <React.Fragment key={brand}>
                                            <tr
                                              onClick={(e) => { e.stopPropagation(); toggleBrand(brandKey); }}
                                              className="cursor-pointer hover:bg-rose-50"
                                            >
                                              <td className="px-2 py-1 text-slate-700">{brand}</td>
                                              <td className="px-2 py-1 text-right text-emerald-700 tabular-nums">{publishedCounts[brand] ?? 0}</td>
                                              <td className="px-2 py-1 text-right font-semibold text-rose-700 tabular-nums">{newRows.length}</td>
                                            </tr>
                                            {brandOpen && (
                                              <tr>
                                                <td colSpan={3} className="border-l-2 border-rose-200 bg-rose-50/50 px-3 py-1.5">
                                                  <div className="flex flex-col gap-0.5">
                                                    {newRows.map((r) => (
                                                      <a
                                                        key={r.id}
                                                        href={r.link ?? undefined}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-rose-600 hover:underline"
                                                      >
                                                        {r.account_name ?? 'Unknown account'} — {r.platform} removed
                                                      </a>
                                                    ))}
                                                  </div>
                                                </td>
                                              </tr>
                                            )}
                                          </React.Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
```

- [ ] **Step 3: Verify the project builds with no type errors**

Run: `npm run build`
Expected: exits with no errors. This will catch any unused-variable or type mismatch issues from removing `rb`/`counts` and adding `brandGroups`/`publishedCounts`.

- [ ] **Step 4: Manually verify in the browser**

1. Run: `npm run dev`
2. Sign in and navigate to `/sync` (Check Status / Sync page).
3. Find a run in the history table with a nonzero "+N newly removed from Published" badge, and expand it.
4. Confirm: each affected tab still shows its header line (tab name, pub/rem pills, tab-level `+N new`) unchanged.
5. Confirm: underneath, a table appears with columns **Brand / Published / Removed**, listing only brands that have new removals in this run (not brands whose only removals are from a previous run).
6. Click a brand row: confirm it expands to show the individual newly-removed accounts with working links (opens in a new tab), matching what the old pill drilldown used to show.
7. Click the row again: confirm it collapses.
8. Expand a run with **no** new removals (or the baseline row): confirm it still shows "No newly removed entries in this run." with no table.
9. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/components/RunHistoryTable.tsx
git commit -m "$(cat <<'EOF'
feat: render per-brand drilldown as a Brand/Published/Removed table

Replaces the inline pill row with a table. Removed now reflects only
this run's newly-removed entries (via diffGroups) rather than each
brand's cumulative removed total, with Published showing the brand's
current whole published count from the new publishedBrandCounts field.
EOF
)"
```
