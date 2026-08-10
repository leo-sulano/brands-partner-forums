# Overview Platform Filter — Design

**Date:** 2026-08-10
**Status:** Approved (pending spec review)

## Problem

The Overview tab's top filter row has Country, Proxy, and Date Range filters, but no way to scope the page to a single review platform (TrustPilot, AskGamblers, CasinoGuru, Wizard of Odds). A user who only cares about, say, CasinoGuru performance has to mentally filter the combined numbers themselves.

Note: the original task description also mentioned scoping "the recent-mentions table," but Overview has no mentions table today — `MentionsTable.tsx` exists in the repo but is not wired into any route (leftover scaffolding from an earlier design). This spec deliberately excludes it; scope is limited to what Overview actually renders: the 3 global KPI cards, the "Brands Performance" per-tab grid, the "Platform Breakdown" donut section, and the Country/Proxy breakdown sections.

## Existing building blocks this reuses

- **`Platform` type** (`src/lib/removedPlatformBrands.ts:10`): `'tp' | 'ag' | 'cg' | 'wo'`, re-exported from `scoreSummary.ts`.
- **`platformFilter` pattern**: both `BrandGroup.tsx` (`'all' | 'tp' | 'ag' | 'cg' | 'wo'` union) and `ScoreSummaryPanel.tsx` already have their own independent single-platform filter, persisted via URL param + localStorage. Overview's filter follows the same URL/localStorage persistence convention but is implemented locally to Overview (matching this codebase's existing convention of page-local filter UI/state rather than a shared abstraction — neither of the other two implementations is currently extracted into a shared component either).
- **`computeTabKpisFromEntries`** (`src/lib/queries.ts:370-512`) already computes per-platform `tp`/`ag`/`cg`/`wo` `{live, removed}` sub-counts (lines 397-454) and a locally-resolved `activePlatforms: ('tp'|'ag'|'cg'|'wo')[]` array (lines 488-492, derived from which status columns actually resolve on that tab's real headers) — this is more accurate than the static `getTabPlatforms` in `tab-configs.ts` (which is driven by a hardcoded column whitelist) since it reflects the tab's real resolved headers, and it's already rendered in the "Brands Performance" grid today (`Overview.tsx:697-702`) as platform badges. This spec reuses `activePlatforms` (not `getTabPlatforms`) to decide whether a tab tracks the filtered platform.

## UI & State

- New `platformFilter` state on `Overview.tsx`, type `'all' | Platform`, default `'all'`.
- Read from URL `?platform=` param (validated against `['tp','ag','cg','wo']`, anything else falls back to `'all'`) — URL param only, no localStorage. Correction from an earlier draft of this spec: Overview's existing Country/Proxy/Date Range filters have no localStorage persistence today (only Score Summary's own page does that, for itself) — adding it just for Platform would be a new, inconsistent behavior on this page. Omit the param from the URL when `'all'` to keep URLs clean, matching how Country/Proxy already omit their params when empty (`Overview.tsx:499-505`).
- Rendered via the existing `BrandFilterDropdown` component (`src/components/BrandFilterDropdown.tsx`), the same pill control already used for Country/Proxy: `<BrandFilterDropdown noun="platform" value={platformFilter === 'all' ? '' : platformFilter.toUpperCase()} onChange={...} brands={['TP','AG','CG','WO']} />`. `BrandFilterDropdown` treats `value === ''` as "no filter" (button reads "All platforms") and any non-empty `value` as the active selection (button reads that value, with an inline clear-×) — no changes to that component needed.
- Positioned **first** in the filter row (`Overview.tsx:566` onward), before Date Range/Country/Proxy — it's unconditionally visible (no `.length > 1` gate like Country/Proxy have, since all 4 platforms are always structurally possible even if a given data set happens to have none of one).
- The existing "Clear" button (`Overview.tsx:607-615`) is extended to also reset `platformFilter` to `'all'`, and its visibility condition additionally checks `platformFilter !== 'all'`.
- Country/Proxy dropdown option lists (`allCountries`/`allProxies`, `Overview.tsx:456-457`) are **not** narrowed by the platform filter — they stay built from all tabs' full data regardless of `platformFilter`, per your explicit call to keep this simple and avoid the options list jumping around as the user changes platforms.

## Data flow & computation

### `computeTabKpisFromEntries` (`src/lib/queries.ts:370-512`)

New optional parameter, appended after the existing `proxyFilter?: string`:

```ts
export function computeTabKpisFromEntries(
  entries: Entry[],
  rawHeaders: string[],
  tab: string,
  brandCol: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  removedPlatformBrands: Set<string>,
  countryFilter?: string,
  proxyFilter?: string,
  platformFilter?: Platform,   // NEW — undefined/omitted = today's existing OR-across-platforms behavior
): TabKpis | null                // NEW — null replaces TabKpis only when platformFilter is set and this tab doesn't track it
```

Behavior:

- **`platformFilter` omitted** — 100% unchanged: existing OR-across-all-platforms logic (lines 463-486) runs exactly as today. This keeps every existing caller/test passing untouched (Score Summary and Brand Tabs each already do their own thing and don't call this function with the new param).
- **`platformFilter` set to a specific platform**, e.g. `'cg'`:
  1. After computing `activePlatforms` (lines 488-492 — moved earlier in the function, before the entries loop, since the null-check needs it), if `!activePlatforms.includes(platformFilter)`, return `null` immediately (this tab structurally doesn't track CG — no column resolved). No further computation runs for this tab.
  2. Otherwise, inside the per-entry loop (replacing the `statuses` array logic at lines 463-469 with a single-platform branch), `live`/`removed`/`done`/`pending`/`onPause`/`notDone` and the `byCountry`/`byProxy` breakdowns are populated using **only** that platform's already-computed `{tp,ag,cg,wo}DateOk` / `isPlatformFlagged(platformFilter)` / raw status value (lines 436-454's per-platform variables, already computed for the `tpLive`/`tpRemoved`-style sub-counts) — the same per-platform gating already used for `cgLive`/`cgRemoved`, just also driving the aggregate counters instead of the 4-way OR. The generic-status fallback (`genericInRange`, lines 440-449) is intentionally **not** included in the single-platform path — it only fires when a row's tp/ag/cg/wo are *all* blank, which doesn't belong to any one specific platform, consistent with the fact that `cgLive`/`cgRemoved` etc. never consult the generic fallback either.
  3. `total = live + removed` (unchanged formula, now scoped to the one platform).
  4. The `tp`/`ag`/`cg`/`wo` sub-count fields and `activePlatforms` on the returned object are unaffected by `platformFilter` — always computed the same way regardless (needed so `platformData`'s Platform Breakdown donut still has real numbers on the `'all'` view, and so the "Brands Performance" grid's per-tab platform badges stay correct).

### `fetchTabKpis` (`src/lib/queries.ts:514-528`)

Gains the same new optional `platformFilter?: Platform` param, threaded straight through to `computeTabKpisFromEntries`, return type becomes `Promise<TabKpis | null>`.

### `Overview.tsx`

- `platformFilter` state (see above) is passed into every `fetchTabKpis` call inside `loadData` (`Overview.tsx:429-435`) as `platformFilter === 'all' ? undefined : platformFilter`.
- Tabs whose `fetchTabKpis` call resolves to `null` are filtered out of `tabResults` before `setState` — they simply don't appear in `state.tabs`, which means they vanish from the "Brands Performance" grid (`Overview.tsx:664-724`) and don't contribute to `totalAccounts`/`totalLive`/`totalRemoved` (lines 452-454) or the Country/Proxy breakdown aggregations (lines 456-466), since all of those already derive purely from `state.tabs`. No changes needed to those reducers themselves.
- The existing `.catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))` fallback (`Overview.tsx:433`) is unaffected — a fetch error still shows as zeros for that tab, distinct from a clean "doesn't track this platform" exclusion.
- **Platform Breakdown donut section** (`Overview.tsx:726-761`): wrapped in `platformFilter === 'all' &&`, hidden entirely otherwise (its whole point — comparing platforms against each other — is moot once scoped to one).
- No changes needed to the Country/Proxy breakdown sections' rendering code (`Overview.tsx:763+`) — they already just read `byCountry`/`byProxy` off `state.tabs`, which is now platform-scoped data when a filter is active.

## Testing & verification

- **Unit tests** (alongside existing `computeTabKpisFromEntries` tests, likely `src/lib/queries.test.ts` or wherever that suite lives):
  - Tab whose `activePlatforms` doesn't include the requested `platformFilter` → returns `null`.
  - Tab that does track it → `live`/`removed`/`total` match a hand-computed expectation using only that platform's status column, independent of other platforms' statuses on the same rows.
  - `byCountry`/`byProxy` correctly scoped to platform-filtered rows only.
  - `removedPlatformBrands` per-platform exclusion still applies under a filter (a CG-flagged brand is excluded when `platformFilter='cg'` but still counted when `platformFilter` is unset/`'all'` and the row has other live/removed platform statuses).
  - `platformFilter` omitted → byte-for-byte identical output to the current (pre-change) behavior, as a regression lock.
- **Build**: `npm run build` (this repo's `tsc --noEmit` doesn't check anything meaningful — root tsconfig is references-only, per standing project knowledge).
- **Live verification**: in the browser against real Supabase data — toggle All → TP → AG → CG → WO and back, confirming: tabs appear/disappear correctly in Brands Performance per platform coverage, the 3 global KPI cards and Country/Proxy breakdowns update to platform-scoped numbers, the donut section hides whenever a specific platform is selected and reappears on "All", and the URL `?platform=` param + a page reload correctly restore the selection.
- Per this project's standing cross-dashboard-consistency requirement, a final whole-branch review should confirm this change doesn't touch or regress Score Summary's or Brand Tabs' own independent `platformFilter` implementations, even though it only touches Overview and `queries.ts`.

## Out of scope

- No recent-mentions table (see Problem section).
- No narrowing of Country/Proxy dropdown option lists by the selected platform.
- No changes to `BrandGroup.tsx`'s or `ScoreSummaryPanel.tsx`'s own platform filters — this is a third, independent implementation of the same UX concept, consistent with how those two already independently implement it from each other.
