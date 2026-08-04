# Ask AI Full Coverage — Phase 3: TP/AG/CG/WO-Removed Brand Flags

## Problem

The dashboard tracks a fact independent of any single review's status: a brand's
review page on a specific platform (TrustPilot, AskGamblers, CasinoGuru, Wizard of
Odds) can be delisted entirely. Flagged `(tab, brand, platform)` triples live in
`removed_platform_brands` (`src/lib/removedPlatformBrands.ts`), and every real
dashboard reader — `BrandGroup`'s badges, `computeScoreSummary`/`computeSuccessRates`,
the Edit Entry checkboxes — excludes flagged brands from aggregate star
counts/Success Rate, or badges them visibly. Ask AI currently has no visibility into
this table at all: it can't answer "is Brand X's TP page removed?", and its
aggregate tools (`get_score_summary` from Phase 2, `get_success_rate_by_field` from
Phase 1) silently include removed-flagged brands in their numbers — a real
divergence from what the dashboard itself shows for the same data. Phase 2's
`scoreSummary()` deliberately omitted a `removedPlatformBrands` parameter, explicitly
deferring this exclusion to this phase.

This is Phase 3 of a 4-phase plan. Phase 4 (Schedule Planner state) remains a
separate, future spec.

## A scope decision made during brainstorming

Removed-brand exclusion is inherently platform-specific — a brand's TP page can be
removed while its AG page is fine. `get_score_summary` already has a `platform`
param (Phase 2) so exclusion is straightforward there. `get_success_rate_by_field`
(Phase 1) has no platform concept — it resolves status via a flat,
TP-status-checked-first key list (`SUCCESS_RATE_STATUS_KEYS`), a gap Phase 2's final
review already flagged as needing a `platform` param. That fix and this phase's
exclusion work are the same piece of work: you cannot correctly exclude
"TP-removed" rows from a tool that doesn't know it's looking at TP data. Confirmed
during brainstorming: fold the platform-param fix into this phase rather than defer
it again.

## Design

### 1. Ported helpers (from `src/lib/removedPlatformBrands.ts`, verbatim)

```ts
export type RemovedPlatform = 'tp' | 'ag' | 'cg' | 'wo'; // same values as Platform; see note below
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
```

`Platform` already exists in `tools.ts` since Phase 2 (`'tp' | 'ag' | 'cg' | 'wo'`)
— reuse it directly, do not declare a second `RemovedPlatform` type (the line above
is illustrative only; the real implementation reuses `Platform`).

New async helper, used by all three tools below so the fetch isn't duplicated:

```ts
async function fetchRemovedPlatformBrandSet(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase.from('removed_platform_brands').select('tab, brand, platform');
  if (error) throw error;
  return buildRemovedPlatformBrandSet(data ?? []);
}
```

Matches `src/lib/queries.ts`'s `fetchRemovedPlatformBrands()` exactly — same table,
same three-column selection, no `removed_by`/`removed_at` (the frontend doesn't
fetch those either; badges only need the existence fact).

### 2. New tool: `get_removed_platform_flags`

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

```ts
if (name === 'get_removed_platform_flags') {
  let q = supabase.from('removed_platform_brands').select('tab, brand, platform');
  if (args?.tab) q = q.eq('tab', args.tab);
  const { data, error } = await q;
  if (error) throw error;
  return { flags: data ?? [] };
}
```

The table is small (14 rows originally); returning the whole, optionally
tab-filtered list is simplest — no pagination needed.

### 3. `get_score_summary` gains exclusion

`scoreSummary()`'s signature:

```ts
export function scoreSummary(
  entries: EntryRow[],
  platform: Platform = 'tp',
  removedPlatformBrands: Set<string> = new Set(),
): BrandScoreSummary[] {
```

Exclusion check placed immediately after brand resolution, before any status/score
work — same position as the real `computeScoreSummary`:

```ts
const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
if (!brand) continue;
if (removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
const status = (pick(e.data, statusKeys) ?? '').trim().toLowerCase();
```

`runTool`'s `get_score_summary` branch calls `fetchRemovedPlatformBrandSet(supabase)`
alongside its existing `entries` fetch and passes the result through.

### 4. `get_success_rate_by_field` gains a `platform` param and exclusion

```ts
export function successRateByField(
  entries: EntryRow[],
  field: 'proxy' | 'agent' | 'country',
  platform: Platform = 'tp',
  removedPlatformBrands: Set<string> = new Set(),
): FieldSuccessRate[] {
  const statusKeys = PLATFORM_STATUS_KEYS[platform]; // was SUCCESS_RATE_STATUS_KEYS
  const fieldKeys = FIELD_KEYS[field];
  const buckets = new Map<string, { live: number; removed: number }>();
  for (const e of entries) {
    const value = (pick(e.data, fieldKeys) ?? '').trim();
    if (!value) continue;
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (brand && removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
    const status = (pick(e.data, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;
    // ...rest unchanged (bucket live/removed counting, sort)
  }
  ...
}
```

`SUCCESS_RATE_STATUS_KEYS` constant is deleted — nothing uses it after this change.
Brand resolution is conditional (`if (brand && ...)`) since a proxy/agent/country row
might not always resolve a brand, matching `computeTabSuccessRates`'s same
conditional pattern.

`TOOL_DEFS`'s `get_success_rate_by_field` entry gains a `platform` param (enum
`tp`/`ag`/`cg`/`wo`, defaults to `tp`) and its description drops the "on
multi-platform tabs this resolves TrustPilot status first" caveat added in Phase
2's fix wave — that caveat is no longer true once this phase ships, since the tool
is now genuinely platform-scoped like `get_score_summary`.

`runTool`'s branch:

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

### Deliberate test breakage (the one exception to prior phases' "zero edits" pattern)

Two of the six existing `successRateByField` tests exercised the old
merged-across-all-platforms fallback being retired here, and cannot pass unchanged:

- `successRateByField picks up WoO Review Status (Wizard of Odds tabs)` — currently
  calls `successRateByField(entries, 'agent')` relying on implicit cross-platform
  key matching. Must become `successRateByField(entries, 'agent', 'wo')`.
- `successRateByField picks up AG Review Status and CG Review Status (multi-platform
  tabs)` — currently mixes an AG row and a CG row in **one call** with no platform
  argument. A single call can no longer span two platforms; this test must split
  into two separate calls (`platform: 'ag'` checking the AG row, `platform: 'cg'`
  checking the CG row).

The other four existing `successRateByField` tests (proxy/country grouping, using
`'Review Status'` data) keep passing unchanged under the new `platform: Platform =
'tp'` default, since `'Review Status'` is in `PLATFORM_STATUS_KEYS.tp`.

## Out of scope

- `query_entries` does not gain a per-row "is this brand removed" annotation. The
  dedicated `get_removed_platform_flags` tool already answers that; annotating
  every row would add token cost for a rarely-needed flag.
- No UI/frontend changes — this is entirely the Edge Function.
- Phase 4 (Schedule Planner state) untouched.
- `removed_by`/`removed_at` are not exposed by `get_removed_platform_flags` —
  matches `queries.ts`'s existing minimal selection; add later only if a real need
  for "who flagged this and when" surfaces.

## Testing

- `fetchRemovedPlatformBrandSet` / `buildRemovedPlatformBrandSet` / `platformRemovedKey`:
  unit tests confirming the key format and that duplicate/normalization (case,
  whitespace) collapses correctly, matching `normalizeBrandKey`.
- `get_removed_platform_flags` via `runTool` with a mock Supabase client: returns
  the flagged rows, respects an optional `tab` filter.
- `scoreSummary` with a non-empty `removedPlatformBrands` set: a brand flagged for
  the queried platform is fully excluded (no result row at all, not just
  zeroed-out counts) — matching `computeScoreSummary`'s exact exclude-before-bucket
  behavior. A brand flagged on a *different* platform than the one queried still
  appears normally (proves the exclusion is platform-scoped, not brand-wide).
- `successRateByField` with the new `platform` param: the two updated tests (WoO,
  AG+CG-split) plus a new exclusion test — a brand flagged for the queried platform
  contributes no rows to any bucket, even though grouping is by proxy/agent/country,
  not brand.
- `runTool('get_score_summary', ...)` and `runTool('get_success_rate_by_field',
  ...)` end-to-end tests via a mock Supabase client returning both `entries` and
  `removed_platform_brands` rows, confirming the flagged brand is genuinely absent
  from the tool's output, not just from the pure function in isolation.
