# Ask AI Full Coverage — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a live credential leak in the Ask AI assistant's `get_entry` tool, broaden `query_entries` to expose the full non-credential field set instead of 5 fixed fields, and add a `get_success_rate_by_field` tool so the assistant can answer "which proxy/agent/country works best" with real numbers.

**Architecture:** All changes are in `supabase/functions/ai-assistant/` (a Deno Edge Function, tested with `deno test`, unrelated to the main Vite/vitest app). A new `redactSensitive()` helper strips 6 known credential keys from any `entries.data` object before it's returned to a tool caller; both `get_entry` and `query_entries` route through it. A new pure `successRateByField()` function (ported classification logic from `src/lib/scoreSummary.ts`) powers a new tool. `index.ts`'s system prompt is updated so the model knows about the wider field set and the new tool.

**Tech Stack:** Deno, TypeScript, `deno test` + `https://deno.land/std@0.224.0/assert/mod.ts`. No new dependencies.

## Global Constraints

- The credential blocklist is exactly these 6 keys, no others: `'Password'`, `'AG Password'`, `'CG Password'`, `'Casino Password'`, `'Backup Codes'`, `'Authenticator Backup'` (verified against `AddReviewAccountModal.tsx`, `EditEntryModal.tsx`, `BrandGroup.tsx`).
- `redactSensitive()` is a blocklist (remove known-sensitive keys), not an allowlist — every other field passes through unchanged, including future fields not yet known about.
- `get_entry` and `query_entries` must both route through `redactSensitive()` — no tool may return unredacted `entries.data` to the model.
- `FIELD_KEYS` for `get_success_rate_by_field`: `proxy: ['Proxy Used']`, `agent: ['Agent']`, `country: ['Country']` — verified spelling against `src/lib/tab-configs.ts`'s `TAB_COLUMN_CONFIGS` for all 11 tabs.
- `isLiveStatus`/`isRemovedStatus` must match `src/lib/scoreSummary.ts`'s definitions exactly (ported, not reinvented) so the assistant's "success rate" never disagrees with what the dashboard itself shows.
- No changes to `list_tabs`, `get_score_summary`, the frontend widget, streaming behavior, or model choice (`gpt-4o`).
- Test runner: `deno test supabase/functions/ai-assistant/tools_test.ts` (confirmed working baseline: 6 tests passing before this plan's changes).

---

### Task 1: Credential redaction — fix `get_entry`, broaden `query_entries`

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Produces: `SENSITIVE_KEYS: Set<string>`, `redactSensitive(data: Record<string, any>): Record<string, any>` — both exported from `tools.ts`. Task 2 does not depend on these, but later phases (out of scope here) will.

- [ ] **Step 1: Write the failing tests**

Add to `supabase/functions/ai-assistant/tools_test.ts` (add `redactSensitive` to the existing import list from `'./tools.ts'`, alongside `pick`, `parseScore`, etc.):

```ts
Deno.test('redactSensitive strips all 6 known credential keys, keeps everything else', () => {
  const input = {
    Account: '123',
    Password: 'hunter2',
    'AG Password': 'agpass',
    'CG Password': 'cgpass',
    'Casino Password': 'casinopass',
    'Backup Codes': 'codes',
    'Authenticator Backup': 'authbackup',
    'Proxy Used': 'Enigma',
    Country: '',
  };
  const out = redactSensitive(input);
  assertEquals(out.Account, '123');
  assertEquals(out['Proxy Used'], 'Enigma');
  assertEquals(out.Country, '');
  assertEquals('Password' in out, false);
  assertEquals('AG Password' in out, false);
  assertEquals('CG Password' in out, false);
  assertEquals('Casino Password' in out, false);
  assertEquals('Backup Codes' in out, false);
  assertEquals('Authenticator Backup' in out, false);
});

function mockSupabase(rows: EntryRow[]) {
  return {
    from(_table: string) {
      let filtered = rows;
      const builder: any = {
        select(_cols: string) {
          return builder;
        },
        eq(key: string, value: string) {
          filtered = filtered.filter((r: any) =>
            key === 'tab' ? r.tab === value : r.id === value
          );
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: filtered[0] ?? null, error: null });
        },
        then(resolve: any) {
          resolve({ data: filtered, error: null });
        },
      };
      return builder;
    },
  };
}

Deno.test('get_entry never returns a credential key even when the row has one', async () => {
  const rows: EntryRow[] = [
    { id: 'e1', tab: 'TP Brand Injection', data: { Account: '1', Password: 'hunter2' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'get_entry', { id: 'e1' });
  const json = JSON.stringify(result);
  assertEquals(json.includes('hunter2'), false);
  assertEquals(json.includes('Password'), false);
  assertEquals(result.data.Account, '1');
});

Deno.test('query_entries never returns a credential key even when a row has one', async () => {
  const rows: EntryRow[] = [
    { id: 'e1', tab: 'TP Brand Injection', data: { Account: '1', 'Backup Codes': 'secretcodes' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'query_entries', {});
  const json = JSON.stringify(result);
  assertEquals(json.includes('secretcodes'), false);
  assertEquals(json.includes('Backup Codes'), false);
  assertEquals(result.rows[0].data.Account, '1');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — `redactSensitive` is not exported from `./tools.ts` (import error), and/or `runTool`'s `get_entry`/`query_entries` results still contain the credential values since the fix isn't written yet.

- [ ] **Step 3: Implement `redactSensitive` and wire it into both tools**

In `supabase/functions/ai-assistant/tools.ts`, add near the top (after the existing `pick` function, before `BRAND_KEYS`):

```ts
export const SENSITIVE_KEYS = new Set([
  'Password',
  'AG Password',
  'CG Password',
  'Casino Password',
  'Backup Codes',
  'Authenticator Backup',
]);

export function redactSensitive(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (!SENSITIVE_KEYS.has(k)) out[k] = v;
  }
  return out;
}
```

Replace the `get_entry` branch inside `runTool` (currently `return data ?? { error: 'not found' };`) with:

```ts
  if (name === 'get_entry') {
    const { data, error } = await supabase
      .from('entries')
      .select('id, tab, data')
      .eq('id', args?.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: 'not found' };
    return { id: data.id, tab: data.tab, data: redactSensitive(data.data) };
  }
```

Replace the `query_entries` branch's final two lines (currently `const total = rows.length; ... return { total, rows: rows.slice(0, limit).map(mapEntrySummary) };`) with:

```ts
    const total = rows.length;
    const limit = Math.min(Number(args?.limit) || 25, 50);
    return {
      total,
      rows: rows.slice(0, limit).map((e) => ({ id: e.id, tab: e.tab, data: redactSensitive(e.data) })),
    };
```

Also update the `query_entries` tool's `description` string in `TOOL_DEFS` (currently ends `'...IMPORTANT: always pass month as "may 2026" style when user mentions a month.'`) to append one sentence:

```
' Each returned row includes its full set of non-credential fields under `data` (not just brand/status/score/date) — e.g. Proxy Used, Agent, Country, and any other tracked field for that tab.'
```

`mapEntrySummary` itself, `BRAND_KEYS`/`ACCOUNT_KEYS`/`SCORE_KEYS`/`DATE_KEYS`, and `get_score_summary`'s branch are all unchanged — only `get_entry`'s and `query_entries`'s returned shape changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: all tests pass, including the 4 new ones (10 total).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "$(cat <<'EOF'
fix: redact credential fields from Ask AI tool results

get_entry previously returned the full unredacted entries.data —
including Password, Backup Codes, and Authenticator Backup when
present — to the OpenAI API on every call. New redactSensitive()
strips 6 known credential keys (Password, AG Password, CG Password,
Casino Password, Backup Codes, Authenticator Backup); both get_entry
and the broadened query_entries now route through it.
EOF
)"
```

---

### Task 2: `get_success_rate_by_field` tool

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `pick`, `STATUS_KEYS`, `EntryRow` (already defined in `tools.ts`).
- Produces: `isLiveStatus(s: string): boolean`, `isRemovedStatus(s: string): boolean`, `FieldSuccessRate` interface (`{ value: string; live: number; removed: number; total: number; rate: number | null }`), `successRateByField(entries: EntryRow[], field: 'proxy' | 'agent' | 'country'): FieldSuccessRate[]` — all exported from `tools.ts`. Task 3 (system prompt) references the tool name `get_success_rate_by_field` but not these internals directly.

- [ ] **Step 1: Write the failing tests**

Add to `supabase/functions/ai-assistant/tools_test.ts` (add `successRateByField` to the import list from `'./tools.ts'`):

```ts
Deno.test('successRateByField computes live/removed rate per proxy value', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
    { id: '2', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Live' } },
    { id: '3', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Removed' } },
    { id: '4', tab: 't', data: { 'Proxy Used': 'OtherProxy', 'Review Status': 'Refused' } },
  ];
  const out = successRateByField(entries, 'proxy');
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 2);
  assertEquals(enigma.removed, 1);
  assertEquals(enigma.total, 3);
  assertEquals(Math.round(enigma.rate!), 67);
});

Deno.test('successRateByField excludes rows with an undecided status from live/removed counts', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'X', 'Review Status': 'Pending' } },
    { id: '2', tab: 't', data: { 'Proxy Used': 'X', 'Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'proxy');
  const x = out.find((r) => r.value === 'X')!;
  assertEquals(x.live, 1);
  assertEquals(x.removed, 0);
  assertEquals(x.total, 1);
});

Deno.test('successRateByField skips rows with no value for the requested field', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'TabWithNoAgent', data: { 'Review Status': 'Published' } },
    { id: '2', tab: 't', data: { Agent: 'ANN', 'Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'agent');
  assertEquals(out.length, 1);
  assertEquals(out[0].value, 'ANN');
});

Deno.test('successRateByField sorts best rate first, zero-total last', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Country: 'A', 'Review Status': 'Removed' } },
    { id: '2', tab: 't', data: { Country: 'B', 'Review Status': 'Published' } },
    { id: '3', tab: 't', data: { Country: 'C', 'Review Status': 'Pending' } },
  ];
  const out = successRateByField(entries, 'country');
  assertEquals(out.map((r) => r.value), ['B', 'A', 'C']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — `successRateByField` is not exported from `./tools.ts`.

- [ ] **Step 3: Implement the classification functions, `successRateByField`, and the tool**

In `supabase/functions/ai-assistant/tools.ts`, add after the existing `matchesStatus` function:

```ts
// Ported from src/lib/scoreSummary.ts — keep in sync manually if either changes,
// same convention as this file's existing ported pick()/BRAND_KEYS/etc.
export function isLiveStatus(s: string): boolean {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}

export function isRemovedStatus(s: string): boolean {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}

const FIELD_KEYS: Record<'proxy' | 'agent' | 'country', string[]> = {
  proxy: ['Proxy Used'],
  agent: ['Agent'],
  country: ['Country'],
};

export interface FieldSuccessRate {
  value: string;
  live: number;
  removed: number;
  total: number;
  rate: number | null;
}

export function successRateByField(
  entries: EntryRow[],
  field: 'proxy' | 'agent' | 'country',
): FieldSuccessRate[] {
  const keys = FIELD_KEYS[field];
  const buckets = new Map<string, { live: number; removed: number }>();
  for (const e of entries) {
    const value = (pick(e.data, keys) ?? '').trim();
    if (!value) continue;
    const status = (pick(e.data, STATUS_KEYS) ?? '').trim().toLowerCase();
    if (!status) continue;
    let b = buckets.get(value);
    if (!b) {
      b = { live: 0, removed: 0 };
      buckets.set(value, b);
    }
    if (isLiveStatus(status)) b.live += 1;
    else if (isRemovedStatus(status)) b.removed += 1;
  }
  return [...buckets.entries()]
    .map(([value, { live, removed }]) => {
      const total = live + removed;
      return { value, live, removed, total, rate: total === 0 ? null : (live / total) * 100 };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}
```

Add a new entry to the `TOOL_DEFS` array (after the existing `get_score_summary` entry):

```ts
  {
    type: 'function',
    function: {
      name: 'get_success_rate_by_field',
      description:
        'Computes the same live/removed "Success Rate" shown elsewhere in the dashboard ' +
        '(Published+Live vs Removed+Refused, as a percentage), grouped by one field: proxy, ' +
        'agent, or country. Results are sorted best-rate-first, so the top row answers ' +
        '"which X works best". Rows whose status is pending, paused, or otherwise undecided ' +
        'are not counted (contribute to neither live nor removed) — total may be lower than ' +
        'raw row count for that value.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['proxy', 'agent', 'country'] },
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
        },
        required: ['field'],
      },
    },
  },
```

Add a new branch in `runTool`, after the existing `get_score_summary` branch and before the final `return { error: ... }`:

```ts
  if (name === 'get_success_rate_by_field') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { results: successRateByField(data ?? [], args?.field) };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: all tests pass, including the 4 new ones (14 total, on top of Task 1's 10).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "$(cat <<'EOF'
feat: add get_success_rate_by_field tool to Ask AI

Computes the same live/removed Success Rate the dashboard already
shows elsewhere, grouped by proxy, agent, or country, sorted
best-rate-first. isLiveStatus/isRemovedStatus are ported directly
from src/lib/scoreSummary.ts so the assistant's numbers can never
disagree with what the dashboard displays.
EOF
)"
```

---

### Task 3: System prompt update

**Files:**
- Modify: `supabase/functions/ai-assistant/index.ts:44-55` (DASHBOARD CONTEXT section), `index.ts:66-76` (TOOL USAGE RULES section)

**Interfaces:**
- Consumes: nothing from Tasks 1/2 by name — this only changes prompt text so the model knows the wider field set (Task 1) and the new tool (Task 2) exist.
- Produces: nothing consumed by another task — this is the last task in this plan.

- [ ] **Step 1: Add a DASHBOARD CONTEXT bullet**

In `supabase/functions/ai-assistant/index.ts`, the `DASHBOARD CONTEXT` section currently reads (around line 47-54):

```
The dashboard manages:

• Brand Monitoring (performance tracking, FTDs, activity)
• Profiles Module (forum profiles linked to brands)
• FTD Tracking (first-time deposits per brand/source)
• Review Monitoring (TP = Trustpilot, AG = AskGamblers, CG = Casino Guru)
• User Management (roles: admin, manager, user)
• Reports & Analytics (monthly reports, comparisons, summaries)
```

Add one bullet after "Review Monitoring" and before "User Management":

```
• Per-account attributes (Proxy Used, Agent, Country, and other operational fields tracked per review account)
```

- [ ] **Step 2: Add a TOOL USAGE RULES line**

The `TOOL USAGE RULES` section currently ends with (around line 74-76):

```
Never answer data questions from memory.

Always call tools first before responding.
```

Add one line after "Always call tools first before responding.":

```

For "which proxy/agent/country works best" or "performs best" questions, use get_success_rate_by_field — do not attempt to compute this from query_entries rows yourself.
```

- [ ] **Step 3: Verify the prompt string is still valid TypeScript**

There is no automated test for prompt text — verify by reading the file back and confirming the template literal (backtick string starting `const SYSTEM_PROMPT = \`...\`;`) is still correctly terminated (no stray backtick introduced by the edits), and that `deno check` on the file succeeds:

Run: `deno check supabase/functions/ai-assistant/index.ts`
Expected: no errors (Deno's type-checker will fail loudly on a broken template literal or syntax error).

- [ ] **Step 4: Run the full test suite one more time**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: all 14 tests still pass (this task doesn't touch `tools.ts`, but confirms nothing else regressed).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/index.ts
git commit -m "$(cat <<'EOF'
docs: teach Ask AI's system prompt about proxy/agent/country

Mentions per-account attributes as a tracked concept (previously
absent, causing the assistant to wrongly refuse in-domain questions)
and tells it to use get_success_rate_by_field for "which X works
best" questions instead of trying to compute it from raw rows.
EOF
)"
```

---

## Deployment note (not a task — informational)

None of these changes take effect in production until the Edge Function is redeployed: `supabase functions deploy ai-assistant`. No DB credential or Supabase CLI link is assumed to be available in this session (consistent with how prior Edge Function work in this repo has been handled) — deployment is the user's step after implementation.

## Self-Review Notes

- **Spec coverage:** Spec's "1. Credential blocklist + redaction helper" → Task 1 Step 3. "2. Fix get_entry" → Task 1 Step 3. "3. Broaden query_entries" → Task 1 Step 3 (including the tool description addition). "4. get_success_rate_by_field tool" (FIELD_KEYS, ported isLiveStatus/isRemovedStatus, successRateByField, TOOL_DEFS entry, runTool dispatch) → Task 2 Step 3. "5. System prompt update" → Task 3. The spec's "Testing" section's three bullets (redactSensitive test, regression-lock test, successRateByField tests) map 1:1 to Task 1 Step 1 and Task 2 Step 1.
- **Placeholder scan:** No TBD/TODO; every step has literal code, not a description of code.
- **Type consistency:** `redactSensitive(data: Record<string, any>): Record<string, any>` (Task 1) is called identically in both the `get_entry` and `query_entries` branches. `successRateByField(entries: EntryRow[], field: 'proxy' | 'agent' | 'country'): FieldSuccessRate[]` (Task 2) matches the `args?.field` union used in the `TOOL_DEFS` enum and the `runTool` dispatch. `EntryRow` is reused from its existing definition in `tools.ts` (not redefined). Test file's `mockSupabase` helper (Task 1) is only needed by Task 1's tests — Task 2's tests call `successRateByField` directly (pure function, no Supabase client needed), so it isn't re-declared there.
