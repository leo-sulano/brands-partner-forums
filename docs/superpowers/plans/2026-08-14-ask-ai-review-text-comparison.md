# Ask AI Review Text Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `get_review_texts` tool to Ask AI (`supabase/functions/ai-assistant/`) so it can read real review text (grouped by platform + status) on request, letting the model compare Published vs Removed content itself when asked a content-improvement question.

**Architecture:** One new pure, testable function (`reviewTextsByStatus`) filters/truncates review text from already-fetched entries, following the exact pattern `successRateByField`/`scoreSummary` already use in this file. One new `runTool` branch wires it to a Supabase query (tab-optional, platform+status required). One new `TOOL_DEFS` entry documents it for the model, including the known per-platform text-quality caveats. No new imports, no schema change.

**Tech Stack:** Deno, TypeScript, `Deno.test` (std assert), Supabase Edge Functions.

**Spec:** `docs/superpowers/specs/2026-08-14-ask-ai-review-text-comparison-design.md`

## Global Constraints

- No deploy: code lands committed only. Do not run `supabase functions deploy ai-assistant`.
- No schema changes.
- No changes to `query_entries`, `list_fields`, or the system prompt.
- No code-side text analysis (sentiment, keyword extraction) — the model reads and analyzes the raw text itself.
- Verify with `deno check` and `deno test --allow-env --allow-net` (run from `supabase/functions/ai-assistant/`). No `npm run build` needed — no frontend files touched.

---

### Task 1: `get_review_texts` tool (pure function + runTool branch + schema)

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (insert new constant + function at line 468, before `// --- OpenAI tool schemas ---`; insert new `runTool` branch at line 805-806, before the final `return { error: ... }`; insert new `TOOL_DEFS` entry at line 668, right after the `get_paused_combos` entry closes)
- Test: `supabase/functions/ai-assistant/tools_test.ts` (add import; append tests at the end of the file, currently line 1020)

**Interfaces:**
- Consumes (already exist in `tools.ts`, no changes needed): `pick(data, keys): string | null`; `BRAND_KEYS: string[]` (line 92); `PLATFORM_STATUS_KEYS: Record<Platform, readonly string[]>` (line 115); `platformRemovedKey(tab, brand, platform): string`; `fetchRemovedPlatformBrandSet(supabase): Promise<Set<string>>`; `type Platform = 'tp' | 'ag' | 'cg' | 'wo'` (line 113).
- Produces: `export interface ReviewTextRow { brand: string; text: string }`; `export function reviewTextsByStatus(entries: EntryRow[], platform: Platform, status: string, removedPlatformBrands?: Set<string>): { reviews: ReviewTextRow[]; total: number }`. Nothing else in this plan consumes these — this is the only task.

- [ ] **Step 1: Write the failing tests**

Add `reviewTextsByStatus` to the import list at the top of `supabase/functions/ai-assistant/tools_test.ts` (currently lines 3-22):

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
  normalizeBrandKey,
  platformRemovedKey,
  buildRemovedPlatformBrandSet,
  isSensitiveField,
  collectFieldNames,
  matchesFieldFilters,
  groupByField,
  reviewTextsByStatus,
  EntryRow,
} from './tools.ts';
```

Append the following at the very end of `tools_test.ts` (after the existing last test, `'list_fields caps the underlying entries scan instead of pulling every row'`):

```ts
Deno.test('reviewTextsByStatus returns matching platform+status rows with brand and text', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'TP Review Status': 'Published', 'TP Review Text': 'Great service, fast payout.' } },
    { id: '2', tab: 't', data: { Brand: 'B', 'TP Review Status': 'Removed', 'TP Review Text': 'Terrible, avoid.' } },
    { id: '3', tab: 't', data: { Brand: 'C', 'AG Review Status': 'Published', 'AG Review Text': 'Different platform, should not match.' } },
  ];
  const out = reviewTextsByStatus(entries, 'tp', 'Published');
  assertEquals(out.total, 1);
  assertEquals(out.reviews, [{ brand: 'A', text: 'Great service, fast payout.' }]);
});

Deno.test('reviewTextsByStatus skips a row with no recorded text for the platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'TP Review Status': 'Published' } },
  ];
  const out = reviewTextsByStatus(entries, 'tp', 'Published');
  assertEquals(out.reviews.length, 0);
  assertEquals(out.total, 0);
});

Deno.test('reviewTextsByStatus excludes a brand flagged removed on that platform, not on a different platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'TP Review Status': 'Published', 'TP Review Text': 'Text A' } },
    { id: '2', tab: 't', data: { Brand: 'A', 'AG Review Status': 'Published', 'AG Review Text': 'Text A on AG' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'A', platform: 'tp' }]);
  const tpOut = reviewTextsByStatus(entries, 'tp', 'Published', removedSet);
  assertEquals(tpOut.reviews.length, 0);
  const agOut = reviewTextsByStatus(entries, 'ag', 'Published', removedSet);
  assertEquals(agOut.reviews.length, 1);
});

Deno.test('reviewTextsByStatus truncates text over 2000 characters and flags it, leaves shorter text untouched', () => {
  const longText = 'x'.repeat(2500);
  const shortText = 'a normal review';
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'A', 'TP Review Status': 'Published', 'TP Review Text': longText } },
    { id: '2', tab: 't', data: { Brand: 'B', 'TP Review Status': 'Published', 'TP Review Text': shortText } },
  ];
  const out = reviewTextsByStatus(entries, 'tp', 'Published');
  const truncated = out.reviews.find((r) => r.brand === 'A')!;
  assertEquals(truncated.text.length, 2000 + ' […truncated]'.length);
  assertEquals(truncated.text.endsWith(' […truncated]'), true);
  const untouched = out.reviews.find((r) => r.brand === 'B')!;
  assertEquals(untouched.text, shortText);
});

Deno.test('get_review_texts returns brand+text rows for a matching tab/platform/status', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: { Brands: 'Lucky7even', 'TP Review Status': 'Published', 'TP Review Text': 'Solid platform.' } },
      { id: '2', tab: 'Hanan', data: { Brands: 'Pribet.com', 'TP Review Status': 'Published', 'TP Review Text': 'Should not appear (different tab).' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { tab: 'Rooster Partners', platform: 'tp', status: 'Published' });
  assertEquals(result.reviews, [{ brand: 'Lucky7even', text: 'Solid platform.' }]);
  assertEquals(result.total, 1);
});

Deno.test('get_review_texts requires platform and status', async () => {
  const tables = { entries: [] };
  const missingPlatform: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { status: 'Published' });
  assertEquals(typeof missingPlatform.error, 'string');
  const missingStatus: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { platform: 'tp' });
  assertEquals(typeof missingStatus.error, 'string');
});

Deno.test('get_review_texts rejects an invalid platform value', async () => {
  const tables = { entries: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { platform: 'xyz', status: 'Published' });
  assertEquals(typeof result.error, 'string');
});

Deno.test('get_review_texts total reflects the real match count even when limit caps the returned reviews', async () => {
  const entries: EntryRow[] = [];
  for (let i = 0; i < 5; i++) {
    entries.push({ id: String(i), tab: 't', data: { Brands: `Brand${i}`, 'TP Review Status': 'Published', 'TP Review Text': `Review ${i}` } });
  }
  const tables = { entries, removed_platform_brands: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { platform: 'tp', status: 'Published', limit: 2 });
  assertEquals(result.reviews.length, 2);
  assertEquals(result.total, 5);
});

Deno.test('get_review_texts returns an empty array, not an error, when nothing matches', async () => {
  const tables = { entries: [], removed_platform_brands: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_texts', { platform: 'tp', status: 'Removed' });
  assertEquals(result.reviews, []);
  assertEquals(result.total, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd supabase/functions/ai-assistant && deno test --allow-env --allow-net`
Expected: FAIL — the whole file fails to type-check/load with an error like `has no exported member 'reviewTextsByStatus'` or `Uncaught ReferenceError: reviewTextsByStatus is not defined`. This is the correct RED state: the function doesn't exist yet, so the import itself fails before any individual test can run. Proceed to implement.

- [ ] **Step 3: Implement**

In `supabase/functions/ai-assistant/tools.ts`, insert the following immediately after `scoreSummary`'s closing `}` (currently line 468) and before the `// --- OpenAI tool schemas ---` comment (currently line 470):

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

In the same file, insert a new `TOOL_DEFS` entry immediately after the `get_paused_combos` entry's closing `},` (currently line 668, right before the array's closing `];` at line 669):

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

Finally, insert a new `runTool` branch right before the function's final `return { error: ... }` line (currently `return { paused: filterHiddenOrRestricted(data ?? [], hiddenSet, restrictionMap, removedSet) };` at line 805, followed by the closing `}` for the `get_paused_combos` block at line 806, then `return { error: ... }` at line 807):

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

Place this new `if` block immediately after the `get_paused_combos` block's closing `}` and before the final `return { error: \`unknown tool: ${name}\` };` line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd supabase/functions/ai-assistant && deno check tools.ts index.ts && deno test --allow-env --allow-net`
Expected: `deno check` reports no errors on both files. All tests pass — 82 pre-existing + 9 new (4 `reviewTextsByStatus` unit tests + 5 `get_review_texts` `runTool` tests) = 91 total, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat(ai-assistant): add get_review_texts tool for Published-vs-Removed content comparison"
```

---

## Self-Review Notes

- **Spec coverage:** the spec's entire Design section (interface shape, `reviewTextsByStatus`, the `runTool` branch, the `TOOL_DEFS` entry, exclusion of flagged-removed brands, truncation, `total`-before-cap semantics) is covered by this single task — there's nothing else in the spec's scope to build (the "eventual" trend-spotting piece is explicitly out of scope, confirmed with the user during brainstorming).
- **Placeholder scan:** none found — every step has literal file paths, exact line-number anchors, and exact code.
- **Type consistency:** `reviewTextsByStatus`'s signature (`entries: EntryRow[], platform: Platform, status: string, removedPlatformBrands?: Set<string>`) matches how it's called from the new `runTool` branch (`reviewTextsByStatus(data ?? [], args.platform, args.status, removedSet)`) and from the tests (both the 3-arg and 4-arg call forms, matching the default parameter). `ReviewTextRow`'s `{brand: string, text: string}` shape matches every test's assertions and the `TOOL_DEFS` description's stated return shape.
