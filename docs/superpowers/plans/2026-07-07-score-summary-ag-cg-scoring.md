# Score Summary: Wire Up AG/CG Scoring (1-5 vs 1-10) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score Summary shows a real per-brand score breakdown for AskGamblers (1-10 scale) and CasinoGuru (1-5 scale), matching what TrustPilot already does, and ops can actually enter those scores through the dashboard.

**Architecture:** `src/lib/scoreSummary.ts` currently hardcodes a 1-5 scale and has an empty score-key list for `ag`/`cg`, so every published AG/CG review is silently bucketed as "Unrated." Generalize the computation to a per-platform max score, generalize `ScoreSummaryPanel.tsx`'s table to render a variable number of star columns, and add the two new fields (`AG Score added`, `CG Score added`) to the Add Review Account form and the Edit modal the same way `Score added` already works for TP.

**Tech Stack:** Vite 6, React 19, TypeScript (strict), Tailwind v4, Vitest.

## Global Constraints

- TypeScript strict mode; no `any` unless commented why (per project CLAUDE.md).
- Tailwind v4 utility classes only — no new global CSS.
- Verify with `npm run build` (`tsc -b && vite build`), not `tsc --noEmit` alone — the root tsconfig is references-only and `tsc --noEmit` alone checks nothing in this repo.
- AG/CG score fields stay out of the main BrandGroup table (edit-only, same convention as TP's `Score added`) — no `tab-configs.ts` whitelist changes.
- No input validation/range enforcement at entry time — an out-of-range value is simply treated as unrated by the summary computation, same as TP today.
- Spec: `docs/superpowers/specs/2026-07-07-score-summary-ag-cg-scoring-design.md`.

---

### Task 1: Generalize score computation for a per-platform max score

**Files:**
- Modify: `src/lib/scoreSummary.ts`
- Test: `src/lib/scoreSummary.test.ts` (new)

**Interfaces:**
- Consumes: nothing new — `Entry` type already exists.
- Produces: `export const PLATFORM_MAX_SCORE: Record<Platform, number>`, `parseScore(raw: string | null | undefined, maxScore: number): Star | null`, `ratingLabel(avg: number | null, maxScore?: number): RatingLabel | null` (now takes an optional second param, defaults to 5), `computeScoreSummary(...)` unchanged signature but now reads AG/CG scores. Task 2 imports `PLATFORM_MAX_SCORE` from this file.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/scoreSummary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeScoreSummary, parseScore, ratingLabel } from './scoreSummary';
import type { Entry } from '../types/entry';

function makeEntry(id: string, tab: string, data: Record<string, string | null>): Entry {
  return {
    id,
    tab,
    sheet_row_id: id,
    data,
    updated_at: '',
    last_edited_by: 'dashboard',
    last_sync_tag: null,
  };
}

describe('parseScore', () => {
  it('accepts a value within range', () => {
    expect(parseScore('7', 10)).toBe(7);
  });

  it('rejects a value above maxScore', () => {
    expect(parseScore('7', 5)).toBeNull();
  });

  it('rejects zero, negative, and non-numeric input', () => {
    expect(parseScore('0', 10)).toBeNull();
    expect(parseScore('-1', 10)).toBeNull();
    expect(parseScore('abc', 10)).toBeNull();
  });

  it('accepts a two-digit value up to maxScore 10', () => {
    expect(parseScore('10', 10)).toBe(10);
  });
});

describe('ratingLabel', () => {
  it('uses the 1-5 thresholds by default', () => {
    expect(ratingLabel(4.6)).toBe('Excellent');
    expect(ratingLabel(4.0)).toBe('Great');
    expect(ratingLabel(3.0)).toBe('Average');
    expect(ratingLabel(2.0)).toBe('Poor');
    expect(ratingLabel(1.0)).toBe('Bad');
  });

  it('doubles the thresholds for a 1-10 scale', () => {
    expect(ratingLabel(9.2, 10)).toBe('Excellent');
    expect(ratingLabel(8.0, 10)).toBe('Great');
    expect(ratingLabel(6.0, 10)).toBe('Average');
    expect(ratingLabel(4.0, 10)).toBe('Poor');
    expect(ratingLabel(1.2, 10)).toBe('Bad');
  });

  it('returns null when average is null', () => {
    expect(ratingLabel(null)).toBeNull();
  });
});

describe('computeScoreSummary', () => {
  const noRange = { from: null, to: null };

  it('reads TP scores on a 1-5 scale (existing behavior, unaffected)', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published', 'TP Score added': '5' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'TP Review Status': 'Published', 'TP Score added': '4' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'tp');
    expect(result.brands).toHaveLength(1);
    const [brand] = result.brands;
    expect(brand.counts[5]).toBe(1);
    expect(brand.counts[4]).toBe(1);
    expect(brand.average).toBe(4.5);
    expect(brand.label).toBe('Excellent');
  });

  it('reads CG scores on a 1-5 scale', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'CG Review Status': 'Published', 'CG Score added': '3' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'CG Review Status': 'Published', 'CG Score added': '2' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'cg');
    const [brand] = result.brands;
    expect(brand.counts[3]).toBe(1);
    expect(brand.counts[2]).toBe(1);
    expect(brand.average).toBe(2.5);
    expect(brand.label).toBe('Poor');
  });

  it('reads AG scores on a 1-10 scale', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'AG Review Status': 'Published', 'AG Score added': '9' }),
      makeEntry('2', 'Hanan', { Brands: 'ZodiacBet.com', 'AG Review Status': 'Published', 'AG Score added': '10' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'ag');
    const [brand] = result.brands;
    expect(brand.counts[9]).toBe(1);
    expect(brand.counts[10]).toBe(1);
    expect(brand.average).toBe(9.5);
    expect(brand.label).toBe('Excellent');
  });

  it('buckets an AG review with no score as unrated', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'AG Review Status': 'Published' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'ag');
    const [brand] = result.brands;
    expect(brand.unrated).toBe(1);
    expect(brand.average).toBeNull();
  });

  it('treats an out-of-range CG score (e.g. entered on the wrong scale) as unrated', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'ZodiacBet.com', 'CG Review Status': 'Published', 'CG Score added': '9' }),
    ];
    const result = computeScoreSummary(entries, noRange, [], 'cg');
    const [brand] = result.brands;
    expect(brand.unrated).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- scoreSummary.test.ts`
Expected: FAIL — the CG and AG tests fail because `PLATFORM_SCORE_KEYS.ag`/`.cg` are empty (every row lands in `unrated` instead of `counts`), and the two-digit `parseScore('10', 10)` test fails because the current regex is `/^[1-5]$/` (single digit, 1-5 only) and `parseScore` doesn't take a `maxScore` param yet.

- [ ] **Step 3: Add `PLATFORM_MAX_SCORE` and generalize the `Star` type**

In `src/lib/scoreSummary.ts`, find:

```ts
import type { Entry } from '../types/entry';

export type Star = 1 | 2 | 3 | 4 | 5;
export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';
export type Platform = 'tp' | 'ag' | 'cg';

export interface BrandSummary {
```

Replace with:

```ts
import type { Entry } from '../types/entry';

export type Star = number;
export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';
export type Platform = 'tp' | 'ag' | 'cg';

// TrustPilot and CasinoGuru score reviews 1-5; AskGamblers scores 1-10.
export const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5 };

export interface BrandSummary {
```

- [ ] **Step 4: Wire real score keys for AG and CG**

Find:

```ts
const PLATFORM_SCORE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: [],
  cg: [],
};
```

Replace with:

```ts
const PLATFORM_SCORE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: ['AG Score added'],
  cg: ['CG Score added'],
};
```

- [ ] **Step 5: Generalize `parseScore` to take a max score**

Find:

```ts
export function parseScore(raw: string | null | undefined): Star | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^[1-5]$/.test(s)) return null;
  return Number(s) as Star;
}
```

Replace with:

```ts
export function parseScore(raw: string | null | undefined, maxScore: number): Star | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  if (n < 1 || n > maxScore) return null;
  return n;
}
```

- [ ] **Step 6: Generalize `ratingLabel` to scale thresholds by max score**

Find:

```ts
export function ratingLabel(avg: number | null): RatingLabel | null {
  if (avg == null) return null;
  if (avg >= 4.5) return 'Excellent';
  if (avg >= 4.0) return 'Great';
  if (avg >= 3.0) return 'Average';
  if (avg >= 2.0) return 'Poor';
  if (avg >= 1.0) return 'Bad';
  return null;
}
```

Replace with:

```ts
export function ratingLabel(avg: number | null, maxScore: number = 5): RatingLabel | null {
  if (avg == null) return null;
  const k = maxScore / 5;
  if (avg >= 4.5 * k) return 'Excellent';
  if (avg >= 4.0 * k) return 'Great';
  if (avg >= 3.0 * k) return 'Average';
  if (avg >= 2.0 * k) return 'Poor';
  // Unscaled floor: the minimum possible average is always 1, regardless of
  // scale, so scaling this cutoff would leave low-but-real averages (e.g.
  // 1.2 out of 10) rendering as blank instead of "Bad".
  if (avg >= 1.0) return 'Bad';
  return null;
}
```

- [ ] **Step 7: Generalize `computeScoreSummary`'s bucket counting and averaging**

Find:

```ts
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const dateKeys = PLATFORM_DATE_KEYS[platform];
  const scoreKeys = PLATFORM_SCORE_KEYS[platform];

  interface Bucket {
    tab: string;
    brand: string;
    counts: Record<Star, number>;
    unrated: number;
  }

  const buckets = new Map<string, Bucket>();
  let excludedRows = 0;
  const dateFilterActive = fromBound !== null || toBound !== null;
```

Replace with:

```ts
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const dateKeys = PLATFORM_DATE_KEYS[platform];
  const scoreKeys = PLATFORM_SCORE_KEYS[platform];
  const maxScore = PLATFORM_MAX_SCORE[platform];

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
```

Find:

```ts
    const tab = e.tab ?? '';
    const key = `${tab} ${brand}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tab, brand, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, unrated: 0 };
      buckets.set(key, bucket);
    }

    const score = scoreKeys.length > 0 ? parseScore(pick(d, scoreKeys)) : null;
    if (score == null) {
      bucket.unrated += 1;
    } else {
      bucket.counts[score] += 1;
    }
  }

  const summaries: BrandSummary[] = [...buckets.values()].map((b) => {
    const counts = b.counts;
    const rated = counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
    const total = rated + b.unrated;
    const average =
      rated === 0
        ? null
        : Math.round(((counts[1] + 2 * counts[2] + 3 * counts[3] + 4 * counts[4] + 5 * counts[5]) / rated) * 10) / 10;
    return {
      tab: b.tab,
      brand: b.brand,
      counts,
      unrated: b.unrated,
      total,
      rated,
      average,
      label: ratingLabel(average),
    };
  });
```

Replace with:

```ts
    const tab = e.tab ?? '';
    const key = `${tab} ${brand}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tab, brand, counts: emptyCounts(), unrated: 0 };
      buckets.set(key, bucket);
    }

    const score = scoreKeys.length > 0 ? parseScore(pick(d, scoreKeys), maxScore) : null;
    if (score == null) {
      bucket.unrated += 1;
    } else {
      bucket.counts[score] += 1;
    }
  }

  const summaries: BrandSummary[] = [...buckets.values()].map((b) => {
    const counts = b.counts;
    let rated = 0;
    let weighted = 0;
    for (let i = 1; i <= maxScore; i++) {
      rated += counts[i];
      weighted += i * counts[i];
    }
    const total = rated + b.unrated;
    const average = rated === 0 ? null : Math.round((weighted / rated) * 10) / 10;
    return {
      tab: b.tab,
      brand: b.brand,
      counts,
      unrated: b.unrated,
      total,
      rated,
      average,
      label: ratingLabel(average, maxScore),
    };
  });
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- scoreSummary.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 9: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS (existing `removedEntriesDiff.test.ts` and `tab-configs.test.ts` unaffected).

- [ ] **Step 10: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts
git commit -m "feat: read AG (1-10) and CG (1-5) scores in score summary computation"
```

---

### Task 2: Generalize the Score Summary table UI for a variable star scale

**Files:**
- Modify: `src/components/ScoreSummaryPanel.tsx`

**Interfaces:**
- Consumes: `PLATFORM_MAX_SCORE` from `../lib/scoreSummary` (produced by Task 1).
- Produces: `GroupedSummary`, `SummaryTable`, `GrandTotal`, `SummaryColgroup` all take a `maxScore: number` prop; `computeColumnTotals(rows, maxScore)` takes a second param. No other file depends on these — this task is self-contained to one file.

No automated test — this is a rendering/layout change to an already-untested component tree. Verified by `npm run build` (type-check) and a manual browser check.

- [ ] **Step 1: Import `PLATFORM_MAX_SCORE`**

Find:

```ts
import {
  computeScoreSummary,
  isoToDate,
  ratingLabel,
  type BrandSummary,
  type Platform,
  type RatingLabel,
  type Star as StarRating,
} from '../lib/scoreSummary';
```

Replace with:

```ts
import {
  computeScoreSummary,
  isoToDate,
  ratingLabel,
  PLATFORM_MAX_SCORE,
  type BrandSummary,
  type Platform,
  type RatingLabel,
  type Star as StarRating,
} from '../lib/scoreSummary';
```

- [ ] **Step 2: Replace the fixed `STAR_COLOR` map with tier-based helpers**

Find:

```ts
const STAR_COLOR: Record<1 | 2 | 3 | 4 | 5, string> = {
  5: 'text-emerald-500',
  4: 'text-green-500',
  3: 'text-amber-500',
  2: 'text-orange-500',
  1: 'text-rose-500',
};
```

Replace with:

```ts
// 5 color tiers regardless of scale — a 1-10 score buckets 2 values per tier
// (9-10 emerald, 7-8 green, ...) so AG's wider table still reads as the same
// green-to-red gradient as TP/CG's 5-column one.
const STAR_TIER_COLOR = ['text-rose-500', 'text-orange-500', 'text-amber-500', 'text-green-500', 'text-emerald-500'];

function starColor(value: number, maxScore: number): string {
  const tier = Math.ceil(value / (maxScore / 5));
  return STAR_TIER_COLOR[tier - 1];
}

function starsFor(maxScore: number): StarRating[] {
  return Array.from({ length: maxScore }, (_, i) => maxScore - i);
}
```

- [ ] **Step 3: Derive `maxScore` in the main panel and pass it down**

Find:

```ts
  const result = useMemo(
    () => computeScoreSummary(entries, range, [], platform),
    [entries, range, platform],
  );
```

Replace with:

```ts
  const result = useMemo(
    () => computeScoreSummary(entries, range, [], platform),
    [entries, range, platform],
  );

  const maxScore = PLATFORM_MAX_SCORE[platform];
```

Find:

```tsx
          ) : (
            <GroupedSummary rows={filteredBrands} />
          )}
```

Replace with:

```tsx
          ) : (
            <GroupedSummary rows={filteredBrands} maxScore={maxScore} />
          )}
```

- [ ] **Step 4: Thread `maxScore` through `GroupedSummary`**

Find:

```ts
function GroupedSummary({ rows }: { rows: BrandSummary[] }) {
```

Replace with:

```ts
function GroupedSummary({ rows, maxScore }: { rows: BrandSummary[]; maxScore: number }) {
```

Find:

```tsx
            {!isCollapsed && <SummaryTable rows={brands} />}
```

Replace with:

```tsx
            {!isCollapsed && <SummaryTable rows={brands} maxScore={maxScore} />}
```

Find:

```tsx
      {groups.length > 1 && <GrandTotal rows={rows} />}
```

Replace with:

```tsx
      {groups.length > 1 && <GrandTotal rows={rows} maxScore={maxScore} />}
```

- [ ] **Step 5: Generalize `GrandTotal`**

Find:

```tsx
function GrandTotal({ rows }: { rows: BrandSummary[] }) {
  const t = useMemo(() => computeColumnTotals(rows), [rows]);
  return (
    <section className="overflow-x-auto rounded-md border-2 border-violet-200 bg-violet-50/40">
      <table className="w-full table-fixed text-sm">
        <SummaryColgroup />
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">All brands</th>
            {STARS.map((s) => (
              <th key={s} scope="col" className="px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-0.5">
                  <span className="tabular-nums">{s}</span>
                  <Star className={`size-3 fill-current ${STAR_COLOR[s]}`} />
                </span>
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-right font-medium">Unrtd</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Avg</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-semibold text-slate-800">
            <td className="px-3 py-2 text-left text-slate-600">
              {rows.length} brand{rows.length !== 1 ? 's' : ''}
            </td>
            {STARS.map((s) => (
              <td
                key={s}
                className={`px-2 py-2 text-right tabular-nums ${t.counts[s] > 0 ? 'text-slate-800' : 'text-slate-400'}`}
              >
                {t.counts[s].toLocaleString()}
              </td>
            ))}
```

Replace with:

```tsx
function GrandTotal({ rows, maxScore }: { rows: BrandSummary[]; maxScore: number }) {
  const stars = starsFor(maxScore);
  const t = useMemo(() => computeColumnTotals(rows, maxScore), [rows, maxScore]);
  return (
    <section className="overflow-x-auto rounded-md border-2 border-violet-200 bg-violet-50/40">
      <table className="w-full table-fixed text-sm">
        <SummaryColgroup maxScore={maxScore} />
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">All brands</th>
            {stars.map((s) => (
              <th key={s} scope="col" className="px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-0.5">
                  <span className="tabular-nums">{s}</span>
                  <Star className={`size-3 fill-current ${starColor(s, maxScore)}`} />
                </span>
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-right font-medium">Unrtd</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Avg</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-semibold text-slate-800">
            <td className="px-3 py-2 text-left text-slate-600">
              {rows.length} brand{rows.length !== 1 ? 's' : ''}
            </td>
            {stars.map((s) => (
              <td
                key={s}
                className={`px-2 py-2 text-right tabular-nums ${t.counts[s] > 0 ? 'text-slate-800' : 'text-slate-400'}`}
              >
                {t.counts[s].toLocaleString()}
              </td>
            ))}
```

(The rest of `GrandTotal`'s JSX — Unrtd/Total/Avg/Rating cells — references `t.unrated`/`t.total`/`t.average`/`t.label` and is unchanged by this task.)

- [ ] **Step 6: Generalize `computeColumnTotals` and `SummaryColgroup`, and remove the old fixed `STARS` constant**

Find:

```ts
const STARS: StarRating[] = [5, 4, 3, 2, 1];

interface ColumnTotals {
  counts: Record<StarRating, number>;
  unrated: number;
  rated: number;
  total: number;
  average: number | null;
  label: RatingLabel | null;
}

// Sums every column across a set of brand rows. Used by both the per-group
// Total row and the all-brands grand total.
function computeColumnTotals(rows: BrandSummary[]): ColumnTotals {
  const counts: Record<StarRating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let unrated = 0;
  for (const r of rows) {
    for (const s of STARS) counts[s] += r.counts[s];
    unrated += r.unrated;
  }
  const rated = counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
  const total = rated + unrated;
  const average =
    rated === 0
      ? null
      : Math.round(((counts[1] + 2 * counts[2] + 3 * counts[3] + 4 * counts[4] + 5 * counts[5]) / rated) * 10) / 10;
  return { counts, unrated, rated, total, average, label: ratingLabel(average) };
}

// Shared fixed column widths so every group table (and the grand total) lines
// up vertically. Brand column flexes; numeric/rating columns are fixed.
function SummaryColgroup({ showGroup = false }: { showGroup?: boolean }) {
  return (
    <colgroup>
      {showGroup && <col className="w-32" />}
      <col />
      <col className="w-16" />
      <col className="w-16" />
      <col className="w-16" />
      <col className="w-16" />
      <col className="w-16" />
      <col className="w-20" />
      <col className="w-20" />
      <col className="w-24" />
      <col className="w-32" />
    </colgroup>
  );
}
```

Replace with:

```ts
interface ColumnTotals {
  counts: Record<StarRating, number>;
  unrated: number;
  rated: number;
  total: number;
  average: number | null;
  label: RatingLabel | null;
}

// Sums every column across a set of brand rows. Used by both the per-group
// Total row and the all-brands grand total.
function computeColumnTotals(rows: BrandSummary[], maxScore: number): ColumnTotals {
  const stars = starsFor(maxScore);
  const counts: Record<StarRating, number> = {};
  for (const s of stars) counts[s] = 0;
  let unrated = 0;
  for (const r of rows) {
    for (const s of stars) counts[s] += r.counts[s] ?? 0;
    unrated += r.unrated;
  }
  let rated = 0;
  let weighted = 0;
  for (const s of stars) {
    rated += counts[s];
    weighted += s * counts[s];
  }
  const total = rated + unrated;
  const average = rated === 0 ? null : Math.round((weighted / rated) * 10) / 10;
  return { counts, unrated, rated, total, average, label: ratingLabel(average, maxScore) };
}

// Shared fixed column widths so every group table (and the grand total) lines
// up vertically. Brand column flexes; numeric/rating columns are fixed. The
// number of star columns varies by platform (5 for TP/CG, 10 for AG).
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
      <col className="w-24" />
      <col className="w-32" />
    </colgroup>
  );
}
```

- [ ] **Step 7: Generalize `SummaryTable`**

Find:

```tsx
function SummaryTable({ rows }: { rows: BrandSummary[] }) {
  const stars = STARS;
  const showGroup = new Set(rows.map((r) => r.tab)).size > 1;
  const totals = useMemo(() => computeColumnTotals(rows), [rows]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <SummaryColgroup showGroup={showGroup} />
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {showGroup && <th scope="col" className="px-3 py-2 text-left font-medium">Group</th>}
            <th scope="col" className="px-3 py-2 text-left font-medium">Brand</th>
            {stars.map((s) => (
              <th key={s} scope="col" className="px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-0.5">
                  <span className="tabular-nums">{s}</span>
                  <Star className={`size-3 fill-current ${STAR_COLOR[s]}`} />
                </span>
              </th>
            ))}
```

Replace with:

```tsx
function SummaryTable({ rows, maxScore }: { rows: BrandSummary[]; maxScore: number }) {
  const stars = starsFor(maxScore);
  const showGroup = new Set(rows.map((r) => r.tab)).size > 1;
  const totals = useMemo(() => computeColumnTotals(rows, maxScore), [rows, maxScore]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <SummaryColgroup showGroup={showGroup} maxScore={maxScore} />
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {showGroup && <th scope="col" className="px-3 py-2 text-left font-medium">Group</th>}
            <th scope="col" className="px-3 py-2 text-left font-medium">Brand</th>
            {stars.map((s) => (
              <th key={s} scope="col" className="px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-0.5">
                  <span className="tabular-nums">{s}</span>
                  <Star className={`size-3 fill-current ${starColor(s, maxScore)}`} />
                </span>
              </th>
            ))}
```

(The rest of `SummaryTable`'s JSX — the `Unrtd`/`Total`/`Avg`/`Rating` header cells, the `tbody` row rendering, and the `tfoot` totals row — reference `stars`, `r.counts[s]`, `totals.counts[s]`, etc., which are unchanged variable names, so no further edits are needed there.)

- [ ] **Step 8: Type-check and build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors. (If it reports an unused `STAR_COLOR` or leftover `STARS` reference, it means a `Find` block above didn't match exactly — re-check Step 2 and Step 6 were applied fully.)

- [ ] **Step 9: Manual verification in the browser**

Run: `npm run dev`, open `/score-summary`, and confirm:
- TrustPilot (default) still shows 5 star columns (5,4,3,2,1) with the same colors and numbers as before this change.
- Switching the platform filter to CasinoGuru shows 5 star columns (still 1-5 — everything shows "Unrated" for now since no CG scores exist yet; that's expected until Task 3+4 land).
- Switching to AskGamblers shows **10** star columns (10,9,...,1), with the table scrolling horizontally inside its container instead of squeezing. Also "Unrated" for now.
- No console errors in any of the three platform views.

- [ ] **Step 10: Commit**

```bash
git add src/components/ScoreSummaryPanel.tsx
git commit -m "feat: render a variable-width star breakdown per platform in score summary"
```

---

### Task 3: Add AG/CG score fields to the Add Review Account form and the Edit modal

**Files:**
- Modify: `src/components/AddReviewAccountModal.tsx:74-84`
- Modify: `src/pages/BrandGroup.tsx:28-31`

**Interfaces:**
- Consumes: existing `FieldDef` type and `renderField` in `AddReviewAccountModal.tsx` (unchanged); existing `DASHBOARD_ONLY_MODAL_FIELDS: Array<[string, string]>` mechanism in `BrandGroup.tsx` (unchanged shape).
- Produces: entries saved via Add Review Account or the Edit modal on a multi-platform tab (Rooster Partners, Hanan, Revolution Casino, SilverPlay) can now carry `data['AG Score added']` and `data['CG Score added']`, which Task 1's `computeScoreSummary` already reads.

No automated test — these are form-field additions to already-untested modal components, following an existing pattern (`AG Password`/`CG Password`) exactly. Verified by `npm run build` and a manual browser check.

- [ ] **Step 1: Add the score fields to `AG_FIELDS` / `CG_FIELDS`**

In `src/components/AddReviewAccountModal.tsx`, find:

```ts
const AG_FIELDS: FieldDef[] = [
  { key: 'Ask Gambler review added', label: 'AG Added' },
  { key: 'AG Review Status',         label: 'AG Status',      status: true },
  { key: 'AG Review Link',           label: 'AG Review Link', link: true },
];

const CG_FIELDS: FieldDef[] = [
  { key: 'Casino Guru review added', label: 'CG Added' },
  { key: 'CG Review Status',         label: 'CG Status',      status: true },
  { key: 'CG Review Link',           label: 'CG Review Link', link: true },
];
```

Replace with:

```ts
const AG_FIELDS: FieldDef[] = [
  { key: 'Ask Gambler review added', label: 'AG Added' },
  { key: 'AG Review Status',         label: 'AG Status',      status: true },
  { key: 'AG Score added',           label: 'AG Score (1-10)' },
  { key: 'AG Review Link',           label: 'AG Review Link', link: true },
];

const CG_FIELDS: FieldDef[] = [
  { key: 'Casino Guru review added', label: 'CG Added' },
  { key: 'CG Review Status',         label: 'CG Status',      status: true },
  { key: 'CG Score added',           label: 'CG Score (1-5)' },
  { key: 'CG Review Link',           label: 'CG Review Link', link: true },
];
```

Both new fields render as plain text inputs via the existing `renderField` fallback (no `status`/`link`/`yesno` flag set), same as TP's `Score added` field.

- [ ] **Step 2: Force the fields into the Edit modal**

In `src/pages/BrandGroup.tsx`, find:

```ts
const DASHBOARD_ONLY_MODAL_FIELDS: Array<[string, string]> = [
  ['AG User', 'AG Password'],
  ['CG User', 'CG Password'],
];
```

Replace with:

```ts
const DASHBOARD_ONLY_MODAL_FIELDS: Array<[string, string]> = [
  ['AG User', 'AG Password'],
  ['CG User', 'CG Password'],
  ['AG Review Status', 'AG Score added'],
  ['CG Review Status', 'CG Score added'],
];
```

This inserts `AG Score added` / `CG Score added` into the Edit modal's header list right after their respective status field, even for entries saved before this field existed (same mechanism already used for `AG Password`/`CG Password`). `EditEntryModal.tsx` needs no changes: its `sectionOf()` fallback (`l.startsWith('ag ')` / `l.startsWith('cg ')`) already buckets these into the right section, and `getColLabel` already resolves their display label from the `COLUMN_LABELS` entries (`'AG Score added' → 'AG Score'`, `'CG Score added' → 'CG Score'`) that already exist in `tab-configs.ts`.

- [ ] **Step 3: Type-check and build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`, then:
- Open Add Review Account, select a multi-platform tab (e.g. "Rooster Partners"). Confirm "AG Score (1-10)" appears in the AskGamblers section (after AG Status, before AG Review Link) and "CG Score (1-5)" appears in the Casino Guru section (after CG Status, before CG Review Link).
- Fill in the required fields plus an AG score (e.g. `8`) and a CG score (e.g. `4`), save.
- Open that entry's Edit modal. Confirm an "AG Score" field (pre-filled `8`) and a "CG Score" field (pre-filled `4`) appear in their respective sections. Change one value and save; reopen the Edit modal and confirm the change persisted.
- Confirm neither field appears as a column in the main table (they stay edit-only, like TP's Score Added).

- [ ] **Step 5: Commit**

```bash
git add src/components/AddReviewAccountModal.tsx src/pages/BrandGroup.tsx
git commit -m "feat: add AG/CG score fields to Add Review Account and Edit modal"
```

---

### Task 4: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Manual walkthrough — enter scores and see them summarized**

Run: `npm run dev`.
- Using Add Review Account on a multi-platform tab (e.g. "Hanan"), create (or edit an existing) entry for one brand with: TP Review Status `Published` + a TP score, AG Review Status `Published` + an AG score (1-10, e.g. `9`), CG Review Status `Published` + a CG score (1-5, e.g. `5`).
- Go to `/score-summary`. With TrustPilot selected, confirm the brand's row shows the TP score counted in the correct column and a sensible average/rating.
- Switch to AskGamblers: confirm the 10-column table shows the entry counted under column `9`, average `9.0`, and rating pill "Excellent" (since 9 ≥ 9 on the doubled AG thresholds).
- Switch to CasinoGuru: confirm the 5-column table shows the entry counted under column `5`, average `5.0`, and rating pill "Excellent".
- Confirm the "All brands" grand total row (when more than one brand group is visible) sums correctly across brands for whichever platform is selected.

- [ ] **Step 4: Confirm no stray console errors or layout breakage** across all three platform tabs and at least one narrow-viewport check (AG's 10-column table should scroll horizontally within its own container, not push the page layout).

No commit for this task — it's verification only. If any step fails, return to the relevant task above, fix, and re-run its own verification before re-attempting this task.

---

## Self-Review Notes

- **Spec coverage:** CG on 1-5 (Task 1 + Task 3), AG on 1-10 with its own column count/colors/thresholds (Task 1 + Task 2), data entry via Add Review Account + Edit modal (Task 3), hidden from the main table / no `tab-configs.ts` whitelist change (explicitly verified in Task 3's manual check and called out in Global Constraints). All spec sections have a corresponding task.
- **Type consistency:** `parseScore(raw, maxScore)`, `ratingLabel(avg, maxScore = 5)`, `PLATFORM_MAX_SCORE: Record<Platform, number>` (Task 1) are the exact names/signatures Task 2 imports and calls (`PLATFORM_MAX_SCORE[platform]`, `ratingLabel(average, maxScore)`). `starsFor`/`starColor`/`computeColumnTotals(rows, maxScore)` introduced in Task 2 are used consistently across `GroupedSummary`, `SummaryTable`, `GrandTotal`, and `SummaryColgroup` — no mismatched names between steps.
- **No placeholders:** every step shows literal before/after code or an exact manual-check script; no "add validation" or "similar to Task N" shorthand.
