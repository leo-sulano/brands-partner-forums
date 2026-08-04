# Ask AI Full Coverage — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `get_score_summary` from a TrustPilot-only, stars-only rollup into a platform-aware tool (TrustPilot/AskGamblers/CasinoGuru/Wizard of Odds) that also reports live/removed Success Rate per brand, matching what the dashboard's real Score Summary page shows.

**Architecture:** All changes are in `supabase/functions/ai-assistant/tools.ts` (plus its tests) — no new files. Platform-aware key constants and a `maxScore`-aware `parseScore` are ported from `src/lib/scoreSummary.ts`. The existing `scoreSummary()` pure function is rewritten to compute stars and success rate in one pass, keyed by an explicit `platform` parameter that defaults to `'tp'` for full backward compatibility with existing callers/tests.

**Tech Stack:** Deno, TypeScript, `deno test` + `https://deno.land/std@0.224.0/assert/mod.ts`. No new dependencies.

## Global Constraints

- `parseScore`'s new `maxScore` parameter defaults to `5`, so the existing test (`parseScore('4')` → `4`, `parseScore('0')` → `null`, `parseScore('x')` → `null`) must keep passing with **zero edits** to that test.
- The existing `scoreSummary` test (`Brand: 'A'`, `'Review Status': 'Published'` → `rated: 1, average: 5`) must keep passing with **zero edits** — `scoreSummary`'s new `platform` parameter defaults to `'tp'`.
- Platform constants (`PLATFORM_STATUS_KEYS`, `PLATFORM_SCORE_KEYS`, `PLATFORM_MAX_SCORE`) are exact copies of `src/lib/scoreSummary.ts`'s definitions — copy verbatim, do not paraphrase.
- Do NOT modify the existing `STATUS_KEYS`, `SUCCESS_RATE_STATUS_KEYS`, `SCORE_KEYS`, or `successRateByField` — those belong to a different tool (`get_success_rate_by_field`, from Phase 1) and are out of scope here.
- `scoreSummary`'s bucket-creation gate: a brand gets a result row from ANY resolvable status (not just `'published'`) — a brand that's entirely Removed/Refused must still appear in results, with `rated: 0`, `average: null`, `label: null`, but a real `live`/`removed`/`successRate`.
- No `removedPlatformBrands` parameter — Phase 3 owns that, not this phase.
- No date-range filtering — all-time only.
- Test runner: `deno test supabase/functions/ai-assistant/tools_test.ts` (confirmed working baseline before this plan's changes: 16 tests passing).

---

### Task 1: Platform-aware `get_score_summary`

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
- Modify: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `pick`, `BRAND_KEYS`, `isLiveStatus`, `isRemovedStatus`, `EntryRow` (all already defined in `tools.ts` from earlier phases).
- Produces: `type Platform = 'tp' | 'ag' | 'cg' | 'wo'`, `parseScore(raw: string | null | undefined, maxScore?: number): number | null`, `type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad'`, `ratingLabel(avg: number | null, maxScore?: number): RatingLabel | null`, `interface BrandScoreSummary { tab: string; brand: string; counts: Record<number, number>; unrated: number; total: number; rated: number; average: number | null; label: RatingLabel | null; live: number; removed: number; successRate: number | null; }`, `scoreSummary(entries: EntryRow[], platform?: Platform): BrandScoreSummary[]` — all exported from `tools.ts`. This is the final task in Phase 2; nothing downstream in this plan depends on these beyond the tool wiring in this same task.

- [ ] **Step 1: Write the failing tests**

Add `ratingLabel` to the existing import block at the top of `tools_test.ts` (currently lines 3-14) — change:

```ts
import {
  pick,
  parseScore,
  mapEntrySummary,
  entryMatches,
  matchesStatus,
  scoreSummary,
  redactSensitive,
  runTool,
  successRateByField,
  EntryRow,
} from './tools.ts';
```

to:

```ts
import {
  pick,
  parseScore,
  mapEntrySummary,
  entryMatches,
  matchesStatus,
  scoreSummary,
  redactSensitive,
  runTool,
  successRateByField,
  ratingLabel,
  EntryRow,
} from './tools.ts';
```

Do NOT change the existing `parseScore accepts 1-5 only` test (lines 21-25) or the existing `scoreSummary counts Published only` test (lines 39-48) — leave both exactly as they are.

Add these new tests at the end of the file (after the last existing test, `successRateByField picks up AG Review Status and CG Review Status (multi-platform tabs)`):

```ts
Deno.test('parseScore respects a custom maxScore and floors fractional values', () => {
  assertEquals(parseScore('8', 10), 8);
  assertEquals(parseScore('11', 10), null);
  assertEquals(parseScore('4.7'), 4);
  assertEquals(parseScore('0', 10), null);
});

Deno.test('ratingLabel maps average to a qualitative label, scaled by maxScore', () => {
  assertEquals(ratingLabel(4.5), 'Excellent');
  assertEquals(ratingLabel(4.0), 'Great');
  assertEquals(ratingLabel(3.0), 'Average');
  assertEquals(ratingLabel(2.0), 'Poor');
  assertEquals(ratingLabel(1.0), 'Bad');
  assertEquals(ratingLabel(null), null);
  assertEquals(ratingLabel(9.0, 10), 'Excellent');
  assertEquals(ratingLabel(8.0, 10), 'Great');
});

Deno.test('scoreSummary is platform-aware and supports AskGamblers 1-10 scores', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'AG Review Status': 'Published', 'AG Score added': '8' } },
    { id: '2', tab: 't', data: { Brand: 'A', 'AG Review Status': 'Removed' } },
    // A TP status key on the same tab/brand must NOT leak into an AG-scoped query.
    { id: '3', tab: 't', data: { Brand: 'A', 'Review Status': 'Published', 'Score added': '2' } },
  ];
  const out = scoreSummary(entries, 'ag');
  assertEquals(out.length, 1);
  assertEquals(out[0].rated, 1);
  assertEquals(out[0].average, 8);
  assertEquals(out[0].live, 1);
  assertEquals(out[0].removed, 1);
  assertEquals(out[0].successRate, 50);
});

Deno.test('scoreSummary creates a bucket for a brand with only Removed entries (no stars, but a real success rate)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'B', 'Review Status': 'Removed' } },
    { id: '2', tab: 't', data: { Brand: 'B', 'Review Status': 'Refused' } },
  ];
  const out = scoreSummary(entries);
  assertEquals(out.length, 1);
  assertEquals(out[0].rated, 0);
  assertEquals(out[0].average, null);
  assertEquals(out[0].live, 0);
  assertEquals(out[0].removed, 2);
  assertEquals(out[0].successRate, 0);
});

Deno.test('get_score_summary defaults to tp platform when given an invalid value', async () => {
  const rows: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'C', 'Review Status': 'Published', 'Score added': '3' } },
  ];
  const result: any = await runTool(mockSupabase(rows), 'get_score_summary', { platform: 'not-a-real-platform' });
  assertEquals(result.brands.length, 1);
  assertEquals(result.brands[0].average, 3);
});
```

The last test reuses the existing `mockSupabase` helper already defined in this file (around line 103) — do not redeclare it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — `ratingLabel` is not exported from `./tools.ts` (import error), and the other new tests fail because `scoreSummary` doesn't yet accept a `platform` argument, `parseScore` doesn't yet accept a `maxScore` argument, and `get_score_summary`'s `runTool` branch doesn't yet read `args?.platform`.

- [ ] **Step 3: Implement the platform-aware constants, `parseScore`, `ratingLabel`, and rewritten `scoreSummary`**

In `supabase/functions/ai-assistant/tools.ts`, insert after the existing `DATE_KEYS` constant (currently ending at line 56) and before `export type Star = 1 | 2 | 3 | 4 | 5;` (currently line 58):

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

Replace `export type Star = 1 | 2 | 3 | 4 | 5;` (line 58) with:

```ts
export type Star = number;
```

Replace the `parseScore` function (currently lines 60-65):

```ts
export function parseScore(raw: string | null | undefined): Star | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^[1-5]$/.test(s)) return null;
  return Number(s) as Star;
}
```

with:

```ts
export function parseScore(raw: string | null | undefined, maxScore: number = 5): Star | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored < 1 || floored > maxScore) return null;
  return floored;
}

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

Replace the entire `scoreSummary` function (currently lines 219-253):

```ts
// Published-only star rollup, grouped by `${tab} ${brand}`. Mirrors computeScoreSummary.
export function scoreSummary(entries: EntryRow[]) {
  const buckets = new Map<
    string,
    { tab: string; brand: string; counts: Record<Star, number>; unrated: number }
  >();
  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;
    const status = (pick(e.data, STATUS_KEYS) ?? '').trim().toLowerCase();
    if (status !== 'published') continue;
    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      b = { tab: e.tab, brand, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, unrated: 0 };
      buckets.set(key, b);
    }
    const sc = parseScore(pick(e.data, SCORE_KEYS));
    if (sc == null) b.unrated += 1;
    else b.counts[sc] += 1;
  }
  return [...buckets.values()].map((b) => {
    const rated = b.counts[1] + b.counts[2] + b.counts[3] + b.counts[4] + b.counts[5];
    const total = rated + b.unrated;
    const average =
      rated === 0
        ? null
        : Math.round(
            ((b.counts[1] + 2 * b.counts[2] + 3 * b.counts[3] + 4 * b.counts[4] + 5 * b.counts[5]) /
              rated) *
              10,
          ) / 10;
    return { tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated, rated, total, average };
  });
}
```

with:

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

// Star rollup (Published-only) AND live/removed Success Rate, grouped by
// `${tab} ${brand}`, computed in one pass per platform. Mirrors
// computeScoreSummary + computeSuccessRates in src/lib/scoreSummary.ts, merged
// into a single result since the assistant only ever needs the combined view.
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

- [ ] **Step 4: Update the tool definition and dispatch**

In `TOOL_DEFS`, replace the `get_score_summary` entry (currently):

```ts
  {
    type: 'function',
    function: {
      name: 'get_score_summary',
      description: 'Published-only star-rating rollup per brand, optionally filtered to one tab.',
      parameters: { type: 'object', properties: { tab: { type: 'string' } } },
    },
  },
```

with:

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

In `runTool`, replace the `get_score_summary` branch (currently):

```ts
  if (name === 'get_score_summary') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { brands: scoreSummary(data ?? []) };
  }
```

with:

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: all tests pass, including the 5 new ones and the 2 pre-existing `parseScore`/`scoreSummary` tests unchanged (21 total, up from 16).

- [ ] **Step 6: Run `deno check` on the whole function**

Run: `deno check supabase/functions/ai-assistant/index.ts` and `deno check supabase/functions/ai-assistant/tools.ts`
Expected: no errors — confirms `Star = number` and the widened `BrandScoreSummary.counts: Record<number, number>` don't break any other type usage in the file (e.g. `index.ts` doesn't reference `Star` or `BrandScoreSummary` directly, so this should be a formality, but run it to be sure).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "$(cat <<'EOF'
feat: platform-aware get_score_summary with Success Rate

get_score_summary was hardcoded to TrustPilot and stars-only. Now
takes an optional platform param (tp/ag/cg/wo) and reports live/
removed Success Rate alongside star ratings, matching the dashboard's
real Score Summary page. Along the way, fixes a real bug: parseScore
hardcoded a 1-5 regex, silently misclassifying every AskGamblers score
of 6-10 as unrated — it now takes a maxScore param (default 5, so
existing TP behavior is unchanged). Backward compatible: both
parseScore and scoreSummary's new parameters default to their prior
TP-only behavior, so no existing test needed to change.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** The spec's "Platform-aware constants" section maps to Task 1 Step 3's `PLATFORM_STATUS_KEYS`/`PLATFORM_SCORE_KEYS`/`PLATFORM_MAX_SCORE`. "`parseScore` gains a `maxScore` parameter" maps to Step 3's `parseScore` replacement. "`ratingLabel`, ported unchanged" maps to Step 3. "`scoreSummary()` — merged star + success-rate computation" maps to Step 3's `scoreSummary` replacement, including the exact bucket-creation gate ("any resolvable status creates a bucket"). "Tool definition and dispatch" maps to Step 4, including the invalid-platform-defaults-to-tp defensive check. The spec's "Testing" section's five bullets (backward-compat, AG range, any-status-bucket, invalid-platform, ratingLabel boundaries) map 1:1 to the five new tests in Step 1.
- **Placeholder scan:** No TBD/TODO; every step has literal, complete code — full replacement blocks for every modified function, not diffs or descriptions.
- **Type consistency:** `Platform` (Step 3) is used identically in `PLATFORM_STATUS_KEYS`/`PLATFORM_SCORE_KEYS`/`PLATFORM_MAX_SCORE`, `scoreSummary`'s parameter, and `runTool`'s `validPlatforms: Platform[]` array. `BrandScoreSummary` (Step 3) is the literal return element type of `scoreSummary`, and its field names (`live`, `removed`, `successRate`, `label`) are exactly what the new tests in Step 1 assert against. `ratingLabel`'s signature matches how `scoreSummary` calls it (`ratingLabel(average, maxScore)`) and how the new test calls it directly.
