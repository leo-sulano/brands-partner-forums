# Schedule Planner Custom Platform Support — Design

## Context

Custom Platforms (Task 325, 2026-09-07) let any approved user define a new review platform beyond
the built-in TP/AG/CG/WO and enable it on any tab. Its own design deliberately scoped custom
platforms to Overview and Brand Tabs, naming Schedule Planner and Ask AI as explicit non-goals for
later passes. Task 340 (2026-09-11) closed a third deferred gap — the "page removed, exclude from
KPIs" flag — via a parallel table and a shared save/notify engine, without touching the closed
`Platform` union (`'tp'|'ag'|'cg'|'wo'`, defined in `src/lib/removedPlatformBrands.ts`) used in 218
places across the codebase.

This spec covers the first of the two remaining gaps: **Schedule Planner integration** — a custom
platform currently never appears on the Schedule Planner calendar grid at all (no scheduling, no
auto-pause, no PMS status sync). Ask AI integration is a separate, later sub-project, not covered
here.

Unlike the removed-flag feature, a parallel-table strategy doesn't fit this gap. What Schedule
Planner offers isn't a lookup flag — it's real algorithmic behavior (weighted day-assignment,
carryover, pause-threshold detection) implemented once in `schedulerEngine.ts`/`schedulerService.ts`
and shared by every platform. Duplicating that logic for custom platforms would risk exactly the
kind of two-copies-drift-apart bug this project's CLAUDE.md has repeatedly been bitten by. This
design instead widens the scheduler's platform type to a runtime-validated string, the same way this
codebase already handles dynamic tabs (`OPERATIONAL_TABS`) — outside the scheduler, `Platform` stays
a closed 4-value union with zero changes to its 218 existing usages.

## Goals

- A custom platform enabled on a tab appears on that tab's Schedule Planner grid with real
  auto-generated scheduling, using one fixed default rule shared by every custom platform (no new
  per-platform configuration UI): confirmed with the user as **1 post/week, no preferred-day bias**
  (matching Casino Guru's existing cadence, the built-in platform with the same shape).
- Auto-pause (2 consecutive Removed/Refused, or a low rolling-30-day success rate → 1-week pause)
  works identically for a custom platform as for a built-in one.
- PMS task sync (push-on-activate, status sync, cancellation) works identically for a custom
  platform's scheduled slots.
- The weekly `generate-weekly-schedule` cron and the browser session bootstrap both become aware of
  custom platforms for scheduling purposes (today, neither is — `customPlatformRegistry.ts`'s own
  comment states this is an explicit non-goal being revisited here).
- Non-goal: Ask AI integration (separate sub-project). Non-goal: per-custom-platform scheduling
  configuration (confirmed with the user — one fixed rule for all custom platforms in v1).

## Architecture

### Data model

Nine live tables (verified via a repo-wide grep for `.from('<table>')` — a tenth candidate,
`flagged_platform_brands`, has zero live code references and is excluded as dead) currently
constrain their `platform` column to the 4 built-in codes:

| Table | Constraint column |
|---|---|
| `brand_schedule` | `platform` (nullable) |
| `brand_platform_pause` | `platform` |
| `brand_platform_override` | `platform` |
| `schedule_platform_restrictions` | `allowed_platform` |
| `schedule_pms_links` | `platform` |
| `tab_hidden_platforms` | `platform` |
| `brand_agent_assignments` | `platform` |
| `schedule_cancellations` | `platform` |
| `schedule_manual_pauses` | `platform` |

One migration drops each table's `check (... in ('tp','ag','cg','wo'))` constraint (keeping `not
null` and every other constraint intact). No new tables, no new columns, no changes to any existing
unique constraint or index — only the enumeration check goes away. A custom platform's rows in these
tables store its `custom_platforms.id` (a uuid string) in that same `platform`/`allowed_platform`
text column, sitting alongside the 4 built-in 2-letter codes. **Correction from an earlier draft of
this spec:** `platform_key` (the DB's generated lowercase-name column) is never actually exposed to
the frontend — `CustomPlatformConfig` (`src/lib/customPlatforms.ts`) only carries `id`, `tab`, `name`,
`shortLabel`, `statusColumn`, `dateColumn`, `maxScore`. Using `id` instead is also consistent with
Task 340's removed-flag feature, which already keys `removed_custom_platform_brands.platform_id` off
`custom_platforms.id` for the same reason. This mirrors how `entries.tab` is already a free-text
column with no DB-level enum enforcement — Postgres can't enumeration-check a column against another
table's live contents without a trigger, and this codebase doesn't use triggers for that purpose
anywhere else.

### Type generalization

`Platform` itself is untouched — every one of its 218 existing usages outside the scheduler (Score
Summary, the removed-flag feature, export, Ask AI's current tools, etc.) keeps full compile-time
safety with zero changes. Inside the scheduler subsystem only, a new type alias —
`SchedulablePlatform = string` — replaces `Platform` as the parameter/return type in:
- `schedulerEngine.ts` (`ScheduledSlot.platform`, `PinnedCombo.platform`, `CarryoverItem.platform`,
  `SchedulerInput.activePlatforms`)
- `schedulerRules.ts` (`PLATFORM_RULES`)
- `scheduleUtils.ts` (`PLATFORM_BADGE`, `PLATFORM_FULL_LABEL`, and every function that currently
  takes/returns `Platform`)
- `pmsSync.ts` (`PMS_PLATFORM_LABEL_NAMES` and its `Platform`-typed function signatures)
- `tab-configs.ts`'s `getTabPlatforms`/`getTabPlatformsUnfiltered` (return type becomes
  `string[]`)

The `Record<Platform, X>` lookup objects each become a same-named resolver **function** instead of a
plain object literal: check the built-in 4 first (byte-identical behavior to today, since the
function's built-in branch is exactly the old Record indexed the same way), fall back to a value
synthesized from the custom platform's registered config (`name`/`shortLabel`, via
`getTabCustomPlatforms`) plus the one fixed default rule for anything scheduling-related. Concretely:
- `PLATFORM_RULES[p]` → `getPlatformRule(p)`: built-in → existing rule object; custom → `{ postsPerWeek: 1, preferredDays: [] }` (mirroring `PLATFORM_RULES.cg`'s shape).
- `PLATFORM_BADGE`/`PLATFORM_FULL_LABEL`/`PLATFORM_FAVICON` → resolver functions returning the
  custom platform's own `shortLabel`/`name` and no favicon (matching the badge-generalization
  precedent already set in Task 340's `PlatformRemovedBadge`).
- `PMS_PLATFORM_LABEL_NAMES[p]` → same pattern, for PMS task title text.

### The chokepoint: `getTabPlatforms`

Every scheduler surface — the calendar grid, `ensureWeekGenerated`/`recalculatePauses`, PMS sync's
eligibility filter, the weekly cron — already calls `getTabPlatforms(tab)` as its one source of "what
platforms does this tab schedule." `getTabPlatforms` gains one line: after computing the built-in
4-subset (unchanged logic), append each of the tab's registered custom platforms' `id`. `tab-configs.ts`
cannot import `getTabCustomPlatforms` directly — `customPlatformRegistry.ts` already imports FROM
`tab-configs.ts` (`setCustomPlatformColumnsResolver`), so a reverse import would close a real
circular-import cycle. This codebase already has an established pattern for exactly this situation
(`setDynamicColumnsResolver`, `setCustomPlatformColumnsResolver`): `tab-configs.ts` exposes a new
`setCustomPlatformKeysResolver(fn: (tab: string) => string[])` setter with a no-op default, and
`customPlatformRegistry.ts` self-registers `getTabCustomPlatforms(tab).map(p => p.id)` against it at
module load, right next to its existing `setCustomPlatformColumnsResolver(getCustomPlatformColumns)`
call. This one change is what makes every downstream consumer "just see" custom platforms with no
further per-surface code changes — the entire rest of the scheduling algorithm, pause detection, and
PMS sync already operate generically over "whatever `getTabPlatforms` returns," never a hardcoded
4-item list.

`tab-configs.ts` also has its own separate hidden-platform registry (`hiddenTabPlatforms: Record<string, Set<'tp'|'ag'|'cg'|'wo'>>`,
backing the `tab_hidden_platforms` table) with the same closed-union typing on its `Set` and on
`registerHiddenTabPlatforms`'s parameter — this widens to `Set<string>`/`{ tab: string; platform: string }[]`
alongside `getTabPlatforms` itself, so a custom platform can be hidden per-tab the same way a built-in
one can.

### Registry bootstrap

`tabRegistryBootstrap.ts` (called once per invocation by both the browser's `AuthContext` session
bootstrap and the `generate-weekly-schedule` Edge Function) currently registers five sets — dynamic
tabs, hidden tab-platforms, archived tabs, paused tabs, hardcoded tab renames — but explicitly not
custom platforms (confirmed via `customPlatformRegistry.ts`'s own comment). It gains a sixth:
`resetTabCustomPlatforms()` + `registerTabCustomPlatforms(customPlatforms)`, the same functions the
browser bootstrap already calls today (just not from this shared bootstrap point) — closing the exact
gap the exploration found, where the weekly cron currently has no idea custom platforms exist at all.

### PMS sync

`pmsSync.ts`'s `resolveAndSyncTabStatuses` already operates per (brand, platform, date) via
`schedule_pms_links` rows and `getTabPlatforms`-derived eligibility — once that function returns
custom platform keys too, PMS sync needs no further logic changes. A custom platform's scheduled slot
gets its own `schedule_pms_links` row and a PMS task exactly like a built-in platform's slot does,
with `PMS_PLATFORM_LABEL_NAMES`'s resolver function supplying the task title text.

### UI surfaces

`SchedulePlanner.tsx`, `TabScheduleSection.tsx`, and `calendarRenderer.tsx` render whatever
`getTabPlatforms(tab)` returns — they don't hardcode a 4-item list either (confirmed during
exploration: `platformFilter?: Platform[]` params narrow an already-computed active-platform list,
they don't enumerate it). These need type-signature updates (`Platform[]` → `string[]` /
`SchedulablePlatform[]` in prop/state types) but no new rendering logic — a custom platform's chip
renders through the same `ScheduleCell`/`PlatformChip` components, using the generalized
`PLATFORM_BADGE`/`PLATFORM_FULL_LABEL` resolvers instead of direct Record indexing.

## Non-goals / explicitly deferred

- Per-custom-platform scheduling configuration (frequency, preferred days) — confirmed out of scope;
  revisit only if the fixed default proves insufficient in real use.
- Ask AI integration — separate sub-project.
- Score Summary integration — separate sub-project, not currently planned.
- Renaming a custom platform — already a Task 325 non-goal; `custom_platforms.id` is a stable primary
  key regardless, so this doesn't add any new constraint beyond what already exists.
- The Schedule Planner grid's Confirmed/Removed real-entry-evidence overlay (`scheduleUtils.ts`'s
  `buildDateStatusIndex` and its sibling, feeding the small ✓/✕ badges on a day cell) stays built-in
  platforms only for this pass — both iterate a hardcoded `ALL_PLATFORMS` (derived from
  `PLATFORM_STATUS_KEYS`'s own keys) rather than a caller-supplied platform list, and widening that
  would need each to accept a platform list and thread `getPlatformStatusDateKeys` (below) through a
  different code shape than a simple resolver swap. A custom platform's day cell still shows its
  scheduled/paused chip correctly, just without the real-entry-evidence overlay on top.

## Correction found during plan-writing

`schedulerService.ts`'s `recentStatusesFor` — the function auto-pause detection depends on — reads
an entry's status/date via `PLATFORM_STATUS_KEYS[platform]`/`PLATFORM_DATE_KEYS[platform]`
(`scoreSummary.ts`, both `Record<Platform, string[]>`), which returns `undefined` for a custom
platform's uuid. This is a real bug this spec's original architecture section didn't call out
explicitly (it's a consequence of the same closed-union pattern the rest of the spec addresses, just
in a file the initial exploration didn't read in full). Fixed via one more resolver function,
`getPlatformStatusDateKeys(platform): { statusKeys: string[]; dateKeys: string[] }` in
`scheduleUtils.ts`, following the exact same built-in-first/custom-fallback shape as
`getPlatformRule`/`getPlatformBadge`/`getPlatformFullLabel`/`getPmsPlatformLabel` above — a custom
platform's fallback reads its own registered `statusColumn`/`dateColumn` instead of a `scoreSummary.ts`
lookup.

## Testing

- Migration: 9 `alter table ... drop constraint ...` statements, one file, each verified against the
  exact constraint name from its origin migration.
- `getTabPlatforms`/`getTabPlatformsUnfiltered`: extend existing test coverage with a
  custom-platform-registered case per tab, confirming the built-in-only case is byte-identical to
  today (regression proof).
- Each generalized resolver function (`getPlatformRule`, `PLATFORM_BADGE`/`PLATFORM_FULL_LABEL`
  replacements, PMS label resolver): a built-in-platform case (must match the old Record's value
  exactly) and a custom-platform case.
- `schedulerEngine.ts`/`schedulerService.ts`: extend existing test suites with a custom platform in
  the active-platform set, confirming day-assignment, carryover, and pause detection all operate on
  it the same way as a built-in platform with an equivalent rule (i.e., compare against CG's existing
  1/week test cases where useful).
- `pmsSync.ts`: extend existing push/pull/status-sync tests with a custom-platform slot.
- `tabRegistryBootstrap.ts`: extend its existing test to confirm `getTabPlatforms` reflects a
  registered custom platform after bootstrap, and is correctly reset between invocations (mirroring
  the existing dynamic-tab reset test).

## Deployment

- `supabase db push` (the constraint-drop migration).
- `git push origin main` (frontend + shared scheduler module changes).
- `supabase functions deploy generate-weekly-schedule` (picks up the new bootstrap registration).
- `supabase functions deploy sync-schedule-pms` (picks up the widened `SchedulablePlatform` type
  through its shared `pmsSync.ts` import — deploy needed even though its own logic doesn't change,
  since the bundled module's types/behavior now cover a wider platform set).
