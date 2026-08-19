# Brand → Agent Responsibility Mapping

**Date:** 2026-08-19
**Status:** Approved, ready for planning

## Problem

Schedule Planner's Agent→Assignee PMS sync (Task 231/236) resolves the Agent
for a brand via `buildAgentIndex` (`src/lib/scheduler/scheduleUtils.ts`),
which picks the most-recently-updated entry's `Agent` field per brand. Two
real gaps exist:

1. **Five of 11 operational tabs have no `Agent` column in their entries at
   all** — `TAB_COLUMN_CONFIGS` (`src/lib/tab-configs.ts`) never lists
   `'Agent'` for Revolution Casino, Trybet, SilverPlay, Hanan, or HazEmirates
   UAE, because the Google Sheets those tabs originally synced from never had
   one. `buildAgentIndex` returns nothing for any brand on these tabs, so the
   PMS push has been silently creating unassigned tasks for all of them —
   consistent with the "34 brands with no Agent on file" note from the Task
   236 backfill.
2. **Even where an `Agent` column exists** (Rooster Partners, SuprPlay
   Limited, Wizard of Odds, GRG, TP Brand Injection, TP Affiliate), the
   per-entry heuristic can disagree with itself — a brand's own entries don't
   always agree on one Agent (documented: Rooster Partners' Spinjo/Spinsup
   split 3/3 between two agents).

The user supplied a Google Sheet ("Files & responsibility mapping -
Responsibilities", exported as
`csv/Files & responsibility mapping - Responsibilities.csv`) that is the real
operational source of truth for who owns which brand, per platform. This
spec wires that sheet's data into the dashboard as a new authoritative layer,
so Schedule Planner's display and its PMS Assignee push are both accurate.

## Source data (parsed from the CSV, verified against live entries)

The CSV has two independent tables side by side:

- **Left table** (cols A-D): brand-group header row (e.g. `"Rooster
  Brands"`) followed by brand rows with per-platform Agent initials in
  TrustPilot / AskGambler / CasinoGuru columns. A separate `"Wizard of
  Odds"` section (single Agent column) follows the same shape.
- **Right table** (cols G-H): two sections, `"BI TP"` and `"AFF TP"`,
  listing brand names for TP Brand Injection / TP Affiliate — **no Agent
  values are filled in for either**, so neither is covered by this task;
  both tabs keep using their existing per-entry `Agent` field exactly as
  today.

Group → tab mapping (confirmed against `TAB_COLUMN_CONFIGS` and live brand
name spellings via a direct Supabase REST query):

| CSV group | Tab | Platforms tracked |
|---|---|---|
| Rooster Brands | Rooster Partners | tp, ag, cg |
| Revolution Brands | Revolution Casino | tp, ag, cg |
| Trybet Brands | Trybet | tp only |
| Silver Play Brands | SilverPlay | tp, ag, cg |
| SuprNation Brands | SuprPlay Limited | tp only |
| Hanan Brands | Hanan | tp, ag, cg |
| Wizard of Odds | Wizard of Odds | wo only |

**One real spelling mismatch was caught and corrected** during live
verification: the sheet says `"Trybet"`, but Trybet's actual brand value in
`entries` is `"Trybet.com"`. Since brand-key matching is lower+trim only (no
punctuation stripping), the uncorrected value would have silently never
matched. The seed migration uses the corrected `"Trybet.com"`.

Brands present in a tab's live entries but absent from the CSV (e.g.
Novadreams, Midasluck, Revolution1, and Hanan's flagged-removed Pribet.com /
RealSpin.com / WinMega.com) get no row in the new table — they keep falling
back to the existing per-entry heuristic, unchanged from today's behavior.

Explicit `"N/A"` cells in the sheet (e.g. Silver Play TP, God Of Casino
TP/CG, Novadreams2 all three platforms) mean "deliberately unassigned," not
"not covered" — these are seeded as real rows with `agent = null`, which is
authoritative and suppresses the fallback for that exact (brand, platform).

## Data model

New table `brand_agent_assignments`:

```sql
create table brand_agent_assignments (
  id uuid primary key default gen_random_uuid(),
  tab text not null,
  brand_key text generated always as (lower(trim(brand))) stored,
  brand text not null,
  platform text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  agent text,                    -- null = explicit "no agent" (authoritative)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tab, brand_key, platform)
);
```

Four RLS policies matching the existing `removed_platform_brands` /
`schedule_hidden_brands` pattern: anyone can `select`; only approved users
(the same `is_approved()` check every other config table uses) can `insert`,
`update`, `delete`.

This is a **one-time seed migration only** — no in-app admin UI. Future
reassignments are made directly in the Supabase table editor, the same way
`removed_platform_brands` and similar config tables are already maintained.

## Resolution logic

New function in `src/lib/scheduler/scheduleUtils.ts`:

```ts
export function resolveAgentForPlatform(
  brandKey: string,
  platform: Platform,
  assignments: Map<string, string | null>, // key: `${brandKey}::${platform}`
  agentIndex: Map<string, string>,          // existing buildAgentIndex() result
): string | null {
  const key = `${brandKey}::${platform}`;
  if (assignments.has(key)) return assignments.get(key) ?? null; // authoritative, even if null
  return agentIndex.get(brandKey) ?? null; // fallback to per-entry heuristic
}
```

A new `buildAgentAssignmentMap(rows)` helper turns the fetched
`brand_agent_assignments` rows for a tab into the `Map<string, string |
null>` the resolver expects. `buildAgentIndex` itself is untouched — it
remains the fallback layer for brands/platforms the sheet doesn't cover.

New `fetchBrandAgentAssignments(tab)` in `src/lib/queries.ts`, following the
existing `fetchRemovedPlatformBrands`-style pattern.

## Call-site changes

- **`TabScheduleSection.tsx`'s 3 PMS-push call sites** (the `pushScheduleActivations(...)`
  calls, currently `agent: agentIndex.get(brandKey) ?? null`) switch to
  `resolveAgentForPlatform(brandKey, platform, assignmentMap, agentIndex)` —
  this is the fix that actually corrects PMS assignee accuracy, since it's
  platform-scoped.
- **Row-level tooltip** (`agentIndex.get(brandKey)` at the brand-row render)
  and **the Agent filter dropdown/matching** (`SchedulePlanner.tsx`'s
  `agentOptions`, `TabScheduleSection.tsx`'s `agentFilter` match) keep
  showing/matching one value per brand row, for simplicity — resolved as the
  first non-null `resolveAgentForPlatform` result across that tab's
  `getTabPlatforms(tab)` order. This only visibly differs from full per-platform
  accuracy for the two known split brands (Silver Play, God Of Casino);
  documented as an accepted display simplification.
- **`supabase/functions/generate-weekly-schedule/index.ts`'s `generateForTab`**
  currently builds its `PmsSyncItem[]` with no `agent` field at all — a
  pre-existing, currently-dormant gap (this function isn't deployed yet).
  Fixed in the same task: `generateForTab` now resolves the same way, reading
  `brand_agent_assignments` via `buildTabContext`, so the not-yet-deployed
  cron path can't silently re-diverge from the manual click path the moment
  it does ship — per this project's standing cross-dashboard-consistency
  rule.

## Testing

- `scheduleUtils.test.ts`: unit tests for `resolveAgentForPlatform` (table
  row wins even when `null`; no row falls back to `agentIndex`; platform
  scoping — a row for `tp` doesn't affect `ag` resolution for the same
  brand).
- `pmsSync.ts`/`schedulePmsSync.ts` are untouched — both already accept a
  caller-resolved `agent` value, so no changes needed there.
- `generate-weekly-schedule`'s existing Deno test suite gets a regression
  case confirming `generateForTab` now sets `agent` on pushed items.

## Out of scope

- No in-app UI to manage `brand_agent_assignments` — direct Supabase editing
  only, per explicit decision.
- TP Brand Injection / TP Affiliate are not touched — the sheet has no agent
  data for either, so they keep using their existing per-entry `Agent` field
  unchanged.
- Brands absent from the CSV (Novadreams, Midasluck, Revolution1, and
  Hanan's 3 flagged-removed brands) keep today's fallback behavior — no new
  row, no behavior change.
- `generate-weekly-schedule`'s own pending deploy (already a known,
  documented blocker) is not accelerated by this task — only its code is
  fixed, matching the established "fix code now, defer deploy" pattern from
  Task 207/218/232.
