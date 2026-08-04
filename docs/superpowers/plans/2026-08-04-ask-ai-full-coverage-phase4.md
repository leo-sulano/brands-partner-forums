# Ask AI Full Coverage — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two read-only tools — `get_schedule` (weekly per-platform posting calendar) and `get_paused_combos` (currently auto-paused brand+platform combos) — and fix a real gap: the model has no current-date anchor, so "what's scheduled this week" is currently unanswerable.

**Architecture:** `tools.ts` gains two new `runTool` branches querying `brand_schedule`/`brand_platform_pause` directly (no new pure computation functions — these are direct reads, not aggregation like Phases 1-3). `index.ts` gains a fresh per-request system message with today's date, and one new `DASHBOARD CONTEXT` bullet. Split into two tasks: Task 1 is the testable `tools.ts` work; Task 2 is the small, untestable-by-automation `index.ts` prompt work.

**Tech Stack:** Deno, TypeScript, `deno test` + `https://deno.land/std@0.224.0/assert/mod.ts`. No new dependencies.

## Global Constraints

- Neither new tool calls `ensureWeekGenerated`/`recalculatePauses` (`src/lib/scheduler/schedulerService.ts`) or writes to any table — both are pure reads. This is a hard boundary, not a suggestion: a chat question about a week nobody has visited in the real app must return an empty result, never trigger schedule generation as a side effect.
- `get_schedule` selects `brand` (the real, human-readable name), not `brand_key` — the frontend's own `fetchBrandSchedule` in `src/lib/queries.ts` only selects `brand_key` because it already has the brand list from elsewhere; Ask AI has no such other context and needs the readable name directly.
- No date arithmetic in the Edge Function anywhere in this phase — `week_start` is a required, model-supplied parameter (an explicit Monday date), not computed server-side. This is deliberate: this codebase already shipped and fixed a timezone bug from exactly this kind of server/browser date-math mismatch (`src/lib/scheduleBrands.ts`'s `toISODate` comment documents it) — an Edge Function has no access to a user's browser clock, so reimplementing "today's Monday" here would risk the same bug in a new place.
- The current-date system message must be computed fresh inside the `Deno.serve` request handler, NOT baked into the static `SYSTEM_PROMPT` constant (which is built once at module load and would go stale for however long the Edge Function instance stays warm).
- No `removed_platform_brands` cross-wiring in either new tool — out of scope per the spec.
- Test runner: `deno test supabase/functions/ai-assistant/tools_test.ts` (confirmed working baseline before this plan's changes: 34 tests passing).

---

### Task 1: `get_schedule` and `get_paused_combos` tools

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
- Modify: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `mockSupabaseTables` (already defined in `tools_test.ts` from Phase 3 — no new test helper needed).
- Produces: two new `TOOL_DEFS` entries (`get_schedule`, `get_paused_combos`) and two new `runTool` branches. Nothing else in this plan depends on these beyond Task 2's documentation-only changes, which don't reference them by name.

- [ ] **Step 1: Write the failing tests**

Add these tests at the end of `tools_test.ts` (after the last existing test):

```ts
Deno.test('get_schedule returns the weekly grid for a tab and week, using brand not brand_key', async () => {
  const tables = {
    brand_schedule: [
      {
        tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'tp', week_start: '2026-08-03',
        monday: 'active', tuesday: null, wednesday: null, thursday: 'active', friday: null,
      },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Rooster Partners', week_start: '2026-08-03' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].brand, 'Lucky7even');
  assertEquals(result.schedule[0].monday, 'active');
  assertEquals(result.schedule[0].tuesday, null);
});

Deno.test('get_schedule filters by both tab and week_start', async () => {
  const tables = {
    brand_schedule: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'tp', week_start: '2026-07-27', monday: 'paused', tuesday: null, wednesday: null, thursday: null, friday: null },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Rooster Partners', week_start: '2026-08-03' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].monday, 'active');
});

Deno.test('get_schedule returns an empty array, not an error, when nothing matches', async () => {
  const tables = { brand_schedule: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Rooster Partners', week_start: '2099-01-05' });
  assertEquals(result.schedule.length, 0);
});

Deno.test('get_paused_combos lists paused combos with reason, optionally filtered by tab', async () => {
  const tables = {
    brand_platform_pause: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'ag', paused_week_start: '2026-07-27', reason: '2 consecutive removed' },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', paused_week_start: '2026-08-03', reason: 'success rate below threshold' },
    ],
  };
  const all: any = await runTool(mockSupabaseTables(tables), 'get_paused_combos', {});
  assertEquals(all.paused.length, 2);

  const filtered: any = await runTool(mockSupabaseTables(tables), 'get_paused_combos', { tab: 'Hanan' });
  assertEquals(filtered.paused.length, 1);
  assertEquals(filtered.paused[0].brand, 'Pribet.com');
  assertEquals(filtered.paused[0].reason, 'success rate below threshold');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — `get_schedule` and `get_paused_combos` are unknown tools (the `runTool` catch-all `{ error: 'unknown tool: ...' }` fires, so `result.schedule`/`result.paused` are `undefined`, and `.length` on `undefined` throws).

- [ ] **Step 3: Implement the two tool definitions and dispatch branches**

In `supabase/functions/ai-assistant/tools.ts`, add two new entries to the `TOOL_DEFS` array, after the existing `get_success_rate_by_field` entry and before the array's closing `];`:

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

Add two new `runTool` branches, after the existing `get_success_rate_by_field` branch and before the final `return { error: ... };` catch-all (currently the last two lines of the function):

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: all tests pass, including the 4 new ones (38 total, up from 34).

- [ ] **Step 5: Run `deno check` on the whole function**

Run: `deno check supabase/functions/ai-assistant/index.ts` and `deno check supabase/functions/ai-assistant/tools.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "$(cat <<'EOF'
feat: add get_schedule and get_paused_combos tools to Ask AI

Read-only access to the Intelligent Schedule Planner's weekly
per-platform posting calendar (brand_schedule) and standing auto-pause
state (brand_platform_pause). Neither tool calls
ensureWeekGenerated/recalculatePauses — a question about a week
nobody has visited in the real app returns an empty result, never
triggers generation as a side effect. get_schedule selects the real
brand name (not brand_key, which the frontend's own fetch uses
because it already has the brand list from elsewhere).
EOF
)"
```

---

### Task 2: Current-date system message and DASHBOARD CONTEXT bullet

**Files:**
- Modify: `supabase/functions/ai-assistant/index.ts`

**Interfaces:**
- Consumes: nothing from Task 1 by name — this only changes prompt text and adds one runtime message so the model knows the current date (needed to compute `week_start` for Task 1's `get_schedule` tool) and that scheduling questions are in-domain.
- Produces: nothing consumed by another task — this is the last task in this plan, and the last task of the entire 4-phase project.

- [ ] **Step 1: Add the DASHBOARD CONTEXT bullet**

In `supabase/functions/ai-assistant/index.ts`, the `DASHBOARD CONTEXT` section currently reads (lines 47-55):

```
The dashboard manages:

• Brand Monitoring (performance tracking, FTDs, activity)
• Profiles Module (forum profiles linked to brands)
• FTD Tracking (first-time deposits per brand/source)
• Review Monitoring (TP = Trustpilot, AG = AskGamblers, CG = Casino Guru)
• Per-account attributes (Proxy Used, Agent, Country, and other operational fields tracked per review account)
• User Management (roles: admin, manager, user)
• Reports & Analytics (monthly reports, comparisons, summaries)
```

Add one bullet after "Per-account attributes" and before "User Management":

```
• Posting Schedule & Pause State (weekly per-platform posting calendar, auto-pause status)
```

- [ ] **Step 2: Add the per-request current-date system message**

The request handler currently reads (lines 188-190):

```ts
  const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (context) messages.push({ role: 'system', content: `Current page context: ${context}` });
  messages.push(...userMessages);
```

Replace with:

```ts
  const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  messages.push({ role: 'system', content: `Current date: ${new Date().toISOString().slice(0, 10)} (UTC)` });
  if (context) messages.push({ role: 'system', content: `Current page context: ${context}` });
  messages.push(...userMessages);
```

This must be computed inside the request handler (where it now is), not added to the top-level `SYSTEM_PROMPT` constant — that constant is built once when the Edge Function module loads and would return a stale date for however long the deployed instance stays warm.

- [ ] **Step 3: Verify the file is still valid TypeScript**

There is no automated test for prompt text or this one-line runtime addition — this repo's existing test suite covers only `tools.ts`'s pure functions and `runTool` dispatch, never `index.ts`'s request-handling code, and that precedent doesn't change here. Verify instead by reading the file back to confirm the edits are syntactically correct (the template literal in `SYSTEM_PROMPT` is still properly closed, the new `messages.push` line has matching parens/braces), and by running:

Run: `deno check supabase/functions/ai-assistant/index.ts`
Expected: no errors.

- [ ] **Step 4: Run the full test suite one more time**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: all 38 tests still pass (this task doesn't touch `tools.ts`, but confirms nothing else regressed).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/index.ts
git commit -m "$(cat <<'EOF'
feat: give Ask AI a current-date anchor and schedule-domain awareness

Adds a fresh per-request "Current date" system message (previously
missing entirely — "what's scheduled this week" was unanswerable
without one) and a DASHBOARD CONTEXT bullet naming Posting Schedule &
Pause State as a tracked concept, so the model doesn't wrongly refuse
in-domain scheduling questions the way it originally refused proxy
questions before Phase 1. The date is computed inside the request
handler, not the static SYSTEM_PROMPT constant, so it can't go stale
across a warm Edge Function instance.

This is the final task of the 4-phase Ask AI Full Coverage effort.
EOF
)"
```

---

## Deployment note (not a task — informational)

As with every prior phase, none of these changes take effect in production until the Edge Function is redeployed: `supabase functions deploy ai-assistant`. This is the last phase of the plan — after this deploy, all four phases' work goes live together if it hasn't been deployed incrementally already.

## Self-Review Notes

- **Spec coverage:** The spec's "1. Current-date anchor" → Task 2 Step 2. "2. get_schedule tool" → Task 1 Step 3 (TOOL_DEFS entry + runTool branch). "3. get_paused_combos tool" → Task 1 Step 3. "4. Hard boundary: no write side-effects" → satisfied by both new `runTool` branches containing only `select`/`eq`, no calls to `ensureWeekGenerated`/`recalculatePauses`, and stated as a Global Constraint. "5. System prompt: DASHBOARD CONTEXT bullet" → Task 2 Step 1. The spec's "Testing" section's four bullets (brand-not-brand_key, both filters, empty-result-not-error, get_paused_combos with/without tab filter) map directly to Task 1 Step 1's four tests.
- **Placeholder scan:** No TBD/TODO; every step has literal, complete code.
- **Type consistency:** Both new `runTool` branches follow the exact same `let q = supabase.from(...).select(...); if (args?.x) q = q.eq(...); const { data, error } = await q; if (error) throw error; return { ... };` shape already established by every other branch in this file (`list_tabs`, `query_entries`, `get_removed_platform_flags`) — no new patterns introduced. `mockSupabaseTables`'s generic `{ tab, brand, platform, ... }`-shaped row filtering (from Phase 3) works unchanged for both new tables without modification, since it filters by `r[key] === value` generically rather than assuming a specific row shape.
