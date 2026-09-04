# Manual pauses editable from the Schedule Planner status column — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual `brand_platform_override` pauses visible on the Schedule Planner grid again and editable (create / edit reason & resume date / resume) directly from the Schedule Status column, sharing one write path with Edit Brand Tab so the two surfaces stay in sync.

**Architecture:** (1) A new pure-ish shared module `src/lib/platformPauseActions.ts` holds the override write/resume sequence currently inlined only in `TabPausedBrandsSection`; both surfaces call it. (2) `TabScheduleSection` stops subtracting override-paused combos from the grid, so a materialized manual pause renders with the same `source="system"` treatment an auto-pause already gets. (3) The Schedule Status icon routes an override-paused platform's click to `PlatformPauseModal` (reason/resume editor); active platforms keep opening `PauseDaysModal`, which gains a button to escalate into `PlatformPauseModal`. (4) `titleFor` tooltip wording forks "Auto-paused" vs "Manually paused".

**Tech Stack:** React 19 + TypeScript, Vitest (`environment: 'node'` — pure-function unit tests only; presentational/JSX changes verified by `npm run build` + a live Playwright pass), Tailwind v4, Supabase.

**Spec:** `docs/superpowers/specs/2026-09-04-schedule-planner-manual-pause-status-column-design.md`

## Global Constraints

- TypeScript strict mode. No `any` without a comment explaining why.
- Verify every task with `npm run build` (root `tsconfig` is references-only, so `tsc --noEmit` checks nothing — see project memory).
- Vitest runs in `environment: 'node'` — no jsdom. Do NOT add `@testing-library/react` render tests. Unit-test pure functions only; verify component/JSX changes by build + live check.
- Cross-dashboard consistency (CLAUDE.md): the override write/resume sequence MUST be one shared function, not a second copy. `TabPausedBrandsSection` and `TabScheduleSection` both call `src/lib/platformPauseActions.ts`.
- No migration, no Supabase Edge Function deploy. `get_paused_combos` / `get_schedule` in `supabase/functions/ai-assistant/tools.ts` are unaffected (they already read `brand_platform_override` directly and do not subtract override pauses). Deploy is frontend only: `git push origin main`.
- Current-week guard: never call `recalculatePauses` for a non-current navigated week (Task 311 Critical — an unguarded recalc sweeps every other brand's pause row on the tab). This plan refreshes via the existing `reloadSeq` bump, whose downstream scheduler-invocation effect is already `isCurrentWeekStart`-gated — do not add a second unguarded recalc path.

---

### Task 1: Shared `platformPauseActions.ts` helper module

**Files:**
- Create: `src/lib/platformPauseActions.ts`
- Test: `src/lib/platformPauseActions.test.ts`

**Interfaces:**
- Consumes: `setBrandPlatformOverride`, `clearBrandPlatformOverride`, `deleteBrandPlatformPause` from `src/lib/queries.ts`; `overrideKey`, `OverrideDetails` from `src/lib/scheduleOverrides.ts`; `normalizeBrandKey`, `Platform` from `src/lib/removedPlatformBrands.ts`.
  - `setBrandPlatformOverride(tab: string, brand: string, platform: Platform, state: 'pause'|'active', opts?: { reason?: string|null; resumeAt?: string|null }): Promise<void>`
  - `clearBrandPlatformOverride(tab: string, brandKey: string, platform: Platform): Promise<void>`
  - `deleteBrandPlatformPause(tab: string, brandKey: string, platform: Platform): Promise<void>`
- Produces (later tasks rely on these exact signatures):
  - `savePlatformPause(params: { tab: string; brand: string; eligiblePlatforms: Platform[]; checkedPlatforms: Platform[]; reason: string; resumeAt: string | null; overrideMap: Map<string, OverrideDetails> }, writers?: PlatformPauseWriters): Promise<void>`
  - `resumePlatformPause(tab: string, brandKey: string, platform: Platform, writers?: Pick<PlatformPauseWriters, 'clearOverride' | 'deletePause'>): Promise<void>`
  - `derivePauseModalInitial(tab: string, brand: string, eligiblePlatforms: Platform[], overrideMap: Map<string, OverrideDetails>): { checkedPlatforms: Platform[]; initialReason: string; initialResumeAt: string | null }`
  - `interface PlatformPauseWriters { setOverride: typeof setBrandPlatformOverride; clearOverride: typeof clearBrandPlatformOverride; deletePause: typeof deleteBrandPlatformPause }`

The write/resume logic is lifted verbatim from `TabPausedBrandsSection.tsx`'s current `handleSavePause` loop (lines ~170–184), `handleResume` (lines ~131–137), and `pauseModalInitial` (lines ~204–224) — minus the React state. Writers are injected with real defaults so the unit test can pass fakes (mirrors `deriveTabPausedBrandRows`'s injected `eligible` callback pattern).

- [ ] **Step 1: Write the failing test**

Create `src/lib/platformPauseActions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { savePlatformPause, resumePlatformPause, derivePauseModalInitial } from './platformPauseActions';
import { overrideKey, type OverrideDetails } from './scheduleOverrides';
import type { Platform } from './removedPlatformBrands';

type Call = [string, ...unknown[]];

function fakeWriters() {
  const calls: Call[] = [];
  return {
    calls,
    writers: {
      setOverride: async (...a: unknown[]) => { calls.push(['setOverride', ...a]); },
      clearOverride: async (...a: unknown[]) => { calls.push(['clearOverride', ...a]); },
      deletePause: async (...a: unknown[]) => { calls.push(['deletePause', ...a]); },
    } as never,
  };
}

const TAB = 'BITP';
const PLATS: Platform[] = ['tp', 'ag'];

function overrideMapWith(entries: Array<[Platform, Partial<OverrideDetails>]>): Map<string, OverrideDetails> {
  const m = new Map<string, OverrideDetails>();
  for (const [p, d] of entries) {
    m.set(overrideKey(TAB, 'brand x', p), { state: 'pause', reason: null, resumeAt: null, setBy: null, ...d });
  }
  return m;
}

describe('savePlatformPause', () => {
  it('writes a new override for a newly-checked platform', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      reason: 'client hold', resumeAt: null, overrideMap: new Map(),
    }, writers);
    expect(calls).toEqual([['setOverride', TAB, 'Brand X', 'tp', 'pause', { reason: 'client hold', resumeAt: null }]]);
  });

  it('does not re-write an unchanged existing pause', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      reason: 'r', resumeAt: '2026-10-05',
      overrideMap: overrideMapWith([['tp', { reason: 'r', resumeAt: '2026-10-05' }]]),
    }, writers);
    expect(calls).toEqual([]);
  });

  it('re-writes when reason or resumeAt changed', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: ['tp'],
      reason: 'new reason', resumeAt: null,
      overrideMap: overrideMapWith([['tp', { reason: 'old', resumeAt: null }]]),
    }, writers);
    expect(calls).toEqual([['setOverride', TAB, 'Brand X', 'tp', 'pause', { reason: 'new reason', resumeAt: null }]]);
  });

  it('unchecking a paused platform clears the override AND deletes the materialized pause row', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: PLATS, checkedPlatforms: [],
      reason: '', resumeAt: null,
      overrideMap: overrideMapWith([['tp', { reason: 'r', resumeAt: null }]]),
    }, writers);
    expect(calls).toEqual([
      ['clearOverride', TAB, 'brand x', 'tp'],
      ['deletePause', TAB, 'brand x', 'tp'],
    ]);
  });

  it('ignores platforms outside eligiblePlatforms', async () => {
    const { calls, writers } = fakeWriters();
    await savePlatformPause({
      tab: TAB, brand: 'Brand X', eligiblePlatforms: ['tp'], checkedPlatforms: ['ag'],
      reason: 'x', resumeAt: null, overrideMap: new Map(),
    }, writers);
    expect(calls).toEqual([]);
  });
});

describe('resumePlatformPause', () => {
  it('clears the override then deletes the materialized pause row', async () => {
    const { calls, writers } = fakeWriters();
    await resumePlatformPause(TAB, 'brand x', 'tp', writers);
    expect(calls).toEqual([
      ['clearOverride', TAB, 'brand x', 'tp'],
      ['deletePause', TAB, 'brand x', 'tp'],
    ]);
  });
});

describe('derivePauseModalInitial', () => {
  it('checks paused platforms and seeds reason/resumeAt from the first paused one', () => {
    const res = derivePauseModalInitial(TAB, 'Brand X', PLATS, overrideMapWith([
      ['ag', { reason: 'ag reason', resumeAt: '2026-11-01' }],
    ]));
    expect(res.checkedPlatforms).toEqual(['ag']);
    expect(res.initialReason).toBe('ag reason');
    expect(res.initialResumeAt).toBe('2026-11-01');
  });

  it('returns empty state when nothing is paused', () => {
    const res = derivePauseModalInitial(TAB, 'Brand X', PLATS, new Map());
    expect(res).toEqual({ checkedPlatforms: [], initialReason: '', initialResumeAt: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/platformPauseActions.test.ts`
Expected: FAIL — `Failed to resolve import "./platformPauseActions"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/platformPauseActions.ts`:

```typescript
// Shared override-pause write/resume sequence. Used by BOTH the Edit Brand Tab
// "Paused brands" section (TabPausedBrandsSection) and the Schedule Planner's
// Schedule Status column (TabScheduleSection) so the two surfaces can never
// drift — CLAUDE.md's cross-dashboard-consistency rule.
//
// A pause writes only brand_platform_override; recalculatePauses materializes it
// onto the brand_platform_pause weekly cache on the next Schedule Planner visit
// / Monday cron. A RESUME (uncheck) additionally deletes that materialized
// brand_platform_pause row so the resume is immediate — without it a cleared
// permanent override leaves the pause row in place for the rest of the week
// (recalculatePauses then sees paused_week_start === weekStart, not `<`).
import {
  setBrandPlatformOverride,
  clearBrandPlatformOverride,
  deleteBrandPlatformPause,
} from './queries';
import { overrideKey, type OverrideDetails } from './scheduleOverrides';
import { normalizeBrandKey, type Platform } from './removedPlatformBrands';

export interface PlatformPauseWriters {
  setOverride: typeof setBrandPlatformOverride;
  clearOverride: typeof clearBrandPlatformOverride;
  deletePause: typeof deleteBrandPlatformPause;
}

const defaultWriters: PlatformPauseWriters = {
  setOverride: setBrandPlatformOverride,
  clearOverride: clearBrandPlatformOverride,
  deletePause: deleteBrandPlatformPause,
};

export async function savePlatformPause(
  params: {
    tab: string;
    brand: string;
    eligiblePlatforms: Platform[];
    checkedPlatforms: Platform[];
    reason: string;
    resumeAt: string | null;
    overrideMap: Map<string, OverrideDetails>;
  },
  writers: PlatformPauseWriters = defaultWriters,
): Promise<void> {
  const { tab, brand, eligiblePlatforms, checkedPlatforms, reason, resumeAt, overrideMap } = params;
  const brandKey = normalizeBrandKey(brand);
  const nowChecked = new Set(checkedPlatforms);
  for (const platform of eligiblePlatforms) {
    const existing = overrideMap.get(overrideKey(tab, brandKey, platform));
    const wasPaused = existing?.state === 'pause';
    if (nowChecked.has(platform)) {
      const unchanged = wasPaused && existing.reason === reason && existing.resumeAt === resumeAt;
      if (!unchanged) {
        await writers.setOverride(tab, brand, platform, 'pause', { reason, resumeAt });
      }
    } else if (wasPaused) {
      await writers.clearOverride(tab, brandKey, platform);
      await writers.deletePause(tab, brandKey, platform);
    }
  }
}

export async function resumePlatformPause(
  tab: string,
  brandKey: string,
  platform: Platform,
  writers: Pick<PlatformPauseWriters, 'clearOverride' | 'deletePause'> = defaultWriters,
): Promise<void> {
  await writers.clearOverride(tab, brandKey, platform);
  await writers.deletePause(tab, brandKey, platform);
}

// Seeds PlatformPauseModal's initial state from any existing override-pause rows
// for this brand: which platforms are checked, plus reason/resumeAt taken from
// the first paused platform found (spec-sanctioned — the modal edits one shared
// reason/date across the checked set).
export function derivePauseModalInitial(
  tab: string,
  brand: string,
  eligiblePlatforms: Platform[],
  overrideMap: Map<string, OverrideDetails>,
): { checkedPlatforms: Platform[]; initialReason: string; initialResumeAt: string | null } {
  const brandKey = normalizeBrandKey(brand);
  const checkedPlatforms: Platform[] = [];
  let initialReason = '';
  let initialResumeAt: string | null = null;
  for (const platform of eligiblePlatforms) {
    const ov = overrideMap.get(overrideKey(tab, brandKey, platform));
    if (ov?.state === 'pause') {
      checkedPlatforms.push(platform);
      if (!initialReason && ov.reason) {
        initialReason = ov.reason;
        initialResumeAt = ov.resumeAt;
      }
    }
  }
  return { checkedPlatforms, initialReason, initialResumeAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/platformPauseActions.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/platformPauseActions.ts src/lib/platformPauseActions.test.ts
git commit -m "feat: shared platformPauseActions helper (savePlatformPause/resumePlatformPause/derivePauseModalInitial)"
```

---

### Task 2: Route `TabPausedBrandsSection` through the shared helper

**Files:**
- Modify: `src/components/TabPausedBrandsSection.tsx` (`handleSavePause` ~159–199, `handleResume` ~126–152, `pauseModalInitial` ~204–224 and its call site ~303)

**Interfaces:**
- Consumes: `savePlatformPause`, `resumePlatformPause`, `derivePauseModalInitial` from Task 1.
- Produces: no new exports. Behavior must be identical to today (verified by the unchanged `tabPausedBrands.test.ts` + build).

No test changes — this is a pure refactor. `deriveTabPausedBrandRows` and its tests are untouched.

- [ ] **Step 1: Add the import**

In the `../lib/queries` import block, remove `setBrandPlatformOverride`, `clearBrandPlatformOverride`, `deleteBrandPlatformPause` **only if** they become unused after the edits below (grep first — keep any still referenced). Add:

```typescript
import { savePlatformPause, resumePlatformPause, derivePauseModalInitial } from '../lib/platformPauseActions';
```

- [ ] **Step 2: Replace `handleResume`'s write pair**

Inside `handleResume`, replace:

```typescript
      await clearBrandPlatformOverride(tabName, brandKey, platform);
      // ...existing comment...
      await deleteBrandPlatformPause(tabName, brandKey, platform);
      cleared = true;
```

with:

```typescript
      await resumePlatformPause(tabName, brandKey, platform);
      cleared = true;
```

Keep the surrounding `setBusy` / `setError` / `try/catch` / best-effort `refresh()` exactly as-is.

- [ ] **Step 3: Replace `handleSavePause`'s loop**

Replace the whole `for (const platform of eligibleFor(brand)) { ... }` block with:

```typescript
      await savePlatformPause({
        tab: tabName,
        brand,
        eligiblePlatforms: eligibleFor(brand),
        checkedPlatforms,
        reason,
        resumeAt,
        overrideMap,
      });
      setPickerBrand(null);
```

Keep the surrounding `setBusy(true)` / `setError(null)` / `try/catch` / best-effort `refresh()` as-is. Note the local vars `brandKey` and `nowChecked` at the top of `handleSavePause` become unused — delete those two lines.

- [ ] **Step 4: Replace `pauseModalInitial`**

Delete the local `function pauseModalInitial(brand: string) { ... }`. At its call site (`const init = pauseModalInitial(pickerBrand);`), replace with:

```typescript
        const init = derivePauseModalInitial(tabName, pickerBrand, eligibleFor(pickerBrand), overrideMap);
```

- [ ] **Step 5: Build + existing tests**

Run: `npm run build`
Expected: clean (no unused-import / unused-var errors).

Run: `npx vitest run src/lib/tabPausedBrands.test.ts`
Expected: PASS, unchanged count.

- [ ] **Step 6: Commit**

```bash
git add src/components/TabPausedBrandsSection.tsx
git commit -m "refactor: TabPausedBrandsSection uses shared platformPauseActions helper"
```

---

### Task 3: Tooltip wording — "Auto-paused" vs "Manually paused" in `titleFor`

**Files:**
- Modify: `src/lib/scheduler/calendarRenderer.tsx` (`titleFor` ~493–525; export it; `ScheduleStatusIcon` line-split render ~533, ~547–555)
- Test: `src/lib/scheduler/calendarRenderer.titleFor.test.ts` (create)

**Interfaces:**
- Produces: `export function titleFor(props: ScheduleStatusIconProps): string` (currently unexported — add `export`). `ScheduleStatusIconProps` stays internal; the test builds the `system` variant inline.

- [ ] **Step 1: Write the failing test**

Create `src/lib/scheduler/calendarRenderer.titleFor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { titleFor } from './calendarRenderer';
import type { BrandPlatformPause } from '../queries';

const pause = (over: Partial<BrandPlatformPause> = {}): BrandPlatformPause => ({
  id: 1, tab: 'BITP', brand_key: 'brand x', platform: 'tp',
  reason: 'client hold', paused_week_start: '2026-09-07', created_at: '', ...over,
} as BrandPlatformPause);

describe('titleFor — system (paused) variant', () => {
  it('auto-detected pause (pauseResumeAt undefined) says "Auto-paused" and "Resumes week of"', () => {
    const t = titleFor({ platform: 'tp', source: 'system', pause: pause(), clickable: true, onClick: () => {} });
    expect(t.split('\n')[0]).toBe('Auto-paused');
    expect(t).toContain('Reason: client hold');
    expect(t).toContain('Resumes week of');
  });

  it('override permanent pause (pauseResumeAt null) says "Manually paused" and "until manually cleared"', () => {
    const t = titleFor({ platform: 'tp', source: 'system', pause: pause(), pauseResumeAt: null, clickable: true, onClick: () => {} });
    expect(t.split('\n')[0]).toBe('Manually paused');
    expect(t).toContain('Reason: client hold');
    expect(t).toContain('until manually cleared');
  });

  it('override dated pause says "Manually paused" and "Resumes <date>"', () => {
    const t = titleFor({ platform: 'tp', source: 'system', pause: pause(), pauseResumeAt: '2026-10-12', clickable: true, onClick: () => {} });
    expect(t.split('\n')[0]).toBe('Manually paused');
    expect(t).toContain('Resumes ');
    expect(t).not.toContain('week of');
  });
});
```

(If `BrandPlatformPause`'s real fields differ, adjust the `pause()` factory to satisfy the type — the test only reads `reason` and `paused_week_start`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scheduler/calendarRenderer.titleFor.test.ts`
Expected: FAIL — `titleFor` is not exported (`does not provide an export named 'titleFor'`).

- [ ] **Step 3: Export and reword `titleFor`**

Change `function titleFor(` to `export function titleFor(`.

Replace the `if (props.source === 'system') { ... }` body with:

```typescript
  if (props.source === 'system') {
    const { pause, pauseResumeAt } = props;
    // pauseResumeAt is passed (even as null) ONLY when this pause is driven by a
    // brand_platform_override row — resolved from the override map by the
    // caller, never by comparing pause.reason to a constant (see the 2026-09-02
    // reason spec for why that string compare was a latent bug).
    //   undefined -> auto-detected underperformance pause
    //   null      -> manual override, permanent
    //   ISO date  -> manual override, periodic (own real resume date)
    if (pauseResumeAt === undefined) {
      return `Auto-paused\nReason: ${pause.reason}\nResumes week of ${resumeWeekLabel(pause.paused_week_start)}`;
    }
    if (pauseResumeAt === null) {
      return `Manually paused\nReason: ${pause.reason}\nStays paused until manually cleared`;
    }
    return `Manually paused\nReason: ${pause.reason}\nResumes ${resumeAtLabel(pauseResumeAt)}`;
  }
```

- [ ] **Step 4: Make `ScheduleStatusIcon` render every line**

`titleFor` now returns three `\n`-joined lines for the `system` branch (was two). Find in `ScheduleStatusIcon`:

```typescript
  const [line1, line2] = titleFor(props).split('\n');
```

Replace with:

```typescript
  const lines = titleFor(props).split('\n');
```

And in the tooltip `content` JSX, replace the `<div>{line1}</div>` / `{line2 && <div>{line2}</div>}` pair with:

```tsx
      {lines.map((l, i) => <div key={i}>{l}</div>)}
```

Leave the `{isActualPause && pausedBy && ...}`, `{agent && ...}`, `{actionLine && ...}` lines below it unchanged.

- [ ] **Step 5: Run test + build**

Run: `npx vitest run src/lib/scheduler/calendarRenderer.titleFor.test.ts`
Expected: PASS (3 tests).

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/calendarRenderer.tsx src/lib/scheduler/calendarRenderer.titleFor.test.ts
git commit -m "feat: Schedule Status tooltip distinguishes Auto-paused vs Manually paused"
```

---

### Task 4: Stop hiding manual pauses from the Schedule Planner grid

**Files:**
- Modify: `src/components/TabScheduleSection.tsx` — delete `overridePausedComboKeys` (~702–719) and `activeBrandPlatforms` (~721–733); repoint `visibleBrandPlatforms` (~741–743), `filteredBrands` (~799–810), `platformCounts` (~820–834); fix the doc comments at ~792 and ~735.

**Interfaces:**
- Consumes: existing `brandPlatforms(brand: string): Platform[]` (unchanged).
- Produces: no new exports. `visibleBrandPlatforms`, `filteredBrands`, `platformCounts` keep their names/types; only their inputs change.

No unit test — `TabScheduleSection` has no test file and Vitest is node-env. Verified by build + Task 7's live pass. `git grep` after the edits must show zero remaining `activeBrandPlatforms` / `overridePausedComboKeys`.

- [ ] **Step 1: Delete the two blocks**

Remove the entire `const overridePausedComboKeys = useMemo(...)` memo and its leading comment (~702–719), and the entire `function activeBrandPlatforms(brand: string): Platform[] { ... }` and its leading comment (~721–733).

- [ ] **Step 2: Repoint `visibleBrandPlatforms`**

```typescript
  // Rendering-only narrowing to the toolbar's visiblePlatforms toggle — used
  // solely at the two chip-drawing call sites (day-cell grid + Schedule Status
  // column). Everything else (PMS sync, pause detection, export) calls
  // brandPlatforms() directly.
  function visibleBrandPlatforms(brand: string): Platform[] {
    return filterVisiblePlatforms(brandPlatforms(brand), visiblePlatforms);
  }
```

- [ ] **Step 3: Repoint `filteredBrands`**

Change the first line of the `useMemo` body from `.filter((b) => activeBrandPlatforms(b).length > 0)` to `.filter((b) => brandPlatforms(b).length > 0)`, and update the leading comment to:

```typescript
  // A brand with zero platforms left after brandPlatforms' hidden / restricted /
  // flagged-removed exclusion has nothing to show — dropped from the grid
  // entirely rather than listed as a permanently-empty row. A manually-paused
  // brand+platform is NO LONGER excluded here (it renders like an auto-pause:
  // dimmed day-cell chips + the "⛔ Paused" Schedule Status indicator), so an
  // all-manually-paused brand keeps its row.
```

Remove `overridePausedComboKeys` from this `useMemo`'s dependency array (leave `tabCtx, search, agentFilter, agentIndex`).

- [ ] **Step 4: Repoint `platformCounts`**

Change the `countActivePlatformSlots(...)` call's 4th argument from `activeBrandPlatforms` to `brandPlatforms`. Remove `overridePausedComboKeys` from the dependency array (keep `scheduleRows, tab, filteredBrands, columns, tabCtx, dateStatusIndex, todayISO`). Rewrite the comment above the dep array to drop the `overridePausedComboKeys` / `activeBrandPlatforms` references:

```typescript
    // brandPlatforms is a plain function closing over tabCtx/activePlatforms
    // (re-derived every render) — included here via tabCtx so this recomputes
    // when the exclusion sets it reads from change. A manually-paused platform
    // now counts here and renders on the grid, same as an auto-detected pause.
```

- [ ] **Step 5: Build + grep**

Run: `npm run build`
Expected: clean.

Run: `git grep -n "activeBrandPlatforms\|overridePausedComboKeys" -- src/`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "feat: show manually-paused brand+platforms on the Schedule Planner grid"
```

---

### Task 5: Wire `PlatformPauseModal` into `TabScheduleSection` + status-column click routing

**Files:**
- Modify: `src/components/TabScheduleSection.tsx` — imports (~1–46), new state (~155–158), new `handleSavePlatformPause` (near `handlePauseDaysSave` ~1129), click routing (~1435–1468), new modal render block (near ~1488).

**Interfaces:**
- Consumes: `savePlatformPause`, `derivePauseModalInitial` (Task 1); `PlatformPauseModal` default export from `./PlatformPauseModal` with props — `brand: string`, `platforms: Platform[]`, `initialCheckedPlatforms: Platform[]`, `autoPauseReasonByPlatform: Partial<Record<Platform,string>>`, `initialReason: string`, `initialResumeAt: string | null`, `minResumeAt: string`, `overlayZClass?: string`, `busy: boolean`, `onSave: (checkedPlatforms: Platform[], reason: string, resumeAt: string | null) => void`, `onClose: () => void`.
- Produces: no exports.

- [ ] **Step 1: Imports**

- Add `addDays` to the existing `../lib/scheduleBrands` import (it already imports `toISODate, mondayOf`).
- Add `import PlatformPauseModal from './PlatformPauseModal';` next to the `PauseDaysModal` import.
- Add `import { savePlatformPause, derivePauseModalInitial } from '../lib/platformPauseActions';`.

- [ ] **Step 2: State**

Next to `const [pauseDaysTarget, setPauseDaysTarget] = useState<...>(null);`:

```typescript
  const [platformPauseTarget, setPlatformPauseTarget] = useState<{ brand: string } | null>(null);
  const [platformPauseBusy, setPlatformPauseBusy] = useState(false);
```

- [ ] **Step 3: `handleSavePlatformPause`**

Add near `handlePauseDaysSave`:

```typescript
  // Create / edit / resume a durable manual pause from the Schedule Status
  // column. Writes brand_platform_override via the SAME shared helper Edit Brand
  // Tab uses (platformPauseActions.savePlatformPause), so the two surfaces stay
  // in sync automatically. Then bumps reloadSeq — that re-runs the brands-load
  // effect (refetching brand_platform_override -> overrideMap) and, because
  // tabCtx's identity changes, the scheduler-invocation effect, which
  // recalculatePauses (current week only — already isCurrentWeekStart-gated
  // there) and refetches `pauses`. Same trusted refresh path the live-entries
  // INSERT fallback already uses.
  async function handleSavePlatformPause(
    brand: string,
    checkedPlatforms: Platform[],
    reason: string,
    resumeAt: string | null,
  ) {
    if (!tabCtx) return;
    setPlatformPauseBusy(true);
    try {
      await savePlatformPause({
        tab,
        brand,
        eligiblePlatforms: brandPlatforms(brand),
        checkedPlatforms,
        reason,
        resumeAt,
        overrideMap: tabCtx.overrideMap,
      });
      setPlatformPauseTarget(null);
      setReloadSeq((n) => n + 1);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to update pause', kind: 'error' });
    } finally {
      setPlatformPauseBusy(false);
    }
  }
```

- [ ] **Step 4: Click routing in the Schedule Status column**

In the `visibleBrandPlatforms(brand).map((platform) => { ... })` block (~1435), replace:

```typescript
                          const clickable = canEditWeek(weekStartISO) && !isLegacyWeekAt(weekStartISO);
                          const onClick = () => setPauseDaysTarget({ brand, platform });
```

with:

```typescript
                          const clickable = canEditWeek(weekStartISO) && !isLegacyWeekAt(weekStartISO);
                          // An override-driven pause (manual) routes its click to
                          // the reason/resume editor; every other state keeps the
                          // per-weekday PauseDaysModal. brandKey is in scope here
                          // (declared at the top of this row's render).
                          const isOverridePaused =
                            !!weekPausesByPlatform[platform] &&
                            tabCtx?.overrideMap.get(overrideKey(tab, brandKey, platform))?.state === 'pause';
                          const onClick = isOverridePaused
                            ? () => setPlatformPauseTarget({ brand })
                            : () => setPauseDaysTarget({ brand, platform });
```

(No change to any of the `<ScheduleStatusIcon ... onClick={onClick} />` lines — they already pass `onClick`.)

- [ ] **Step 5: Render `PlatformPauseModal`**

After the `{pauseDaysTarget && pauseDaysModalData && ( ... )}` block (~1499), add:

```tsx
      {platformPauseTarget && tabCtx && (() => {
        const brand = platformPauseTarget.brand;
        const eligible = brandPlatforms(brand);
        const init = derivePauseModalInitial(tab, brand, eligible, tabCtx.overrideMap);
        return (
          <PlatformPauseModal
            brand={brand}
            platforms={eligible}
            initialCheckedPlatforms={init.checkedPlatforms}
            autoPauseReasonByPlatform={{}}
            initialReason={init.initialReason}
            initialResumeAt={init.initialResumeAt}
            minResumeAt={toISODate(addDays(mondayOf(new Date()), 7))}
            busy={platformPauseBusy}
            onSave={(checked, reason, resumeAt) => handleSavePlatformPause(brand, checked, reason, resumeAt)}
            onClose={() => setPlatformPauseTarget(null)}
          />
        );
      })()}
```

`overlayZClass` is omitted → defaults to `z-40` (no parent modal here, unlike Edit Brand Tab).

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "feat: edit/create a manual pause from the Schedule Status column (PlatformPauseModal)"
```

---

### Task 6: "Pause this platform (with reason)…" button in `PauseDaysModal`

**Files:**
- Modify: `src/components/PauseDaysModal.tsx` (`Props` ~7–19, footer ~123–138)
- Modify: `src/components/TabScheduleSection.tsx` (`pauseDaysModalData` ~1100–1122; `<PauseDaysModal>` render ~1488–1499)

**Interfaces:**
- Consumes: `setPlatformPauseTarget` / `setPauseDaysTarget` (Task 5 state).
- Produces: `PauseDaysModal` gains one optional prop `onRequestPlatformPause?: () => void`.

- [ ] **Step 1: Add the prop to `PauseDaysModal`**

In `interface Props`, add after `cancelledDays: Weekday[];`:

```typescript
  // When set, renders a "Pause this platform (with reason)…" button that closes
  // this modal and escalates to the durable-pause editor. Passed by
  // TabScheduleSection only when the target platform has no auto-detected pause.
  onRequestPlatformPause?: () => void;
```

Add `onRequestPlatformPause` to the destructured params in the function signature.

- [ ] **Step 2: Render the button**

Replace the footer `<div className="flex items-center justify-end gap-2 px-5 pt-3 pb-5">` block with:

```tsx
        <div className="flex items-center justify-between gap-2 px-5 pt-3 pb-5">
          {onRequestPlatformPause ? (
            <button
              type="button"
              onClick={onRequestPlatformPause}
              className="rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              Pause this platform (with reason)…
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { onSave([...pausedDays]); onClose(); }}
              className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </div>
```

- [ ] **Step 3: Pass the callback from `TabScheduleSection`**

In `pauseDaysModalData`'s IIFE, it already computes `const systemPaused = !!pausesByPlatform[platform];`. Add to the returned object:

```typescript
          // Offer the durable-pause escalation whenever this platform has no
          // auto-detected pause (an override pause never opens PauseDaysModal —
          // its click routes to PlatformPauseModal directly, Task 5). Covers the
          // "active platform, want a real reasoned pause" case; harmless for a
          // per-day-paused or no-schedule platform.
          offerPlatformPause: !systemPaused,
```

In the `<PauseDaysModal ... />` JSX add:

```tsx
          onRequestPlatformPause={
            pauseDaysModalData.offerPlatformPause
              ? () => { setPauseDaysTarget(null); setPlatformPauseTarget({ brand: pauseDaysTarget.brand }); }
              : undefined
          }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/PauseDaysModal.tsx src/components/TabScheduleSection.tsx
git commit -m "feat: escalate PauseDaysModal to a durable reasoned pause"
```

---

### Task 7: Full verification, live pass, docs

**Files:**
- Modify: `CLAUDE.md` (Recent Changes — prepend a dated entry), `docs/task-history.md` (append `## Task N: …` — check the highest existing number first; a literal `## Task N: Title` heading is required or the PMS sync skips it, per project memory)

- [ ] **Step 1: Full build + suite**

Run: `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: all green. Record the count. If any pre-existing flake (e.g. `queries.publicHolidays.test.ts` 5s timeout), re-run that file in isolation to confirm it's unrelated.

- [ ] **Step 2: Live Playwright pass**

Dev server must be running (`npm run dev`). Use the `playwright` MCP or the repo's existing `playwright` npm dep with `CAPTURE_EMAIL` / `CAPTURE_PASSWORD` from `.env` (project memory: those vars exist). On a real multi-platform tab (e.g. Rooster Partners) for the **current** week:

1. In the Schedule Status column, hover an **active** platform's icon → confirm the hover-revealed icon appears; click it → `PauseDaysModal` opens → click **"Pause this platform (with reason)…"** → `PlatformPauseModal` opens for that brand.
2. Check that platform, enter a reason, pick "Until a date" a week+ out, Save. Confirm: within ~1–2s the row's day-cell chips for that platform go dimmed/paused and the Schedule Status column shows `⛔ Paused`; hover it → tooltip reads **"Manually paused" / "Reason: …" / "Resumes …"**.
3. Open **Edit Brand Tab → "Paused brands"** for the same tab → confirm the same brand+platform is listed with the same reason/date.
4. Back on the Schedule Planner, click that platform's `⛔ Paused` indicator → `PlatformPauseModal` opens with the platform checked and the reason/date pre-filled → change the reason → Save → confirm the tooltip updates.
5. Open `PlatformPauseModal` again, uncheck the platform, Save → confirm the platform returns to active on the grid (chips back), and it's gone from Edit Brand Tab → "Paused brands".
6. Reverse check: pause a different brand+platform from **Edit Brand Tab → "Paused brands"**, return to the Schedule Planner, trigger a reload (navigate week away and back) → confirm it shows as `⛔ Paused` "Manually paused" there too.
7. Confirm an **auto-detected** pause (if one exists on the tab) still opens `PauseDaysModal` on click and its tooltip reads **"Auto-paused" / "Resumes week of …"**.
8. Confirm the platform-count strip ("TP 24" etc.) and the grid agree (a manually-paused platform is counted, matching its now-visible row).

Undo every pause/change made during the walkthrough. If Playwright is unavailable this session, say so explicitly in the commit/notes rather than silently skipping (project norm).

- [ ] **Step 3: Docs**

Prepend a `CLAUDE.md` "Recent Changes" entry dated `2026-09-04` summarizing: manual `brand_platform_override` pauses are visible on the Schedule Planner grid again (reversing part of Tasks 320/321) and editable from the Schedule Status column via `PlatformPauseModal`; shared `src/lib/platformPauseActions.ts` is the single write path for both surfaces; tooltip forks Auto-paused vs Manually paused; `PauseDaysModal` gained a durable-pause escalation button; frontend-only deploy (`git push origin main`), no migration / no edge-function redeploy.

Append the matching `## Task N: …` entry to `docs/task-history.md`.

- [ ] **Step 4: Commit + push**

```bash
git add CLAUDE.md docs/task-history.md
git commit -m "docs: record Task N (manual pauses editable from Schedule Planner status column)"
git push origin main
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| A. Remove override-pause exclusion (`overridePausedComboKeys`/`activeBrandPlatforms` → `brandPlatforms`) | Task 4 |
| B. Tooltip wording fork in `titleFor` + `ScheduleStatusIcon` multi-line render | Task 3 |
| C. Status-column click routing (override pause → `PlatformPauseModal`) | Task 5 (step 4) |
| D. `PauseDaysModal` "Pause this platform (with reason)…" button | Task 6 |
| E. Shared `platformPauseActions.ts` (`savePlatformPause`/`resumePlatformPause`) + both surfaces call it | Task 1 (create) + Task 2 (`TabPausedBrandsSection`) + Task 5 (`TabScheduleSection`) |
| E. Refresh after a Schedule-Planner write | Task 5 step 3 — via `setReloadSeq` bump (deliberate simplification over reviving a bespoke `refreshPauseState`: reuses the trusted INSERT-fallback refetch path, and the downstream `recalculatePauses` is already `isCurrentWeekStart`-gated). Noted in Global Constraints. |
| F. PMS / export / Ask AI unaffected; frontend-only deploy | Global Constraints + Task 7 |
| G. `PlatformPauseModal` wiring details (`minResumeAt`, `overlayZClass` default, initial state) | Task 5 step 5 |
| Testing | Task 1 (helper unit tests), Task 3 (`titleFor` unit tests), Task 7 (build + full suite + live pass) |

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Every code step has the literal code. The `pause()` test factory in Task 3 carries an explicit "adjust if the type differs" note because `BrandPlatformPause`'s exact fields weren't re-verified against `queries.ts` while writing the plan — the assertion only depends on `reason` and `paused_week_start`, which are certain.

**Type consistency:** `savePlatformPause` params object is identical in Task 1 (definition), Task 2 (`TabPausedBrandsSection` call), Task 5 (`TabScheduleSection` call). `derivePauseModalInitial(tab, brand, eligiblePlatforms, overrideMap)` arg order identical in Task 1, 2, 5. `PlatformPauseModal` prop names in Task 5 match the interface read from `src/components/PlatformPauseModal.tsx`. `onRequestPlatformPause?: () => void` identical in Task 6 both files. `weekPausesByPlatform` / `weekResumeAtByPlatform` / `weekPausedByPlatform` / `brandKey` are all already in scope at the click-routing site (verified against current lines ~1333–1334, ~1438–1440).

**Open verification carried into implementation (not blockers):**
- Task 2 step 1: grep whether `setBrandPlatformOverride` / `clearBrandPlatformOverride` / `deleteBrandPlatformPause` remain referenced elsewhere in `TabPausedBrandsSection.tsx` before removing those imports (`fetchBrandPlatformOverrides` definitely stays).
- Task 3 step 1: confirm `BrandPlatformPause`'s required fields to satisfy the test factory's type.
