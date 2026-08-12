# Brand Page Removal — Email Notification + Page Removed Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user flags a brand's platform page as removed (the existing per-platform
checkbox in the Edit Entry modal), notify every approved dashboard user by email, show the
removal date in the modal, and add a per-platform "Page Removed Status" column (holding
that date) to Brand Tabs' CSV/Excel export.

**Architecture:** `removed_platform_brands` stays the single source of truth (its existing
`removed_at` column is finally read, not written to anew). A new Resend-backed
`notify-brand-removed` Edge Function is called client-side right after the existing
`setBrandPlatformRemoved(tab, brand, platform, true)` write succeeds. The export column is a
synthetic (non-`entries.data`) header injected into `BrandGroup.tsx`'s existing
`exportHeaders` pipeline so it's placed and platform-filtered by the same `sectionOf` logic
real columns already use.

**Tech Stack:** React 19 + TypeScript, Supabase (Postgres + Edge Functions, Deno), Vitest,
Resend HTTP API.

## Global Constraints

- No new database tables/migrations — `removed_platform_brands` already has `removed_at`.
- `buildRemovedPlatformBrandSet`'s signature/return type must not change (9 files import it).
- `fetchRemovedPlatformBrands`'s change must be additive only (3 existing consumers must be
  unaffected).
- The notification is best-effort: if the Edge Function call fails, the underlying
  `removed_platform_brands` flag write is never rolled back.
- No notification fires when a platform's removed flag is *cleared* — only when newly set to
  `true`.
- The new Edge Function must not import from `src/lib` — keep it a thin, self-contained proxy
  (matches `translate-review`/`check-review-status`'s existing pattern), receiving every
  human-readable string it needs (tab label, platform label, formatted date, deep link) ready-
  made in its request payload from the client, which already has `tabDisplayName`/
  `PLATFORM_LABEL`/`formatCellValue`/`tabToSlug` available — this avoids duplicating any of
  those maps/helpers inside Deno.
- Every touched file's existing test suite must stay green; run the full suite
  (`npx vitest run`) and `npm run build` after every task that touches `src/`.

---

### Task 1: `fetchRemovedPlatformBrands` exposes `removed_at`

**Files:**
- Modify: `src/lib/queries.ts:213-221`
- Modify: `src/lib/queries.test.ts` (new test near line 80, after the existing
  `fetchRemovedPlatformBrands` test)

**Interfaces:**
- Produces: `fetchRemovedPlatformBrands(client?): Promise<{ tab: string; brand: string; platform: Platform; removed_at: string }[]>` — return type gains one field, existing 3 consumers (`BrandGroup.tsx`, `ScoreSummary.tsx`, `SchedulePlanner.tsx`) are unaffected since none of them declare a narrower local type that would reject the extra field.

- [ ] **Step 1: Write the failing test**

The existing fake-client `chain()` helper (top of `src/lib/queries.test.ts`) ignores the real
select column list and just returns whatever fixture `data` it's given — it can't reproduce
the actual bug (a real Supabase call omits `removed_at` if not selected). So this test asserts
against the function's own `.select(...)` call args instead of round-tripping fixture data.

Add to `src/lib/queries.test.ts`, right after the existing `it('fetchRemovedPlatformBrands uses the passed-in client', ...)` block (around line 80):

```ts
  it('fetchRemovedPlatformBrands selects removed_at alongside tab/brand/platform', async () => {
    const selectSpy = vi.fn().mockReturnValue({
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
    });
    const fakeFrom = vi.fn().mockReturnValue({ select: selectSpy });
    await fetchRemovedPlatformBrands({ from: fakeFrom } as any);
    expect(selectSpy).toHaveBeenCalledWith('tab, brand, platform, removed_at');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/queries.test.ts -t "selects removed_at"`
Expected: FAIL — actual call was `select('tab, brand, platform')`, not `'tab, brand, platform, removed_at'`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/queries.ts`, replace lines 213-221:

```ts
export async function fetchRemovedPlatformBrands(
  client: SupabaseClient = supabase,
): Promise<{ tab: string; brand: string; platform: Platform; removed_at: string }[]> {
  const { data, error } = await client
    .from('removed_platform_brands')
    .select('tab, brand, platform, removed_at');
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string; platform: Platform; removed_at: string }[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS (all tests in the file, including the new one and the pre-existing
`'fetchRemovedPlatformBrands uses the passed-in client'` test, which still passes since it
only asserts the table name).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: fetchRemovedPlatformBrands selects removed_at"
```

---

### Task 2: `buildRemovedPlatformBrandDateMap`

**Files:**
- Modify: `src/lib/removedPlatformBrands.ts`
- Modify: `src/lib/removedPlatformBrands.test.ts`

**Interfaces:**
- Consumes: `platformRemovedKey(tab, brand, platform)` (already exported, unchanged).
- Produces: `buildRemovedPlatformBrandDateMap(rows: { tab: string; brand: string; platform: Platform; removed_at: string }[]): Map<string, string>` — key format identical to `buildRemovedPlatformBrandSet`'s.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/removedPlatformBrands.test.ts`:

```ts
import { platformRemovedKey, buildRemovedPlatformBrandSet, buildRemovedPlatformBrandDateMap } from './removedPlatformBrands';

// ... (keep existing imports/describes above unchanged)

describe('buildRemovedPlatformBrandDateMap', () => {
  it('maps a flagged (tab, brand, platform) to its removed_at value', () => {
    const map = buildRemovedPlatformBrandDateMap([
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', removed_at: '2026-08-05T10:00:00.000Z' },
    ]);
    expect(map.get(platformRemovedKey('Hanan', 'pribet.com', 'tp'))).toBe('2026-08-05T10:00:00.000Z');
  });

  it('returns undefined for a key with no matching row', () => {
    const map = buildRemovedPlatformBrandDateMap([]);
    expect(map.get(platformRemovedKey('Hanan', 'Pribet.com', 'tp'))).toBeUndefined();
  });

  it('keeps distinct dates for the same brand flagged on two different platforms', () => {
    const map = buildRemovedPlatformBrandDateMap([
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', removed_at: '2026-08-05T10:00:00.000Z' },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'ag', removed_at: '2026-08-06T10:00:00.000Z' },
    ]);
    expect(map.get(platformRemovedKey('Hanan', 'Pribet.com', 'tp'))).toBe('2026-08-05T10:00:00.000Z');
    expect(map.get(platformRemovedKey('Hanan', 'Pribet.com', 'ag'))).toBe('2026-08-06T10:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/removedPlatformBrands.test.ts`
Expected: FAIL with "buildRemovedPlatformBrandDateMap is not a function" (import error).

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/removedPlatformBrands.ts` (after `buildRemovedPlatformBrandSet`, do not modify that function):

```ts
export function buildRemovedPlatformBrandDateMap(
  rows: { tab: string; brand: string; platform: Platform; removed_at: string }[],
): Map<string, string> {
  return new Map(rows.map((r) => [platformRemovedKey(r.tab, r.brand, r.platform), r.removed_at]));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/removedPlatformBrands.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/removedPlatformBrands.ts src/lib/removedPlatformBrands.test.ts
git commit -m "feat: add buildRemovedPlatformBrandDateMap"
```

---

### Task 3: `buildBrandRowsForExport` resolver parameter

**Files:**
- Modify: `src/lib/brandExport.ts`
- Modify: `src/lib/brandExport.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `buildBrandRowsForExport(entries, headers, tab, resolveSynthetic?): string[][]` where
  `resolveSynthetic?: (entry: Entry, header: string) => string | null`. When provided and it
  returns non-null for a given `(entry, header)` pair, that value is used verbatim instead of
  reading `entry.data[header]`. Task 5 will pass a resolver built from
  `buildRemovedPlatformBrandDateMap`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/brandExport.test.ts` (inside the existing `describe('buildBrandRowsForExport', ...)` block, or as new `it`s directly below the existing ones — either works since they're flat `it`s under one `describe`):

```ts
  it('uses the resolver value when it returns non-null for a header', () => {
    const entries = [makeEntry({ Account: 'acct1' })];
    const resolver = (_entry: Entry, header: string) => (header === 'TP Page Removed Status' ? '05/08/2026' : null);
    const rows = buildBrandRowsForExport(entries, ['Account', 'TP Page Removed Status'], 'Hanan', resolver);
    expect(rows).toEqual([['acct1', '05/08/2026']]);
  });

  it('falls back to entry.data when the resolver returns null for a header', () => {
    const entries = [makeEntry({ Account: 'acct1', 'TP Review Status': 'Live' })];
    const resolver = () => null;
    const rows = buildBrandRowsForExport(entries, ['Account', 'TP Review Status'], 'Hanan', resolver);
    expect(rows).toEqual([['acct1', 'Live']]);
  });

  it('behaves exactly as before when no resolver is passed (regression lock)', () => {
    const entries = [makeEntry({ Account: 'acct1' })];
    const rows = buildBrandRowsForExport(entries, ['Account'], 'Hanan');
    expect(rows).toEqual([['acct1']]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/brandExport.test.ts`
Expected: FAIL on the first new test — `buildBrandRowsForExport` currently only accepts 3
arguments and ignores a 4th, so the resolver is never consulted and `TP Page Removed Status`
resolves to `''` (no `entry.data['TP Page Removed Status']`) instead of `'05/08/2026'`.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/lib/brandExport.ts`:

```ts
import { getEntryCountry } from './tab-configs';
import { formatCellValue } from './format';
import type { Entry } from '../types/entry';

export function buildBrandRowsForExport(
  entries: Entry[],
  headers: string[],
  tab: string,
  resolveSynthetic?: (entry: Entry, header: string) => string | null,
): string[][] {
  return entries.map((entry) =>
    headers.map((header) => {
      const synthetic = resolveSynthetic?.(entry, header);
      if (synthetic !== undefined && synthetic !== null) return synthetic;
      if (header === 'Country') return getEntryCountry(entry.data, tab);
      const raw = entry.data[header];
      return raw ? formatCellValue(raw) : '';
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/brandExport.test.ts`
Expected: PASS (all tests in the file, including the 6 pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/brandExport.ts src/lib/brandExport.test.ts
git commit -m "feat: buildBrandRowsForExport accepts a synthetic-header resolver"
```

---

### Task 4: Edit Entry modal — relabel checkbox, show removal date

**Files:**
- Modify: `src/components/EditEntryModal.tsx:55-71` (Props interface), `:78-80` (component
  signature + state), `:318-337` (checkbox block)

**Interfaces:**
- Consumes: nothing new from other tasks (pure component change; Task 5 will pass the new
  prop from `BrandGroup.tsx`).
- Produces: new optional prop `initialRemovedPlatformDates?: Partial<Record<Platform, string>>`
  on `EditEntryModal`'s `Props`.

- [ ] **Step 1: Add the new prop to the `Props` interface**

In `src/components/EditEntryModal.tsx`, in the `Props` interface (around line 55-71), add one
line after `initialRemovedPlatforms?: Platform[];`:

```ts
  initialRemovedPlatforms?: Platform[];
  initialRemovedPlatformDates?: Partial<Record<Platform, string>>;
  initialOverrides?: Partial<Record<Platform, 'pause' | 'active'>>;
```

- [ ] **Step 2: Accept the prop in the component signature**

Change line 78 from:

```ts
export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles, initialRemovedPlatforms, initialOverrides }: Props) {
```

to:

```ts
export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles, initialRemovedPlatforms, initialRemovedPlatformDates, initialOverrides }: Props) {
```

No new `useState` is needed — `initialRemovedPlatformDates` is read-only display data, referenced directly from props in the render below (it never changes for the lifetime of this modal instance, matching how `brandProfiles` is already used as a plain prop, not lifted into state).

- [ ] **Step 3: Update the checkbox label (lines 318-337 area)**

Replace the checkbox `<label>` block:

```tsx
                    <label key={p} className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                      <input
                        type="checkbox"
                        checked={removedPlatforms.has(p)}
                        disabled={saving}
                        onChange={(e) =>
                          setRemovedPlatforms((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p); else next.delete(p);
                            return next;
                          })
                        }
                        className="rounded border-slate-300 text-rose-600 focus:ring-rose-400"
                      />
                      {PLATFORM_LABEL[p]} page removed
                    </label>
```

with:

```tsx
                    <label key={p} className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                      <input
                        type="checkbox"
                        checked={removedPlatforms.has(p)}
                        disabled={saving}
                        onChange={(e) =>
                          setRemovedPlatforms((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p); else next.delete(p);
                            return next;
                          })
                        }
                        className="rounded border-slate-300 text-rose-600 focus:ring-rose-400"
                      />
                      {PLATFORM_LABEL[p]} Page Removed Status
                      {removedPlatforms.has(p) && initialRemovedPlatformDates?.[p]
                        ? ` (${formatCellValue(initialRemovedPlatformDates[p]!)})`
                        : ''}
                    </label>
```

(`formatCellValue` is already imported at the top of this file — no new import needed.)

- [ ] **Step 4: Verify with a build (no automated test — this project has no
  component-render tests for modals)**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "feat: Edit Entry modal shows removal date on Page Removed Status checkbox"
```

---

### Task 5: `BrandGroup.tsx` wiring — date map, export column, modal prop

**Files:**
- Modify: `src/pages/BrandGroup.tsx:23,25` (imports), `:588` (state type), `:1006-1029`
  (`exportHeaders`), `:1031-1040` (add a sibling memo/helper), `:1663-1666` (add sibling
  computed value), `:2554` (pass new prop to `EditEntryModal`)

**Interfaces:**
- Consumes: `buildRemovedPlatformBrandDateMap` (Task 2), `sectionOf` (already imported, from
  `entryFieldSections.ts`), `buildBrandRowsForExport`'s new 4th param (Task 3),
  `PLATFORM_SHORT_LABEL` (`src/lib/scoreSummary.ts`, already exists — `tp:'TP'`, `ag:'AG'`,
  `cg:'CG'`, `wo:'WO'`).
- Produces: `initialRemovedPlatformDatesForEditEntry: Partial<Record<Platform, string>>` (new,
  parallel to the existing `initialRemovedPlatformsForEditEntry`), passed to `EditEntryModal`'s
  new `initialRemovedPlatformDates` prop from Task 4. `exportHeaders` now includes 1 synthetic
  header per active platform on the tab.

- [ ] **Step 1: Extend imports**

Line 23 currently:

```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount, getBrandGroup, BRAND_COLS, TABLE_HIDDEN_COLS, PLATFORM_SCORE_COLS, accountUsageKey } from '../lib/tab-configs';
```

No change needed here (nothing new from `tab-configs.ts`).

Line 25 currently:

```ts
import { parseScore, PLATFORM_MAX_SCORE, computeAccountPlatformUsage, passesPlatformDateFilter, PLATFORM_REVIEW_TEXT_KEYS, type Platform } from '../lib/scoreSummary';
```

Change to:

```ts
import { parseScore, PLATFORM_MAX_SCORE, PLATFORM_SHORT_LABEL, computeAccountPlatformUsage, passesPlatformDateFilter, PLATFORM_REVIEW_TEXT_KEYS, type Platform } from '../lib/scoreSummary';
```

Find the line importing from `removedPlatformBrands.ts` (currently
`import { platformRemovedKey, buildRemovedPlatformBrandSet, normalizeBrandKey } from '../lib/removedPlatformBrands';`)
and change it to also bring in the new date-map builder:

```ts
import { platformRemovedKey, buildRemovedPlatformBrandSet, buildRemovedPlatformBrandDateMap, normalizeBrandKey } from '../lib/removedPlatformBrands';
```

- [ ] **Step 2: Widen the `removedPlatformBrandRows` state type**

Line 588 currently:

```ts
  const [removedPlatformBrandRows, setRemovedPlatformBrandRows] = useState<{ tab: string; brand: string; platform: Platform }[]>([]);
```

Change to:

```ts
  const [removedPlatformBrandRows, setRemovedPlatformBrandRows] = useState<{ tab: string; brand: string; platform: Platform; removed_at: string }[]>([]);
```

(No change needed at the fetch call site, line 689 — `fetchRemovedPlatformBrands()` already
returns the wider type from Task 1, and `setRemovedPlatformBrandRows(rows)` at line 690
type-checks against the new state type automatically.)

- [ ] **Step 3: Add the date map + a `removedPlatformDatesFor` helper**

Right after the existing block at lines 1031-1040 (`removedPlatformBrandSet` /
`isPlatformRemoved` / `removedPlatformsFor`), add:

```ts
  const removedPlatformBrandDateMap = useMemo(
    () => buildRemovedPlatformBrandDateMap(removedPlatformBrandRows),
    [removedPlatformBrandRows],
  );
  function removedPlatformDateFor(brandName: string | null | undefined, platform: Platform): string | undefined {
    return brandName ? removedPlatformBrandDateMap.get(platformRemovedKey(decodedTab, brandName, platform)) : undefined;
  }
  // Every platform actually active on this tab that's currently flagged for this
  // brand, mapped to when it was flagged — feeds the Edit Entry modal's date-aware
  // checkbox label (Task 4) and the export's synthetic Page Removed Status columns.
  function removedPlatformDatesFor(brandName: string | null | undefined): Partial<Record<Platform, string>> {
    if (!brandName) return {};
    const out: Partial<Record<Platform, string>> = {};
    for (const p of getTabPlatforms(decodedTab)) {
      const date = removedPlatformDateFor(brandName, p);
      if (date) out[p] = date;
    }
    return out;
  }
```

- [ ] **Step 4: Add the synthetic export headers, before scoping/bucketing**

Replace the `exportHeaders` block (lines 1014-1029):

```ts
  const exportHeaders = (() => {
    const allFields = Array.from(new Set([...fullHeaders, ...headers]))
      .filter((h) => h.toLowerCase() !== 'id' && h !== 'Casino Password');
    const scoped = (platformFilter.length > 0 && activePlatforms.length > 1)
      ? allFields.filter((h) => {
          const sec = sectionOf(h);
          return sec !== 'tp' && sec !== 'ag' && sec !== 'cg' ? true : platformFilter.includes(sec);
        })
      : allFields;
    const buckets: Record<'account' | 'tp' | 'ag' | 'cg' | 'yesno', string[]> = {
      account: [], tp: [], ag: [], cg: [], yesno: [],
    };
    for (const h of scoped) buckets[sectionOf(h)].push(h);
    return [...buckets.account, ...buckets.tp, ...buckets.ag, ...buckets.cg, ...buckets.yesno]
      .filter((h) => session || !GUEST_HIDDEN_COLS.has(h));
  })();
```

with (only the `allFields` line changes — everything below it, including the platform-filter
`scoped` check and the bucketing loop, is untouched and now applies to the synthetic headers
for free, per the spec's placement rationale):

```ts
  // Per-platform "Page Removed Status" export columns (Task 5 of the Aug-12 Brand
  // Page Removal spec) — synthetic, not entries.data keys. Injected into allFields
  // *before* scoping/bucketing so sectionOf's existing "tp "/"ag "/"cg "-prefix
  // heuristics place them in the right section (WO falls to 'account', matching
  // every other WO field's existing precedent) and the existing Platform-filter
  // check narrows them exactly like TP/AG/CG's real columns, with no new logic.
  const removedStatusHeaders = getTabPlatforms(decodedTab).map((p) => `${PLATFORM_SHORT_LABEL[p]} Page Removed Status`);
  const exportHeaders = (() => {
    const allFields = Array.from(new Set([...fullHeaders, ...headers, ...removedStatusHeaders]))
      .filter((h) => h.toLowerCase() !== 'id' && h !== 'Casino Password');
    const scoped = (platformFilter.length > 0 && activePlatforms.length > 1)
      ? allFields.filter((h) => {
          const sec = sectionOf(h);
          return sec !== 'tp' && sec !== 'ag' && sec !== 'cg' ? true : platformFilter.includes(sec);
        })
      : allFields;
    const buckets: Record<'account' | 'tp' | 'ag' | 'cg' | 'yesno', string[]> = {
      account: [], tp: [], ag: [], cg: [], yesno: [],
    };
    for (const h of scoped) buckets[sectionOf(h)].push(h);
    return [...buckets.account, ...buckets.tp, ...buckets.ag, ...buckets.cg, ...buckets.yesno]
      .filter((h) => session || !GUEST_HIDDEN_COLS.has(h));
  })();
```

- [ ] **Step 5: Build the resolver and pass it into `buildBrandRowsForExport`**

Find the `ExportMenuButton` usage (around line 1697-1702):

```tsx
          <ExportMenuButton
            headers={exportHeaders.map((h) => getColLabel(h, decodedTab))}
            getRows={() => buildBrandRowsForExport(sorted, exportHeaders, decodedTab)}
            filenameBase={tabToSlug(decodedTab)}
            disabled={loading}
          />
```

Change the `getRows` line to pass a resolver:

```tsx
          <ExportMenuButton
            headers={exportHeaders.map((h) => getColLabel(h, decodedTab))}
            getRows={() => buildBrandRowsForExport(sorted, exportHeaders, decodedTab, (entry, header) => {
              const platform = (Object.entries(PLATFORM_SHORT_LABEL) as [Platform, string][])
                .find(([, label]) => `${label} Page Removed Status` === header)?.[0];
              if (!platform || !brandCol) return null;
              const brandName = entry.data[brandCol];
              const date = removedPlatformDateFor(brandName, platform);
              return date ? formatCellValue(date) : '';
            })}
            filenameBase={tabToSlug(decodedTab)}
            disabled={loading}
          />
```

(`brandCol` is already computed earlier in this component, at line 1054; `formatCellValue` is
already imported at the top of `BrandGroup.tsx`.)

- [ ] **Step 6: Compute the modal's date prop and pass it**

Right after the existing block at lines 1663-1666:

```ts
  const initialRemovedPlatformsForEditEntry: Platform[] =
    editEntry && brandCol ? removedPlatformsFor(editEntry.data[brandCol]) : [];
  const initialOverridesForEditEntry: Partial<Record<Platform, OverrideState>> =
    editEntry && brandCol ? overridesFor(editEntry.data[brandCol]) : {};
```

add:

```ts
  const initialRemovedPlatformsForEditEntry: Platform[] =
    editEntry && brandCol ? removedPlatformsFor(editEntry.data[brandCol]) : [];
  const initialRemovedPlatformDatesForEditEntry: Partial<Record<Platform, string>> =
    editEntry && brandCol ? removedPlatformDatesFor(editEntry.data[brandCol]) : {};
  const initialOverridesForEditEntry: Partial<Record<Platform, OverrideState>> =
    editEntry && brandCol ? overridesFor(editEntry.data[brandCol]) : {};
```

Then in the `<EditEntryModal>` JSX (line 2554), add the new prop right after
`initialRemovedPlatforms`:

```tsx
          initialRemovedPlatforms={initialRemovedPlatformsForEditEntry}
          initialRemovedPlatformDates={initialRemovedPlatformDatesForEditEntry}
          initialOverrides={initialOverridesForEditEntry}
```

- [ ] **Step 7: Run the full test suite and build**

Run: `npx vitest run`
Expected: PASS (no test file directly covers `BrandGroup.tsx`'s render logic — this task's
correctness rests on Tasks 1-3's unit tests plus this step's regression check that nothing
else broke).

Run: `npm run build`
Expected: succeeds with no new TypeScript errors (this is the step that actually catches a
typo'd prop name or missing import, since there's no component test here).

- [ ] **Step 8: Manual verification**

With `npm run dev` running and signed in: open a multi-platform brand tab (e.g. Rooster
Partners), open Edit Entry on any row, check one platform's "Page Removed Status" checkbox,
save. Re-open Edit Entry on the same row — the checkbox should show `(DD/MM/YYYY)` with
today's date appended to its label. Export the tab (CSV or Excel) — confirm a
`{PLATFORM} Page Removed Status` column exists for each active platform, holding that date for
the row just flagged and blank for every other row. Uncheck it, save, export again — confirm
the column is blank for that row again.

- [ ] **Step 9: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: Brand Tabs export gains per-platform Page Removed Status columns"
```

---

### Task 6: `notify-brand-removed` Edge Function

**Files:**
- Create: `supabase/functions/notify-brand-removed/index.ts`
- Create: `supabase/functions/notify-brand-removed/index_test.ts`

**Interfaces:**
- Produces: `sendBrandRemovedNotification(payload, client, resendApiKey, fetchFn?): Promise<{ sent: number }>` (exported for testing) and the `Deno.serve` HTTP handler that parses the
  request body and calls it.
- Request body contract (documented here since Task 7's client is the only caller):
  ```ts
  interface NotifyBrandRemovedPayload {
    brand: string;
    tabLabel: string;       // already human-readable, e.g. "Rooster Partners"
    platformLabel: string;  // already human-readable, e.g. "TrustPilot"
    removedBy: string | null;
    removedAtLabel: string; // already formatted, e.g. "12/08/2026"
    link: string;           // full URL back to the brand's tab page
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/notify-brand-removed/index_test.ts`:

```ts
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendBrandRemovedNotification, type NotifyBrandRemovedPayload } from './index.ts';

function fakeProfilesClient(emails: string[]): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: emails.map((email) => ({ email })), error: null }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

const PAYLOAD: NotifyBrandRemovedPayload = {
  brand: 'Prive Casino',
  tabLabel: 'TP Brand Injection',
  platformLabel: 'TrustPilot',
  removedBy: 'leo@optinetsolutions.com',
  removedAtLabel: '12/08/2026',
  link: 'https://dashboard.example.com/brands/tp-brand-injection?brand=Prive%20Casino',
};

Deno.test('sendBrandRemovedNotification sends one Resend call to every approved profile email', async () => {
  const client = fakeProfilesClient(['a@example.com', 'b@example.com']);
  const calls: unknown[] = [];
  const fakeFetch = async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ id: 'abc' }), { status: 200 });
  };
  const result = await sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch);
  assertEquals(result.sent, 2);
  assertEquals(calls.length, 1);
  assertEquals((calls[0] as { to: string[] }).to, ['a@example.com', 'b@example.com']);
  assertEquals((calls[0] as { subject: string }).subject, '[Forums Dashboard] Prive Casino — TrustPilot page removed on TP Brand Injection');
});

Deno.test('sendBrandRemovedNotification sends nothing and returns sent:0 when no approved profiles exist', async () => {
  const client = fakeProfilesClient([]);
  let fetchCalled = false;
  const fakeFetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  const result = await sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch);
  assertEquals(result.sent, 0);
  assertEquals(fetchCalled, false);
});

Deno.test('sendBrandRemovedNotification throws when Resend responds non-2xx', async () => {
  const client = fakeProfilesClient(['a@example.com']);
  const fakeFetch = async () => new Response('{"message":"invalid"}', { status: 422 });
  await assertRejects(
    () => sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch),
    Error,
    'Resend 422',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/notify-brand-removed/`
Expected: FAIL — `./index.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/notify-brand-removed/index.ts`:

```ts
// supabase/functions/notify-brand-removed/index.ts
// Fired client-side right after a Brand Tabs Edit Entry save newly flags a
// platform's page as removed (setBrandPlatformRemoved(..., true) succeeding).
// Deliberately holds no imports from src/lib — a thin proxy to Resend that
// receives every human-readable string it needs already formatted, so it
// can't drift from src/lib's own PLATFORM_LABEL/formatCellValue/tabToSlug.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'Forums Dashboard <onboarding@resend.dev>';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export interface NotifyBrandRemovedPayload {
  brand: string;
  tabLabel: string;
  platformLabel: string;
  removedBy: string | null;
  removedAtLabel: string;
  link: string;
}

export async function sendBrandRemovedNotification(
  payload: NotifyBrandRemovedPayload,
  client: SupabaseClient,
  resendApiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ sent: number }> {
  const { data, error } = await client.from('profiles').select('email').eq('approved', true);
  if (error) throw error;
  const emails = ((data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);
  if (emails.length === 0) return { sent: 0 };

  const subject = `[Forums Dashboard] ${payload.brand} — ${payload.platformLabel} page removed on ${payload.tabLabel}`;
  const text = [
    `${payload.platformLabel}'s page for "${payload.brand}" (${payload.tabLabel}) was flagged as removed.`,
    '',
    `Flagged by: ${payload.removedBy ?? 'unknown'}`,
    `Removed on: ${payload.removedAtLabel}`,
    '',
    `View this brand: ${payload.link}`,
  ].join('\n');

  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: emails, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
  return { sent: emails.length };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!req.headers.get('authorization')) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!RESEND_API_KEY) return jsonResponse({ error: 'Notifications not configured' }, 500);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }
  const { brand, tabLabel, platformLabel, removedBy, removedAtLabel, link } = body ?? {};
  if (!brand || !tabLabel || !platformLabel || !removedAtLabel || !link) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }

  try {
    const client = createClient(SUPABASE_URL, SERVICE_ROLE);
    const result = await sendBrandRemovedNotification(
      { brand, tabLabel, platformLabel, removedBy: removedBy ?? null, removedAtLabel, link },
      client,
      RESEND_API_KEY,
    );
    return jsonResponse(result);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Notification failed' }, 500);
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/notify-brand-removed/`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Type-check the function**

Run: `deno check supabase/functions/notify-brand-removed/index.ts`
Expected: no errors (this function has no local `deno.json`/import map since it only imports
via full URL specifiers and the ambient `@supabase/supabase-js` npm specifier resolves through
the repo's root — if this fails with an unresolved-specifier error, add a minimal
`supabase/functions/notify-brand-removed/deno.json` mirroring
`supabase/functions/generate-weekly-schedule/deno.json`'s import map, scoped to just
`@supabase/supabase-js`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/notify-brand-removed/
git commit -m "feat: add notify-brand-removed Edge Function"
```

---

### Task 7: Client-side `notifyBrandRemoved` + Edge Function URL export

**Files:**
- Create: `src/lib/brandRemovedNotification.ts`
- Create: `src/lib/brandRemovedNotification.test.ts`
- Modify: `src/lib/supabase.ts` (add `VITE_NOTIFY_BRAND_REMOVED_URL` export)

**Interfaces:**
- Consumes: nothing from other tasks — this mirrors `src/lib/reviewTranslation.ts`'s existing
  `translateReviewText` pattern exactly (session-token-first, anon-key-fallback auth; friendly
  error on any failure).
- Produces: `notifyBrandRemoved(payload: NotifyBrandRemovedPayload): Promise<void>` — the
  `NotifyBrandRemovedPayload` shape matches Task 6's Edge Function contract exactly (this file
  defines its own copy of the interface, since it can't import from a Deno function's
  `index.ts`).

- [ ] **Step 1: Add the URL export to `supabase.ts`**

In `src/lib/supabase.ts`, after the existing `TRANSLATE_REVIEW_URL` export, add:

```ts
// notify-brand-removed Edge Function URL. Set in Vercel env once the
// notify-brand-removed function is deployed (also needs RESEND_API_KEY set via
// `supabase secrets set RESEND_API_KEY=...`). Empty string means a newly-flagged
// "page removed" checkbox saves fine but the notification silently no-ops.
export const NOTIFY_BRAND_REMOVED_URL = import.meta.env?.VITE_NOTIFY_BRAND_REMOVED_URL ?? '';
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/brandRemovedNotification.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({ data: { session: null } }),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
  SUPABASE_ANON_KEY: 'test-anon-key',
  NOTIFY_BRAND_REMOVED_URL: 'https://example.com/notify-brand-removed',
}));

import { notifyBrandRemoved } from './brandRemovedNotification';

const PAYLOAD = {
  brand: 'Prive Casino',
  tabLabel: 'TP Brand Injection',
  platformLabel: 'TrustPilot',
  removedBy: 'leo@optinetsolutions.com',
  removedAtLabel: '12/08/2026',
  link: 'https://dashboard.example.com/brands/tp-brand-injection?brand=Prive%20Casino',
};

describe('notifyBrandRemoved', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('resolves on a successful response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ sent: 2 }) });
    await expect(notifyBrandRemoved(PAYLOAD)).resolves.toBeUndefined();
  });

  it('sends the anon key, a bearer token, and the payload to NOTIFY_BRAND_REMOVED_URL', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ sent: 1 }) });
    await notifyBrandRemoved(PAYLOAD);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/notify-brand-removed',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-anon-key', Authorization: expect.stringMatching(/^Bearer /) }),
        body: JSON.stringify(PAYLOAD),
      }),
    );
  });

  it('throws on a non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(notifyBrandRemoved(PAYLOAD)).rejects.toThrow();
  });

  it('throws when fetch itself rejects', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    await expect(notifyBrandRemoved(PAYLOAD)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/brandRemovedNotification.test.ts`
Expected: FAIL — `./brandRemovedNotification` module doesn't exist yet.

- [ ] **Step 4: Write minimal implementation**

Create `src/lib/brandRemovedNotification.ts`:

```ts
import { supabase, SUPABASE_ANON_KEY, NOTIFY_BRAND_REMOVED_URL } from './supabase';

export interface NotifyBrandRemovedPayload {
  brand: string;
  tabLabel: string;
  platformLabel: string;
  removedBy: string | null;
  removedAtLabel: string;
  link: string;
}

// Best-effort — the caller (BrandGroup.tsx) already succeeded in writing the
// removed_platform_brands flag before calling this; a failure here must never
// be mistaken for the flag write itself failing.
export async function notifyBrandRemoved(payload: NotifyBrandRemovedPayload): Promise<void> {
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }

  const res = await fetch(NOTIFY_BRAND_REMOVED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to send the brand-removed notification email.');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/brandRemovedNotification.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase.ts src/lib/brandRemovedNotification.ts src/lib/brandRemovedNotification.test.ts
git commit -m "feat: add client-side notifyBrandRemoved caller"
```

---

### Task 8: Wire the notification call into `BrandGroup.tsx`'s save handler

**Files:**
- Modify: `src/pages/BrandGroup.tsx` (imports, and the `onSave` handler's platform-diff loop
  around line 2587-2591)

**Interfaces:**
- Consumes: `notifyBrandRemoved` (Task 7), `PLATFORM_LABEL` (`src/lib/scoreSummary.ts`, already
  has a `wo` entry too — full names, for the email's human-readable prose, distinct from the
  short-code `PLATFORM_SHORT_LABEL` Task 5 uses for the export column name), `session` (already
  destructured from `useAuth()` at line 586), `tabDisplayName`/`tabToSlug` (already imported at
  the top of `BrandGroup.tsx`), `formatCellValue` (already imported).

- [ ] **Step 1: Add imports**

Add near the top of `src/pages/BrandGroup.tsx`, alongside the other `src/lib` imports:

```ts
import { notifyBrandRemoved } from '../lib/brandRemovedNotification';
```

Extend the existing `scoreSummary` import (from Task 5, Step 1) to also bring in
`PLATFORM_LABEL`:

```ts
import { parseScore, PLATFORM_MAX_SCORE, PLATFORM_LABEL, PLATFORM_SHORT_LABEL, computeAccountPlatformUsage, passesPlatformDateFilter, PLATFORM_REVIEW_TEXT_KEYS, type Platform } from '../lib/scoreSummary';
```

- [ ] **Step 2: Fire the notification on a true flag transition**

The existing loop (around line 2587-2591) currently reads:

```ts
                  for (const p of getTabPlatforms(decodedTab)) {
                    if (wasRemoved.has(p) !== nowRemoved.has(p)) {
                      await setBrandPlatformRemoved(targetTab, brandName, p, nowRemoved.has(p));
                    }
                  }
```

Change it to:

```ts
                  for (const p of getTabPlatforms(decodedTab)) {
                    if (wasRemoved.has(p) !== nowRemoved.has(p)) {
                      const willBeRemoved = nowRemoved.has(p);
                      await setBrandPlatformRemoved(targetTab, brandName, p, willBeRemoved);
                      if (willBeRemoved) {
                        try {
                          await notifyBrandRemoved({
                            brand: brandName,
                            tabLabel: tabDisplayName(targetTab),
                            platformLabel: PLATFORM_LABEL[p],
                            removedBy: session?.user.email ?? null,
                            removedAtLabel: formatCellValue(new Date().toISOString()),
                            link: `${window.location.origin}/brands/${tabToSlug(targetTab)}?brand=${encodeURIComponent(brandName)}`,
                          });
                        } catch {
                          setToast({
                            message: `${brandName}'s ${PLATFORM_LABEL[p]} page was flagged removed, but the notification email failed to send.`,
                            kind: 'error',
                          });
                        }
                      }
                    }
                  }
```

- [ ] **Step 3: Run the full test suite and build**

Run: `npx vitest run`
Expected: PASS (this change has no dedicated unit test — `notifyBrandRemoved` itself is fully
covered by Task 7's tests, and this wiring is a single conditional call inside an
already-manually-verified save handler; a `BrandGroup.tsx` render/interaction test would
require standing up React Testing Library for this file for the first time, which is out of
scope here — covered instead by Step 4's manual check).

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 4: Manual verification**

With `npm run dev` running and signed in, and with `VITE_NOTIFY_BRAND_REMOVED_URL` either unset
(confirm the Toast error appears, since `fetch('')` rejects) or pointed at a locally-served
Edge Function (`supabase functions serve notify-brand-removed`) with a real `RESEND_API_KEY`
secret: open Edit Entry on a brand, check a platform's "Page Removed Status" checkbox, save.
Confirm either (a) no error Toast appears and — if a real Resend key is configured — an email
arrives at every approved user's address, or (b) the "notification email failed to send" Toast
appears while the checkbox itself still shows checked+dated on modal re-open (proving the flag
write succeeded independently of the notification).

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: notify approved users by email when a brand page is flagged removed"
```

---

### Task 9: Docs, env example, and final full verification

**Files:**
- Modify: `.env.example`
- Modify: `docs/task-history.md`

- [ ] **Step 1: Document the new env var and secrets**

In `.env.example`, after the existing `VITE_AI_ASSISTANT_URL` block, add:

```
# VITE_NOTIFY_BRAND_REMOVED_URL : fired when a brand's platform page is flagged "removed" in
#   the Edit Entry modal, to email every approved user. The notify-brand-removed Edge Function
#   holds RESEND_API_KEY (set via `supabase secrets set RESEND_API_KEY=...`) and optionally
#   RESEND_FROM_EMAIL (defaults to Resend's sandbox sender, which can only deliver to the
#   Resend account owner's own verified email until a sending domain is verified).
VITE_NOTIFY_BRAND_REMOVED_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/notify-brand-removed
```

- [ ] **Step 2: Append the task-history.md entry**

Find the highest `## Task N` number in `docs/task-history.md` (at the time of writing this
plan it was 208 — re-check before writing, since other work may have landed since) and append,
right before the file's final `---`:

```markdown
## Task <N+1>: Brand Page Removal — Email Notification + Page Removed Status
**Date:** August 12, 2026

Added an email notification and an export column for the existing `removed_platform_brands`
"page removed" flag. When a user checks a platform's "Page Removed Status" checkbox in the
Edit Entry modal and saves, every approved dashboard user (`profiles.approved = true`) now gets
an email via a new `notify-brand-removed` Edge Function (Resend HTTP API) — best-effort; a
failed send never rolls back the flag write, surfaced instead via the existing error-Toast
pattern. The checkbox's label (previously "{Platform} page removed") is now
"{Platform} Page Removed Status", and once checked, shows the removal date
(`removed_at`, which already existed on the table unused until now) — e.g.
"TrustPilot Page Removed Status (12/08/2026)".

Brand Tabs' CSV/Excel export gains one new synthetic column per platform active on the tab
(`TP Page Removed Status`, `AG Page Removed Status`, etc. — `PLATFORM_SHORT_LABEL`, matching
every other export column's short-code convention, not the modal/email's full-name
`PLATFORM_LABEL`), holding the formatted removal date or blank. These aren't `entries.data`
keys — `exportHeaders` (`BrandGroup.tsx`, from Task 208) now injects them into its header list
*before* the existing scoping/bucketing step, letting `entryFieldSections.ts`'s `sectionOf`
place and platform-filter them via its existing `"tp "`/`"ag "`/`"cg "`-prefix heuristics with
zero new placement code — a design-time simplification caught during the spec's own
self-review. `buildBrandRowsForExport` (`brandExport.ts`) gained an optional resolver
parameter so it can special-case these synthetic headers without becoming brand/tab-aware
itself; a new `buildRemovedPlatformBrandDateMap` (`removedPlatformBrands.ts`) sits alongside —
not replacing — the existing `buildRemovedPlatformBrandSet` (9 files import that function;
its signature was left untouched). `fetchRemovedPlatformBrands` now additionally selects
`removed_at`, additive and safe for its 3 existing consumers.

The Edge Function itself deliberately imports nothing from `src/lib` — the client
(`BrandGroup.tsx`, via a new `src/lib/brandRemovedNotification.ts` mirroring
`reviewTranslation.ts`'s exact request pattern) sends every human-readable string already
formatted (tab display name, full platform label, formatted date, deep link), so the Deno
function can't drift from `src/lib`'s own label/date-formatting logic — the same
duplication-avoidance reasoning already applied elsewhere in this project (Task 180 and
others).

Full test suite and build pass; the new function's own Deno suite (3 tests) and `deno check`
both pass. **Not yet live** — same as the AI Assistant/SSO callback before it, this requires
manual setup no agent can perform: create a Resend account, verify a sending domain (or accept
sandbox-only delivery to the Resend account owner's own email in the meantime), then
`supabase secrets set RESEND_API_KEY=... RESEND_FROM_EMAIL=...`, `supabase functions deploy
notify-brand-removed`, and set `VITE_NOTIFY_BRAND_REMOVED_URL` in Vercel. Until then, checking
the "Page Removed Status" checkbox still saves correctly and shows the date in both the modal
and the export — only the email itself doesn't go out (surfaced to the user via the existing
error Toast). Spec: `docs/superpowers/specs/2026-08-12-brand-page-removal-notification-design.md`.
Plan: `docs/superpowers/plans/2026-08-12-brand-page-removal-notification.md`.
```

- [ ] **Step 3: Final full verification**

Run, in order:

```bash
npm run build
npx vitest run
deno check supabase/functions/notify-brand-removed/index.ts
deno test supabase/functions/notify-brand-removed/
```

Expected: all 4 succeed. This is the final gate before considering the plan complete — if any
of Tasks 1-8 left something broken that its own task-level verification missed (e.g. a shared
import used elsewhere), this is where it surfaces.

- [ ] **Step 4: Commit**

```bash
git add .env.example docs/task-history.md
git commit -m "docs: Brand Page Removal notification — task history, env example"
```

---

## Self-Review Notes

- **Spec coverage:** Requirement 1 (email) → Tasks 6-8. Requirement 2 (modal relabel + date) →
  Task 4. Requirement 3 (export column) → Tasks 2, 3, 5. "No new stored field" constraint →
  satisfied throughout (no migration in any task). "Setup required" section → Task 9 + the
  Global Constraints note.
- **Placeholder scan:** no TBD/TODO; every step has real, complete code.
- **Type consistency:** `NotifyBrandRemovedPayload` is defined identically (by hand, since Deno
  and Vite can't share a type import here) in Task 6 (`index.ts`) and Task 7
  (`brandRemovedNotification.ts`) — both list the same 6 fields in the same order; Task 8's call
  site constructs an object literal matching both. `PLATFORM_SHORT_LABEL` (export column
  naming, Task 5) vs. `PLATFORM_LABEL` (modal/email prose, Tasks 4 and 8) are intentionally
  different maps — flagged explicitly in both tasks' text so an implementer doesn't
  "helpfully" unify them.
