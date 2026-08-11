# Multi-Select Dashboard Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every category-filter dropdown across the dashboard (Platform, Country, Proxy, Status, Agent, Brand, Tab) from single-select to multi-select, backed by one new shared dropdown component and array-typed filter state everywhere.

**Architecture:** One new `MultiSelectDropdown` component replaces four hand-rolled single-select dropdowns. Every filter's state becomes `string[]` (`[]` = "All"). URL/localStorage persistence is comma-separated with transparent single-value migration. "Combined total" (OR-across-selected-platforms) semantics are applied identically at three independent call sites (`queries.ts`, `BrandGroup.tsx`, `scoreSummary.ts`) that already each implement platform-scoping today.

**Tech Stack:** React 19, TypeScript strict mode, Vite, Tailwind v4, Vitest (no React Testing Library / component-render tests in this repo — UI changes are verified live in the browser, not via automated component tests; this matches existing project convention).

## Global Constraints

- Empty array (`[]`) means "All" / no filtering on that field — never render an empty-looking result as if the filter were broken.
- Within one filter: OR (row matches if its value is any selected value). Across different filters: AND (unchanged).
- A bare single string value (existing URL param, existing localStorage entry) is read as a one-item array — no visible behavior change for existing bookmarks/saved views.
- Multi-platform selection combines Live/Removed/Success-Rate counts into one merged total (OR-across-selected-platforms), applied identically in `queries.ts`, `BrandGroup.tsx`, and `scoreSummary.ts`.
- Score Summary's star-rating histogram only computes/renders when exactly one platform is selected — 2+ selected platforms hide it (Live/Removed/Success-Rate still show, combined).
- Date Range stays single-range everywhere. BrandGroup's Rating filter and non-filter `SelectDropdown` usages (`EditEntryModal.tsx`, `AddReviewAccountModal.tsx`, `SchedulePlanner.tsx`'s tab picker) are untouched.
- `npm run build` is this repo's real type-check (root `tsconfig.json` is references-only; bare `tsc --noEmit` checks nothing).
- Spec: `docs/superpowers/specs/2026-08-11-multi-select-dashboard-filters-design.md`.

---

### Task 1: Shared array-filter-param helpers

**Files:**
- Create: `src/lib/filterParams.ts`
- Test: `src/lib/filterParams.test.ts`

**Interfaces:**
- Produces: `readArrayParam(searchParams: URLSearchParams, key: string): string[]`, `writeArrayParam(next: URLSearchParams, key: string, values: string[]): void`, `toArrayFilter(value: string[] | string | undefined | null): string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/filterParams.test.ts
import { describe, it, expect } from 'vitest';
import { readArrayParam, writeArrayParam, toArrayFilter } from './filterParams';

describe('readArrayParam', () => {
  it('returns [] when the param is absent', () => {
    expect(readArrayParam(new URLSearchParams(''), 'platform')).toEqual([]);
  });
  it('reads a bare single value as a one-item array (legacy URL migration)', () => {
    expect(readArrayParam(new URLSearchParams('platform=tp'), 'platform')).toEqual(['tp']);
  });
  it('splits a comma-separated value into multiple items', () => {
    expect(readArrayParam(new URLSearchParams('platform=tp,ag'), 'platform')).toEqual(['tp', 'ag']);
  });
  it('drops empty segments from a trailing/leading comma', () => {
    expect(readArrayParam(new URLSearchParams('platform=tp,,ag,'), 'platform')).toEqual(['tp', 'ag']);
  });
});

describe('writeArrayParam', () => {
  it('deletes the key when values is empty', () => {
    const next = new URLSearchParams('platform=tp');
    writeArrayParam(next, 'platform', []);
    expect(next.has('platform')).toBe(false);
  });
  it('sets a single value with no comma', () => {
    const next = new URLSearchParams('');
    writeArrayParam(next, 'platform', ['tp']);
    expect(next.get('platform')).toBe('tp');
  });
  it('joins multiple values with a comma', () => {
    const next = new URLSearchParams('');
    writeArrayParam(next, 'platform', ['tp', 'ag']);
    expect(next.get('platform')).toBe('tp,ag');
  });
});

describe('toArrayFilter', () => {
  it('wraps a truthy legacy string into a one-item array', () => {
    expect(toArrayFilter('tp')).toEqual(['tp']);
  });
  it('returns [] for an empty legacy string', () => {
    expect(toArrayFilter('')).toEqual([]);
  });
  it('returns [] for undefined/null', () => {
    expect(toArrayFilter(undefined)).toEqual([]);
    expect(toArrayFilter(null)).toEqual([]);
  });
  it('passes an already-array value through unchanged', () => {
    expect(toArrayFilter(['tp', 'ag'])).toEqual(['tp', 'ag']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/filterParams.test.ts`
Expected: FAIL — `Cannot find module './filterParams'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/filterParams.ts

// Shared read/write contract for every multi-select filter's URL persistence:
// comma-separated within one param, [] means the param is omitted entirely.
// A bare single value (no comma) is indistinguishable from — and reads
// identically to — a pre-existing single-select filter's URL, so every
// existing bookmark/deep link keeps working with no code changes at the
// call site that built it.
export function readArrayParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  return raw ? raw.split(',').filter(Boolean) : [];
}

export function writeArrayParam(next: URLSearchParams, key: string, values: string[]): void {
  if (values.length > 0) next.set(key, values.join(',')); else next.delete(key);
}

// Migrates a legacy single-string localStorage field (or an already-migrated
// array field, or a missing field) into the array shape every filter now
// uses. Call this once at each readFiltersFromStorage call site rather than
// duplicating the check per field.
export function toArrayFilter(value: string[] | string | undefined | null): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/filterParams.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/filterParams.ts src/lib/filterParams.test.ts
git commit -m "feat: add shared array-filter URL/localStorage param helpers"
```

---

### Task 2: `MultiSelectDropdown` component

**Files:**
- Create: `src/components/MultiSelectDropdown.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 directly (pure UI component).
- Produces:
  ```ts
  export interface MultiSelectOption { value: string; label: string; dot?: string }
  export default function MultiSelectDropdown(props: {
    values: string[];
    onChange: (values: string[]) => void;
    options: MultiSelectOption[];
    noun?: string;
    searchable?: boolean;
    placeholder?: string;
  }): JSX.Element
  ```
  Tasks 3-5 render this in place of `BrandFilterDropdown`, BrandGroup's inline `FilterDropdown`, and ScoreSummaryPanel's inline `PlatformFilter`/`TabFilterDropdown`.

No React Testing Library is installed in this repo (confirmed: `package.json` has no `@testing-library/*`), so this component has no automated render test — every other filter dropdown in this codebase (`BrandFilterDropdown.tsx`, `SelectDropdown.tsx`) ships the same way, verified live in the browser. Task 3 is this component's first real usage and where it gets exercised against live data.

- [ ] **Step 1: Write the component**

```tsx
// src/components/MultiSelectDropdown.tsx
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check, ChevronDown } from 'lucide-react';

export interface MultiSelectOption { value: string; label: string; dot?: string }

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiSelectOption[];
  noun?: string;
  searchable?: boolean;
  placeholder?: string;
}

// Every filter dropdown in this codebase renders as a small pill button that
// opens a checklist menu. This one differs from the single-select versions
// it replaces (BrandFilterDropdown, SelectDropdown, BrandGroup's inline
// FilterDropdown) in exactly one interaction: clicking a row TOGGLES it and
// keeps the menu open, instead of selecting-and-closing — every other visual
// and positioning detail intentionally matches those existing components.
export default function MultiSelectDropdown({ values, onChange, options, noun = 'option', searchable = false, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    if (searchable) setTimeout(() => inputRef.current?.focus(), 50);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, searchable]);

  // Portaled to document.body (matching SelectDropdown.tsx's already-solved
  // approach) so the menu floats above any scroll container instead of being
  // clipped by one — BrandGroup's filter row sits above its own
  // self-scrolling table panel, which this repo has hit dropdown-clipping
  // bugs against before.
  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  const visible = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const active = values.length > 0;
  const label = values.length === 0
    ? (placeholder ?? `All ${noun}s`)
    : values.length === 1
      ? (options.find((o) => o.value === values[0])?.label ?? values[0])
      : `${values.length} ${noun}s`;

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
          active
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'
        }`}
      >
        {active && <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />}
        <span className="max-w-[9rem] truncate">{label}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onChange([]); }} className="ml-0.5 text-blue-400 hover:text-blue-600 transition-colors">
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] rounded-lg border border-slate-200 bg-white shadow-xl"
          style={{ top: menuRect.top, left: menuRect.left, width: Math.max(menuRect.width, 200) }}
        >
          {searchable && (
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
              <Search className="size-3.5 shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${noun}s…`}
                className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
              />
              {search && <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600"><X className="size-3" /></button>}
            </div>
          )}
          <div className="max-h-60 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${!active ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
            >
              <span className="flex-1">{placeholder ?? `All ${noun}s`}</span>
              {!active && <Check className="size-3 text-blue-500" />}
            </button>
            {visible.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No {noun}s match</div>
            )}
            {visible.map((opt) => {
              const checked = values.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${checked ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
                >
                  {opt.dot && <span className={`size-1.5 shrink-0 rounded-full ${opt.dot}`} />}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {checked && <Check className="size-3 text-blue-500" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS — no unused-import or type errors (the component isn't referenced by anything yet, so this only checks the file itself is well-typed).

- [ ] **Step 3: Commit**

```bash
git add src/components/MultiSelectDropdown.tsx
git commit -m "feat: add shared MultiSelectDropdown component"
```

---

### Task 3: Overview.tsx + queries.ts — Country, Proxy, Platform filters

**Files:**
- Modify: `src/lib/queries.ts:370-539` (`computeTabKpisFromEntries`, `fetchTabKpis`)
- Modify: `src/lib/queries.test.ts` (existing `computeTabKpisFromEntries` suite — every call passing a bare country/proxy/platform string becomes an array)
- Modify: `src/pages/Overview.tsx:433-436,514,522-536,554` (filter state, param builders, deep-link builders, Clear button)

**Interfaces:**
- Consumes: `readArrayParam`/`writeArrayParam` (Task 1), `MultiSelectDropdown`/`MultiSelectOption` (Task 2).
- Produces: `computeTabKpisFromEntries(entries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter?: string[], proxyFilter?: string[], platformFilter?: Platform[]): TabKpis | null` and `fetchTabKpis(...)` with the same new array param types — both keep their positional order, so any other caller (there are none besides Overview.tsx today, confirmed via a repo-wide search of `fetchTabKpis(`) is unaffected structurally, only by the type change.

- [ ] **Step 1: Update the existing `computeTabKpisFromEntries` tests to pass arrays**

In `src/lib/queries.test.ts`, every existing call already documented in this plan's research passes a bare string for `countryFilter`/`proxyFilter`/`platformFilter`. Wrap each in a one-item array — for example:

```ts
// Before:
const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), 'Germany')!;
// After:
const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), ['Germany'])!;
```

Apply this same one-item-array wrap to every call in the file passing a 8th (`countryFilter`), 9th (`proxyFilter`), or 10th (`platformFilter`) positional argument as a bare string — this includes (line numbers from the pre-change file, re-check after Step 1 since the file won't have shifted lines yet): 222, 233, 244 (x2 — both country and proxy), 274, 295, 312, 323 (`'cg'` → `['cg']`), 349, 356, 377, 391.

- [ ] **Step 2: Run tests to verify they fail (signature not yet changed)**

Run: `npm test -- src/lib/queries.test.ts`
Expected: FAIL on type errors is not how Vitest surfaces this at runtime — since these are plain JS arrays passed where a string was typed, TypeScript would catch it at build time but Vitest itself will still run and the existing single-string logic will silently misbehave (e.g. `canonicalCountryKey(['Germany'])` on an array). Confirm this by running `npm run build` instead, which is the real gate here:

Run: `npm run build`
Expected: FAIL with type errors like `Argument of type 'string[]' is not assignable to parameter of type 'string | undefined'`.

- [ ] **Step 3: Update `computeTabKpisFromEntries` and `fetchTabKpis`**

In `src/lib/queries.ts`, replace lines 370-539:

```ts
export function computeTabKpisFromEntries(
  entries: Entry[],
  rawHeaders: string[],
  tab: string,
  brandCol: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  removedPlatformBrands: Set<string>,
  countryFilter?: string[],
  proxyFilter?: string[],
  platformFilter?: Platform[],
): TabKpis | null {
  function resolveHeader(...variants: string[]): string | null {
    for (const v of variants) {
      const found = rawHeaders.find((h) => h.toLowerCase() === v.toLowerCase());
      if (found) return found;
    }
    return null;
  }

  const tpCol = resolveHeader('TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status');
  const agCol = resolveHeader('AG Review Status');
  const cgCol = resolveHeader('CG Review Status');
  const woCol = resolveHeader('WoO Review Status');
  const genericCol = resolveHeader('Review Status', 'status', 'Status');

  const activePlatforms: ('tp' | 'ag' | 'cg' | 'wo')[] = [];
  if (tpCol) activePlatforms.push('tp');
  if (agCol) activePlatforms.push('ag');
  if (cgCol) activePlatforms.push('cg');
  if (woCol) activePlatforms.push('wo');

  // A tab is excluded only if it tracks NONE of the selected platforms — it's
  // included (and scoped to just the tracked subset below) if it tracks at
  // least one, which is what makes "TP + AG selected" a combined total
  // rather than an intersection.
  if (platformFilter?.length && !platformFilter.some((p) => activePlatforms.includes(p))) {
    return null;
  }

  let live = 0, removed = 0, done = 0, pending = 0, onPause = 0, notDone = 0;
  let tpLive = 0, tpRemoved = 0;
  let agLive = 0, agRemoved = 0;
  let cgLive = 0, cgRemoved = 0;
  let woLive = 0, woRemoved = 0;

  const filteredEntries = (countryFilter?.length || proxyFilter?.length)
    ? entries.filter((e) => {
        if (countryFilter?.length && !countryFilter.some((cf) => canonicalCountryKey(resolveCountryLabel(e.data, tab)) === canonicalCountryKey(cf))) return false;
        if (proxyFilter?.length && !proxyFilter.some((pf) => canonicalProxyKey(e.data['Proxy Used'] ?? '') === canonicalProxyKey(pf))) return false;
        return true;
      })
    : entries;

  const countries = uniqueDisplayValues(entries.map((e) => resolveCountryLabel(e.data, tab)), canonicalCountryKey, canonicalCountryName);
  const proxies = uniqueDisplayValues(entries.map((e) => e.data['Proxy Used']), canonicalProxyKey, canonicalProxyName);
  const byCountry: Record<string, CountBreakdown> = {};
  const byProxy: Record<string, CountBreakdown> = {};

  for (const entry of filteredEntries) {
    const d = entry.data;
    const tp = tpCol ? (d[tpCol] ?? '').toLowerCase() : '';
    const ag = agCol ? (d[agCol] ?? '').toLowerCase() : '';
    const cg = cgCol ? (d[cgCol] ?? '').toLowerCase() : '';
    const wo = woCol ? (d[woCol] ?? '').toLowerCase() : '';
    const generic = (!tp && !ag && !cg && !wo && genericCol) ? (d[genericCol] ?? '').toLowerCase() : '';

    const brand = (d[brandCol] ?? '').trim();
    const isPlatformFlagged = (platform: Platform) =>
      brand !== '' && removedPlatformBrands.has(platformRemovedKey(tab, brand, platform));

    const tpDateOk = !!tp && passesPlatformDateFilter(d, 'tp', dateFrom, dateTo);
    const agDateOk = !!ag && passesPlatformDateFilter(d, 'ag', dateFrom, dateTo);
    const cgDateOk = !!cg && passesPlatformDateFilter(d, 'cg', dateFrom, dateTo);
    const woDateOk = !!wo && passesPlatformDateFilter(d, 'wo', dateFrom, dateTo);
    const genericInRange = !!generic && ((!dateFrom && !dateTo) || inDateRange(d, dateFrom ?? '', dateTo ?? ''));

    if (tpDateOk && !isPlatformFlagged('tp')) { if (isLiveStatus(tp)) tpLive++; else if (isRemovedStatus(tp)) tpRemoved++; }
    if (agDateOk && !isPlatformFlagged('ag')) { if (isLiveStatus(ag)) agLive++; else if (isRemovedStatus(ag)) agRemoved++; }
    if (cgDateOk && !isPlatformFlagged('cg')) { if (isLiveStatus(cg)) cgLive++; else if (isRemovedStatus(cg)) cgRemoved++; }
    if (woDateOk && !isPlatformFlagged('wo')) { if (isLiveStatus(wo)) woLive++; else if (isRemovedStatus(wo)) woRemoved++; }

    const platformValue: Record<'tp' | 'ag' | 'cg' | 'wo', string> = { tp, ag, cg, wo };
    const platformDateOk: Record<'tp' | 'ag' | 'cg' | 'wo', boolean> = { tp: tpDateOk, ag: agDateOk, cg: cgDateOk, wo: woDateOk };

    // Union the selected platforms' own date/flag-gated status values into
    // the same statuses array the omitted-filter (all-platform) branch
    // already used — this is the combined-total rule: a row counts as live
    // if ANY selected platform's status says so.
    const statuses: string[] = platformFilter?.length
      ? platformFilter
          .map((p) => (platformDateOk[p] && !isPlatformFlagged(p) ? platformValue[p] : ''))
          .filter(Boolean)
      : [
          tpDateOk && !isPlatformFlagged('tp') ? tp : '',
          agDateOk && !isPlatformFlagged('ag') ? ag : '',
          cgDateOk && !isPlatformFlagged('cg') ? cg : '',
          woDateOk && !isPlatformFlagged('wo') ? wo : '',
          genericInRange ? generic : '',
        ].filter(Boolean);

    if (statuses.length > 0) {
      if (statuses.some(isLiveStatus)) {
        live++;
        addToBreakdown(byCountry, resolveCountryLabel(d, tab), 'live', canonicalCountryKey, canonicalCountryName);
        addToBreakdown(byProxy, d['Proxy Used'], 'live', canonicalProxyKey, canonicalProxyName);
      } else if (statuses.some(isRemovedStatus)) {
        removed++;
        addToBreakdown(byCountry, resolveCountryLabel(d, tab), 'removed', canonicalCountryKey, canonicalCountryName);
        addToBreakdown(byProxy, d['Proxy Used'], 'removed', canonicalProxyKey, canonicalProxyName);
      }
      else if (statuses.some(isDoneStatus)) done++;
      else if (statuses.some(isPendingStatus)) pending++;
      else if (statuses.some(isOnPauseStatus)) onPause++;
      else if (statuses.some(isNotDoneStatus)) notDone++;
    }
  }

  return {
    total: live + removed,
    live, removed, done, pending, onPause, notDone,
    tp: { live: tpLive, removed: tpRemoved },
    ag: { live: agLive, removed: agRemoved },
    cg: { live: cgLive, removed: cgRemoved },
    wo: { live: woLive, removed: woRemoved },
    activePlatforms, byCountry, byProxy, countries, proxies,
  };
}

export async function fetchTabKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedPlatformBrands: Set<string> = new Set(),
  countryFilter?: string[],
  proxyFilter?: string[],
  platformFilter?: Platform[],
): Promise<TabKpis | null> {
  const [allEntries, rawHeaders] = await Promise.all([
    fetchAllTabEntries(tab),
    fetchTabHeaders(tab),
  ]);
  const brandCol = getBrandNameCol(tab);
  return computeTabKpisFromEntries(allEntries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter, proxyFilter, platformFilter);
}
```

- [ ] **Step 4: Add new multi-value regression tests to `queries.test.ts`**

Append to the `describe('computeTabKpisFromEntries', ...)` block:

```ts
  it('platformFilter with 2 platforms combines their live/removed into one total (combined-total semantics)', () => {
    const rawHeadersMulti = ['Brands', 'Trust Pilot', 'TP Review Status', 'Casino Guru review added', 'CG Review Status'];
    const multiEntry = {
      id: '1', tab: 'Rooster Partners', sheet_row_id: '1',
      data: {
        Brands: 'BrandX',
        'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed',
        'Casino Guru review added': '10/06/2026', 'CG Review Status': 'Published',
      },
      updated_at: '2026-01-01T00:00:00Z', last_edited_by: 'dashboard', last_sync_tag: null,
    };
    const kpis = computeTabKpisFromEntries([multiEntry], rawHeadersMulti, 'Rooster Partners', 'Brands', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['tp', 'cg']);
    expect(kpis).not.toBeNull();
    // TP is Removed and CG is Published/live on the same row — statuses.some(isLiveStatus)
    // is checked before statuses.some(isRemovedStatus), so a row with a decided outcome on
    // both counts as live once, not once for each platform and not as removed.
    expect(kpis!.live).toBe(1);
    expect(kpis!.removed).toBe(0);
    expect(kpis!.tp).toEqual({ live: 0, removed: 1 });
    expect(kpis!.cg).toEqual({ live: 1, removed: 0 });
  });

  it('a tab is included when it tracks at least one of 2 selected platforms, scoped to only the tracked one', () => {
    const kpis = computeTabKpisFromEntries(
      [entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' })],
      rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, ['tp', 'cg'],
    );
    expect(kpis).not.toBeNull();
    expect(kpis!.live).toBe(1);
  });

  it('countryFilter with 2 values matches either (OR)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Spain' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), ['Germany', 'France'])!;
    expect(kpis.live).toBe(2);
  });

  it('an empty platformFilter array behaves identically to omitting it entirely (regression lock)', () => {
    const entries = [entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' })];
    const omitted = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set());
    const empty = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, []);
    expect(empty).toEqual(omitted);
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/queries.test.ts`
Expected: PASS (all existing tests plus the 4 new ones).

- [ ] **Step 6: Update `Overview.tsx`'s filter state, param builders, and rendering**

In `src/pages/Overview.tsx`:

Replace the filter-state block (lines 433-436):
```ts
// Before:
  const countryFilter = searchParams.get('country') ?? '';
  const proxyFilter   = searchParams.get('proxy')   ?? '';
  const platformParam = searchParams.get('platform');
  const platformFilter: 'all' | Platform = PLATFORM_VALUES.has(platformParam ?? '') ? (platformParam as Platform) : 'all';
// After:
  const countryFilter = readArrayParam(searchParams, 'country');
  const proxyFilter   = readArrayParam(searchParams, 'proxy');
  const platformFilter = readArrayParam(searchParams, 'platform').filter((p) => PLATFORM_VALUES.has(p)) as Platform[];
```
Add the import: `import { readArrayParam, writeArrayParam } from '../lib/filterParams';`

Update the `fetchTabKpis` call inside `loadData` (line 453) — since `[]` now already means "no filter" at the callee, the ternary is no longer needed:
```ts
// Before:
            platformFilter === 'all' ? undefined : platformFilter,
// After:
            platformFilter,
```
Do the same for `countryFilter || undefined` / `proxyFilter || undefined` (lines 451-452) — pass the arrays directly:
```ts
// Before:
            countryFilter || undefined,
            proxyFilter || undefined,
// After:
            countryFilter,
            proxyFilter,
```

Replace `updateFilterParam`/`setPlatformFilter` (lines 522-536):
```ts
  function updateFilterParam(key: 'country' | 'proxy', values: string[]) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      writeArrayParam(next, key, values);
      return next;
    }, { replace: true });
  }

  function setPlatformFilter(values: string[]) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      writeArrayParam(next, 'platform', values);
      return next;
    }, { replace: true });
  }
```

Update the two deep-link builders that read `platformFilter` (lines 514, 554) — both already only ever emit a single value per param and stay correct once `platformFilter` is an array, they just need `platformFilter.length` instead of `!== 'all'` and `.join(',')` if ever emitting the full selection:
```ts
// Line 514, before:
      linkFor: (tab) => `/brands/${tabToSlug(tab)}?status=${kind}${dimension === 'country' ? `&country=${encodeURIComponent(card.label)}` : ''}${platformFilter !== 'all' ? `&platform=${platformFilter}` : ''}`,
// After:
      linkFor: (tab) => `/brands/${tabToSlug(tab)}?status=${kind}${dimension === 'country' ? `&country=${encodeURIComponent(card.label)}` : ''}${platformFilter.length > 0 ? `&platform=${platformFilter.join(',')}` : ''}`,
```
Line 554's `?platform=${platformKey}` is unaffected — it's a single specific platform's own drill-down slice, not derived from `platformFilter`.

Replace the render call sites for Country/Proxy/Platform (`Overview.tsx:608-629`):
```tsx
// Before:
        {allCountries.length > 1 && (
          <BrandFilterDropdown
            noun="countrie"
            value={countryFilter}
            onChange={(v) => updateFilterParam('country', v)}
            brands={allCountries}
          />
        )}
        {allProxies.length > 1 && (
          <BrandFilterDropdown
            noun="proxie"
            value={proxyFilter}
            onChange={(v) => updateFilterParam('proxy', v)}
            brands={allProxies}
          />
        )}
        <BrandFilterDropdown
          noun="platform"
          value={platformFilter === 'all' ? '' : platformFilter.toUpperCase()}
          onChange={(v) => setPlatformFilter(v.toLowerCase())}
          brands={['TP', 'AG', 'CG', 'WO']}
        />

// After:
        {allCountries.length > 1 && (
          <MultiSelectDropdown
            noun="country"
            values={countryFilter}
            onChange={(v) => updateFilterParam('country', v)}
            options={allCountries.map((c) => ({ value: c, label: c }))}
            searchable
          />
        )}
        {allProxies.length > 1 && (
          <MultiSelectDropdown
            noun="proxy"
            values={proxyFilter}
            onChange={(v) => updateFilterParam('proxy', v)}
            options={allProxies.map((p) => ({ value: p, label: p }))}
            searchable
          />
        )}
        <MultiSelectDropdown
          noun="platform"
          values={platformFilter}
          onChange={setPlatformFilter}
          options={[
            { value: 'tp', label: 'TP' }, { value: 'ag', label: 'AG' }, { value: 'cg', label: 'CG' }, { value: 'wo', label: 'WO' },
          ]}
        />
```
Add the import: `import MultiSelectDropdown from '../components/MultiSelectDropdown';` and remove the now-unused `BrandFilterDropdown` import (`Overview.tsx:11`) — confirmed via this same search that Overview.tsx has no other use of it.

Update the "Clear" button's visibility condition immediately below (`Overview.tsx:631`):
```tsx
// Before:
        {(dateActive || countryFilter || proxyFilter || platformFilter !== 'all') && (
// After:
        {(dateActive || countryFilter.length > 0 || proxyFilter.length > 0 || platformFilter.length > 0) && (
```
Its `onClick` (`Overview.tsx:634-638`) needs no change at all — it already deletes the `country`/`proxy`/`platform` URL params directly (`['from', 'to', 'country', 'proxy', 'platform'].forEach((k) => next.delete(k))`), which clears an array-serialized param exactly the same way it cleared a single-value one.

Update the Platform Breakdown donut's visibility gate at `Overview.tsx:761` from `{platformFilter === 'all' && (` to `{platformFilter.length === 0 && (`.

- [ ] **Step 7: Run the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Manual smoke check**

Run: `npm run dev`, open Overview in the browser, sign in, and confirm: selecting 2 platforms shows a combined KPI figure larger than either alone; selecting 2 countries shows the OR-combined count; the Platform Breakdown donut hides once any platform is selected and reappears on "All platforms"; the "Clear" button resets all three; the URL updates to `?platform=tp,ag`-style params and survives a page reload.

- [ ] **Step 9: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts src/pages/Overview.tsx
git commit -m "feat: multi-select Country/Proxy/Platform filters on Overview"
```

---

### Task 4: BrandGroup.tsx — Brand, Agent, Proxy, Country, Status, Platform filters

**Files:**
- Modify: `src/pages/BrandGroup.tsx` (state ~592-619, storage type ~544-576, restore-on-load ~760-799, URL re-sync ~940-968, filter chain ~1296-1375, option lists ~351-366, render ~1857-1948)

**Interfaces:**
- Consumes: `readArrayParam`/`writeArrayParam`/`toArrayFilter` (Task 1), `MultiSelectDropdown`/`MultiSelectOption` (Task 2).
- Produces: no new exports — this task only changes BrandGroup's internal state shape and the JSX that renders it. `activePlatformForRating: Platform | null` (unchanged type, new derivation rule: `platformFilter.length === 1 ? platformFilter[0] : null`).

BrandGroup has no isolated unit-testable filter-chain module today (its filtering logic lives inline in the component body, not exported) and no component-render test infra exists in this repo — this task is verified via `npm run build` (type-level correctness) and a live browser smoke check, matching how every other BrandGroup filter feature in this project's history has shipped.

- [ ] **Step 1: Convert filter state to arrays**

Replace lines 592, 596-601, 617-619:
```ts
// Before:
  const [brandFilter, setBrandFilter] = useState('');
  ...
  const STATUS_FILTER_VALUES = ['live', 'removed', 'done', 'on-pause', 'pending', 'not-done'] as const;
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'removed' | 'done' | 'on-pause' | 'pending' | 'not-done'>(
    (STATUS_FILTER_VALUES.includes(searchParams.get('status') as typeof STATUS_FILTER_VALUES[number]) ? searchParams.get('status') as typeof STATUS_FILTER_VALUES[number] : 'all')
  );
  const [platformFilter, setPlatformFilter] = useState<'all' | 'tp' | 'ag' | 'cg' | 'wo'>(
    (['tp', 'ag', 'cg', 'wo'].includes(searchParams.get('platform') ?? '') ? searchParams.get('platform') as 'tp' | 'ag' | 'cg' | 'wo' : 'all')
  );
  ...
  const [agentFilter, setAgentFilter] = useState('');
  const [proxyFilter, setProxyFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');

// After:
  const [brandFilter, setBrandFilter] = useState<string[]>([]);
  ...
  const STATUS_FILTER_VALUES = ['live', 'removed', 'done', 'on-pause', 'pending', 'not-done'] as const;
  type StatusValue = typeof STATUS_FILTER_VALUES[number];
  const [statusFilter, setStatusFilter] = useState<StatusValue[]>(
    readArrayParam(searchParams, 'status').filter((s): s is StatusValue => STATUS_FILTER_VALUES.includes(s as StatusValue)),
  );
  const [platformFilter, setPlatformFilter] = useState<Platform[]>(
    readArrayParam(searchParams, 'platform').filter((p): p is Platform => ['tp', 'ag', 'cg', 'wo'].includes(p)),
  );
  ...
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [proxyFilter, setProxyFilter] = useState<string[]>([]);
  const [countryFilter, setCountryFilter] = useState<string[]>([]);
```
Add the import: `import { readArrayParam, writeArrayParam, toArrayFilter } from '../lib/filterParams';`

- [ ] **Step 2: Convert `StoredBrandFilters` and its read/write helpers**

Replace lines 544-576:
```ts
type StoredBrandFilters = {
  search: string;
  brandFilter: string[];
  agentFilter: string[];
  proxyFilter: string[];
  countryFilter: string[];
  statusFilter: string[];
  platformFilter: string[];
  ratingFilter: number | 'unrated' | 'any' | null;
  dateFrom: string;
  dateTo: string;
};

function filterStorageKey(tab: string) {
  return `bpf_filters_${tab}`;
}

// Legacy entries written before this filter went multi-select stored these
// six fields as bare strings — toArrayFilter reads either shape.
function readFiltersFromStorage(tab: string): Partial<StoredBrandFilters> {
  try {
    const raw = localStorage.getItem(filterStorageKey(tab));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      brandFilter: toArrayFilter(parsed.brandFilter),
      agentFilter: toArrayFilter(parsed.agentFilter),
      proxyFilter: toArrayFilter(parsed.proxyFilter),
      countryFilter: toArrayFilter(parsed.countryFilter),
      statusFilter: toArrayFilter(parsed.statusFilter),
      platformFilter: toArrayFilter(parsed.platformFilter),
    };
  } catch {
    return {};
  }
}

function writeFiltersToStorage(tab: string, filters: StoredBrandFilters) {
  try {
    localStorage.setItem(filterStorageKey(tab), JSON.stringify(filters));
  } catch {
    // storage unavailable/full — view just won't persist across navigation
  }
}
```

- [ ] **Step 3: Convert the restore-on-load effect**

Replace lines 773-792 (inside the tab-change effect):
```ts
      setSearch(saved.search ?? '');
      setBrandFilter(hasDeepLinkParams ? readArrayParam(searchParams, 'brand') : (saved.brandFilter ?? []));
      setStatusFilter(hasDeepLinkParams
        ? readArrayParam(searchParams, 'status').filter((s): s is StatusValue => STATUS_FILTER_VALUES.includes(s as StatusValue))
        : (saved.statusFilter ?? []).filter((s): s is StatusValue => STATUS_FILTER_VALUES.includes(s as StatusValue)));
      setPlatformFilter(hasDeepLinkParams
        ? readArrayParam(searchParams, 'platform').filter((p): p is Platform => ['tp', 'ag', 'cg', 'wo'].includes(p))
        : (saved.platformFilter ?? []).filter((p): p is Platform => ['tp', 'ag', 'cg', 'wo'].includes(p)));
      setRatingFilter(hasDeepLinkParams
        ? (() => {
            const raw = searchParams.get('rating');
            if (raw === 'unrated') return 'unrated';
            if (raw === 'any') return 'any';
            const r = Number(raw);
            return Number.isInteger(r) && r > 0 ? r : null;
          })()
        : (saved.ratingFilter ?? null));
      setAgentFilter(saved.agentFilter ?? []);
      setProxyFilter(saved.proxyFilter ?? []);
      setCountryFilter(hasDeepLinkParams ? readArrayParam(searchParams, 'country') : (saved.countryFilter ?? []));
```
(Rating stays single-value — untouched, out of scope per the spec.)

- [ ] **Step 4: Convert the URL re-sync effect**

Replace lines 953-958:
```ts
    setPlatformFilter(readArrayParam(searchParams, 'platform').filter((p): p is Platform => ['tp', 'ag', 'cg', 'wo'].includes(p)));
    setStatusFilter(readArrayParam(searchParams, 'status').filter((s): s is StatusValue => STATUS_FILTER_VALUES.includes(s as StatusValue)));
    setBrandFilter(readArrayParam(searchParams, 'brand'));
    setCountryFilter(readArrayParam(searchParams, 'country'));
```
(The `rating` block directly below, lines 959-967, is unchanged.)

- [ ] **Step 5: Convert the filter chain**

Replace lines 1296-1375:
```ts
  const brandFiltered = brandFilter.length > 0 && brandCol
    ? searchFiltered.filter((e) =>
        brandFilter.some((bf) => {
          const group = getBrandGroup(decodedTab, bf);
          return group ? group.some((v) => v.trim() === (e.data[brandCol] ?? '').trim()) : e.data[brandCol] === bf;
        }),
      )
    : searchFiltered;

  const agentFiltered = agentFilter.length > 0 && agentCol
    ? brandFiltered.filter((e) => agentFilter.includes(e.data[agentCol] ?? ''))
    : brandFiltered;

  const proxyFiltered = proxyFilter.length > 0
    ? agentFiltered.filter((e) => proxyFilter.some((pf) => canonicalProxyKey(e.data['Proxy Used'] ?? '') === canonicalProxyKey(pf)))
    : agentFiltered;

  const countryFiltered = countryFilter.length > 0
    ? proxyFiltered.filter((e) => countryFilter.some((cf) => canonicalCountryKey(resolveCountryLabel(e.data, decodedTab)) === canonicalCountryKey(cf)))
    : proxyFiltered;

  // Platform filter only affects visible columns, not row filtering.
  const platformFiltered = countryFiltered;

  const statusCols = headers.filter(isStatusCol);
  // Union of status columns across every selected platform, instead of one.
  const activeStatusCols = platformFilter.length === 0
    ? statusCols
    : statusCols.filter((h) => platformFilter.some((p) => (p === 'tp' ? TP_STATUS_VARIANTS.has(h) : h.toLowerCase() === PLATFORM_STATUS_COL[p].toLowerCase())));

  // Rating filter (arrives via Score Summary star-count/Total links) is only
  // meaningful paired with exactly one platform — a score value is only
  // comparable within one platform's own scale/columns. Selecting 2+
  // platforms silently stops applying whatever rating deep-link was active,
  // the same "don't merge across platforms" rule Score Summary's own star
  // histogram follows.
  const activePlatformForRating = platformFilter.length === 1 ? platformFilter[0] : null;
  const ratingFiltered = (() => {
    if (ratingFilter == null || !activePlatformForRating) return platformFiltered;
    const maxScore = PLATFORM_MAX_SCORE[activePlatformForRating];
    const candidates = PLATFORM_SCORE_COLS[activePlatformForRating];
    return platformFiltered.filter((e) => {
      if (!activeStatusCols.some((h) => (e.data[h] ?? '').trim().toLowerCase() === 'published')) return false;
      if (ratingFilter === 'any') return true;
      const raw = candidates.map((c) => e.data[c]).find((v) => v != null && v !== '');
      const score = parseScore(raw, maxScore);
      return ratingFilter === 'unrated' ? score == null : score === ratingFilter;
    });
  })();

  const dateActive = !!(dateFrom || dateTo);
  const relevantPlatforms = platformFilter.length > 0 ? platformFilter : getTabPlatforms(decodedTab);

  function matchesOneStatus(status: StatusValue, v: string): boolean {
    if (status === 'live') return isLive(v);
    if (status === 'removed') return isRemoved(v);
    if (status === 'done') return isDone(v);
    if (status === 'on-pause') return isOnPause(v);
    if (status === 'pending') return isPending(v);
    return isNotDone(v);
  }

  // A row matches if ANY relevant platform's own status+date state satisfies
  // the current filters — status and date are checked against the SAME
  // platform, not independently. Multi-select only widens WHICH platforms
  // and WHICH statuses are checked; the per-platform coupling itself is
  // unchanged from the single-select version.
  function matchesPlatform(e: { data: Record<string, string | null> }, platform: Platform): boolean {
    if (dateActive && !passesPlatformDateFilter(e.data, platform, dateFrom, dateTo)) return false;
    if (statusFilter.length === 0) return true;
    if (brandCol && isPlatformRemoved(e.data[brandCol], platform)) return false;
    const col = platformStatusCol(headers, platform);
    if (!col) return false;
    const v = (e.data[col] ?? '').toLowerCase();
    return statusFilter.some((sf) => matchesOneStatus(sf, v));
  }

  const filtered = ratingFiltered.filter((e) => relevantPlatforms.some((p) => matchesPlatform(e, p)));
```
`displayKpis` (starting the line immediately after `filtered`) is unchanged — it already computes every platform's own cards unconditionally, independent of `platformFilter`.

- [ ] **Step 6: Convert the option lists and add the missing `wo` entry**

Replace lines 351-366:
```ts
const STATUS_MULTI_OPTS: MultiSelectOption[] = [
  { value: 'live',     label: 'Live', dot: 'bg-green-500' },
  { value: 'done',     label: 'Done', dot: 'bg-blue-500' },
  { value: 'removed',  label: 'Removed', dot: 'bg-rose-500' },
  { value: 'on-pause', label: 'On Pause', dot: 'bg-slate-500' },
  { value: 'pending',  label: 'Pending', dot: 'bg-amber-400' },
  { value: 'not-done', label: 'Not Done', dot: 'bg-orange-500' },
];

const PLATFORM_MULTI_OPTS: MultiSelectOption[] = [
  { value: 'tp', label: 'Trust Pilot', dot: 'bg-blue-500' },
  { value: 'ag', label: 'Ask Gambler', dot: 'bg-amber-500' },
  { value: 'cg', label: 'Casino Guru', dot: 'bg-violet-500' },
  { value: 'wo', label: 'Wizard of Odds', dot: 'bg-emerald-500' },
];
```
(These replace the old `STATUS_OPTS`/`PLATFORM_OPTS`/`FilterDropdown<T>`/`FilterOpt<T>` — delete the now-unused `FilterDropdown` function, `FilterOpt<T>` type, and old `STATUS_OPTS`/`PLATFORM_OPTS` constants at lines 301-366. `wo` was missing from the old `PLATFORM_OPTS` — this fixes a pre-existing gap where a WO-tracking multi-platform tab could never select WO from this particular dropdown, discovered while porting this exact array.)
Add the import: `import MultiSelectDropdown, { type MultiSelectOption } from '../components/MultiSelectDropdown';`

- [ ] **Step 7: Convert the render — filter dropdowns**

Replace lines 1887-1948:
```tsx
          {uniqueBrands.length > 1 && !NO_BRAND_FILTER_TABS.has(decodedTab) && (
            <MultiSelectDropdown
              noun="brand"
              values={brandFilter}
              onChange={(v) => {
                setBrandFilter(v);
                setSearchParams((prev) => {
                  const params = new URLSearchParams(prev);
                  writeArrayParam(params, 'brand', v);
                  return params;
                });
                setPage(1);
              }}
              options={uniqueBrands.map((b) => ({ value: b, label: b }))}
              searchable
            />
          )}
          {uniqueAgents.length > 1 && (
            <MultiSelectDropdown
              noun="agent"
              values={agentFilter}
              onChange={(v) => { setAgentFilter(v); setPage(1); }}
              options={uniqueAgents.map((a) => ({ value: a, label: a }))}
            />
          )}
          {uniqueProxies.length > 1 && (
            <MultiSelectDropdown
              noun="proxy"
              values={proxyFilter}
              onChange={(v) => { setProxyFilter(v); setPage(1); }}
              options={uniqueProxies.map((p) => ({ value: p, label: p }))}
            />
          )}
          {uniqueCountries.length > 1 && (
            <MultiSelectDropdown
              noun="country"
              values={countryFilter}
              onChange={(v) => { setCountryFilter(v); setPage(1); }}
              options={uniqueCountries.map((c) => ({ value: c, label: c }))}
              searchable
            />
          )}
          <MultiSelectDropdown
            noun="status"
            values={statusFilter}
            onChange={(v) => { setStatusFilter(v as StatusValue[]); setPage(1); }}
            options={STATUS_MULTI_OPTS}
          />
          {activePlatforms.length > 1 && (
            <MultiSelectDropdown
              noun="platform"
              values={platformFilter}
              onChange={(v) => {
                setPlatformFilter(v as Platform[]);
                setSearchParams((prev) => {
                  const params = new URLSearchParams(prev);
                  writeArrayParam(params, 'platform', v);
                  return params;
                });
                setPage(1);
              }}
              options={PLATFORM_MULTI_OPTS.filter((o) => (activePlatforms as string[]).includes(o.value))}
            />
          )}
```

- [ ] **Step 8: Update the compound "Filtered by" badge and its clear handler**

Find the badge and its "result count" gate a few lines above it (originally reading `search || brandFilter || statusFilter !== 'all' || platformFilter !== 'all'` and `brandFilter || ratingFilter != null`):
```tsx
// Before:
          {!loading && (search || brandFilter || statusFilter !== 'all' || platformFilter !== 'all') && (
// After:
          {!loading && (search || brandFilter.length > 0 || statusFilter.length > 0 || platformFilter.length > 0) && (
```
```tsx
// Before:
          {(brandFilter || ratingFilter != null) && (
            <div className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 whitespace-nowrap">
              <span>
                Filtered by:
                {brandFilter ? ` ${brandFilter}` : ''}
                {platformFilter !== 'all' ? ` · ${platformFilter.toUpperCase()}` : ''}
                {ratingFilter != null ? ` · ${ratingFilter === 'unrated' ? 'Rating Unrated' : ratingFilter === 'any' ? 'Published' : `Rating ${ratingFilter}`}` : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  setBrandFilter('');
                  setRatingFilter(null);
                  setPlatformFilter('all');
                  setSearchParams({});
                  setPage(1);
                }}
                className="text-blue-500 hover:text-blue-700 transition-colors"
                aria-label="Clear brand/rating filter"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
// After:
          {(brandFilter.length > 0 || ratingFilter != null) && (
            <div className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 whitespace-nowrap">
              <span>
                Filtered by:
                {brandFilter.length > 0 ? ` ${brandFilter.join(', ')}` : ''}
                {platformFilter.length > 0 ? ` · ${platformFilter.map((p) => p.toUpperCase()).join('+')}` : ''}
                {ratingFilter != null ? ` · ${ratingFilter === 'unrated' ? 'Rating Unrated' : ratingFilter === 'any' ? 'Published' : `Rating ${ratingFilter}`}` : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  setBrandFilter([]);
                  setRatingFilter(null);
                  setPlatformFilter([]);
                  setSearchParams({});
                  setPage(1);
                }}
                className="text-blue-500 hover:text-blue-700 transition-colors"
                aria-label="Clear brand/rating filter"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
```

- [ ] **Step 9: Run the build**

Run: `npm run build`
Expected: PASS — this is the primary correctness gate for this task; fix any remaining type errors by searching the file for `platformFilter`, `statusFilter`, `brandFilter`, `agentFilter`, `proxyFilter`, `countryFilter` and confirming every remaining usage treats them as arrays (there may be a handful of other read sites this plan's research didn't enumerate, e.g. the status-check scope payload construction — check each one the compiler flags).

- [ ] **Step 10: Manual smoke check**

Run: `npm run dev`, open a multi-platform tab (e.g. Rooster Partners) in the browser. Confirm: selecting 2 statuses shows their OR-combined rows; selecting 2 platforms shows the union of both platforms' status columns and combined per-platform cards continue to show every platform's own numbers unconditionally; selecting exactly 1 platform plus a Score-Summary-deep-linked rating still filters by that rating, and selecting a 2nd platform on top of it silently drops the rating filter; a saved multi-select view survives navigating away and back and a full page reload; the "Filtered by" badge and its clear button work with 2+ selected brands/platforms.

- [ ] **Step 11: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: multi-select Brand/Agent/Proxy/Country/Status/Platform filters on Brand Tabs"
```

---

### Task 5: ScoreSummaryPanel.tsx + scoreSummary.ts — Platform, Tab filters and combined-total math

**Files:**
- Modify: `src/lib/scoreSummary.ts:246-353,380-460` (`computeScoreSummary`, `computeSuccessRates`, `computeTabSuccessRates`)
- Modify: `src/lib/scoreSummary.test.ts` (existing single-platform calls become one-item arrays; new multi-platform cases)
- Modify: `src/components/ScoreSummaryPanel.tsx` (state ~129-227, `PLATFORM_OPTS`/`TabFilterDropdown` render ~83-88,299-390, `GroupedSummary`/`SummaryTable`/`SummaryColgroup` ~419-620)

**Interfaces:**
- Consumes: `readArrayParam`/`writeArrayParam` (Task 1), `MultiSelectDropdown` (Task 2).
- Produces: `computeScoreSummary(entries, range, pinnedFirst, platforms: Platform[], removedPlatformBrands)` returning `ScoreSummaryResult & { showStars: boolean }`; `computeSuccessRates(entries, platforms: Platform[], removedPlatformBrands, range)`; `computeTabSuccessRates(entries, platforms: Platform[], removedPlatformBrands, range)`. All three default `platforms` to `['tp']` (not `[]`) to preserve today's TP-default behavior when nothing is passed at all — see Step 5's note on why this filter's "untouched" default differs from every other filter's empty-array default.

- [ ] **Step 1: Update `computeScoreSummary`'s existing tests to pass arrays**

In `src/lib/scoreSummary.test.ts`, every call passing a bare `platform` (5th argument to `computeScoreSummary`, 2nd to `computeSuccessRates`/`computeTabSuccessRates`) wraps it in a one-item array, e.g. `'tp'` → `['tp']`, `'ag'` → `['ag']`. Apply this to every call site in the file (there is no other shape to preserve — a single-platform call today is semantically "exactly this one platform selected," which stays true as a one-item array).

- [ ] **Step 2: Update `computeScoreSummary`**

Replace lines 246-353:
```ts
export interface ScoreSummaryResult {
  brands: BrandSummary[];
  excludedRows: number;
  showStars: boolean;
}

export function computeScoreSummary(
  entries: Entry[],
  range: DateRange,
  pinnedFirst: string[] = [],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
): ScoreSummaryResult {
  const fromBound = range.from ? startOfDay(range.from) : null;
  const toBound = range.to ? endOfDay(range.to) : null;

  // Empty selection means "all 4 platforms combined" (same convention as
  // every other filter); the ['tp'] default above only applies when the
  // caller passes nothing at all, preserving today's initial-load behavior.
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  // The star-rating histogram is scale- and column-dependent per platform
  // (TP is 1-5, AG is 1-10; even same-scale platforms have independent
  // review-text columns) — it only ever renders for exactly one platform.
  const showStars = resolved.length === 1;
  const soleStatusKeys = showStars ? PLATFORM_STATUS_KEYS[resolved[0]] : null;
  const soleDateKeys = showStars ? PLATFORM_DATE_KEYS[resolved[0]] : null;
  const soleScoreKeys = showStars ? PLATFORM_SCORE_KEYS[resolved[0]] : null;
  const maxScore = showStars ? PLATFORM_MAX_SCORE[resolved[0]] : 0;

  interface Bucket {
    tab: string;
    brand: string;
    counts: Record<Star, number>;
    unrated: number;
  }

  function emptyCounts(): Record<Star, number> {
    const counts: Record<Star, number> = {};
    for (let i = 1; i <= maxScore; i++) counts[i] = 0;
    return counts;
  }

  const buckets = new Map<string, Bucket>();
  let excludedRows = 0;
  const dateFilterActive = fromBound !== null || toBound !== null;

  for (const e of entries) {
    const d = e.data ?? {};

    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    const tab = e.tab ?? '';

    if (showStars) {
      // Single-platform path: unchanged from before this task, just reading
      // the one selected platform's keys instead of a bare `platform` param.
      if (removedPlatformBrands.has(platformRemovedKey(tab, brand, resolved[0]))) continue;

      const status = (pick(d, soleStatusKeys!) ?? '').trim().toLowerCase();
      if (!status) continue;

      const key = `${tab} ${brand}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tab, brand, counts: emptyCounts(), unrated: 0 };
        buckets.set(key, bucket);
      }

      if (status !== 'published') continue;

      const date = parsePostDate(pick(d, soleDateKeys!));

      if (dateFilterActive) {
        if (date == null) {
          excludedRows++;
          continue;
        }
        if (fromBound && date < fromBound) continue;
        if (toBound && date > toBound) continue;
      }

      const score = soleScoreKeys!.length > 0 ? parseScore(pick(d, soleScoreKeys!), maxScore) : null;
      if (score == null) {
        bucket.unrated += 1;
      } else {
        bucket.counts[score] += 1;
      }
    } else {
      // Multi-platform path: only the tab/brand bucket needs to exist (so the
      // brand list is complete) — no star counts are ever shown, so no
      // per-platform score/date processing runs here. A bucket exists if any
      // NON-flagged selected platform has any resolvable status at all,
      // mirroring the single-platform gate's "any resolvable status" rule.
      const hasAnyStatus = resolved.some((p) => {
        if (removedPlatformBrands.has(platformRemovedKey(tab, brand, p))) return false;
        return !!(pick(d, PLATFORM_STATUS_KEYS[p]) ?? '').trim();
      });
      if (!hasAnyStatus) continue;
      const key = `${tab} ${brand}`;
      if (!buckets.has(key)) buckets.set(key, { tab, brand, counts: {}, unrated: 0 });
    }
  }

  const summaries: BrandSummary[] = [...buckets.values()].map((b) => {
    const { total, rated, average, label } = summarizeCounts(b.counts, b.unrated, maxScore);
    return { tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated, total, rated, average, label };
  });

  const pinnedSet = new Set(pinnedFirst);
  summaries.sort((a, b) => {
    const aPinned = pinnedSet.has(a.brand);
    const bPinned = pinnedSet.has(b.brand);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (aPinned && bPinned) return pinnedFirst.indexOf(a.brand) - pinnedFirst.indexOf(b.brand);
    const byTab = a.tab.localeCompare(b.tab);
    if (byTab !== 0) return byTab;
    return a.brand.localeCompare(b.brand);
  });

  return { brands: summaries, excludedRows, showStars };
}
```
Note: `summarizeCounts(b.counts, b.unrated, maxScore)` when `!showStars` runs with `maxScore = 0` and empty `counts` — confirmed safe: its `for (let i = 1; i <= maxScore; i++)` loop (`scoreSummary.ts:186`) simply never executes when `maxScore` is 0, so it returns `{ total: 0, rated: 0, average: null, label: null }` with no division-by-zero or exception. These fields are unused by the renderer when `showStars` is false (Step 5 below), so this is a correct, inert result, not a workaround.

- [ ] **Step 3: Update `computeSuccessRates` and `computeTabSuccessRates`**

Replace lines 380-423:
```ts
export function computeSuccessRates(
  entries: Entry[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  range: DateRange = { from: null, to: null },
): Map<string, SuccessRate> {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  const fromBound = range.from ? startOfDay(range.from) : null;
  const toBound = range.to ? endOfDay(range.to) : null;
  const buckets = new Map<string, { live: number; removed: number }>();

  for (const e of entries) {
    const d = e.data ?? {};
    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;
    const tab = e.tab ?? '';

    // matchedAny tracks "does at least one selected, unflagged platform have
    // a non-blank, in-range status" — this is the bucket-existence gate,
    // matching the original single-platform function's "if (!status)
    // continue" (a bucket exists even for a status that's neither live nor
    // removed, e.g. "pending" — only matchedLive/matchedRemoved decide what
    // it increments). Getting this gate wrong silently drops such rows from
    // the result map entirely instead of leaving them at rate: null.
    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    for (const platform of resolved) {
      if (removedPlatformBrands.has(platformRemovedKey(tab, brand, platform))) continue;
      const status = (pick(d, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesDateFilter(d, PLATFORM_DATE_KEYS[platform], fromBound, toBound)) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
    }
    if (!matchedAny) continue;

    const key = `${tab} ${brand}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { live: 0, removed: 0 };
      buckets.set(key, bucket);
    }
    if (matchedLive) bucket.live += 1;
    else if (matchedRemoved) bucket.removed += 1;
  }

  const result = new Map<string, SuccessRate>();
  for (const [key, { live, removed }] of buckets) {
    const total = live + removed;
    result.set(key, { live, removed, rate: total === 0 ? null : (live / total) * 100 });
  }
  return result;
}
```

Replace lines 433-472 (`computeTabSuccessRates` — identical shape, bucketed by tab instead of `${tab} ${brand}`, and a blank brand doesn't skip the row since this function has no per-brand key):
```ts
export function computeTabSuccessRates(
  entries: Entry[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  range: DateRange = { from: null, to: null },
): Map<string, SuccessRate> {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  const fromBound = range.from ? startOfDay(range.from) : null;
  const toBound = range.to ? endOfDay(range.to) : null;
  const buckets = new Map<string, { live: number; removed: number }>();

  for (const e of entries) {
    const d = e.data ?? {};
    const tab = e.tab ?? '';
    const brand = (pick(d, BRAND_KEYS) ?? '').trim();

    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    for (const platform of resolved) {
      if (brand && removedPlatformBrands.has(platformRemovedKey(tab, brand, platform))) continue;
      const status = (pick(d, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesDateFilter(d, PLATFORM_DATE_KEYS[platform], fromBound, toBound)) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
    }
    if (!matchedAny) continue;

    let bucket = buckets.get(tab);
    if (!bucket) {
      bucket = { live: 0, removed: 0 };
      buckets.set(tab, bucket);
    }
    if (matchedLive) bucket.live += 1;
    else if (matchedRemoved) bucket.removed += 1;
  }

  const result = new Map<string, SuccessRate>();
  for (const [key, { live, removed }] of buckets) {
    const total = live + removed;
    result.set(key, { live, removed, rate: total === 0 ? null : (live / total) * 100 });
  }
  return result;
}
```

Both functions preserve exact single-platform behavior when `platforms` has one element — the per-platform gate order (removed-flag check → blank-status check → date-filter check) matches the original line-for-line, just moved inside a `for (const platform of resolved)` loop.

- [ ] **Step 4: Update `ScoreSummaryPanel.tsx`'s state, options, and math wiring**

Replace lines 83-97 (add multi-select variant of the options, keep the singular list for label lookups where still needed):
```ts
const PLATFORM_MULTI_OPTS: MultiSelectOption[] = [
  { value: 'tp', label: 'TrustPilot' },
  { value: 'ag', label: 'AskGamblers' },
  { value: 'cg', label: 'CasinoGuru' },
  { value: 'wo', label: 'Wizard of Odds' },
];
```
Add the import: `import MultiSelectDropdown, { type MultiSelectOption } from './MultiSelectDropdown';`

Replace the platform/tab state (lines 105-153):
```ts
type StoredScoreSummaryFilters = {
  platform: string[];
  from: string;
  to: string;
  tab: string[];
};
```
```ts
  // Empty platform selection here does NOT default to ['tp'] on every
  // render — it only falls back to ['tp'] when the URL param is entirely
  // absent (never touched). An explicit "?platform=none" sentinel
  // distinguishes "user cleared it to All/combined" from "untouched," since
  // this filter's real default is one specific platform (TP), unlike every
  // other filter here whose default already IS "All" (empty).
  const platformParam = searchParams.get('platform');
  const platform: Platform[] = platformParam == null
    ? ['tp']
    : platformParam === 'none'
      ? []
      : platformParam.split(',').filter((p): p is Platform => PLATFORM_VALUES.has(p));
  const fromIso = searchParams.get('from') ?? '';
  const toIso = searchParams.get('to') ?? '';
  const tabFilter = readArrayParam(searchParams, 'tab');

  function setParam(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }
  const setPlatform = (v: Platform[]) => setParam('platform', v.length === 0 ? 'none' : v.join(','));
  const setFromIso = (v: string) => setParam('from', v);
  const setToIso = (v: string) => setParam('to', v);
  const setTabFilter = (v: string[]) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    writeArrayParam(next, 'tab', v);
    return next;
  }, { replace: true });
```
Add the import: `import { readArrayParam, writeArrayParam, toArrayFilter } from '../lib/filterParams';`

Update `readFiltersFromStorage` (lines 112-119) to migrate legacy bare-string `platform`/`tab` values at the read boundary — every pre-existing localStorage entry has `platform` as a single string like `'tp'` (never an array, since this filter didn't exist as multi-select before) and `tab` the same:
```ts
function readFiltersFromStorage(): Partial<StoredScoreSummaryFilters> {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      platform: toArrayFilter(parsed.platform),
      tab: toArrayFilter(parsed.tab),
    };
  } catch {
    return {};
  }
}
```
Now the mount-restore effect (lines 161-178) can treat `saved.platform`/`saved.tab` as already-arrays with no inline migration:
```ts
      if (saved.platform && saved.platform.length > 0 && !(saved.platform.length === 1 && saved.platform[0] === 'tp')) {
        next.set('platform', saved.platform.join(','));
      } else next.delete('platform');
      ...
      if (saved.tab && saved.tab.length > 0) next.set('tab', saved.tab.join(',')); else next.delete('tab');
```
And the save effect (lines 185-191) writes the array shape directly — no change needed to its own body beyond the type change already applied to `StoredScoreSummaryFilters`:
```ts
    writeFiltersToStorage({ platform, from: fromIso, to: toIso, tab: tabFilter });
```

Update the memoized computations (lines 199-227):
```ts
  const result = useMemo(
    () => computeScoreSummary(entries, range, [], platform, removedPlatformBrands),
    [entries, range, platform, removedPlatformBrands],
  );

  const successRates = useMemo(
    () => computeSuccessRates(entries, platform, removedPlatformBrands, range),
    [entries, platform, removedPlatformBrands, range],
  );

  const tabSuccessRates = useMemo(
    () => computeTabSuccessRates(entries, platform, removedPlatformBrands, range),
    [entries, platform, removedPlatformBrands, range],
  );

  const maxScore = result.showStars ? PLATFORM_MAX_SCORE[platform[0]] : 0;

  const filteredBrands = useMemo(
    () => (tabFilter.length > 0 ? result.brands.filter((b) => tabFilter.includes(b.tab)) : result.brands),
    [result.brands, tabFilter],
  );
```

Replace the header label (line 237) and the "no results" copy (lines 280-282):
```tsx
          <span className="text-xs text-slate-400">
            {platform.length === 0 ? 'All platforms (combined)' : platform.length === 1 ? PLATFORM_MULTI_OPTS.find((o) => o.value === platform[0])?.label : `${platform.length} platforms (combined)`} · Published reviews
            {totalAcrossBrands > 0 ? ` · ${totalAcrossBrands.toLocaleString()} total` : ''}
          </span>
```
```tsx
                : `No published reviews for ${tabFilter.length > 0 ? tabFilter.join(', ') : 'this filter'} in this range.`}
```

Replace the `PlatformFilter`/`TabFilterDropdown` render (lines 256,275):
```tsx
            <MultiSelectDropdown noun="platform" values={platform} onChange={setPlatform} options={PLATFORM_MULTI_OPTS} />
            ...
            <MultiSelectDropdown noun="brand-tab" values={tabFilter} onChange={setTabFilter} options={tabOptions.map((t) => ({ value: t, label: tabDisplayName(t) }))} searchable />
```
Delete the now-unused `PlatformFilter`/`TabFilterDropdown` functions (lines 299-390).

- [ ] **Step 5: Hide the star-rating columns when `showStars` is false**

`GroupedSummary`/`SummaryTable`/`SummaryColgroup` all take `platform: Platform` and `maxScore: number` — change their prop types to `platforms: Platform[]` and `showStars: boolean` (in place of relying on `maxScore === 0` implicitly), threaded from `ScoreSummaryPanel`'s render call:
```tsx
<GroupedSummary rows={filteredBrands} maxScore={maxScore} showStars={result.showStars} platform={platform} successRates={successRates} tabSuccessRates={tabSuccessRates} dateRangeActive={range.from != null || range.to != null} />
```
In `SummaryColgroup` (`ScoreSummaryPanel.tsx:506+`), guard the star-column width math and the `<colgroup>`'s star-count-dependent columns behind `showStars` — when false, give the Star Rating group `0%` width and skip rendering its `<col>` entries entirely (mirroring how `showGroup` already conditionally renders/skips the tab-group `<col>`).
In `SummaryTable` (`ScoreSummaryPanel.tsx:532+`), wrap the `<th colSpan={stars.length + 2} ...>Star Rating</th>` header cell, its second header row's `stars.map(...)`/`Unrtd`/Star-Rating-group `Total` cells, and each row's corresponding `<td>` cells (the `stars.map((s) => ...)`, `r.unrated`, and Star-Rating-group `r.total` blocks inside the `rows.map` loop) in `{showStars && (...)}`. The Success-Rate column group (Published/Removed/Total/SR %) and its per-row cells are unaffected — they already come from `successRates`/`tabSuccessRates`, computed independently of `showStars`.
Every `platform` string interpolated into a `Link to=".../brands/...?platform=${platform}&..."` inside `SummaryTable` (the Brand-name link, and — now dead when `!showStars` since their parent block is skipped — the star/rating links) becomes `${platform.join(',')}`, so the deep link into BrandGroup's own now-multi-select platform filter carries every selected platform, not just a truncated single value.

- [ ] **Step 6: Add new multi-platform tests**

Append to `src/lib/scoreSummary.test.ts`:
```ts
describe('computeScoreSummary multi-platform', () => {
  it('showStars is true for exactly one platform and false for 2+', () => {
    const one = computeScoreSummary([], { from: null, to: null }, [], ['tp']);
    const two = computeScoreSummary([], { from: null, to: null }, [], ['tp', 'ag']);
    expect(one.showStars).toBe(true);
    expect(two.showStars).toBe(false);
  });

  it('an empty platforms array behaves as all 4 combined (bucket exists if any platform has a status)', () => {
    const entries = [{ tab: 'X', data: { Brands: 'B1', 'AG Review Status': 'Published' } }] as unknown as Entry[];
    const result = computeScoreSummary(entries, { from: null, to: null }, [], []);
    expect(result.brands.map((b) => b.brand)).toEqual(['B1']);
    expect(result.showStars).toBe(false);
  });

  it('omitting platforms entirely defaults to TP only, preserving today\'s default (regression lock)', () => {
    const entries = [{ tab: 'X', data: { Brands: 'B1', 'TP Review Status': 'Published' } }] as unknown as Entry[];
    const withDefault = computeScoreSummary(entries, { from: null, to: null });
    const explicitTp = computeScoreSummary(entries, { from: null, to: null }, [], ['tp']);
    expect(withDefault).toEqual(explicitTp);
  });
});
```
(`Brands` and `'TP Review Status'`/`'AG Review Status'` are `BRAND_KEYS[0]`/`PLATFORM_STATUS_KEYS.tp[0]`/`PLATFORM_STATUS_KEYS.ag[0]` respectively, per `scoreSummary.ts:63-70` — real keys, not placeholders.)

- [ ] **Step 7: Run tests and build**

Run: `npm test -- src/lib/scoreSummary.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Manual smoke check**

Run: `npm run dev`, open Score Summary. Confirm: default load (bare `/score-summary`) still shows TP; selecting a 2nd platform hides the Star Rating column group and shows a combined Live/Removed/Success-Rate; clearing back to one platform restores the histogram; multi-selecting 2 brand-tabs shows both tabs' groups; the URL round-trips (`?platform=tp,ag`, `?platform=none` for explicit all-combined, `?tab=...,...`) through a page reload.

- [ ] **Step 9: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts src/components/ScoreSummaryPanel.tsx
git commit -m "feat: multi-select Platform/Tab filters on Score Summary, hide star histogram on 2+ platforms"
```

---

### Task 6: Ask AI (`ai-assistant` Edge Function) — multi-platform tool parity

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts:477-492,514-532,652+,668+`
- Modify: `supabase/functions/ai-assistant/tools_test.ts` (existing single-platform test calls; new multi-platform cases)

**Interfaces:**
- Consumes: nothing from Tasks 1-5 (this is a separate Deno runtime; it does not import frontend `src/` code).
- Produces: `get_score_summary`/`get_success_rate_by_field` tool schemas with `platform: { type: 'array', items: { type: 'string', enum: ['tp','ag','cg','wo'] } }` instead of a bare string enum.

- [ ] **Step 1: Update the tool schemas**

In `supabase/functions/ai-assistant/tools.ts`, find both occurrences of `platform: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }` (lines 489, 529) and replace each with:
```ts
platform: { type: 'array', items: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }, description: 'One or more platforms. Omit or pass all 4 for a combined total across every platform (OR semantics — a brand counts as live if ANY listed platform says so, not an intersection).' },
```
Update both tool descriptions (`tools.ts:478-491,514-531`, the text immediately preceding each `parameters` block) to state the combined-total semantics explicitly, e.g. append: `"Passing multiple platforms combines their live/removed counts into one total, the same OR-across-platforms rule the dashboard's own multi-select filters use — it does not average or intersect them."`

- [ ] **Step 2: Update `successRateByField` and `scoreSummary` (the local ported computation functions), then their handlers**

`get_score_summary`/`get_success_rate_by_field` (`tools.ts:652,668`) don't do their own row-scanning — they call two local functions defined earlier in the same file, `scoreSummary` (`tools.ts:334-390ish`) and `successRateByField` (`tools.ts:284-314`), each of which takes a single `platform: Platform = 'tp'`. Update both the same way Task 5 updated their frontend counterparts (`computeSuccessRates`/`computeScoreSummary`).

Replace `successRateByField` (`tools.ts:284-314`):
```ts
export function successRateByField(
  entries: EntryRow[],
  field: 'proxy' | 'agent' | 'country',
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
): FieldSuccessRate[] {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  const fieldKeys = FIELD_KEYS[field];
  const buckets = new Map<string, { live: number; removed: number }>();
  for (const e of entries) {
    const value = (pick(e.data, fieldKeys) ?? '').trim();
    if (!value) continue;
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();

    // matchedAny mirrors the frontend's computeSuccessRates gate (Task 5) —
    // a bucket exists for any non-blank status, not only a live/removed one.
    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    for (const platform of resolved) {
      if (brand && removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
    }
    if (!matchedAny) continue;

    let b = buckets.get(value);
    if (!b) {
      b = { live: 0, removed: 0 };
      buckets.set(value, b);
    }
    if (matchedLive) b.live += 1;
    else if (matchedRemoved) b.removed += 1;
  }
  return [...buckets.entries()]
    .map(([value, { live, removed }]) => {
      const total = live + removed;
      return { value, live, removed, total, rate: total === 0 ? null : (live / total) * 100 };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}
```

Replace `scoreSummary` (`tools.ts:334` through its closing brace — re-read the full function body first since this plan's research only confirmed lines 334-376; the return-mapping tail after line 376 is unchanged and must be preserved as-is):
```ts
export function scoreSummary(
  entries: EntryRow[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
): BrandScoreSummary[] {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  // Same rule as computeScoreSummary (Task 5): the star/score breakdown only
  // ever applies for exactly one platform — 2+ platforms still combine
  // live/removed but report zeroed counts/unrated (the caller should treat
  // a >1-length platforms array as "combined totals only, no star detail").
  const showStars = resolved.length === 1;
  const maxScore = showStars ? PLATFORM_MAX_SCORE[resolved[0]] : 0;

  interface Bucket {
    tab: string;
    brand: string;
    counts: Record<number, number>;
    unrated: number;
    live: number;
    removed: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    let solePublished = false;
    for (const platform of resolved) {
      if (removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
      if (showStars && status === 'published') solePublished = true;
    }
    if (!matchedAny) continue;

    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      const counts: Record<number, number> = {};
      for (let i = 1; i <= maxScore; i++) counts[i] = 0;
      b = { tab: e.tab, brand, counts, unrated: 0, live: 0, removed: 0 };
      buckets.set(key, b);
    }

    if (matchedLive) b.live += 1;
    else if (matchedRemoved) b.removed += 1;

    if (showStars && solePublished) {
      const score = parseScore(pick(e.data, PLATFORM_SCORE_KEYS[resolved[0]]), maxScore);
      if (score == null) b.unrated += 1;
      else b.counts[score] += 1;
    }
  }

  return [...buckets.values()].map((b) => {
    let rated = 0;
    let weighted = 0;
    for (let i = 1; i <= maxScore; i++) {
      rated += b.counts[i];
      weighted += i * b.counts[i];
    }
    const publishedTotal = rated + b.unrated;
    const average = rated === 0 ? null : Math.round((weighted / rated) * 10) / 10;
    const label = ratingLabel(average, maxScore);
    const successTotal = b.live + b.removed;
    const successRate = successTotal === 0 ? null : (b.live / successTotal) * 100;
    return {
      tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated,
      publishedTotal, rated, average, label, live: b.live, removed: b.removed, successRate,
    };
  });
}
```
(This closing tail — lines 378-395 of the current file — is copied unchanged from today's `scoreSummary`; it only reads `maxScore`, which is still a correctly-scoped `const` above, and never references `platform` directly.)

Now update the two handlers (`tools.ts:652-660,668-676`):
```ts
  if (name === 'get_score_summary') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, removedSet] = await Promise.all([q, fetchRemovedPlatformBrandSet(supabase)]);
    if (error) throw error;
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    const platforms: Platform[] = Array.isArray(args?.platform)
      ? args.platform.filter((p: string): p is Platform => validPlatforms.includes(p as Platform))
      : ['tp'];
    return { brands: scoreSummary(data ?? [], platforms, removedSet) };
  }
```
```ts
  if (name === 'get_success_rate_by_field') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, removedSet] = await Promise.all([q, fetchRemovedPlatformBrandSet(supabase)]);
    if (error) throw error;
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    const platforms: Platform[] = Array.isArray(args?.platform)
      ? args.platform.filter((p: string): p is Platform => validPlatforms.includes(p as Platform))
      : ['tp'];
    return { results: successRateByField(data ?? [], args?.field, platforms, removedSet) };
  }
```

- [ ] **Step 3: Update existing tests and add multi-platform cases**

In `tools_test.ts`, every existing call to the exported `scoreSummary`/`successRateByField` functions passes a bare platform string as a positional argument (e.g. `scoreSummary(cgEntries, 'cg')` at line 331, `successRateByField(entries, 'proxy', 'tp', removedSet)` at line 425, `successRateByField(entries, 'agent', 'ag', removedSet)` at line 458) — wrap each in a one-item array: `scoreSummary(cgEntries, ['cg'])`, `successRateByField(entries, 'proxy', ['tp'], removedSet)`, `successRateByField(entries, 'agent', ['ag'], removedSet)`. Calls that go through `runTool(...)` with `{ platform: 'not-a-real-platform' }` (lines 321, 470) stay as bare strings in the `args` object — `runTool`'s `args.platform` is arbitrary caller input, not a typed parameter, and this plan's Task 6 Step 2 handler update already treats a non-array `args.platform` as "use the default" via `Array.isArray(args?.platform)`, so these two tests keep asserting the same fallback-to-tp behavior with no code change.

Add, using this file's existing `mockSupabaseTables`/`runTool`/`EntryRow` fixture helpers (matching the exact pattern of the `get_score_summary end-to-end excludes a removed-flagged brand` test at line 405 and the `successRateByField` tests at lines 420-425):
```ts
Deno.test('get_score_summary with 2 platforms combines their live/removed counts, hides star detail', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'TP Review Status': 'Removed', 'CG Review Status': 'Published', 'CG Score added': '4' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', { platform: ['tp', 'cg'] });
  assertEquals(result.brands.length, 1);
  // TP Removed + CG Published/live on the same brand: live wins (matches
  // computeTabKpisFromEntries' and computeScoreSummary's live-checked-before-removed
  // tie-break), and star counts are zeroed since 2 platforms are selected.
  assertEquals(result.brands[0].live, 1);
  assertEquals(result.brands[0].removed, 0);
  assertEquals(result.brands[0].rated, 0);
});

Deno.test('successRateByField with 2 platforms combines a value\'s live/removed across both', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Proxy Used': 'Enigma', 'TP Review Status': 'Removed', 'AG Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'proxy', ['tp', 'ag']);
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 1);
  assertEquals(enigma.removed, 0);
});

Deno.test('get_score_summary/get_success_rate_by_field with platform omitted still default to tp only (regression lock)', async () => {
  const tables = {
    entries: [{ id: '1', tab: 't', data: { Brand: 'C', 'TP Review Status': 'Published', 'Score added': '3' } }],
    removed_platform_brands: [],
  };
  const withArray: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', { platform: ['tp'] });
  const omitted: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', {});
  assertEquals(omitted, withArray);
});
```

- [ ] **Step 4: Run the Deno test suite**

Run: `deno test supabase/functions/ai-assistant/`
Expected: PASS.

Run: `deno check supabase/functions/ai-assistant/tools.ts`
Expected: PASS (clean type-check, per this project's standing convention for Edge Function changes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: multi-platform support for get_score_summary/get_success_rate_by_field"
```

Note: per this repo's established workflow for Edge Function changes, `supabase functions deploy ai-assistant` is a deliberate, separate step requiring explicit confirmation against production — do not deploy as part of this task; leave it pending like every other recent Edge Function change in this project's history.

---

### Task 7: Final whole-branch review

**Files:** none created — this task only reads and cross-checks Tasks 1-6's combined diff.

Per this project's standing cross-dashboard-consistency requirement (`CLAUDE.md`), a per-task review isn't sufficient on its own for this kind of change — the same "OR across selected platforms, AND across filters" rule now has three independent implementations (`queries.ts`, `BrandGroup.tsx`, `scoreSummary.ts`) plus a fourth ported copy (`ai-assistant/tools.ts`), which is exactly the shape of this project's prior real bugs (Task 180 in particular, and the very PMS task description that started this: "etc." filters added later must follow the same pattern).

- [ ] **Step 1: Re-read all 4 combined-total implementations side by side**

Read the final diffs of `computeTabKpisFromEntries`'s `statuses` array (Task 3), `BrandGroup.tsx`'s `matchesPlatform`/`activeStatusCols`/`relevantPlatforms` (Task 4), `computeScoreSummary`'s multi-platform branch plus `computeSuccessRates`/`computeTabSuccessRates` (Task 5), and `ai-assistant/tools.ts`'s handlers (Task 6). Confirm all four apply the identical rule: a row/bucket counts as live/removed if ANY selected platform's own status+date (not a different platform's) says so, and an omitted/empty selection means "no filter" everywhere except `ScoreSummaryPanel`'s platform filter specifically, whose no-param default is intentionally `['tp']` (documented in Task 5) rather than "all."

- [ ] **Step 2: Confirm the one intentional asymmetry is actually isolated**

Verify `ScoreSummaryPanel`'s `['tp']`-default-on-omitted-param behavior (Task 5) has no bleed-through into `BrandGroup.tsx` or `Overview.tsx`'s own platform filters (both of which correctly default to `[]`/"All") — grep the final diff for any shared constant or helper that might have accidentally unified these two different defaults into one.

- [ ] **Step 3: Run the full test suite and build**

Run: `npm test`
Expected: PASS, full suite (baseline count + this plan's new tests across Tasks 1, 3, 5).

Run: `npm run build`
Expected: PASS.

Run: `deno check supabase/functions/ai-assistant/tools.ts` and `deno test supabase/functions/ai-assistant/`
Expected: PASS.

- [ ] **Step 4: Live cross-surface consistency check**

In the browser against real Supabase data: pick one tab that appears on both Overview and Score Summary and has 2+ tracked platforms (e.g. Rooster Partners). Select the same 2 platforms on Overview and on that tab's Score Summary view, with the same date range. Confirm the combined Live/Removed totals agree between the two surfaces for that tab — this is the actual regression this task exists to prevent, and it can only be checked live, not by unit tests alone (each surface's tests confirm its own internal correctness, not that the two surfaces agree with each other on the same real data).

- [ ] **Step 5: Update `docs/task-history.md`**

Append a new `## Task <N>: Multi-Select Dashboard Filters` entry (check the current highest task number in that file first) summarizing what shipped, per this project's standing PMS-sync rule — the Stop hook picks this up automatically, no manual PMS API calls needed.

- [ ] **Step 6: Commit**

```bash
git add docs/task-history.md
git commit -m "docs: record multi-select dashboard filters task"
```
