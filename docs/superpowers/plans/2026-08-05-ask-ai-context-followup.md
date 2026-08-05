# Ask AI — Conversational Follow-Up + Generic Field Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Ask AI answer drill-down follow-ups (e.g. "which brands?" after "ANN has the most posts", "what about Trybet?" after an email-provider breakdown) by adding generic field filtering/grouping tools, and stop it from inventing tab names/numbers it has no data for.

**Architecture:** No new pipeline stages, no persisted state, no schema change. Extend the existing single GPT-4o tool-calling loop in `supabase/functions/ai-assistant/index.ts`/`tools.ts` with: a `list_fields` tool (discover real field names per tab), a `field_filters`/`group_by` extension to `query_entries` (generic filter/group on any non-credential field), and system-prompt rules for context inheritance + anti-hallucination.

**Tech Stack:** Deno (Supabase Edge Function runtime), TypeScript, `Deno.test` + `https://deno.land/std@0.224.0/assert/mod.ts` (matches the existing `tools_test.ts`), OpenAI `gpt-4o` chat-completions tool-calling.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-08-05-ask-ai-context-followup-design.md` — every task below implements one section of it.
- No new tools may return a value for any key in `SENSITIVE_KEYS` (`Password`, `AG Password`, `CG Password`, `Casino Password`, `Backup Codes`, `Authenticator Backup`), whether as a raw value, a `group_by` bucket, or a `list_fields` entry. This is enforced in code (`isSensitiveField`), not just the prompt.
- `field_filters`/`group_by` match on the **exact** field name as it appears in `entries.data` (no alias resolution like `pick()`'s `BRAND_KEYS` etc. does) — case-insensitive, trimmed on the *value* comparison only; the field-name lookup itself (`e.data[field]`) is exact.
- No changes to the frontend (`src/pages/AskAI.tsx`, `src/lib/assistant.ts`), the SSE wire format, the model (`gpt-4o`), or any tool not named in this plan (`get_score_summary`, `get_removed_platform_flags`, `get_schedule`, `get_paused_combos`, `get_entry`).
- Test file: `supabase/functions/ai-assistant/tools_test.ts`. Run with `deno test supabase/functions/ai-assistant/tools_test.ts` from the repo root. Deno 2.7.14 is installed; no `deno.json` exists and none is needed.
- Follow the file's existing conventions: pure helpers exported from `tools.ts`, `runTool(supabase, name, args)` is the only impure dispatcher, mock Supabase clients (`mockSupabase(rows)` for single-table `entries` queries, `mockSupabaseTables(tables)` for multi-table) already exist at the bottom of `tools_test.ts` — reuse them, do not redefine them.

---

### Task 1: `isSensitiveField` guard helper

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (insert after the existing `redactSensitive` function, which ends at line 43, right before the `const BRAND_KEYS = ...` line)
- Test: `supabase/functions/ai-assistant/tools_test.ts` (append new tests after the last existing `Deno.test`, currently the `get_paused_combos` test ending at line 513)

**Interfaces:**
- Consumes: the existing module-private `SENSITIVE_KEYS_NORM` (`tools.ts` line 35: `const SENSITIVE_KEYS_NORM = new Set([...SENSITIVE_KEYS].map((k) => k.trim().toLowerCase()));`) — already computed, do not redefine it.
- Produces: `export function isSensitiveField(field: string): boolean` — later tasks (3, 4) call this to reject a caller-supplied field name.

- [ ] **Step 1: Write the failing tests**

Append to `tools_test.ts`:

```ts
Deno.test('isSensitiveField matches all known sensitive keys, case/whitespace-insensitive', () => {
  assertEquals(isSensitiveField('Password'), true);
  assertEquals(isSensitiveField('password'), true);
  assertEquals(isSensitiveField(' Password '), true);
  assertEquals(isSensitiveField('AG Password'), true);
  assertEquals(isSensitiveField('CG Password'), true);
  assertEquals(isSensitiveField('Casino Password'), true);
  assertEquals(isSensitiveField('Backup Codes'), true);
  assertEquals(isSensitiveField('Authenticator Backup'), true);
});

Deno.test('isSensitiveField returns false for an ordinary field', () => {
  assertEquals(isSensitiveField('Agent'), false);
  assertEquals(isSensitiveField('Email Provider'), false);
  assertEquals(isSensitiveField('Brands'), false);
});
```

Add `isSensitiveField` to the existing `import { ... } from './tools.ts';` block at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — `isSensitiveField is not a function` (or a TS "has no exported member" error), since it doesn't exist yet.

- [ ] **Step 3: Implement `isSensitiveField`**

Insert into `tools.ts` immediately after `redactSensitive`'s closing `}` (line 43) and before `const BRAND_KEYS`:

```ts
export function isSensitiveField(field: string): boolean {
  return SENSITIVE_KEYS_NORM.has(field.trim().toLowerCase());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat(ai-assistant): add isSensitiveField guard helper"
```

---

### Task 2: `collectFieldNames` + `list_fields` tool

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
  - Add `collectFieldNames` immediately after `isSensitiveField` (from Task 1)
  - Add a `list_fields` entry to the `TOOL_DEFS` array (currently starts at line 358; insert as the **first** entry, before `list_tabs`, since field discovery is a prerequisite the model should reach for early — but any position in the array is functionally fine since order doesn't affect dispatch, so inserting right before the existing `list_tabs` entry, i.e. as the array's new first element, is the target — mechanically: insert immediately after the line `export const TOOL_DEFS = [` )
  - Add a `list_fields` branch to `runTool`, alongside the existing `if (name === 'list_tabs') { ... }` branch (currently lines 516-520) — insert immediately after that `if` block closes
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `EntryRow` type (already defined, `tools.ts` line ~108-112), `SENSITIVE_KEYS_NORM` (module-private, already exists).
- Produces: `export function collectFieldNames(rows: EntryRow[]): string[]` and the `list_fields` tool name/schema — Task 4's system-prompt work (Task 5) references this tool by name in prompt text; no other task calls `collectFieldNames` directly.

- [ ] **Step 1: Write the failing tests**

Append to `tools_test.ts` (add `collectFieldNames` to the top import list too):

```ts
Deno.test('collectFieldNames unions field names across rows and dedupes', () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'A', Agent: 'ANN' } },
    { id: '2', tab: 't', data: { Brands: 'B', Country: 'PH' } },
  ];
  assertEquals(collectFieldNames(rows), ['Agent', 'Brands', 'Country']);
});

Deno.test('collectFieldNames excludes sensitive keys, including case/whitespace variants', () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'A', Password: 'x', ' backup codes ': 'y' } },
  ];
  assertEquals(collectFieldNames(rows), ['Brands']);
});

Deno.test('list_fields returns field names for one tab via runTool', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 'Trybet', data: { Brands: 'Acme', 'Email Provider': 'Gmail' } },
    { id: '2', tab: 'Hanan', data: { Brands: 'Zeta', Agent: 'ANN' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'list_fields', { tab: 'Trybet' });
  assertEquals(result.fields, ['Brands', 'Email Provider']);
});

Deno.test('list_fields unions field names across all tabs when tab is omitted', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 'Trybet', data: { Brands: 'Acme' } },
    { id: '2', tab: 'Hanan', data: { Agent: 'ANN' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'list_fields', {});
  assertEquals(result.fields, ['Agent', 'Brands']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — `collectFieldNames is not a function`, and `list_fields` tests fail with `{ error: 'unknown tool: list_fields' }` not matching the expected shape.

- [ ] **Step 3: Implement `collectFieldNames`**

Insert into `tools.ts` immediately after `isSensitiveField`:

```ts
export function collectFieldNames(rows: EntryRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.data ?? {})) {
      if (!SENSITIVE_KEYS_NORM.has(k.trim().toLowerCase())) set.add(k);
    }
  }
  return [...set].sort();
}
```

- [ ] **Step 4: Add the `list_fields` tool definition**

In `tools.ts`, insert as the new first element of the `TOOL_DEFS` array (right after `export const TOOL_DEFS = [`):

```ts
  {
    type: 'function',
    function: {
      name: 'list_fields',
      description:
        'Lists the real data field names tracked for a tab (or across all tabs if ' +
        'tab is omitted) — call this before filtering or grouping by a field whose ' +
        'exact name/casing you are unsure of (e.g. "Email Provider" vs "Email"). ' +
        'Credential fields are never listed.',
      parameters: { type: 'object', properties: { tab: { type: 'string' } } },
    },
  },
```

- [ ] **Step 5: Add the `list_fields` runTool branch**

In `tools.ts`, insert immediately after the closing `}` of the existing `list_tabs` branch:

```ts
  if (name === 'list_fields') {
    let q = supabase.from('entries').select('tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { fields: collectFieldNames(data ?? []) };
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: PASS, all tests including the four new ones.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat(ai-assistant): add list_fields tool for field-name discovery"
```

---

### Task 3: `matchesFieldFilters` + `groupByField` pure helpers

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (insert both functions immediately after `collectFieldNames`, from Task 2)
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `EntryRow` type.
- Produces: `export function matchesFieldFilters(e: EntryRow, filters: Record<string, string>): boolean` and `export interface FieldGroupCount { value: string; count: number }` / `export function groupByField(entries: EntryRow[], field: string): FieldGroupCount[]` — Task 4 wires both into `query_entries`'s `runTool` branch.

- [ ] **Step 1: Write the failing tests**

Append to `tools_test.ts` (add `matchesFieldFilters`, `groupByField` to the import list):

```ts
Deno.test('matchesFieldFilters requires all filters to match (AND)', () => {
  const e: EntryRow = { id: '1', tab: 't', data: { Agent: 'ANN', Country: 'PH' } };
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN' }), true);
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN', Country: 'PH' }), true);
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN', Country: 'US' }), false);
  assertEquals(matchesFieldFilters(e, { Agent: 'BOB' }), false);
});

Deno.test('matchesFieldFilters is case-insensitive and trims on the value comparison', () => {
  const e: EntryRow = { id: '1', tab: 't', data: { Agent: ' ann ' } };
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN' }), true);
});

Deno.test('matchesFieldFilters returns false when the field is missing entirely', () => {
  const e: EntryRow = { id: '1', tab: 't', data: { Country: 'PH' } };
  assertEquals(matchesFieldFilters(e, { Agent: 'ANN' }), false);
});

Deno.test('groupByField counts and sorts most-common-first', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Brands: 'Trybet' } },
    { id: '3', tab: 't', data: { Brands: '7Bit' } },
  ];
  assertEquals(groupByField(entries, 'Brands'), [
    { value: 'Trybet', count: 2 },
    { value: '7Bit', count: 1 },
  ]);
});

Deno.test('groupByField excludes rows with a blank or missing value for the field', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Brands: '' } },
    { id: '3', tab: 't', data: {} },
  ];
  assertEquals(groupByField(entries, 'Brands'), [{ value: 'Trybet', count: 1 }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — `matchesFieldFilters is not a function`, `groupByField is not a function`.

- [ ] **Step 3: Implement both functions**

Insert into `tools.ts` immediately after `collectFieldNames`:

```ts
export function matchesFieldFilters(e: EntryRow, filters: Record<string, string>): boolean {
  for (const [field, value] of Object.entries(filters)) {
    const have = String(e.data?.[field] ?? '').trim().toLowerCase();
    if (have !== value.trim().toLowerCase()) return false;
  }
  return true;
}

export interface FieldGroupCount {
  value: string;
  count: number;
}

export function groupByField(entries: EntryRow[], field: string): FieldGroupCount[] {
  const buckets = new Map<string, number>();
  for (const e of entries) {
    const value = String(e.data?.[field] ?? '').trim();
    if (!value) continue;
    buckets.set(value, (buckets.get(value) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: PASS, all tests including the five new ones.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat(ai-assistant): add matchesFieldFilters and groupByField helpers"
```

---

### Task 4: Wire `field_filters`/`group_by` into `query_entries`

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
  - Update the `query_entries` entry in `TOOL_DEFS` (its `parameters.properties`)
  - Update the `query_entries` branch in `runTool`
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `isSensitiveField` (Task 1), `matchesFieldFilters`/`groupByField` (Task 3), plus the existing `matchesStatus`/`matchesMonth`/`entryMatches`/`redactSensitive` already used by this branch.
- Produces: `query_entries` now returns `{ total, groups: FieldGroupCount[] }` when `group_by` is passed instead of `{ total, rows }`, and rejects sensitive `group_by`/`field_filters` with `{ error: string }`. No other tool depends on this branch's output shape.

- [ ] **Step 1: Write the failing tests**

Append to `tools_test.ts`:

```ts
Deno.test('query_entries with field_filters narrows rows before returning them', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Agent: 'BOB', Brands: '7Bit' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', { field_filters: { Agent: 'ANN' } });
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].data.Brands, 'Trybet');
});

Deno.test('query_entries with group_by returns grouped counts instead of rows', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet' } },
    { id: '2', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet' } },
    { id: '3', tab: 't', data: { Agent: 'ANN', Brands: '7Bit' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {
    field_filters: { Agent: 'ANN' },
    group_by: 'Brands',
  });
  assertEquals(result.total, 3);
  assertEquals(result.groups, [
    { value: 'Trybet', count: 2 },
    { value: '7Bit', count: 1 },
  ]);
  assertEquals('rows' in result, false);
});

Deno.test('query_entries combines group_by/field_filters with existing status/month/contains filters', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet', 'Review Status': 'Published' } },
    { id: '2', tab: 't', data: { Agent: 'ANN', Brands: 'Trybet', 'Review Status': 'Removed' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {
    field_filters: { Agent: 'ANN' },
    status: 'Published',
    group_by: 'Brands',
  });
  assertEquals(result.total, 1);
  assertEquals(result.groups, [{ value: 'Trybet', count: 1 }]);
});

Deno.test('query_entries rejects group_by on a sensitive field without touching the database', async () => {
  const rows: EntryRow[] = [{ id: '1', tab: 't', data: { Password: 'hunter2' } }];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', { group_by: 'Password' });
  assertEquals(typeof result.error, 'string');
  assertEquals('groups' in result, false);
  assertEquals('rows' in result, false);
});

Deno.test('query_entries rejects field_filters on a sensitive field without touching the database', async () => {
  const rows: EntryRow[] = [{ id: '1', tab: 't', data: { 'Backup Codes': 'x', Brands: 'Trybet' } }];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {
    field_filters: { 'Backup Codes': 'x' },
  });
  assertEquals(typeof result.error, 'string');
  assertEquals('rows' in result, false);
});

Deno.test('query_entries with no field_filters/group_by behaves exactly as before (regression lock)', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brands: 'Trybet', 'Review Status': 'Published' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {});
  assertEquals(result.total, 1);
  assertEquals(result.rows.length, 1);
  assertEquals(result.rows[0].data.Brands, 'Trybet');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — the new `field_filters`/`group_by` args are currently silently ignored by `runTool`, so the grouped/filtered assertions fail (e.g. `result.total` includes both rows, `result.groups` is `undefined`, no `{ error }` is produced for the sensitive-field cases).

- [ ] **Step 3: Update the `query_entries` tool schema**

In `tools.ts`, replace the `query_entries` entry's `description` and `parameters.properties` (the block starting `name: 'query_entries'`, roughly lines 369-392) with:

```ts
  {
    type: 'function',
    function: {
      name: 'query_entries',
      description:
        'Search forum entries. ' +
        'Filter by tab (exact tab name from list_tabs), ' +
        'status — valid values are exactly: "Published" (= live/approved/active), "Removed", "Refused", "Not Done", "On Pause" — ' +
        'month (e.g. "may 2026" or "2026-05"), a free-text contains match, and/or ' +
        'field_filters (exact-match on any real field name — call list_fields first ' +
        'if unsure of a field\'s exact name/casing, e.g. "Email Provider"). ' +
        'Pass group_by (a field name) to get counts grouped by that field\'s distinct ' +
        'values instead of raw rows — use this for "how many X by Y" or "most common Y" ' +
        'questions (e.g. group_by="Brands" with field_filters={"Agent":"ANN"} answers ' +
        '"which brands does agent ANN have accounts on"). ' +
        'Without group_by, returns matching rows (each with its full set of ' +
        'non-credential fields under `data`) and total count. ' +
        'IMPORTANT: when user says "approved", "live", or "active" use status="Published". ' +
        'IMPORTANT: always pass month as "may 2026" style when user mentions a month.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          status: { type: 'string' },
          month: { type: 'string', description: 'filter by month, e.g. "may 2026" or "2026-05"' },
          contains: { type: 'string' },
          field_filters: {
            type: 'object',
            description: 'exact-match filters keyed by real field name, e.g. {"Agent": "ANN"}',
            additionalProperties: { type: 'string' },
          },
          group_by: { type: 'string', description: 'a real field name to group counts by, e.g. "Brands"' },
          limit: { type: 'number', description: 'max rows to return, default 25 (ignored when group_by is set)' },
        },
      },
    },
  },
```

- [ ] **Step 4: Update the `query_entries` runTool branch**

In `tools.ts`, replace the existing `if (name === 'query_entries') { ... }` block with:

```ts
  if (name === 'query_entries') {
    if (args?.group_by && isSensitiveField(args.group_by)) {
      return { error: `Cannot group by "${args.group_by}" — this field is redacted for security.` };
    }
    const badFilterField = Object.keys(args?.field_filters ?? {}).find(isSensitiveField);
    if (badFilterField) {
      return { error: `Cannot filter by "${badFilterField}" — this field is redacted for security.` };
    }
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    let rows: EntryRow[] = data ?? [];
    if (args?.status) rows = rows.filter((e) => matchesStatus(e, args.status));
    if (args?.month) rows = rows.filter((e) => matchesMonth(e, args.month));
    if (args?.contains) rows = rows.filter((e) => entryMatches(e, args.contains));
    if (args?.field_filters) rows = rows.filter((e) => matchesFieldFilters(e, args.field_filters));
    if (args?.group_by) {
      return { total: rows.length, groups: groupByField(rows, args.group_by) };
    }
    const total = rows.length;
    const limit = Math.min(Number(args?.limit) || 25, 50);
    return {
      total,
      rows: rows.slice(0, limit).map((e) => ({ id: e.id, tab: e.tab, data: redactSensitive(e.data) })),
    };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: PASS, full suite including all 6 new tests in this task.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat(ai-assistant): add field_filters/group_by to query_entries"
```

---

### Task 5: System prompt — context inheritance, anti-hallucination, non-functional cleanup

**Files:**
- Modify: `supabase/functions/ai-assistant/index.ts`

**Interfaces:**
- Consumes: nothing new — pure text/constant changes to `SYSTEM_PROMPT`, `MAX_TOKENS`, and the top-of-file doc comment.
- Produces: nothing consumed by other tasks — this is the last task.

There is no unit-test harness for `index.ts` (it's a `Deno.serve` HTTP handler with no exported, testable pieces, and `tools_test.ts` intentionally only imports from `tools.ts`) — verification here is a full-file read-back plus running the existing test suite to confirm no regression.

- [ ] **Step 1: Fix the stale model doc comment**

In `index.ts`, line 2 currently reads:

```ts
// AI assistant proxy. Holds OPENAI_API_KEY, runs the OpenAI (gpt-4o-mini)
```

Change `gpt-4o-mini` to `gpt-4o` so the comment matches the actual `const MODEL = 'gpt-4o';` on line 12 (no change to line 12 itself).

- [ ] **Step 2: Raise `MAX_TOKENS`**

In `index.ts`, line 14 currently reads:

```ts
const MAX_TOKENS = 800;
```

Change to:

```ts
const MAX_TOKENS = 1500;
```

- [ ] **Step 3: Add the `CONVERSATION CONTEXT RULES` and `ANTI-HALLUCINATION RULE` sections**

In `index.ts`, `SYSTEM_PROMPT` currently has a `TOOL USAGE RULES` section (lines 69-80) immediately followed by an `ANALYSIS BEHAVIOR` section (starting line 82 with the `────` divider). Insert two new sections between them — i.e. immediately after the line `For "which proxy/agent/country works best" or "performs best" questions, use get_success_rate_by_field — do not attempt to compute this from query_entries rows yourself.` and its trailing blank line, and before the `────────────────────────\nANALYSIS BEHAVIOR` divider:

```
────────────────────────
CONVERSATION CONTEXT RULES
────────────────────────

Treat unqualified follow-up questions ("what about X", "only Y", "how many Z",
"compare it", "why") as inheriting the most recently discussed brand, tab,
platform, agent, or other filter from earlier in this conversation — merge the
new constraint with the inherited one and call the appropriate tool again. Only
drop an inherited filter when the user's new message clearly changes topic.

Example: "Show Trybet success rate" then "How many removed reviews?" means "how
many removed reviews for Trybet" — call get_score_summary(tab="Trybet") again,
don't ask the user to repeat the brand.

────────────────────────
ANTI-HALLUCINATION RULE (CRITICAL)
────────────────────────

Never state a tab name, brand name, or number that did not come from a tool
result returned in this conversation. If a user names a tab or brand you are
not sure exists, call list_tabs (or query_entries) to confirm before answering
— if it is not in the real results, tell the user it does not exist and name
the real tabs instead of inventing data. If no tool covers the question, say so
plainly rather than guessing.
```

- [ ] **Step 4: Add the `list_fields` guidance line to `TOOL USAGE RULES`**

In the same `TOOL USAGE RULES` section (immediately before the line added in an earlier phase, "For \"which proxy/agent/country works best\"..."), add:

```
If unsure of a field's exact name for field_filters/group_by, call list_fields(tab) first.
```

- [ ] **Step 5: Read back the full `SYSTEM_PROMPT` to confirm section order and no syntax errors**

Read `supabase/functions/ai-assistant/index.ts` in full and visually confirm: the template literal is still well-formed (no unterminated backtick), section order reads `TOOL USAGE RULES` → `CONVERSATION CONTEXT RULES` → `ANTI-HALLUCINATION RULE` → `ANALYSIS BEHAVIOR` → (rest unchanged), and both `MAX_TOKENS = 1500` and the `gpt-4o` doc-comment fix from Steps 1-2 are present.

- [ ] **Step 6: Run the full test suite to confirm no regression**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: PASS — this task doesn't touch `tools.ts`, so this is purely a regression check that nothing else broke.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ai-assistant/index.ts
git commit -m "feat(ai-assistant): system prompt rules for context inheritance and anti-hallucination"
```

---

## Deployment note (not a task — informational)

This Edge Function is not auto-deployed by committing to this repo. Per the existing project convention (see `CLAUDE.md`'s Ask AI history entries), shipping this to production requires `supabase functions deploy ai-assistant` to be run separately, with Supabase CLI/project access this implementation session may not have. Do not attempt deployment as part of this plan unless explicitly asked — stop after Task 5's commit and report that deployment is still pending.
