# Ask AI — Review Text Comparison Tool

## Requirement (from user conversation)

User: "Ask AI can also analyze reviews between Publish and removed for content
improvement. Eventually, 'Ask AI' should spot trends in that data and suggest
improvements to the team based on them."

This describes two independent pieces of work, confirmed with the user to
split:

1. **This spec's scope:** give Ask AI a way to read real review text so it
   can answer on-demand content-comparison questions ("what tends to
   separate a Published TrustPilot review from a Removed one?").
2. **Explicitly deferred, not designed here:** proactive trend-spotting +
   suggestions delivered to the team without being asked — a different kind
   of system (scheduled/automated, needs its own storage/cadence/delivery-
   channel design). Revisit as its own brainstorm when there's an actual
   need to build it.

## Data model (confirmed by reading the code)

Review text is stored per row, per platform, as plain jsonb keys on
`entries.data` — `TP Review Text` / `AG Review Text` / `CG Review Text` /
`WO Review Text` — read by the frontend via `getReviewText`/
`PLATFORM_REVIEW_TEXT_KEYS` in `src/lib/scoreSummary.ts`. **There is no
version history**: the scraper always overwrites on a later successful
check, and even a manual edit (Task 199) has no "locked" flag protecting it
from being silently replaced. So there is no way to see "this review's text
before it was removed" for the same posting — only the current text of
whatever is currently Published vs currently Removed, elsewhere. Confirmed
with the user: the intended comparison is at the **group level** (Published
rows as a group vs Removed rows as a group), not tracking one review's
content changing over time.

Known, already-documented per-platform text-quality caveats (from
`docs/superpowers/specs/2026-08-10-review-text-fetch-store-design.md`,
still true): TrustPilot text can occasionally be a review *title* rather
than the body; AskGamblers text can carry a trailing "Helpful (N)" vote-
count line; CasinoGuru text can carry an appended casino owner-reply, or be
missing on an ambiguous page match (intentional safe-fail); Wizard of Odds
has no observed issue.

**Finding that shaped this design:** the raw review text is already
technically reachable through the existing `query_entries` tool —
`SENSITIVE_KEYS` (`tools.ts`) does not include any review-text key, so
`redactSensitive`/`collectFieldNames`/`list_fields` already pass them
through untouched. But `query_entries` returns every other field on each
row too (Account, Proxy, Country, dates, ~15+ irrelevant fields), and its
25-default/50-max row cap limits how much real text a comparison can draw
on. Confirmed with the user: build a focused new tool anyway rather than
just improving `query_entries`'s discoverability, since a tuned interface
returning only `{brand, text}` per row is meaningfully more token-efficient
for this specific task and gives one clear place to document the text-
quality caveats above so the model doesn't mistake scraper noise for a real
signal.

## Design

### New tool: `get_review_texts`

```
get_review_texts({ tab?: string, platform: 'tp'|'ag'|'cg'|'wo', status: string, limit?: number })
→ { reviews: { brand: string, text: string }[], total: number }
```

- `platform` is **required and single** (not an array/combinable list like
  `get_score_summary`/`get_success_rate_by_field`) — TrustPilot/
  AskGamblers/CasinoGuru/Wizard of Odds reviews have different formats and
  audiences, so mixing them into one text sample would muddy a content
  comparison rather than help it. The model calls the tool again with a
  different `platform` if it wants a cross-platform view.
- `status` is **required**, using the exact same literal vocabulary
  `query_entries` already uses ("Published", "Removed", "Refused", "Not
  Done", "On Pause") — one status per call. Confirmed with the user: the
  model orchestrates a comparison by calling this tool twice (once per
  status), the same way it already orchestrates multi-platform comparisons
  today, rather than the tool doing status-balancing internally.
- `tab` is **optional** (omit = across all tabs), matching
  `get_score_summary`/`get_success_rate_by_field`'s existing pattern —
  unlike `get_schedule`, which requires `tab` because its data model is
  inherently tab+week scoped, a content-comparison question isn't
  naturally tab-scoped and the model should be able to ask across the
  whole dataset.
- `limit` optional, default 20, max 50 — matches `query_entries`'s cap
  convention. Each returned row is only `{brand, text}` (no other fields),
  so this is far more token-efficient per row than `query_entries` would
  be for the same task.
- Rows with no recorded text for the requested platform are silently
  skipped (nothing to compare).
- Brands flagged removed on the requested platform (`removed_platform_brands`)
  are excluded, matching `get_score_summary`/`get_success_rate_by_field`'s
  existing exclusion and the standing cross-dashboard-consistency rule.
- Status matching is **exact**, using the already-exported
  `PLATFORM_STATUS_KEYS[platform]` (platform-scoped, more precise than
  `query_entries`'s own status filter, which has no platform argument to
  scope by and falls back to a generic key list) — this tool can be more
  correct than `query_entries` here specifically because it already
  requires an explicit `platform` argument.
- Each review's text is capped at 2000 characters (`REVIEW_TEXT_MAX_CHARS`),
  appending `" […truncated]"` when cut, as a safety net against a single
  data-quality outlier consuming the whole token budget.
- `total` is the real match count **before** the `limit` cap, so the model
  can tell the user "showing 20 of 63" rather than presenting a capped
  sample as exhaustive — matches `query_entries`'s existing
  `distinctValues`-vs-returned-groups convention.
- An empty `reviews` array is a valid, non-error answer (e.g. no Removed
  reviews exist for that platform/tab) — not distinguished from "no data
  exists" any more than `get_schedule`'s existing empty-result convention
  already isn't.

### Implementation

New pure, testable function in `tools.ts` (same convention as
`successRateByField`/`scoreSummary`):

```ts
export interface ReviewTextRow {
  brand: string;
  text: string;
}

const REVIEW_TEXT_MAX_CHARS = 2000;

// Ported from src/lib/scoreSummary.ts's PLATFORM_REVIEW_TEXT_KEYS — keep in
// sync manually if either changes, same convention as this file's other
// ported constants (FIELD_KEYS, PLATFORM_STATUS_KEYS).
const PLATFORM_REVIEW_TEXT_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Text'],
  ag: ['AG Review Text'],
  cg: ['CG Review Text'],
  wo: ['WO Review Text'],
};

export function reviewTextsByStatus(
  entries: EntryRow[],
  platform: Platform,
  status: string,
  removedPlatformBrands: Set<string> = new Set(),
): { reviews: ReviewTextRow[]; total: number } {
  const wantStatus = status.trim().toLowerCase();
  const results: ReviewTextRow[] = [];
  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (brand && removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
    const haveStatus = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
    if (haveStatus !== wantStatus) continue;
    const text = pick(e.data, PLATFORM_REVIEW_TEXT_KEYS[platform]);
    if (!text) continue;
    const truncated = text.length > REVIEW_TEXT_MAX_CHARS
      ? text.slice(0, REVIEW_TEXT_MAX_CHARS) + ' […truncated]'
      : text;
    results.push({ brand, text: truncated });
  }
  return { reviews: results, total: results.length };
}
```

`runTool`'s new branch (placed alongside the other `entries`-querying
branches, after `get_paused_combos`):

```ts
if (name === 'get_review_texts') {
  if (!args?.platform || !args?.status) {
    return { error: 'platform and status are both required.' };
  }
  const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
  if (!validPlatforms.includes(args.platform)) {
    return { error: `platform must be one of: ${validPlatforms.join(', ')}` };
  }
  let q = supabase.from('entries').select('id, tab, data');
  if (args?.tab) q = q.eq('tab', args.tab);
  const [{ data, error }, removedSet] = await Promise.all([q, fetchRemovedPlatformBrandSet(supabase)]);
  if (error) throw error;
  const { reviews, total } = reviewTextsByStatus(data ?? [], args.platform, args.status, removedSet);
  const limit = Math.min(Number(args?.limit) || 20, 50);
  return { reviews: reviews.slice(0, limit), total };
}
```

`TOOL_DEFS` entry (placed alongside `get_paused_combos`):

```ts
{
  type: 'function',
  function: {
    name: 'get_review_texts',
    description:
      'Returns real review text for a platform + status, for reading and comparing content ' +
      '(e.g. "what tends to separate a Published TrustPilot review from a Removed one?"). ' +
      'One platform and one status per call — call it again with a different status (or ' +
      'platform) to compare groups; results are never combined across platforms since each ' +
      'has a different review format/audience. status uses the same values as query_entries ' +
      '("Published", "Removed", "Refused", "Not Done", "On Pause"). Rows with no recorded text ' +
      'for that platform are skipped, and brands flagged removed on that platform (see ' +
      'get_removed_platform_flags) are excluded. Known data-quality caveats to keep in mind ' +
      'when reading results: TrustPilot text can occasionally be a review title rather than ' +
      'the body; AskGamblers text can carry a trailing "Helpful (N)" vote-count line; ' +
      'CasinoGuru text can carry an appended casino owner-reply, or be missing entirely on an ' +
      'ambiguous page match — treat these as scraper noise, not a real content signal. Each ' +
      'review is capped at 2000 characters (flagged with " […truncated]" if cut). total is ' +
      'the real match count before the limit cap, so a capped result should be presented as ' +
      '"showing N of total", not as exhaustive.',
    parameters: {
      type: 'object',
      properties: {
        tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
        platform: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] },
        status: { type: 'string', description: 'exact status value, e.g. "Published" or "Removed" — same vocabulary as query_entries' },
        limit: { type: 'number', description: 'max reviews to return, default 20, max 50' },
      },
      required: ['platform', 'status'],
    },
  },
},
```

No `deno.json`/import-map change needed — this adds no new import, only a
local constant next to the file's existing `FIELD_KEYS`/`PLATFORM_STATUS_KEYS`
pattern.

## Out of scope

- The "eventual" trend-spotting/proactive-suggestions system — a separate,
  later brainstorm.
- Any change to `query_entries`, `list_fields`, or the system prompt beyond
  this one new tool definition.
- Sentiment scoring, keyword extraction, or any other code-side text
  analysis — the model reads and analyzes the raw text itself in its
  response, per the user's explicit choice over building deterministic NLP.
- Any change to how review text is fetched/stored/displayed on the
  dashboard itself (`ReviewTextBlock.tsx`, the EC2 scraper, etc.) — this is
  read-only from the assistant's side.
- Deployment (`supabase functions deploy ai-assistant`) — a separate,
  explicitly-confirmed manual step each time, per this project's now-
  standing practice.

## Testing approach

TDD, per project standard, mirroring this file's existing test structure
for `successRateByField`/`get_schedule`:

1. `reviewTextsByStatus` unit tests: matches platform+status exactly;
   skips a row with blank/missing text for that platform; excludes a
   brand flagged removed on that platform (and does NOT exclude it for a
   different platform, mirroring the existing removed-brand test pattern);
   truncates text over 2000 characters with the marker, leaves shorter
   text untouched.
2. `get_review_texts` `runTool` tests (via `mockSupabaseTables`): returns
   `{brand, text}` rows for a matching tab/platform/status; returns an
   error when `platform` or `status` is omitted; returns an error for an
   invalid `platform` value; `total` reflects the real match count even
   when `reviews` is capped by `limit`; an empty match set returns
   `{reviews: [], total: 0}`, not an error.
3. `deno check tools.ts index.ts` and `deno test --allow-env --allow-net`
   (from `supabase/functions/ai-assistant/`) both pass.
4. No `npm run build` needed — no frontend files touched.
