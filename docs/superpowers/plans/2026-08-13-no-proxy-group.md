# No Proxy Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "No Proxy" group — covering blank Proxy Used values and any value that doesn't
belong to one of the 4 active providers (Enigma, Proxio, Proxylite, SpyderProxy) — to Overview's
Proxy filter dropdown, Overview's Proxy Breakdown section, and BrandGroup.tsx's per-tab Proxy
filter dropdown.

**Architecture:** One new classification function, `resolveProxyLabel` (`src/lib/proxyAliases.ts`),
becomes the single place that decides whether a raw `Proxy Used` value is a real recognized proxy
or falls into `"No Proxy"`. `queries.ts` and `BrandGroup.tsx` are both re-pointed at it instead of
reading the raw field directly, so the two pages can't disagree about what counts as "no proxy" —
mirroring the already-shipped `resolveCountryLabel` → `"Unknown"` pattern in `countryFlags.ts`.

**Tech Stack:** Vite 6 · React 19 · TypeScript · Tailwind v4 · Recharts · Vitest

## Global Constraints

- TypeScript strict mode. No `any` unless commented why.
- Verify with `npm run build` (`tsc -b && vite build`).
- Run `npm test` (`vitest run`) after every task that touches tested logic.
- Additive only: existing recognized-provider values keep per-instance granularity (e.g.
  "Enigma-US1" and "Enigma-US2" stay two distinct entries) — "No Proxy" is one new bucket, not a
  regrouping to provider level.
- Matching rule: starts-with, case-insensitive, after `PROXY_ALIASES` typo-correction.
- `"No Proxy"` is ranked by volume in Proxy Breakdown like any other card (no special pinning).
- No schema changes. No new Supabase dependency — pure client-side classification logic.

Spec: `docs/superpowers/specs/2026-08-13-no-proxy-group-design.md`

---

## File Structure

- **Modify** `src/lib/proxyAliases.ts` — add `ACTIVE_PROXY_PROVIDERS`, `NO_PROXY_LABEL`,
  `resolveProxyLabel`.
- **Modify** `src/lib/proxyAliases.test.ts` — new `resolveProxyLabel` test suite.
- **Modify** `src/lib/queries.ts` — `computeTabKpisFromEntries` routes proxy breakdown/filter/list
  through `resolveProxyLabel`; delete the now-redundant local `proxyValue()` helper.
- **Modify** `src/lib/queries.test.ts` — update 2 existing tests whose blank/redacted-is-skipped
  assumption is no longer true; add new tests for the "No Proxy" bucket and filter.
- **Modify** `src/pages/Overview.tsx` — neutral icon/color treatment for the "No Proxy" card in
  Proxy Breakdown tiles and the slice modal, matching Country Breakdown's existing "Unknown"
  treatment.
- **Modify** `src/pages/BrandGroup.tsx` — `uniqueProxies`/`proxyFiltered` route through
  `resolveProxyLabel`; Check Status scope guards a lone "No Proxy" selection to unscoped.

---

### Task 1: Add `resolveProxyLabel` classification to `proxyAliases.ts`

**Files:**
- Modify: `src/lib/proxyAliases.ts`
- Test: `src/lib/proxyAliases.test.ts`

**Interfaces:**
- Produces: `export const NO_PROXY_LABEL = 'No Proxy'` and
  `export function resolveProxyLabel(rawProxy: string | null | undefined): string` — used by
  Task 2 (`queries.ts`) and Task 4 (`BrandGroup.tsx`). Task 3 (`Overview.tsx`) imports
  `NO_PROXY_LABEL` only.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/proxyAliases.test.ts` (after the existing `canonicalProxyName` describe block,
before the file's final closing):

```ts
describe('resolveProxyLabel', () => {
  it('resolves a blank value to "No Proxy"', () => {
    expect(resolveProxyLabel('')).toBe('No Proxy');
    expect(resolveProxyLabel('   ')).toBe('No Proxy');
    expect(resolveProxyLabel(null)).toBe('No Proxy');
    expect(resolveProxyLabel(undefined)).toBe('No Proxy');
  });

  it('resolves a redacted "*****" value to "No Proxy"', () => {
    expect(resolveProxyLabel('*****')).toBe('No Proxy');
  });

  it('passes through a value starting with an active provider name, case-insensitively', () => {
    expect(resolveProxyLabel('Enigma-US1')).toBe('Enigma-US1');
    expect(resolveProxyLabel('proxio_de2')).toBe('proxio_de2');
    expect(resolveProxyLabel('SPYDERPROXY-uk3')).toBe('SPYDERPROXY-uk3');
  });

  it('resolves a known typo alias to its canonical provider spelling before matching', () => {
    expect(resolveProxyLabel('proylite-1')).toBe('proylite-1');
    expect(resolveProxyLabel('  Proylite  ')).toBe('Proylite');
  });

  it('resolves an unrecognized/decommissioned provider value to "No Proxy"', () => {
    expect(resolveProxyLabel('OldVPN-7')).toBe('No Proxy');
    expect(resolveProxyLabel('RandomHost22')).toBe('No Proxy');
  });
});
```

Add `resolveProxyLabel` to the existing import at the top of the test file:

```ts
import { canonicalProxyKey, canonicalProxyName, resolveProxyLabel } from './proxyAliases';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/proxyAliases.test.ts`
Expected: FAIL — `resolveProxyLabel` is not exported yet.

- [ ] **Step 3: Implement `resolveProxyLabel` in `src/lib/proxyAliases.ts`**

Append to the end of `src/lib/proxyAliases.ts`:

```ts
const ACTIVE_PROXY_PROVIDERS = ['Enigma', 'Proxio', 'Proxylite', 'SpyderProxy'];

export const NO_PROXY_LABEL = 'No Proxy';

function isActiveProxyProvider(canonicalName: string): boolean {
  const lower = canonicalName.toLowerCase();
  return ACTIVE_PROXY_PROVIDERS.some((p) => lower.startsWith(p.toLowerCase()));
}

// A raw Proxy Used value, folded into the shared "No Proxy" bucket if it's blank, a redacted
// placeholder, or doesn't start with one of the 4 currently-active proxy providers (after
// typo-correction via PROXY_ALIASES) -- same rationale as resolveCountryLabel's "Unknown" in
// countryFlags.ts: turns "no real active proxy" into one real, filterable, canonicalizable
// identity instead of a value every proxy-identity consumer has to separately skip or fall
// silent on.
export function resolveProxyLabel(rawProxy: string | null | undefined): string {
  const trimmed = (rawProxy ?? '').trim();
  if (!trimmed || isRedactedProxyValue(trimmed)) return NO_PROXY_LABEL;
  const canonicalName = canonicalProxyName(trimmed);
  return isActiveProxyProvider(canonicalName) ? canonicalName : NO_PROXY_LABEL;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/proxyAliases.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/proxyAliases.ts src/lib/proxyAliases.test.ts
git commit -m "feat: add resolveProxyLabel No Proxy classification"
```

---

### Task 2: Route `computeTabKpisFromEntries`'s proxy handling through `resolveProxyLabel`

**Files:**
- Modify: `src/lib/queries.ts:7` (import), `:380-383` (delete `proxyValue`), `:448,454,504,508`
  (call sites)
- Test: `src/lib/queries.test.ts:357-374` (update 2 existing tests), append new tests

**Interfaces:**
- Consumes: `resolveProxyLabel` from Task 1.
- No new exports — `TabKpis.proxies`/`.byProxy` and `proxyFilter` matching now surface `"No
  Proxy"` as a real value; their types are unchanged.

- [ ] **Step 1: Update the two existing tests whose assumptions are now false**

In `src/lib/queries.test.ts`, replace the test at lines 357-364:

```ts
  it('byProxy buckets live/removed per proxy and skips entries with a blank Proxy Used value', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': '' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byProxy).toEqual({ 'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 } });
  });
```

with:

```ts
  it('byProxy buckets a blank Proxy Used value under a literal "No Proxy" bucket instead of skipping it (regression: previously excluded from byProxy entirely)', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': '' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byProxy).toEqual({
      'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 },
      'no proxy': { label: 'No Proxy', live: 0, removed: 1 },
    });
  });
```

Replace the test at lines 366-374:

```ts
  it('byProxy and proxies treat a redacted "*****" Proxy Used value the same as blank', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': '*****' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byProxy).toEqual({ 'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 } });
    expect(kpis.proxies).toEqual(['Enigma-US1']);
  });
```

with:

```ts
  it('byProxy and proxies fold a redacted "*****" Proxy Used value into "No Proxy", same as blank', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': '*****' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byProxy).toEqual({
      'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 },
      'no proxy': { label: 'No Proxy', live: 0, removed: 1 },
    });
    expect(kpis.proxies).toEqual(['Enigma-US1', 'No Proxy']);
  });
```

- [ ] **Step 2: Append new tests for the "No Proxy" bucket and filter**

Append these tests directly after the test ending at line 384 (`expect(kpis.proxies).toEqual(['Enigma-US1', 'Enigma-US2']);` / `});`), inside the same `describe('computeTabKpisFromEntries', ...)` block:

```ts
  it('folds a Proxy Used value that does not start with any active provider name into "No Proxy"', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Removed', 'Proxy Used': 'OldVPN-7' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set())!;
    expect(kpis.byProxy).toEqual({
      'enigma-us1': { label: 'Enigma-US1', live: 1, removed: 0 },
      'no proxy': { label: 'No Proxy', live: 0, removed: 1 },
    });
    expect(kpis.proxies).toEqual(['Enigma-US1', 'No Proxy']);
  });

  it('proxyFilter set to "No Proxy" matches blank, redacted, and unrecognized-provider entries', () => {
    const entries = [
      entry('1', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': '' }),
      entry('2', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': '*****' }),
      entry('3', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'RandomHost22' }),
      entry('4', { 'URL PAGE': 'A', 'Trust Pilot': '10/06/2026', 'TP Review Status': 'Published', 'Proxy Used': 'Enigma-US1' }),
    ];
    const kpis = computeTabKpisFromEntries(entries, rawHeaders, 'TP Affiliate', 'URL PAGE', '2026-05-01', '2026-07-31', new Set(), undefined, ['No Proxy'])!;
    expect(kpis.live).toBe(3);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: FAIL — the 2 updated tests fail because blank/redacted values are still being skipped
(the old behavior), and the new tests fail the same way; `resolveProxyLabel` isn't wired in yet.

- [ ] **Step 4: Update the import in `src/lib/queries.ts`**

Change line 7:

```ts
import { canonicalProxyKey, canonicalProxyName, isRedactedProxyValue } from './proxyAliases.ts';
```

to:

```ts
import { canonicalProxyKey, canonicalProxyName, resolveProxyLabel } from './proxyAliases.ts';
```

- [ ] **Step 5: Delete the now-redundant `proxyValue` helper**

Delete lines 380-383:

```ts
function proxyValue(data: Record<string, string | null | undefined>): string {
  const trimmed = (data['Proxy Used'] ?? '').trim();
  return isRedactedProxyValue(trimmed) ? '' : trimmed;
}
```

(Its redaction-check responsibility now lives inside `resolveProxyLabel`, Task 1.)

- [ ] **Step 6: Switch the 4 call sites to `resolveProxyLabel`**

Change line 448 (inside `filteredEntries`'s filter callback):

```ts
        if (proxyFilter?.length && !proxyFilter.some((pf) => canonicalProxyKey(proxyValue(e.data)) === canonicalProxyKey(pf))) return false;
```

to:

```ts
        if (proxyFilter?.length && !proxyFilter.some((pf) => canonicalProxyKey(resolveProxyLabel(e.data['Proxy Used'])) === canonicalProxyKey(pf))) return false;
```

Change line 454:

```ts
  const proxies = uniqueDisplayValues(entries.map((e) => proxyValue(e.data)), canonicalProxyKey, canonicalProxyName);
```

to:

```ts
  const proxies = uniqueDisplayValues(entries.map((e) => resolveProxyLabel(e.data['Proxy Used'])), canonicalProxyKey, canonicalProxyName);
```

Change line 504:

```ts
        addToBreakdown(byProxy, proxyValue(d), 'live', canonicalProxyKey, canonicalProxyName);
```

to:

```ts
        addToBreakdown(byProxy, resolveProxyLabel(d['Proxy Used']), 'live', canonicalProxyKey, canonicalProxyName);
```

Change line 508:

```ts
        addToBreakdown(byProxy, proxyValue(d), 'removed', canonicalProxyKey, canonicalProxyName);
```

to:

```ts
        addToBreakdown(byProxy, resolveProxyLabel(d['Proxy Used']), 'removed', canonicalProxyKey, canonicalProxyName);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS (all tests in the file, including the 2 updated and 2 new ones).

- [ ] **Step 8: Verify the full build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (in particular, no leftover reference to the deleted
`proxyValue` or the removed `isRedactedProxyValue` import).

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: all tests pass — no regressions elsewhere that depended on blank/redacted proxies being
skipped.

- [ ] **Step 10: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: fold blank/redacted/unrecognized proxies into No Proxy bucket"
```

---

### Task 3: Neutral icon/color treatment for "No Proxy" in `Overview.tsx`

**Files:**
- Modify: `src/pages/Overview.tsx:19` (import), `:508-515` (`openDimensionSlice`), `:875-891`
  (Proxy Breakdown tiles)

**Interfaces:**
- Consumes: `NO_PROXY_LABEL` from Task 1.
- No new exports.

- [ ] **Step 1: Import `NO_PROXY_LABEL`**

Change line 19:

```ts
import { proxyIconUrl } from '../lib/proxyIcons';
```

to:

```ts
import { proxyIconUrl } from '../lib/proxyIcons';
import { NO_PROXY_LABEL } from '../lib/proxyAliases';
```

- [ ] **Step 2: Give "No Proxy" a neutral icon/color in the Proxy Breakdown tiles**

Change (`src/pages/Overview.tsx:875-891`):

```tsx
            tiles={proxyCards.map((card): StatTile => {
              const color = card.isOther ? '#64748b' : categoricalColorForKey(card.key);
              const iconUrl = card.isOther ? null : proxyIconUrl(card.label);
              return {
                key: card.key,
                label: card.label,
                live: card.live,
                removed: card.removed,
                muted: card.isOther,
                accentColor: color,
                icon: iconUrl
                  ? <img src={iconUrl} alt={card.label} className="size-4 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  : <Shield className="size-4" style={{ color }} />,
                onTileClick: card.isOther
                  ? (kind) => openOtherBreakdown(card.members ?? [], 'proxy', kind)
                  : (kind) => openDimensionSlice(card, 'proxy', kind),
              };
            })}
```

to:

```tsx
            tiles={proxyCards.map((card): StatTile => {
              const isNoProxy = card.label === NO_PROXY_LABEL;
              const color = card.isOther || isNoProxy ? '#64748b' : categoricalColorForKey(card.key);
              const iconUrl = card.isOther || isNoProxy ? null : proxyIconUrl(card.label);
              return {
                key: card.key,
                label: card.label,
                live: card.live,
                removed: card.removed,
                muted: card.isOther || isNoProxy,
                accentColor: color,
                icon: iconUrl
                  ? <img src={iconUrl} alt={card.label} className="size-4 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  : <Shield className="size-4" style={{ color }} />,
                onTileClick: card.isOther
                  ? (kind) => openOtherBreakdown(card.members ?? [], 'proxy', kind)
                  : (kind) => openDimensionSlice(card, 'proxy', kind),
              };
            })}
```

- [ ] **Step 3: Give "No Proxy" the same neutral icon in the slice modal**

Change (`src/pages/Overview.tsx:508-515`):

```tsx
    const iconUrl = dimension === 'country' ? countryFlagImageUrl(card.label) : proxyIconUrl(card.label);
    const FallbackIcon = dimension === 'country' ? Globe : Shield;
    const icon = iconUrl
      ? <img src={iconUrl} alt={card.label} className="size-4 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      : <FallbackIcon className="size-4 text-slate-500" />;
    const rowIcon = iconUrl
      ? <img src={iconUrl} alt={card.label} className="size-3.5 shrink-0 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      : <FallbackIcon className="size-3.5 shrink-0 text-slate-400" />;
```

to:

```tsx
    const isNoProxy = dimension === 'proxy' && card.label === NO_PROXY_LABEL;
    const iconUrl = dimension === 'country' ? countryFlagImageUrl(card.label) : (isNoProxy ? null : proxyIconUrl(card.label));
    const FallbackIcon = dimension === 'country' ? Globe : Shield;
    const icon = iconUrl
      ? <img src={iconUrl} alt={card.label} className="size-4 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      : <FallbackIcon className="size-4 text-slate-500" />;
    const rowIcon = iconUrl
      ? <img src={iconUrl} alt={card.label} className="size-3.5 shrink-0 rounded-sm object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      : <FallbackIcon className="size-3.5 shrink-0 text-slate-400" />;
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test covers this presentational branch directly, so this is a
regression check on everything else).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat: neutral icon/color for No Proxy card in Proxy Breakdown"
```

---

### Task 4: Add "No Proxy" to `BrandGroup.tsx`'s per-tab Proxy filter and guard Check Status

**Files:**
- Modify: `src/pages/BrandGroup.tsx:28` (import), `:1284-1296` (`uniqueProxies`), `:1334-1336`
  (`proxyFiltered`), `:1611` (Check Status scope)

**Interfaces:**
- Consumes: `resolveProxyLabel`, `NO_PROXY_LABEL` from Task 1.
- No new exports — `BrandGroup.tsx` is a page component with no existing unit test file (verified:
  no `BrandGroup*.test.*` exists in the repo), consistent with this project's established pattern
  of verifying this specific file via build + logic review rather than unit tests.

- [ ] **Step 1: Update the import**

`canonicalProxyName` is only used once in this file (`BrandGroup.tsx:1291`, inside the block Step
2 replaces below) — after Step 2 it has no remaining callers, so it's dropped from the import
rather than left unused.

Change line 28:

```ts
import { canonicalProxyKey, canonicalProxyName } from '../lib/proxyAliases';
```

to:

```ts
import { canonicalProxyKey, resolveProxyLabel, NO_PROXY_LABEL } from '../lib/proxyAliases';
```

- [ ] **Step 2: Route `uniqueProxies` through `resolveProxyLabel`**

Change (`src/pages/BrandGroup.tsx:1284-1296`):

```tsx
  const uniqueProxies = headers.includes('Proxy Used')
    ? (() => {
        const seen = new Map<string, string>();
        for (const e of entries) {
          const v = e.data['Proxy Used'];
          if (v && v.trim()) {
            const key = canonicalProxyKey(v);
            if (!seen.has(key)) seen.set(key, canonicalProxyName(v));
          }
        }
        return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      })()
    : [];
```

to:

```tsx
  const uniqueProxies = headers.includes('Proxy Used')
    ? (() => {
        const seen = new Map<string, string>();
        for (const e of entries) {
          const label = resolveProxyLabel(e.data['Proxy Used']);
          const key = canonicalProxyKey(label);
          if (!seen.has(key)) seen.set(key, label);
        }
        return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      })()
    : [];
```

(`resolveProxyLabel` always returns a non-blank string — either a real value or `"No Proxy"` — so
the old `if (v && v.trim())` blank-guard is no longer needed; every entry now contributes to the
list.)

- [ ] **Step 3: Route `proxyFiltered`'s matching through `resolveProxyLabel`**

Change (`src/pages/BrandGroup.tsx:1334-1336`):

```tsx
  const proxyFiltered = proxyFilter.length > 0
    ? agentFiltered.filter((e) => proxyFilter.some((pf) => canonicalProxyKey(e.data['Proxy Used'] ?? '') === canonicalProxyKey(pf)))
    : agentFiltered;
```

to:

```tsx
  const proxyFiltered = proxyFilter.length > 0
    ? agentFiltered.filter((e) => proxyFilter.some((pf) => canonicalProxyKey(resolveProxyLabel(e.data['Proxy Used'])) === canonicalProxyKey(pf)))
    : agentFiltered;
```

- [ ] **Step 4: Guard the Check Status scope against a lone "No Proxy" selection**

Change (`src/pages/BrandGroup.tsx:1611`):

```tsx
      proxy: proxyFilter.length === 1 ? proxyFilter[0] : undefined,
```

to:

```tsx
      proxy: proxyFilter.length === 1 && proxyFilter[0] !== NO_PROXY_LABEL ? proxyFilter[0] : undefined,
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass — this file has no dedicated unit tests, so this confirms no other
suite's mocks/fixtures broke.

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: add No Proxy to Brand Tabs proxy filter, guard Check Status scope"
```

---

### Task 5: Whole-branch review

**Files:** none new — read-only review pass across Tasks 1-4.

- [ ] **Step 1: Re-read the diff for all 4 tasks together**

Run: `git diff HEAD~4 -- src/lib/proxyAliases.ts src/lib/queries.ts src/pages/Overview.tsx src/pages/BrandGroup.tsx`

Confirm:
- Every place that used to read raw `Proxy Used` for filtering/breakdown/dropdown purposes
  (`queries.ts`'s 4 call sites, `BrandGroup.tsx`'s `uniqueProxies`/`proxyFiltered`) now goes
  through `resolveProxyLabel` — grep for `data['Proxy Used']` and `d['Proxy Used']` across
  `src/lib/queries.ts` and `src/pages/BrandGroup.tsx` and check every remaining raw read is a
  legitimate one (e.g. displaying the real value in a table cell or the Check Status API call),
  not a filter/breakdown/dropdown path that should have been updated.
- `Overview.tsx` and `BrandGroup.tsx` use the identical classification (`resolveProxyLabel`) so
  a user filtering by "No Proxy" sees the same option and the same matching entries on both
  pages.

- [ ] **Step 2: Run the full suite and build one final time**

Run: `npm test && npm run build`
Expected: both pass.

- [ ] **Step 3: Update `CLAUDE.md`'s Recent Changes**

Add a dated entry (per this project's established changelog convention) to
`Internal Projects/Forums Dashboard/CLAUDE.md` under "Recent Changes", summarizing: the new
`resolveProxyLabel` classification, the additive-only scope decision, the `BrandGroup.tsx`
consistency extension (including the incidental redacted-value fix it carries), the Check Status
guard, and the known "coverage caption reads 100%" caveat (already true for Country's "Unknown"
today, now also true for Proxy).

- [ ] **Step 4: Commit**

```bash
git add "Internal Projects/Forums Dashboard/CLAUDE.md"
git commit -m "docs: log No Proxy group changes in task history"
```
