# Ask AI Full Coverage — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Ask AI see TP/AG/CG/WO-removed brand flags — a new `get_removed_platform_flags` tool for direct lookup, and correct exclusion of flagged brands wired into `get_score_summary` and `get_success_rate_by_field` (the latter also gaining a `platform` param, since exclusion can't be correct without one).

**Architecture:** All changes are in `supabase/functions/ai-assistant/tools.ts` (+ tests) — no new files. `normalizeBrandKey`/`platformRemovedKey`/`buildRemovedPlatformBrandSet` are ported verbatim from `src/lib/removedPlatformBrands.ts`. Split into two tasks: Task 1 adds the ported helpers, the new lookup tool, and wires exclusion into `get_score_summary` (which already has a `platform` param from Phase 2). Task 2 gives `get_success_rate_by_field` a `platform` param (retiring the flat `SUCCESS_RATE_STATUS_KEYS`) and wires the same exclusion into it — this is the larger, more disruptive change, kept separate so it can be reviewed independently of Task 1's more contained work.

**Tech Stack:** Deno, TypeScript, `deno test` + `https://deno.land/std@0.224.0/assert/mod.ts`. No new dependencies.

## Global Constraints

- Ported helpers (`normalizeBrandKey`, `platformRemovedKey`, `buildRemovedPlatformBrandSet`) must match `src/lib/removedPlatformBrands.ts` exactly — copy verbatim, do not paraphrase.
- `Platform` (already defined in `tools.ts` since Phase 2, `'tp' | 'ag' | 'cg' | 'wo'`) is reused directly — do not declare a second, separate platform type.
- `get_removed_platform_flags` selects only `tab, brand, platform` from `removed_platform_brands` — matches `src/lib/queries.ts`'s existing `fetchRemovedPlatformBrands()` exactly (no `removed_by`/`removed_at`).
- Exclusion check placement in both `scoreSummary` and `successRateByField`: immediately after brand resolution, before any status/score work — matches the real `computeScoreSummary`/`computeTabSuccessRates`.
- `query_entries` does NOT gain a per-row removal annotation — out of scope per the spec.
- Test runner: `deno test supabase/functions/ai-assistant/tools_test.ts` (confirmed working baseline before this plan's changes: 23 tests passing).

---

### Task 1: Ported helpers, `get_removed_platform_flags` tool, and `get_score_summary` exclusion

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
- Modify: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Produces: `normalizeBrandKey(brand: string): string`, `platformRemovedKey(tab: string, brand: string, platform: Platform): string`, `buildRemovedPlatformBrandSet(rows: { tab: string; brand: string; platform: Platform }[]): Set<string>` (all exported), a module-private `fetchRemovedPlatformBrandSet(supabase: any): Promise<Set<string>>`, and `scoreSummary`'s new signature: `scoreSummary(entries: EntryRow[], platform?: Platform, removedPlatformBrands?: Set<string>): BrandScoreSummary[]` (3rd param, default `new Set()`). Task 2 consumes `platformRemovedKey`, `buildRemovedPlatformBrandSet`, and calls the same module-private `fetchRemovedPlatformBrandSet` — both tasks land in the same file, so no cross-file import is needed.

- [ ] **Step 1: Write the failing tests**

Add `platformRemovedKey`, `buildRemovedPlatformBrandSet`, `normalizeBrandKey` to the existing import block at the top of `tools_test.ts` (currently lines 3-15) — change:

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
  normalizeBrandKey,
  platformRemovedKey,
  buildRemovedPlatformBrandSet,
  EntryRow,
} from './tools.ts';
```

Add a second mock helper alongside the existing `mockSupabase` (do not modify `mockSupabase` itself — every existing test that uses it must keep working unchanged). Add this right after the existing `mockSupabase` function (currently ending at line 128):

```ts
// Like mockSupabase, but supports multiple tables — needed once a tool queries
// both `entries` and `removed_platform_brands` in the same call.
function mockSupabaseTables(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let filtered = tables[table] ?? [];
      const builder: any = {
        select(_cols: string) {
          return builder;
        },
        eq(key: string, value: string) {
          filtered = filtered.filter((r: any) => r[key] === value);
          return builder;
        },
        then(resolve: any) {
          resolve({ data: filtered, error: null });
        },
      };
      return builder;
    },
  };
}
```

Add these new tests at the end of the file (after the last existing test, `scoreSummary attaches a rating label matching the computed average`):

```ts
Deno.test('platformRemovedKey normalizes brand casing and whitespace', () => {
  assertEquals(
    platformRemovedKey('TP Brand Injection', ' Acme ', 'tp'),
    platformRemovedKey('TP Brand Injection', 'ACME', 'tp'),
  );
  assertEquals(normalizeBrandKey(' Acme '), 'acme');
});

Deno.test('buildRemovedPlatformBrandSet builds one key per row', () => {
  const set = buildRemovedPlatformBrandSet([
    { tab: 'TP Brand Injection', brand: 'Acme', platform: 'tp' },
    { tab: 'Rooster Partners', brand: 'Beta', platform: 'ag' },
  ]);
  assertEquals(set.size, 2);
  assertEquals(set.has(platformRemovedKey('TP Brand Injection', 'Acme', 'tp')), true);
  assertEquals(set.has(platformRemovedKey('Rooster Partners', 'Beta', 'ag')), true);
});

Deno.test('get_removed_platform_flags lists flagged rows, optionally filtered by tab', async () => {
  const tables = {
    removed_platform_brands: [
      { tab: 'TP Brand Injection', brand: 'Acme', platform: 'tp' },
      { tab: 'Rooster Partners', brand: 'Beta', platform: 'ag' },
    ],
  };
  const all: any = await runTool(mockSupabaseTables(tables), 'get_removed_platform_flags', {});
  assertEquals(all.flags.length, 2);

  const filtered: any = await runTool(mockSupabaseTables(tables), 'get_removed_platform_flags', { tab: 'Rooster Partners' });
  assertEquals(filtered.flags.length, 1);
  assertEquals(filtered.flags[0].brand, 'Beta');
});

Deno.test('scoreSummary excludes a brand flagged as removed for the queried platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '5' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'Acme', platform: 'tp' }]);
  const out = scoreSummary(entries, 'tp', removedSet);
  assertEquals(out.length, 0);
});

Deno.test('scoreSummary does not exclude a brand flagged as removed on a different platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'AG Review Status': 'Published', 'AG Score added': '8' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'Acme', platform: 'tp' }]);
  const out = scoreSummary(entries, 'ag', removedSet);
  assertEquals(out.length, 1);
});

Deno.test('get_score_summary end-to-end excludes a removed-flagged brand via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'Review Status': 'Published', 'Score added': '5' } },
      { id: '2', tab: 't', data: { Brand: 'Zeta', 'Review Status': 'Published', 'Score added': '4' } },
    ],
    removed_platform_brands: [
      { tab: 't', brand: 'Acme', platform: 'tp' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_score_summary', {});
  assertEquals(result.brands.length, 1);
  assertEquals(result.brands[0].brand, 'Zeta');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — `normalizeBrandKey`/`platformRemovedKey`/`buildRemovedPlatformBrandSet` are not exported from `./tools.ts` (import error), `get_removed_platform_flags` is an unknown tool, and `scoreSummary` doesn't yet accept a 3rd `removedPlatformBrands` argument.

- [ ] **Step 3: Implement the ported helpers, the new tool, and `scoreSummary`'s exclusion**

In `supabase/functions/ai-assistant/tools.ts`, insert after `isRemovedStatus` (currently ending at line 206) and before `const FIELD_KEYS` (currently line 208):

```ts
// Ported from src/lib/removedPlatformBrands.ts — keep in sync manually if either
// changes, same convention as this file's other ported helpers.
export function normalizeBrandKey(brand: string): string {
  return brand.trim().toLowerCase();
}

export function platformRemovedKey(tab: string, brand: string, platform: Platform): string {
  return `${tab}::${normalizeBrandKey(brand)}::${platform}`;
}

export function buildRemovedPlatformBrandSet(
  rows: { tab: string; brand: string; platform: Platform }[],
): Set<string> {
  return new Set(rows.map((r) => platformRemovedKey(r.tab, r.brand, r.platform)));
}

async function fetchRemovedPlatformBrandSet(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase.from('removed_platform_brands').select('tab, brand, platform');
  if (error) throw error;
  return buildRemovedPlatformBrandSet(data ?? []);
}
```

Replace `scoreSummary`'s signature line (currently):

```ts
export function scoreSummary(entries: EntryRow[], platform: Platform = 'tp'): BrandScoreSummary[] {
```

with:

```ts
export function scoreSummary(
  entries: EntryRow[],
  platform: Platform = 'tp',
  removedPlatformBrands: Set<string> = new Set(),
): BrandScoreSummary[] {
```

Inside `scoreSummary`'s loop, replace (currently):

```ts
  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;
    const status = (pick(e.data, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;
```

with:

```ts
  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;
    if (removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
    const status = (pick(e.data, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;
```

In `TOOL_DEFS`, insert a new entry after the `get_score_summary` entry and before the `get_success_rate_by_field` entry:

```ts
  {
    type: 'function',
    function: {
      name: 'get_removed_platform_flags',
      description:
        'Lists brands whose review page on a specific platform (TrustPilot, ' +
        'AskGamblers, CasinoGuru, or Wizard of Odds) was taken down entirely, ' +
        'independent of any single review\'s status. This is the direct answer to ' +
        '"is Brand X\'s TP/AG/CG/WO page removed?". Optionally filtered to one tab.',
      parameters: {
        type: 'object',
        properties: { tab: { type: 'string' } },
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
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    const platform: Platform = validPlatforms.includes(args?.platform) ? args.platform : 'tp';
    return { brands: scoreSummary(data ?? [], platform) };
  }
```

with:

```ts
  if (name === 'get_score_summary') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    const removedSet = await fetchRemovedPlatformBrandSet(supabase);
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    const platform: Platform = validPlatforms.includes(args?.platform) ? args.platform : 'tp';
    return { brands: scoreSummary(data ?? [], platform, removedSet) };
  }
```

Add a new `runTool` branch for `get_removed_platform_flags`, placed after the (just-modified) `get_score_summary` branch and before the `get_success_rate_by_field` branch:

```ts
  if (name === 'get_removed_platform_flags') {
    let q = supabase.from('removed_platform_brands').select('tab, brand, platform');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { flags: data ?? [] };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: all tests pass, including the 6 new ones (29 total, up from 23).

- [ ] **Step 5: Run `deno check` on the whole function**

Run: `deno check supabase/functions/ai-assistant/index.ts` and `deno check supabase/functions/ai-assistant/tools.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "$(cat <<'EOF'
feat: add get_removed_platform_flags and exclude removed brands from get_score_summary

New tool lists brands whose review page on a specific platform was
taken down entirely (removed_platform_brands table) — the direct
answer to "is Brand X's TP page removed?". get_score_summary now
excludes flagged brands from its star/success-rate results, matching
computeScoreSummary's exact exclude-before-bucket behavior. Ported
normalizeBrandKey/platformRemovedKey/buildRemovedPlatformBrandSet
verbatim from src/lib/removedPlatformBrands.ts.
EOF
)"
```

---

### Task 2: `get_success_rate_by_field` platform param and exclusion

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
- Modify: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes (from Task 1): `platformRemovedKey`, `buildRemovedPlatformBrandSet`, the module-private `fetchRemovedPlatformBrandSet`, `mockSupabaseTables` (test helper).
- Produces: `successRateByField`'s new signature: `successRateByField(entries: EntryRow[], field: 'proxy' | 'agent' | 'country', platform?: Platform, removedPlatformBrands?: Set<string>): FieldSuccessRate[]` (2 new params, both defaulted). This is the last task in this plan; nothing downstream depends on it beyond the tool wiring in this same task.

- [ ] **Step 1: Write the failing tests**

This step includes **rewriting two existing tests**, not just adding new ones — both currently rely on the flat, cross-platform `SUCCESS_RATE_STATUS_KEYS` fallback being retired in this task. Do not skip these rewrites; leaving the old versions in place will not compile once `successRateByField`'s signature changes.

Replace the existing test `successRateByField picks up WoO Review Status (Wizard of Odds tabs)` (currently):

```ts
Deno.test('successRateByField picks up WoO Review Status (Wizard of Odds tabs)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'Wizard of Odds', data: { Agent: 'ANN', 'WoO Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'agent');
  const ann = out.find((r) => r.value === 'ANN')!;
  assertEquals(ann.live, 1);
  assertEquals(ann.removed, 0);
  assertEquals(ann.total, 1);
});
```

with:

```ts
Deno.test('successRateByField picks up WoO Review Status (Wizard of Odds tabs)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'Wizard of Odds', data: { Agent: 'ANN', 'WoO Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'agent', 'wo');
  const ann = out.find((r) => r.value === 'ANN')!;
  assertEquals(ann.live, 1);
  assertEquals(ann.removed, 0);
  assertEquals(ann.total, 1);
});
```

Replace the existing test `successRateByField picks up AG Review Status and CG Review Status (multi-platform tabs)` (currently):

```ts
Deno.test('successRateByField picks up AG Review Status and CG Review Status (multi-platform tabs)', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'Rooster Partners', data: { Agent: 'ANN', 'AG Review Status': 'Published' } },
    { id: '2', tab: 'Rooster Partners', data: { Agent: 'BOB', 'CG Review Status': 'Removed' } },
  ];
  const out = successRateByField(entries, 'agent');
  const ann = out.find((r) => r.value === 'ANN')!;
  const bob = out.find((r) => r.value === 'BOB')!;
  assertEquals(ann.live, 1);
  assertEquals(ann.total, 1);
  assertEquals(bob.removed, 1);
  assertEquals(bob.total, 1);
});
```

with:

```ts
Deno.test('successRateByField picks up AG Review Status and CG Review Status (multi-platform tabs), scoped per platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 'Rooster Partners', data: { Agent: 'ANN', 'AG Review Status': 'Published' } },
    { id: '2', tab: 'Rooster Partners', data: { Agent: 'BOB', 'CG Review Status': 'Removed' } },
  ];
  const agOut = successRateByField(entries, 'agent', 'ag');
  const ann = agOut.find((r) => r.value === 'ANN');
  assertEquals(ann?.live, 1);
  assertEquals(ann?.total, 1);
  assertEquals(agOut.find((r) => r.value === 'BOB'), undefined);

  const cgOut = successRateByField(entries, 'agent', 'cg');
  const bob = cgOut.find((r) => r.value === 'BOB');
  assertEquals(bob?.removed, 1);
  assertEquals(bob?.total, 1);
  assertEquals(cgOut.find((r) => r.value === 'ANN'), undefined);
});
```

The other 4 existing `successRateByField` tests (`computes live/removed rate per proxy value`, `excludes rows with an undecided status`, `skips rows with no value for the requested field`, `sorts best rate first, zero-total last`) all use `'Review Status'` data and call `successRateByField(entries, <field>)` with no platform argument — leave these 4 completely unchanged; they must keep passing under the new `platform: Platform = 'tp'` default.

Add these new tests at the end of the file:

```ts
Deno.test('successRateByField excludes rows whose brand is flagged removed for the queried platform', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { Brand: 'Acme', 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
  ];
  const removedSet = buildRemovedPlatformBrandSet([{ tab: 't', brand: 'Acme', platform: 'tp' }]);
  const out = successRateByField(entries, 'proxy', 'tp', removedSet);
  assertEquals(out.length, 0);
});

Deno.test('successRateByField works normally when a row has no brand field at all', () => {
  const entries: EntryRow[] = [
    { id: '1', tab: 't', data: { 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
  ];
  const out = successRateByField(entries, 'proxy', 'tp', new Set());
  assertEquals(out.length, 1);
  assertEquals(out[0].value, 'Enigma');
});

Deno.test('get_success_rate_by_field end-to-end excludes a removed-flagged brand via runTool', async () => {
  const tables = {
    entries: [
      { id: '1', tab: 't', data: { Brand: 'Acme', 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
      { id: '2', tab: 't', data: { Brand: 'Zeta', 'Proxy Used': 'Enigma', 'Review Status': 'Published' } },
    ],
    removed_platform_brands: [
      { tab: 't', brand: 'Acme', platform: 'tp' },
    ],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_success_rate_by_field', { field: 'proxy' });
  const enigma = result.results.find((r: any) => r.value === 'Enigma');
  assertEquals(enigma.live, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: FAIL — a TypeScript error on the calls passing 3-4 arguments to `successRateByField` (still a 2-parameter function at this point), and `buildRemovedPlatformBrandSet`/`mockSupabaseTables` usage in the new tests compiling fine (both already exist from Task 1) but producing wrong results since the exclusion logic doesn't exist yet.

- [ ] **Step 3: Implement `successRateByField`'s platform param and exclusion, and update the tool wiring**

In `supabase/functions/ai-assistant/tools.ts`, delete the `SUCCESS_RATE_STATUS_KEYS` constant entirely (currently):

```ts
// Superset of STATUS_KEYS used only by successRateByField, so it can also see
// multi-platform tabs' real status columns (AG/CG/WO), which are not in the
// shared STATUS_KEYS (that constant also drives get_score_summary's
// Published-only star rollup and matchesStatus, which must stay TP-scoped).
const SUCCESS_RATE_STATUS_KEYS = [
  ...STATUS_KEYS,
  'AG Review Status',
  'CG Review Status',
  'WoO Review Status',
];
```

Nothing else references it after this task's other changes, so removing it should not cause any compile error — if `deno check` in Step 5 disagrees, that means something was missed and needs investigating, not the constant being restored.

Replace the entire `successRateByField` function (currently):

```ts
export function successRateByField(
  entries: EntryRow[],
  field: 'proxy' | 'agent' | 'country',
): FieldSuccessRate[] {
  const keys = FIELD_KEYS[field];
  const buckets = new Map<string, { live: number; removed: number }>();
  for (const e of entries) {
    const value = (pick(e.data, keys) ?? '').trim();
    if (!value) continue;
    const status = (pick(e.data, SUCCESS_RATE_STATUS_KEYS) ?? '').trim().toLowerCase();
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

with:

```ts
export function successRateByField(
  entries: EntryRow[],
  field: 'proxy' | 'agent' | 'country',
  platform: Platform = 'tp',
  removedPlatformBrands: Set<string> = new Set(),
): FieldSuccessRate[] {
  const fieldKeys = FIELD_KEYS[field];
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const buckets = new Map<string, { live: number; removed: number }>();
  for (const e of entries) {
    const value = (pick(e.data, fieldKeys) ?? '').trim();
    if (!value) continue;
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (brand && removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
    const status = (pick(e.data, statusKeys) ?? '').trim().toLowerCase();
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

In `TOOL_DEFS`, replace the `get_success_rate_by_field` entry (currently):

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
        'raw row count for that value. ' +
        'Note: on tabs tracking multiple platforms (TP+AG+CG), this resolves TrustPilot status ' +
        'first, so results here may not match a platform-scoped get_score_summary query for the ' +
        'same tab.',
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

with:

```ts
  {
    type: 'function',
    function: {
      name: 'get_success_rate_by_field',
      description:
        'Computes the same live/removed "Success Rate" shown elsewhere in the dashboard ' +
        '(Published+Live vs Removed+Refused, as a percentage), grouped by one field: proxy, ' +
        'agent, or country, for one platform: tp (TrustPilot, default), ag (AskGamblers), ' +
        'cg (CasinoGuru), or wo (Wizard of Odds). Results are sorted best-rate-first, so the ' +
        'top row answers "which X works best". Rows whose status is pending, paused, or ' +
        'otherwise undecided are not counted (contribute to neither live nor removed) — total ' +
        'may be lower than raw row count for that value.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['proxy', 'agent', 'country'] },
          platform: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] },
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
        },
        required: ['field'],
      },
    },
  },
```

In `runTool`, replace the `get_success_rate_by_field` branch (currently):

```ts
  if (name === 'get_success_rate_by_field') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { results: successRateByField(data ?? [], args?.field) };
  }
```

with:

```ts
  if (name === 'get_success_rate_by_field') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    const removedSet = await fetchRemovedPlatformBrandSet(supabase);
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    const platform: Platform = validPlatforms.includes(args?.platform) ? args.platform : 'tp';
    return { results: successRateByField(data ?? [], args?.field, platform, removedSet) };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ai-assistant/tools_test.ts`
Expected: all tests pass, including the 3 new ones and the 2 rewritten ones (32 total, up from 29).

- [ ] **Step 5: Run `deno check` on the whole function**

Run: `deno check supabase/functions/ai-assistant/index.ts` and `deno check supabase/functions/ai-assistant/tools.ts`
Expected: no errors — confirms deleting `SUCCESS_RATE_STATUS_KEYS` left no stale reference anywhere.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "$(cat <<'EOF'
feat: platform-scope get_success_rate_by_field and exclude removed brands

get_success_rate_by_field gains a platform param (tp/ag/cg/wo,
default tp), resolving status via the same PLATFORM_STATUS_KEYS
get_score_summary already uses instead of the flat, TP-biased
SUCCESS_RATE_STATUS_KEYS (deleted). This fixes the inconsistency
flagged in Phase 2's final review: the two tools can no longer
contradict each other on multi-platform tabs. Also excludes
removed-flagged brands, matching get_score_summary's Task 1 behavior.
Two existing tests that relied on the old cross-platform fallback are
rewritten to be platform-scoped and now additionally prove platform
isolation (an AG-scoped query correctly can't see a CG-only row).
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Spec's "1. Ported helpers" and "async fetchRemovedPlatformBrandSet" → Task 1 Step 3. "2. New tool: get_removed_platform_flags" → Task 1 Step 3 (TOOL_DEFS entry + runTool branch). "3. get_score_summary gains exclusion" → Task 1 Step 3 (`scoreSummary` signature + loop change + runTool branch). "4. get_success_rate_by_field gains a platform param and exclusion" (including deleting `SUCCESS_RATE_STATUS_KEYS`, dropping the now-false Phase 2 caveat from its description) → Task 2 Step 3. The spec's "Deliberate test breakage" section (the 2 rewritten tests, exact old/new behavior) → Task 2 Step 1. The spec's "Testing" section's bullets all map to specific tests across both tasks' Step 1: key-format/set-building tests → Task 1; `get_removed_platform_flags` via `runTool` → Task 1; `scoreSummary` platform-scoped exclusion (both "excluded" and "not excluded on different platform" cases) → Task 1; `successRateByField` platform param + exclusion tests → Task 2; both end-to-end `runTool` tests → one per task.
- **Placeholder scan:** No TBD/TODO; every step has literal, complete code — full old/new blocks for every modification, not diffs or descriptions.
- **Type consistency:** `Platform` is used identically across both tasks (reused from Phase 2, never redeclared). `Set<string>` is the consistent type for `removedPlatformBrands` in both `scoreSummary` (Task 1) and `successRateByField` (Task 2). `platformRemovedKey(tab: string, brand: string, platform: Platform): string` (Task 1) is called identically in `scoreSummary`'s loop (Task 1) and `successRateByField`'s loop (Task 2). `mockSupabaseTables` (Task 1's test helper) is reused without modification in Task 2's new tests. `fetchRemovedPlatformBrandSet` (Task 1, module-private) is called identically in both `runTool` branches.
