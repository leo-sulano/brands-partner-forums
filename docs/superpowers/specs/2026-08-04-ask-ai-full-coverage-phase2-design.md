# Ask AI Full Coverage — Phase 2: Score Summary Metrics

## Problem

Today's `get_score_summary` tool (`supabase/functions/ai-assistant/tools.ts`) is a
Published-only star-rating rollup, hardcoded to TrustPilot's key set and 1-5 score
range, with no Success Rate. The dashboard's real Score Summary page
(`src/lib/scoreSummary.ts`'s `computeScoreSummary`/`computeSuccessRates`) shows
both star ratings *and* live/removed Success Rate, per brand, for any of the 4
platforms (TrustPilot, AskGamblers, CasinoGuru, Wizard of Odds). So a question like
"what's Rooster Partners' AskGamblers success rate?" currently can't be answered
correctly — the tool doesn't know AG exists, and even for TP-only tabs it never
computes a success rate at all.

This is Phase 2 of a 4-phase plan. Phase 1 (credential redaction, broadened
`query_entries`, `get_success_rate_by_field` for proxy/agent/country) is already
shipped on `main`. Phase 3 (TP/AG/CG/WO-removed brand flags) and Phase 4 (Schedule
Planner state) remain separate, future specs.

## Design

### Platform-aware constants (ported from `src/lib/scoreSummary.ts`)

```ts
export type Platform = 'tp' | 'ag' | 'cg' | 'wo';

export const PLATFORM_STATUS_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status'],
  ag: ['AG Review Status'],
  cg: ['CG Review Status'],
  wo: ['WoO Review Status'],
};

const PLATFORM_SCORE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: ['AG Score added'],
  cg: ['CG Score added'],
  wo: ['Wizard of OddsScore added'],
};

const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5, wo: 5 };
```

These are exact copies of `scoreSummary.ts`'s definitions (`PLATFORM_STATUS_KEYS`
is already partially duplicated in this file from Phase 1's fix wave as
`SUCCESS_RATE_STATUS_KEYS` for a different tool — that stays untouched, this is a
separate, properly-typed constant for this tool). `Platform` is a fresh local type;
this Deno function has no access to the main app's TypeScript modules, so it can't
import the real one.

### `parseScore` gains a `maxScore` parameter — a real bug fix, not just plumbing

Current signature: `parseScore(raw: string | null | undefined): Star | null`,
hardcoded via `/^[1-5]$/` — every AskGamblers score of 6-10 is currently
misclassified as unrated by anything that calls it. Since Phase 2 requires AG
support to work at all, this is fixed here:

```ts
export function parseScore(raw: string | null | undefined, maxScore: number = 5): Star | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored < 1 || floored > maxScore) return null;
  return floored;
}
```

`maxScore` defaults to `5`, so the existing test (`parseScore('4')` → `4`,
`parseScore('0')` → `null`, `parseScore('x')` → `null`) keeps passing unchanged —
this is a backward-compatible signature extension, not a breaking change.

### `ratingLabel`, ported unchanged from `scoreSummary.ts`

```ts
export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';

export function ratingLabel(avg: number | null, maxScore: number = 5): RatingLabel | null {
  if (avg == null) return null;
  const k = maxScore / 5;
  if (avg >= 4.5 * k) return 'Excellent';
  if (avg >= 4.0 * k) return 'Great';
  if (avg >= 3.0 * k) return 'Average';
  if (avg >= 2.0 * k) return 'Poor';
  if (avg >= 1.0) return 'Bad';
  return null;
}
```

### `scoreSummary()` — merged star + success-rate computation

Rather than porting `computeScoreSummary` and `computeSuccessRates` as two separate
passes (as the frontend does, since it needs them independently for different UI
elements), this tool computes both in one pass per brand — the assistant only ever
needs the combined view. The existing `scoreSummary` function's signature and
return shape change:

```ts
export interface BrandScoreSummary {
  tab: string;
  brand: string;
  counts: Record<number, number>;
  unrated: number;
  total: number;
  rated: number;
  average: number | null;
  label: RatingLabel | null;
  live: number;
  removed: number;
  successRate: number | null;
}

export function scoreSummary(entries: EntryRow[], platform: Platform = 'tp'): BrandScoreSummary[] {
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const scoreKeys = PLATFORM_SCORE_KEYS[platform];
  const maxScore = PLATFORM_MAX_SCORE[platform];

  interface Bucket {
    tab: string;
    brand: string;
    counts: Record<number, number>;
    unrated: number;
    live: number;
    removed: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;
    const status = (pick(e.data, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;

    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      const counts: Record<number, number> = {};
      for (let i = 1; i <= maxScore; i++) counts[i] = 0;
      b = { tab: e.tab, brand, counts, unrated: 0, live: 0, removed: 0 };
      buckets.set(key, b);
    }

    if (isLiveStatus(status)) b.live += 1;
    else if (isRemovedStatus(status)) b.removed += 1;

    if (status !== 'published') continue;
    const score = parseScore(pick(e.data, scoreKeys), maxScore);
    if (score == null) b.unrated += 1;
    else b.counts[score] += 1;
  }

  return [...buckets.values()].map((b) => {
    let rated = 0;
    let weighted = 0;
    for (let i = 1; i <= maxScore; i++) {
      rated += b.counts[i];
      weighted += i * b.counts[i];
    }
    const total = rated + b.unrated;
    const average = rated === 0 ? null : Math.round((weighted / rated) * 10) / 10;
    const label = ratingLabel(average, maxScore);
    const successTotal = b.live + b.removed;
    const successRate = successTotal === 0 ? null : (b.live / successTotal) * 100;
    return {
      tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated,
      total, rated, average, label, live: b.live, removed: b.removed, successRate,
    };
  });
}
```

Bucket-creation gate is preserved exactly from `computeScoreSummary`: a brand gets
a row from *any* resolvable status (not just Published), so a brand that's
entirely Removed/Refused still appears — with `rated: 0`, `average: null`, but a
real (likely low) `successRate` — rather than silently vanishing from results.
`isLiveStatus`/`isRemovedStatus` (already ported in Phase 1) are reused unchanged.

### Tool definition and dispatch

`get_score_summary`'s `TOOL_DEFS` entry gains an optional `platform` parameter and
an updated description reflecting the new coverage:

```ts
{
  type: 'function',
  function: {
    name: 'get_score_summary',
    description:
      'Star-rating rollup (Published reviews only) AND live/removed Success Rate ' +
      'per brand, matching the dashboard\'s Score Summary page, for one platform: ' +
      'tp (TrustPilot, default), ag (AskGamblers), cg (CasinoGuru), or wo (Wizard ' +
      'of Odds). All-time only — no date-range filtering yet.',
    parameters: {
      type: 'object',
      properties: {
        tab: { type: 'string' },
        platform: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] },
      },
    },
  },
},
```

`runTool`'s `get_score_summary` branch defends against an invalid or missing
`platform` value by defaulting to `'tp'` (applying the lesson from Phase 1's final
review, which flagged the same unvalidated-enum-arg shape in
`get_success_rate_by_field` as a non-blocking but real gap — fixed proactively here
rather than repeating it):

```ts
if (name === 'get_score_summary') {
  let q = supabase.from('entries').select('id, tab, data');
  if (args?.tab) q = q.eq('tab', args.tab);
  const { data, error } = await q;
  if (error) throw error;
  const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
  const platform: Platform = validPlatforms.includes(args?.platform) ? args.platform : 'tp';
  return { brands: scoreSummary(data ?? [], platform) };
}
```

## Out of scope

- Date-range filtering (per confirmed decision — all-time only for this phase).
  `computeScoreSummary`/`computeSuccessRates` both accept an optional `DateRange`
  in the frontend; adding that here is a small, additive follow-on later, not
  needed now.
- Excluding TP/AG/CG/WO-removed-flagged brands (`removed_platform_brands`) — that
  table belongs to Phase 3. This phase's `scoreSummary` does not accept a
  `removedPlatformBrands` parameter at all (not even an unused one) — Phase 3 adds
  it when it has a real set to pass.
- No file split of `tools.ts` (382 lines before this phase, ~480 after) — still a
  reasonable size for one Deno module; reconsider if Phase 3/4 push it much
  larger.
- No system prompt changes — the model reads tool descriptions directly from
  `TOOL_DEFS`, and Phase 1 already established the pattern of not restating tool
  capabilities in `SYSTEM_PROMPT` for tools not causing wrong refusals.
- `get_success_rate_by_field` (Phase 1) is untouched — different tool, different
  purpose (proxy/agent/country grouping vs. brand-level star+success rollup).

## Testing

- Backward-compat: existing `parseScore('4')`/`parseScore('0')`/`parseScore('x')`
  and the existing `scoreSummary` test (`Brand: 'A'`, `'Review Status': 'Published'`
  → `rated: 1, average: 5`) must keep passing unchanged with no test edits — proves
  the signature extensions are truly additive.
- `parseScore('8', 10)` → `8` (AG's wider range now works; would have been `null`
  under the old hardcoded 1-5 regex).
- A brand with only `'AG Review Status': 'Removed'` rows (no TP status key at all)
  grouped with `platform: 'ag'` appears in results with `live: 0`, `removed: N`,
  `successRate: 0`, `rated: 0`, `average: null` — proves the "any status creates a
  bucket" gate and platform isolation (a TP status key on the same tab must not
  leak into an AG-scoped query).
- `runTool('get_score_summary', { platform: 'not-a-real-platform' })` defaults to
  `tp` instead of throwing — mirrors Phase 1's `get_success_rate_by_field` fix.
- `ratingLabel` boundary cases at each of the 5 label thresholds, for both
  `maxScore: 5` (TP/CG/WO) and `maxScore: 10` (AG) scales.
