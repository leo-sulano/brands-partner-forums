# Full Check — Scoped by Tab and Brand

**Date:** 2026-07-01
**Status:** Approved

## Problem

"Run Full Check" always checks every brand in all 10 operational tabs. There's no way to re-check just a few brands after a targeted fix, or to run a smaller batch to avoid a long full pass — every run is all-or-nothing.

## Goal

Add a tab → brand picker to the Check Status page so a user can select exactly which tabs/brands "Run Full Check" processes, while the default (everything checked) keeps today's one-click behavior unchanged.

## Design

### Data source for brand lists

`fetchAllTabsStatusSummary` (`src/lib/queries.ts`) already computes a `brands: string[]` per tab from live entry data, but its column-detection list is incomplete:

```ts
// current — misses TP Brand Injection ("Brand / TP URL PAGE") and TP Affiliate ("URL PAGE")
const SUMMARY_BRAND_COLS = ['Brands', 'Brand Name'];
```

Fix: extend it to match the fuller list already used in `BrandGroup.tsx`:

```ts
const SUMMARY_BRAND_COLS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name'];
```

When a tab has a `getTabSequence(tab)` (currently "TP Brand Injection", "TP Affiliate"), the picker orders brands per that curated sequence instead of the alphabetical order `fetchAllTabsStatusSummary` returns.

If a tab's computed `brands` array is empty (no recognizable brand column at all, e.g. "Trybet", "HazEmirates UAE"), the picker treats that tab as a single pseudo-brand equal to the tab name — so every tab always has ≥1 selectable unit, and tabs with only one unit render as a plain checkbox with no expand arrow. This falls out of the data naturally; no need to special-case specific tab names.

### Selection state

```ts
type ScopeSelection = Record<string, Set<string>>; // tab -> set of selected brand names (or the pseudo-brand)
```

- Initialized to every tab mapped to the full set of its brands (or `{tab}` for single-unit tabs) whenever the summary loads — **everything checked by default**, matching today's behavior. Not persisted across reloads.
- A tab is **full** when `selection[tab].size === brandsByTab[tab].length`, **partial** when `0 < size < length`, **none** when `size === 0`.

### UI — `FullCheckScopePicker` component

New presentational component (`src/components/FullCheckScopePicker.tsx`), rendered inside the existing "Full Check Status" card in `SyncStatus.tsx`, between the header and the delta message:

```
☑ TP Brand Injection (21/21)              ▾
    ☑ 7Bit Casino crypto
    ☑ Boho Casino
    ...
☑ Trybet                                   (no chevron — single unit)
```

- Tab row: tri-state checkbox (checked / indeterminate / unchecked via a ref-set `.indeterminate`) + tab name + `(n/total)` count + chevron toggling expansion. Clicking the checkbox selects/deselects all of that tab's brands. Tabs with exactly one unit render no chevron and no count suffix.
- Expanded brand rows: plain checkboxes, indented, toggle individually.
- Toolbar: "Select all" / "Clear all" links, live counter — `"6 of 10 tabs · 32 of 61 brands selected"`.
- "Run Full Check" button is disabled (with a tooltip: "Select at least one tab or brand") when the total selected count is 0.

### Run semantics

`handleFullCheck` in `SyncStatus.tsx` iterates only tabs with a non-empty selection, instead of always looping `ALL_TABS`:

```ts
const tabsToRun = ALL_TABS.filter((t) => selection[t].size > 0);
for (let i = 0; i < tabsToRun.length; i++) {
  const tab = tabsToRun[i];
  const full = selection[tab].size === brandsByTab[tab].length;
  setFullCheckProgress(
    full
      ? `Checking "${tab}" (${i + 1}/${tabsToRun.length})…`
      : `Checking "${tab}" — ${selection[tab].size} brands (${i + 1}/${tabsToRun.length})…`
  );
  await triggerStatusCheck(tab, true, full ? undefined : [...selection[tab]]);
}
```

`triggerStatusCheck` (`src/lib/queries.ts`) gains a new optional 3rd argument:

```ts
export async function triggerStatusCheck(
  tab: string,
  includePublished = false,
  brands?: string[],
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }>
```

Body becomes `{ tab, include_published: includePublished, brands }` — `brands` omitted/undefined when doing a full-tab check, so the backend behaves exactly as it does today for unscoped runs.

### Run history labeling

`FullCheckSnapshot` (localStorage, `src/pages/SyncStatus.tsx`) gains an optional `scope` field:

```ts
interface FullCheckSnapshot {
  runAt: string;
  summary: TabStatusRow[];
  scope?: { tabsRun: number; tabsTotal: number; brandsRun: number; brandsTotal: number };
}
```

The run-history table's date/run label gets a small badge: "Full run" when `scope` is absent (legacy entries) or `tabsRun === tabsTotal && brandsRun === brandsTotal`; otherwise `"Custom — {tabsRun}/{tabsTotal} tabs, {brandsRun}/{brandsTotal} brands"`.

The `summary` snapshot itself is unchanged — still a full recount of all 10 tabs' current DB state via `fetchAllTabsStatusSummary(ALL_TABS)`, regardless of what was actually checked. This keeps the removed-count delta math between runs exactly as accurate (or inaccurate) as it is today; only the label describing what triggered the run changes.

### Backend — brand filtering (Python)

`scripts/status_server.py`, `/check-status` route: read a new optional `brands: list[str]` from the POST body and pass through to `load_entries`.

`scripts/check_review_status.py`:

```python
BRAND_COLS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name']

def find_brand_col(data: dict) -> Optional[str]:
    for col in BRAND_COLS:
        if col in data:
            return col
    return None

def load_entries(tab: Optional[str] = None, include_published: bool = True,
                  brands: Optional[list[str]] = None) -> list[dict]:
    ...
    if brands:
        brand_set = set(brands)
        out = [row for row in out if (data := row.get("data") or {})
               and (col := find_brand_col(data))
               and data.get(col) in brand_set]
    return out
```

Only the TP path (`check_review_status.py` / `/check-status`) changes — `check_ag_status.py`, `check_cg_status.py`, `check_wo_status.py` are untouched, since "Run Full Check" on this page only ever triggers the TP check.

No `sync_runs` schema changes: the local Python server never writes to `sync_runs` (that insert only happens in `supabase/functions/check-review-status/index.ts`, a separate Deno edge function that `VITE_CHECK_STATUS_URL` does not point to and which this feature does not touch). Run history stays entirely client-side in `localStorage`, as it is today.

### Out of scope

- AG/CG/WO Selenium checkers — brand filtering not added there.
- The Deno edge function `supabase/functions/check-review-status/index.ts` — not in the live path for this button, left as-is.
- Persisting the picker's selection across page reloads — always resets to "everything checked".
- Per-tab "Check Status" buttons elsewhere in the app (e.g. BrandGroup) — unaffected.
