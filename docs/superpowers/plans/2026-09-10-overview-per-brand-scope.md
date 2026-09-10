# Overview Per-Brand Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick one brand (across any tab) on the Overview page and have the entire page — Global KPIs, the tab/brand summary section, Platform Breakdown, Country Breakdown, Proxy Breakdown, and the Country×Proxy Matrix — re-scope to that brand's data only, composable with the existing Date/Country/Proxy/Platform filters and persisted in the URL.

**Architecture:** Add an optional `brandFilter` parameter to the existing `computeTabKpisFromEntries`/`fetchTabKpis` pipeline in `src/lib/queries.ts` that narrows entries to one brand before every other computation — reusing the exact same classification logic the whole-tab case already uses, so nothing can drift. `Overview.tsx` reads a new `?brand=<tabSlug>::<brandName>` URL param, fetches just that one tab with `brandFilter` set (instead of all 11 tabs), and swaps the tab/brand grid section for a single summary card while every other section (which already derives from `state.tabs`) becomes brand-scoped automatically.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, React Router v7, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-10-overview-per-brand-scope-design.md`

## Global Constraints

- Brand matching is case/whitespace-insensitive via the existing `normalizeBrandKey` (`src/lib/removedPlatformBrands.ts`) — the same normalization `computeBrandKpisFromEntries` already buckets brands by. Do not introduce a second, different matching rule.
- `BrandGroup.tsx`'s own `?brand=` deep-link filter is untouched — this feature's URL param and matching semantics are independent and must not be confused with it.
- A `brandFilter` that matches no rows in a tab must produce an all-zero `TabKpis` result, never `null` (unlike `platformFilter`, which can exclude a tab outright).
- No new Supabase queries — reuse `fetchBrandKpis`/`fetchTabKpis` exactly as they already exist (plus the one new parameter added in Task 1).
- Verify with `npm run build` (per this project's standing rule — `tsc --noEmit` alone checks nothing here).

---

### Task 1: Add brand scoping to `computeTabKpisFromEntries` / `fetchTabKpis`

**Files:**
- Modify: `src/lib/queries.ts:692-793`
- Test: `src/lib/queries.test.ts` (inside the existing `describe('computeTabKpisFromEntries', ...)` block, `src/lib/queries.test.ts:517-1044`)

**Interfaces:**
- Consumes: `normalizeBrandKey` (already imported in `queries.ts:8`), the existing `Entry`, `TabKpis`, `Platform` types.
- Produces: `computeTabKpisFromEntries(entries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter?, proxyFilter?, platformFilter?, brandFilter?: string): TabKpis | null` and `fetchTabKpis(tab, dateFrom?, dateTo?, removedPlatformBrands?, countryFilter?, proxyFilter?, platformFilter?, brandFilter?: string): Promise<TabKpis | null>` — both gain one new optional trailing `brandFilter` parameter. Task 2 calls these with the new parameter.

- [ ] **Step 1: Write the failing tests**

Open `src/lib/queries.test.ts`. Inside the `describe('computeTabKpisFromEntries', ...)` block, insert the following four tests immediately before the block's closing `});` at line 1044 (right after the `includes customPlatforms counts for any platform enabled on the tab` test):

```ts
  it('brandFilter narrows results to only entries whose brand matches, case-insensitively and trimmed', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Aussie Online Pokies', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
      entry('2', { 'URL PAGE': ' aussie online pokies ', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
      entry('3', { 'URL PAGE': 'Other Brand', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, undefined, 'Aussie Online Pokies')!;
    expect(kpis.live).toBe(2);
    expect(kpis.removed).toBe(0);
  });

  it('brandFilter scopes the countries/proxies option lists to just that brand\'s own values, not the whole tab\'s', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Brand A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany' }),
      entry('2', { 'URL PAGE': 'Brand B', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, undefined, 'Brand A')!;
    expect(kpis.countries).toEqual(['Germany']);
    expect(kpis.live).toBe(1);
  });

  it('brandFilter composes with countryFilter (AND), same as with dateFrom/dateTo', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Brand A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'Germany' }),
      entry('2', { 'URL PAGE': 'Brand A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Country': 'France' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), ['Germany'], undefined, undefined, 'Brand A')!;
    expect(kpis.live).toBe(1);
  });

  it('a brandFilter matching no entries returns an all-zero result, not null', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'Brand A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, undefined, undefined, 'Nonexistent Brand');
    expect(kpis).not.toBeNull();
    expect(kpis!.live).toBe(0);
    expect(kpis!.removed).toBe(0);
    expect(kpis!.countries).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts -t "brandFilter"`
Expected: FAIL — `computeTabKpisFromEntries` doesn't accept a `brandFilter` argument yet (TypeScript will also flag the extra argument, but Vitest will still run and the assertions will fail since the 11th positional argument is currently ignored/undefined and every row still counts).

- [ ] **Step 3: Implement `brandFilter` in `computeTabKpisFromEntries`**

In `src/lib/queries.ts`, find (around line 692):

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
  const cols = resolveReviewColumns(rawHeaders, tab);
  const { activePlatforms } = cols;

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

  const filteredEntries = filterByCountryAndProxy(entries, tab, countryFilter, proxyFilter);

  const countries = uniqueDisplayValues(entries.map((e) => resolveCountryLabel(e.data, tab)), canonicalCountryKey, canonicalCountryName);
  const proxies = uniqueDisplayValues(entries.map((e) => resolveProxyLabel(e.data['Proxy Used'])), canonicalProxyKey, canonicalProxyName);
```

Replace with:

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
  brandFilter?: string,
): TabKpis | null {
  const cols = resolveReviewColumns(rawHeaders, tab);
  const { activePlatforms } = cols;

  // A tab is excluded only if it tracks NONE of the selected platforms — it's
  // included (and scoped to just the tracked subset below) if it tracks at
  // least one, which is what makes "TP + AG selected" a combined total
  // rather than an intersection.
  if (platformFilter?.length && !platformFilter.some((p) => activePlatforms.includes(p))) {
    return null;
  }

  // Overview's per-brand scope: narrow to just the rows belonging to one
  // brand (matched the same case/whitespace-insensitive way
  // computeBrandKpisFromEntries already buckets brands) before anything else
  // is computed — so KPI counts, byCountry/byProxy/byCountryProxy, and even
  // the countries/proxies option lists below are all scoped to that brand.
  // Unlike platformFilter, a brandFilter that matches nothing simply yields
  // an all-zero result for this tab, not null.
  const brandScopedEntries = brandFilter
    ? entries.filter((e) => normalizeBrandKey((e.data[brandCol] ?? '').trim()) === normalizeBrandKey(brandFilter))
    : entries;

  let live = 0, removed = 0, done = 0, pending = 0, onPause = 0, notDone = 0;
  let tpLive = 0, tpRemoved = 0;
  let agLive = 0, agRemoved = 0;
  let cgLive = 0, cgRemoved = 0;
  let woLive = 0, woRemoved = 0;

  const filteredEntries = filterByCountryAndProxy(brandScopedEntries, tab, countryFilter, proxyFilter);

  const countries = uniqueDisplayValues(brandScopedEntries.map((e) => resolveCountryLabel(e.data, tab)), canonicalCountryKey, canonicalCountryName);
  const proxies = uniqueDisplayValues(brandScopedEntries.map((e) => resolveProxyLabel(e.data['Proxy Used'])), canonicalProxyKey, canonicalProxyName);
```

- [ ] **Step 4: Implement `brandFilter` in `fetchTabKpis`**

In `src/lib/queries.ts`, find (around line 778):

```ts
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

Replace with:

```ts
export async function fetchTabKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedPlatformBrands: Set<string> = new Set(),
  countryFilter?: string[],
  proxyFilter?: string[],
  platformFilter?: Platform[],
  brandFilter?: string,
): Promise<TabKpis | null> {
  const [allEntries, rawHeaders] = await Promise.all([
    fetchAllTabEntries(tab),
    fetchTabHeaders(tab),
  ]);
  const brandCol = getBrandNameCol(tab);
  return computeTabKpisFromEntries(allEntries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter, proxyFilter, platformFilter, brandFilter);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts -t "brandFilter"`
Expected: PASS (4 passed)

- [ ] **Step 6: Run the full queries.ts test suite to check for regressions**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: all tests pass (no existing test passes a positional `brandFilter` argument, so every prior call site is unaffected by the new optional trailing parameter).

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "$(cat <<'EOF'
Add brandFilter param to computeTabKpisFromEntries/fetchTabKpis

Narrows a tab's KPI computation to one brand (case/whitespace-
insensitive match) before every other computation, so KPI counts,
country/proxy breakdowns, and filter option lists all scope
together. Powers Overview's upcoming per-brand view.
EOF
)"
```

---

### Task 2: Overview per-brand picker and full-page scoping

**Files:**
- Modify: `src/components/MultiSelectDropdown.tsx`
- Modify: `src/pages/Overview.tsx`

**Interfaces:**
- Consumes: `fetchTabKpis(tab, dateFrom?, dateTo?, removedPlatformBrands?, countryFilter?, proxyFilter?, platformFilter?, brandFilter?)` and `fetchBrandKpis(tab, dateFrom?, dateTo?, removedPlatformBrands?, countryFilter?, proxyFilter?, platformFilter?)` from Task 1 / existing `src/lib/queries.ts`; `tabToSlug`, `slugToTab`, `tabDisplayName` from `src/lib/tabs.ts`; `getActiveOperationalTabs` from `src/lib/pausedTabRegistry.ts`.
- Produces: `MultiSelectDropdown` gains an optional `onOpen?: () => void` prop, called exactly once per open (not on close). No other file consumes this yet besides `Overview.tsx`.

This task has no dedicated test file — `Overview.tsx` and `MultiSelectDropdown.tsx` are page/presentational components with no existing unit test coverage (verified via `npm run build` and manual browser verification, matching this project's established pattern for `Overview.tsx`/`BrandGroup.tsx` changes).

- [ ] **Step 1: Add an `onOpen` callback to `MultiSelectDropdown`**

In `src/components/MultiSelectDropdown.tsx`, find:

```ts
interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiSelectOption[];
  noun?: string;
  searchable?: boolean;
  placeholder?: string;
}
```

Replace with:

```ts
interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiSelectOption[];
  noun?: string;
  searchable?: boolean;
  placeholder?: string;
  // Fired exactly once per transition from closed to open — never on close.
  // Lets a caller lazy-load this dropdown's options the first time a user
  // actually opens it, instead of on every page load.
  onOpen?: () => void;
}
```

Then find the function signature:

```ts
export default function MultiSelectDropdown({ values, onChange, options, noun = 'option', searchable = false, placeholder }: Props) {
```

Replace with:

```ts
export default function MultiSelectDropdown({ values, onChange, options, noun = 'option', searchable = false, placeholder, onOpen }: Props) {
```

Then find the toggle button's `onClick`:

```tsx
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
```

Replace with:

```tsx
      <button
        type="button"
        onClick={() => setOpen((v) => {
          const next = !v;
          if (next) onOpen?.();
          return next;
        })}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
```

- [ ] **Step 2: Verify the build still compiles**

Run: `npm run build`
Expected: succeeds (the new prop is optional, so every other existing caller of `MultiSelectDropdown` — Overview's own Country/Proxy/Platform dropdowns, and any others — is unaffected).

- [ ] **Step 3: Import `slugToTab` in `Overview.tsx`**

In `src/pages/Overview.tsx`, find:

```ts
import { tabToSlug, tabDisplayName } from '../lib/tabs';
```

Replace with:

```ts
import { tabToSlug, tabDisplayName, slugToTab } from '../lib/tabs';
```

- [ ] **Step 4: Parse the `?brand=` param and add brand-directory state**

In `src/pages/Overview.tsx`, find:

```ts
  const platformFilter = useMemo(
    () => readArrayParam(searchParams, 'platform').filter((p) => PLATFORM_VALUES.has(p)) as Platform[],
    [platformParamRaw],
  );

  const loadData = useCallback(async () => {
```

Replace with:

```ts
  const platformFilter = useMemo(
    () => readArrayParam(searchParams, 'platform').filter((p) => PLATFORM_VALUES.has(p)) as Platform[],
    [platformParamRaw],
  );

  // Overview's per-brand scope. Encoded as "<tabSlug>::<brandName>" since
  // brand names aren't unique across tabs — URLSearchParams handles the
  // percent-encoding of the whole opaque value transparently, same as every
  // other filter param here.
  const brandParamRaw = searchParams.get('brand') ?? '';
  const selectedBrand = useMemo(() => {
    if (!brandParamRaw) return null;
    const sep = brandParamRaw.indexOf('::');
    if (sep === -1) return null;
    const tab = slugToTab(brandParamRaw.slice(0, sep));
    const brand = brandParamRaw.slice(sep + 2);
    if (!tab || !brand) return null;
    return { tab, brand };
  }, [brandParamRaw]);

  // Directory of every brand across every tab, for the brand picker's
  // search list. Lazy-loaded (not fetched on initial page load) since it
  // reads every raw entry across all 11 tabs, the same cost the "Brands"
  // view's own lazy fetch already accepts.
  const [brandDirectory, setBrandDirectory] = useState<{ tab: string; brand: string }[] | null>(null);
  const [brandDirectoryLoading, setBrandDirectoryLoading] = useState(false);
  const loadBrandDirectory = useCallback(async () => {
    if (brandDirectory || brandDirectoryLoading) return;
    setBrandDirectoryLoading(true);
    try {
      const lists = await Promise.all(
        getActiveOperationalTabs().map((tab) =>
          fetchBrandKpis(tab)
            .then((brands) => brands.map((b) => ({ tab, brand: b.brand })))
            .catch(() => [] as { tab: string; brand: string }[])
        )
      );
      setBrandDirectory(lists.flat());
    } finally {
      setBrandDirectoryLoading(false);
    }
  }, [brandDirectory, brandDirectoryLoading]);

  // Arriving via a shared/bookmarked ?brand= link should resolve the
  // dropdown's display label without requiring the user to open it first.
  useEffect(() => {
    if (selectedBrand) loadBrandDirectory();
  }, [selectedBrand, loadBrandDirectory]);

  const loadData = useCallback(async () => {
```

- [ ] **Step 5: Scope `loadData` to the selected brand**

In `src/pages/Overview.tsx`, find:

```ts
  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const removedPlatformBrands = await fetchRemovedPlatformBrands()
        .then(buildRemovedPlatformBrandSet)
        .catch(() => new Set<string>());
      const tabResults = (await Promise.all(
        getActiveOperationalTabs().map((tab) =>
          fetchTabKpis(
            tab,
            dateFrom || undefined,
            dateTo || undefined,
            removedPlatformBrands,
            countryFilter,
            proxyFilter,
            platformFilter,
          )
            .then((kpis): TabSummary | null => (kpis ? { tab, kpis } : null))
            .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
        )
      )).filter((r): r is TabSummary => r !== null);
      setState({ loading: false, error: null, tabs: tabResults });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo, countryFilter, proxyFilter, platformFilter]);
```

Replace with:

```ts
  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const removedPlatformBrands = await fetchRemovedPlatformBrands()
        .then(buildRemovedPlatformBrandSet)
        .catch(() => new Set<string>());
      // A selected brand narrows the fetch to just its own tab, already
      // brand-scoped by fetchTabKpis's new brandFilter param — every other
      // section on the page derives from state.tabs, so this one change is
      // what makes the whole page re-scope.
      const tabsToLoad = selectedBrand ? [selectedBrand.tab] : getActiveOperationalTabs();
      const tabResults = (await Promise.all(
        tabsToLoad.map((tab) =>
          fetchTabKpis(
            tab,
            dateFrom || undefined,
            dateTo || undefined,
            removedPlatformBrands,
            countryFilter,
            proxyFilter,
            platformFilter,
            selectedBrand?.brand,
          )
            .then((kpis): TabSummary | null => (kpis ? { tab, kpis } : null))
            .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
        )
      )).filter((r): r is TabSummary => r !== null);
      setState({ loading: false, error: null, tabs: tabResults });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo, countryFilter, proxyFilter, platformFilter, selectedBrand]);
```

- [ ] **Step 6: Skip the "Brands" view fetch while a brand is already selected**

In `src/pages/Overview.tsx`, find:

```ts
  // Lazy: only fetches once the user actually opens the Brands view (per-brand
  // aggregation reads every raw entry across all 11 tabs, unlike the Brand
  // Tabs view's cheaper pre-aggregated call) — refetches if filters change
  // while already on that view.
  useEffect(() => {
    if (view === 'brands') loadBrandData();
  }, [view, loadBrandData]);
```

Replace with:

```ts
  // Lazy: only fetches once the user actually opens the Brands view (per-brand
  // aggregation reads every raw entry across all 11 tabs, unlike the Brand
  // Tabs view's cheaper pre-aggregated call) — refetches if filters change
  // while already on that view. Skipped while a single brand is already
  // selected — a per-brand breakdown of an already-single-brand scope has
  // nothing to show.
  useEffect(() => {
    if (view === 'brands' && !selectedBrand) loadBrandData();
  }, [view, loadBrandData, selectedBrand]);
```

- [ ] **Step 7: Add a `setBrandParam` writer and extend `anyFilterActive`/Clear**

In `src/pages/Overview.tsx`, find:

```ts
  function setPlatformFilter(values: string[]) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      writeArrayParam(next, 'platform', values);
      return next;
    }, { replace: true });
  }
```

Replace with:

```ts
  function setPlatformFilter(values: string[]) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      writeArrayParam(next, 'platform', values);
      return next;
    }, { replace: true });
  }

  // Single-select wrapper around MultiSelectDropdown: values passed in is
  // always length 0 or 1 (see brandDropdownValues below), so the
  // most-recently-toggled entry (the array's last element) is always the
  // one the user just picked, whether that's a genuinely new selection or
  // the empty array from deselecting/clearing.
  function setBrandParam(values: string[]) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const chosen = values[values.length - 1];
      if (chosen) next.set('brand', chosen); else next.delete('brand');
      return next;
    }, { replace: true });
  }
```

Then find:

```ts
  const dateActive = !!(dateFrom || dateTo);
  const anyFilterActive = dateActive || countryFilter.length > 0 || proxyFilter.length > 0 || platformFilter.length > 0;
```

Replace with:

```ts
  const dateActive = !!(dateFrom || dateTo);
  const anyFilterActive = dateActive || countryFilter.length > 0 || proxyFilter.length > 0 || platformFilter.length > 0 || !!selectedBrand;

  const brandOptions = (brandDirectory ?? []).map((b) => ({
    value: `${tabToSlug(b.tab)}::${b.brand}`,
    label: `${b.brand} — ${tabDisplayName(b.tab)}`,
  }));
  const brandDropdownValues = selectedBrand ? [`${tabToSlug(selectedBrand.tab)}::${selectedBrand.brand}`] : [];
```

Then find the Clear button:

```tsx
            onClick={() => setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              ['from', 'to', 'country', 'proxy', 'platform'].forEach((k) => next.delete(k));
              return next;
            }, { replace: true })}
```

Replace with:

```tsx
            onClick={() => setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              ['from', 'to', 'country', 'proxy', 'platform', 'brand'].forEach((k) => next.delete(k));
              return next;
            }, { replace: true })}
```

- [ ] **Step 8: Render the brand dropdown in the filter bar**

In `src/pages/Overview.tsx`, find:

```tsx
        <span className="mx-1 hidden sm:inline text-xs font-medium text-slate-300">|</span>
        <span className="text-xs font-medium text-slate-500 shrink-0">Filters</span>
        {allCountries.length > 1 && (
```

Replace with:

```tsx
        <span className="mx-1 hidden sm:inline text-xs font-medium text-slate-300">|</span>
        <span className="text-xs font-medium text-slate-500 shrink-0">Filters</span>
        <MultiSelectDropdown
          noun="brand"
          values={brandDropdownValues}
          onChange={setBrandParam}
          onOpen={loadBrandDirectory}
          options={brandOptions}
          searchable
        />
        {allCountries.length > 1 && (
```

- [ ] **Step 9: Update Global KPI card hints for the selected brand**

In `src/pages/Overview.tsx`, find:

```tsx
          <KpiCard
            label="Total Accounts"
            value={state.loading ? '…' : totalAccounts.toLocaleString()}
            icon={<Users className="size-5" />}
            hint="across all brand tabs"
            color="blue"
          />
```

Replace with:

```tsx
          <KpiCard
            label="Total Accounts"
            value={state.loading ? '…' : totalAccounts.toLocaleString()}
            icon={<Users className="size-5" />}
            hint={selectedBrand ? `for ${selectedBrand.brand}` : 'across all brand tabs'}
            color="blue"
          />
```

Then find:

```tsx
          <KpiCard
            label="Live"
            value={state.loading ? '…' : totalLive.toLocaleString()}
            icon={<CheckCircle2 className="size-5" />}
            hint="active across TP / AG / CG / WO"
            color="emerald"
          />
```

Replace with:

```tsx
          <KpiCard
            label="Live"
            value={state.loading ? '…' : totalLive.toLocaleString()}
            icon={<CheckCircle2 className="size-5" />}
            hint={selectedBrand ? `for ${selectedBrand.brand}` : 'active across TP / AG / CG / WO'}
            color="emerald"
          />
```

Then find:

```tsx
          <KpiCard
            label="Removed"
            value={state.loading ? '…' : totalRemoved.toLocaleString()}
            icon={<XCircle className="size-5" />}
            hint="across all tabs"
            color="rose"
          />
```

Replace with:

```tsx
          <KpiCard
            label="Removed"
            value={state.loading ? '…' : totalRemoved.toLocaleString()}
            icon={<XCircle className="size-5" />}
            hint={selectedBrand ? `for ${selectedBrand.brand}` : 'across all tabs'}
            color="rose"
          />
```

- [ ] **Step 10: Replace the tab/brand grid section with a single summary card when a brand is selected**

In `src/pages/Overview.tsx`, find the section's opening (the `<section>` that starts the "Brand Tabs / Brands" view toggle, right after the Global KPIs grid closes):

```tsx
      {/* Tab summary grid */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Brands Performance</h2>
```

Replace with:

```tsx
      {selectedBrand ? (
        /* Single-brand scope: one summary card in place of the tab/brand
           grid and its view toggle — there is inherently only one brand to
           show once a brand is selected. */
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-slate-700">{selectedBrand.brand}</h2>
            <p className="text-xs text-slate-400">{tabDisplayName(selectedBrand.tab)}</p>
          </div>
          {state.loading ? (
            <div className="max-w-sm animate-pulse rounded-lg bg-slate-100" style={{ height: 132 }} />
          ) : (() => {
            const kpis = state.tabs.find((t) => t.tab === selectedBrand.tab)?.kpis;
            if (!kpis) {
              return (
                <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
                  No data for this brand under the current filters
                </p>
              );
            }
            return (
              <div className="max-w-sm rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link to={brandRowHref(selectedBrand.tab, selectedBrand.brand)} className="truncate text-sm font-semibold text-slate-800 hover:text-blue-600">
                    {selectedBrand.brand}
                  </Link>
                  <span className="shrink-0 text-xs text-slate-500">
                    <span className="font-medium text-slate-900">{kpis.live + kpis.removed}</span> total
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-[auto_auto_auto_1fr_auto] gap-y-0.5 text-xs text-slate-600">
                  {kpis.activePlatforms.map((p) => (
                    <PlatformRow
                      key={p}
                      href={brandRowHref(selectedBrand.tab, selectedBrand.brand, p)}
                      platform={p}
                      live={kpis[p].live}
                      removed={kpis[p].removed}
                    />
                  ))}
                  {kpis.customPlatforms.map(({ platform, live, removed }) => (
                    <CustomPlatformRow key={platform.id} shortLabel={platform.shortLabel} live={live} removed={removed} />
                  ))}
                </div>
              </div>
            );
          })()}
        </section>
      ) : (
      /* Tab summary grid */
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Brands Performance</h2>
```

Now find the closing of that same section (the end of the "Brands" view's `visibleBrandGroups.map` rendering, right before the "Platform breakdown chart" comment):

```tsx
            </div>
          )
        )}
      </section>

      {/* Platform breakdown chart -- redundant once scoped to one platform */}
```

Replace with:

```tsx
            </div>
          )
        )}
      </section>
      )}

      {/* Platform breakdown chart -- redundant once scoped to one platform */}
```

- [ ] **Step 11: Update the Platform/Country/Proxy Breakdown and Matrix section subtitles**

In `src/pages/Overview.tsx`, find:

```tsx
            <h2 className="text-base font-semibold text-slate-800">Platform Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">Published vs. removed per platform</p>
```

Replace with:

```tsx
            <h2 className="text-base font-semibold text-slate-800">Platform Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">Published vs. removed per platform{selectedBrand ? ` for ${selectedBrand.brand}` : ''}</p>
```

Then find:

```tsx
            <h2 className="text-base font-semibold text-slate-800">Country Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Published vs. removed by country
              {!state.loading && countryCards.length > 0 && ` — ${countryCoverage.toLocaleString()} of ${totalAccounts.toLocaleString()} accounts have a country recorded`}
            </p>
```

Replace with:

```tsx
            <h2 className="text-base font-semibold text-slate-800">Country Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Published vs. removed by country{selectedBrand ? ` for ${selectedBrand.brand}` : ''}
              {!state.loading && countryCards.length > 0 && ` — ${countryCoverage.toLocaleString()} of ${totalAccounts.toLocaleString()} accounts have a country recorded`}
            </p>
```

Then find:

```tsx
            <h2 className="text-base font-semibold text-slate-800">Proxy Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Published vs. removed by proxy
              {!state.loading && proxyCards.length > 0 && ` — ${proxyCoverage.toLocaleString()} of ${totalAccounts.toLocaleString()} accounts have a proxy recorded`}
            </p>
```

Replace with:

```tsx
            <h2 className="text-base font-semibold text-slate-800">Proxy Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Published vs. removed by proxy{selectedBrand ? ` for ${selectedBrand.brand}` : ''}
              {!state.loading && proxyCards.length > 0 && ` — ${proxyCoverage.toLocaleString()} of ${totalAccounts.toLocaleString()} accounts have a proxy recorded`}
            </p>
```

Then find:

```tsx
          <h2 className="text-base font-semibold text-slate-800">Country × Proxy Performance</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Success rate for every country/proxy combination — click a cell to see it by brand tab.
          </p>
```

Replace with:

```tsx
          <h2 className="text-base font-semibold text-slate-800">Country × Proxy Performance</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Success rate for every country/proxy combination{selectedBrand ? ` for ${selectedBrand.brand}` : ''} — click a cell to see it by brand tab.
          </p>
```

- [ ] **Step 12: Verify the build compiles**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 13: Manual browser verification**

Start the dev server (`npm run dev`) and sign in, then in the browser:

1. Open Overview. Click the new "brand" dropdown, search for a known brand (e.g. one from Rooster Partners), and select it.
   Expected: Global KPI totals, the single summary card (brand name + tab subtitle, correct platform rows), Platform Breakdown, Country Breakdown, Proxy Breakdown, and the Country×Proxy Matrix all update to that brand's real numbers only. The "Brand Tabs / Brands" toggle is gone.
2. With that brand still selected, also pick a Country or Platform filter.
   Expected: the numbers narrow further (composes correctly), and the brand stays selected.
3. Click "Clear".
   Expected: the page returns to the full multi-tab, multi-filter view; the brand dropdown resets to "All brands".
4. Re-select a brand, copy the URL, and reload the page with it.
   Expected: the page lands back on the same brand-scoped view, and the brand dropdown's label correctly shows "`<brand>` — `<tab>`" (not a raw slug) once the directory loads.
5. Select a brand that has zero rows in the current date range (or set a date range that excludes all of a selected brand's rows).
   Expected: the summary card and KPIs show real zeros rather than an error or a blank page.

- [ ] **Step 14: Commit**

```bash
git add src/components/MultiSelectDropdown.tsx src/pages/Overview.tsx
git commit -m "$(cat <<'EOF'
Add per-brand scope to Overview

Lets a user pick one brand across any tab from a new searchable
dropdown; the whole page (KPIs, summary card, Platform/Country/Proxy
Breakdown, Country x Proxy Matrix) re-scopes to that brand via
fetchTabKpis's new brandFilter param, composes with the existing
Date/Country/Proxy/Platform filters, and persists in the URL as
?brand=<tabSlug>::<brandName>.
EOF
)"
```

---

## Post-implementation

Update `CLAUDE.md`'s Recent Changes with a dated entry describing this feature (per this project's standing documentation convention), noting the accepted minor rough edge that the existing KPI/dimension drill-down modals (`KpiBreakdownModal`, `SliceBreakdownModal`) still list "by brand tab" rather than by brand when a brand is already selected — harmless (correct totals, correct links) but redundant with only one row, and deliberately left as-is per the spec's non-goals.
