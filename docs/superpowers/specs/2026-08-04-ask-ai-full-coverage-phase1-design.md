# Ask AI Full Coverage — Phase 1: Safe Field Access + Proxy/Agent/Country Success Rate

## Problem

The Ask AI assistant wrongly refuses legitimate questions like "Which proxy works
the best?" — its system prompt's `DASHBOARD CONTEXT` section never mentions Proxy,
Agent, or Country as tracked concepts, so the model has no signal they're in-domain
and declines before trying a tool. Even if it tried, it couldn't answer: `tools.ts`'s
`query_entries` only returns 5 fields per row (`brand`, `account`, `status`, `score`,
`date` — via `mapEntrySummary`), and there is no tool that aggregates by any field.

The user wants Ask AI to eventually be able to answer "everything across the
dashboard." That's too large for one spec — it spans several independent
subsystems (this repo's own Score Summary computations, `removed_platform_brands`,
`brand_schedule`/`brand_platform_pause`, activity logs). This spec covers **Phase 1
only**: a safe-field foundation every later phase builds on, plus the proxy/agent/
country capability that prompted this work. Later phases (Score Summary metrics,
removed-brand flags, Schedule Planner state) are separate, future specs.

## A pre-existing vulnerability, fixed as part of this phase

While auditing what's safe to expose, a real, currently-shipping bug was found:
`get_entry`'s `runTool` handler (`tools.ts:249-257`) returns the full, unredacted
`data` jsonb for a row with no filtering at all. `entries.data` contains credential
fields — a review account's own `Password`, plus platform-specific `AG Password`,
`CG Password`, `Casino Password`, `Backup Codes`, and `Authenticator Backup` (exact
names confirmed against `AddReviewAccountModal.tsx`, `EditEntryModal.tsx`, and
`BrandGroup.tsx`'s own `DASHBOARD_ONLY_MODAL_FIELDS`/hidden-column lists — these are
the only sensitive field names found anywhere in the frontend). Since every tool
result gets sent to the OpenAI API as part of the conversation, any existing call to
`get_entry` on a row with a saved password already ships that password to OpenAI
today. This is fixed here, not deferred to a later phase, because every subsequent
phase's tools build on the same redaction primitive.

## Design

### 1. Credential blocklist + redaction helper

New in `supabase/functions/ai-assistant/tools.ts`:

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

This is the single source of truth every tool routes through. It's a blocklist, not
an allowlist — deliberately, since `entries.data`'s shape is sheet-driven and varies
per tab (an allowlist would need to enumerate every non-sensitive column across all
11 tabs and would silently hide any new field added later; a blocklist keeps new
fields visible by default and only needs the 6 known-sensitive names kept current).

### 2. Fix `get_entry`

`runTool`'s `get_entry` branch changes from returning `data` directly to:

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

### 3. Broaden `query_entries`

Replace the narrow `mapEntrySummary()` output with the full redacted row. The
`query_entries` branch's final return becomes:

```ts
return {
  total,
  rows: rows.slice(0, limit).map((e) => ({ id: e.id, tab: e.tab, data: redactSensitive(e.data) })),
};
```

`mapEntrySummary`, `BRAND_KEYS`, `ACCOUNT_KEYS`, `SCORE_KEYS`, `DATE_KEYS` stay —
`STATUS_KEYS`/`pick`/`matchesStatus`/`matchesMonth`/`entryMatches`/`scoreSummary`
still filter/compute using them internally (status/month/contains filtering, and
`get_score_summary`'s existing star rollup, are unaffected). Only the **shape of
what's returned to the model** changes, from 5 fixed fields to the full redacted
row. This alone lets the model answer any question about a non-credential field on
any tab (proxy, agent, country, yes/no behavioral fields, platform links, etc.),
without a new tool per field.

The `query_entries` tool description gets one line added noting rows now include
all non-credential fields, not just brand/status/score/date, so the model knows to
look at `row.data` for anything not already surfaced as a named property.

### 4. `get_success_rate_by_field` tool

Field-name mapping, verified against all 11 tabs' real `TAB_COLUMN_CONFIGS` entries
in `src/lib/tab-configs.ts` — `Proxy Used` and `Country` are spelled identically on
every tab; `Agent` exists on 5 of 11 (Rooster Partners, TP Brand Injection,
TP Affiliate, SuprPlay Limited, Wizard of Odds) and is simply absent as a grouping
key on the rest (rows from those tabs won't appear in an `agent`-grouped result —
expected, not a bug):

```ts
const FIELD_KEYS: Record<'proxy' | 'agent' | 'country', string[]> = {
  proxy: ['Proxy Used'],
  agent: ['Agent'],
  country: ['Country'],
};
```

Ported from `src/lib/scoreSummary.ts` (kept in sync manually, same pattern as this
file's existing header comment about `pick`/`BRAND_KEYS` etc. being ported):

```ts
export function isLiveStatus(s: string): boolean {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}

export function isRemovedStatus(s: string): boolean {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}
```

New pure function:

```ts
export interface FieldSuccessRate {
  value: string;
  live: number;
  removed: number;
  total: number;
  rate: number | null; // 0-100, or null when total is 0
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
    if (!b) { b = { live: 0, removed: 0 }; buckets.set(value, b); }
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

Sorting by rate descending (nulls last, via `?? -1`) means "best" is simply the
first row — no ranking logic needed on the model's side.

New tool definition, added to `TOOL_DEFS`:

```ts
{
  type: 'function',
  function: {
    name: 'get_success_rate_by_field',
    description:
      'Computes the same live/removed "Success Rate" shown elsewhere in the ' +
      'dashboard (Published+Live vs Removed+Refused, as a percentage), grouped by ' +
      'one field: proxy, agent, or country. Results are sorted best-rate-first, so ' +
      'the top row answers "which X works best". Rows whose status is pending, ' +
      'paused, or otherwise undecided are not counted (contribute to neither live ' +
      'nor removed) — total may be lower than raw row count for that value.',
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

`runTool` dispatch:

```ts
if (name === 'get_success_rate_by_field') {
  let q = supabase.from('entries').select('id, tab, data');
  if (args?.tab) q = q.eq('tab', args.tab);
  const { data, error } = await q;
  if (error) throw error;
  return { results: successRateByField(data ?? [], args?.field) };
}
```

### 5. System prompt update

`index.ts`'s `SYSTEM_PROMPT`, `DASHBOARD CONTEXT` section gains one bullet:

```
• Per-account attributes (Proxy Used, Agent, Country, and other operational fields
  tracked per review account)
```

`TOOL USAGE RULES` section gains one line:

```
For "which <proxy/agent/country> works/performs best" questions, use
get_success_rate_by_field — do not attempt to compute this from query_entries rows
yourself.
```

## Out of scope (future phases)

- Score Summary's full metrics (star ratings + Success Rate per brand/platform,
  properly matching `computeScoreSummary`/`computeSuccessRates`) — today's
  `get_score_summary` only does the star-rating rollup; Phase 2.
- `removed_platform_brands` (TP/AG/CG/WO-removed flags) — Phase 3.
- `brand_schedule`/`brand_platform_pause` (Schedule Planner state) — Phase 4.
- No change to `list_tabs` or `get_score_summary` beyond what's noted above — both
  keep their current behavior.
- No change to the frontend widget, streaming, or model choice.

## Testing

New tests in `supabase/functions/ai-assistant/tools_test.ts`:

- `redactSensitive`: given a `data` object containing all 6 sensitive keys plus
  several normal keys, returns an object with the 6 removed and the rest untouched
  (including falsy-but-legitimate values like `''` or `'0'` on non-sensitive keys,
  to confirm the filter is key-based, not value-based).
- Regression lock: construct an `EntryRow` whose `data` includes `Password: 'x'`,
  call `runTool(mockSupabase, 'get_entry', { id })` and separately
  `runTool(mockSupabase, 'query_entries', {})`, and assert `JSON.stringify(result)`
  does not contain `'x'` (or any of the 6 sensitive key names) in either case — this
  is the test that would fail if the redaction call were ever accidentally removed
  from either tool.
- `successRateByField`: synthetic `EntryRow[]` covering — a clean 2-live/1-removed
  bucket producing the correct rate; a value appearing on rows with no decided
  status (contributes to neither live nor removed, and isn't silently miscounted);
  the `agent` field on rows from a tab that has no `Agent` key at all (excluded
  entirely, not grouped under `''`); result ordering (best rate first, a
  zero-total/null-rate bucket sorts last).
