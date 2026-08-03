# Success-Rate Pause Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, independent auto-pause trigger to the Schedule Planner scheduler — a brand+platform combo pauses when its all-time success rate drops below 40% (with at least 5 decided posts), alongside the existing "2 consecutive Removed/Refused" trigger.

**Architecture:** `recalculatePauses` in `src/lib/scheduler/schedulerService.ts` already loops every (brand × active platform) combo once per week to evaluate the consecutive-removed rule and read/write `brand_platform_pause`. Add the success-rate check inside that same loop, reusing the existing `computeSuccessRates` helper from `src/lib/scoreSummary.ts` (already used by Score Summary and the brand tab KPI cards for the identical all-time `live ÷ (live+removed)` formula) and the existing pause/resume table and timing — no new tables, no new fetch calls, no new UI.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- Success-rate threshold: strictly below 40% pauses; exactly 40% does not.
- Minimum sample size: the success-rate check only applies once a combo has at least 5 all-time decided (live + removed) posts on that platform.
- The existing consecutive-removed rule is unchanged and takes priority — if both conditions are true for the same combo in the same run, only the consecutive-removed pause row/reason is written.
- Resume timing is unchanged for both trigger types: 1 week (`PAUSE_RULES.pauseDurationWeeks`), via the existing time-based delete-and-report-resumed logic.
- Reference spec: `docs/superpowers/specs/2026-08-03-success-rate-pause-trigger-design.md`.

---

### Task 1: Add success-rate pause trigger to `recalculatePauses`

**Files:**
- Modify: `src/lib/scheduler/schedulerRules.ts` (add two constants to `PAUSE_RULES`)
- Modify: `src/lib/scheduler/schedulerService.ts:1-94` (imports + `recalculatePauses` body)
- Test: `src/lib/scheduler/schedulerService.test.ts` (new `describe` block for the success-rate trigger, inside the existing `describe('recalculatePauses', ...)`)

**Interfaces:**
- Consumes: `computeSuccessRates(entries: Entry[], platform: Platform, removedPlatformBrands?: Set<string>, range?: DateRange): Map<string, SuccessRate>` and `successRatePct(rate: number | null): number | null`, both already exported from `src/lib/scoreSummary.ts`. `SuccessRate` is `{ live: number; removed: number; rate: number | null }`. Map keys are `` `${tab} ${brand.trim()}` `` (confirmed by existing usage in `SchedulePlanner.tsx`).
- Produces: no new exports — `recalculatePauses`'s existing signature (`(tab: string, weekStart: string, ctx: TabContext) => Promise<PinnedCombo[]>`) and behavior contract (writes pause rows via `upsertBrandPlatformPause`, returns resumed combos) are unchanged; this task only adds a second condition that can trigger the same write path.

- [ ] **Step 1: Write the failing tests**

Add this block inside the existing `describe('recalculatePauses', ...)` in `src/lib/scheduler/schedulerService.test.ts`, right after the existing `it('does not insert a pause for a week that is already generated', ...)` test (i.e. as the last items in that `describe`, before its closing `});`):

```ts
  describe('success-rate trigger', () => {
    it('pauses a brand+platform whose all-time success rate is below 40% with at least 5 decided posts', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // Most recent post is Published, so the consecutive-removed check
          // (top 2 by date) never fires here — isolates the success-rate path.
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-24' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-20' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-15' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Success rate below 40% (20% over 5 posts)',
      );
    });

    it('does not pause on a low success rate with fewer than 5 decided posts', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-24' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('does not pause at exactly 40% (boundary is strictly-below)', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-08-01' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-07-24' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-20' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-15' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).not.toHaveBeenCalled();
    });

    it('prefers the consecutive-removed reason when both triggers are true at once', async () => {
      const ctx: TabContext = {
        brands: ['WinMega'],
        activePlatforms: ['tp'],
        entries: [
          // Top 2 most recent are both Removed (fires consecutive-removed)
          // AND overall rate is 1/5 = 20% with 5 decided posts (would also
          // fire success-rate) -- only one pause row/reason should result.
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-08-01' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-24' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-20' }),
          entry({ Brands: 'WinMega', 'TP Review Status': 'published', 'Trust Pilot': '2026-07-15' }),
        ],
      };
      await recalculatePauses('BITP', '2026-08-03', ctx);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
      expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith(
        'BITP', 'WinMega', 'tp', '2026-08-03', 'Two consecutive Removed/Refused posts',
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: the 4 new tests FAIL (the first, third and fourth expect `upsertBrandPlatformPause` to have been called with specific args but it won't have been called at all for the success-rate-only cases; the fourth currently passes trivially today since the consecutive-removed path already exists — re-check after Step 4 that it still passes for the right reason). The second test (fewer than 5 posts) may already pass today since nothing currently pauses on rate at all — that's fine, it still documents the intended boundary and must keep passing after Step 4.

- [ ] **Step 3: Add the new `PAUSE_RULES` constants**

In `src/lib/scheduler/schedulerRules.ts`, replace:

```ts
export const PAUSE_RULES = {
  consecutiveRemovedThreshold: 2,
  pauseDurationWeeks: 1,
};
```

with:

```ts
export const PAUSE_RULES = {
  consecutiveRemovedThreshold: 2,
  pauseDurationWeeks: 1,
  // A brand+platform combo also pauses when its all-time success rate
  // (see computeSuccessRates in scoreSummary.ts) is strictly below this
  // percentage, once it has at least minDecidedPostsForRateCheck decided
  // (live+removed) posts on that platform. Independent of, and lower-
  // priority than, the consecutiveRemovedThreshold rule above — see
  // recalculatePauses in schedulerService.ts.
  successRateThreshold: 40,
  minDecidedPostsForRateCheck: 5,
};
```

- [ ] **Step 4: Implement the success-rate check in `recalculatePauses`**

In `src/lib/scheduler/schedulerService.ts`, update the imports at the top of the file. Change:

```ts
import { PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, parsePostDate } from '../scoreSummary';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands';
import { WEEKDAYS, toISODate, type BrandScheduleUpsertRow } from '../scheduleBrands';
import { BRAND_COLS } from '../tab-configs';
import { generateWeekSchedule, type PinnedCombo, type CarryoverItem, type ScheduledSlot } from './schedulerEngine';
import { weeklyCompletion, completedBrandPlatformKey } from './scheduleUtils';
import { CARRYOVER_RULES } from './schedulerRules';
```

to:

```ts
import {
  PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, parsePostDate,
  computeSuccessRates, successRatePct,
} from '../scoreSummary';
import { normalizeBrandKey, type Platform } from '../removedPlatformBrands';
import { WEEKDAYS, toISODate, type BrandScheduleUpsertRow } from '../scheduleBrands';
import { BRAND_COLS } from '../tab-configs';
import { generateWeekSchedule, type PinnedCombo, type CarryoverItem, type ScheduledSlot } from './schedulerEngine';
import { weeklyCompletion, completedBrandPlatformKey } from './scheduleUtils';
import { CARRYOVER_RULES, PAUSE_RULES } from './schedulerRules';
```

Then replace the body of `recalculatePauses` (everything between its opening `{` and closing `}`, i.e. the current lines from `const [pauses, existingRows] = ...` through `return resumed;`) with:

```ts
  const [pauses, existingRows] = await Promise.all([
    fetchActiveBrandPlatformPauses(tab),
    fetchBrandSchedule(tab, weekStart),
  ]);
  const weekAlreadyGenerated = existingRows.some((r) => r.platform != null);
  const resumed: PinnedCombo[] = [];

  // Computed once per active platform (not per brand) since each call scans
  // all of ctx.entries — reused by the success-rate pause check below.
  const ratesByPlatform = new Map(
    ctx.activePlatforms.map((platform) => [platform, computeSuccessRates(ctx.entries, platform)]),
  );

  for (const brand of ctx.brands) {
    const brandKey = normalizeBrandKey(brand);
    for (const platform of ctx.activePlatforms) {
      const existing = pauses.find((p) => p.brand_key === brandKey && p.platform === platform);
      if (existing) {
        if (existing.paused_week_start < weekStart) {
          await deleteBrandPlatformPause(tab, brandKey, platform);
          resumed.push({ brandKey, platform });
        }
        continue;
      }
      if (weekAlreadyGenerated) continue;

      const recent = recentStatusesFor(ctx.entries, brandKey, platform).slice(0, 2);
      const bothRemoved = recent.length === 2 && recent.every(isRemovedStatus);
      if (bothRemoved) {
        await upsertBrandPlatformPause(tab, brand, platform, weekStart, 'Two consecutive Removed/Refused posts');
        continue;
      }

      // Second, independent trigger: sustained poor performance rather than
      // just the last two posts. Lower priority than the check above — a
      // combo can only hold one pause row, and consecutive-removed is
      // checked first.
      const sr = ratesByPlatform.get(platform)?.get(`${tab} ${brand.trim()}`);
      const decided = (sr?.live ?? 0) + (sr?.removed ?? 0);
      const lowSuccessRate =
        sr != null &&
        decided >= PAUSE_RULES.minDecidedPostsForRateCheck &&
        sr.rate != null &&
        sr.rate < PAUSE_RULES.successRateThreshold;
      if (lowSuccessRate) {
        const pct = successRatePct(sr!.rate);
        await upsertBrandPlatformPause(
          tab, brand, platform, weekStart,
          `Success rate below ${PAUSE_RULES.successRateThreshold}% (${pct}% over ${decided} posts)`,
        );
      }
    }
  }

  return resumed;
```

- [ ] **Step 5: Run the scheduler test file and verify all tests pass**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: PASS — all 4 new tests plus all pre-existing tests in this file (the pre-existing tests use brands with fewer than 5 decided posts, so the new check never fires for them; verify this holds rather than assuming it).

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (256 tests: 255 pre-existing + your new tests, minus none removed — count from Step 5's output plus the rest of the suite; the key check is 0 failures).

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors (this codebase's `tsc --noEmit` doesn't check anything meaningful here — `npm run build` is the real check, per project convention).

- [ ] **Step 8: Commit**

```bash
git add src/lib/scheduler/schedulerRules.ts src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
git commit -m "$(cat <<'EOF'
feat: pause a brand+platform when its success rate drops below 40%

Second, independent auto-pause trigger alongside the existing
2-consecutive-removed rule -- fires once a combo has at least 5
all-time decided posts and its live/(live+removed) rate is strictly
below 40%. Reuses the existing pause/resume table and 1-week timing;
consecutive-removed still takes priority when both are true.
EOF
)"
```

## Self-Review Notes

- **Spec coverage:** all-time rate (via `computeSuccessRates` with no `range` arg → defaults to all-time) ✓, min 5 decided posts ✓, additional (not replacing) trigger ✓, consecutive-removed priority on conflict ✓, unchanged 1-week resume (no code touches the resume branch) ✓, floored percentage in reason text (`successRatePct`) ✓, strict `<` boundary at exactly 40% ✓.
- **Boundary math double-checked:** Task 1 test 1 — 1 live / 4 removed = 5 decided, rate 20.0, `successRatePct(20.0)` floors to `20` → message `"Success rate below 40% (20% over 5 posts)"`. Test 3 (boundary) — 2 live / 3 removed = 5 decided, rate exactly `40.0`; `40 < 40` is `false`, so `lowSuccessRate` is `false` and no pause is expected — confirmed against the `<` (not `<=`) comparison in Step 4's code.
- **Out of scope confirmed untouched:** no edits to `CARRYOVER_RULES`, `ensureWeekGenerated`, `generateWeekSchedule`, `ScheduleCell`, `PausedPlatformIndicator`, or `computeSuccessRates` itself.
