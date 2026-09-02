# Brand+Platform Pause: Reason, Duration, and a Discoverable Summary

## Problem

The user reported that Spinjo and other Rooster Partners brands (e.g. Novodream) were
"previously decided" to be paused, but showed up active again in the Schedule Planner for the
week of 2026-08-31. There is no record of this decision in `docs/task-history.md`, which is
consistent with the root cause: this app already has three independent pause mechanisms, and only
one of them is actually durable.

1. **Auto-pause** (`brand_platform_pause`) — system-detected (2 consecutive Removed/Refused posts,
   or success rate below 40% over a rolling 30 days). Auto-resumes after 1 week.
2. **Manual per-day pause** (Schedule Planner's Pause/Resume buttons → `PauseDaysModal`) — pauses
   specific weekdays, but only within the *currently-displayed week*. The next week generates fresh
   and is active by default. This is almost certainly what was used for Spinjo/Novodream, and why it
   silently reset.
3. **Manual persistent override** (`brand_platform_override`, "Force Paused"/"Force Active") — the
   only mechanism that persists indefinitely until someone clears it. It has no reason field and is
   only reachable via an unlabeled per-platform dropdown buried in the Edit Entry modal — never
   visible or settable from the Schedule Planner itself.

This is exactly the gap `brand_platform_override`'s own migration comment already named the day
before this spec was written (2026-09-01, `20260901150000_add_schedule_brand_pauses.sql`, later
reverted for being a misread of an unrelated request):

> `brand_platform_override` (manual, per-platform, no reason/dates)

This spec closes that gap: `brand_platform_override` gains a reason and an optional auto-resume
date, and gets a proper Schedule Planner UI (a "Pause Brand" action, and a discoverable "Paused
Brands" summary) instead of only the Edit Entry modal's raw dropdown.

## Explicitly out of scope / not touched

- **`paused_tabs`** (whole-**tab** pause, `docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md`)
  is a different, unrelated concept (pausing an entire Brand Tab, not one brand+platform combo). It
  already has its own `reason`/`paused_until` pair (added 2026-09-01,
  `20260901170000_add_paused_tabs_reason_and_until.sql`) whose `paused_until` is explicitly
  **purely informational and does not auto-clear** ("a quick, reversible toggle, not an audited
  event"). This spec's `resume_at` on `brand_platform_override` behaves *differently* — it genuinely
  auto-resumes — because the user explicitly asked for that here. The two `until`-shaped columns on
  two different tables are intentionally inconsistent with each other; this note exists so a future
  reader doesn't assume they should match.
- `brand_platform_pause` (auto-detection), `schedule_hidden_brands`, `schedule_platform_restrictions`,
  and the per-day `PauseDaysModal` flow are unchanged.
- The Edit Entry modal's existing "Force Paused/Force Active" dropdown keeps working exactly as
  today (immediate, no reason, no duration) — a deliberate choice, confirmed with the user, so there
  stays a fast raw toggle alongside the new richer flow. It is not touched by this task.

## Data model

**Migration** `supabase/migrations/20260902130000_add_brand_platform_override_reason_and_resume_at.sql`:

```sql
alter table public.brand_platform_override
  add column reason text,
  add column resume_at date;
```

Both nullable. `reason` is null only for the pre-existing Edit Entry "Force Paused" path (no UI for
one there) and for every `'active'` override (an active override needing a reason was never asked
for). `resume_at` is null for a permanent pause; set for a periodic one. No RLS change — the table's
existing 4 policies already cover insert/update/delete by any approved user.

## `reason`/`resume_at` resolution — where it plugs in

`recalculatePauses` (`src/lib/scheduler/schedulerService.ts`) is the single place that already
turns a `brand_platform_override` row into a real `brand_platform_pause` row — both the page-visit
trigger (`TabScheduleSection.tsx`) and the Monday cron (`generate-weekly-schedule`) call it. Two
changes there:

1. **Custom reason threading.** The `override === 'pause'` branch currently always upserts the
   hardcoded string `PERSISTENT_PAUSE_REASONS.manual` ("Manually paused"). It now upserts
   `override.reason?.trim() || PERSISTENT_PAUSE_REASONS.manual` — the user's typed reason when
   present, the existing generic string as a fallback (covers the Edit Entry path, which never
   collects a reason).
2. **Periodic auto-resume.** Before the existing `override === 'active'` / `override === 'pause'`
   branches, a new check: if `override.state === 'pause'` and `override.resumeAt` is set and has
   passed relative to the week being evaluated, treat the override as expired — delete the
   `brand_platform_override` row (`clearBrandPlatformOverride`), delete any existing
   `brand_platform_pause` row for the combo (`deleteBrandPlatformPause`, matching the existing
   `override === 'active'` branch's own resume handling), push `{ brandKey, platform }` onto the
   `resumed` list, and `continue` — no auto-detection re-evaluation in the same pass, matching how
   every other resume path in this function already behaves.

   **"Has passed" is week-granular**, matching every other pause-lifecycle check in this file
   (`existing.paused_week_start < weekStart` for auto-detected resume is exactly as coarse). Compare
   `resumeAt <= weekStart + 6 days` (the Sunday ending the week being evaluated) — i.e. a resume
   date anywhere within the current week already counts as "passed," so a pause set to end
   mid-week resumes as soon as that same week is next evaluated (a tab visit, or the Monday cron),
   not one week later. There is no cron dedicated to this — resumption is evaluated lazily, exactly
   like every existing pause type's "cleanup only happens when someone opens that tab" limitation
   already documented for `get_paused_combos`. Not a new gap; same accepted model.

No change to the `override === 'active'` branch or the auto-detection chain below it.

## Consolidating the override lookup

`scheduleOverrides.ts` currently exposes two parallel maps — `buildOverrideMap` (state only) and
`buildOverrideSetByMap` (who set it) — read via two independent lookups
(`TabScheduleSection.tsx`'s `pausedByFor`). Adding `reason`/`resumeAt` as a third parallel map would
make three lookups that can silently drift. Instead, `buildOverrideMap` is widened to return one
map of a richer shape and `buildOverrideSetByMap` is removed:

```ts
export interface OverrideDetails {
  state: OverrideState;      // 'pause' | 'active'
  reason: string | null;
  resumeAt: string | null;   // ISO date, only meaningful when state === 'pause'
  setBy: string | null;
}

export function buildOverrideMap(
  rows: { tab: string; brand_key: string; platform: Platform; override_state: OverrideState;
           reason: string | null; resume_at: string | null; set_by: string | null }[],
): Map<string, OverrideDetails>
```

Every current consumer of `Map<string, OverrideState>` (`schedulerService.ts`'s `TabContext.overrideMap`
and its one read site, `TabScheduleSection.tsx`'s `tabCtx.overrideMap`,
`generate-weekly-schedule/index.ts`'s context build) updates mechanically: `overrideMap.get(key)`
now returns `OverrideDetails | undefined`, so `=== 'active'`/`=== 'pause'` checks become
`?.state === 'active'`/`?.state === 'pause'`. `tabCtx.overrideSetByMap` is deleted; its one caller
(`pausedByFor`) reads `.setBy` off the same `overrideMap` entry instead.

## Fixing a real, newly-exposed bug: the "is this override-driven" checks were string-matching

Two places in the existing code decide "is this pause forced by a manual override, or auto-detected"
by comparing `pause.reason === PERSISTENT_PAUSE_REASONS.manual` (the literal string "Manually
paused") — `TabScheduleSection.tsx`'s `computeCellData` (gates whether to show "Paused by") and
`calendarRenderer.tsx`'s `titleFor` (decides "Resumes week of X" vs. "Stays paused until manually
cleared"). Once overrides carry a **custom** reason, that string comparison silently breaks — every
custom-reason pause would misreport as auto-detected. Both call sites are fixed as part of this
task, since shipping custom reasons without fixing them would introduce a live regression, not just
leave a pre-existing gap:

- `computeCellData` gates on `tabCtx.overrideMap.get(overrideKey(tab, brandKey, platform))?.state === 'pause'`
  directly, and additionally derives a parallel `resumeAtByPlatform: Partial<Record<Platform, string | null>>`
  from the same lookup (`undefined` = not override-driven at all; `null` = override-driven,
  permanent; a date string = override-driven, periodic).
- `ScheduleStatusIconProps` gains a top-level optional `pauseResumeAt?: string | null` (same 3-state
  meaning as above), threaded from `TabScheduleSection.tsx`'s new `resumeAtByPlatform` alongside the
  existing `pausedBy`. `titleFor` branches on `props.pauseResumeAt !== undefined` instead of the
  reason-string comparison: `undefined` → today's existing auto-detected wording unchanged; `null` →
  "Stays paused until manually cleared" (unchanged wording, now correctly triggered); a date → new
  wording, "Reason: `<reason>`\nResumes `<formatted date>`".
- The day-cell chip tooltip (`PlatformChip`, fed by `pausesByPlatform[platform]?.reason` /
  `pausedByPlatform`) needs no wording change — it already just prints the reason text verbatim and
  the "Paused by" line, both of which now correctly reflect the custom text. Only its `pausedBy`
  gating (already fixed above, since it flows from the same `computeCellData`) was affected.

## New UI: "Pause Brand" action (Schedule Planner)

A new small button in each brand row of `TabScheduleSection.tsx`'s per-tab calendar, immediately
after the existing `RemovedPlatformIcon` badges (same spot conceptually, same row). Opens a new
`src/components/PlatformPauseModal.tsx`:

- One checkbox per platform active for that brand (`brandPlatforms(brand)`), pre-checked if that
  platform currently has a `'pause'` override, unchecked otherwise. A platform that's currently
  auto-paused (no override) shows an inline note ("currently auto-paused: `<reason>`") next to its
  checkbox for visibility, but checking it creates a real override on top, exactly as
  `recalculatePauses` already prioritizes override over auto-detection.
- Permanent (default) / Until a date — a date input, minimum tomorrow, shown only when "Until a
  date" is selected.
- A reason textarea, **required whenever at least one platform is newly checked** in this save
  (client-side validation — matches the whole point of the feature; a pause with no reason is
  exactly the silent-decision problem being fixed). Not required if the save only unchecks
  previously-paused platforms (pure resume — nothing new to explain).
- Save: for each platform whose checked state changed —
  - now checked: `setBrandPlatformOverride(tab, brand, platform, 'pause', { reason, resumeAt })`.
  - now unchecked (was override-paused): `clearBrandPlatformOverride(tab, brandKey, platform)` then
    `deleteBrandPlatformPause(tab, brandKey, platform)` (best-effort — resuming should take effect
    immediately, not wait for the override's own lazy re-evaluation next tab visit; see below for
    why that matters).
  - Then call a new `refreshPauseState()` helper in `TabScheduleSection.tsx` (re-runs
    `recalculatePauses(tab, weekStartISO, tabCtx)`, then refetches `pauses` and the override rows) so
    the grid reflects the change without a full reload. This is necessary for the *newly-paused*
    platforms too — `recalculatePauses` is what actually writes the `brand_platform_pause` row
    carrying the real reason; setting the override alone doesn't touch that table.
  - `setBrandPlatformOverride`'s signature gains an optional third options arg (`{ reason?: string | null; resumeAt?: string | null }`, defaulting both to `null`) — the existing Edit Entry call site
    (`BrandGroup.tsx`) is unaffected, since it never passes it.

## New UI: "Paused Brands" summary panel (Schedule Planner)

A new toolbar button next to the existing "Public Holidays" button, opening a new
`src/components/PausedBrandsModal.tsx`. Lists every brand+platform currently paused for the tab —
sourced from the already-fetched `pauses` (`brand_platform_pause` rows, which cover *both*
auto-detected and override-driven pauses, since the latter are always materialized into this same
table) joined against `tabCtx.overrideMap` for the override-only detail:

| Column | Source |
|---|---|
| Brand | `pause.brand` |
| Platform | `pause.platform` |
| Reason | `pause.reason` (now the real custom text for an override-driven pause) |
| Since | `pause.paused_week_start` |
| Until | override's `resumeAt` if override-driven and periodic; "—" if permanent or auto-detected (auto-detected already shows its own ~1-week expectation via the existing tooltip, not duplicated here) |
| Set by | override's `setBy`, blank for an auto-detected pause |
| *(action)* | "Resume Now" — same clear-override + delete-pause-row + `refreshPauseState()` sequence as unchecking a platform in `PlatformPauseModal` above; for an auto-detected pause with no override, "Resume Now" instead directly deletes the `brand_platform_pause` row only (there's no override to clear) |

This is the piece that directly answers the reported problem: a **permanent** pause never expires
and never silently reverts, so this list is where Spinjo would show up indefinitely instead of
vanishing after a week with nothing to notice it by.

## Everywhere else — verified, not changed

- **Ask AI** (`supabase/functions/ai-assistant/tools.ts`'s `get_paused_combos`) reads
  `brand_platform_pause.reason` directly — it will surface the real custom text automatically, no
  tool/schema change needed. Verified by reading the tool's implementation.
- **PMS status sync** (`resolvePmsSyncStatus`, `pmsSync.ts`) resolves purely from whether a pause row
  currently exists, never its reason or duration — unaffected.
- **`generate-weekly-schedule`** needs the mechanical `OverrideDetails` shape update (see above) to
  keep compiling, but its own behavior (weekly re-evaluation, including the new periodic-expiry
  check) is exactly `recalculatePauses`'s behavior — no separate logic to duplicate or drift.

## Testing

- `scheduleOverrides.test.ts`: `buildOverrideMap`'s new shape (state/reason/resumeAt/setBy all
  round-trip correctly; `buildOverrideSetByMap` deleted).
- `schedulerService.test.ts`: custom reason is threaded into the upserted pause row instead of the
  generic fallback; a permanent override (`resumeAt: null`) never auto-expires across multiple
  simulated weeks; a periodic override auto-expires and reports `resumed` once `resumeAt` falls on
  or before the evaluated week's Sunday, and not before.
- `queries.test.ts`: `setBrandPlatformOverride` persists `reason`/`resume_at` when passed, and both
  default to `null` when the options arg is omitted (covers the existing Edit Entry call site
  staying correct).
- Live verification (Playwright, this session has real credentials): on Rooster Partners, use the
  new Pause Brand action on Spinjo for one platform with a reason and an until-date a few days out,
  confirm it shows dimmed/paused on the grid and appears in the Paused Brands panel with the right
  reason/until; confirm Resume Now clears it immediately; confirm a **permanent** pause (no
  until-date) still shows in the panel after simulating next week's view (or at minimum, confirm its
  row has no until-date and doesn't disappear on its own). Revert all test changes afterward.

## Known, deliberately accepted limitations

- Auto-resume evaluation is lazy (tab visit or the Monday cron), same as every other pause type in
  this app — a permanent pause that's cleared by "Resume Now" resumes immediately (direct delete),
  but a periodic pause's expiry is only actually noticed the next time `recalculatePauses` runs for
  that tab, and is week-granular, not day-granular (see above).
- The Edit Entry modal's raw "Force Paused" dropdown still cannot set a reason or a duration, by
  explicit user choice — it stays a fast, unreasoned toggle alongside the new richer flow.
