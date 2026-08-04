# Ask AI Full Coverage — Phase 4: Schedule Planner State

## Problem

The dashboard's Intelligent Schedule Planner (`src/lib/scheduler/`) tracks two facts
Ask AI currently has no visibility into: a weekly per-platform posting calendar
(`brand_schedule` — active/paused per weekday) and standing auto-pause state
(`brand_platform_pause` — which brand+platform combos are currently paused, and
why). Ask AI can't answer "what's scheduled for Rooster Partners this week?" or
"which brand+platform combos are currently paused?".

This is Phase 4, the last of the 4-phase plan. Phases 1-3 (credential-safe field
access + proxy/agent/country success rate, platform-aware score summary, removed-brand
flag exclusion) are already shipped on `main`.

## A gap surfaced during brainstorming: the model has no current-date anchor

Nothing in the existing system prompt tells the model what today's date is, so "this
week" is literally unanswerable without one. Fixed here as a prerequisite, not a
separate concern.

## A timezone landmine avoided by design

This exact codebase already shipped and fixed a bug where naive UTC-based
"today's Monday" math disagreed with a user's local-timezone browser by a day
(`toISODate`/`mondayOf` in `src/lib/scheduleBrands.ts` are deliberately
local-browser-time for this reason). An Edge Function has no access to a user's
browser clock — only server time (likely UTC), which would reintroduce the same
class of bug in a new place if the function tried to compute "today" or "this
week's Monday" itself. **Decision: no date arithmetic happens in the Edge
Function.** `week_start` is a required tool parameter (an explicit Monday date)
that the model computes itself from a current-date anchor added to the system
prompt.

## Design

### 1. Current-date anchor (`index.ts`)

Inside `Deno.serve`'s request handler (NOT baked into the static `SYSTEM_PROMPT`
constant, which is built once at module load and would go stale for however long
the Edge Function instance stays warm), add a fresh per-request system message —
the same pattern already used for the existing "Current page context" message:

```ts
messages.push({ role: 'system', content: `Current date: ${new Date().toISOString().slice(0, 10)} (UTC)` });
```

### 2. `get_schedule` tool

```ts
{
  type: 'function',
  function: {
    name: 'get_schedule',
    description:
      'Returns the weekly per-platform posting calendar (active/paused per weekday) ' +
      'for a tab and week. week_start MUST be the Monday of the requested week, in ' +
      'YYYY-MM-DD format — compute it from the current-date system message; passing ' +
      'a non-Monday date will simply match no rows, since stored weeks are always ' +
      'keyed by their Monday. An empty result means nothing has been scheduled for ' +
      'that week yet (the schedule is generated lazily when someone opens that week ' +
      'in the app) — this is not an error. A null platform on a row means a legacy, ' +
      'pre-platform-tracking week.',
    parameters: {
      type: 'object',
      properties: {
        tab: { type: 'string' },
        week_start: { type: 'string', description: 'Monday of the requested week, YYYY-MM-DD' },
      },
      required: ['tab', 'week_start'],
    },
  },
},
```

```ts
if (name === 'get_schedule') {
  let q = supabase
    .from('brand_schedule')
    .select('tab, brand, platform, week_start, monday, tuesday, wednesday, thursday, friday');
  if (args?.tab) q = q.eq('tab', args.tab);
  if (args?.week_start) q = q.eq('week_start', args.week_start);
  const { data, error } = await q;
  if (error) throw error;
  return { schedule: data ?? [] };
}
```

Selects `brand` (the real, human-readable name), not `brand_key` — the frontend's
own `fetchBrandSchedule` in `src/lib/queries.ts` only selects `brand_key` because it
already has the brand list from elsewhere and just needs it for matching; Ask AI has
no such other context and needs the readable name directly.

No `brand` filter parameter — the tool returns the whole tab's week grid (typically
under a dozen brands) and the model finds the relevant row itself, consistent with
how `get_score_summary` returns all brands for a tab rather than one at a time.

### 3. `get_paused_combos` tool

```ts
{
  type: 'function',
  function: {
    name: 'get_paused_combos',
    description:
      'Lists brand+platform combos currently auto-paused (2 consecutive Removed/' +
      'Refused posts, or an all-time success rate below the pause threshold), with ' +
      'the reason and the week the pause started. Not week-scoped — a pause is a ' +
      'standing state, not tied to one week\'s calendar. Optionally filtered to one tab.',
    parameters: {
      type: 'object',
      properties: { tab: { type: 'string' } },
    },
  },
},
```

```ts
if (name === 'get_paused_combos') {
  let q = supabase
    .from('brand_platform_pause')
    .select('tab, brand, platform, paused_week_start, reason');
  if (args?.tab) q = q.eq('tab', args.tab);
  const { data, error } = await q;
  if (error) throw error;
  return { paused: data ?? [] };
}
```

### 4. Hard boundary: no write side-effects

Neither tool calls `ensureWeekGenerated`/`recalculatePauses`
(`src/lib/scheduler/schedulerService.ts`) — the functions that generate a week's
schedule or recompute pause state, normally triggered only from the Schedule
Planner page's own effect when a user actually opens that week. A chat question
about a week nobody has visited in the real app returns an empty `schedule` array,
never triggers generation as a side effect. This matches `tools.ts`'s existing file
header framing ("Read-only tools the assistant can call").

### 5. System prompt: one new DASHBOARD CONTEXT bullet

Same preemptive-refusal fix as Phase 1's "Per-account attributes" bullet — without
this, the model has no signal that scheduling questions are in-domain and may wrongly
decline them the same way it originally declined proxy questions:

```
• Posting Schedule & Pause State (weekly per-platform posting calendar, auto-pause status)
```

## Out of scope

- No removed-brand-flag cross-wiring — pause/schedule state isn't about review
  status or brand-removal, no reason to intersect with `removed_platform_brands`.
- No write capability (no "pause this for me" / "schedule this" tool) — this phase
  is read-only, matching every prior phase's scope.
- No date-range/multi-week query in `get_schedule` — one `(tab, week_start)` pair
  per call, matching how the frontend itself fetches one week at a time.
- No changes to `schedulerService.ts`, `schedulerEngine.ts`, `schedulerRules.ts`,
  or any frontend Schedule Planner code.

## Testing

- `get_schedule` via `runTool` with a mock multi-table client (`mockSupabaseTables`,
  already available from Phase 3 — no new test infrastructure needed): returns rows
  for the given `(tab, week_start)`, respects both filters, returns an empty array
  (not an error) when nothing matches.
- `get_schedule` returns `brand` (not `brand_key`) in its output.
- `get_paused_combos` via `runTool`: returns all rows when `tab` is omitted, filters
  correctly when `tab` is given, includes `reason` and `paused_week_start`.
- No test needed for the current-date system message beyond confirming `index.ts`
  still compiles (`deno check`) — its content is a timestamp, not logic with
  branches to unit-test, and this repo's existing tests don't cover `index.ts`'s
  request-handling code at all (only `tools.ts`'s pure functions and `runTool`
  dispatch are tested).
