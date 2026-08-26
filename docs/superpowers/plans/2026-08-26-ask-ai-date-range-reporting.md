# Ask AI Date-Range Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Ask AI real date-range support (week/month/year/custom range) across `query_entries`, `get_score_summary`, and `get_success_rate_by_field`, plus a new `get_performance_report` tool that returns a one-call period report (totals + per-brand breakdown), so it can answer "give me a performance report for last month" style questions.

**Architecture:** Hand-port a small, self-contained date-filter module (`PLATFORM_DATE_KEYS`, `parsePostDate`, `passesPlatformDateFilter`) into `supabase/functions/ai-assistant/tools.ts`, mirroring `src/lib/scoreSummary.ts`'s real functions exactly — following this file's own existing "port pure logic, don't cross-import the big file" policy (stated in its header comment; a large `src/lib`-rooted import chain broke a real deploy before, see CLAUDE.md). Every date-aware tool then reuses this one gate.

**Tech Stack:** Deno (Supabase Edge Function), TypeScript, `Deno.test`.

**Spec:** `docs/superpowers/specs/2026-08-26-ask-ai-date-range-reporting-design.md`

## Global Constraints

- Confined entirely to `supabase/functions/ai-assistant/` (`tools.ts`, `tools_test.ts`, `index.ts`). No schema/migration change. No frontend file touched.
- Every new/changed date-filter function is a hand-port of the equivalent real function in `src/lib/scoreSummary.ts` — same semantics, same "undated/unparseable row always passes a range" bias — with a comment cross-referencing the original (this file's existing convention).
- `date_from`/`date_to` are plain `YYYY-MM-DD` strings the model computes itself from the current-date system message (already established in `index.ts` for `get_schedule`'s `week_start`) — no new server-side natural-language date parsing.
- Run from `supabase/functions/ai-assistant/`:
  - Type check: `deno check tools.ts index.ts`
  - Tests: `deno test --allow-env --allow-net tools_test.ts`
  - Baseline (before this plan's changes): both clean, 118 tests passing.

---

### Task 1: Shared date gate (`PLATFORM_DATE_KEYS`, `parsePostDate`, `passesPlatformDateFilter`, `DateRangeArgs`)

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts:119-135`
- Test: `supabase/functions/ai-assistant/tools_test.ts` (append new tests; add to the existing import block)

**Interfaces:**
- Produces: `PLATFORM_DATE_KEYS: Record<Platform, readonly string[]>`, `parsePostDate(raw: string | null | undefined): Date | null`, `passesPlatformDateFilter(data: Record<string, any>, platform: Platform, fromISO?: string, toISO?: string): boolean`, `DateRangeArgs { from?: string; to?: string }` — all exported. Also two unexported helpers `startOfDay(d: Date): Date` / `endOfDay(d: Date): Date`, used by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to the `import { ... } from './tools.ts';` block near the top of `tools_test.ts` (alongside the existing names): `parsePostDate`, `passesPlatformDateFilter`.

Append these tests to `tools_test.ts` (anywhere after the import block, e.g. right after the existing `redactSensitive` tests around line 117):

```ts
Deno.test('parsePostDate accepts YYYY-MM-DD', () => {
  const d = parsePostDate('2026-05-11');
  assertEquals(d?.getFullYear(), 2026);
  assertEquals(d?.getMonth(), 4);
  assertEquals(d?.getDate(), 11);
});

Deno.test('parsePostDate accepts DD/MM/YYYY (sheet format)', () => {
  const d = parsePostDate('11/05/2026');
  assertEquals(d?.getFullYear(), 2026);
  assertEquals(d?.getMonth(), 4);
  assertEquals(d?.getDate(), 11);
});

Deno.test('parsePostDate rejects an invalid or empty value', () => {
  assertEquals(parsePostDate('not a date'), null);
  assertEquals(parsePostDate(''), null);
  assertEquals(parsePostDate(null), null);
  assertEquals(parsePostDate(undefined), null);
});

Deno.test('passesPlatformDateFilter with no bounds is always true', () => {
  assertEquals(passesPlatformDateFilter({ 'Trust Pilot': '2026-05-11' }, 'tp'), true);
  assertEquals(passesPlatformDateFilter({}, 'tp'), true);
});

Deno.test('passesPlatformDateFilter includes a row with no date for the platform (undated bias, never excluded by a range)', () => {
  assertEquals(passesPlatformDateFilter({}, 'tp', '2026-05-01', '2026-05-31'), true);
  assertEquals(passesPlatformDateFilter({ 'Trust Pilot': 'garbage' }, 'tp', '2026-05-01', '2026-05-31'), true);
});

Deno.test('passesPlatformDateFilter includes a dated row inside the range, excludes one outside it', () => {
  const data = { 'Trust Pilot': '2026-05-15' };
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-05-01', '2026-05-31'), true);
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-06-01', '2026-06-30'), false);
});

Deno.test('passesPlatformDateFilter bounds are inclusive at day granularity', () => {
  assertEquals(passesPlatformDateFilter({ 'Trust Pilot': '2026-05-01' }, 'tp', '2026-05-01', '2026-05-31'), true);
  assertEquals(passesPlatformDateFilter({ 'Trust Pilot': '2026-05-31' }, 'tp', '2026-05-01', '2026-05-31'), true);
});

Deno.test('passesPlatformDateFilter checks the requested platform\'s own date column, not another platform\'s', () => {
  const data = { 'Ask Gambler review added': '2026-05-15' }; // no 'Trust Pilot' key at all
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-06-01', '2026-06-30'), true); // undated for tp -> always true
  assertEquals(passesPlatformDateFilter(data, 'ag', '2026-06-01', '2026-06-30'), false); // dated for ag, out of range
});

Deno.test('passesPlatformDateFilter supports an open-ended range (only from, or only to)', () => {
  const data = { 'Trust Pilot': '2026-05-15' };
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-05-01', undefined), true);
  assertEquals(passesPlatformDateFilter(data, 'tp', '2026-06-01', undefined), false);
  assertEquals(passesPlatformDateFilter(data, 'tp', undefined, '2026-05-31'), true);
  assertEquals(passesPlatformDateFilter(data, 'tp', undefined, '2026-04-30'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `supabase/functions/ai-assistant/`): `deno test --allow-env --allow-net tools_test.ts`
Expected: fails to even start — `parsePostDate`/`passesPlatformDateFilter` are not exported from `./tools.ts'` yet (import error).

- [ ] **Step 3: Implement**

In `tools.ts`, the current block at lines 119-135 reads:

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

Insert a new block between the closing `};` of `PLATFORM_STATUS_KEYS` and the `const PLATFORM_SCORE_KEYS` line, so it reads:

```ts
export type Platform = 'tp' | 'ag' | 'cg' | 'wo';

export const PLATFORM_STATUS_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status'],
  ag: ['AG Review Status'],
  cg: ['CG Review Status'],
  wo: ['WoO Review Status'],
};

// Ported from src/lib/scoreSummary.ts's PLATFORM_DATE_KEYS/parsePostDate/
// passesPlatformDateFilter — keep in sync manually if any of the three
// change, same convention as this file's other ported constants
// (PLATFORM_STATUS_KEYS above). Shared date gate every date-aware tool in
// this file uses (query_entries, get_score_summary,
// get_success_rate_by_field, get_performance_report).
export const PLATFORM_DATE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['Trust Pilot'],
  ag: ['Ask Gambler review added'],
  cg: ['Casino Guru review added'],
  wo: ['Wizard of Odds'],
};

function buildDate(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

// Same 3-branch parse as src/lib/scoreSummary.ts's parsePostDate: YYYY-MM-DD
// (also used for date_from/date_to, which are always this format), DD/MM/YYYY
// (sheet format), then a native Date() fallback for JS Date.toString() values.
export function parsePostDate(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return buildDate(y, mo, d);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    return buildDate(y, mo, d);
  }
  const native = new Date(s);
  if (!isNaN(native.getTime())) {
    return new Date(native.getFullYear(), native.getMonth(), native.getDate());
  }
  return null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// Shared date-range param shape for scoreSummary/successRateByField/performanceReport.
export interface DateRangeArgs {
  from?: string;
  to?: string;
}

// Ranged date-gate for a single platform's date column, mirroring
// src/lib/scoreSummary.ts's passesPlatformDateFilter (+ the passesDateFilter
// it wraps) exactly. No bounds -> always true. A row with no parseable date
// for this platform's date column -> always true (never excluded by a
// range) -- this is what stops date-filtering from skewing a live/removed
// rate by dropping undated Removed/Refused rows. Bounds are inclusive, at
// day granularity.
export function passesPlatformDateFilter(
  data: Record<string, any>,
  platform: Platform,
  fromISO?: string,
  toISO?: string,
): boolean {
  const fromDate = fromISO ? parsePostDate(fromISO) : null;
  const toDate = toISO ? parsePostDate(toISO) : null;
  const fromBound = fromDate ? startOfDay(fromDate) : null;
  const toBound = toDate ? endOfDay(toDate) : null;
  if (!fromBound && !toBound) return true;
  const raw = pick(data, PLATFORM_DATE_KEYS[platform]);
  if (raw == null) return true;
  const date = parsePostDate(raw);
  if (date == null) return true;
  if (fromBound && date < fromBound) return false;
  if (toBound && date > toBound) return false;
  return true;
}

const PLATFORM_SCORE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: ['AG Score added'],
  cg: ['CG Score added'],
  wo: ['Wizard of OddsScore added'],
};

const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5, wo: 5 };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: all previously-passing tests still pass, plus the new ones from Step 1 (118 + 9 = 127 passed).

Also run: `deno check tools.ts index.ts` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: add shared date-range gate to ai-assistant tools.ts"
```

---

### Task 2: `query_entries` gains `date_from`/`date_to`

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (the `query_entries` entry in `TOOL_DEFS`, and its `runTool` dispatch block)
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `passesPlatformDateFilter`, `DateRangeArgs`-shaped args (Task 1); `getTabPlatforms(tab): Platform[]` (already imported at the top of `tools.ts`, line 14).
- Produces: no new exported function — behavior lives inline in `runTool`'s `query_entries` branch.

- [ ] **Step 1: Write the failing tests**

Append to `tools_test.ts`:

```ts
Deno.test('query_entries date_from/date_to filters by the tab\'s own active platform(s) when tab is given', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'TP Brand Injection', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } },
      { id: '2', tab: 'TP Brand Injection', data: { Brand: 'Zeta', 'Review Status': 'Published', 'Trust Pilot': '2026-04-01' } },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {
    tab: 'TP Brand Injection', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].data.Brand, 'Acme');
});

Deno.test('query_entries date_from/date_to with no tab given ORs across all 4 platforms, checking only platforms the row has a status for', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'AG Review Status': 'Published', 'Ask Gambler review added': '2026-05-15' } }, // in range on ag
      { id: '2', tab: 't', data: { Brand: 'Zeta', 'CG Review Status': 'Published', 'Casino Guru review added': '2026-04-01' } }, // out of range on cg, no other platform status
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {
    date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].data.Brand, 'Acme');
});

Deno.test('query_entries date_from/date_to includes a row with a status but no date at all (undated bias matches passesPlatformDateFilter)', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'TP Brand Injection', data: { Brand: 'Acme', 'Review Status': 'Published' } }, // status present, no date field at all
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {
    tab: 'TP Brand Injection', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.total, 1);
});

Deno.test('query_entries combines date_from/date_to with month (both must pass)', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'TP Brand Injection', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } }, // passes both
      { id: '2', tab: 'TP Brand Injection', data: { Brand: 'Zeta', 'Review Status': 'Published', 'Trust Pilot': '2026-06-01' } }, // fails date_to (and month)
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'query_entries', {
    tab: 'TP Brand Injection', month: 'may 2026', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].data.Brand, 'Acme');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: the 4 new tests fail (no date filtering applied yet — `result.total` will be 2, not 1, in the first 3; the 4th will also show 2).

- [ ] **Step 3: Implement**

In `tools.ts`, find the `query_entries` `TOOL_DEFS` entry. Its `description` currently ends with:

```ts
        'IMPORTANT: when user says "approved", "live", or "active" use status="Published". ' +
        'IMPORTANT: always pass month as "may 2026" style when user mentions a month.',
```

Change to:

```ts
        'IMPORTANT: when user says "approved", "live", or "active" use status="Published". ' +
        'IMPORTANT: always pass month as "may 2026" style when user mentions a month. ' +
        'For anything broader than one calendar month — a week, a year, a quarter, or a ' +
        'custom range — use date_from/date_to (YYYY-MM-DD, inclusive) instead of month. ' +
        'When tab is also given, only that tab\'s own active platform(s) are checked; ' +
        'otherwise all 4 platforms are checked, but only the ones a given row actually has ' +
        'a status recorded for — a row counts if ANY of ITS applicable platforms\' dates is ' +
        'in range. A row with no parseable date for an applicable platform still counts ' +
        '(never silently excluded by the range, same as every other date-filtered tool here). ' +
        'month and date_from/date_to can be combined (both must pass) but this is rarely ' +
        'useful — prefer one or the other.',
```

And its `parameters.properties` currently reads:

```ts
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          status: { type: 'string' },
          month: { type: 'string', description: 'filter by month, e.g. "may 2026" or "2026-05"' },
          contains: { type: 'string' },
```

Add two properties after `month`:

```ts
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          status: { type: 'string' },
          month: { type: 'string', description: 'filter by month, e.g. "may 2026" or "2026-05"' },
          date_from: { type: 'string', description: 'YYYY-MM-DD, inclusive start of a date range — use for a week/year/quarter/custom range instead of month' },
          date_to: { type: 'string', description: 'YYYY-MM-DD, inclusive end of a date range' },
          contains: { type: 'string' },
```

Now find the `runTool` dispatch for `query_entries`. This line:

```ts
    if (args?.month) rows = rows.filter((e) => matchesMonth(e, args.month));
    if (args?.contains) rows = rows.filter((e) => entryMatches(e, args.contains));
```

Becomes:

```ts
    if (args?.month) rows = rows.filter((e) => matchesMonth(e, args.month));
    if (args?.date_from || args?.date_to) {
      const tabPlatforms = args?.tab ? getTabPlatforms(args.tab) : [];
      const platformsToCheck: Platform[] = tabPlatforms.length > 0 ? tabPlatforms : (['tp', 'ag', 'cg', 'wo'] as Platform[]);
      rows = rows.filter((e) => {
        // Only check a platform's date if the row actually has a status
        // recorded for it — otherwise an irrelevant platform's simply-absent
        // date key would trigger passesPlatformDateFilter's "undated ->
        // always true" bias and silently defeat the range for almost every
        // row (most rows only ever populate 1-2 of the 4 platforms' fields).
        // If the row has no status for ANY checked platform, fall back to
        // checking them all anyway — same "unsure, include" bias as the rest
        // of this file, just applied one level up.
        const applicable = platformsToCheck.filter((p) => !!pick(e.data, PLATFORM_STATUS_KEYS[p]));
        const checkPlatforms = applicable.length > 0 ? applicable : platformsToCheck;
        return checkPlatforms.some((p) => passesPlatformDateFilter(e.data, p, args.date_from, args.date_to));
      });
    }
    if (args?.contains) rows = rows.filter((e) => entryMatches(e, args.contains));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: all tests pass (127 + 4 = 131).

Run: `deno check tools.ts index.ts` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: query_entries accepts date_from/date_to for range queries"
```

---

### Task 3: `get_score_summary` gains `date_from`/`date_to`

`scoreSummary()`'s return type changes from `BrandScoreSummary[]` to `{ brands: BrandScoreSummary[]; excludedRows: number }` (matching the dashboard's own `ScoreSummaryResult` shape from `src/lib/scoreSummary.ts`) — every existing direct caller must be updated in this same task.

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (the `scoreSummary` function, its `TOOL_DEFS` entry, and its `runTool` dispatch block)
- Modify: `supabase/functions/ai-assistant/tools_test.ts` (10 existing direct `scoreSummary(...)` call sites — add `.brands`)
- Test: `supabase/functions/ai-assistant/tools_test.ts` (new tests)

**Interfaces:**
- Consumes: `passesPlatformDateFilter`, `parsePostDate`, `startOfDay`, `endOfDay`, `PLATFORM_DATE_KEYS`, `DateRangeArgs` (Task 1).
- Produces: `scoreSummary(entries, platforms?, removedPlatformBrands?, range?): { brands: BrandScoreSummary[]; excludedRows: number }` (signature change — 4th param `range: DateRangeArgs = {}` added, return type changed).

- [ ] **Step 1: Update the 10 existing direct `scoreSummary(...)` call sites in `tools_test.ts`**

These currently treat the return value as an array directly. Each needs `.brands` inserted. Exact locations and changes:

1. Line ~60 (`'scoreSummary counts Published only'`):
   ```ts
   const out = scoreSummary(entries);
   assertEquals(out.length, 1);
   assertEquals(out[0].rated, 1);
   assertEquals(out[0].average, 5);
   ```
   becomes:
   ```ts
   const out = scoreSummary(entries).brands;
   assertEquals(out.length, 1);
   assertEquals(out[0].rated, 1);
   assertEquals(out[0].average, 5);
   ```

2. Line ~461 (`'scoreSummary is platform-aware...'`): change `const out = scoreSummary(entries, ['ag']);` to `const out = scoreSummary(entries, ['ag']).brands;` (rest of the test body — `out.length`, `out[0].rated`, etc. — stays unchanged, since `out` is now the array again).

3. Line ~475 (`'scoreSummary creates a bucket for a brand with only Removed entries...'`): change `const out = scoreSummary(entries);` to `const out = scoreSummary(entries).brands;`.

4. Line ~490 (`'scoreSummary floors successRate...'`): change `const out = scoreSummary(entries);` to `const out = scoreSummary(entries).brands;`.

5. Line ~514 (`'scoreSummary works for cg and wo platforms...'`): change `const cgOut = scoreSummary(cgEntries, ['cg']);` to `const cgOut = scoreSummary(cgEntries, ['cg']).brands;`.

6. Same test, line ~522: change `const woOut = scoreSummary(woEntries, ['wo']);` to `const woOut = scoreSummary(woEntries, ['wo']).brands;`.

7. Line ~532 (`'scoreSummary attaches a rating label...'`): change `const out = scoreSummary(entries);` to `const out = scoreSummary(entries).brands;`.

8. Line ~642 (`'scoreSummary excludes a brand flagged as removed...'`): change `const out = scoreSummary(entries, ['tp'], removedSet);` to `const out = scoreSummary(entries, ['tp'], removedSet).brands;`.

9. Line ~651 (`'scoreSummary does not exclude a brand flagged as removed on a different platform'`): change `const out = scoreSummary(entries, ['ag'], removedSet);` to `const out = scoreSummary(entries, ['ag'], removedSet).brands;`.

10. Line ~798 (`'scoreSummary with an empty platforms array falls back to all 4 combined'`): change `const out = scoreSummary(entries, []);` to `const out = scoreSummary(entries, []).brands;`.

(Every `get_score_summary` test that calls `runTool(...)` and reads `result.brands` — e.g. the `'get_score_summary defaults to tp platform...'`, `'get_score_summary end-to-end excludes a removed-flagged brand...'`, `'get_score_summary with 2 platforms...'` tests — needs NO change here, since `result.brands` already matches the new `runTool` response shape from Step 3 below.)

- [ ] **Step 2: Write the new failing tests**

Append to `tools_test.ts`:

```ts
Deno.test('scoreSummary\'s live/removed counts still include an undated row when a range is active (lenient gate)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'H', 'Review Status': 'Removed' } }, // no date at all
  ];
  const out = scoreSummary(entries, ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.brands[0].removed, 1);
  assertEquals(out.excludedRows, 0); // excludedRows only ever reflects the star-breakdown gate
});

Deno.test('scoreSummary excludes an undated Published row from the star breakdown when a range is active, and counts it in excludedRows', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'G', 'Review Status': 'Published', 'Score added': '5', 'Trust Pilot': '2026-05-15' } },
    { id: '2', tab: 't', data: { Brand: 'G', 'Review Status': 'Published', 'Score added': '4' } }, // no date
  ];
  const noRange = scoreSummary(entries, ['tp'], new Set(), {});
  assertEquals(noRange.excludedRows, 0);
  assertEquals(noRange.brands[0].rated, 2);

  const withRange = scoreSummary(entries, ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(withRange.excludedRows, 1);
  assertEquals(withRange.brands[0].rated, 1);
  assertEquals(withRange.brands[0].average, 5);
});

Deno.test('scoreSummary excludes a dated Published row outside the range from the star breakdown, without inflating excludedRows', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'I', 'Review Status': 'Published', 'Score added': '3', 'Trust Pilot': '2026-05-10' } }, // in range
    { id: '2', tab: 't', data: { Brand: 'I', 'Review Status': 'Published', 'Score added': '2', 'Trust Pilot': '2026-04-01' } }, // out of range
  ];
  // Note: a row whose only checked platform's date is out of range never
  // passes the live/removed gate either (passesPlatformDateFilter is also
  // what determines matchedAny) — so it contributes to neither live/removed
  // nor the star breakdown, and never inflates excludedRows (that only
  // tracks rows with NO parseable date, not out-of-range ones). The in-range
  // row above exists so the brand still has a bucket to assert against.
  const out = scoreSummary(entries, ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.brands[0].rated, 1);
  assertEquals(out.brands[0].average, 3);
  assertEquals(out.excludedRows, 0);
});

Deno.test('scoreSummary with 2+ platforms never populates excludedRows (star breakdown only ever runs for exactly one platform)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'J', 'TP Review Status': 'Published' } }, // undated
  ];
  const out = scoreSummary(entries, ['tp', 'ag'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.excludedRows, 0);
});

Deno.test('get_score_summary end-to-end applies date_from/date_to and echoes the range', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '5', 'Trust Pilot': '2026-05-15' } },
      { id: '2', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '2', 'Trust Pilot': '2026-04-01' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', { date_from: '2026-05-01', date_to: '2026-05-31' });
  assertEquals(result.dateRange, { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(result.brands[0].rated, 1);
  assertEquals(result.brands[0].average, 5);
});

Deno.test('get_score_summary reports dateRange as null when no date filter is passed', async () => {
  const tables = {
    entries: [{ id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '5' } }],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', {});
  assertEquals(result.dateRange, null);
  assertEquals(result.excludedRows, 0);
});
```

- [ ] **Step 3: Implement**

In `tools.ts`, the current `scoreSummary` function (the block starting with the `// Star rollup (Published-only) AND live/removed Success Rate...` comment, through its closing `});` before `export interface ReviewTextRow`) reads:

```ts
// Star rollup (Published-only) AND live/removed Success Rate, grouped by
// `${tab} ${brand}`, computed in one pass per platform. Mirrors
// computeScoreSummary + computeSuccessRates in src/lib/scoreSummary.ts, merged
// into a single result since the assistant only ever needs the combined view.
export function scoreSummary(
  entries: EntryRow[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
): BrandScoreSummary[] {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  // Same rule as computeScoreSummary (Task 5): the star/score breakdown only
  // ever applies for exactly one platform — 2+ platforms still combine
  // live/removed but report zeroed counts/unrated (the caller should treat
  // a >1-length platforms array as "combined totals only, no star detail").
  const showStars = resolved.length === 1;
  const maxScore = showStars ? PLATFORM_MAX_SCORE[resolved[0]] : 0;

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

    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    let solePublished = false;
    for (const platform of resolved) {
      if (removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
      if (showStars && status === 'published') solePublished = true;
    }
    if (!matchedAny) continue;

    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      const counts: Record<number, number> = {};
      for (let i = 1; i <= maxScore; i++) counts[i] = 0;
      b = { tab: e.tab, brand, counts, unrated: 0, live: 0, removed: 0 };
      buckets.set(key, b);
    }

    if (matchedLive) b.live += 1;
    else if (matchedRemoved) b.removed += 1;

    if (showStars && solePublished) {
      const score = parseScore(pick(e.data, PLATFORM_SCORE_KEYS[resolved[0]]), maxScore);
      if (score == null) b.unrated += 1;
      else b.counts[score] += 1;
    }
  }

  return [...buckets.values()].map((b) => {
    let rated = 0;
    let weighted = 0;
    for (let i = 1; i <= maxScore; i++) {
      rated += b.counts[i];
      weighted += i * b.counts[i];
    }
    const publishedTotal = rated + b.unrated;
    const average = rated === 0 ? null : Math.round((weighted / rated) * 10) / 10;
    const label = ratingLabel(average, maxScore);
    const successTotal = b.live + b.removed;
    // Floored to a whole percent (except exactly 100 stays 100), matching
    // src/lib/scoreSummary.ts's successRatePct. Keep in sync manually if either changes.
    const rawRate = successTotal === 0 ? null : (b.live / successTotal) * 100;
    const successRate = rawRate == null ? null : (rawRate === 100 ? 100 : Math.floor(rawRate));
    return {
      tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated,
      publishedTotal, rated, average, label, live: b.live, removed: b.removed, successRate,
    };
  });
}
```

Replace it entirely with:

```ts
export interface ScoreSummaryResult {
  brands: BrandScoreSummary[];
  excludedRows: number;
}

// Star rollup (Published-only) AND live/removed Success Rate, grouped by
// `${tab} ${brand}`, computed in one pass per platform. Mirrors
// computeScoreSummary + computeSuccessRates in src/lib/scoreSummary.ts, merged
// into a single result since the assistant only ever needs the combined view.
// `range` (YYYY-MM-DD from/to, both optional) applies two different gates,
// matching the dashboard exactly: live/removed counts use the lenient
// passesPlatformDateFilter gate (an undated row always counts, so a date
// range can't skew Success Rate by silently dropping undated Removed/Refused
// rows); the star-rating breakdown (single-platform only) uses the stricter
// gate from computeScoreSummary — when a range is active, a Published row
// with no parseable date is excluded from the breakdown and tallied in
// excludedRows instead of silently counted or silently dropped.
export function scoreSummary(
  entries: EntryRow[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  range: DateRangeArgs = {},
): ScoreSummaryResult {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  // Same rule as computeScoreSummary (Task 5): the star/score breakdown only
  // ever applies for exactly one platform — 2+ platforms still combine
  // live/removed but report zeroed counts/unrated (the caller should treat
  // a >1-length platforms array as "combined totals only, no star detail").
  const showStars = resolved.length === 1;
  const maxScore = showStars ? PLATFORM_MAX_SCORE[resolved[0]] : 0;
  const dateFilterActive = !!(range.from || range.to);
  const rangeFromDate = range.from ? parsePostDate(range.from) : null;
  const rangeToDate = range.to ? parsePostDate(range.to) : null;
  const rangeFromBound = rangeFromDate ? startOfDay(rangeFromDate) : null;
  const rangeToBound = rangeToDate ? endOfDay(rangeToDate) : null;

  interface Bucket {
    tab: string;
    brand: string;
    counts: Record<number, number>;
    unrated: number;
    live: number;
    removed: number;
  }
  const buckets = new Map<string, Bucket>();
  let excludedRows = 0;

  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    let solePublished = false;
    for (const platform of resolved) {
      if (removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesPlatformDateFilter(e.data, platform, range.from, range.to)) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
      if (showStars && status === 'published') solePublished = true;
    }
    if (!matchedAny) continue;

    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      const counts: Record<number, number> = {};
      for (let i = 1; i <= maxScore; i++) counts[i] = 0;
      b = { tab: e.tab, brand, counts, unrated: 0, live: 0, removed: 0 };
      buckets.set(key, b);
    }

    if (matchedLive) b.live += 1;
    else if (matchedRemoved) b.removed += 1;

    if (showStars && solePublished) {
      const date = parsePostDate(pick(e.data, PLATFORM_DATE_KEYS[resolved[0]]));
      let shouldCount = true;
      if (dateFilterActive) {
        if (date == null) {
          excludedRows++;
          shouldCount = false;
        } else if ((rangeFromBound && date < rangeFromBound) || (rangeToBound && date > rangeToBound)) {
          shouldCount = false;
        }
      }
      if (shouldCount) {
        const score = parseScore(pick(e.data, PLATFORM_SCORE_KEYS[resolved[0]]), maxScore);
        if (score == null) b.unrated += 1;
        else b.counts[score] += 1;
      }
    }
  }

  const brandsOut = [...buckets.values()].map((b) => {
    let rated = 0;
    let weighted = 0;
    for (let i = 1; i <= maxScore; i++) {
      rated += b.counts[i];
      weighted += i * b.counts[i];
    }
    const publishedTotal = rated + b.unrated;
    const average = rated === 0 ? null : Math.round((weighted / rated) * 10) / 10;
    const label = ratingLabel(average, maxScore);
    const successTotal = b.live + b.removed;
    // Floored to a whole percent (except exactly 100 stays 100), matching
    // src/lib/scoreSummary.ts's successRatePct. Keep in sync manually if either changes.
    const rawRate = successTotal === 0 ? null : (b.live / successTotal) * 100;
    const successRate = rawRate == null ? null : (rawRate === 100 ? 100 : Math.floor(rawRate));
    return {
      tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated,
      publishedTotal, rated, average, label, live: b.live, removed: b.removed, successRate,
    };
  });

  return { brands: brandsOut, excludedRows };
}
```

Now update the `get_score_summary` `TOOL_DEFS` entry. Its `description` currently reads (in full):

```ts
      description:
        'Star-rating rollup (Published reviews only) AND live/removed Success Rate ' +
        'per brand, matching the dashboard\'s Score Summary page, for one or more ' +
        'platforms: tp (TrustPilot, default), ag (AskGamblers), cg (CasinoGuru), or wo ' +
        '(Wizard of Odds). Passing multiple platforms combines their live/removed ' +
        'counts into one total, the same OR-across-platforms rule the dashboard\'s own ' +
        'multi-select filters use — it does not average or intersect them. Star-rating ' +
        'detail is only meaningful for exactly one platform at a time — when 2+ ' +
        'platforms are passed, the response still includes combined live/removed/' +
        'successRate but zeroes out the star breakdown. All-time only — no date-range ' +
        'filtering yet. Brands whose page on the queried platform was flagged removed ' +
        '(see get_removed_platform_flags) are excluded from these results entirely. ' +
        'A tab that has been archived or paused is excluded the same way — an empty or missing ' +
        'result for that tab may mean it\'s archived or paused, not that it never existed.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          platform: { type: 'array', items: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }, description: 'One or more platforms. Passing multiple platforms combines their live/removed counts into one total (OR semantics — a brand counts as live if ANY listed platform says so, not an intersection). Omitting this parameter defaults to TrustPilot only, matching this tool\'s existing single-platform behavior — explicitly list platforms (including all 4) to get a combined total.' },
        },
      },
```

Replace with:

```ts
      description:
        'Star-rating rollup (Published reviews only) AND live/removed Success Rate ' +
        'per brand, matching the dashboard\'s Score Summary page, for one or more ' +
        'platforms: tp (TrustPilot, default), ag (AskGamblers), cg (CasinoGuru), or wo ' +
        '(Wizard of Odds). Passing multiple platforms combines their live/removed ' +
        'counts into one total, the same OR-across-platforms rule the dashboard\'s own ' +
        'multi-select filters use — it does not average or intersect them. Star-rating ' +
        'detail is only meaningful for exactly one platform at a time — when 2+ ' +
        'platforms are passed, the response still includes combined live/removed/' +
        'successRate but zeroes out the star breakdown. ' +
        'date_from/date_to (YYYY-MM-DD, inclusive) apply two different gates: ' +
        'live/removed counts and successRate never drop an undated row (a range can\'t ' +
        'silently skew the rate), but the star-rating breakdown DOES exclude an undated ' +
        'Published row when a range is set — its count is reported separately as ' +
        'excludedRows, so say "N reviews had no recorded date and are not reflected in ' +
        'the star breakdown" rather than presenting the breakdown as complete when ' +
        'excludedRows is nonzero. The response echoes the applied range as dateRange ' +
        '({from, to}), or null when no range was requested. ' +
        'Brands whose page on the queried platform was flagged removed ' +
        '(see get_removed_platform_flags) are excluded from these results entirely. ' +
        'A tab that has been archived or paused is excluded the same way — an empty or missing ' +
        'result for that tab may mean it\'s archived or paused, not that it never existed.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          platform: { type: 'array', items: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }, description: 'One or more platforms. Passing multiple platforms combines their live/removed counts into one total (OR semantics — a brand counts as live if ANY listed platform says so, not an intersection). Omitting this parameter defaults to TrustPilot only, matching this tool\'s existing single-platform behavior — explicitly list platforms (including all 4) to get a combined total.' },
          date_from: { type: 'string', description: 'YYYY-MM-DD, inclusive start of a date range' },
          date_to: { type: 'string', description: 'YYYY-MM-DD, inclusive end of a date range' },
        },
      },
```

Finally, update the `get_score_summary` `runTool` dispatch block. It currently ends with:

```ts
    const platforms: Platform[] = rawPlatform == null ? ['tp'] : (filteredPlatforms.length > 0 ? filteredPlatforms : ['tp']);
    return { brands: scoreSummary(data ?? [], platforms, removedSet) };
  }
  if (name === 'get_removed_platform_flags') {
```

Change to:

```ts
    const platforms: Platform[] = rawPlatform == null ? ['tp'] : (filteredPlatforms.length > 0 ? filteredPlatforms : ['tp']);
    const range: DateRangeArgs = { from: args?.date_from, to: args?.date_to };
    const { brands, excludedRows } = scoreSummary(data ?? [], platforms, removedSet, range);
    return {
      brands,
      excludedRows,
      dateRange: (args?.date_from || args?.date_to) ? { from: args?.date_from ?? null, to: args?.date_to ?? null } : null,
    };
  }
  if (name === 'get_removed_platform_flags') {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: all pass (131 + 6 = 137).

Run: `deno check tools.ts index.ts` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: get_score_summary accepts date_from/date_to with dual live/star gates"
```

---

### Task 4: `get_success_rate_by_field` gains `date_from`/`date_to`

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (the `successRateByField` function, its `TOOL_DEFS` entry, and its `runTool` dispatch block)
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `passesPlatformDateFilter`, `DateRangeArgs` (Task 1).
- Produces: `successRateByField(entries, field, platforms?, removedPlatformBrands?, resolvedAgentLabels?, range?): FieldSuccessRate[]` — new 6th optional param `range: DateRangeArgs = {}`, return type unchanged (`FieldSuccessRate[]`, no `excludedRows` concept here — no star-rating gate exists for this tool).

- [ ] **Step 1: Write the failing tests**

Append to `tools_test.ts`:

```ts
Deno.test('successRateByField applies a date range with the same lenient (undated-always-counts) gate as scoreSummary', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } }, // in range
    { id: '2', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Removed', 'Trust Pilot': '2026-04-01' } }, // out of range, excluded
    { id: '3', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Removed' } }, // undated, always counts
  ];
  const out = successRateByField(entries, 'proxy', ['tp'], new Set(), undefined, { from: '2026-05-01', to: '2026-05-31' });
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 1);
  assertEquals(enigma.removed, 1);
  assertEquals(enigma.total, 2);
});

Deno.test('successRateByField with no range behaves exactly as before (regression lock)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } },
    { id: '2', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Removed', 'Trust Pilot': '2026-04-01' } },
  ];
  const out = successRateByField(entries, 'proxy');
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 1);
  assertEquals(enigma.removed, 1);
});

Deno.test('get_success_rate_by_field end-to-end applies date_from/date_to', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'A', 'Proxy Used': 'Enigma', 'Review Status': 'Published', 'Trust Pilot': '2026-05-15' } },
      { id: '2', tab: 't', data: { Brand: 'A', 'Proxy Used': 'Enigma', 'Review Status': 'Removed', 'Trust Pilot': '2026-04-01' } },
    ],
    removed_platform_brands: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_success_rate_by_field', {
    field: 'proxy', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  const enigma = result.results.find((r: any) => r.value === 'Enigma');
  assertEquals(enigma.live, 1);
  assertEquals(enigma.removed, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: the new date-range tests fail (no filtering applied — `enigma.removed` will be 2, not 1, in the first and third tests); the regression-lock test passes already (no behavior change without a range).

- [ ] **Step 3: Implement**

In `tools.ts`, the `successRateByField` function signature currently reads:

```ts
export function successRateByField(
  entries: EntryRow[],
  field: 'proxy' | 'agent' | 'country',
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  resolvedAgentLabels?: Map<string, string>,
): FieldSuccessRate[] {
```

Change to:

```ts
export function successRateByField(
  entries: EntryRow[],
  field: 'proxy' | 'agent' | 'country',
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  resolvedAgentLabels?: Map<string, string>,
  range: DateRangeArgs = {},
): FieldSuccessRate[] {
```

A few lines further down, this loop body:

```ts
    for (const platform of resolved) {
      if (brand && removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      matchedAny = true;
```

Becomes:

```ts
    for (const platform of resolved) {
      if (brand && removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesPlatformDateFilter(e.data, platform, range.from, range.to)) continue;
      matchedAny = true;
```

Now update the `get_success_rate_by_field` `TOOL_DEFS` entry. Its `description` currently ends with:

```ts
        'The "agent" field is resolved per-brand the same way the dashboard\'s Schedule ' +
        'Planner does (an authoritative brand-agent mapping first, falling back to each ' +
        'account\'s own recorded Agent value only when that mapping has no answer for the ' +
        'brand), so it agrees with what Schedule Planner shows even for tabs whose accounts ' +
        'have no Agent field recorded at all.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['proxy', 'agent', 'country'] },
          platform: { type: 'array', items: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }, description: 'One or more platforms. Passing multiple platforms combines their live/removed counts into one total (OR semantics — a brand counts as live if ANY listed platform says so, not an intersection). Omitting this parameter defaults to TrustPilot only, matching this tool\'s existing single-platform behavior — explicitly list platforms (including all 4) to get a combined total.' },
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
        },
        required: ['field'],
      },
```

Replace with:

```ts
        'The "agent" field is resolved per-brand the same way the dashboard\'s Schedule ' +
        'Planner does (an authoritative brand-agent mapping first, falling back to each ' +
        'account\'s own recorded Agent value only when that mapping has no answer for the ' +
        'brand), so it agrees with what Schedule Planner shows even for tabs whose accounts ' +
        'have no Agent field recorded at all. ' +
        'date_from/date_to (YYYY-MM-DD, inclusive) narrow the live/removed counts to that ' +
        'period — a row with no parseable date for a checked platform still counts (never ' +
        'silently excluded by the range, same as every other date-filtered tool here).',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['proxy', 'agent', 'country'] },
          platform: { type: 'array', items: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }, description: 'One or more platforms. Passing multiple platforms combines their live/removed counts into one total (OR semantics — a brand counts as live if ANY listed platform says so, not an intersection). Omitting this parameter defaults to TrustPilot only, matching this tool\'s existing single-platform behavior — explicitly list platforms (including all 4) to get a combined total.' },
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
          date_from: { type: 'string', description: 'YYYY-MM-DD, inclusive start of a date range' },
          date_to: { type: 'string', description: 'YYYY-MM-DD, inclusive end of a date range' },
        },
        required: ['field'],
      },
```

Finally, update the `get_success_rate_by_field` `runTool` dispatch block. It currently ends with:

```ts
    const agentLabels = args?.field === 'agent'
      ? resolveAgentLabels(data as (EntryRow & { updated_at: string })[], assignmentRows)
      : undefined;
    return { results: successRateByField(data ?? [], args?.field, platforms, removedSet, agentLabels) };
  }
```

Change to:

```ts
    const agentLabels = args?.field === 'agent'
      ? resolveAgentLabels(data as (EntryRow & { updated_at: string })[], assignmentRows)
      : undefined;
    const range: DateRangeArgs = { from: args?.date_from, to: args?.date_to };
    return { results: successRateByField(data ?? [], args?.field, platforms, removedSet, agentLabels, range) };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: all pass (137 + 3 = 140).

Run: `deno check tools.ts index.ts` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: get_success_rate_by_field accepts date_from/date_to"
```

---

### Task 5: New `get_performance_report` tool

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (new `performanceReport` function, new `TOOL_DEFS` entry, new `runTool` dispatch branch)
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `pick`, `BRAND_KEYS`, `PLATFORM_STATUS_KEYS`, `isLiveStatus`, `isRemovedStatus`, `platformRemovedKey`, `passesPlatformDateFilter`, `DateRangeArgs`, `EntryRow`, `Platform` (all already defined earlier in `tools.ts`).
- Produces: `performanceReport(entries, platforms?, removedPlatformBrands?, range?): { totals: { live: number; removed: number; successRate: number | null; entries: number }; brands: { tab: string; brand: string; live: number; removed: number; successRate: number | null }[] }` (exported).

- [ ] **Step 1: Write the failing tests**

Add `performanceReport` to the import block in `tools_test.ts` (alongside the other names imported from `./tools.ts`).

Append to `tools_test.ts`:

```ts
Deno.test('performanceReport computes period totals and a per-brand breakdown sorted by volume descending', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-05' } },
    { id: '2', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Removed', 'Trust Pilot': '2026-05-06' } },
    { id: '3', tab: 't', data: { Brand: 'Zeta', 'Review Status': 'Published', 'Trust Pilot': '2026-05-10' } },
    { id: '4', tab: 't', data: { Brand: 'Zeta', 'Review Status': 'Published' } }, // undated, still counts (lenient gate)
    { id: '5', tab: 't', data: { Brand: 'Zeta', 'Review Status': 'Removed', 'Trust Pilot': '2026-05-12' } },
    { id: '6', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-04-01' } }, // out of range, excluded
  ];
  const out = performanceReport(entries, ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.totals.live, 3);
  assertEquals(out.totals.removed, 2);
  assertEquals(out.totals.entries, 5);
  assertEquals(out.brands.map((b) => b.brand), ['Zeta', 'Acme']);
  assertEquals(out.brands[0].live, 2);
  assertEquals(out.brands[0].removed, 1);
  assertEquals(out.brands[1].live, 1);
  assertEquals(out.brands[1].removed, 1);
});

Deno.test('performanceReport excludes a brand flagged removed for the queried platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-05' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'Acme', platform: 'tp' }]);
  const out = performanceReport(entries, ['tp'], removedSet, { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.brands.length, 0);
  assertEquals(out.totals.entries, 0);
});

Deno.test('performanceReport combines multiple platforms with OR semantics (live wins over removed on the same row)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: {
      Brand: 'Acme',
      'TP Review Status': 'Removed', 'Trust Pilot': '2026-05-05',
      'CG Review Status': 'Published', 'Casino Guru review added': '2026-05-05',
    } },
  ];
  const out = performanceReport(entries, ['tp', 'cg'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.brands[0].live, 1);
  assertEquals(out.brands[0].removed, 0);
});

Deno.test('performanceReport with no matching rows returns empty totals/brands, not an error', () => {
  const out = performanceReport([], ['tp'], new Set(), { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(out.totals, { live: 0, removed: 0, successRate: null, entries: 0 });
  assertEquals(out.brands, []);
});

Deno.test('get_performance_report requires date_from and date_to', async () => {
  const result: any = await runTool(mockSupabaseTables({ entries: [] }), 'get_performance_report', { date_from: '2026-05-01' });
  assertEquals(result.error, 'Both date_from and date_to (YYYY-MM-DD) are required.');
});

Deno.test('get_performance_report end-to-end: tab-scoped, echoes period, excludes a paused tab and a removed-flagged brand', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 'Rooster Partners', data: { Brand: 'Acme', 'Review Status': 'Published', 'Trust Pilot': '2026-05-05' } },
      { id: '2', tab: 'Rooster Partners', data: { Brand: 'Beta', 'Review Status': 'Removed', 'Trust Pilot': '2026-05-06' } },
      { id: '3', tab: 'Hanan', data: { Brand: 'Gamma', 'Review Status': 'Published', 'Trust Pilot': '2026-05-05' } },
    ],
    tab_archive_log: [],
    paused_tabs: [{ tab: 'Hanan' }],
    removed_platform_brands: [{ tab: 'Rooster Partners', brand: 'Beta', platform: 'tp' }],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_performance_report', {
    tab: 'Rooster Partners', date_from: '2026-05-01', date_to: '2026-05-31',
  });
  assertEquals(result.period, { from: '2026-05-01', to: '2026-05-31' });
  assertEquals(result.brands.length, 1);
  assertEquals(result.brands[0].brand, 'Acme');
  assertEquals(result.totals.live, 1);
  assertEquals(result.totals.removed, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: fails to even start — `performanceReport` is not exported from `./tools.ts'` yet, and `runTool` doesn't recognize `get_performance_report` (would return `{ error: 'unknown tool: get_performance_report' }`, failing the assertions).

- [ ] **Step 3: Implement**

In `tools.ts`, add the `performanceReport` function right after the `scoreSummary` function (i.e. immediately after its closing `}` and before the `export interface ReviewTextRow {` block):

```ts
export interface PerformanceReportBrand {
  tab: string;
  brand: string;
  live: number;
  removed: number;
  successRate: number | null;
}

export interface PerformanceReportResult {
  totals: { live: number; removed: number; successRate: number | null; entries: number };
  brands: PerformanceReportBrand[];
}

// Period totals + per-brand live/removed breakdown for "give me a report for
// <period>" questions. Reuses the same "any decided status, not just
// Published" live/removed semantics as successRateByField (not
// scoreSummary's Published-only star gate — a performance report is about
// outcomes, not the subset of Published reviews), gated by the same lenient
// passesPlatformDateFilter (an undated row still counts, so a date range
// can't skew the rate by silently dropping undated Removed/Refused rows).
// `entries` in totals counts every row that matched a non-blank, in-range
// status for the requested platform(s) — including an undecided one like
// Pending — mirroring the bucket-existence rule successRateByField/
// scoreSummary already use, not just rows that had a live/removed outcome.
export function performanceReport(
  entries: EntryRow[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  range: DateRangeArgs = {},
): PerformanceReportResult {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  const buckets = new Map<string, { tab: string; brand: string; live: number; removed: number }>();
  let totalLive = 0;
  let totalRemoved = 0;
  let totalEntries = 0;

  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    for (const platform of resolved) {
      if (removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesPlatformDateFilter(e.data, platform, range.from, range.to)) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
    }
    if (!matchedAny) continue;

    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      b = { tab: e.tab, brand, live: 0, removed: 0 };
      buckets.set(key, b);
    }
    totalEntries += 1;
    if (matchedLive) { b.live += 1; totalLive += 1; }
    else if (matchedRemoved) { b.removed += 1; totalRemoved += 1; }
  }

  const brandsOut: PerformanceReportBrand[] = [...buckets.values()]
    .map((b) => {
      const total = b.live + b.removed;
      const rawRate = total === 0 ? null : (b.live / total) * 100;
      const successRate = rawRate == null ? null : (rawRate === 100 ? 100 : Math.floor(rawRate));
      return { tab: b.tab, brand: b.brand, live: b.live, removed: b.removed, successRate };
    })
    .sort((a, b) => (b.live + b.removed) - (a.live + a.removed));

  const totalDecided = totalLive + totalRemoved;
  const totalRawRate = totalDecided === 0 ? null : (totalLive / totalDecided) * 100;
  const totalSuccessRate = totalRawRate == null ? null : (totalRawRate === 100 ? 100 : Math.floor(totalRawRate));

  return {
    totals: { live: totalLive, removed: totalRemoved, successRate: totalSuccessRate, entries: totalEntries },
    brands: brandsOut,
  };
}
```

Add the new tool schema to `TOOL_DEFS`. Insert it as a new entry right before the closing `];` of the `TOOL_DEFS` array (i.e. right after the `get_review_analyses` entry's closing `},`):

```ts
  {
    type: 'function',
    function: {
      name: 'get_performance_report',
      description:
        'One-call performance report for a date range: period totals (live, removed, ' +
        'Success Rate, entries) plus a per-brand breakdown, sorted by volume (most active ' +
        'brand first). This is the first choice for "give me a report/summary for <period>" ' +
        'questions — for a narrower follow-up (raw rows, review text, a single brand\'s star ' +
        'rating), use query_entries/get_review_texts/get_score_summary instead. ' +
        'date_from and date_to are both required, YYYY-MM-DD — compute the actual dates ' +
        'yourself from the current-date system message (e.g. "last month" -> the 1st and ' +
        'last day of the previous calendar month), the same way you already compute ' +
        'week_start for get_schedule. Live/removed counts use the same "any decided status" ' +
        'rule as get_success_rate_by_field (not get_score_summary\'s Published-only star ' +
        'gate) — a row with no parseable date for the platform being checked still counts ' +
        '(never silently dropped by the range, matching every other date-filtered tool here). ' +
        'platform accepts one or more of tp (TrustPilot, default), ag (AskGamblers), cg ' +
        '(CasinoGuru), wo (Wizard of Odds) — multiple platforms combine into one OR\'d total, ' +
        'same as get_score_summary. tab optionally restricts to one tab (all tabs if omitted). ' +
        'Brands whose page on the queried platform was flagged removed (see ' +
        'get_removed_platform_flags), and any archived or paused tab, are excluded — the same ' +
        'exclusions every other review-data tool here applies.',
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'YYYY-MM-DD, start of the report period (inclusive)' },
          date_to: { type: 'string', description: 'YYYY-MM-DD, end of the report period (inclusive)' },
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
          platform: { type: 'array', items: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }, description: 'One or more platforms. Passing multiple platforms combines their live/removed counts into one total (OR semantics). Omitting this parameter defaults to TrustPilot only.' },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
```

Add the new `runTool` dispatch branch. Find the end of the `get_review_analyses` branch:

```ts
    return { total: combined.length, rows: combined.slice(0, limit) };
  }
  return { error: `unknown tool: ${name}` };
```

Insert a new `if` block between the `get_review_analyses` branch's closing `}` and the final fallback:

```ts
    return { total: combined.length, rows: combined.slice(0, limit) };
  }
  if (name === 'get_performance_report') {
    if (!args?.date_from || !args?.date_to) {
      return { error: 'Both date_from and date_to (YYYY-MM-DD) are required.' };
    }
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data: rawData, error }, removedSet, archivedSet, pausedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const data = (rawData ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    const rawPlatform = args?.platform;
    const requestedPlatforms: string[] = Array.isArray(rawPlatform)
      ? rawPlatform
      : (typeof rawPlatform === 'string' && rawPlatform ? [rawPlatform] : []);
    const filteredPlatforms = requestedPlatforms.filter((p): p is Platform => validPlatforms.includes(p as Platform));
    const platforms: Platform[] = rawPlatform == null ? ['tp'] : (filteredPlatforms.length > 0 ? filteredPlatforms : ['tp']);
    const report = performanceReport(data ?? [], platforms, removedSet, { from: args.date_from, to: args.date_to });
    return { period: { from: args.date_from, to: args.date_to }, ...report };
  }
  return { error: `unknown tool: ${name}` };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: all pass (140 + 6 = 146).

Run: `deno check tools.ts index.ts` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: add get_performance_report tool for period totals + brand breakdown"
```

---

### Task 6: System prompt updates (`index.ts`)

**Files:**
- Modify: `supabase/functions/ai-assistant/index.ts:82`, `:178-180`

**Interfaces:**
- Consumes: nothing (plain string edits, no code interface).
- Produces: nothing new — steers the model toward the tools built in Tasks 2-5.

- [ ] **Step 1: Add a report-tool steering line to TOOL USAGE RULES**

In `index.ts`, this line (currently line 82):

```
For "which proxy/agent/country works best" or "performs best" questions, use get_success_rate_by_field — do not attempt to compute this from query_entries rows yourself.
```

Gets a new line added directly after it:

```
For "which proxy/agent/country works best" or "performs best" questions, use get_success_rate_by_field — do not attempt to compute this from query_entries rows yourself.

For "give me a report/summary for <period>" questions (a week, month, year, quarter, or custom range), use get_performance_report — do not attempt to synthesize this yourself by chaining multiple query_entries calls.
```

- [ ] **Step 2: Add date-range vocabulary to DATA VOCABULARY**

In `index.ts`, this block (currently lines 178-180):

```
Month filter format: pass as "may 2026" or "2026-05" to the month parameter.
Date columns are named: "TP Added", "AG Added", "CG Added", "Date Added".
Status columns are named: "TP Status", "AG Status", "CG Status", "Review Status".
```

Becomes:

```
Month filter format: pass as "may 2026" or "2026-05" to the month parameter.
For a week, year, quarter, or custom range, use date_from/date_to (YYYY-MM-DD,
inclusive) instead of month — available on query_entries, get_score_summary,
get_success_rate_by_field, and get_performance_report. Compute the actual
dates yourself from the current-date system message (e.g. "last month" -> the
1st and last day of the previous calendar month), the same way you already
compute week_start for get_schedule.
Date columns are named: "TP Added", "AG Added", "CG Added", "Date Added".
Status columns are named: "TP Status", "AG Status", "CG Status", "Review Status".
```

- [ ] **Step 3: Verify**

Run: `deno check tools.ts index.ts` (from `supabase/functions/ai-assistant/`) — expect clean. `index.ts` has no `Deno.test` coverage of its own (the system prompt is a plain string) — nothing else to run for this task.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ai-assistant/index.ts
git commit -m "docs: steer Ask AI's system prompt toward the new date-range tools"
```

---

### Task 7: Full verification, deploy, and task-history entry

**Files:**
- None modified except `docs/task-history.md` (append-only, per this project's standing PMS workflow rule).

- [ ] **Step 1: Full type check**

Run (from `supabase/functions/ai-assistant/`): `deno check tools.ts index.ts`
Expected: clean, no errors.

- [ ] **Step 2: Full test run**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: all 146 tests pass (118 baseline + 28 new across Tasks 1-5).

- [ ] **Step 3: Deploy**

This checkout is already linked to the live project (`supabase/.temp/project-ref` = `krxnupmhfiduduvvlumc`, confirmed via `supabase projects list` showing "Brands Partner Forum" as the linked (●) project). Deploy directly:

```bash
supabase functions deploy ai-assistant
```

Expected: succeeds, confirm via `supabase functions list` that `ai-assistant` shows a new version number and status `ACTIVE`.

If deploy fails or credentials are unavailable in the executing session, do not treat this as a blocker for the rest of the plan — instead add a "Pending manual deploy" bullet to `docs/task-history.md`'s Known Issues section (matching this project's existing pattern for undeployed edge function changes) naming the exact command above.

- [ ] **Step 4: Append a task-history.md entry**

Append a new `## Task <N>: Ask AI Date-Range Reporting` entry to `docs/task-history.md` (check the file's most recent task number first and increment), summarizing: the shared date gate, the 3 extended tools, the new `get_performance_report` tool, the `scoreSummary()` return-shape change, test count (146), `deno check` clean, and the deploy outcome from Step 3 (deployed + version confirmed, or pending with the exact command). Reference the spec (`docs/superpowers/specs/2026-08-26-ask-ai-date-range-reporting-design.md`) and this plan file.

- [ ] **Step 5: Commit**

```bash
git add docs/task-history.md
git commit -m "docs: record Ask AI date-range reporting task in task-history.md"
```
