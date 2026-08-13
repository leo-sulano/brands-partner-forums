# "No Proxy" Group Design

**Goal:** Add a "No Proxy" group covering blank Proxy Used values and any proxy value that
doesn't belong to one of the 4 currently-active proxy providers (Enigma, Proxio, Proxylite,
SpyderProxy). It must appear consistently in Overview's Proxy filter dropdown, Overview's Proxy
Breakdown section, and BrandGroup.tsx's (Brand Tabs) own per-tab Proxy filter dropdown.

**Scope:** Additive only — existing recognized-provider values keep their current per-instance
granularity (e.g. "Enigma-US1" and "Enigma-US2" remain two distinct entries). "No Proxy" is one
new bucket added alongside them, not a regrouping of everything to provider level.

## Architecture

A single new classification function, `resolveProxyLabel`, becomes the one place that decides
whether a raw `Proxy Used` value is a real, recognized proxy or falls into `"No Proxy"`. Every
consumer (breakdown maps, distinct-value lists, filter matching, on both Overview and Brand
Tabs) is re-pointed at this one function instead of using the raw field value directly, so the
two pages cannot silently disagree about what counts as "no proxy" — the same class of drift
this project's cross-dashboard consistency rule exists to prevent.

This exactly mirrors an existing, shipped pattern: `src/lib/countryFlags.ts`'s
`resolveCountryLabel(data, tab)` already does the identical thing for Country
(`getEntryCountry(...) || 'Unknown'`), and every Country consumer already reads through it.

## Component 1: `src/lib/proxyAliases.ts` — classification

Add:

```ts
const ACTIVE_PROXY_PROVIDERS = ['Enigma', 'Proxio', 'Proxylite', 'SpyderProxy'];

export const NO_PROXY_LABEL = 'No Proxy';

function isActiveProxyProvider(canonicalName: string): boolean {
  const lower = canonicalName.toLowerCase();
  return ACTIVE_PROXY_PROVIDERS.some((p) => lower.startsWith(p.toLowerCase()));
}

// A raw Proxy Used value, folded into the shared "No Proxy" bucket if it's blank, a redacted
// placeholder, or doesn't start with one of the 4 currently-active proxy providers (after
// typo-correction via PROXY_ALIASES) -- same rationale as resolveCountryLabel's "Unknown": turns
// "no real active proxy" into one real, filterable, canonicalizable identity instead of a value
// every proxy-identity consumer has to separately skip or fall silent on.
export function resolveProxyLabel(rawProxy: string | null | undefined): string {
  const trimmed = (rawProxy ?? '').trim();
  if (!trimmed || isRedactedProxyValue(trimmed)) return NO_PROXY_LABEL;
  const canonicalName = canonicalProxyName(trimmed);
  return isActiveProxyProvider(canonicalName) ? canonicalName : NO_PROXY_LABEL;
}
```

**Matching rule:** starts-with, case-insensitive, after `PROXY_ALIASES` typo-correction (e.g.
`"Enigma-US1"`, `"enigma_de2"`, `"proylite-1"` all resolve to a real provider). Anything that
doesn't start with one of the 4 names — a decommissioned provider, free text, a mistyped name
with no alias entry — resolves to `"No Proxy"`, same as blank or a `*****`-redacted value.

## Component 2: `src/lib/queries.ts` — `computeTabKpisFromEntries`

- Delete the local `proxyValue()` helper (its redaction-check responsibility moves into
  `resolveProxyLabel`).
- The 4 call sites that currently pass raw `Proxy Used` values into `proxies`, `byProxy`, and
  proxy-filter matching switch to `resolveProxyLabel(d['Proxy Used'])`. `canonicalProxyKey` /
  `canonicalProxyName` remain the `keyFn`/`labelFn` args to `uniqueDisplayValues`/
  `addToBreakdown`, unchanged — they still dedupe casing variants of the same real value (and of
  `"No Proxy"` itself, trivially).
- Net effect: `"No Proxy"` becomes a real entry in `TabKpis.proxies` and `TabKpis.byProxy` for
  any tab with a qualifying entry. No changes needed in `overviewBreakdown.ts` — `mergeBreakdownMaps`
  /`topNWithOther`/`mergeDistinctValues` are generic over whatever keys/labels they're given.

## Component 3: `src/pages/Overview.tsx`

- **Proxy Breakdown tiles** and **`openDimensionSlice`'s modal icon selection**: treat a card
  whose label is `NO_PROXY_LABEL` the same neutral way Country Breakdown already treats
  `"Unknown"` (`card.key === 'unknown'`) — muted gray accent color, skip the `proxyIconUrl`
  favicon-guess lookup, plain `Shield` fallback icon. It still opens the normal per-tab
  `SliceBreakdownModal` on click like any real bucket (it is not folded into "Other" — "Other" is
  reserved for long-tail real values past the top-8 cap, and `topNWithOther` ranks `"No Proxy"`
  by volume like any other entry per the earlier confirmed design choice).
- **Filter dropdown**: no code change — it already reflects whatever `allProxies` (built from
  `TabKpis.proxies`) contains.
- **Known caveat, not fixed here:** the "`X of Y accounts have a proxy recorded`" caption will
  read `100%` once every live/removed entry always resolves to some bucket (real provider or "No
  Proxy") rather than being skipped when blank. This is not a new problem: Country Breakdown's
  identical caption already reads 100% today for the same reason (`resolveCountryLabel` never
  returns blank either — "Unknown" already absorbs every case). Left as-is for consistency with
  the existing, already-shipped Country behavior rather than fixing the wording on only one
  dimension.

## Component 4: `src/pages/BrandGroup.tsx`

- `uniqueProxies` and `proxyFiltered` switch from reading `e.data['Proxy Used']` raw to
  `resolveProxyLabel(e.data['Proxy Used'])`. This adds `"No Proxy"` as a selectable dropdown
  option and, as a side effect of routing through the shared function, correctly folds redacted
  (`*****`) values into it — a latent inconsistency this page had (it never checked
  `isRedactedProxyValue`, unlike Overview's now-deleted `proxyValue()`).
- **Check Status scope** (`proxy: proxyFilter.length === 1 ? proxyFilter[0] : undefined`): add a
  guard so a lone `NO_PROXY_LABEL` selection also widens to unscoped (`undefined`) rather than
  being sent to the live external Check Status API, which has no concept of a synthetic "No
  Proxy" value — the exact same fallback this code already uses when 2+ real values are selected.

## Testing

- `src/lib/proxyAliases.test.ts`: classification matrix for `resolveProxyLabel` — blank, redacted,
  each of the 4 providers (including a casing variant and an existing alias like `"proylite"`),
  and an unrecognized/decommissioned value.
- `src/lib/queries.test.ts`: `computeTabKpisFromEntries` tests confirming blank/unrecognized
  `Proxy Used` values now appear under `"No Proxy"` in `byProxy`/`proxies` instead of being
  skipped, and that `proxyFilter: ['No Proxy']` matches exactly those entries.
- BrandGroup-side: whatever existing test coverage touches `uniqueProxies`/`proxyFiltered`/Check
  Status scope building gets the equivalent new cases; if none currently exists for these
  specific functions, add focused tests rather than skipping coverage for the changed behavior.
- Full suite (`npm test`) and `npm run build` must pass; no schema change, no live/manual
  verification required (pure client-side classification logic, no new Supabase dependency).
