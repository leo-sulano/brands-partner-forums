# Tab Display Rename (FTP / BITP) + Per-Brand Success Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display "TP Affiliate" as "FTP" and "TP Brand Injection" as "BITP" everywhere a user sees them, without touching the underlying tab identifier; and add a per-brand "Success Rate" percentage column to the Score Summary page.

**Architecture:** A single `tabDisplayName()` lookup helper in `src/lib/tabs.ts` maps the two renamed tabs to their new labels (identity for every other tab). It's applied at every UI call site that currently renders a raw tab string — the canonical string itself (DB `tab` column, URL slugs, `OPERATIONAL_TABS`, `tab-configs.ts` keys, `localStorage` keys) is untouched everywhere. Separately, a new `computeSuccessRates()` function in `src/lib/scoreSummary.ts` classifies every entry (not just Published ones, unlike the existing `computeScoreSummary`) into live/removed buckets per brand for the selected platform, and `ScoreSummaryPanel` renders the result as a new table column.

**Tech Stack:** React 19, TypeScript, Vite, Vitest (`src/lib/*.test.ts` only — no component test harness in this repo).

## Global Constraints

- Display-only rename: the DB `tab` column value, URL slugs (`/brands/tp-affiliate`, `/brands/tp-brand-injection`), `OPERATIONAL_TABS` entries, `tab-configs.ts` keys, `localStorage` sort-storage keys, the EC2 Python status-checker (`scripts/check_review_status.py` and friends), and Apps Script must all stay exactly `'TP Affiliate'` / `'TP Brand Injection'`. Only rendered text (`label`, `title`, text nodes) changes.
- Success Rate = `live / (live + removed) × 100`, per brand, per the currently-selected platform. Pending/Done/On-Pause/blank rows are excluded from the denominator entirely (not counted as failures).
- Success Rate does **not** apply the Score Summary page's date-range filter — it always reflects the brand's full history on the selected platform. It does respect the Platform selector and the Tab filter dropdown (the same `entries` array already scoped to those).
- This repo has no component test harness (`@testing-library/react` is not installed; `vitest` only covers pure functions in `src/lib/`). Verify component-level changes via `npm run build` (type-check) and manual browser checks — see `feedback_verify_with_npm_build` memory: `tsc --noEmit` alone checks nothing here, always use `npm run build`.

---

### Task 1: `tabDisplayName()` helper

**Files:**
- Modify: `src/lib/tabs.ts`
- Test: `src/lib/tabs.test.ts` (new file)

**Interfaces:**
- Produces: `export function tabDisplayName(tab: string): string` — later tasks import this from `../lib/tabs` and call it wherever a raw tab string is currently rendered.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tabDisplayName } from './tabs';

describe('tabDisplayName', () => {
  it('renames TP Affiliate to FTP', () => {
    expect(tabDisplayName('TP Affiliate')).toBe('FTP');
  });

  it('renames TP Brand Injection to BITP', () => {
    expect(tabDisplayName('TP Brand Injection')).toBe('BITP');
  });

  it('returns every other tab unchanged', () => {
    expect(tabDisplayName('Hanan')).toBe('Hanan');
    expect(tabDisplayName('Wizard of Odds')).toBe('Wizard of Odds');
    expect(tabDisplayName('GRG - Gulf Recovery Group')).toBe('GRG - Gulf Recovery Group');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tabs.test.ts`
Expected: FAIL — `tabDisplayName` is not exported from `./tabs`.

- [ ] **Step 3: Add the helper to `src/lib/tabs.ts`**

Append to the end of `src/lib/tabs.ts` (after the existing `isEditableHeader` function):

```ts
// Display-only rename: what a user reads on screen for these two tabs. The
// canonical identifier itself (DB `tab` column, URL slug, OPERATIONAL_TABS
// entry, tab-configs.ts keys) stays the original string everywhere else —
// this is purely a rendering lookup.
const TAB_DISPLAY_NAMES: Partial<Record<OperationalTab, string>> = {
  'TP Affiliate': 'FTP',
  'TP Brand Injection': 'BITP',
};

export function tabDisplayName(tab: string): string {
  return TAB_DISPLAY_NAMES[tab as OperationalTab] ?? tab;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tabs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabs.ts src/lib/tabs.test.ts
git commit -m "feat: add tabDisplayName helper for FTP/BITP display rename"
```

---

### Task 2: Apply `tabDisplayName()` at every render site

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Topbar.tsx`
- Modify: `src/pages/Overview.tsx`
- Modify: `src/components/BrandTabsModal.tsx`
- Modify: `src/components/AddReviewAccountModal.tsx`
- Modify: `src/components/EditEntryModal.tsx`
- Modify: `src/components/ScoreSummaryPanel.tsx`

**Interfaces:**
- Consumes: `tabDisplayName(tab: string): string` from Task 1.
- Produces: nothing new — purely swaps rendered text at existing call sites. No prop or function signature changes anywhere in this task.

- [ ] **Step 1: `src/components/Sidebar.tsx`**

Change the import (currently):

```ts
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
```

to:

```ts
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
```

Then change the nav item block (currently):

```tsx
              title={isCollapsed ? tab : undefined}
              className={({ isActive }) => linkClass(isActive, isCollapsed, true)}
            >
              <Icon className="size-4 shrink-0" />
              {!isCollapsed && <span className="truncate flex-1">{tab}</span>}
```

to:

```tsx
              title={isCollapsed ? tabDisplayName(tab) : undefined}
              className={({ isActive }) => linkClass(isActive, isCollapsed, true)}
            >
              <Icon className="size-4 shrink-0" />
              {!isCollapsed && <span className="truncate flex-1">{tabDisplayName(tab)}</span>}
```

- [ ] **Step 2: `src/components/Topbar.tsx`**

Change the import (currently):

```ts
import { slugToTab } from '../lib/tabs';
```

to:

```ts
import { slugToTab, tabDisplayName } from '../lib/tabs';
```

Then change the page-title branch (currently):

```tsx
  else if (pathname.startsWith('/brands/')) {
    const slug = pathname.slice('/brands/'.length);
    brandTab = slugToTab(slug) ?? decodeURIComponent(slug);
    title = brandTab;
  }
```

to:

```tsx
  else if (pathname.startsWith('/brands/')) {
    const slug = pathname.slice('/brands/'.length);
    brandTab = slugToTab(slug) ?? decodeURIComponent(slug);
    title = tabDisplayName(brandTab);
  }
```

`brandTab` itself stays the canonical string — it's still passed to `getTabPlatforms(brandTab)` on the next line unchanged.

- [ ] **Step 3: `src/pages/Overview.tsx`**

Change the import (currently):

```ts
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
```

to:

```ts
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
```

Then three display sites. First, in `TotalBreakdownModal` (around line 175):

```tsx
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-700 transition-colors truncate">{r.tab}</span>
```

to:

```tsx
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-700 transition-colors truncate">{tabDisplayName(r.tab)}</span>
```

Second, in `PlatformBreakdownModal` (around line 271):

```tsx
                      <span className="truncate text-sm font-medium text-slate-700 transition-colors group-hover:text-blue-700">{r.tab}</span>
```

to:

```tsx
                      <span className="truncate text-sm font-medium text-slate-700 transition-colors group-hover:text-blue-700">{tabDisplayName(r.tab)}</span>
```

Third, in the "Brands Performance" tab-summary grid (around line 433):

```tsx
                        <p className="truncate text-sm font-semibold text-slate-800">{tab}</p>
```

to:

```tsx
                        <p className="truncate text-sm font-semibold text-slate-800">{tabDisplayName(tab)}</p>
```

- [ ] **Step 4: `src/components/BrandTabsModal.tsx`**

Change the import (currently):

```ts
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
```

to:

```ts
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
```

Then change the tab list item label (currently):

```tsx
                <span className="text-sm font-medium text-slate-700 truncate">{tab}</span>
```

to:

```tsx
                <span className="text-sm font-medium text-slate-700 truncate">{tabDisplayName(tab)}</span>
```

- [ ] **Step 5: `src/components/AddReviewAccountModal.tsx` and `src/components/EditEntryModal.tsx`**

Both files have an identical import and `TAB_OPTS` line. In each file, change the import (currently):

```ts
import { OPERATIONAL_TABS } from '../lib/tabs';
```

to:

```ts
import { OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
```

Then change `TAB_OPTS` (currently):

```ts
const TAB_OPTS = OPERATIONAL_TABS.map((t) => ({ value: t, label: t }));
```

to:

```ts
const TAB_OPTS = OPERATIONAL_TABS.map((t) => ({ value: t, label: tabDisplayName(t) }));
```

`value` stays the canonical tab string in both files — only `label` (what the dropdown displays) changes.

- [ ] **Step 6: `src/components/ScoreSummaryPanel.tsx`**

Change the import (currently):

```ts
import { tabToSlug } from '../lib/tabs';
```

to:

```ts
import { tabToSlug, tabDisplayName } from '../lib/tabs';
```

Then four display sites. First, the group section header (currently):

```tsx
                <h3 className="text-sm font-semibold text-slate-700">{tab || '(no tab)'}</h3>
```

to:

```tsx
                <h3 className="text-sm font-semibold text-slate-700">{tab ? tabDisplayName(tab) : '(no tab)'}</h3>
```

Second, the collapse/expand `aria-label` right below it (currently):

```tsx
                aria-label={isCollapsed ? `Expand ${tab}` : `Collapse ${tab}`}
```

to:

```tsx
                aria-label={isCollapsed ? `Expand ${tabDisplayName(tab)}` : `Collapse ${tabDisplayName(tab)}`}
```

Third, the per-row tab cell in `SummaryTable` (currently):

```tsx
                <td className="px-3 py-1.5 text-xs text-slate-500 truncate" title={r.tab}>{r.tab}</td>
```

to:

```tsx
                <td className="px-3 py-1.5 text-xs text-slate-500 truncate" title={tabDisplayName(r.tab)}>{tabDisplayName(r.tab)}</td>
```

Fourth, `TabFilterDropdown`'s selected-value chip (currently):

```tsx
        <span className="max-w-[10rem] truncate">{active ? value : 'All brands'}</span>
```

to:

```tsx
        <span className="max-w-[10rem] truncate">{active ? tabDisplayName(value) : 'All brands'}</span>
```

And its option-list rows (currently):

```tsx
                <span className="flex-1 truncate">{opt}</span>
```

to:

```tsx
                <span className="flex-1 truncate">{tabDisplayName(opt)}</span>
```

`value`/`opt` stay the raw canonical tab strings — they're still what's compared (`opt === value`) and passed to `onChange`. Only the rendered `<span>` text changes.

- [ ] **Step 7: Type-check**

Run: `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 8: Manual verification in the browser**

Run: `npm run dev`, log in.
1. Sidebar: confirm the "TP Affiliate" and "TP Brand Injection" nav entries now read "FTP" and "BITP"; collapse the sidebar and hover to confirm the tooltip also shows the new names.
2. Click into each of those two brand tabs — confirm the Topbar header shows "FTP"/"BITP", and the URL is still `/brands/tp-affiliate` / `/brands/tp-brand-injection` (unchanged).
3. Overview page: confirm the "Brands Performance" card for these two tabs shows "FTP"/"BITP"; click the Total/Live/Removed KPI cards to open their breakdown modals and confirm the row labels there also show the new names.
4. Open the "Brand Tabs" quick-jump modal (wherever it's triggered in the UI) and confirm the same two entries show the new names.
5. Go to Score Summary (`/score-summary`): confirm the group headers and the Tab filter dropdown (both the option list and the selected chip once picked) show "FTP"/"BITP".
6. Open Add Review Account and Edit Entry modals and confirm their tab-select dropdown shows "FTP"/"BITP" as options.

- [ ] **Step 9: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Topbar.tsx src/pages/Overview.tsx \
  src/components/BrandTabsModal.tsx src/components/AddReviewAccountModal.tsx \
  src/components/EditEntryModal.tsx src/components/ScoreSummaryPanel.tsx
git commit -m "feat: render TP Affiliate/TP Brand Injection as FTP/BITP everywhere in the UI"
```

---

### Task 3: `computeSuccessRates()` in `src/lib/scoreSummary.ts`

**Files:**
- Modify: `src/lib/scoreSummary.ts`
- Test: `src/lib/scoreSummary.test.ts`

**Interfaces:**
- Consumes: `Entry` type, `Platform` type, `PLATFORM_STATUS_KEYS`, `BRAND_KEYS`, `pick()` — all already defined earlier in `src/lib/scoreSummary.ts`.
- Produces:
  ```ts
  export interface SuccessRate {
    live: number;
    removed: number;
    rate: number | null; // null when live + removed === 0
  }
  export function computeSuccessRates(entries: Entry[], platform: Platform): Map<string, SuccessRate>
  ```
  Map key is `` `${tab} ${brand}` `` — identical format to the bucket key `computeScoreSummary` already uses internally, so Task 4 can look up a `BrandSummary` row's rate with `` successRates.get(`${r.tab} ${r.brand}`) ``.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/scoreSummary.test.ts` (add the import and a new `describe` block):

Change the import line at the top of the file (currently):

```ts
import { computeScoreSummary, parseScore, ratingLabel } from './scoreSummary';
```

to:

```ts
import { computeScoreSummary, computeSuccessRates, parseScore, ratingLabel } from './scoreSummary';
```

Then append at the end of the file:

```ts
describe('computeSuccessRates', () => {
  it('computes live/removed/rate per brand for the selected platform', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published' }),
      makeEntry('3', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
      makeEntry('4', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Pending' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 2, removed: 1, rate: (2 / 3) * 100 });
  });

  it('excludes pending/done/on-pause rows from the denominator entirely', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Pending' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Done' }),
      makeEntry('3', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'On Pause' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 0, removed: 0, rate: null });
  });

  it('ignores rows with no brand or no status', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: '', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.size).toBe(0);
  });

  it('has no date-range parameter and counts a Removed row with no post-date', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('keys results by tab and brand independently', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Trybet', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Removed' }),
    ];
    const result = computeSuccessRates(entries, 'tp');
    expect(result.get('Hanan ZodiacBet.com')).toEqual({ live: 1, removed: 0, rate: 100 });
    expect(result.get('Trybet ZodiacBet.com')).toEqual({ live: 0, removed: 1, rate: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scoreSummary.test.ts`
Expected: FAIL — `computeSuccessRates` is not exported from `./scoreSummary`.

- [ ] **Step 3: Implement `computeSuccessRates`**

Add to `src/lib/scoreSummary.ts`, immediately after the `computeScoreSummary` function (before the `PresetKey`/`resolvePreset` section):

```ts
export interface SuccessRate {
  live: number;
  removed: number;
  rate: number | null; // null when live + removed === 0 (no decided outcome yet)
}

// Mirrors isLiveStatus/isRemovedStatus in src/lib/queries.ts (duplicated here
// rather than imported since that module is Supabase-coupled and this one is
// a pure data transform — keep these two definitions in sync if either changes).
function isLiveStatus(s: string): boolean {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}
function isRemovedStatus(s: string): boolean {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}

// Per-brand Success Rate for Score Summary: live / (live + removed) across
// ALL entries for that brand on the selected platform, not just the
// currently-Published ones computeScoreSummary counts. Deliberately has no
// date-range parameter — a Removed/Refused row frequently has no post-date
// recorded at all, so applying the page's date filter here would silently
// exclude it from the denominator and skew the rate upward.
export function computeSuccessRates(
  entries: Entry[],
  platform: Platform,
): Map<string, SuccessRate> {
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const buckets = new Map<string, { live: number; removed: number }>();

  for (const e of entries) {
    const d = e.data ?? {};

    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    const status = (pick(d, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;

    const tab = e.tab ?? '';
    const key = `${tab} ${brand}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { live: 0, removed: 0 };
      buckets.set(key, bucket);
    }

    if (isLiveStatus(status)) bucket.live += 1;
    else if (isRemovedStatus(status)) bucket.removed += 1;
  }

  const result = new Map<string, SuccessRate>();
  for (const [key, { live, removed }] of buckets) {
    const total = live + removed;
    result.set(key, { live, removed, rate: total === 0 ? null : (live / total) * 100 });
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scoreSummary.test.ts`
Expected: PASS (all tests, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts
git commit -m "feat: add computeSuccessRates for per-brand live/removed ratio"
```

---

### Task 4: Success Rate column in `ScoreSummaryPanel`

**Files:**
- Modify: `src/components/ScoreSummaryPanel.tsx`

**Interfaces:**
- Consumes: `computeSuccessRates`, `SuccessRate` type from `../lib/scoreSummary` (Task 3).
- Produces: no new exports — internal rendering change only. `SummaryTable` and `SummaryColgroup` gain a `successRates: Map<string, SuccessRate>` prop.

- [ ] **Step 1: Import `computeSuccessRates` and `SuccessRate`, compute the map**

Change the import block (currently):

```ts
import {
  computeScoreSummary,
  isoToDate,
  summarizeCounts,
  PLATFORM_MAX_SCORE,
  type BrandSummary,
  type Platform,
  type Star as StarRating,
} from '../lib/scoreSummary';
```

to:

```ts
import {
  computeScoreSummary,
  computeSuccessRates,
  isoToDate,
  summarizeCounts,
  PLATFORM_MAX_SCORE,
  type BrandSummary,
  type Platform,
  type Star as StarRating,
  type SuccessRate,
} from '../lib/scoreSummary';
```

Then, in the `ScoreSummaryPanel` component body, right after the existing `result` memo (currently):

```ts
  const result = useMemo(
    () => computeScoreSummary(entries, range, [], platform),
    [entries, range, platform],
  );
```

add:

```ts
  const successRates = useMemo(
    () => computeSuccessRates(entries, platform),
    [entries, platform],
  );
```

- [ ] **Step 2: Thread `successRates` down through `GroupedSummary` to `SummaryTable`**

Change the `GroupedSummary` call (currently):

```tsx
            <GroupedSummary rows={filteredBrands} maxScore={maxScore} platform={platform} />
```

to:

```tsx
            <GroupedSummary rows={filteredBrands} maxScore={maxScore} platform={platform} successRates={successRates} />
```

Change the `GroupedSummary` function signature (currently):

```tsx
function GroupedSummary({ rows, maxScore, platform }: { rows: BrandSummary[]; maxScore: number; platform: Platform }) {
```

to:

```tsx
function GroupedSummary({ rows, maxScore, platform, successRates }: { rows: BrandSummary[]; maxScore: number; platform: Platform; successRates: Map<string, SuccessRate> }) {
```

Then change its `SummaryTable` call (currently):

```tsx
            {!isCollapsed && <SummaryTable rows={brands} maxScore={maxScore} platform={platform} />}
```

to:

```tsx
            {!isCollapsed && <SummaryTable rows={brands} maxScore={maxScore} platform={platform} successRates={successRates} />}
```

- [ ] **Step 3: Add formatting/color helpers**

Add these two functions right after the existing `starColor`/`starsFor` helpers (before `PLATFORM_OPTS`):

```ts
function successRateColor(rate: number | null): string {
  if (rate == null) return 'text-slate-300';
  if (rate >= 80) return 'text-emerald-600';
  if (rate >= 50) return 'text-amber-600';
  return 'text-rose-600';
}

function formatSuccessRate(sr: SuccessRate | undefined): string {
  if (!sr || sr.rate == null) return '—';
  return `${Math.round(sr.rate)}% (${sr.live}/${sr.live + sr.removed})`;
}
```

- [ ] **Step 4: Add the column to `SummaryColgroup`**

Change (currently):

```tsx
function SummaryColgroup({ showGroup = false, maxScore }: { showGroup?: boolean; maxScore: number }) {
  return (
    <colgroup>
      {showGroup && <col className="w-32" />}
      <col />
      {Array.from({ length: maxScore }, (_, i) => (
        <col key={i} className="w-16" />
      ))}
      <col className="w-20" />
      <col className="w-20" />
    </colgroup>
  );
}
```

to:

```tsx
function SummaryColgroup({ showGroup = false, maxScore }: { showGroup?: boolean; maxScore: number }) {
  return (
    <colgroup>
      {showGroup && <col className="w-32" />}
      <col />
      {Array.from({ length: maxScore }, (_, i) => (
        <col key={i} className="w-16" />
      ))}
      <col className="w-20" />
      <col className="w-20" />
      <col className="w-28" />
    </colgroup>
  );
}
```

- [ ] **Step 5: Add the column to `SummaryTable`'s header, body, and footer**

Change the `SummaryTable` function signature (currently):

```tsx
function SummaryTable({ rows, maxScore, platform }: { rows: BrandSummary[]; maxScore: number; platform: Platform }) {
  const stars = starsFor(maxScore);
  const showGroup = new Set(rows.map((r) => r.tab)).size > 1;
  const totals = useMemo(() => computeColumnTotals(rows, maxScore), [rows, maxScore]);
```

to:

```tsx
function SummaryTable({ rows, maxScore, platform, successRates }: { rows: BrandSummary[]; maxScore: number; platform: Platform; successRates: Map<string, SuccessRate> }) {
  const stars = starsFor(maxScore);
  const showGroup = new Set(rows.map((r) => r.tab)).size > 1;
  const totals = useMemo(() => computeColumnTotals(rows, maxScore), [rows, maxScore]);
  const groupSuccess = useMemo(() => {
    let live = 0, removed = 0;
    for (const r of rows) {
      const sr = successRates.get(`${r.tab} ${r.brand}`);
      if (sr) { live += sr.live; removed += sr.removed; }
    }
    const total = live + removed;
    return { live, removed, rate: total === 0 ? null : (live / total) * 100 };
  }, [rows, successRates]);
```

Change the header row (currently):

```tsx
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
```

to:

```tsx
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Success Rate</th>
          </tr>
        </thead>
```

Change the end of each body row — currently the row ends right after the Total `<td>`:

```tsx
              <td className="px-2 py-1.5 text-right font-semibold font-mono tabular-nums text-slate-800">
                {r.total > 0 ? (
                  <Link
                    to={`/brands/${tabToSlug(r.tab)}?platform=${platform}&brand=${encodeURIComponent(r.brand)}&rating=any`}
                    className="hover:text-blue-600 hover:underline"
                  >
                    {r.total.toLocaleString()}
                  </Link>
                ) : (
                  r.total.toLocaleString()
                )}
              </td>
            </tr>
          ))}
        </tbody>
```

to (adding one more `<td>` before `</tr>`):

```tsx
              <td className="px-2 py-1.5 text-right font-semibold font-mono tabular-nums text-slate-800">
                {r.total > 0 ? (
                  <Link
                    to={`/brands/${tabToSlug(r.tab)}?platform=${platform}&brand=${encodeURIComponent(r.brand)}&rating=any`}
                    className="hover:text-blue-600 hover:underline"
                  >
                    {r.total.toLocaleString()}
                  </Link>
                ) : (
                  r.total.toLocaleString()
                )}
              </td>
              <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${successRateColor((successRates.get(`${r.tab} ${r.brand}`))?.rate ?? null)}`}>
                {formatSuccessRate(successRates.get(`${r.tab} ${r.brand}`))}
              </td>
            </tr>
          ))}
        </tbody>
```

Finally, change the `tfoot` totals row — currently it ends right after the Total `<td>`:

```tsx
            <td className="px-2 py-2 text-right font-mono tabular-nums">
              {totals.total > 0 ? (
                <Link
                  to={`/brands/${tabToSlug(rows[0].tab)}?platform=${platform}&rating=any`}
                  className="hover:text-blue-600 hover:underline"
                >
                  {totals.total.toLocaleString()}
                </Link>
              ) : (
                totals.total.toLocaleString()
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

to (adding one more `<td>` before `</tr>`):

```tsx
            <td className="px-2 py-2 text-right font-mono tabular-nums">
              {totals.total > 0 ? (
                <Link
                  to={`/brands/${tabToSlug(rows[0].tab)}?platform=${platform}&rating=any`}
                  className="hover:text-blue-600 hover:underline"
                >
                  {totals.total.toLocaleString()}
                </Link>
              ) : (
                totals.total.toLocaleString()
              )}
            </td>
            <td className={`px-2 py-2 text-right font-mono tabular-nums ${successRateColor(groupSuccess.rate)}`}>
              {formatSuccessRate(groupSuccess)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Type-check**

Run: `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm run test`
Expected: PASS — no regressions in `scoreSummary.test.ts`, `tabs.test.ts`, or any other suite.

- [ ] **Step 8: Manual verification in the browser**

Run: `npm run dev`, log in, go to `/score-summary`.
1. Confirm a new "Success Rate" column appears after "Total" in every brand row, each group's Total row, showing e.g. `82% (14/17)`.
2. Switch the Platform filter (TrustPilot/AskGamblers/CasinoGuru/Wizard of Odds) and confirm the Success Rate values change accordingly (they're platform-specific).
3. Set a date range that excludes some Published reviews and confirm the star-rating columns shrink accordingly but the Success Rate for the same brand does **not** change — it ignores the date range by design.
4. Find a brand with no Removed/Published history on the selected platform (only Pending/Done/blank) and confirm its Success Rate cell shows "—" in muted gray, not "0%" or a crash.
5. Confirm the color tint: a brand near 100% success shows emerald, one in the 50-79% range shows amber, and one below 50% shows rose.

- [ ] **Step 9: Commit**

```bash
git add src/components/ScoreSummaryPanel.tsx
git commit -m "feat: add per-brand Success Rate column to Score Summary"
```
