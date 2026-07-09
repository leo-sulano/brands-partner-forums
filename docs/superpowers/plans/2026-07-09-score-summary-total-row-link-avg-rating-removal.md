# Score Summary: Total-row link + Avg/Rating column removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Score Summary's tables, remove the `Avg` and `Rating` columns everywhere they appear, and make each group's "Total" row navigate into the Brands tab the same way a brand-name link does.

**Architecture:** Single-file change to `src/components/ScoreSummaryPanel.tsx`. Two tables render per-platform summary data: `SummaryTable` (one per brand-group tab, with a `tfoot` "Total" row) and `GrandTotal` (an "All brands" bar shown only when multiple groups are visible at once). Both currently render `Avg`/`Rating` columns computed by `computeColumnTotals()`. `SummaryTable`'s `tfoot` "Total" label cell becomes a `Link` (same pattern already used for brand names and star-count cells): to the single brand's page if the group has exactly one brand, or to the group's page with no brand filter otherwise. `GrandTotal` is unaffected beyond losing its two columns — it stays non-interactive.

**Tech Stack:** React 19, TypeScript (strict), React Router v7 (`Link`), Tailwind v4. No component test infra exists in this repo (`src/lib/*.test.ts` only covers pure functions) — verification is `npm run build` (type-check gate) plus manual browser checks, matching how the rest of this file was built.

## Global Constraints

- TypeScript strict mode; no `any`.
- `npm run build` is the only reliable type-check gate in this repo (root `tsconfig` is references-only — `tsc --noEmit` alone checks nothing).
- Don't touch `src/lib/scoreSummary.ts` or `scoreSummary.test.ts` — the average/rating-label computation stays as a tested, general-purpose utility even though this change stops displaying it.
- Don't make the `GrandTotal` ("All brands") bar clickable — it spans unrelated groups/tabs and has no single destination.

---

## Task 1: Remove the Avg and Rating columns

**Files:**
- Modify: `src/components/ScoreSummaryPanel.tsx`

**Interfaces:**
- Produces: a trimmed `ColumnTotals` interface (`{ counts, unrated, total }`, no `rated`/`average`/`label`) consumed only within this file by `SummaryTable` and `GrandTotal`.

- [ ] **Step 1: Remove the now-dead `RatingLabel` import and `LABEL_PILL` map**

Replace:

```tsx
import {
  computeScoreSummary,
  isoToDate,
  summarizeCounts,
  PLATFORM_MAX_SCORE,
  type BrandSummary,
  type Platform,
  type RatingLabel,
  type Star as StarRating,
} from '../lib/scoreSummary';
import { tabToSlug } from '../lib/tabs';
import type { Entry } from '../types/entry';

interface Props {
  entries: Entry[];
}

const LABEL_PILL: Record<RatingLabel, string> = {
  Excellent: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Great: 'bg-green-50 text-green-700 ring-1 ring-green-200',
  Average: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Poor: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  Bad: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};
```

With:

```tsx
import {
  computeScoreSummary,
  isoToDate,
  summarizeCounts,
  PLATFORM_MAX_SCORE,
  type BrandSummary,
  type Platform,
  type Star as StarRating,
} from '../lib/scoreSummary';
import { tabToSlug } from '../lib/tabs';
import type { Entry } from '../types/entry';

interface Props {
  entries: Entry[];
}
```

- [ ] **Step 2: Drop the two trailing columns from `SummaryColgroup`**

Replace:

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
      <col className="w-24" />
      <col className="w-32" />
    </colgroup>
  );
}
```

With:

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

- [ ] **Step 3: Trim `ColumnTotals` and `computeColumnTotals` to drop `rated`/`average`/`label`**

Replace:

```tsx
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
  const { total, rated, average, label } = summarizeCounts(counts, unrated, maxScore);
  return { counts, unrated, rated, total, average, label };
}
```

With:

```tsx
interface ColumnTotals {
  counts: Record<StarRating, number>;
  unrated: number;
  total: number;
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
  const { total } = summarizeCounts(counts, unrated, maxScore);
  return { counts, unrated, total };
}
```

- [ ] **Step 4: Remove the Avg/Rating header and body cells from `GrandTotal`**

Replace:

```tsx
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
            <td className={`px-2 py-2 text-right tabular-nums ${t.unrated > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
              {t.unrated.toLocaleString()}
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{t.total.toLocaleString()}</td>
            <td className="px-2 py-2 text-right tabular-nums">
              {t.average == null ? (
                <span className="text-slate-400">—</span>
              ) : (
                <span className="inline-flex items-baseline gap-1">
                  {t.rated > 0 && t.rated < t.total && (
                    <span className="text-[10px] font-normal text-slate-400">/{t.rated}</span>
                  )}
                  <span>{t.average.toFixed(1)}</span>
                </span>
              )}
            </td>
            <td className="px-3 py-2">
              {t.label ? (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${LABEL_PILL[t.label]}`}>
                  {t.label}
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )}
            </td>
          </tr>
        </tbody>
```

With:

```tsx
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
            <td className={`px-2 py-2 text-right tabular-nums ${t.unrated > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
              {t.unrated.toLocaleString()}
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{t.total.toLocaleString()}</td>
          </tr>
        </tbody>
```

- [ ] **Step 5: Remove the Avg/Rating header and body cells from `SummaryTable`**

Replace the `<thead>`:

```tsx
            <th
              scope="col"
              className="px-2 py-2 text-right font-medium"
              title="Published reviews with no Score added value yet"
            >
              Unrtd
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Avg</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Rating</th>
          </tr>
        </thead>
```

With:

```tsx
            <th
              scope="col"
              className="px-2 py-2 text-right font-medium"
              title="Published reviews with no Score added value yet"
            >
              Unrtd
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
```

Replace the body row's trailing cells:

```tsx
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800">
                {r.total.toLocaleString()}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {r.average == null ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <span className="inline-flex items-baseline gap-1">
                    {r.rated > 0 && r.rated < r.total && (
                      <span className="text-[10px] text-slate-400">/{r.rated}</span>
                    )}
                    <span className="font-semibold text-slate-800">{r.average.toFixed(1)}</span>
                  </span>
                )}
              </td>
              <td className="px-3 py-1.5">
                {r.label ? (
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${LABEL_PILL[r.label]}`}>
                    {r.label}
                  </span>
                ) : (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
```

With:

```tsx
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800">
                {r.total.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
```

Replace the `tfoot`'s trailing cells (leave the "Total" label cell itself untouched here — Task 2 converts it):

```tsx
            <td className={`px-2 py-2 text-right tabular-nums ${totals.unrated > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
              {totals.unrated.toLocaleString()}
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.total.toLocaleString()}</td>
            <td className="px-2 py-2 text-right tabular-nums">
              {totals.average == null ? (
                <span className="text-slate-400">—</span>
              ) : (
                <span className="inline-flex items-baseline gap-1">
                  {totals.rated > 0 && totals.rated < totals.total && (
                    <span className="text-[10px] font-normal text-slate-400">/{totals.rated}</span>
                  )}
                  <span>{totals.average.toFixed(1)}</span>
                </span>
              )}
            </td>
            <td className="px-3 py-2">
              {totals.label ? (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${LABEL_PILL[totals.label]}`}>
                  {totals.label}
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )}
            </td>
          </tr>
        </tfoot>
```

With:

```tsx
            <td className={`px-2 py-2 text-right tabular-nums ${totals.unrated > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
              {totals.unrated.toLocaleString()}
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.total.toLocaleString()}</td>
          </tr>
        </tfoot>
```

- [ ] **Step 6: Verify the type-check gate**

Run: `npm run build`
Expected: builds cleanly, no TypeScript errors (in particular, no "unused variable" or "property does not exist" errors from the trimmed `ColumnTotals`/`RatingLabel` removal).

- [ ] **Step 7: Manual browser check**

Run `npm run dev`, open the dashboard, expand Score Summary, and for each of the four platform tabs (TrustPilot, AskGamblers, CasinoGuru, Wizard of Odds) confirm:
- No `Avg` or `Rating` column header in any group's table.
- No `Avg` or `Rating` column header in the "All brands" bar (visible when no brand-group filter is applied and more than one group has data).
- Star-count and Unrtd/Total columns still line up correctly (no leftover empty column from a missed `<col>`).

- [ ] **Step 8: Commit**

```bash
git add src/components/ScoreSummaryPanel.tsx
git commit -m "feat: remove Avg and Rating columns from Score Summary tables"
```

---

## Task 2: Make each group's Total row link into the Brands tab

**Files:**
- Modify: `src/components/ScoreSummaryPanel.tsx` (`SummaryTable`'s `tfoot`)

**Interfaces:**
- Consumes: `Link` (from `react-router-dom`, already imported), `tabToSlug` (from `../lib/tabs`, already imported), `platform` prop already passed into `SummaryTable`, `rows: BrandSummary[]` (each with `.tab` and `.brand: string`).

- [ ] **Step 1: Turn the tfoot "Total" label into a `Link`**

Replace:

```tsx
        <tfoot className="border-t-2 border-slate-200 bg-slate-50/80">
          <tr className="font-semibold text-slate-800">
            {showGroup && <td className="px-3 py-2" />}
            <td className="px-3 py-2 text-left">Total</td>
```

With:

```tsx
        <tfoot className="border-t-2 border-slate-200 bg-slate-50/80">
          <tr className="font-semibold text-slate-800">
            {showGroup && <td className="px-3 py-2" />}
            <td className="px-3 py-2 text-left">
              <Link
                to={
                  rows.length === 1
                    ? `/brands/${tabToSlug(rows[0].tab)}?platform=${platform}&brand=${encodeURIComponent(rows[0].brand)}`
                    : `/brands/${tabToSlug(rows[0].tab)}?platform=${platform}`
                }
                className="font-medium text-slate-800 hover:text-violet-600 hover:underline"
              >
                Total
              </Link>
            </td>
```

All rows passed into one `SummaryTable` share the same `tab` (`GroupedSummary` groups by `tab` before rendering each `SummaryTable`), so reading `rows[0].tab` is always correct — there's no cross-tab mixing to worry about.

- [ ] **Step 2: Verify the type-check gate**

Run: `npm run build`
Expected: builds cleanly, no TypeScript errors.

- [ ] **Step 3: Manual browser check**

Run `npm run dev`, open the dashboard, expand Score Summary:
- Find a single-brand group (e.g. "GRG - Gulf Recovery Group"). Hover its "Total" text — it should show the same violet hover-underline as the brand name above it. Click it, and confirm the URL and destination are identical to clicking the "Gulf Recovery Group" brand-name link directly (`/brands/grg-gulf-recovery-group?platform=tp&brand=Gulf%20Recovery%20Group` or equivalent for the active platform).
- Find a multi-brand group (e.g. "Hanan"). Click its "Total" text and confirm it navigates to that group's Brands-tab page with **no** brand filter applied (all 8 brands visible, no "Filtered by" chip).
- Repeat the single- vs multi-brand check on at least one other platform tab (e.g. AskGamblers) to confirm `platform` carries over correctly.

- [ ] **Step 4: Commit**

```bash
git add src/components/ScoreSummaryPanel.tsx
git commit -m "feat: make Score Summary's per-group Total row link into the Brands tab"
```
