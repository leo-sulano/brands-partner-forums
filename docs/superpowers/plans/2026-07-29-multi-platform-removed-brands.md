# Multi-Platform "Page Removed" Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the existing TP-only "page removed" flag (`docs/superpowers/specs/2026-07-29-tp-removed-brands-design.md`) to independently cover all 4 platforms (TrustPilot, AskGamblers, CasinoGuru, Wizard of Odds), superseding it in place.

**Architecture:** `removed_tp_brands` is renamed to `removed_platform_brands` and gains a `platform` column, folded into its uniqueness key. The shared matching module (renamed `removedPlatformBrands.ts`) becomes the canonical home of the `Platform` type itself (re-exported by `scoreSummary.ts` for existing consumers), and its key function now takes `platform` as a third argument. Every consumer that previously hardcoded `'tp'` — the badge, the Edit Entry checkbox, `scoreSummary.ts`'s exclusion gate, `queries.ts`'s KPI counters — is generalized to work per-platform, using `getTabPlatforms(tab)` to know which platforms actually apply to a given tab.

**Tech Stack:** Vite 6 · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres) · Vitest

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-multi-platform-removed-brands-design.md` — read once before starting.
- `Platform` type (`'tp' | 'ag' | 'cg' | 'wo'`) is now canonically defined in `src/lib/removedPlatformBrands.ts` and re-exported from `src/lib/scoreSummary.ts` (`export type { Platform } from './removedPlatformBrands';`) so every existing `import type { Platform } from '../lib/scoreSummary'` across the codebase keeps working unchanged.
- Matching is case-insensitive/trimmed on brand (unchanged from the TP-only version) plus an exact platform match — implemented once in `platformRemovedKey(tab, brand, platform)` and reused everywhere; never reimplement inline.
- No new UI screen for managing flags — toggling only happens via the Edit Entry modal's per-platform checkboxes.
- This repo has no React component test harness — verify UI changes manually via `npm run dev`; pure-logic modules get Vitest tests.
- Verify TypeScript correctness with `npm run build` (root tsconfig is references-only; `tsc --noEmit` alone checks nothing here).
- A brand's flag on one platform is fully independent of its flags on other platforms — never let one platform's exclusion/badge/checkbox state leak into another's.

---

### Task 1: Migration — rename table, add `platform` column

**Files:**
- Create: `supabase/migrations/20260729150000_generalize_removed_brands_to_all_platforms.sql`

**Interfaces:**
- Produces: table `public.removed_platform_brands(id, tab, brand, brand_key, platform, removed_by, removed_at)`, unique on `(tab, brand_key, platform)`. Every later task's `fetchRemovedPlatformBrands`/`setBrandPlatformRemoved` in `queries.ts` reads/writes this table.

- [ ] **Step 1: Write the migration file**

```sql
-- Generalizes the TP-only "page removed" flag (removed_tp_brands, added in
-- 20260729130000 + 20260729140000) to independently cover all 4 platforms:
-- TrustPilot, AskGamblers, CasinoGuru, Wizard of Odds. A brand's page on any
-- one platform can be delisted without implying anything about its pages on
-- the others — each (tab, brand, platform) triple is flagged independently.
--
-- Existing rows (all TP-only, from the original feature) backfill to
-- platform = 'tp' automatically — zero behavior change for brands already
-- flagged before this migration.

alter table public.removed_tp_brands rename to removed_platform_brands;

alter table public.removed_platform_brands
  add column platform text not null default 'tp'
    check (platform in ('tp', 'ag', 'cg', 'wo'));
alter table public.removed_platform_brands alter column platform drop default;

-- Widen uniqueness from (tab, brand_key) to (tab, brand_key, platform) — the
-- same brand can now have independent rows per platform.
alter table public.removed_platform_brands
  drop constraint removed_tp_brands_tab_brand_key_key;
alter table public.removed_platform_brands
  add constraint removed_platform_brands_tab_brand_key_platform_key
    unique (tab, brand_key, platform);

-- Rename the 4 RLS policies to match the new table name (cosmetic only — no
-- permission logic changes; Postgres ties policies to the table by OID, not
-- name, so this step is purely for readability, not required for the table
-- to keep working).
alter policy "anyone can read removed_tp_brands"
  on public.removed_platform_brands rename to "anyone can read removed_platform_brands";
alter policy "approved users can insert removed_tp_brands"
  on public.removed_platform_brands rename to "approved users can insert removed_platform_brands";
alter policy "approved users can update removed_tp_brands"
  on public.removed_platform_brands rename to "approved users can update removed_platform_brands";
alter policy "approved users can delete removed_tp_brands"
  on public.removed_platform_brands rename to "approved users can delete removed_platform_brands";
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push` (from the project root).

- [ ] **Step 3: Verify manually**

In the Supabase SQL editor:
```sql
select tab, brand, platform, removed_by, removed_at from public.removed_platform_brands order by tab, brand;
```
Expect all 14 existing rows, each with `platform = 'tp'`, otherwise identical to before the migration. Also confirm:
```sql
select conname from pg_constraint where conrelid = 'public.removed_platform_brands'::regclass;
```
shows `removed_platform_brands_tab_brand_key_platform_key` (not the old `removed_tp_brands_tab_brand_key_key`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729150000_generalize_removed_brands_to_all_platforms.sql
git commit -m "feat: generalize removed_tp_brands to removed_platform_brands (all 4 platforms)"
```

---

### Task 2: Shared key-matching module — rename and add `platform`

**Files:**
- Create: `src/lib/removedPlatformBrands.ts` (replaces `src/lib/removedTpBrands.ts`, which is deleted)
- Create: `src/lib/removedPlatformBrands.test.ts` (replaces `src/lib/removedTpBrands.test.ts`, which is deleted)

**Interfaces:**
- Produces: `Platform` type (canonical definition, moves here from `scoreSummary.ts`), `platformRemovedKey(tab: string, brand: string, platform: Platform): string`, `buildRemovedPlatformBrandSet(rows: { tab: string; brand: string; platform: Platform }[]): Set<string>`. Task 3 re-exports `Platform` from `scoreSummary.ts` for backward compatibility; Tasks 4, 6, 7, 9, 10 import from here.

- [ ] **Step 1: Delete the old files and create the new ones**

```bash
git rm src/lib/removedTpBrands.ts src/lib/removedTpBrands.test.ts
```

Create `src/lib/removedPlatformBrands.ts`:

```typescript
// A brand's platform page (Trustpilot, AskGamblers, CasinoGuru, or Wizard of
// Odds) can be delisted entirely, independent of any single review's status
// and independent of that brand's standing on any other platform. Flagged
// (tab, brand, platform) triples live in the `removed_platform_brands`
// table. This key format is the single shared definition of that match —
// every reader (BrandGroup's badges, scoreSummary's per-platform exclusion,
// the Edit Entry checkboxes) goes through it so they can't drift out of sync
// with each other or with what's actually stored in the table.

export type Platform = 'tp' | 'ag' | 'cg' | 'wo';

export function platformRemovedKey(tab: string, brand: string, platform: Platform): string {
  return `${tab}::${brand.trim().toLowerCase()}::${platform}`;
}

export function buildRemovedPlatformBrandSet(
  rows: { tab: string; brand: string; platform: Platform }[],
): Set<string> {
  return new Set(rows.map((r) => platformRemovedKey(r.tab, r.brand, r.platform)));
}
```

- [ ] **Step 2: Write the test file**

Create `src/lib/removedPlatformBrands.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { platformRemovedKey, buildRemovedPlatformBrandSet } from './removedPlatformBrands';

describe('platformRemovedKey', () => {
  it('matches regardless of brand casing or surrounding whitespace', () => {
    expect(platformRemovedKey('Hanan', 'Pribet.com', 'tp')).toBe(platformRemovedKey('Hanan', '  PRIBET.COM  ', 'tp'));
  });

  it('treats the same brand name in different tabs as distinct', () => {
    expect(platformRemovedKey('Hanan', 'Pribet.com', 'tp')).not.toBe(platformRemovedKey('Trybet', 'Pribet.com', 'tp'));
  });

  it('treats the same (tab, brand) on different platforms as distinct', () => {
    expect(platformRemovedKey('Hanan', 'Pribet.com', 'tp')).not.toBe(platformRemovedKey('Hanan', 'Pribet.com', 'ag'));
  });
});

describe('buildRemovedPlatformBrandSet', () => {
  it('builds a set whose membership matches via platformRemovedKey regardless of casing', () => {
    const set = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    expect(set.has(platformRemovedKey('Hanan', 'pribet.com', 'tp'))).toBe(true);
    expect(set.has(platformRemovedKey('Hanan', 'WinMega.com', 'tp'))).toBe(false);
  });

  it('does not match the same brand flagged on a different platform', () => {
    const set = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    expect(set.has(platformRemovedKey('Hanan', 'Pribet.com', 'ag'))).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- removedPlatformBrands`
Expected: PASS (5 tests)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Errors referencing `removedTpBrands` in `scoreSummary.ts`, `queries.ts`, `BrandGroup.tsx`, `ScoreSummary.tsx`, `EditEntryModal.tsx` (not yet updated) — this is expected at this point in the plan; Tasks 3-10 fix each one. Confirm the errors are only "cannot find module './removedTpBrands'" / "cannot find name 'tpRemovedKey'" / "cannot find name 'buildRemovedTpBrandSet'" style — nothing else.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/removedPlatformBrands.ts src/lib/removedPlatformBrands.test.ts src/lib/removedTpBrands.ts src/lib/removedTpBrands.test.ts
git commit -m "feat: rename removedTpBrands to removedPlatformBrands, add platform to the key"
```

---

### Task 3: `scoreSummary.ts` — generalize the exclusion, add platform labels

**Files:**
- Modify: `src/lib/scoreSummary.ts`
- Modify: `src/lib/scoreSummary.test.ts`

**Interfaces:**
- Consumes: `Platform`, `platformRemovedKey` from `./removedPlatformBrands` (Task 2).
- Produces: re-exports `Platform` (so `BrandGroup.tsx`, `ScoreSummaryPanel.tsx`, `EditEntryModal.tsx` keep importing it from here unchanged), `PLATFORM_LABEL: Record<Platform, string>`, `PLATFORM_SHORT_LABEL: Record<Platform, string>`. `computeScoreSummary`/`computeSuccessRates`/`computeTabSuccessRates`'s renamed final parameter is `removedPlatformBrands: Set<string> = new Set()`. Task 5 (badge) uses `PLATFORM_SHORT_LABEL`; Task 7 (Edit Entry checkboxes) uses `PLATFORM_LABEL`; Task 9 (`ScoreSummaryPanel.tsx`) passes the renamed parameter.

- [ ] **Step 1: Update the imports and top-of-file constants**

Change lines 1-9 of `src/lib/scoreSummary.ts` from:

```typescript
import type { Entry } from '../types/entry';
import { tpRemovedKey } from './removedTpBrands';

export type Star = number;
export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';
export type Platform = 'tp' | 'ag' | 'cg' | 'wo';

// TrustPilot and CasinoGuru score reviews 1-5; AskGamblers scores 1-10.
export const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5, wo: 5 };
```

to:

```typescript
import type { Entry } from '../types/entry';
import { platformRemovedKey } from './removedPlatformBrands';
import type { Platform } from './removedPlatformBrands';

// Re-exported (not just imported) so every existing `import type { Platform }
// from '../lib/scoreSummary'` across the codebase (BrandGroup.tsx,
// ScoreSummaryPanel.tsx, EditEntryModal.tsx) keeps working unchanged, even
// though the canonical definition now lives in removedPlatformBrands.ts.
// NOTE: `export type { Platform } from './removedPlatformBrands'` alone would
// NOT work here — a re-export statement forwards the binding to external
// importers but does not introduce a local `Platform` identifier usable
// elsewhere in *this* file (e.g. `Record<Platform, number>` below would fail
// to compile). The separate `import type` above is what makes `Platform`
// usable locally; the `export type { Platform };` after it is what re-exports
// that same local binding.
export type { Platform };

export type Star = number;
export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';

// TrustPilot and CasinoGuru score reviews 1-5; AskGamblers scores 1-10.
export const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5, wo: 5 };

export const PLATFORM_LABEL: Record<Platform, string> = {
  tp: 'TrustPilot',
  ag: 'AskGamblers',
  cg: 'CasinoGuru',
  wo: 'Wizard of Odds',
};

export const PLATFORM_SHORT_LABEL: Record<Platform, string> = {
  tp: 'TP',
  ag: 'AG',
  cg: 'CG',
  wo: 'WO',
};
```

- [ ] **Step 2: Update `computeScoreSummary`'s exclusion check**

Change the signature (currently around line 164-170):

```typescript
export function computeScoreSummary(
  entries: Entry[],
  range: DateRange,
  pinnedFirst: string[] = [],
  platform: Platform = 'tp',
  removedTpBrands: Set<string> = new Set(),
): ScoreSummaryResult {
```

to:

```typescript
export function computeScoreSummary(
  entries: Entry[],
  range: DateRange,
  pinnedFirst: string[] = [],
  platform: Platform = 'tp',
  removedPlatformBrands: Set<string> = new Set(),
): ScoreSummaryResult {
```

Change the exclusion check (currently around line 207):

```typescript
    if (platform === 'tp' && removedTpBrands.has(tpRemovedKey(tab, brand))) continue;
```

to:

```typescript
    if (removedPlatformBrands.has(platformRemovedKey(tab, brand, platform))) continue;
```

(The `platform === 'tp'` gate is removed entirely — the platform is now part of the key, so the exclusion is automatically scoped to whichever platform the caller passes.)

- [ ] **Step 3: Update `computeSuccessRates`'s exclusion check**

Change the signature (currently around line 289-293):

```typescript
export function computeSuccessRates(
  entries: Entry[],
  platform: Platform,
  removedTpBrands: Set<string> = new Set(),
): Map<string, SuccessRate> {
```

to:

```typescript
export function computeSuccessRates(
  entries: Entry[],
  platform: Platform,
  removedPlatformBrands: Set<string> = new Set(),
): Map<string, SuccessRate> {
```

Change the exclusion check (currently around line 307):

```typescript
    if (platform === 'tp' && removedTpBrands.has(tpRemovedKey(tab, brand))) continue;
```

to:

```typescript
    if (removedPlatformBrands.has(platformRemovedKey(tab, brand, platform))) continue;
```

- [ ] **Step 4: Update `computeTabSuccessRates`'s exclusion check**

Change the signature (currently around line 334-338):

```typescript
export function computeTabSuccessRates(
  entries: Entry[],
  platform: Platform,
  removedTpBrands: Set<string> = new Set(),
): Map<string, SuccessRate> {
```

to:

```typescript
export function computeTabSuccessRates(
  entries: Entry[],
  platform: Platform,
  removedPlatformBrands: Set<string> = new Set(),
): Map<string, SuccessRate> {
```

Change the exclusion check (currently around line 349):

```typescript
    if (platform === 'tp' && brand && removedTpBrands.has(tpRemovedKey(tab, brand))) continue;
```

to:

```typescript
    if (brand && removedPlatformBrands.has(platformRemovedKey(tab, brand, platform))) continue;
```

- [ ] **Step 5: Update `scoreSummary.test.ts`**

Change the import (currently line 3):

```typescript
import { buildRemovedTpBrandSet } from './removedTpBrands';
```

to:

```typescript
import { buildRemovedPlatformBrandSet } from './removedPlatformBrands';
```

Replace the 4 existing `describe` blocks that reference `removedTpBrands`/`buildRemovedTpBrandSet` (currently around lines 233-297: `computeScoreSummary — removedTpBrands exclusion`, `computeSuccessRates — removedTpBrands exclusion`, `computeTabSuccessRates — removedTpBrands exclusion`, `computeScoreSummary — removedTpBrands case/whitespace normalization`) with:

```typescript
describe('computeScoreSummary — removedPlatformBrands exclusion', () => {
  const noRange = { from: null, to: null };

  it('excludes a flagged brand entirely from the matching platform view', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published', 'TP Score added': '5' }),
      makeEntry('2', 'Hanan', { Brands: 'WinMega.com', 'TP Review Status': 'Published', 'TP Score added': '4' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeScoreSummary(entries, noRange, [], 'tp', removed);
    expect(result.brands.map((b) => b.brand)).toEqual(['WinMega.com']);
  });

  it('does not exclude a brand flagged on a different platform', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'AG Review Status': 'Published', 'AG Score added': '9' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeScoreSummary(entries, noRange, [], 'ag', removed);
    expect(result.brands).toHaveLength(1);
  });

  it('excludes the same brand independently per platform when flagged on both', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published', 'TP Score added': '5' }),
      makeEntry('2', 'Hanan', { Brands: 'Pribet.com', 'AG Review Status': 'Published', 'AG Score added': '9' }),
    ];
    const removed = buildRemovedPlatformBrandSet([
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' },
      { tab: 'Hanan', brand: 'Pribet.com', platform: 'ag' },
    ]);
    expect(computeScoreSummary(entries, noRange, [], 'tp', removed).brands).toHaveLength(0);
    expect(computeScoreSummary(entries, noRange, [], 'ag', removed).brands).toHaveLength(0);
  });
});

describe('computeSuccessRates — removedPlatformBrands exclusion', () => {
  it('excludes a flagged brand from the matching platform per-brand success rate map', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeSuccessRates(entries, 'tp', removed);
    expect(result.has('Hanan Pribet.com')).toBe(false);
  });
});

describe('computeTabSuccessRates — removedPlatformBrands exclusion', () => {
  it('excludes a flagged brand from the matching platform tab-level success rate total', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: 'Pribet.com', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Brands: 'WinMega.com', 'TP Review Status': 'Removed' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeTabSuccessRates(entries, 'tp', removed);
    expect(result.get('Hanan')).toEqual({ live: 0, removed: 1, rate: 0 });
  });

  it('still counts a brandless entry even when removedPlatformBrands is non-empty', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'SomeOtherBrand', platform: 'tp' }]);
    const result = computeTabSuccessRates(entries, 'tp', removed);
    expect(result.get('Hanan')).toEqual({ live: 1, removed: 0, rate: 100 });
  });
});

describe('computeScoreSummary — removedPlatformBrands case/whitespace normalization', () => {
  it('excludes a flagged brand even when the entry brand value has different casing/whitespace', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Hanan', { Brands: '  PRIBET.COM  ', 'TP Review Status': 'Published' }),
    ];
    const removed = buildRemovedPlatformBrandSet([{ tab: 'Hanan', brand: 'Pribet.com', platform: 'tp' }]);
    const result = computeScoreSummary(entries, { from: null, to: null }, [], 'tp', removed);
    expect(result.brands).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run the full scoreSummary test suite**

Run: `npm test -- scoreSummary`
Expected: PASS (all pre-existing tests plus the updated/new ones)

- [ ] **Step 7: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts
git commit -m "feat: generalize scoreSummary.ts exclusion to all 4 platforms"
```

---

### Task 4: `queries.ts` — generalize fetch/write and KPI counting

**Files:**
- Modify: `src/lib/queries.ts`

**Interfaces:**
- Consumes: `Platform`, `platformRemovedKey` from `../lib/removedPlatformBrands` (Task 2).
- Produces: `fetchRemovedPlatformBrands(): Promise<{ tab: string; brand: string; platform: Platform }[]>` (replaces `fetchRemovedTpBrands`), `setBrandPlatformRemoved(tab: string, brand: string, platform: Platform, removed: boolean): Promise<void>` (replaces `setBrandTpRemoved`), `fetchTabKpis(tab, dateFrom?, dateTo?, removedPlatformBrands?: Set<string>)` generalized to exclude per-platform independently. Task 6 (`BrandGroup.tsx`), Task 9 (`ScoreSummary.tsx`), Task 10 (`Overview.tsx`) call these.

- [ ] **Step 1: Update the imports**

Change (currently near the top of the file):

```typescript
import { getTabColumns, getBrandNameCol } from './tab-configs';
import { tpRemovedKey } from './removedTpBrands';
```

to:

```typescript
import { getTabColumns, getBrandNameCol } from './tab-configs';
import { platformRemovedKey, type Platform } from './removedPlatformBrands';
```

- [ ] **Step 2: Rename and generalize `fetchRemovedTpBrands`**

Change (currently around line 208-214):

```typescript
export async function fetchRemovedTpBrands(): Promise<{ tab: string; brand: string }[]> {
  const { data, error } = await supabase
    .from('removed_tp_brands')
    .select('tab, brand');
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string }[];
}
```

to:

```typescript
export async function fetchRemovedPlatformBrands(): Promise<{ tab: string; brand: string; platform: Platform }[]> {
  const { data, error } = await supabase
    .from('removed_platform_brands')
    .select('tab, brand, platform');
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string; platform: Platform }[];
}
```

- [ ] **Step 3: Rename and generalize `setBrandTpRemoved`**

Change (currently around line 588-617, including its header comment):

```typescript
// Toggle-off is a hard DELETE and toggle-on is a fresh INSERT/upsert — so
// removed_by/removed_at always reflect the most recent (re-)flagging, not the
// original flagger/time; re-enabling loses that history. Accepted tradeoff of
// the "row existence = flagged" model (see the migration's header comment),
// not a bug. Also: if a brand is renamed on the same Edit Entry save that also
// toggles the flag, the flag is written against the *new* name — the old
// name's flag row (if any) is left untouched. Accepted, documented limitation;
// no rename-detection logic is planned for it.
//
// Matching is done via the generated `brand_key` column (lower+trim of
// `brand`, see the 20260729140000 migration), not the raw `brand` value —
// this mirrors tpRemovedKey in src/lib/removedTpBrands.ts so a stored brand
// value that differs only in case/whitespace from the one passed in here
// still matches the existing row instead of silently no-oping.
export async function setBrandTpRemoved(tab: string, brand: string, removed: boolean): Promise<void> {
  const brandKey = brand.trim().toLowerCase();
  if (removed) {
    const { error } = await supabase
      .from('removed_tp_brands')
      .upsert({ tab, brand, removed_by: await currentUserEmail() }, { onConflict: 'tab,brand_key' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('removed_tp_brands')
      .delete()
      .eq('tab', tab)
      .eq('brand_key', brandKey);
    if (error) throw error;
  }
}
```

to:

```typescript
// Toggle-off is a hard DELETE and toggle-on is a fresh INSERT/upsert — so
// removed_by/removed_at always reflect the most recent (re-)flagging, not the
// original flagger/time; re-enabling loses that history. Accepted tradeoff of
// the "row existence = flagged" model (see the migration's header comment),
// not a bug. Also: if a brand is renamed on the same Edit Entry save that also
// toggles a flag, the flag is written against the *new* name — the old name's
// flag row (if any) is left untouched. Accepted, documented limitation; no
// rename-detection logic is planned for it.
//
// Matching is done via the generated `brand_key` column (lower+trim of
// `brand`) plus an exact `platform` match — this mirrors platformRemovedKey
// in src/lib/removedPlatformBrands.ts so a stored brand value that differs
// only in case/whitespace from the one passed in here still matches the
// existing row instead of silently no-oping, and so flags on different
// platforms for the same brand never collide.
export async function setBrandPlatformRemoved(
  tab: string,
  brand: string,
  platform: Platform,
  removed: boolean,
): Promise<void> {
  const brandKey = brand.trim().toLowerCase();
  if (removed) {
    const { error } = await supabase
      .from('removed_platform_brands')
      .upsert(
        { tab, brand, platform, removed_by: await currentUserEmail() },
        { onConflict: 'tab,brand_key,platform' },
      );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('removed_platform_brands')
      .delete()
      .eq('tab', tab)
      .eq('brand_key', brandKey)
      .eq('platform', platform);
    if (error) throw error;
  }
}
```

- [ ] **Step 4: Generalize `fetchTabKpis`'s per-platform exclusion**

Change the parameter (currently around line 334-345):

```typescript
export async function fetchTabKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedTpBrands: Set<string> = new Set(),
): Promise<TabKpis> {
```

to:

```typescript
export async function fetchTabKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedPlatformBrands: Set<string> = new Set(),
): Promise<TabKpis> {
```

Change the per-entry exclusion logic (currently around lines 379-390):

```typescript
    const generic = (!tp && !ag && !cg && !wo && genericCol) ? (d[genericCol] ?? '').toLowerCase() : '';

    // A brand whose TP page has been delisted entirely shouldn't count toward the
    // Trust Pilot platform total — matches the same TP-only exclusion applied in
    // Score Summary and BrandGroup's platform KPI cards.
    const brand = (d[brandCol] ?? '').trim();
    const tpBrandFlagged = brand !== '' && removedTpBrands.has(tpRemovedKey(tab, brand));

    if (tp && !tpBrandFlagged) { if (isLiveStatus(tp)) tpLive++; else if (isRemovedStatus(tp)) tpRemoved++; }
    if (ag) { if (isLiveStatus(ag)) agLive++; else if (isRemovedStatus(ag)) agRemoved++; }
    if (cg) { if (isLiveStatus(cg)) cgLive++; else if (isRemovedStatus(cg)) cgRemoved++; }
    if (wo) { if (isLiveStatus(wo)) woLive++; else if (isRemovedStatus(wo)) woRemoved++; }
```

to:

```typescript
    const generic = (!tp && !ag && !cg && !wo && genericCol) ? (d[genericCol] ?? '').toLowerCase() : '';

    // A brand whose page on a given platform has been delisted entirely
    // shouldn't count toward that platform's Live/Removed total — matches the
    // same exclusion applied in Score Summary and BrandGroup's platform KPI
    // cards, independently per platform (a TP-removed brand can still count
    // normally toward AG/CG/WO, and vice versa).
    const brand = (d[brandCol] ?? '').trim();
    const isPlatformFlagged = (platform: Platform) =>
      brand !== '' && removedPlatformBrands.has(platformRemovedKey(tab, brand, platform));

    if (tp && !isPlatformFlagged('tp')) { if (isLiveStatus(tp)) tpLive++; else if (isRemovedStatus(tp)) tpRemoved++; }
    if (ag && !isPlatformFlagged('ag')) { if (isLiveStatus(ag)) agLive++; else if (isRemovedStatus(ag)) agRemoved++; }
    if (cg && !isPlatformFlagged('cg')) { if (isLiveStatus(cg)) cgLive++; else if (isRemovedStatus(cg)) cgRemoved++; }
    if (wo && !isPlatformFlagged('wo')) { if (isLiveStatus(wo)) woLive++; else if (isRemovedStatus(wo)) woRemoved++; }
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: `queries.ts` itself compiles clean; remaining errors (if any) should now only be in `BrandGroup.tsx`, `ScoreSummary.tsx`, `EditEntryModal.tsx` (not yet updated — fixed by Tasks 6, 7, 9).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat: generalize queries.ts fetch/write/KPI counting to all 4 platforms"
```

---

### Task 5: Badge component — generalize to a labeled per-platform pill

**Files:**
- Create: `src/components/PlatformRemovedBadge.tsx` (replaces `src/components/TpRemovedBadge.tsx`, which is deleted)

**Interfaces:**
- Consumes: `Platform`, `PLATFORM_LABEL`, `PLATFORM_SHORT_LABEL` from `../lib/scoreSummary` (Task 3).
- Produces: `<PlatformRemovedBadge platform={p} />`. Task 6 renders one per removed platform, inline next to a brand name.

- [ ] **Step 1: Delete the old file and create the new one**

```bash
git rm src/components/TpRemovedBadge.tsx
```

Create `src/components/PlatformRemovedBadge.tsx`:

```tsx
import { PLATFORM_LABEL, PLATFORM_SHORT_LABEL, type Platform } from '../lib/scoreSummary';

// Solid red pill with a 2-letter platform code, shown next to a brand name
// whose page on that specific platform has been delisted entirely — distinct
// from the outlined rose "Removed" status pill (see BrandGroup.tsx's
// StatusBadge) which reflects one review's status, not the brand's page
// existing at all. A brand can show more than one of these side by side if
// it's been delisted on more than one platform independently.
export default function PlatformRemovedBadge({ platform }: { platform: Platform }) {
  return (
    <span
      className="inline-flex h-3.5 shrink-0 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold leading-none text-white"
      title={`${PLATFORM_LABEL[platform]} page removed`}
    >
      {PLATFORM_SHORT_LABEL[platform]}
    </span>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: no new TypeScript errors in this file (the old `TpRemovedBadge` import in `BrandGroup.tsx` will still error until Task 6 — expected at this point).

- [ ] **Step 3: Commit**

```bash
git add -A src/components/PlatformRemovedBadge.tsx src/components/TpRemovedBadge.tsx
git commit -m "feat: generalize TpRemovedBadge to a labeled per-platform PlatformRemovedBadge"
```

---

### Task 6: `BrandGroup.tsx` — generalize badge rendering and KPI exclusion

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `fetchRemovedPlatformBrands`, `setBrandPlatformRemoved` (Task 4); `platformRemovedKey`, `buildRemovedPlatformBrandSet`, `type Platform` (Task 2); `type Platform` also re-exported from `scoreSummary.ts` (Task 3); `<PlatformRemovedBadge />` (Task 5).
- Produces: `isPlatformRemoved(brandName, platform): boolean`, `removedPlatformsFor(brandName): Platform[]` — Task 8 (the Edit Entry wiring, same file) uses both.

- [ ] **Step 1: Update imports**

Change (currently lines 13-15):

```typescript
import TpRemovedBadge from '../components/TpRemovedBadge';
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, triggerAgStatusCheck, triggerCgStatusCheck, triggerWoStatusCheck, insertEntry, deleteEntries, moveEntryToTab, fetchRemovedTpBrands, setBrandTpRemoved, type StatusCheckScope } from '../lib/queries';
import { tpRemovedKey, buildRemovedTpBrandSet } from '../lib/removedTpBrands';
```

to:

```typescript
import PlatformRemovedBadge from '../components/PlatformRemovedBadge';
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, triggerAgStatusCheck, triggerCgStatusCheck, triggerWoStatusCheck, insertEntry, deleteEntries, moveEntryToTab, fetchRemovedPlatformBrands, setBrandPlatformRemoved, type StatusCheckScope } from '../lib/queries';
import { platformRemovedKey, buildRemovedPlatformBrandSet } from '../lib/removedPlatformBrands';
```

Change line 19 (currently `import { parseScore, PLATFORM_MAX_SCORE } from '../lib/scoreSummary';`) to:

```typescript
import { parseScore, PLATFORM_MAX_SCORE, type Platform } from '../lib/scoreSummary';
```

- [ ] **Step 2: Rename the fetched-rows state and its fetch effect**

Change (currently line 685):

```typescript
const [removedTpBrandRows, setRemovedTpBrandRows] = useState<{ tab: string; brand: string }[]>([]);
```

to:

```typescript
const [removedPlatformBrandRows, setRemovedPlatformBrandRows] = useState<{ tab: string; brand: string; platform: Platform }[]>([]);
```

Change the fetch effect (currently lines 773-779):

```typescript
  useEffect(() => {
    let canceled = false;
    fetchRemovedTpBrands()
      .then((rows) => { if (!canceled) setRemovedTpBrandRows(rows); })
      .catch(() => { /* badge is decorative — a failed fetch just means no badges render */ });
    return () => { canceled = true; };
  }, [reloadSeq]);
```

to:

```typescript
  useEffect(() => {
    let canceled = false;
    fetchRemovedPlatformBrands()
      .then((rows) => { if (!canceled) setRemovedPlatformBrandRows(rows); })
      .catch(() => { /* badge is decorative — a failed fetch just means no badges render */ });
    return () => { canceled = true; };
  }, [reloadSeq]);
```

- [ ] **Step 3: Replace the `isTpRemoved` helper with per-platform helpers**

Change (currently lines 1042-1045):

```typescript
  const removedTpBrandSet = useMemo(() => buildRemovedTpBrandSet(removedTpBrandRows), [removedTpBrandRows]);
  function isTpRemoved(brandName: string | null | undefined): boolean {
    return !!brandName && removedTpBrandSet.has(tpRemovedKey(decodedTab, brandName));
  }
```

to:

```typescript
  const removedPlatformBrandSet = useMemo(() => buildRemovedPlatformBrandSet(removedPlatformBrandRows), [removedPlatformBrandRows]);
  function isPlatformRemoved(brandName: string | null | undefined, platform: Platform): boolean {
    return !!brandName && removedPlatformBrandSet.has(platformRemovedKey(decodedTab, brandName, platform));
  }
  // Every platform actually active on this tab (getTabPlatforms) that's
  // currently flagged for this brand — drives one badge per flagged platform.
  function removedPlatformsFor(brandName: string | null | undefined): Platform[] {
    if (!brandName) return [];
    return getTabPlatforms(decodedTab).filter((p) => isPlatformRemoved(brandName, p));
  }
```

- [ ] **Step 4: Generalize `countPlatform`'s exclusion (multi-platform tabs)**

Change (currently lines 1368-1387):

```typescript
  const displayKpis = (() => {
    function countPlatform(key: 'tp' | 'ag' | 'cg') {
      const statusCol = key === 'tp'
        ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
        : (headers.find((h) => h.toLowerCase() === PLATFORM_STATUS_COL[key].toLowerCase()) ?? null);
      if (!statusCol) return { live: 0, removed: 0 };
      let live = 0, removed = 0;
      for (const e of kpiBase) {
        // A brand whose TP page has been delisted entirely shouldn't count toward
        // the Trust Pilot card's Live/Removed totals — matches the TP-only exclusion
        // already applied in Score Summary.
        if (key === 'tp' && brandCol && isTpRemoved(e.data[brandCol])) continue;
        const v = (e.data[statusCol] ?? '').toLowerCase();
        if (isLive(v)) live++;
        else if (isRemoved(v)) removed++;
      }
      return { live, removed };
    }
    return { tp: countPlatform('tp'), ag: countPlatform('ag'), cg: countPlatform('cg') };
  })();
```

to:

```typescript
  const displayKpis = (() => {
    function countPlatform(key: 'tp' | 'ag' | 'cg') {
      const statusCol = key === 'tp'
        ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
        : (headers.find((h) => h.toLowerCase() === PLATFORM_STATUS_COL[key].toLowerCase()) ?? null);
      if (!statusCol) return { live: 0, removed: 0 };
      let live = 0, removed = 0;
      for (const e of kpiBase) {
        // A brand whose page on THIS platform has been delisted entirely
        // shouldn't count toward this card's Live/Removed totals — independent
        // per platform, matching the same exclusion applied in Score Summary.
        if (brandCol && isPlatformRemoved(e.data[brandCol], key)) continue;
        const v = (e.data[statusCol] ?? '').toLowerCase();
        if (isLive(v)) live++;
        else if (isRemoved(v)) removed++;
      }
      return { live, removed };
    }
    return { tp: countPlatform('tp'), ag: countPlatform('ag'), cg: countPlatform('cg') };
  })();
```

- [ ] **Step 5: Fix the single-platform `displayTotals` branch to use the tab's actual platform**

Change (currently lines 1409-1430 — note this also fixes a latent bug: today's code hardcodes the TP-removed check even for the Wizard of Odds tab, which has no TP page at all and should be checked against `'wo'`):

```typescript
  const displayTotals = (() => {
    if (activePlatforms.length > 1) {
      // Scope to the selected platform card; fall back to all when none chosen.
      const selectedPlatforms =
        platformFilter !== 'all' && activePlatforms.includes(platformFilter as 'tp' | 'ag' | 'cg')
          ? [platformFilter as 'tp' | 'ag' | 'cg']
          : activePlatforms;
      const live = selectedPlatforms.reduce((s, k) => s + displayKpis[k].live, 0);
      const removed = selectedPlatforms.reduce((s, k) => s + displayKpis[k].removed, 0);
      return { total: live + removed, live, removed };
    }
    let live = 0, removed = 0;
    for (const e of kpiBase) {
      // Single-platform tabs are TP-only (getTabPlatforms always includes 'tp'), so
      // this loop is implicitly counting Trust Pilot status — same TP-removed
      // exclusion as the multi-platform countPlatform('tp') branch above.
      if (brandCol && isTpRemoved(e.data[brandCol])) continue;
      const statuses = statusCols.map((h) => (e.data[h] ?? '').toLowerCase()).filter(Boolean);
      if (statuses.some(isLive)) live++;
      else if (statuses.some(isRemoved)) removed++;
    }
    return { total: live + removed, live, removed };
  })();
```

to:

```typescript
  const displayTotals = (() => {
    if (activePlatforms.length > 1) {
      // Scope to the selected platform card; fall back to all when none chosen.
      const selectedPlatforms =
        platformFilter !== 'all' && activePlatforms.includes(platformFilter as 'tp' | 'ag' | 'cg')
          ? [platformFilter as 'tp' | 'ag' | 'cg']
          : activePlatforms;
      const live = selectedPlatforms.reduce((s, k) => s + displayKpis[k].live, 0);
      const removed = selectedPlatforms.reduce((s, k) => s + displayKpis[k].removed, 0);
      return { total: live + removed, live, removed };
    }
    // Local `activePlatforms` above only ever tracks tp/ag/cg (it never
    // includes 'wo') and is empty for the Wizard of Odds tab specifically —
    // so this branch also covers WO-only tabs, not just TP-only ones. Use the
    // shared getTabPlatforms(tab) helper (which correctly returns ['wo'] for
    // Wizard of Odds) to know which single platform this loop is implicitly
    // counting, instead of assuming 'tp'.
    const soloPlatform: Platform = getTabPlatforms(decodedTab)[0] ?? 'tp';
    let live = 0, removed = 0;
    for (const e of kpiBase) {
      if (brandCol && isPlatformRemoved(e.data[brandCol], soloPlatform)) continue;
      const statuses = statusCols.map((h) => (e.data[h] ?? '').toLowerCase()).filter(Boolean);
      if (statuses.some(isLive)) live++;
      else if (statuses.some(isRemoved)) removed++;
    }
    return { total: live + removed, live, removed };
  })();
```

- [ ] **Step 6: Render one badge per removed platform in the three brand-cell branches**

In the `h === 'Brand / TP URL PAGE'` branch, change (currently 2 occurrences, around lines 2167 and 2175):

```tsx
                              {isTpRemoved(brandName) && <TpRemovedBadge />}
```

to (both occurrences, in the same branch):

```tsx
                              {removedPlatformsFor(brandName).map((p) => <PlatformRemovedBadge key={p} platform={p} />)}
```

In the `h === 'URL PAGE'` branch, change (currently 2 occurrences, around lines 2200 and 2207):

```tsx
                                {isTpRemoved(pageName) && <TpRemovedBadge />}
```

to:

```tsx
                                {removedPlatformsFor(pageName).map((p) => <PlatformRemovedBadge key={p} platform={p} />)}
```

In the `h === 'Brands' || h === 'Brand Name' || h === 'Brand'` branch, change (currently 2 occurrences, around lines 2244 and 2251):

```tsx
                              {isTpRemoved(brandName) && <TpRemovedBadge />}
```

to:

```tsx
                              {removedPlatformsFor(brandName).map((p) => <PlatformRemovedBadge key={p} platform={p} />)}
```

- [ ] **Step 7: Verify it compiles**

Run: `npm run build`
Expected: no new TypeScript errors in this file for the pieces touched so far. The `initialTpRemovedForEditEntry`/`onSave` block (lines ~1629-1635, ~2478-2501) still references the old `isTpRemoved`/`setBrandTpRemoved` names — Task 8 fixes those next; expect errors there until then.

- [ ] **Step 8: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: generalize BrandGroup badge rendering and KPI exclusion to all 4 platforms"
```

---

### Task 7: `EditEntryModal.tsx` — one checkbox per active platform

**Files:**
- Modify: `src/components/EditEntryModal.tsx`

**Interfaces:**
- Consumes: `getTabPlatforms` from `../lib/tab-configs` (already exported); `Platform`, `PLATFORM_LABEL` from `../lib/scoreSummary`.
- Produces: `Props.initialRemovedPlatforms?: Platform[]` (replaces `initialTpRemoved?: boolean`); `Props.onSave`'s third argument becomes `removedPlatforms?: Platform[]` (replaces `tpRemoved?: boolean`). Task 8 (`BrandGroup.tsx`, same call site as before) supplies the prop and reads the new argument shape.

- [ ] **Step 1: Add imports**

Change (currently lines 5, 8):

```typescript
import { getColLabel, getCountryForAccount, getBrandAgUrl, getBrandCgUrl, getBrandLinkCol, resolveBrandLink } from '../lib/tab-configs';
```

to:

```typescript
import { getColLabel, getCountryForAccount, getBrandAgUrl, getBrandCgUrl, getBrandLinkCol, resolveBrandLink, getTabPlatforms } from '../lib/tab-configs';
```

Add a new import line after line 9 (`import { PASTE_OFFSET_MAP } from '../lib/paste-map';`):

```typescript
import { PLATFORM_LABEL, type Platform } from '../lib/scoreSummary';
```

- [ ] **Step 2: Update the Props interface and component signature**

Change (currently lines 91-101):

```typescript
interface Props {
  entry: Entry;
  headers: string[];
  onClose: () => void;
  onSave: (fields: Record<string, string | null>, newTab?: string, tpRemoved?: boolean) => Promise<void>;
  currentTab?: string;
  availableBrands?: string[];
  brandCol?: string | null;
  brandProfiles?: Record<string, Record<string, string>>;
  initialTpRemoved?: boolean;
}
```

to:

```typescript
interface Props {
  entry: Entry;
  headers: string[];
  onClose: () => void;
  onSave: (fields: Record<string, string | null>, newTab?: string, removedPlatforms?: Platform[]) => Promise<void>;
  currentTab?: string;
  availableBrands?: string[];
  brandCol?: string | null;
  brandProfiles?: Record<string, Record<string, string>>;
  initialRemovedPlatforms?: Platform[];
}
```

Change the function signature and its local state (currently lines 108-109):

```typescript
export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles, initialTpRemoved }: Props) {
  const [tpRemoved, setTpRemoved] = useState(initialTpRemoved ?? false);
```

to:

```typescript
export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles, initialRemovedPlatforms }: Props) {
  const [removedPlatforms, setRemovedPlatforms] = useState<Set<Platform>>(new Set(initialRemovedPlatforms ?? []));
  const tabPlatforms = currentTab ? getTabPlatforms(currentTab) : [];
```

- [ ] **Step 3: Pass the platform list through on save**

Change `handleSave` (currently lines 129-142):

```typescript
  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const out: Record<string, string | null> = {};
      for (const h of headers) out[h] = fields[h] || null;
      const tabChanged = selectedTab && selectedTab !== currentTab ? selectedTab : undefined;
      await onSave(out, tabChanged, tpRemoved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  }
```

to:

```typescript
  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const out: Record<string, string | null> = {};
      for (const h of headers) out[h] = fields[h] || null;
      const tabChanged = selectedTab && selectedTab !== currentTab ? selectedTab : undefined;
      await onSave(out, tabChanged, [...removedPlatforms]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  }
```

- [ ] **Step 4: Replace the single checkbox with one per active platform**

Change (currently lines 327-340):

```tsx
              {brandCol && availableBrands && availableBrands.length > 0 && (
                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                    <input
                      type="checkbox"
                      checked={tpRemoved}
                      disabled={saving}
                      onChange={(e) => setTpRemoved(e.target.checked)}
                      className="rounded border-slate-300 text-rose-600 focus:ring-rose-400"
                    />
                    TP page removed
                  </label>
                </div>
              )}
```

to:

```tsx
              {brandCol && availableBrands && availableBrands.length > 0 && tabPlatforms.length > 0 && (
                <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 pb-1 sm:col-span-6">
                  {tabPlatforms.map((p) => (
                    <label key={p} className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                      <input
                        type="checkbox"
                        checked={removedPlatforms.has(p)}
                        disabled={saving}
                        onChange={(e) =>
                          setRemovedPlatforms((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p); else next.delete(p);
                            return next;
                          })
                        }
                        className="rounded border-slate-300 text-rose-600 focus:ring-rose-400"
                      />
                      {PLATFORM_LABEL[p]} page removed
                    </label>
                  ))}
                </div>
              )}
```

(This moves the checkbox row onto its own full-width line below Brand Tab/Brand Name — `col-span-2 sm:col-span-6` — since it can now hold up to 3 checkboxes instead of always fitting one inline.)

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: `BrandGroup.tsx`'s `<EditEntryModal>` usage (not yet updated) will now show a type error — its `initialTpRemoved` prop no longer exists on `Props`, and its `onSave` callback's third parameter type changed. This is expected; Task 8 fixes that call site immediately next.

- [ ] **Step 6: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "feat: replace single TP checkbox with one per active platform in Edit Entry modal"
```

---

### Task 8: Wire the per-platform toggle into `BrandGroup.tsx`

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `setBrandPlatformRemoved` (Task 4), `isPlatformRemoved`/`removedPlatformsFor` (Task 6), `EditEntryModal`'s new `Props`/`onSave` shape (Task 7).

- [ ] **Step 1: Replace the single-boolean initial-state computation**

Change (currently lines 1629-1635):

```typescript
  // The Edit Entry modal's initial checkbox state for the entry currently
  // being edited. Computed once per render (not inside onSave's closure) so
  // onSave can compare the saved value against it and only call
  // setBrandTpRemoved when the checkbox actually changed — otherwise every
  // routine save of an already-flagged brand's row would re-fire the toggle,
  // silently overwriting removed_by/removed_at for no reason.
  const initialTpRemovedForEditEntry = editEntry && brandCol ? isTpRemoved(editEntry.data[brandCol]) : false;
```

to:

```typescript
  // The Edit Entry modal's initial per-platform checkbox state for the entry
  // currently being edited. Computed once per render (not inside onSave's
  // closure) so onSave can diff the saved set against it and only call
  // setBrandPlatformRemoved for platforms whose checkbox actually changed —
  // otherwise every routine save of an already-flagged brand's row would
  // re-fire every toggle, silently overwriting removed_by/removed_at for no
  // reason.
  const initialRemovedPlatformsForEditEntry: Platform[] =
    editEntry && brandCol ? removedPlatformsFor(editEntry.data[brandCol]) : [];
```

- [ ] **Step 2: Update the `<EditEntryModal>` usage**

Change (currently lines 2478-2501):

```tsx
          currentTab={decodedTab}
          availableBrands={uniqueBrands}
          brandCol={brandCol}
          brandProfiles={brandProfiles}
          initialTpRemoved={initialTpRemovedForEditEntry}
          onClose={() => setEditEntry(null)}
          onSave={async (fields, newTab, tpRemoved) => {
            if (newTab && newTab !== editEntry.tab) {
              await moveEntryToTab(editEntry.id, editEntry.tab, newTab);
            }
            await updateEntryData(editEntry.id, newTab ?? editEntry.tab, fields);
            setEntries((prev) =>
              prev.map((e) => (e.id === editEntry.id ? { ...e, data: { ...e.data, ...fields }, tab: newTab ?? e.tab } : e)),
            );
            // Only write the flag when the checkbox actually changed — not on
            // every save of an already-flagged brand's row (see the comment
            // on initialTpRemovedForEditEntry above).
            if (brandCol && tpRemoved !== undefined && tpRemoved !== initialTpRemovedForEditEntry) {
              const targetTab = newTab ?? editEntry.tab;
              const brandName = fields[brandCol] ?? editEntry.data[brandCol];
              if (brandName) await setBrandTpRemoved(targetTab, brandName, tpRemoved);
            }
            reloadRef.current();
          }}
        />
```

to:

```tsx
          currentTab={decodedTab}
          availableBrands={uniqueBrands}
          brandCol={brandCol}
          brandProfiles={brandProfiles}
          initialRemovedPlatforms={initialRemovedPlatformsForEditEntry}
          onClose={() => setEditEntry(null)}
          onSave={async (fields, newTab, removedPlatforms) => {
            if (newTab && newTab !== editEntry.tab) {
              await moveEntryToTab(editEntry.id, editEntry.tab, newTab);
            }
            await updateEntryData(editEntry.id, newTab ?? editEntry.tab, fields);
            setEntries((prev) =>
              prev.map((e) => (e.id === editEntry.id ? { ...e, data: { ...e.data, ...fields }, tab: newTab ?? e.tab } : e)),
            );
            // Only write a platform's flag when that platform's checkbox
            // actually changed — not on every save of an already-flagged
            // brand's row (see the comment on
            // initialRemovedPlatformsForEditEntry above). Diffed
            // independently per platform so toggling one platform never
            // touches another's flag/removed_by/removed_at.
            if (brandCol && removedPlatforms !== undefined) {
              const targetTab = newTab ?? editEntry.tab;
              const brandName = fields[brandCol] ?? editEntry.data[brandCol];
              if (brandName) {
                const wasRemoved = new Set(initialRemovedPlatformsForEditEntry);
                const nowRemoved = new Set(removedPlatforms);
                for (const p of getTabPlatforms(targetTab)) {
                  if (wasRemoved.has(p) !== nowRemoved.has(p)) {
                    await setBrandPlatformRemoved(targetTab, brandName, p, nowRemoved.has(p));
                  }
                }
              }
            }
            reloadRef.current();
          }}
        />
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: no TypeScript errors anywhere in `BrandGroup.tsx` or `EditEntryModal.tsx` now.

- [ ] **Step 4: Verify manually**

Run: `npm run dev`. Open `/brands/hanan`, edit a non-flagged brand's row (e.g. any Hanan brand not already seeded as removed) — confirm 3 checkboxes appear: "TrustPilot page removed", "AskGamblers page removed", "CasinoGuru page removed". Check only "AskGamblers page removed", save. Confirm: every row sharing that brand shows exactly one "AG" badge (not "TP" or "CG"); the brand is excluded from Score Summary's AskGamblers view but still appears normally in the TrustPilot and CasinoGuru views. Uncheck it, save, confirm the badge and exclusion both disappear. Open `/brands/tp-brand-injection` (TP-only tab) and confirm only 1 checkbox appears ("TrustPilot page removed"). Open `/brands/wizard-of-odds` and confirm only 1 checkbox appears, labeled "Wizard of Odds page removed" (not "TP page removed").

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: wire per-platform toggle from Edit Entry modal to removed_platform_brands"
```

---

### Task 9: `ScoreSummary.tsx` / `ScoreSummaryPanel.tsx` — rename to platform-generic

**Files:**
- Modify: `src/pages/ScoreSummary.tsx`
- Modify: `src/components/ScoreSummaryPanel.tsx`

**Interfaces:**
- Consumes: `fetchRemovedPlatformBrands` (Task 4), `buildRemovedPlatformBrandSet` (Task 2), the generalized `computeScoreSummary`/`computeSuccessRates`/`computeTabSuccessRates` (Task 3).

- [ ] **Step 1: Update `ScoreSummary.tsx`**

Change (the whole file, currently 56 lines):

```tsx
import { useEffect, useState } from 'react';
import ScoreSummaryPanel from '../components/ScoreSummaryPanel';
import { fetchAllEntries, fetchRemovedTpBrands } from '../lib/queries';
import { buildRemovedTpBrandSet } from '../lib/removedTpBrands';
import { OPERATIONAL_TABS } from '../lib/tabs';
import type { Entry } from '../types/entry';

export default function ScoreSummary() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [removedTpBrands, setRemovedTpBrands] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchAllEntries(OPERATIONAL_TABS), fetchRemovedTpBrands()])
      .then(([entryRows, removedRows]) => {
        if (cancelled) return;
        setEntries(entryRows);
        setRemovedTpBrands(buildRemovedTpBrandSet(removedRows));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScoreSummaryPanel entries={entries} removedTpBrands={removedTpBrands} />
    </div>
  );
}
```

to:

```tsx
import { useEffect, useState } from 'react';
import ScoreSummaryPanel from '../components/ScoreSummaryPanel';
import { fetchAllEntries, fetchRemovedPlatformBrands } from '../lib/queries';
import { buildRemovedPlatformBrandSet } from '../lib/removedPlatformBrands';
import { OPERATIONAL_TABS } from '../lib/tabs';
import type { Entry } from '../types/entry';

export default function ScoreSummary() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [removedPlatformBrands, setRemovedPlatformBrands] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchAllEntries(OPERATIONAL_TABS), fetchRemovedPlatformBrands()])
      .then(([entryRows, removedRows]) => {
        if (cancelled) return;
        setEntries(entryRows);
        setRemovedPlatformBrands(buildRemovedPlatformBrandSet(removedRows));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScoreSummaryPanel entries={entries} removedPlatformBrands={removedPlatformBrands} />
    </div>
  );
}
```

- [ ] **Step 2: Update `ScoreSummaryPanel.tsx`**

Change the `Props` interface, module-level constant, and function signature (currently lines 20-29, 96):

```typescript
interface Props {
  entries: Entry[];
  removedTpBrands?: Set<string>;
}

// Module-level constant so an omitted `removedTpBrands` prop doesn't create a
// fresh Set identity on every render — a new inline `new Set()` default would
// defeat the useMemos below that depend on it, recomputing on every render
// even when nothing actually changed.
const EMPTY_REMOVED_TP_BRANDS: Set<string> = new Set();
```

to:

```typescript
interface Props {
  entries: Entry[];
  removedPlatformBrands?: Set<string>;
}

// Module-level constant so an omitted `removedPlatformBrands` prop doesn't
// create a fresh Set identity on every render — a new inline `new Set()`
// default would defeat the useMemos below that depend on it, recomputing on
// every render even when nothing actually changed.
const EMPTY_REMOVED_PLATFORM_BRANDS: Set<string> = new Set();
```

Change the component signature and the three `useMemo` calls (currently around lines 96, 109-121):

```typescript
export default function ScoreSummaryPanel({ entries, removedTpBrands = EMPTY_REMOVED_TP_BRANDS }: Props) {
```

to:

```typescript
export default function ScoreSummaryPanel({ entries, removedPlatformBrands = EMPTY_REMOVED_PLATFORM_BRANDS }: Props) {
```

```typescript
  const result = useMemo(
    () => computeScoreSummary(entries, range, [], platform, removedTpBrands),
    [entries, range, platform, removedTpBrands],
  );

  const successRates = useMemo(
    () => computeSuccessRates(entries, platform, removedTpBrands),
    [entries, platform, removedTpBrands],
  );

  const tabSuccessRates = useMemo(
    () => computeTabSuccessRates(entries, platform, removedTpBrands),
    [entries, platform, removedTpBrands],
  );
```

to:

```typescript
  const result = useMemo(
    () => computeScoreSummary(entries, range, [], platform, removedPlatformBrands),
    [entries, range, platform, removedPlatformBrands],
  );

  const successRates = useMemo(
    () => computeSuccessRates(entries, platform, removedPlatformBrands),
    [entries, platform, removedPlatformBrands],
  );

  const tabSuccessRates = useMemo(
    () => computeTabSuccessRates(entries, platform, removedPlatformBrands),
    [entries, platform, removedPlatformBrands],
  );
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Verify manually**

Run: `npm run dev`. Open Score Summary. Switch to the AskGamblers platform tab, confirm no regression (brands not flagged for AG still show normally). If Task 8's manual test flagged a Hanan brand's AG page removed and you haven't unflagged it yet, confirm that brand is excluded from the AskGamblers view here and still visible in the TrustPilot view.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ScoreSummary.tsx src/components/ScoreSummaryPanel.tsx
git commit -m "feat: rename Score Summary's removedTpBrands prop to removedPlatformBrands"
```

---

### Task 10: `Overview.tsx` — rename to platform-generic

**Files:**
- Modify: `src/pages/Overview.tsx`

**Interfaces:**
- Consumes: `fetchRemovedPlatformBrands` (Task 4), `buildRemovedPlatformBrandSet` (Task 2).

- [ ] **Step 1: Update imports and `loadData`**

Change (currently near the top of the file):

```typescript
import KpiCard from '../components/KpiCard';
import { fetchTabKpis, fetchRemovedTpBrands } from '../lib/queries';
import { buildRemovedTpBrandSet } from '../lib/removedTpBrands';
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
import type { TabKpis } from '../types/brand-entry';
```

to:

```typescript
import KpiCard from '../components/KpiCard';
import { fetchTabKpis, fetchRemovedPlatformBrands } from '../lib/queries';
import { buildRemovedPlatformBrandSet } from '../lib/removedPlatformBrands';
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
import type { TabKpis } from '../types/brand-entry';
```

Change `loadData` (currently around lines 300-314):

```typescript
  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const removedTpBrands = await fetchRemovedTpBrands()
        .then(buildRemovedTpBrandSet)
        .catch(() => new Set<string>());
      const tabResults = await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchTabKpis(tab, dateFrom || undefined, dateTo || undefined, removedTpBrands)
            .then((kpis): TabSummary => ({ tab, kpis }))
            .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
        )
      );
      setState({ loading: false, error: null, tabs: tabResults });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo]);
```

to:

```typescript
  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const removedPlatformBrands = await fetchRemovedPlatformBrands()
        .then(buildRemovedPlatformBrandSet)
        .catch(() => new Set<string>());
      const tabResults = await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchTabKpis(tab, dateFrom || undefined, dateTo || undefined, removedPlatformBrands)
            .then((kpis): TabSummary => ({ tab, kpis }))
            .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
        )
      );
      setState({ loading: false, error: null, tabs: tabResults });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo]);
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: no TypeScript errors anywhere in the project now — this is the last file referencing the old names.

- [ ] **Step 3: Verify manually**

Run: `npm run dev`. Open the Overview page. Confirm the global AskGamblers total reflects Task 8's manual test (if a Hanan brand's AG page was left flagged, its AG-status rows are excluded from the AskGamblers card's Live/Removed total, while its TP/CG rows still count normally in their own cards).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat: rename Overview's removedTpBrands to removedPlatformBrands"
```

---

### Task 11: Final verification

**Files:** `CLAUDE.md` (Recent Changes entry only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including `removedPlatformBrands.test.ts` and the updated `scoreSummary.test.ts`.

- [ ] **Step 2: Run the full build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Full manual walkthrough**

Run `npm run dev` and, per the spec's Testing section (some of this overlaps with Tasks 8-10's per-task manual checks — re-verify end to end here since this is the first point everything is wired together):
- The 14 originally-seeded brands still show their TP badge and are still excluded from Score Summary's TrustPilot view and the Trust Pilot KPI cards (zero regression).
- Flag a 3-platform tab's brand (e.g. a Hanan brand) as AG-removed only — confirm one "AG" badge, exclusion from Score Summary's AskGamblers view and the Ask Gambler KPI card, TP/CG untouched.
- Flag the same brand as both TP- and AG-removed — confirm two badges, both exclusions independently, CG untouched.
- Flag a Wizard of Odds brand as WO-removed — confirm a "WO" badge (not "TP"), exclusion from that tab's own KPI card, and the checkbox is labeled "Wizard of Odds page removed".
- Uncheck one platform's checkbox while another stays checked — confirm only that platform's flag/badge/exclusion clears.
- Leave all test data unflagged/restored to its original state when done (undo any flags you added during this walkthrough that weren't part of the original 14 seeded rows).

- [ ] **Step 4: Update CLAUDE.md's Recent Changes**

Add an entry describing this generalization (superseding the TP-only entry added earlier today), following the existing entry style in that file: new `removed_platform_brands` table (renamed from `removed_tp_brands`, `platform` column added), labeled per-platform badge, per-platform Edit Entry checkboxes, and per-platform Score Summary/KPI exclusion.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note multi-platform removed-brand flag generalization in CLAUDE.md"
```
