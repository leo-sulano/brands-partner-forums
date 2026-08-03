# Success-Rate Pause Trigger

## Background

The Intelligent Schedule Planner already auto-pauses a brand+platform combo
for 1 week when its two most recent posts are both Removed/Refused
(`recalculatePauses` in `src/lib/scheduler/schedulerService.ts`, rule constants
in `src/lib/scheduler/schedulerRules.ts`'s `PAUSE_RULES`). This adds a second,
independent trigger: a combo also pauses when its all-time success rate drops
below 40%, so the schedule reacts to sustained poor performance, not just two
posts in a row.

The (separate, currently-disabled) carryover completion-threshold mechanism is
unrelated — carryover adds extra slots for catch-up, it does not pause
anything, and stays disabled as-is (see the comment block in
`schedulerRules.ts`). This spec does not touch carryover.

## Rule

New constants in `PAUSE_RULES` (`schedulerRules.ts`):

```ts
export const PAUSE_RULES = {
  consecutiveRemovedThreshold: 2,
  pauseDurationWeeks: 1,
  successRateThreshold: 40,        // percent; strictly below this pauses
  minDecidedPostsForRateCheck: 5,  // live+removed posts needed before this check applies
};
```

A brand+platform combo pauses when **either**:
1. Its 2 most recent posts are both Removed/Refused (existing rule, unchanged), **or**
2. It has at least 5 all-time decided posts (`live + removed >= 5`) on that
   platform, and its all-time success rate (`live / (live + removed) × 100`)
   is strictly below 40%.

The minimum-posts gate prevents a brand-new combo from pausing off a single
early removal (1 removed / 1 decided = 0%, which is below 40% but not a
meaningful sample).

Both conditions are evaluated only for combos that aren't already paused
(matching today's behavior — `recalculatePauses` already skips the check
entirely when an active pause row exists). If both conditions are true for the
same combo in the same run, the consecutive-removed reason takes priority
(checked first) — a combo can only hold one pause row at a time.

## Where it's computed

`recalculatePauses(tab, weekStart, ctx)` already loops every
(`ctx.brands` × `ctx.activePlatforms`) combo once per week-generation call.
The success-rate check is added inside that same loop, using data already
available on `ctx.entries` — no new fetch.

Success rate itself is computed via the existing `computeSuccessRates` from
`src/lib/scoreSummary.ts` (the same all-time `live ÷ (live + removed)` formula
Score Summary and the brand tab KPI cards use) — called **once per active
platform**, before the brand loop, not once per brand, since it scans all of
`ctx.entries`:

```ts
const ratesByPlatform = new Map(
  ctx.activePlatforms.map((p) => [p, computeSuccessRates(ctx.entries, p)]),
);
```

Inside the loop, for a given `brand`/`platform`:

```ts
const sr = ratesByPlatform.get(platform)?.get(`${tab} ${brand.trim()}`);
const decided = (sr?.live ?? 0) + (sr?.removed ?? 0);
const lowSuccessRate =
  sr != null &&
  decided >= PAUSE_RULES.minDecidedPostsForRateCheck &&
  sr.rate != null &&
  sr.rate < PAUSE_RULES.successRateThreshold;
```

## Pause reason text

Stored in `brand_platform_pause.reason` (already a free-text column, already
surfaced via `PausedPlatformIndicator`'s hover tooltip in the Schedule Planner
grid). New reason string, percentage floored to match the app's existing
display convention (`successRatePct` in `scoreSummary.ts`):

```
Success rate below 40% (23% over 8 posts)
```

The existing consecutive-removed reason text
(`'Two consecutive Removed/Refused posts'`) is unchanged.

## Resume

Unchanged. Both trigger types write to the same `brand_platform_pause` table
with the same `pauseDurationWeeks: 1` semantics — `recalculatePauses`'s
existing resume path (`paused_week_start < weekStart` → delete → returned as
`resumingBrandPlatforms`) doesn't need to know which rule caused a pause. A
combo that resumes but is still genuinely underperforming (still <40%, no new
posts changed that) will simply be re-flagged and re-paused on the next
`recalculatePauses` run — the same self-correcting cadence the
consecutive-removed rule already has today.

## Out of scope

- No change to carryover (`CARRYOVER_RULES`), which stays disabled.
- No change to the manual "Add Platform" flow, `ScheduleCell`, or any UI
  beyond the pause reason text already surfaced by `PausedPlatformIndicator`.
- No change to `computeSuccessRates` itself or its date-range/removed-brand
  exclusion behavior — used exactly as already exported.
- No per-platform threshold customization (40% and the 5-post minimum apply
  uniformly across TP/AG/CG/WO) — not requested, and `PLATFORM_RULES`'
  existing per-platform shape doesn't currently carry pause-related fields.
