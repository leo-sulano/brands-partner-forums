# TP Affiliate Brand Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the TP Affiliate tab, treat `Top10 Casinos Review Ca 2026` and `Best Online Casino in Canada 2026 | Top Rated Online Casinos` as one combined brand for row filtering and KPI counts, while the Brand filter dropdown keeps listing them as two separate selectable options.

**Architecture:** Add a small per-tab `TAB_BRAND_GROUPS` config plus a `getBrandGroup(tab, brand)` lookup helper in `src/lib/tab-configs.ts`. Wire that helper into the existing `brandFiltered` computation in `src/pages/BrandGroup.tsx` so that when the selected brand belongs to a group, the row filter matches every brand in that group instead of just the one selected. KPI cards need no direct change — they're already derived from the filtered rows.

**Tech Stack:** React 19 + TypeScript (strict), Vite 6, Vitest for unit tests.

## Global Constraints

- Exact brand strings (confirmed live in the `entries` table, trailing space included in the raw data): `Top10 Casinos Review Ca 2026` and `Best Online Casino in Canada 2026 | Top Rated Online Casinos`.
- Matching must trim both the config value and the live cell value before comparing, so trailing/leading whitespace in the sheet data doesn't break the match.
- Only the TP Affiliate tab is affected. Every other tab's brand filtering must stay byte-for-byte identical (exact `===` match, no trim).
- The Brand filter dropdown (`uniqueBrands` / `BrandFilterDropdown`) is unchanged — it must keep listing both brand names as separate options, never a merged label.
- Per-row Brand column display text is unchanged — each row still shows its own actual brand value.
- Verify with `npm run build`, not `tsc --noEmit` — the root tsconfig is references-only and `tsc --noEmit` alone checks nothing in this repo.

---

### Task 1: Add `TAB_BRAND_GROUPS` config and `getBrandGroup` helper

**Files:**
- Modify: `src/lib/tab-configs.ts:302-304` (insert new config + function between the end of `getTabSequenceCol` and the `BRAND_TP_URLS` comment)
- Test: `src/lib/tab-configs.test.ts`

**Interfaces:**
- Produces: `export function getBrandGroup(tab: string, brand: string): string[] | null` — returns the full trimmed brand-name group `brand` belongs to for `tab`, or `null` if `brand` isn't part of any configured group for that tab.

- [ ] **Step 1: Write the failing tests**

In `src/lib/tab-configs.test.ts:2`, change:

```ts
import { TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount } from './tab-configs';
```

to:

```ts
import { TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount, getBrandGroup } from './tab-configs';
```

Then add this new `describe` block at the end of the file (after the last existing `describe('getCountryForAccount', ...)` block):

```ts
describe('getBrandGroup', () => {
  it('returns the full group when brand matches the first member', () => {
    expect(getBrandGroup('TP Affiliate', 'Top10 Casinos Review Ca 2026')).toEqual([
      'Top10 Casinos Review Ca 2026',
      'Best Online Casino in Canada 2026 | Top Rated Online Casinos',
    ]);
  });

  it('returns the same group when brand matches the other member', () => {
    expect(getBrandGroup('TP Affiliate', 'Best Online Casino in Canada 2026 | Top Rated Online Casinos')).toEqual([
      'Top10 Casinos Review Ca 2026',
      'Best Online Casino in Canada 2026 | Top Rated Online Casinos',
    ]);
  });

  it('trims whitespace on the incoming brand value before matching', () => {
    expect(getBrandGroup('TP Affiliate', '  Top10 Casinos Review Ca 2026 ')).toEqual([
      'Top10 Casinos Review Ca 2026',
      'Best Online Casino in Canada 2026 | Top Rated Online Casinos',
    ]);
  });

  it('returns null for a brand on TP Affiliate that has no group', () => {
    expect(getBrandGroup('TP Affiliate', 'Aussie Online Pokies')).toBeNull();
  });

  it('returns null for a tab with no configured groups at all', () => {
    expect(getBrandGroup('Rooster Partners', 'Top10 Casinos Review Ca 2026')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tab-configs.test.ts`
Expected: FAIL — `getBrandGroup` is not exported / not defined.

- [ ] **Step 3: Implement `TAB_BRAND_GROUPS` and `getBrandGroup`**

In `src/lib/tab-configs.ts`, insert the following between the end of `getTabSequenceCol` (line 302) and the `// Brand name → Trustpilot review page URL...` comment (line 304):

```ts
// Brand names that are the same underlying campaign submitted under different
// page titles — treated as one combined brand for row filtering and KPI
// counts, while the Brand filter dropdown still lists each name separately.
// Each inner array is one merged group.
const TAB_BRAND_GROUPS: Record<string, string[][]> = {
  'TP Affiliate': [
    ['Top10 Casinos Review Ca 2026', 'Best Online Casino in Canada 2026 | Top Rated Online Casinos'],
  ],
};

// Returns the full group `brand` belongs to for `tab` (trimmed comparison,
// so trailing/leading whitespace in the sheet data doesn't break the match),
// or null if `brand` isn't part of any configured group for that tab.
export function getBrandGroup(tab: string, brand: string): string[] | null {
  const groups = TAB_BRAND_GROUPS[tab];
  if (!groups) return null;
  const trimmed = brand.trim();
  return groups.find((g) => g.includes(trimmed)) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tab-configs.test.ts`
Expected: PASS — all 5 new tests plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "feat: add TAB_BRAND_GROUPS config for merging TP Affiliate brand pair"
```

---

### Task 2: Wire `getBrandGroup` into the TP Affiliate brand filter

**Files:**
- Modify: `src/pages/BrandGroup.tsx:15` (import) and `src/pages/BrandGroup.tsx:1141-1143` (`brandFiltered`)

**Interfaces:**
- Consumes: `getBrandGroup(tab: string, brand: string): string[] | null` from Task 1.

- [ ] **Step 1: Add `getBrandGroup` to the tab-configs import**

In `src/pages/BrandGroup.tsx:15`, change:

```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount } from '../lib/tab-configs';
```

to:

```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount, getBrandGroup } from '../lib/tab-configs';
```

- [ ] **Step 2: Update `brandFiltered` to match on the brand group when one exists**

In `src/pages/BrandGroup.tsx:1141-1143`, change:

```ts
  const brandFiltered = brandFilter && brandCol
    ? searchFiltered.filter((e) => e.data[brandCol] === brandFilter)
    : searchFiltered;
```

to:

```ts
  const brandFiltered = brandFilter && brandCol
    ? (() => {
        const group = getBrandGroup(decodedTab, brandFilter);
        return group
          ? searchFiltered.filter((e) => group.includes((e.data[brandCol] ?? '').trim()))
          : searchFiltered.filter((e) => e.data[brandCol] === brandFilter);
      })()
    : searchFiltered;
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (per project convention, `tsc --noEmit` alone doesn't check this codebase — always use `npm run build`).

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`, log in, navigate to the TP Affiliate tab (`/brands/tp-affiliate`).

- Select `Best Online Casino in Canada 2026 | Top Rated Online Casinos` in the Brand filter.
  - Expected: table shows rows from both that brand and `Top10 Casinos Review Ca 2026`; Total/Live/Removed KPI cards show the combined counts (38 / 34 / 4 as of the data checked during design — exact numbers will drift as the sheet changes, but they should equal the sum of what each brand showed independently before this change).
- Clear the filter, then select `Top10 Casinos Review Ca 2026` instead.
  - Expected: identical table rows and identical KPI counts to the previous step.
- Select an unrelated brand (e.g. `Aussie Online Pokies`).
  - Expected: unchanged behavior — only that brand's own rows and counts show.
- Switch to a different tab (e.g. Rooster Partners) and check its brand filter still behaves exactly as before (exact match, no merging).

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: merge TP Affiliate brand pair in brand filter row matching"
```
