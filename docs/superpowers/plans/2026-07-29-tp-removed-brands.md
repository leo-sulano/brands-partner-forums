# TP-Removed Brand Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let brands whose Trustpilot page has been delisted be flagged per `(tab, brand)`, show a red circle-X badge next to their name in `BrandGroup` tables, exclude them entirely from the TrustPilot-platform Score Summary, and let any brand be flagged/unflagged from the Edit Entry modal.

**Architecture:** A new Supabase table `removed_tp_brands` is the single source of truth — a brand is flagged purely by a row existing for its `(tab, brand)` pair. A shared key-matching helper (`src/lib/removedTpBrands.ts`) keeps every reader (the badge in `BrandGroup.tsx`, the exclusion logic in `scoreSummary.ts`) in sync on how `(tab, brand)` pairs are matched (case-insensitive, trimmed brand). `scoreSummary.ts`'s three compute functions gain an optional `removedTpBrands` set param and skip matching entries when `platform === 'tp'`.

**Tech Stack:** Vite 6 · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres) · Vitest

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-tp-removed-brands-design.md` — read it once before starting; every task below implements one section of it.
- Flag is keyed by `(tab, brand)`, matched case-insensitively/trimmed on brand — implemented once in `src/lib/removedTpBrands.ts` and reused everywhere (never re-implement the matching logic inline).
- Exclusion only applies when `platform === 'tp'` in `scoreSummary.ts` — AG/CG/WO views are never affected.
- No new UI screen for managing flags — toggling only happens via the Edit Entry modal, in the context of editing that brand's entries.
- This repo has no React component test harness (no `@testing-library`, no jsdom setup) — do not attempt to add component-level automated tests; verify UI changes manually via `npm run dev`. Pure-logic modules (`removedTpBrands.ts`, `scoreSummary.ts`) get Vitest tests same as existing `*.test.ts` files.
- Verify TypeScript correctness with `npm run build` (per project convention — `tsc --noEmit` alone checks nothing here, root tsconfig is references-only).

---

### Task 1: Migration — `removed_tp_brands` table + seed data

**Files:**
- Create: `supabase/migrations/20260729130000_add_removed_tp_brands.sql`

**Interfaces:**
- Produces: table `public.removed_tp_brands(id uuid, tab text, brand text, removed_by text, removed_at timestamptz)`, unique on `(tab, brand)`. Every later task's `fetchRemovedTpBrands`/`setBrandTpRemoved` in `queries.ts` reads/writes this table.

- [ ] **Step 1: Write the migration file**

```sql
-- A brand's Trustpilot page can be delisted entirely (Trustpilot takes the
-- whole review page down), independent of any single review's status. This
-- table records that fact per (tab, brand) — a brand is flagged purely by a
-- row existing here. Toggling off deletes the row (see setBrandTpRemoved in
-- src/lib/queries.ts). Matching is case-insensitive/trimmed on brand, done in
-- src/lib/removedTpBrands.ts — every reader (BrandGroup's badge, Score
-- Summary's TP-view exclusion) goes through that shared helper.

create table public.removed_tp_brands (
  id          uuid primary key default gen_random_uuid(),
  tab         text not null,
  brand       text not null,
  removed_by  text,
  removed_at  timestamptz not null default now(),
  unique (tab, brand)
);

alter table public.removed_tp_brands enable row level security;

create policy "anyone can read removed_tp_brands"
  on public.removed_tp_brands for select using (true);
create policy "approved users can insert removed_tp_brands"
  on public.removed_tp_brands for insert with check (public.is_approved());
create policy "approved users can delete removed_tp_brands"
  on public.removed_tp_brands for delete using (public.is_approved());

-- Seed: brands whose TP page is already known to be delisted.
insert into public.removed_tp_brands (tab, brand) values
  ('TP Brand Injection', 'NovaJackpot Casino'),
  ('TP Brand Injection', 'Lapalingo Casino'),
  ('TP Brand Injection', 'Prive Casino'),
  ('TP Brand Injection', 'Rabona Casino'),
  ('TP Brand Injection', 'Monsterwin Casino'),
  ('TP Brand Injection', 'Cazeus Casino'),
  ('TP Affiliate', 'Deutschlands Online Casino Spielhalle 2026'),
  ('TP Affiliate', 'Bestes Online Casino Deutschland'),
  ('TP Affiliate', 'Bestes Online Casino Deutschland Spielhalle'),
  ('TP Affiliate', 'Online Casino Deutschland'),
  ('TP Affiliate', 'Best Online Casinos Review Nz'),
  ('Hanan', 'Pribet.com'),
  ('Hanan', 'WinMega.com'),
  ('Hanan', 'RealSpin.com')
on conflict (tab, brand) do nothing;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push` (from the project root; requires the local checkout to already be linked — see [[project_supabase_worktree_link]] if this is a fresh worktree).

- [ ] **Step 3: Verify manually**

In the Supabase SQL editor: `select tab, brand from public.removed_tp_brands order by tab, brand;` — expect exactly the 14 seeded rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729130000_add_removed_tp_brands.sql
git commit -m "feat: add removed_tp_brands table with seed data for known delisted brands"
```

---

### Task 2: Shared key-matching helper — `src/lib/removedTpBrands.ts`

**Files:**
- Create: `src/lib/removedTpBrands.ts`
- Test: `src/lib/removedTpBrands.test.ts`

**Interfaces:**
- Produces: `tpRemovedKey(tab: string, brand: string): string`, `buildRemovedTpBrandSet(rows: { tab: string; brand: string }[]): Set<string>`. Task 3 (`scoreSummary.ts`) and Task 6/8 (`BrandGroup.tsx`) both import these — never reimplement the matching logic separately.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/removedTpBrands.test.ts
import { describe, it, expect } from 'vitest';
import { tpRemovedKey, buildRemovedTpBrandSet } from './removedTpBrands';

describe('tpRemovedKey', () => {
  it('matches regardless of brand casing or surrounding whitespace', () => {
    expect(tpRemovedKey('Hanan', 'Pribet.com')).toBe(tpRemovedKey('Hanan', '  PRIBET.COM  '));
  });

  it('treats the same brand name in different tabs as distinct', () => {
    expect(tpRemovedKey('Hanan', 'Pribet.com')).not.toBe(tpRemovedKey('Trybet', 'Pribet.com'));
  });
});

describe('buildRemovedTpBrandSet', () => {
  it('builds a set whose membership matches via tpRemovedKey regardless of casing', () => {
    const set = buildRemovedTpBrandSet([{ tab: 'Hanan', brand: 'Pribet.com' }]);
    expect(set.has(tpRemovedKey('Hanan', 'pribet.com'))).toBe(true);
    expect(set.has(tpRemovedKey('Hanan', 'WinMega.com'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- removedTpBrands`
Expected: FAIL — `Cannot find module './removedTpBrands'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/removedTpBrands.ts
// A brand's Trustpilot page can be delisted entirely (Trustpilot removed the
// whole review page), independent of any single review's status. Flagged
// brands live in the `removed_tp_brands` table, keyed by (tab, brand). This
// key format is the single shared definition of that match — every reader
// (BrandGroup's badge, scoreSummary's TP-view exclusion) goes through it so
// they can't drift out of sync with each other or with what's actually
// stored in the table.

export function tpRemovedKey(tab: string, brand: string): string {
  return `${tab}::${brand.trim().toLowerCase()}`;
}

export function buildRemovedTpBrandSet(rows: { tab: string; brand: string }[]): Set<string> {
  return new Set(rows.map((r) => tpRemovedKey(r.tab, r.brand)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- removedTpBrands`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/removedTpBrands.ts src/lib/removedTpBrands.test.ts
git commit -m "feat: add shared (tab, brand) key-matching helper for TP-removed flags"
```

---

### Task 3: Score Summary exclusion — `src/lib/scoreSummary.ts`

**Files:**
- Modify: `src/lib/scoreSummary.ts`
- Test: `src/lib/scoreSummary.test.ts`

**Interfaces:**
- Consumes: `tpRemovedKey` from `./removedTpBrands` (Task 2).
- Produces: `computeScoreSummary(entries, range, pinnedFirst, platform, removedTpBrands?)`, `computeSuccessRates(entries, platform, removedTpBrands?)`, `computeTabSuccessRates(entries, platform, removedTpBrands?)` — all with `removedTpBrands` as an optional final `Set<string>` param, defaulting to an empty set. Task 9 (`ScoreSummaryPanel.tsx`) calls all three with this new argument.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scoreSummary.test.ts` (new import + three new `describe` blocks):

```typescript
import { computeScoreSummary, computeSuccessRates, computeTabSuccessRates, parseScore, ratingLabel } from './scoreSummary';
import { buildRemovedTpBrandSet } from './removedTpBrands';
```

```typescript
describe('computeScoreSummary — removedTpBrands exclusion', () => {
  const noRange = { from: null, to: null };

  it('excludes a flagged brand entirely from the tp platform view', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published', 'TP Score added': '5' }),
      makeEntry('2', 'Hanan', { Brands: 'WinMega.com', 'TP Review Status': 'Published', 'TP Score added': '4' }),
    ];
    const removed = buildRemovedTpBrandSet([{ tab: 'Hanan', brand: 'Pribet.com' }]);
    const result = computeScoreSummary(entries, noRange, [], 'tp', removed);
    expect(result.brands.map((b) => b.brand)).toEqual(['WinMega.com']);
  });

  it('does not exclude a flagged brand from a non-tp platform view', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'AG Review Status': 'Published', 'AG Score added': '9' }),
    ];
    const removed = buildRemovedTpBrandSet([{ tab: 'Hanan', brand: 'Pribet.com' }]);
    const result = computeScoreSummary(entries, noRange, [], 'ag', removed);
    expect(result.brands).toHaveLength(1);
  });
});

describe('computeSuccessRates — removedTpBrands exclusion', () => {
  it('excludes a flagged brand from the tp per-brand success rate map', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedTpBrandSet([{ tab: 'Hanan', brand: 'Pribet.com' }]);
    const result = computeSuccessRates(entries, 'tp', removed);
    expect(result.has('Hanan Pribet.com')).toBe(false);
  });
});

describe('computeTabSuccessRates — removedTpBrands exclusion', () => {
  it('excludes a flagged brand from the tp tab-level success rate total', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Brands: 'WinMega.com', 'TP Review Status': 'Removed' }),
    ];
    const removed = buildRemovedTpBrandSet([{ tab: 'Hanan', brand: 'Pribet.com' }]);
    const result = computeTabSuccessRates(entries, 'tp', removed);
    expect(result.get('Hanan')).toEqual({ live: 0, removed: 1, rate: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- scoreSummary`
Expected: FAIL — extra 5th/3rd argument is accepted (JS ignores it) but exclusion doesn't happen yet, so `result.brands` still contains the flagged brand / the map still has the key / the tab total still includes the flagged brand's counts.

- [ ] **Step 3: Implement the exclusion**

In `src/lib/scoreSummary.ts`, add the import:

```typescript
import { tpRemovedKey } from './removedTpBrands';
```

Change `computeScoreSummary`'s signature and body (currently lines 163-228 — the `brand`/status-filter/`tab` block):

```typescript
export function computeScoreSummary(
  entries: Entry[],
  range: DateRange,
  pinnedFirst: string[] = [],
  platform: Platform = 'tp',
  removedTpBrands: Set<string> = new Set(),
): ScoreSummaryResult {
```

Inside the `for (const e of entries)` loop, move the `tab` lookup up so it's available alongside `brand`, and add the exclusion check right after the status filter:

```typescript
    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    const tab = e.tab ?? '';

    const status = (pick(d, statusKeys) ?? '').trim().toLowerCase();
    if (status !== 'published') continue;

    if (platform === 'tp' && removedTpBrands.has(tpRemovedKey(tab, brand))) continue;

    const date = parsePostDate(pick(d, dateKeys));
```

(Remove the old `const tab = e.tab ?? '';` line further down in the loop — it now lives above, right after `brand`.)

Change `computeSuccessRates`'s signature and body (currently lines 284-318):

```typescript
export function computeSuccessRates(
  entries: Entry[],
  platform: Platform,
  removedTpBrands: Set<string> = new Set(),
): Map<string, SuccessRate> {
```

Inside its loop, after computing `brand`, `status`, and `tab`, add the same check before bucketing:

```typescript
    const tab = e.tab ?? '';
    if (platform === 'tp' && removedTpBrands.has(tpRemovedKey(tab, brand))) continue;

    const key = `${tab} ${brand}`;
```

Change `computeTabSuccessRates`'s signature and body (currently lines 326-355) — this one has no brand resolution today, so add it:

```typescript
export function computeTabSuccessRates(
  entries: Entry[],
  platform: Platform,
  removedTpBrands: Set<string> = new Set(),
): Map<string, SuccessRate> {
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const buckets = new Map<string, { live: number; removed: number }>();

  for (const e of entries) {
    const d = e.data ?? {};
    const status = (pick(d, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;

    const tab = e.tab ?? '';
    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (platform === 'tp' && brand && removedTpBrands.has(tpRemovedKey(tab, brand))) continue;

    let bucket = buckets.get(tab);
```

(The rest of the function body — `if (!bucket) { ... }`, the `isLiveStatus`/`isRemovedStatus` branch, and the final `result` construction — stays unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- scoreSummary`
Expected: PASS (all existing tests plus the 3 new ones — 20 total)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts
git commit -m "feat: exclude TP-removed brands from TrustPilot-platform Score Summary"
```

---

### Task 4: `src/lib/queries.ts` — fetch and toggle the flag

**Files:**
- Modify: `src/lib/queries.ts`

**Interfaces:**
- Produces: `fetchRemovedTpBrands(): Promise<{ tab: string; brand: string }[]>`, `setBrandTpRemoved(tab: string, brand: string, removed: boolean): Promise<void>`. Task 6 and Task 9 call `fetchRemovedTpBrands`; Task 8 calls `setBrandTpRemoved`.

- [ ] **Step 1: Add the functions**

Add near the other read queries (after `fetchAvailableTabs`, ~line 205 in the current file):

```typescript
export async function fetchRemovedTpBrands(): Promise<{ tab: string; brand: string }[]> {
  const { data, error } = await supabase
    .from('removed_tp_brands')
    .select('tab, brand');
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string }[];
}
```

Add near the other write operations (after `moveEntryToTab`, ~line 564 in the current file):

```typescript
export async function setBrandTpRemoved(tab: string, brand: string, removed: boolean): Promise<void> {
  if (removed) {
    const { error } = await supabase
      .from('removed_tp_brands')
      .upsert({ tab, brand, removed_by: await currentUserEmail() }, { onConflict: 'tab,brand' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('removed_tp_brands')
      .delete()
      .eq('tab', tab)
      .eq('brand', brand);
    if (error) throw error;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: no new TypeScript errors. (No automated test for this file — matches existing convention; every other Supabase-calling function in `queries.ts` is untested the same way, per Global Constraints.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat: add fetchRemovedTpBrands and setBrandTpRemoved queries"
```

---

### Task 5: Badge component — `src/components/TpRemovedBadge.tsx`

**Files:**
- Create: `src/components/TpRemovedBadge.tsx`

**Interfaces:**
- Produces: `<TpRemovedBadge />` — a solid red circle with a white X. Task 6 renders it inline next to a brand name.

- [ ] **Step 1: Write the component**

```tsx
import { X } from 'lucide-react';

// Solid red circle-X shown next to a brand name whose Trustpilot page has
// been delisted entirely — distinct from the outlined rose "Removed" status
// pill (see BrandGroup.tsx's StatusBadge) which reflects one review's status,
// not the brand's page existing at all.
export default function TpRemovedBadge() {
  return (
    <span
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-rose-600"
      title="TP page removed"
    >
      <X className="size-2.5 text-white" strokeWidth={3} />
    </span>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/TpRemovedBadge.tsx
git commit -m "feat: add TpRemovedBadge component"
```

---

### Task 6: Render the badge in `BrandGroup.tsx`

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `fetchRemovedTpBrands` (Task 4), `tpRemovedKey`/`buildRemovedTpBrandSet` (Task 2), `<TpRemovedBadge />` (Task 5).
- Produces: `isTpRemoved(brandName: string | null | undefined): boolean` — a local helper Task 8 also uses to compute `EditEntryModal`'s `initialTpRemoved` prop.

- [ ] **Step 1: Add imports**

At the top of `src/pages/BrandGroup.tsx`, add:

```typescript
import TpRemovedBadge from '../components/TpRemovedBadge';
import { fetchRemovedTpBrands } from '../lib/queries';
import { tpRemovedKey, buildRemovedTpBrandSet } from '../lib/removedTpBrands';
```

(`fetchRemovedTpBrands` joins the existing named-import list from `'../lib/queries'` at line 13 rather than a second import line.)

- [ ] **Step 2: Fetch the flagged-brand rows**

Add a new state variable next to `editEntry` (~line 682):

```typescript
const [removedTpBrandRows, setRemovedTpBrandRows] = useState<{ tab: string; brand: string }[]>([]);
```

Add a new, independent effect right after the existing `lastChecked` effect (~line 766-768) — kept separate from the large entries-loading effect so a failure here can never block the main table load:

```typescript
useEffect(() => {
  let canceled = false;
  fetchRemovedTpBrands()
    .then((rows) => { if (!canceled) setRemovedTpBrandRows(rows); })
    .catch(() => { /* badge is decorative — a failed fetch just means no badges render */ });
  return () => { canceled = true; };
}, [reloadSeq]);
```

- [ ] **Step 3: Build the lookup and helper**

Near `brandCol`/`uniqueBrands` (~line 1031), add:

```typescript
const removedTpBrandSet = useMemo(() => buildRemovedTpBrandSet(removedTpBrandRows), [removedTpBrandRows]);
function isTpRemoved(brandName: string | null | undefined): boolean {
  return !!brandName && removedTpBrandSet.has(tpRemovedKey(decodedTab, brandName));
}
```

- [ ] **Step 4: Render the badge in the three brand-cell branches**

In the `h === 'Brand / TP URL PAGE'` branch (~line 2070), both return paths that render `brandName` get the badge appended right after it:

```tsx
if (h === 'Brand / TP URL PAGE') {
  const brandName = entry.data[h];
  const brandUrl = entry.data['Brand / TP URL PAGE__href'] ?? (brandName ? getBrandTpUrl(brandName, decodedTab) : undefined);
  if (brandName && brandUrl) {
    const href = brandUrl.startsWith('http') ? brandUrl : `https://${brandUrl}`;
    return (
      <td key={h} className="px-[10px] py-2">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
        >
          <ExternalLink className="size-3 shrink-0" />
          {brandName}
        </a>
        {isTpRemoved(brandName) && <TpRemovedBadge />}
      </td>
    );
  }
  if (brandName) {
    return (
      <td key={h} className="px-[10px] py-2">
        <span className="text-slate-600 text-sm">{brandName}</span>
        {isTpRemoved(brandName) && <TpRemovedBadge />}
      </td>
    );
  }
  return <td key={h} className="px-[10px] py-2"><span className="text-slate-400">—</span></td>;
}
```

In the `h === 'URL PAGE'` branch (~line 2100), the same pattern — both return paths that render `pageName`:

```tsx
if (h === 'URL PAGE') {
  const pageName = entry.data[h];
  const pageUrl = entry.data['URL PAGE__href'];
  if (pageName) {
    if (pageUrl) {
      const href = pageUrl.startsWith('http') ? pageUrl : `https://${pageUrl}`;
      return (
        <td key={h} className="px-[10px] py-2 whitespace-nowrap">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
          >
            <ExternalLink className="size-3 shrink-0" />
            {pageName}
          </a>
          {isTpRemoved(pageName) && <TpRemovedBadge />}
        </td>
      );
    }
    return (
      <td key={h} className="px-[10px] py-2 whitespace-nowrap">
        <span className="text-slate-600 text-sm">{pageName}</span>
        {isTpRemoved(pageName) && <TpRemovedBadge />}
      </td>
    );
  }
  return <td key={h} className="px-[10px] py-2" />;
}
```

In the `h === 'Brands' || h === 'Brand Name' || h === 'Brand'` branch (~line 2144):

```tsx
if (h === 'Brands' || h === 'Brand Name' || h === 'Brand') {
  const brandName = entry.data[h] ?? null;
  const tpUrl = brandName ? getBrandTpUrl(brandName, decodedTab) : undefined;
  if (brandName && tpUrl) {
    return (
      <td key={h} className="px-[10px] py-2">
        <a
          href={tpUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
        >
          <ExternalLink className="size-3 shrink-0" />
          {brandName}
        </a>
        {isTpRemoved(brandName) && <TpRemovedBadge />}
      </td>
    );
  }
  return (
    <td key={h} className="px-[10px] py-2">
      <CellValue header={h} value={brandName} rowData={entry.data} tab={decodedTab} />
      {isTpRemoved(brandName) && <TpRemovedBadge />}
    </td>
  );
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: no new TypeScript errors.

- [ ] **Step 6: Verify manually**

Run: `npm run dev`. Open `/brands/hanan` — "Pribet.com" and "WinMega.com" and "RealSpin.com" rows show the red circle-X badge next to the brand name. Open `/brands/tp-brand-injection` — the 6 seeded brands there show it too. A non-flagged brand (e.g. any other Hanan brand) does not show it.

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: render TP-removed badge next to flagged brand names in BrandGroup"
```

---

### Task 7: Edit Entry modal — "TP page removed" checkbox

**Files:**
- Modify: `src/components/EditEntryModal.tsx`

**Interfaces:**
- Consumes: none new (pure prop/UI change).
- Produces: new `Props` fields `initialTpRemoved?: boolean`; `onSave` signature extended to `(fields: Record<string, string | null>, newTab?: string, tpRemoved?: boolean) => Promise<void>`. Task 8 supplies `initialTpRemoved` and reads the third `onSave` argument.

- [ ] **Step 1: Extend the Props interface and add local state**

Change the `Props` interface (currently lines 91-100):

```typescript
interface Props {
  entry: Entry;
  headers: string[];
  onClose: () => void;
  onSave: (fields: Record<string, string | null>, newTab?: string, tpRemoved?: boolean) => Promise<void>;
  currentTab?: string;
  availableBrands?: string[];
  brandCol?: string | null;
  brandProfiles?: Record<string, Record<string, string>>;
  initialTpRemoved?: boolean;
}
```

Change the function signature and add state (currently line 107):

```typescript
export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles, initialTpRemoved }: Props) {
  const [tpRemoved, setTpRemoved] = useState(initialTpRemoved ?? false);
```

- [ ] **Step 2: Pass the flag through on save**

Change `handleSave` (currently lines 127-140):

```typescript
async function handleSave() {
  setSaving(true);
  setError(null);
  try {
    const out: Record<string, string | null> = {};
    for (const h of headers) out[h] = fields[h] || null;
    const tabChanged = selectedTab && selectedTab !== currentTab ? selectedTab : undefined;
    await onSave(out, tabChanged, tpRemoved);
    onClose();
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to save');
    setSaving(false);
  }
}
```

- [ ] **Step 3: Render the checkbox**

In the "Brand Tab + Brand Name" bar (currently lines 288-326), add a third grid cell right after the `Brand Name` block, gated the same way that block is (`brandCol && availableBrands && availableBrands.length > 0`) since the flag only makes sense once a brand identity is resolvable:

```tsx
{brandCol && availableBrands && availableBrands.length > 0 && (
  <div className="flex items-end pb-2">
    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
      <input
        type="checkbox"
        checked={tpRemoved}
        disabled={saving}
        onChange={(e) => setTpRemoved(e.target.checked)}
        className="rounded border-slate-300 text-rose-600 focus:ring-rose-400"
      />
      TP page removed
    </label>
  </div>
)}
```

(This sits as a sibling to the existing `Brand Name` `<div>` inside the same `grid grid-cols-2 gap-3 sm:grid-cols-6` container, so no layout wrapper changes are needed.)

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: no new TypeScript errors — this task alone will show a type error at `BrandGroup.tsx`'s existing `onSave` callback (its 2-arg signature no longer matches `Props['onSave']`'s 3-arg type) until Task 8 updates that call site. That's expected — Task 8 fixes it immediately after.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "feat: add TP page removed checkbox to Edit Entry modal"
```

---

### Task 8: Wire the toggle into `BrandGroup.tsx`

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `setBrandTpRemoved` (Task 4), `isTpRemoved` (Task 6), `EditEntryModal`'s extended `Props`/`onSave` (Task 7).

- [ ] **Step 1: Add the import**

`setBrandTpRemoved` joins the existing named-import list from `'../lib/queries'` at line 13.

- [ ] **Step 2: Pass `initialTpRemoved` and extend `onSave`**

Change the `<EditEntryModal>` usage (currently lines 2395-2456):

```tsx
{editEntry && (
  <EditEntryModal
    entry={editEntry}
    headers={(() => {
      /* ...unchanged... */
    })()}
    currentTab={decodedTab}
    availableBrands={uniqueBrands}
    brandCol={brandCol}
    brandProfiles={brandProfiles}
    initialTpRemoved={brandCol ? isTpRemoved(editEntry.data[brandCol]) : false}
    onClose={() => setEditEntry(null)}
    onSave={async (fields, newTab, tpRemoved) => {
      if (newTab && newTab !== editEntry.tab) {
        await moveEntryToTab(editEntry.id, editEntry.tab, newTab);
      }
      await updateEntryData(editEntry.id, newTab ?? editEntry.tab, fields);
      setEntries((prev) =>
        prev.map((e) => (e.id === editEntry.id ? { ...e, data: { ...e.data, ...fields }, tab: newTab ?? e.tab } : e)),
      );
      if (brandCol && tpRemoved !== undefined) {
        const targetTab = newTab ?? editEntry.tab;
        const brandName = fields[brandCol] ?? editEntry.data[brandCol];
        if (brandName) await setBrandTpRemoved(targetTab, brandName, tpRemoved);
      }
      reloadRef.current();
    }}
  />
)}
```

(Only the `initialTpRemoved` prop and the `onSave` body are new — the `headers={...}` callback body is unchanged, elided here for brevity.)

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: no TypeScript errors (this resolves the expected Task 7 mismatch).

- [ ] **Step 4: Verify manually**

Run: `npm run dev`. Open `/brands/hanan`, click any row to open Edit Entry, check "TP page removed", Save. Every row sharing that brand name in the Hanan tab now shows the red badge. Reopen Edit Entry on one of them — the checkbox is already checked. Uncheck it, Save — the badge disappears from every row sharing that brand.

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: wire TP-removed toggle from Edit Entry modal to removed_tp_brands"
```

---

### Task 9: Score Summary — fetch and pass the flagged set through

**Files:**
- Modify: `src/pages/ScoreSummary.tsx`
- Modify: `src/components/ScoreSummaryPanel.tsx`

**Interfaces:**
- Consumes: `fetchRemovedTpBrands` (Task 4), `buildRemovedTpBrandSet` (Task 2), the extended `computeScoreSummary`/`computeSuccessRates`/`computeTabSuccessRates` (Task 3).

- [ ] **Step 1: Fetch the flagged rows in `ScoreSummary.tsx`**

Change `src/pages/ScoreSummary.tsx` to fetch both entries and the flagged-brand rows, and pass the built set down:

```tsx
import { useEffect, useState } from 'react';
import ScoreSummaryPanel from '../components/ScoreSummaryPanel';
import { fetchAllEntries, fetchRemovedTpBrands } from '../lib/queries';
import { buildRemovedTpBrandSet } from '../lib/removedTpBrands';
import { OPERATIONAL_TABS } from '../lib/tabs';
import type { Entry } from '../types/entry';

export default function ScoreSummary() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [removedTpBrands, setRemovedTpBrands] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchAllEntries(OPERATIONAL_TABS), fetchRemovedTpBrands()])
      .then(([entryRows, removedRows]) => {
        if (cancelled) return;
        setEntries(entryRows);
        setRemovedTpBrands(buildRemovedTpBrandSet(removedRows));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScoreSummaryPanel entries={entries} removedTpBrands={removedTpBrands} />
    </div>
  );
}
```

- [ ] **Step 2: Accept and use the prop in `ScoreSummaryPanel.tsx`**

Change the `Props` interface (currently lines 20-22):

```typescript
interface Props {
  entries: Entry[];
  removedTpBrands?: Set<string>;
}
```

Change the function signature and the three compute call sites (currently lines 85, 98-111):

```typescript
export default function ScoreSummaryPanel({ entries, removedTpBrands = new Set() }: Props) {
  /* ...unchanged state declarations... */

  const result = useMemo(
    () => computeScoreSummary(entries, range, [], platform, removedTpBrands),
    [entries, range, platform, removedTpBrands],
  );

  const successRates = useMemo(
    () => computeSuccessRates(entries, platform, removedTpBrands),
    [entries, platform, removedTpBrands],
  );

  const tabSuccessRates = useMemo(
    () => computeTabSuccessRates(entries, platform, removedTpBrands),
    [entries, platform, removedTpBrands],
  );
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Verify manually**

Run: `npm run dev`. Open Score Summary, TrustPilot platform (default). Under the Hanan group, confirm "Pribet.com" is absent from the brand list and the group's Total row/Success Rate reflect only the remaining brands. Switch platform to AskGamblers — if Pribet.com has AG data, confirm it still appears there.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ScoreSummary.tsx src/components/ScoreSummaryPanel.tsx
git commit -m "feat: exclude TP-removed brands from Score Summary's TrustPilot view"
```

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `removedTpBrands.test.ts` and the additions to `scoreSummary.test.ts`.

- [ ] **Step 2: Run the full type-check + build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Full manual walkthrough**

Run: `npm run dev` and, per the spec's Testing section:
- Confirm the 14 seeded brands show the badge in their respective tab's table.
- Confirm Score Summary's TrustPilot view excludes all 14 from brand lists, star counts, and Success Rate.
- Confirm a non-TP platform view (AG/CG/WO) still shows a flagged brand's data if it has any.
- Toggle a brand's flag off via Edit Entry modal, confirm the badge disappears everywhere it appeared and the brand reappears in the TP Score Summary.
- Toggle it back on, confirm the reverse.

- [ ] **Step 4: Update project CLAUDE.md's Recent Changes**

Add an entry to `CLAUDE.md`'s "Recent Changes" section describing this feature (new `removed_tp_brands` table, badge, Score Summary exclusion, Edit Entry modal toggle), following the existing entry style/format in that file.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note TP-removed brand flag feature in CLAUDE.md"
```
