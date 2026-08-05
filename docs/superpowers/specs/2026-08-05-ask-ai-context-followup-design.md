# Ask AI — Conversational Follow-Up + Generic Field Drill-Down (Phase 1 of 3)

## Problem

Users reported Ask AI failing to answer natural follow-up questions, e.g.:

- "Who's agent have more post accounts?" → "ANN, 48 posts." → "48 account on what
  brand?" → *"The information I retrieved does not specifically correlate..."*
- "What's the statistics of email provider of the account reviews?" → (overall
  stats) → "...for Trybet?" → *"I couldn't find any matching data."* — and on a
  related turn, the assistant instead **fabricated** an answer: a tab named
  "Forum-Gmail" (not a real tab — the real 11 are listed in `SYSTEM_PROMPT`), a
  made-up 154-entry count, and an invented "IPRoyal" detail.

Investigation before writing this spec found the actual root causes are narrower
than "the assistant forgets the conversation":

1. `AskAI.tsx` already sends the **full** message array on every request (see
   `send()` building `next = [...messages, newMsg]`), and `index.ts` forwards all
   of it to the model — conversation memory in the literal sense already exists.
   The assistant's own prior reply text usually names the resolved entity (e.g.
   "Trybet has a success rate of 63.79%"), which is often enough for the model to
   infer follow-up context on its own without any new state.
2. What's genuinely missing is **tool capability**: `query_entries` cannot filter
   by an arbitrary field (agent, email provider, IP provider, ...), and there is
   no tool that groups/breaks down entries by a field at all —
   `get_success_rate_by_field` only computes the live/removed success-rate
   formula for a hardcoded `proxy | agent | country` enum, which doesn't fit a
   plain "how many by X" or "most common X" question and doesn't cover fields
   like email/IP provider.
3. The "Forum-Gmail" answer is a live hallucination, not a memory bug: the model
   answered a question its tools could not actually resolve instead of saying so.
   The system prompt has no rule against inventing tab names or numbers.

This spec (**Phase 1**) closes both gaps: generic field filtering/grouping tools,
and prompt rules for context inheritance + anti-hallucination. It deliberately
does **not** build the separate intent-analysis/entity-extraction/query-planner
LLM stages, persisted context object, or SQL-generation layer described in a
broader ask — `entries.data` is a jsonb blob queried via hand-written
Supabase/PostgREST filters (never raw SQL), and a real-database-shaped
architecture doesn't fit it. A single richer tool-calling loop is simpler,
cheaper, and directly targets the two reproduced bugs above.

Two further phases are out of scope here and will get their own specs:

- **Phase 2 — advanced analytics**: trend/period comparisons, "who
  improved/declined and why", anomaly detection. Needs its own design since it
  depends on what historical data actually exists (no daily-snapshot table
  today, only current status + one add-date per entry).
- **Phase 3 — production hardening**: response caching, prompt/query/token
  logging, conversation summarization for very long threads, broader security
  review. Independent of correctness, valuable on its own schedule.

## Design

### 1. `list_fields` tool

New tool so the model can discover a tab's real field names/casing (e.g. "Email
Provider" vs "Email") before filtering or grouping by one — same role
`list_tabs` already plays for tab names.

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

Tool definition:

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

`runTool` dispatch:

```ts
if (name === 'list_fields') {
  let q = supabase.from('entries').select('tab, data');
  if (args?.tab) q = q.eq('tab', args.tab);
  const { data, error } = await q;
  if (error) throw error;
  return { fields: collectFieldNames(data ?? []) };
}
```

### 2. Generic filtering + grouping on `query_entries`

Two new optional params, both operating on exact field names (as returned by
`list_fields`), not the alias-list pattern `pick()`/`BRAND_KEYS` use elsewhere:

```ts
export function isSensitiveField(field: string): boolean {
  return SENSITIVE_KEYS_NORM.has(field.trim().toLowerCase());
}

export function matchesFieldFilters(e: EntryRow, filters: Record<string, string>): boolean {
  for (const [field, value] of Object.entries(filters)) {
    const have = String(e.data?.[field] ?? '').trim().toLowerCase();
    if (have !== value.trim().toLowerCase()) return false;
  }
  return true;
}

export interface FieldGroupCount { value: string; count: number }

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

`field_filters: Record<string, string>` — exact match (case-insensitive,
trimmed), AND'd with each other and with the existing `tab`/`status`/`month`/
`contains` params (no change to those). `group_by: string` — when present, the
tool returns `{ total, groups }` (counts per distinct value, most-common first)
instead of the row list.

Both are rejected server-side, not just prompt-discouraged, if they touch a
`SENSITIVE_KEYS` field — this is the one new capability that could otherwise
turn "group by Password" or "filter by Backup Codes" into a real leak:

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

Tool schema gains `field_filters` (object, string values) and `group_by`
(string) properties, with a description update explaining the grouped-response
shape and pointing at `list_fields` for exact names.

This directly answers the two reproduced examples:
- "ANN's accounts by brand" → `query_entries({field_filters: {Agent: "ANN"}, group_by: "Brands"})`
- "Trybet's email providers" → `query_entries({field_filters: {Brands: "Trybet"}, group_by: "Email Provider"})`

### 3. System prompt additions (`index.ts`)

New `CONVERSATION CONTEXT RULES` section:

```
Treat unqualified follow-up questions ("what about X", "only Y", "how many Z",
"compare it", "why") as inheriting the most recently discussed brand, tab,
platform, agent, or other filter from earlier in this conversation — merge the
new constraint with the inherited one and call the appropriate tool again. Only
drop an inherited filter when the user's new message clearly changes topic.

Example: "Show Trybet success rate" then "How many removed reviews?" means "how
many removed reviews for Trybet" — call get_score_summary(tab="Trybet") again,
don't ask the user to repeat the brand.
```

New `ANTI-HALLUCINATION RULE (CRITICAL)` section:

```
Never state a tab name, brand name, or number that did not come from a tool
result returned in this conversation. If a user names a tab or brand you are
not sure exists, call list_tabs (or query_entries) to confirm before answering
— if it is not in the real results, tell the user it does not exist and name
the real tabs instead of inventing data. If no tool covers the question, say so
plainly rather than guessing.
```

`TOOL USAGE RULES` gains one line: "If unsure of a field's exact name for
`field_filters`/`group_by`, call `list_fields(tab)` first."

### 4. Non-functional cleanup

- `MAX_TOKENS`: 800 → 1500 (grouped-breakdown answers with several rows can run
  longer than today's single-metric answers).
- Fix the stale `// ... OpenAI (gpt-4o-mini) ...` doc comment at the top of
  `index.ts` to say `gpt-4o`, matching the actual `MODEL` constant — no change
  to the model itself.

### Out of scope

- No new persisted context object, no DB schema change, no change to the SSE
  wire format, `AskAI.tsx`, or `assistant.ts`.
- No change to `get_score_summary`, `get_removed_platform_flags`,
  `get_schedule`, or `get_paused_combos` beyond what's listed above.
- Trend/period comparison, anomaly detection, response caching, and
  prompt/query logging are Phase 2/3, not here.

## Testing

New tests in `supabase/functions/ai-assistant/tools_test.ts`:

- `collectFieldNames`: unions field names across multiple rows, dedupes,
  excludes all 6 `SENSITIVE_KEYS` (including a case/whitespace variant), sorted
  output.
- `isSensitiveField`: matches on trimmed/case-insensitive variants of all 6
  known keys; returns false for an ordinary field.
- `matchesFieldFilters`: single filter match/no-match; multiple filters
  require all to match (AND); case-insensitive on both key lookup value and
  comparison value.
- `groupByField`: counts and sorts most-common-first; blank/missing values for
  the field are excluded from groups entirely (not bucketed under `''`).
- `runTool('query_entries', ...)` via the existing mock-Supabase pattern:
  - `group_by` returns `{ total, groups }` instead of `rows`, reflecting
    `status`/`month`/`contains`/`field_filters` filters already applied.
  - `group_by: 'Password'` (and `field_filters: {Password: 'x'}`) returns an
    `{ error }` result and never reaches the database rows.
  - Existing no-`group_by`/no-`field_filters` calls are byte-for-byte
    unaffected (regression lock for current behavior).
- `runTool('list_fields', ...)` via mock Supabase: excludes sensitive keys,
  unions across all tabs when `tab` is omitted, scopes to one tab when given.
