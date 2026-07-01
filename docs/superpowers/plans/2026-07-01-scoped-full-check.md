# Scoped Full Check (Tab/Brand Picker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick specific tabs/brands on the Check Status page so "Run Full Check" only checks that scope, while the default (everything checked) preserves today's one-click behavior.

**Architecture:** A new presentational `FullCheckScopePicker` component renders a tab→brand checkbox tree inside the existing "Full Check Status" card in `SyncStatus.tsx`. Selection state (`Record<tab, Set<brand>>`) lives in the page and drives which tabs `handleFullCheck` calls and whether a `brands` filter is sent. The local Python status server (`scripts/status_server.py` / `scripts/check_review_status.py`) gains matching brand-filtering so unchecked brands are actually skipped, not just hidden client-side.

**Tech Stack:** React 19 + TypeScript (Vite), Tailwind v4 utility classes, Python 3 + Flask (local Selenium bridge), pytest for the Python change.

**Spec:** `docs/superpowers/specs/2026-07-01-scoped-full-check-design.md`

## Global Constraints

- TypeScript strict mode; no `any` (per project CLAUDE.md).
- All Supabase data access stays in `src/lib/queries.ts` — pages/components never call `supabase.from(...)` directly.
- No `sync_runs` schema/DB changes — run history stays entirely client-side in `localStorage`, as it is today.
- Only the TP check path changes: `scripts/check_review_status.py`, `scripts/status_server.py`'s `/check-status` route, and `src/lib/queries.ts`'s `triggerStatusCheck`. `check_ag_status.py`, `check_cg_status.py`, `check_wo_status.py`, and `supabase/functions/check-review-status/index.ts` are untouched.
- Picker selection defaults to "everything checked" on page load and is never persisted across reloads.
- No frontend test runner exists in this repo (`npm run build` is the compile-check convention — see project memory). Frontend tasks verify via `npm run build` plus a manual browser check. The Python change follows the existing `pytest` convention used by `scripts/test_geo_proxy.py`.

---

### Task 1: Fix brand-column detection gap + extend `triggerStatusCheck`

**Files:**
- Modify: `src/lib/queries.ts:688` (`SUMMARY_BRAND_COLS`), `src/lib/queries.ts:505-529` (`triggerStatusCheck`)

**Interfaces:**
- Produces: `triggerStatusCheck(tab: string, includePublished = false, brands?: string[]): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }>` — later tasks call this with an optional 3rd argument.
- Produces: `SUMMARY_BRAND_COLS` now includes `'Brand / TP URL PAGE'` and `'URL PAGE'`, so `fetchAllTabsStatusSummary(...)`'s returned `TabStatusRow.brands` is non-empty for "TP Brand Injection" and "TP Affiliate" (previously always `[]` for those two tabs).

- [ ] **Step 1: Extend `SUMMARY_BRAND_COLS`**

In `src/lib/queries.ts`, find:

```ts
const SUMMARY_BRAND_COLS = ['Brands', 'Brand Name'];
```

Replace with:

```ts
const SUMMARY_BRAND_COLS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name'];
```

- [ ] **Step 2: Add the `brands` parameter to `triggerStatusCheck`**

Find:

```ts
export async function triggerStatusCheck(
  tab: string,
  includePublished = false,
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }> {
  if (!CHECK_STATUS_URL) {
    throw new Error(
      'VITE_CHECK_STATUS_URL is not configured — check .env',
    );
  }
  const res = await fetch(CHECK_STATUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHECK_STATUS_TOKEN || SUPABASE_ANON_KEY}`,
      // Skip ngrok's free-tier browser-warning interstitial so we always get JSON.
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ tab, include_published: includePublished }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Status check failed: ${res.status} ${body}`);
  }
  return res.json();
}
```

Replace with:

```ts
export async function triggerStatusCheck(
  tab: string,
  includePublished = false,
  brands?: string[],
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }> {
  if (!CHECK_STATUS_URL) {
    throw new Error(
      'VITE_CHECK_STATUS_URL is not configured — check .env',
    );
  }
  const res = await fetch(CHECK_STATUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHECK_STATUS_TOKEN || SUPABASE_ANON_KEY}`,
      // Skip ngrok's free-tier browser-warning interstitial so we always get JSON.
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ tab, include_published: includePublished, brands }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Status check failed: ${res.status} ${body}`);
  }
  return res.json();
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Manual check — brand chips now populate for previously-empty tabs**

Run `npm run dev`, open `http://localhost:5173/sync` in a browser. In the "Run History" table, expand the most recent row that has a nonzero removed count for "TP Brand Injection" or "TP Affiliate" (if none exists yet, this check can be deferred to Task 5's end-to-end pass — that's fine, don't block on it). Confirm per-brand chips now render under `row.tab` for those tabs (previously they rendered no chips because `SUMMARY_BRAND_COLS` never matched their brand column).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts
git commit -m "fix: detect brand column for TP Brand Injection/TP Affiliate in status summary; add brands param to triggerStatusCheck"
```

---

### Task 2: Backend brand filtering in the Python status server (TDD)

**Files:**
- Modify: `scripts/check_review_status.py:94` (add `BRAND_COLS`), `scripts/check_review_status.py:300-305` (add `find_brand_col`), `scripts/check_review_status.py:327-348` (`load_entries`)
- Modify: `scripts/status_server.py:81-123` (`/check-status` route)
- Create: `scripts/test_check_review_status.py`

**Interfaces:**
- Consumes: none from Task 1 (Python and TS sides are independent; only the wire format — a `brands` array in the POST body — needs to match, which Task 1 already sends).
- Produces: `find_brand_col(data: dict) -> Optional[str]` and `load_entries(tab=None, include_published=True, brands: Optional[list[str]] = None) -> list[dict]` — the `/check-status` route (this task) and no other callers depend on the new `brands` param, since `load_entries` defaults it to `None` (unchanged behavior when omitted).

- [ ] **Step 1: Write the failing tests**

Create `scripts/test_check_review_status.py`:

```python
import check_review_status as crs


def test_find_brand_col_prefers_first_match():
    assert crs.find_brand_col({'Brand Name': 'X', 'Brands': 'Y'}) == 'Brands'


def test_find_brand_col_returns_none_when_absent():
    assert crs.find_brand_col({'Other': 'X'}) is None


def _row(brand_col: str, brand_value: str, status: str = 'Published') -> dict:
    return {
        'id': 'row-1',
        'tab': 'TP Brand Injection',
        'sheet_row_id': 'sr-1',
        'data': {
            'Link to the profile': 'https://trustpilot.com/reviews/abc',
            'Review Status': status,
            brand_col: brand_value,
        },
    }


def test_load_entries_filters_by_brands(monkeypatch):
    rows = [
        _row('Brand / TP URL PAGE', 'Boho Casino'),
        _row('Brand / TP URL PAGE', '7Bit Casino crypto'),
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', include_published=True, brands=['Boho Casino'])

    assert len(result) == 1
    assert result[0]['data']['Brand / TP URL PAGE'] == 'Boho Casino'


def test_load_entries_without_brands_returns_all(monkeypatch):
    rows = [
        _row('Brand / TP URL PAGE', 'Boho Casino'),
        _row('Brand / TP URL PAGE', '7Bit Casino crypto'),
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', include_published=True)

    assert len(result) == 2


def test_load_entries_skips_rows_with_no_brand_col_when_filtering(monkeypatch):
    rows = [
        {
            'id': 'row-2',
            'tab': 'TP Brand Injection',
            'sheet_row_id': 'sr-2',
            'data': {
                'Link to the profile': 'https://trustpilot.com/reviews/xyz',
                'Review Status': 'Published',
            },
        },
    ]
    monkeypatch.setattr(crs, '_fetch_all', lambda params: rows)

    result = crs.load_entries('TP Brand Injection', include_published=True, brands=['Boho Casino'])

    assert result == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest scripts/test_check_review_status.py -v`
Expected: `find_brand_col` tests fail with `AttributeError: module 'check_review_status' has no attribute 'find_brand_col'`; the `load_entries` brand tests fail with `TypeError: load_entries() got an unexpected keyword argument 'brands'`.

- [ ] **Step 3: Add `BRAND_COLS` and `find_brand_col`**

In `scripts/check_review_status.py`, find:

```python
SCORE_COLS = ["Score"]
```

Replace with:

```python
SCORE_COLS = ["Score"]

# Same priority order as BRAND_COLS in src/pages/BrandGroup.tsx — keep in sync.
BRAND_COLS = ["Brands", "Brand Name", "Brand", "Brand / TP URL PAGE", "URL PAGE", "Account Name"]
```

Find:

```python
def find_score_col(data: dict) -> Optional[str]:
    for col in SCORE_COLS:
        if col in data:
            return col
    return None
```

Replace with:

```python
def find_score_col(data: dict) -> Optional[str]:
    for col in SCORE_COLS:
        if col in data:
            return col
    return None


def find_brand_col(data: dict) -> Optional[str]:
    for col in BRAND_COLS:
        if col in data:
            return col
    return None
```

- [ ] **Step 4: Add the `brands` filter to `load_entries`**

Find:

```python
def load_entries(tab: Optional[str] = None, include_published: bool = True) -> list[dict]:
    params: dict = {"select": "id,tab,sheet_row_id,data"}
    if tab:
        params["tab"] = f"eq.{tab}"
    rows: list[dict] = _fetch_all(params)

    statuses = CHECKABLE_STATUSES if include_published else {"done", "pending"}

    out = []
    for row in rows:
        data: dict = row.get("data") or {}
        profile_url: str = data.get("Link to the profile", "") or ""
        if not profile_url.strip():
            continue
        status_col = find_status_col(data)
        if not status_col:
            continue
        current = (data.get(status_col) or "").strip().lower()
        if current not in statuses:
            continue
        out.append(row)
    return out
```

Replace with:

```python
def load_entries(tab: Optional[str] = None, include_published: bool = True,
                  brands: Optional[list[str]] = None) -> list[dict]:
    params: dict = {"select": "id,tab,sheet_row_id,data"}
    if tab:
        params["tab"] = f"eq.{tab}"
    rows: list[dict] = _fetch_all(params)

    statuses = CHECKABLE_STATUSES if include_published else {"done", "pending"}
    brand_set = set(brands) if brands else None

    out = []
    for row in rows:
        data: dict = row.get("data") or {}
        profile_url: str = data.get("Link to the profile", "") or ""
        if not profile_url.strip():
            continue
        status_col = find_status_col(data)
        if not status_col:
            continue
        current = (data.get(status_col) or "").strip().lower()
        if current not in statuses:
            continue
        if brand_set is not None:
            brand_col = find_brand_col(data)
            if not brand_col or data.get(brand_col) not in brand_set:
                continue
        out.append(row)
    return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest scripts/test_check_review_status.py -v`
Expected: all 5 tests PASS.

Note: this import requires `scripts/.env` to already have `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set (same requirement as running `status_server.py` itself) since the module reads them at import time.

- [ ] **Step 6: Wire `brands` through the `/check-status` route**

In `scripts/status_server.py`, find:

```python
    body = request.get_json(silent=True) or {}
    tab: str | None = body.get('tab')
    include_published: bool = bool(body.get('include_published', False))
    platform: str = (body.get('platform') or 'tp').lower()
```

Replace with:

```python
    body = request.get_json(silent=True) or {}
    tab: str | None = body.get('tab')
    include_published: bool = bool(body.get('include_published', False))
    platform: str = (body.get('platform') or 'tp').lower()
    brands: list[str] | None = body.get('brands') or None
```

Find (inside the same `check_status()` function, the default TP branch):

```python
        # Default: TP Selenium check.
        entries = load_entries(tab, include_published=include_published)
```

Replace with:

```python
        # Default: TP Selenium check.
        entries = load_entries(tab, include_published=include_published, brands=brands)
```

- [ ] **Step 7: Sanity-check the server still starts**

Run: `python scripts/status_server.py --port 5099` (a scratch port so it doesn't collide with a running instance on 5001), confirm the startup banner prints with no traceback, then stop it (Ctrl+C).
Expected: `[server] Listening on http://localhost:5099` with no exceptions.

- [ ] **Step 8: Commit**

```bash
git add scripts/check_review_status.py scripts/status_server.py scripts/test_check_review_status.py
git commit -m "feat: add brand-level filtering to the TP status check server"
```

---

### Task 3: Build the `FullCheckScopePicker` component and wire it into the Check Status page

**Files:**
- Create: `src/components/FullCheckScopePicker.tsx`
- Modify: `src/pages/SyncStatus.tsx` (imports, new state, render the picker, disable the Run button when nothing is selected)

**Interfaces:**
- Consumes: `TabStatusRow` (from `src/lib/queries.ts`, unchanged shape, `brands: string[]` now populated correctly per Task 1), `getTabSequence` (from `src/lib/tab-configs.ts`, existing export).
- Produces: `FullCheckScopePicker` component with props `{ tabs: string[]; brandsByTab: Record<string, string[]>; selection: Record<string, Set<string>>; onChange: (next: Record<string, Set<string>>) => void }`. Produces `buildBrandsByTab(summary: TabStatusRow[]): Record<string, string[]>` in `SyncStatus.tsx`, and page-level state `summary: TabStatusRow[]`, `brandsByTab: Record<string, string[]>`, `selection: Record<string, Set<string>>` — Task 4 reads/writes `selection` and `brandsByTab`.

- [ ] **Step 1: Create the picker component**

Create `src/components/FullCheckScopePicker.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';

interface FullCheckScopePickerProps {
  tabs: string[];
  brandsByTab: Record<string, string[]>;
  selection: Record<string, Set<string>>;
  onChange: (next: Record<string, Set<string>>) => void;
}

type TabState = 'full' | 'partial' | 'none';

function tabState(tab: string, brandsByTab: Record<string, string[]>, selection: Record<string, Set<string>>): TabState {
  const total = brandsByTab[tab]?.length ?? 0;
  const picked = selection[tab]?.size ?? 0;
  if (picked === 0) return 'none';
  if (picked >= total) return 'full';
  return 'partial';
}

function TriStateCheckbox({ state, onChange }: { state: TabState; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'partial';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'full'}
      onChange={onChange}
      className="size-4 shrink-0 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500"
    />
  );
}

export default function FullCheckScopePicker({ tabs, brandsByTab, selection, onChange }: FullCheckScopePickerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const totalBrands = tabs.reduce((s, t) => s + (brandsByTab[t]?.length ?? 0), 0);
  const selectedBrands = tabs.reduce((s, t) => s + (selection[t]?.size ?? 0), 0);
  const selectedTabs = tabs.filter((t) => (selection[t]?.size ?? 0) > 0).length;

  function toggleExpand(tab: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(tab) ? next.delete(tab) : next.add(tab);
      return next;
    });
  }

  function toggleTab(tab: string) {
    const state = tabState(tab, brandsByTab, selection);
    const all = brandsByTab[tab] ?? [];
    onChange({ ...selection, [tab]: state === 'full' ? new Set() : new Set(all) });
  }

  function toggleBrand(tab: string, brand: string) {
    const current = new Set(selection[tab] ?? []);
    current.has(brand) ? current.delete(brand) : current.add(brand);
    onChange({ ...selection, [tab]: current });
  }

  function selectAll() {
    onChange(Object.fromEntries(tabs.map((t) => [t, new Set(brandsByTab[t] ?? [])])));
  }

  function clearAll() {
    onChange(Object.fromEntries(tabs.map((t) => [t, new Set()])));
  }

  const query = search.trim().toLowerCase();

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2">
        <div className="flex min-w-[10rem] flex-1 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1">
          <Search className="size-3.5 shrink-0 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brands…"
            className="w-full bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
              <X className="size-3" />
            </button>
          )}
        </div>
        <button type="button" onClick={selectAll} className="text-xs font-medium text-brand-600 hover:text-brand-700">
          Select all
        </button>
        <button type="button" onClick={clearAll} className="text-xs font-medium text-slate-500 hover:text-slate-700">
          Clear all
        </button>
        <span className="text-xs text-slate-500 tabular-nums">
          {selectedTabs} of {tabs.length} tabs · {selectedBrands} of {totalBrands} brands selected
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto py-1">
        {tabs.map((tab) => {
          const brands = brandsByTab[tab] ?? [];
          const hasBrandList = brands.length > 1;
          const matches = query ? brands.filter((b) => b.toLowerCase().includes(query)) : brands;
          if (query && matches.length === 0) return null;
          const isOpen = hasBrandList && (expanded.has(tab) || !!query);
          const state = tabState(tab, brandsByTab, selection);

          return (
            <div key={tab} className="border-b border-slate-50 last:border-b-0">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <TriStateCheckbox state={state} onChange={() => toggleTab(tab)} />
                {hasBrandList ? (
                  <button
                    type="button"
                    onClick={() => toggleExpand(tab)}
                    className="flex flex-1 items-center gap-1.5 text-left text-sm text-slate-700"
                  >
                    {isOpen ? <ChevronDown className="size-3.5 text-slate-400" /> : <ChevronRight className="size-3.5 text-slate-400" />}
                    <span className="font-medium">{tab}</span>
                    <span className="text-xs text-slate-400 tabular-nums">
                      ({selection[tab]?.size ?? 0}/{brands.length})
                    </span>
                  </button>
                ) : (
                  <span className="flex-1 text-sm font-medium text-slate-700">{tab}</span>
                )}
              </div>
              {isOpen && (
                <div className="space-y-0.5 pb-1.5 pl-9 pr-3">
                  {matches.map((brand) => (
                    <label key={brand} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selection[tab]?.has(brand) ?? false}
                        onChange={() => toggleBrand(tab, brand)}
                        className="size-3.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="truncate">{brand}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: exits 0 (the component isn't imported anywhere yet, so this just checks it's syntactically/type valid on its own).

- [ ] **Step 3: Wire summary/selection state into `SyncStatus.tsx`**

In `src/pages/SyncStatus.tsx`, find:

```tsx
import { triggerStatusCheck, fetchAllTabsStatusSummary, type TabStatusRow } from '../lib/queries';
import { tabToSlug } from '../lib/tabs';
import Toast, { type ToastKind } from '../components/Toast';
import { TAB_COLUMN_CONFIGS } from '../lib/tab-configs';
```

Replace with:

```tsx
import { triggerStatusCheck, fetchAllTabsStatusSummary, type TabStatusRow } from '../lib/queries';
import { tabToSlug } from '../lib/tabs';
import Toast, { type ToastKind } from '../components/Toast';
import { TAB_COLUMN_CONFIGS, getTabSequence } from '../lib/tab-configs';
import FullCheckScopePicker from '../components/FullCheckScopePicker';
```

Find:

```tsx
const ALL_TABS = Object.keys(TAB_COLUMN_CONFIGS);

const HISTORY_KEY = 'fullCheckHistory';
```

Replace with:

```tsx
const ALL_TABS = Object.keys(TAB_COLUMN_CONFIGS);

// Orders each tab's brands by its curated TAB_BRAND_SEQUENCE (when one exists), appending
// any live brand not yet in that list so nothing is ever hidden from the picker. Tabs with
// no detected brand column at all fall back to a single pseudo-brand (the tab name itself).
function buildBrandsByTab(summary: TabStatusRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of summary) {
    if (row.brands.length === 0) {
      out[row.tab] = [row.tab];
      continue;
    }
    const seq = getTabSequence(row.tab);
    if (!seq) {
      out[row.tab] = row.brands;
      continue;
    }
    const liveSet = new Set(row.brands);
    const ordered = seq.filter((b) => liveSet.has(b));
    const extra = row.brands.filter((b) => !seq.includes(b)).sort();
    out[row.tab] = [...ordered, ...extra];
  }
  return out;
}

const HISTORY_KEY = 'fullCheckHistory';
```

Find:

```tsx
export default function SyncStatus() {
  const [toast, setToast]     = useState<{ message: string; kind: ToastKind } | null>(null);

  const [checkHistory, setCheckHistory]     = useState<FullCheckSnapshot[]>(() => loadHistory());
  const [expandedRun, setExpandedRun]       = useState<Set<string>>(new Set());

  // Mirror module-level singleton into render via forceUpdate
  const [, tick] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _fullCheckListeners.add(tick);
    return () => { _fullCheckListeners.delete(tick); };
  }, []);
  const checkingAll    = _fullCheckRunning;
  const checkProgress  = _fullCheckProgress;

  async function loadSummary(): Promise<TabStatusRow[]> {
    return fetchAllTabsStatusSummary(ALL_TABS);
  }

  useEffect(() => { loadSummary(); }, []);
```

Replace with:

```tsx
export default function SyncStatus() {
  const [toast, setToast]     = useState<{ message: string; kind: ToastKind } | null>(null);

  const [checkHistory, setCheckHistory]     = useState<FullCheckSnapshot[]>(() => loadHistory());
  const [expandedRun, setExpandedRun]       = useState<Set<string>>(new Set());

  const [summary, setSummary] = useState<TabStatusRow[]>([]);
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const seededSelectionRef = useRef(false);

  // Mirror module-level singleton into render via forceUpdate
  const [, tick] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _fullCheckListeners.add(tick);
    return () => { _fullCheckListeners.delete(tick); };
  }, []);
  const checkingAll    = _fullCheckRunning;
  const checkProgress  = _fullCheckProgress;

  async function loadSummary(): Promise<TabStatusRow[]> {
    return fetchAllTabsStatusSummary(ALL_TABS);
  }

  useEffect(() => { loadSummary().then(setSummary); }, []);

  const brandsByTab = buildBrandsByTab(summary);

  // Default every tab/brand to checked the first time real data arrives. Runs once per
  // page load — later summary refreshes (e.g. after running a check) don't touch a
  // selection the user has already customized.
  useEffect(() => {
    if (seededSelectionRef.current || summary.length === 0) return;
    setSelection(Object.fromEntries(ALL_TABS.map((t) => [t, new Set(brandsByTab[t] ?? [])])));
    seededSelectionRef.current = true;
  }, [summary]);
```

Add `useRef` to the React import. Find:

```tsx
import React, { useEffect, useReducer, useState } from 'react';
```

Replace with:

```tsx
import React, { useEffect, useReducer, useRef, useState } from 'react';
```

- [ ] **Step 4: Render the picker and disable the Run button when nothing is selected**

Find:

```tsx
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Full Check Status</h2>
            <p className="mt-1 text-sm text-slate-500">Checks all TP links including Published — detects reviews that have been removed</p>
          </div>
          <div className="flex items-center gap-3">
            {checkProgress && (
              <span className="text-sm text-slate-500 tabular-nums">{checkProgress}</span>
            )}
            <button
              onClick={handleFullCheck}
              disabled={checkingAll}
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${checkingAll ? 'animate-spin' : ''}`} />
              {checkingAll ? 'Checking…' : 'Run Full Check'}
            </button>
          </div>
        </div>
```

Replace with:

```tsx
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Full Check Status</h2>
            <p className="mt-1 text-sm text-slate-500">Checks all TP links including Published — detects reviews that have been removed</p>
          </div>
          <div className="flex items-center gap-3">
            {checkProgress && (
              <span className="text-sm text-slate-500 tabular-nums">{checkProgress}</span>
            )}
            <button
              onClick={handleFullCheck}
              disabled={checkingAll || nothingSelected}
              title={nothingSelected ? 'Select at least one tab or brand' : undefined}
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${checkingAll ? 'animate-spin' : ''}`} />
              {checkingAll ? 'Checking…' : 'Run Full Check'}
            </button>
          </div>
        </div>

        {summary.length > 0 && (
          <FullCheckScopePicker
            tabs={ALL_TABS}
            brandsByTab={brandsByTab}
            selection={selection}
            onChange={setSelection}
          />
        )}
```

Add the `nothingSelected` derived value right before the `return (` statement. Find:

```tsx
  function toggleRun(runAt: string) {
    setExpandedRun((prev) => {
      const next = new Set(prev);
      next.has(runAt) ? next.delete(runAt) : next.add(runAt);
      return next;
    });
  }

  return (
```

Replace with:

```tsx
  function toggleRun(runAt: string) {
    setExpandedRun((prev) => {
      const next = new Set(prev);
      next.has(runAt) ? next.delete(runAt) : next.add(runAt);
      return next;
    });
  }

  const nothingSelected = ALL_TABS.every((t) => (selection[t]?.size ?? 0) === 0);

  return (
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Manual check — picker renders and toggles correctly**

Run `npm run dev`, open `http://localhost:5173/sync`. Confirm:
- The picker renders below the "Run Full Check" button, all tabs/brands checked, counter reads e.g. "10 of 10 tabs · N of N brands selected".
- Expanding "TP Brand Injection" shows its brand list in the curated order (7Bit Casino crypto, Boho Casino, Amonbet Casino, ...).
- Unchecking one brand flips that tab's checkbox to the indeterminate (dash) state and decrements the counter.
- Unchecking every brand in a tab flips it to fully unchecked.
- "Clear all" empties every checkbox and disables the "Run Full Check" button (hover shows the "Select at least one tab or brand" tooltip).
- "Select all" restores every checkbox and re-enables the button.
- Typing in the search box filters brand rows across all tabs to matching names only.

- [ ] **Step 7: Commit**

```bash
git add src/components/FullCheckScopePicker.tsx src/pages/SyncStatus.tsx
git commit -m "feat: add tab/brand scope picker to the Check Status page"
```

---

### Task 4: Wire scoped run semantics and history labeling

**Files:**
- Modify: `src/pages/SyncStatus.tsx` (`handleFullCheck`, `FullCheckSnapshot` interface, run history rendering)

**Interfaces:**
- Consumes: `selection: Record<string, Set<string>>` and `brandsByTab: Record<string, string[]>` from Task 3's page state; `triggerStatusCheck(tab, includePublished, brands?)` from Task 1.
- Produces: `FullCheckSnapshot.scope?: { tabsRun: number; tabsTotal: number; brandsRun: number; brandsTotal: number }`, read by the run-history render block added in Step 3.

- [ ] **Step 1: Add `scope` to `FullCheckSnapshot`**

Find:

```tsx
interface FullCheckSnapshot {
  runAt: string;
  summary: TabStatusRow[];
}
```

Replace with:

```tsx
interface FullCheckSnapshot {
  runAt: string;
  summary: TabStatusRow[];
  scope?: { tabsRun: number; tabsTotal: number; brandsRun: number; brandsTotal: number };
}
```

- [ ] **Step 2: Make `handleFullCheck` respect the selection**

Find:

```tsx
  async function handleFullCheck() {
    setFullCheckRunning(true);
    let succeeded = 0, failed = 0;
    for (let i = 0; i < ALL_TABS.length; i++) {
      const tab = ALL_TABS[i];
      setFullCheckProgress(`Checking "${tab}" (${i + 1}/${ALL_TABS.length})…`);
      try {
        await triggerStatusCheck(tab, true);
        succeeded++;
      } catch {
        failed++;
      }
    }
    setFullCheckRunning(false);
    setToast({
      message: failed > 0
        ? `${succeeded} tab${succeeded !== 1 ? 's' : ''} checked, ${failed} failed`
        : `All ${succeeded} tabs checked successfully`,
      kind: failed > 0 ? 'error' : 'success',
    });
    const latest = await loadSummary();
    const snapshot: FullCheckSnapshot = { runAt: new Date().toISOString(), summary: latest };
    const updated = [snapshot, ...checkHistory].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    setCheckHistory(updated);
  }
```

Replace with:

```tsx
  async function handleFullCheck() {
    const tabsToRun = ALL_TABS.filter((t) => (selection[t]?.size ?? 0) > 0);
    if (tabsToRun.length === 0) return;

    setFullCheckRunning(true);
    let succeeded = 0, failed = 0;
    for (let i = 0; i < tabsToRun.length; i++) {
      const tab = tabsToRun[i];
      const total = brandsByTab[tab]?.length ?? 0;
      const picked = selection[tab]?.size ?? 0;
      const full = picked >= total;
      setFullCheckProgress(
        full
          ? `Checking "${tab}" (${i + 1}/${tabsToRun.length})…`
          : `Checking "${tab}" — ${picked} brand${picked !== 1 ? 's' : ''} (${i + 1}/${tabsToRun.length})…`
      );
      try {
        await triggerStatusCheck(tab, true, full ? undefined : [...selection[tab]!]);
        succeeded++;
      } catch {
        failed++;
      }
    }
    setFullCheckRunning(false);
    setToast({
      message: failed > 0
        ? `${succeeded} tab${succeeded !== 1 ? 's' : ''} checked, ${failed} failed`
        : `All ${succeeded} tab${succeeded !== 1 ? 's' : ''} checked successfully`,
      kind: failed > 0 ? 'error' : 'success',
    });
    const latest = await loadSummary();
    setSummary(latest);
    const brandsRun = tabsToRun.reduce((s, t) => s + (selection[t]?.size ?? 0), 0);
    const brandsTotal = ALL_TABS.reduce((s, t) => s + (brandsByTab[t]?.length ?? 0), 0);
    const snapshot: FullCheckSnapshot = {
      runAt: new Date().toISOString(),
      summary: latest,
      scope: { tabsRun: tabsToRun.length, tabsTotal: ALL_TABS.length, brandsRun, brandsTotal },
    };
    const updated = [snapshot, ...checkHistory].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    setCheckHistory(updated);
  }
```

- [ ] **Step 3: Add a scope badge to the run-history table**

Find:

```tsx
                        <td className="px-4 py-3 text-xs">
                          {!hasPrev ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">{totRem} removed</span>
                              <span className="text-slate-400">(baseline)</span>
                            </span>
                          ) : newlyRemoved > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">
                              +{newlyRemoved} newly removed from Published
                            </span>
                          ) : (
                            <span className="text-slate-400">No new removals</span>
                          )}
                        </td>
```

Replace with:

```tsx
                        <td className="px-4 py-3 text-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {snap.scope && (snap.scope.tabsRun !== snap.scope.tabsTotal || snap.scope.brandsRun !== snap.scope.brandsTotal) && (
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                                Custom — {snap.scope.tabsRun}/{snap.scope.tabsTotal} tabs, {snap.scope.brandsRun}/{snap.scope.brandsTotal} brands
                              </span>
                            )}
                            {!hasPrev ? (
                              <span className="inline-flex items-center gap-2">
                                <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">{totRem} removed</span>
                                <span className="text-slate-400">(baseline)</span>
                              </span>
                            ) : newlyRemoved > 0 ? (
                              <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">
                                +{newlyRemoved} newly removed from Published
                              </span>
                            ) : (
                              <span className="text-slate-400">No new removals</span>
                            )}
                          </div>
                        </td>
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Manual check — scoped run behavior and history labeling**

With `npm run dev` running and `http://localhost:5173/sync` open:
- Uncheck a few brands within one tab and fully uncheck a different tab, then click "Run Full Check". Confirm the progress text only iterates the tabs that still have a selection, and shows the "— N brands" suffix for the partially-selected tab.
- After the run finishes, confirm the new Run History row shows the "Custom — X/10 tabs, Y/Z brands" badge.
- Click "Select all", then "Run Full Check" again. Confirm this run's history row shows no "Custom" badge (a full run).

- [ ] **Step 6: Commit**

```bash
git add src/pages/SyncStatus.tsx
git commit -m "feat: scope Full Check runs to the picker selection and label history entries"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 2: Run the Python test suite**

Run: `pytest scripts/test_check_review_status.py -v`
Expected: all tests PASS.

- [ ] **Step 3: Verify the outgoing request payload via browser DevTools**

With `npm run dev` running, open `http://localhost:5173/sync` and open the browser's Network tab.
- Uncheck all brands in one tab entirely, and uncheck exactly half the brands in a second tab. Leave the rest fully checked.
- Click "Run Full Check".
- In the Network tab, confirm: no request is sent for the fully-unchecked tab; the request for the half-checked tab has a JSON body containing `"brands": [...]` with exactly the checked brand names; requests for fully-checked tabs have `"brands"` either absent or `null`/`undefined` (i.e. behave exactly like today's unscoped call).

- [ ] **Step 4: Optional live smoke test**

If you want to confirm the Python side actually skips unchecked brands (not just that the right payload is sent): run `python scripts/status_server.py` locally, select a single brand within one tab in the picker, click "Run Full Check", and confirm the server's terminal output only visits that one brand's URL(s) rather than the whole tab. This step touches real Trustpilot URLs and writes to the live DB/Sheet, so only run it when you're ready for that.

- [ ] **Step 5: Report completion**

No commit needed for this task — it's verification only. Summarize the verification results to confirm the feature is ready to use.
