# Ask AI — Close Known Drift Gaps + Prevent Future Ones

## Requirement (from user conversation)

User asked whether Ask AI (`supabase/functions/ai-assistant/`) reflects the
dashboard's latest changes. It does not, on two counts already documented in
CLAUDE.md's Known Issues:

- `get_success_rate_by_field` buckets proxy values by raw `Proxy Used` text,
  unaware of Task 218's `resolveProxyLabel`/"No Proxy" classification.
- `get_schedule`/`get_paused_combos` read raw `brand_schedule`/
  `brand_platform_pause` rows with no awareness of Task 207's
  `schedule_hidden_brands`/`schedule_platform_restrictions` tables, so they
  can confidently describe a brand+platform combo the Schedule Planner UI no
  longer shows at all.

User confirmed: fix both now, and also stop this class of gap from
recurring. Deploy is explicitly out of scope for this task — code lands
committed, `supabase functions deploy ai-assistant` is a separate, later,
manually-triggered step (matches this project's established pattern for
edge function changes).

## Current behavior (for reference)

`tools.ts` is a deliberately self-contained file (per its own header
comment) — "pure helpers... are ported from `src/lib/queries.ts` and
`src/lib/scoreSummary.ts`" rather than imported, so the function has "no
runtime dependency on frontend files." It currently has **zero** `import`
statements. This design predates a later, now-established precedent:
`generate-weekly-schedule/index.ts` (built after `ai-assistant`, 2026-08-06)
imports real `src/lib/*` modules directly — `queries.ts`,
`removedPlatformBrands.ts`, `scheduleBrandConfig.ts`, `tab-configs.ts` — with
no import-map friction, because those modules have no npm/browser-only
dependencies. `ai-assistant` was never brought in line with that precedent.

Two of `tools.ts`'s already-hand-ported helpers are directly relevant here:

- `successRateByField` (`tools.ts:284`) resolves the grouping value via
  `pick(e.data, fieldKeys)`, skipping the row entirely if blank
  (`tools.ts:294-295`). This applies uniformly to `proxy`/`agent`/`country`
  — there's no proxy-specific handling.
- `get_schedule`/`get_paused_combos` (`tools.ts:724-745`) query
  `brand_schedule`/`brand_platform_pause` directly and return all matching
  rows, with no filtering against hidden or platform-restricted brands.

The real, Deno-safe fixes for both already exist and are already imported
elsewhere in this codebase:

- `resolveProxyLabel` (`src/lib/proxyAliases.ts`) — no imports at all, pure
  string logic. Folds blank/redacted values into `NO_PROXY_LABEL`
  (`"No Proxy"`); passes any other value through (typo-corrected).
- `buildHiddenBrandSet`, `buildPlatformRestrictionMap`, `scheduleBrandKey`
  (`src/lib/scheduleBrandConfig.ts`) — imports only `normalizeBrandKey` and
  the `Platform` type from `src/lib/removedPlatformBrands.ts`, itself
  import-free. `tools.ts` already independently defines a structurally
  identical local `Platform = 'tp' | 'ag' | 'cg' | 'wo'` type
  (`tools.ts:106`) and its own `normalizeBrandKey`/`platformRemovedKey`
  equivalents — no type import needed, no naming collision, since these
  functions are consumed purely at the value level.

Neither module needs a `deno.json` import map: `ai-assistant` has none
today (it imports `@supabase/supabase-js` via a bare `esm.sh` URL in
`index.ts`, not a bare specifier), and neither `proxyAliases.ts` nor
`scheduleBrandConfig.ts` pulls in any npm package.

Separately: CLAUDE.md's standing cross-dashboard-consistency rule already
names Ask AI explicitly ("...every other surface that shares the same
data/logic (Overview, Score Summary, Brand Tabs, Schedule Planner, **Ask
AI**, etc.)"). Both Task 207 and Task 218 nonetheless treated `ai-assistant`
as out of scope, each writing a Known Issues entry to that effect on the
grounds that it's "a separately-deployed Deno function." That informal
override — never itself written down — is the actual gap; the rule already
covers Ask AI by name.

## Change

### 1. `successRateByField` — proxy "No Proxy" bucketing

Add the import:

```ts
import { resolveProxyLabel } from '../../../src/lib/proxyAliases.ts';
```

In `successRateByField` (`tools.ts:294`), branch the value resolution on
`field`:

```ts
const value = field === 'proxy'
  ? resolveProxyLabel(pick(e.data, fieldKeys))
  : (pick(e.data, fieldKeys) ?? '').trim();
if (!value) continue;
```

`resolveProxyLabel` never returns blank (falls back to `"No Proxy"`), so the
subsequent `if (!value) continue` is a no-op for `proxy` and unchanged for
`agent`/`country`. Net effect: a blank or redacted (`"*****"`-style) proxy
value now buckets under `"No Proxy"` instead of being silently dropped from
the results — matching Overview's Proxy Breakdown and Brand Tabs' proxy
filter.

### 2. `get_schedule` / `get_paused_combos` — hidden/restricted brands

Add the import:

```ts
import { buildHiddenBrandSet, buildPlatformRestrictionMap, scheduleBrandKey } from '../../../src/lib/scheduleBrandConfig.ts';
```

Add two small unscoped fetchers, matching the existing
`fetchRemovedPlatformBrandSet` pattern (`tools.ts:264-268`) of always
fetching the whole table rather than filtering server-side by `args?.tab`:

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
```

In both `get_schedule` and `get_paused_combos` (`tools.ts:724-745`), fetch
these in parallel with the main query (same `Promise.all` pattern already
used for `removedSet` in `get_score_summary`/`get_success_rate_by_field`),
then filter the returned rows:

```ts
const filtered = (data ?? []).filter((row) => {
  const key = scheduleBrandKey(row.tab, row.brand);
  if (hiddenSet.has(key)) return false;
  const restriction = restrictionMap.get(key);
  if (restriction && row.platform && row.platform !== restriction) return false;
  return true;
});
```

A row with `platform: null` (legacy, pre-platform-tracking week) is
unaffected by a restriction — a restriction only ever targets a specific
real platform — but is still dropped if its brand is hidden. Net effect:
both tools' results now match what a Schedule Planner user actually sees —
a hidden brand never appears, and a platform-restricted brand's other
platforms never appear as if they were still schedulable.

### 3. CLAUDE.md — close the informal override

Add one sentence to the existing cross-dashboard-consistency bullet in
CLAUDE.md, immediately after its current text: Ask AI's separate deployment
step is not an exemption from the rule that already names it — a task that
changes logic `tools.ts` duplicates must update `tools.ts` (with tests) in
the same task; only the `supabase functions deploy ai-assistant` step
itself may be deferred and flagged as a pending manual step, the same way
other edge function deploys already are in this project's task history.

## Out of scope

- Rewriting `tools.ts`'s hand-ported `pick()`/`scoreSummary()`/
  `successRateByField()` core logic to import `src/lib/scoreSummary.ts`
  directly (Approach A from brainstorming). Bigger blast radius on
  already-working live logic; the existing documented `pick()`
  trim/`successRate` rounding divergence stays as-is, still tracked in
  Known Issues.
- Any change to `index.ts`, the OpenAI tool schemas/descriptions, or the
  system prompt.
- Actually running `supabase functions deploy ai-assistant` — confirmed
  out of scope with user; code lands committed only.
- Any schema change — `schedule_hidden_brands`/`schedule_platform_restrictions`/
  `proxyAliases.ts` all already exist and are unchanged by this task.

## Testing approach

TDD, per project standard. `tools_test.ts` already has direct unit-test
coverage of `successRateByField`/`scoreSummary` as pure functions (not just
through `runTool`), so new tests are added at that level:

1. `successRateByField(entries, 'proxy', ...)`: an entry with a blank
   `Proxy Used` and one with a redacted (`"*****"`) value both land in a
   `"No Proxy"` bucket alongside each other, distinct from a real proxy
   name's bucket. `'agent'`/`'country'` fields keep today's skip-if-blank
   behavior (regression case).
2. A row filtering test (either as a small exported helper or inline in
   `runTool`'s `get_schedule`/`get_paused_combos` branches, whichever the
   existing test file's structure makes cleaner to reach) for: a hidden
   brand's row is excluded; a platform-restricted brand's non-allowed-platform
   row is excluded while its allowed-platform row is kept; a legacy
   (`platform: null`) row for a restricted (not hidden) brand is kept.
3. `deno check` and `deno test --allow-env --allow-net` (this function's
   existing verification commands, per project history) both pass.
4. `npm run build` passes (CLAUDE.md's process-fix sentence is markdown
   only, but the touched TS files are re-verified for the frontend side
   too, since `scheduleBrandConfig.ts`/`proxyAliases.ts` are shared).
