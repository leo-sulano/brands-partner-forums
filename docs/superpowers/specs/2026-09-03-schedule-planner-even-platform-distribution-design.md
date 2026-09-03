# Schedule Planner — Even Platform Distribution Across the Week

## Goal

The Schedule Planner's auto-generated week clumps each platform toward the
front of the week: too many AG reviews land Mon–Wed, a disproportionate
chunk of TP lands on Friday, etc. Spread each platform's posts evenly
across Mon–Fri for a given tab (client), by randomly dividing that week's
schedulable brands — "windowing" — instead of always filling the
globally-least-loaded early days first.

## Root cause (current behaviour)

`generateWeekSchedule` (`src/lib/scheduler/schedulerEngine.ts`) keeps **one
shared `dayCounts` accumulator across every brand and platform in the tab**
and assigns each post to the least-loaded available day. Two structural
biases push everything to the front of the week:

1. **`leastLoadedDay` breaks ties by candidate order**, and candidates are
   always passed in `WEEKDAYS` order (Mon→Fri). Every tie resolves toward
   Monday.
2. **Brands are processed in list order.** Whichever brand is first always
   claims the earliest least-loaded days; asymmetry from
   paused/removed/hidden/restricted combos (common on real tabs — see the
   Rooster Partners screenshot with ~half the brands paused) compounds this
   instead of averaging out.
3. **TP pools all four of its preferred days** (`Mon,Tue,Thu,Fri` — the
   flattened `preferredDayPairs`) and picks least-loaded individually, so
   TP drifts off its intended `Mon+Thu` / `Tue+Fri` pairing and Friday
   catches the `DAY_SLACK` spillover.

## Approach

One deterministic PRNG, seeded from `` `${tab}::${weekStart}` ``, drives
three changes **inside `generateWeekSchedule` only**:

1. **Shuffle brand processing order** — seeded Fisher–Yates on the brand
   list, applied once and used for both the "resuming from pause" loop and
   the "everyone else" loop.
2. **Seeded tie-breaks** — when several available days are tied for minimum
   load, the PRNG picks one, instead of `candidates[0]`.
3. **TP pair choice per brand** — for a platform configured with
   `preferredDayPairs`, the PRNG picks **one** pair per brand as that
   brand's preferred pool, instead of flattening all pairs into one pool.
   `DAY_SLACK` spillover and holiday redistribution still apply on top,
   unchanged.

Because the seed is a pure function of `(tab, weekStart)`:

- Regenerating the same week is byte-identical — no thrash between a page
  visit and the Monday cron, no dependence on which runs first.
- Already-generated / pinned weeks are never re-run, so nothing existing
  changes (matches the project's "never rewrite history" norm — new weeks
  only).
- Each new week has a different seed, so a brand's platform days rotate
  across the week week-to-week (the "windowing / alternate" behaviour).

Pure integer math (`xmur3` hash + `mulberry32`) — identical output under
Node and under Deno, so the `generate-weekly-schedule` edge function and
the browser agree. No `crypto`, no new dependency.

## Explicitly out of scope — do NOT touch

- `recalculatePauses` and all pause detection (consecutive-removed,
  success-rate, manual/periodic overrides, resume/expiry).
- `buildCarryover` and carryover math (still disabled via
  `CARRYOVER_RULES.completionThreshold = 0`).
- Holiday `unavailableDays` computation and the weekly-count
  redistribution across remaining days.
- `DAY_SLACK` spillover structure, duplicate-day avoidance, `availableDays`
  filtering.
- Priority-loop order (resuming → everyone else) and every skip rule
  (pinned / paused / removed / hidden / restricted).
- Persisted schema (`brand_schedule`), PMS sync, CSV/Excel export,
  `calendarRenderer.tsx`, Ask AI's `get_schedule` / `tools.ts`. None of
  these recompute the engine — they read persisted rows — so they need no
  change.

## Components & files

### New — `src/lib/scheduler/seededRandom.ts`

Small, pure, dependency-free:

- `makeRng(seed: string): () => number` — `xmur3(seed)` → `mulberry32`
  generator, returns floats in `[0, 1)`.
- `shuffle<T>(arr: readonly T[], rng: () => number): T[]` — Fisher–Yates,
  returns a new array, does not mutate the input.
- `pickIndex(length: number, rng: () => number): number` — uniform index in
  `[0, length)`, for choosing among tied days / among `preferredDayPairs`.

### New — `src/lib/scheduler/seededRandom.test.ts`

- Same seed reproduces the exact draw sequence.
- Different seeds diverge within the first few draws.
- `shuffle` output is always a permutation of the input (same multiset),
  and is stable for a fixed seed.
- Rough uniformity over ~10k draws (each bucket within a tolerance band).

### Edit — `src/lib/scheduler/schedulerEngine.ts`

- `SchedulerInput` gains a required `seed: string`.
- `generateWeekSchedule`: build `const rng = makeRng(input.seed)` once;
  `const orderedBrandKeys = shuffle(brandKeys, rng)` and iterate that in
  both priority loops; thread `rng` into `assign` → `selectDays`.
- `selectDays`:
  - Replace each `leastLoadedDay(dayCounts, pool)` single-pick with
    "collect every day in `pool` tied for the minimum `dayCounts` value,
    then `pickIndex` one via `rng`". The existing
    `preferredBest` vs `overallBest` + `DAY_SLACK` comparison keeps its
    shape — each side is now an rng-pick among its own tied-min set.
  - When `rule.preferredDayPairs` is set, pick one pair via
    `pickIndex(rule.preferredDayPairs.length, rng)` and use it (filtered to
    `availableDays`) as `preferredPool`, instead of
    `[...new Set(rule.preferredDayPairs.flat())]`. `rule.preferredDays`
    (no platform currently uses it) and the no-preference all-weekdays path
    are unchanged apart from the seeded tie-break.
- `leastLoadedDay` (in `scheduleUtils.ts`) is left in place and untouched —
  it has other context but the engine stops calling it. (If a quick check
  shows the engine was its only caller, delete it in the same edit; the
  plan will confirm.)

### Edit — `src/lib/scheduler/schedulerService.ts`

- One line: `ensureWeekGenerated` passes
  `` seed: `${tab}::${weekStart}` `` into the existing
  `generateWeekSchedule({ ... })` call. Nothing else in this file changes;
  `recalculatePauses` does not touch the engine.

### Edit — `src/lib/scheduler/schedulerEngine.test.ts`

- Add `seed` to the shared `baseInput` and every inline `SchedulerInput`.
- The "assigns TP … on Monday+Thursday when the week is empty" assertion
  becomes "TP's two days are exactly one of the configured pairs
  (`{monday, thursday}` or `{tuesday, friday}`)".
- New tests:
  - same seed → identical `ScheduledSlot[]`; a different seed → a
    different AG day layout for a multi-brand week.
  - across many brands, TP days are split between both pairs rather than all
    landing on one day.
- All existing invariant tests (post counts, paused/pinned/resuming skips,
  carryover extras, holiday redistribution, no duplicate days, "balanced
  within 1") stay green. `[2,2,2,2,2]` "perfectly balanced" may loosen to
  "max − min ≤ 1" only if the seeded tie-break genuinely makes exact
  balance non-guaranteed for that case; keep it exact if it still holds.

### Check — `src/lib/scheduler/schedulerService.test.ts`

Mocks Supabase and asserts row counts / pause lifecycle, not specific
weekdays. Add `seed` threading only if a test constructs a raw
`SchedulerInput`; adjust an assertion only if one is day-specific
(none expected).

## Testing / verification

- TDD: `seededRandom.test.ts` first, then the engine test changes, then the
  implementation.
- `npm run build` (this project's real typecheck — `tsc --noEmit` is
  references-only here).
- Full vitest suite green.
- `deno check` on the `generate-weekly-schedule` edge function (it imports
  the engine transitively; the new file must use `.ts`-extension imports if
  it imports anything — it imports nothing, so this is just the existing
  chain staying clean).
- Live browser check deferred to whoever has Supabase credentials: open a
  tab whose current week is **not yet generated** (or a future week),
  confirm AG/CG/WO/TP days are visibly spread across Mon–Fri rather than
  front-loaded, and that reloading the page produces the same layout.

## Risks / notes

- **Existing weeks are untouched by design.** The evened-out distribution
  only appears on weeks generated after this ships. If the team wants to
  see it on the current week immediately, that's a separate follow-up
  (force-regenerate path was considered and declined for this change).
- **Manual edits still pin.** If an operator has already hand-edited some
  combos for an ungenerated week, only the non-pinned combos are shuffled —
  same as today.
- **Determinism depends on the seed inputs being stable.** `tab` and
  `weekStart` are already stable identifiers used throughout the scheduler;
  a hardcoded-tab rename (Task 306) changes `tab`, which would re-seed a
  not-yet-generated week — acceptable (it just picks a different valid
  layout) and cannot affect an already-generated/pinned week.
