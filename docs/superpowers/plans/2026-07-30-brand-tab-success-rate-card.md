# Brand Tab Success Rate Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Success Rate figure to brand tab summary cards — a 4th `KpiCard` on single-platform tabs, a percentage badge on each platform card on multi-platform tabs — reusing the counts `BrandGroup.tsx` already computes.

**Architecture:** Two small pure functions (`rateFromCounts`, `successRatePct`) added to `src/lib/scoreSummary.ts`, unit-tested in isolation (this repo has no RTL/jsdom setup, so `BrandGroup.tsx`/`KpiCard.tsx` themselves aren't unit-testable — pushing the actual math into a plain, importable module is what makes it testable at all). `BrandGroup.tsx` imports both and derives a display string from its existing `displayTotals`/`displayKpis` state; `KpiCard.tsx` gets one new color variant for the new card.

**Tech Stack:** React 19, TypeScript strict mode, Vitest (`environment: 'node'`, no testing-library installed — pure-function tests only), Tailwind v4.

## Global Constraints

- Success Rate formula: `live / (live + removed) × 100`, using counts that already respect the active date-range filter and already exclude platform-removed brands — no new data fetching or filtering logic.
- Display format: floored whole-number percent (e.g. `"66%"`), except exactly `100` stays `100` — mirrors `successRatePct` in `src/components/ScoreSummaryPanel.tsx:53-56` so the same underlying rate renders as the same integer on both pages. Do NOT use `Math.round`.
- Show `—` when `live + removed === 0`.
- No changes to Score Summary page, `queries.ts`, or any Supabase table/migration.
- No new filters or interactivity tied to the new card/badge — both are display-only.
- Verify with `npm test` and `npm run build` (per this repo's convention, `tsc --noEmit` alone checks nothing — the root tsconfig is references-only).

---

### Task 1: Add `rateFromCounts` and `successRatePct` helpers to `scoreSummary.ts`

**Files:**
- Modify: `src/lib/scoreSummary.ts` (insert after `computeTabSuccessRates`, i.e. after line 441)
- Test: `src/lib/scoreSummary.test.ts`

**Interfaces:**
- Produces: `rateFromCounts(live: number, removed: number): number | null` — raw (unrounded) percentage, or `null` when `live + removed === 0`.
- Produces: `successRatePct(rate: number | null): number | null` — floored whole-number percent (exactly `100` stays `100`), or `null` when `rate` is `null`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scoreSummary.test.ts` (place near the existing `computeSuccessRates`/`computeTabSuccessRates` describe blocks; add `rateFromCounts, successRatePct` to the existing import from `./scoreSummary`):

```ts
describe('rateFromCounts', () => {
  it('computes the percentage of live outcomes out of live+removed', () => {
    expect(rateFromCounts(2, 1)).toBeCloseTo((2 / 3) * 100);
  });

  it('returns null when there are no decided outcomes yet', () => {
    expect(rateFromCounts(0, 0)).toBeNull();
  });

  it('returns 100 when everything is live', () => {
    expect(rateFromCounts(5, 0)).toBe(100);
  });

  it('returns 0 when everything is removed', () => {
    expect(rateFromCounts(0, 5)).toBe(0);
  });
});

describe('successRatePct', () => {
  it('floors a fractional rate down to the nearest whole percent', () => {
    expect(successRatePct(66.666)).toBe(66);
  });

  it('keeps a rate of exactly 100 as 100 (not floored to 99 by float error)', () => {
    expect(successRatePct(100)).toBe(100);
  });

  it('returns null for a null rate', () => {
    expect(successRatePct(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- scoreSummary`
Expected: FAIL — `rateFromCounts`/`successRatePct` are not exported from `./scoreSummary`.

- [ ] **Step 3: Implement the helpers**

In `src/lib/scoreSummary.ts`, insert immediately after `computeTabSuccessRates` (after line 441, before `export type PresetKey`):

```ts
// Success Rate for a single already-computed live/removed pair — used by
// BrandGroup.tsx's summary cards, which derive live/removed from page state
// (displayTotals/displayKpis) rather than raw entries, unlike
// computeSuccessRates/computeTabSuccessRates above which do their own entry
// iteration and date filtering.
export function rateFromCounts(live: number, removed: number): number | null {
  const total = live + removed;
  return total === 0 ? null : (live / total) * 100;
}

// Whole-number percent for display: floored, except a rate of exactly 100
// stays 100. Mirrors successRatePct in ScoreSummaryPanel.tsx so the same
// underlying rate renders as the same integer on both pages (kept in sync
// manually — verify before assuming still aligned if either changes).
export function successRatePct(rate: number | null): number | null {
  if (rate == null) return null;
  return rate === 100 ? 100 : Math.floor(rate);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- scoreSummary`
Expected: PASS, all new and existing `scoreSummary.test.ts` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts
git commit -m "feat: add rateFromCounts/successRatePct success-rate helpers"
```

---

### Task 2: Add a `violet` color variant to `KpiCard`

**Files:**
- Modify: `src/components/KpiCard.tsx:13`, `:19-23`

**Interfaces:**
- Consumes: nothing new.
- Produces: `KpiCard`'s `color` prop now accepts `'violet'` in addition to `'blue' | 'emerald' | 'rose'`.

- [ ] **Step 1: Extend the `color` prop type**

In `src/components/KpiCard.tsx`, change line 13:

```ts
  color?: 'blue' | 'emerald' | 'rose' | 'violet';
```

- [ ] **Step 2: Add the `violet` entry to `colorMap`**

Change lines 19-23:

```ts
const colorMap = {
  blue:    { bar: 'bg-blue-500',    icon: 'bg-blue-50 text-blue-500',    value: 'text-blue-600'    },
  emerald: { bar: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-500', value: 'text-emerald-600' },
  rose:    { bar: 'bg-rose-500',    icon: 'bg-rose-50 text-rose-500',    value: 'text-rose-600'    },
  violet:  { bar: 'bg-violet-500',  icon: 'bg-violet-50 text-violet-500', value: 'text-violet-600'  },
};
```

- [ ] **Step 3: Verify the project still builds**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (no test file exists for `KpiCard.tsx` — this repo has no RTL/jsdom setup, so a type-check + build is the available verification for this component).

- [ ] **Step 4: Commit**

```bash
git add src/components/KpiCard.tsx
git commit -m "feat: add violet color variant to KpiCard"
```

---

### Task 3: Add the Success Rate card to single-platform brand tabs

**Files:**
- Modify: `src/pages/BrandGroup.tsx:19` (import), `~1441` (new derived value, immediately after the `displayTotals` block which currently ends at line 1441), `1689-1714` (card row)

**Interfaces:**
- Consumes: `rateFromCounts`, `successRatePct` from Task 1 (`src/lib/scoreSummary.ts`); `violet` color variant from Task 2 (`src/components/KpiCard.tsx`); existing `displayTotals: { total: number; live: number; removed: number }` (`BrandGroup.tsx` ~1415-1441).
- Produces: nothing consumed by later tasks (Task 4 is independent).

- [ ] **Step 1: Import the new helpers**

In `src/pages/BrandGroup.tsx`, change line 19 from:

```ts
import { parseScore, PLATFORM_MAX_SCORE, type Platform } from '../lib/scoreSummary';
```

to:

```ts
import { parseScore, PLATFORM_MAX_SCORE, rateFromCounts, successRatePct, type Platform } from '../lib/scoreSummary';
```

- [ ] **Step 2: Derive the display string right after `displayTotals`**

Immediately after the `displayTotals` block (which ends at line 1441 with `})();`), add:

```ts
  const successRateDisplay = (() => {
    const pct = successRatePct(rateFromCounts(displayTotals.live, displayTotals.removed));
    return pct == null ? '—' : `${pct}%`;
  })();
```

- [ ] **Step 3: Add the 4th card to the single-platform row**

Change the block at lines 1689-1714 from `sm:grid-cols-3` to `sm:grid-cols-4` and add the new `KpiCard`:

```tsx
      {activePlatforms.length <= 1 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 mt-[10px]">
          <KpiCard
            label="Total"
            value={loading ? '…' : displayTotals.total.toLocaleString()}
            icon={<Building2 className="size-4" />}
            onClick={() => setShowTotalModal(true)}
          />
          <KpiCard
            label="Live"
            value={loading ? '…' : displayTotals.live.toLocaleString()}
            hint="Reviews live or published"
            color="emerald"
            onClick={() => { setStatusFilter(statusFilter === 'live' ? 'all' : 'live'); setPage(1); }}
            active={statusFilter === 'live'}
          />
          <KpiCard
            label="Removed"
            value={loading ? '…' : displayTotals.removed.toLocaleString()}
            hint="Reviews removed or refused"
            color="rose"
            onClick={() => { setStatusFilter(statusFilter === 'removed' ? 'all' : 'removed'); setPage(1); }}
            active={statusFilter === 'removed'}
          />
          <KpiCard
            label="Success Rate"
            value={loading ? '…' : successRateDisplay}
            hint="Live ÷ (Live + Removed)"
            color="violet"
          />
        </div>
      )}
```

- [ ] **Step 4: Run the full test suite and build**

Run: `npm test`
Expected: PASS, no regressions.

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev`, log in, and open a single-platform tab (e.g. BITP, per the CLAUDE.md example). Confirm:
- The card row now shows 4 cards: Total, Live, Removed, Success Rate.
- The Success Rate card is violet-accented and shows a whole-number percent (e.g. `"73%"`) matching `Live / (Live + Removed)` from the same row's numbers.
- Setting a date range narrows Total/Live/Removed as before, and Success Rate updates to match the new Live/Removed.
- A tab/date combination with 0 Live and 0 Removed shows `—`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: add Success Rate card to single-platform brand tabs"
```

---

### Task 4: Add the Success Rate badge to multi-platform brand tab cards

**Files:**
- Modify: `src/pages/BrandGroup.tsx:1716-1771`

**Interfaces:**
- Consumes: `rateFromCounts`, `successRatePct` (already imported in Task 3, Step 1); existing `displayKpis: Record<'tp' | 'ag' | 'cg', { live: number; removed: number }>` (`BrandGroup.tsx` ~1374-1393).

- [ ] **Step 1: Add the badge inside the per-platform card map**

In `src/pages/BrandGroup.tsx`, inside the `visibleCards.map(({ key, label }) => { ... })` callback (currently starting at line 1723), add the derived display string alongside the existing `const active = ...` line, and render it in the header row:

```tsx
          {visibleCards.map(({ key, label }) => {
            const active = platformFilter === key;
            const platformSuccessDisplay = (() => {
              const pct = successRatePct(rateFromCounts(displayKpis[key].live, displayKpis[key].removed));
              return pct == null ? '—' : `${pct}%`;
            })();
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  const next = active ? 'all' : key;
                  setPlatformFilter(next);
                  setSearchParams((prev) => {
                    const params = new URLSearchParams(prev);
                    if (next === 'all') params.delete('platform');
                    else params.set('platform', next);
                    return params;
                  });
                  setPage(1);
                }}
                className={`rounded-lg border p-4 text-left transition-all shadow-sm ${active ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50'}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <img
                    src={PLATFORM_FAVICON[key]}
                    alt={label}
                    className="size-4 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
                  {!loading && (
                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5">
                      {platformSuccessDisplay}
                    </span>
                  )}
                  {active && <Check className="size-3 ml-auto text-blue-500" />}
                </div>
                {loading ? (
                  <div className="h-6 w-20 animate-pulse rounded bg-slate-200" />
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-semibold text-emerald-700">{displayKpis[key].live.toLocaleString()}</span>
                      <span className="text-xs text-slate-400">Live</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-semibold text-rose-600">{displayKpis[key].removed.toLocaleString()}</span>
                      <span className="text-xs text-slate-400">Removed</span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
```

- [ ] **Step 2: Run the full test suite and build**

Run: `npm test`
Expected: PASS, no regressions.

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Manual verification in the browser**

With `npm run dev` still running, open a three-platform tab (e.g. Rooster Partners). Confirm:
- Each platform card (TP/AG/CG) now shows a small percentage badge next to its label, before the checkmark when that card is active.
- The percentage matches that card's own `Live / (Live + Removed)`.
- Clicking a card still filters to that platform as before (badge is non-interactive, doesn't interfere with the button's own click behavior).
- A platform with 0 Live and 0 Removed shows `—` in its badge.

- [ ] **Step 4: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: add Success Rate badge to multi-platform brand tab cards"
```
