# Ask AI Drift Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Ask AI's two known drift gaps (proxy "No Proxy" bucketing, schedule hidden/restricted-brand awareness) by importing the same real, already-Deno-proven `src/lib` functions the dashboard and `generate-weekly-schedule` use, and close the informal "separately deployed = out of scope" override that let both gaps ship undocumented-as-required twice.

**Architecture:** `supabase/functions/ai-assistant/tools.ts` currently hand-ports all its logic with zero imports. This plan adds two targeted imports — `resolveProxyLabel` (`src/lib/proxyAliases.ts`) and `buildHiddenBrandSet`/`buildPlatformRestrictionMap`/`scheduleBrandKey` (`src/lib/scheduleBrandConfig.ts`) — both pure, npm-free, and already proven Deno-safe by `generate-weekly-schedule/index.ts`. No import-map changes are needed. `successRateByField` gets a one-line branch for the `proxy` field; `get_schedule`/`get_paused_combos` gain a shared row-filtering helper.

**Tech Stack:** Deno, TypeScript, `Deno.test` (std assert), Supabase Edge Functions.

**Spec:** `docs/superpowers/specs/2026-08-14-ask-ai-drift-prevention-design.md`

## Global Constraints

- No deploy: code lands committed only. Do not run `supabase functions deploy ai-assistant`.
- No schema changes — `schedule_hidden_brands`, `schedule_platform_restrictions`, `proxyAliases.ts` all already exist.
- No changes to `index.ts`, OpenAI tool schemas/descriptions, or the system prompt.
- Do not touch `tools.ts`'s existing hand-ported `pick()`/`scoreSummary()` core logic or the documented `pick()`/`successRate` divergence — out of scope per spec.
- Verify with `deno check` and `deno test --allow-env --allow-net` (run from `supabase/functions/ai-assistant/`), plus `npm run build` from the repo root.

---

### Task 1: `successRateByField` — proxy "No Proxy" bucketing

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (add import near top; edit `successRateByField` at line ~294)
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `resolveProxyLabel(rawProxy: string | null | undefined): string` from `src/lib/proxyAliases.ts` (already exists, unchanged — returns `NO_PROXY_LABEL` = `"No Proxy"` for blank/redacted input, otherwise the typo-corrected value).
- Produces: no new exports — `successRateByField`'s existing signature and return shape (`FieldSuccessRate[]`) are unchanged, only its `proxy`-field bucketing behavior changes.

- [ ] **Step 1: Write the failing test**

Add to `supabase/functions/ai-assistant/tools_test.ts`, after the existing test `'successRateByField skips rows with no value for the requested field'` (around line 225):

```ts
Deno.test('successRateByField buckets blank and redacted proxy values under "No Proxy"', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': '', 'Review Status': 'Published' } },
    { id: '2', tab: 't', data: { 'Proxy Used': '*****', 'Review Status': 'Removed' } },
    { id: '3', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'proxy');
  const noProxy = out.find((r) => r.value === 'No Proxy')!;
  assertEquals(noProxy.live, 1);
  assertEquals(noProxy.removed, 1);
  assertEquals(noProxy.total, 2);
  const enigma = out.find((r) => r.value === 'Enigma')!;
  assertEquals(enigma.live, 1);
  assertEquals(enigma.total, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `supabase/functions/ai-assistant/`): `deno test --allow-env --allow-net tools_test.ts --filter "buckets blank and redacted proxy"`
Expected: FAIL — with today's code, rows 1 and 2 are skipped entirely (blank value after `.trim()`), so `out.find((r) => r.value === 'No Proxy')` is `undefined` and the test throws on the `!` non-null assertion / `undefined.live`.

- [ ] **Step 3: Add the import**

At the top of `supabase/functions/ai-assistant/tools.ts`, after the existing header comment block and `// deno-lint-ignore-file no-explicit-any` line (before `// --- field picking...`), add:

```ts
import { resolveProxyLabel } from '../../../src/lib/proxyAliases.ts';
```

- [ ] **Step 4: Implement the minimal change**

In `successRateByField` (`tools.ts`, inside the `for (const e of entries)` loop, currently):

```ts
    const value = (pick(e.data, fieldKeys) ?? '').trim();
    if (!value) continue;
```

Replace with:

```ts
    const value = field === 'proxy'
      ? resolveProxyLabel(pick(e.data, fieldKeys))
      : (pick(e.data, fieldKeys) ?? '').trim();
    if (!value) continue;
```

(`resolveProxyLabel` never returns blank — it falls back to `"No Proxy"` — so the `if (!value) continue` guard becomes a no-op for `field === 'proxy'` and is unchanged for `'agent'`/`'country'`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-env --allow-net tools_test.ts --filter "buckets blank and redacted proxy"`
Expected: PASS

- [ ] **Step 6: Run the full Deno test file to confirm no regressions**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: all tests PASS, including the existing `'successRateByField computes live/removed rate per proxy value'` (uses only non-blank proxy values `'Enigma'`/`'OtherProxy'`, both pass through `resolveProxyLabel` unchanged) and `'successRateByField skips rows with no value for the requested field'` (uses `field: 'agent'`, untouched by this change).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "fix(ai-assistant): bucket blank/redacted proxy values under No Proxy in get_success_rate_by_field"
```

---

### Task 2: `get_schedule` / `get_paused_combos` — hidden/restricted brand filtering

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts` (add import; add `fetchScheduleHiddenSet`/`fetchScheduleRestrictionMap`/`filterHiddenOrRestricted` helpers near `fetchRemovedPlatformBrandSet`; edit the `get_schedule` and `get_paused_combos` branches of `runTool`)
- Test: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes:
  - `buildHiddenBrandSet(rows: { tab: string; brand: string }[]): Set<string>` from `src/lib/scheduleBrandConfig.ts` (existing, unchanged).
  - `buildPlatformRestrictionMap(rows: { tab: string; brand: string; allowed_platform: Platform }[]): Map<string, Platform>` from `src/lib/scheduleBrandConfig.ts` (existing, unchanged) — `Platform` here is structurally `'tp' | 'ag' | 'cg' | 'wo'`, matching `tools.ts`'s own local `Platform` type (`tools.ts:106`) with no type import needed.
  - `scheduleBrandKey(tab: string, brand: string): string` from `src/lib/scheduleBrandConfig.ts` (existing, unchanged).
  - The `mockSupabaseTables(tables: Record<string, any[]>)` test helper already in `tools_test.ts` (line 143) — returns `[]` for any table key not present in the passed `tables` object, so existing `get_schedule`/`get_paused_combos` tests (which don't pass `schedule_hidden_brands`/`schedule_platform_restrictions`) need no changes.
- Produces:
  - `filterHiddenOrRestricted<T extends { tab: string; brand: string; platform: string | null }>(rows: T[], hiddenSet: Set<string>, restrictionMap: Map<string, Platform>): T[]` — new local helper in `tools.ts`, used by both `get_schedule` and `get_paused_combos`.

- [ ] **Step 1: Write the failing tests**

Add to `supabase/functions/ai-assistant/tools_test.ts`, after the existing `'get_schedule returns an empty array, not an error, when nothing matches'` test (around line 602):

```ts
Deno.test("get_schedule excludes a hidden brand's row", async () => {
  const tables = {
    brand_schedule: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      { tab: 'Rooster Partners', brand: 'HiddenBrand', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ],
    schedule_hidden_brands: [
      { tab: 'Rooster Partners', brand: 'HiddenBrand' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Rooster Partners', week_start: '2026-08-03' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].brand, 'Lucky7even');
});

Deno.test("get_schedule excludes a platform-restricted brand's non-allowed-platform row, keeps the allowed one", async () => {
  const tables = {
    brand_schedule: [
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'ag', week_start: '2026-08-03', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ],
    schedule_platform_restrictions: [
      { tab: 'Hanan', brand: 'Pribet.com', allowed_platform: 'tp' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Hanan', week_start: '2026-08-03' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].platform, 'tp');
});

Deno.test('get_schedule keeps a legacy (platform: null) row for a platform-restricted brand', async () => {
  const tables = {
    brand_schedule: [
      { tab: 'Hanan', brand: 'Pribet.com', platform: null, week_start: '2026-01-05', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ],
    schedule_platform_restrictions: [
      { tab: 'Hanan', brand: 'Pribet.com', allowed_platform: 'tp' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_schedule', { tab: 'Hanan', week_start: '2026-01-05' });
  assertEquals(result.schedule.length, 1);
  assertEquals(result.schedule[0].platform, null);
});
```

Add after the existing `'get_paused_combos lists paused combos with reason, optionally filtered by tab'` test (around line 618):

```ts
Deno.test("get_paused_combos excludes a hidden brand's paused combo", async () => {
  const tables = {
    brand_platform_pause: [
      { tab: 'Rooster Partners', brand: 'Lucky7even', platform: 'ag', paused_week_start: '2026-07-27', reason: 'x' },
      { tab: 'Rooster Partners', brand: 'HiddenBrand', platform: 'ag', paused_week_start: '2026-07-27', reason: 'x' },
    ],
    schedule_hidden_brands: [
      { tab: 'Rooster Partners', brand: 'HiddenBrand' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_paused_combos', {});
  assertEquals(result.paused.length, 1);
  assertEquals(result.paused[0].brand, 'Lucky7even');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-env --allow-net tools_test.ts --filter "hidden brand|platform-restricted|restricted brand"`
Expected: FAIL — today's `get_schedule`/`get_paused_combos` return every matching row unfiltered, so all 4 new tests see the excluded row still present (`result.schedule.length`/`result.paused.length` equal 2, not 1).

- [ ] **Step 3: Add the import**

In `supabase/functions/ai-assistant/tools.ts`, alongside the import added in Task 1:

```ts
import { buildHiddenBrandSet, buildPlatformRestrictionMap, scheduleBrandKey } from '../../../src/lib/scheduleBrandConfig.ts';
```

- [ ] **Step 4: Add the fetch + filter helpers**

In `tools.ts`, immediately after the existing `fetchRemovedPlatformBrandSet` function (`tools.ts:264-268`), add:

```ts
async function fetchScheduleHiddenSet(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase.from('schedule_hidden_brands').select('tab, brand');
  if (error) throw error;
  return buildHiddenBrandSet(data ?? []);
}

async function fetchScheduleRestrictionMap(supabase: any): Promise<Map<string, Platform>> {
  const { data, error } = await supabase
    .from('schedule_platform_restrictions')
    .select('tab, brand, allowed_platform');
  if (error) throw error;
  return buildPlatformRestrictionMap(data ?? []);
}

function filterHiddenOrRestricted<T extends { tab: string; brand: string; platform: string | null }>(
  rows: T[],
  hiddenSet: Set<string>,
  restrictionMap: Map<string, Platform>,
): T[] {
  return rows.filter((row) => {
    const key = scheduleBrandKey(row.tab, row.brand);
    if (hiddenSet.has(key)) return false;
    const restriction = restrictionMap.get(key);
    if (restriction && row.platform && row.platform !== restriction) return false;
    return true;
  });
}
```

- [ ] **Step 5: Wire the filter into `get_schedule`**

In `runTool`, replace the `get_schedule` branch (`tools.ts:724-736`):

```ts
  if (name === 'get_schedule') {
    if (!args?.tab || !args?.week_start) {
      return { error: 'Both tab and week_start (Monday, YYYY-MM-DD) are required.' };
    }
    let q = supabase
      .from('brand_schedule')
      .select('tab, brand, platform, week_start, monday, tuesday, wednesday, thursday, friday');
    if (args?.tab) q = q.eq('tab', args.tab);
    if (args?.week_start) q = q.eq('week_start', args.week_start);
    const { data, error } = await q;
    if (error) throw error;
    return { schedule: data ?? [] };
  }
```

with:

```ts
  if (name === 'get_schedule') {
    if (!args?.tab || !args?.week_start) {
      return { error: 'Both tab and week_start (Monday, YYYY-MM-DD) are required.' };
    }
    let q = supabase
      .from('brand_schedule')
      .select('tab, brand, platform, week_start, monday, tuesday, wednesday, thursday, friday');
    if (args?.tab) q = q.eq('tab', args.tab);
    if (args?.week_start) q = q.eq('week_start', args.week_start);
    const [{ data, error }, hiddenSet, restrictionMap] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
    ]);
    if (error) throw error;
    return { schedule: filterHiddenOrRestricted(data ?? [], hiddenSet, restrictionMap) };
  }
```

- [ ] **Step 6: Wire the filter into `get_paused_combos`**

Replace the `get_paused_combos` branch (`tools.ts:737-745`):

```ts
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

with:

```ts
  if (name === 'get_paused_combos') {
    let q = supabase
      .from('brand_platform_pause')
      .select('tab, brand, platform, paused_week_start, reason');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, hiddenSet, restrictionMap] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
    ]);
    if (error) throw error;
    return { paused: filterHiddenOrRestricted(data ?? [], hiddenSet, restrictionMap) };
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `deno test --allow-env --allow-net tools_test.ts --filter "hidden brand|platform-restricted|restricted brand"`
Expected: PASS

- [ ] **Step 8: Run the full Deno test file to confirm no regressions**

Run: `deno test --allow-env --allow-net tools_test.ts`
Expected: all tests PASS, including the pre-existing `get_schedule`/`get_paused_combos` tests, which don't include `schedule_hidden_brands`/`schedule_platform_restrictions` in their `tables` object — `mockSupabaseTables` returns `[]` for those, so `hiddenSet`/`restrictionMap` are empty and `filterHiddenOrRestricted` is a no-op for them.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "fix(ai-assistant): filter hidden/platform-restricted brands out of get_schedule and get_paused_combos"
```

---

### Task 3: CLAUDE.md process fix + full verification

**Files:**
- Modify: `CLAUDE.md` (the cross-dashboard-consistency bullet under "Development Guidelines")

**Interfaces:**
- Consumes: nothing (documentation-only change).
- Produces: nothing consumed by other tasks — this is the final task.

- [ ] **Step 1: Edit the cross-dashboard-consistency bullet**

In `CLAUDE.md`, find the bullet beginning `**Cross-dashboard consistency is a standing requirement, not a per-task nice-to-have.**` (under "Development Guidelines"). Its current text ends with:

```
This project has shipped multiple data-accuracy bugs from independently-written logic silently diverging (see Task 180, Task 174 platform-removed-brand gap, Task 173 plan-vs-evidence mismatch) — a final whole-branch review, not just a per-task review, is what has caught most of these historically.
```

Append a new sentence immediately after it, still inside the same bullet:

```
Ask AI's separate deployment step (`supabase functions deploy ai-assistant`) is not an exemption from this rule, even though it's already named in the surface list above — a task that changes logic `supabase/functions/ai-assistant/tools.ts` duplicates must update `tools.ts` (with tests) in the same task; only the deploy command itself may be deferred and flagged as a pending manual step, the same way other edge function deploys already are in this project's task history (Task 207 and Task 218 both instead deferred the code change itself and documented it as a Known Issue — don't repeat that pattern).
```

- [ ] **Step 2: Run the full verification suite**

Run (from `supabase/functions/ai-assistant/`):
```bash
deno check tools.ts index.ts
deno test --allow-env --allow-net
```
Expected: both pass with no errors, full test count higher than before this plan (4 new schedule/paused tests + 1 new proxy test = 5 new `Deno.test` cases).

Run (from the repo root):
```bash
npm run build
```
Expected: build succeeds — this re-verifies `src/lib/proxyAliases.ts`/`src/lib/scheduleBrandConfig.ts` still compile cleanly for the frontend side too, since this plan didn't modify either file, only added new importers of them.

- [ ] **Step 3: Commit the CLAUDE.md change**

```bash
git add CLAUDE.md
git commit -m "docs: close the informal Ask AI deploy-exemption loophole in the cross-dashboard-consistency rule"
```

- [ ] **Step 4: Append a task-history entry**

Per this project's standing PMS workflow, append a new dated entry to `docs/task-history.md` (top of the Recent Changes-style log, matching this project's existing entry format — see recent entries for tone/structure) summarizing: both known Ask AI drift gaps closed (proxy No Proxy bucketing, schedule hidden/restricted-brand filtering) via real `src/lib` imports rather than hand-ported copies; CLAUDE.md's cross-dashboard-consistency rule now explicitly closes the "separately deployed" exemption that let Task 207/218 defer these; not yet deployed — `supabase functions deploy ai-assistant` remains a pending manual step. Do not run any deploy command as part of this step.

---

## Self-Review Notes

- **Spec coverage:** All 3 spec changes have a task — (1) proxy bucketing → Task 1, (2) schedule/paused filtering → Task 2, (3) CLAUDE.md rule → Task 3. Spec's "no deploy" constraint is a Global Constraint and reiterated in Task 3/4. Spec's testing approach (unit tests at the pure-function/`runTool` level, `deno check`, `deno test`, `npm run build`) is covered across Tasks 1-3.
- **Placeholder scan:** none found — every step has literal file paths, exact before/after code, and exact commands.
- **Type consistency:** `filterHiddenOrRestricted`'s generic constraint (`{ tab: string; brand: string; platform: string | null }`) matches both `brand_schedule` rows (has `platform: string | null`) and `brand_platform_pause` rows (has `platform: string`, a subtype of `string | null`) used at its two call sites in Task 2. `Platform` in `fetchScheduleRestrictionMap`'s return type and `filterHiddenOrRestricted`'s parameter refers to `tools.ts`'s own local `Platform` type (`tools.ts:106`), not an imported one — consistent with how `Platform` is already used elsewhere in `tools.ts` (e.g. `fetchRemovedPlatformBrandSet`'s callers).
