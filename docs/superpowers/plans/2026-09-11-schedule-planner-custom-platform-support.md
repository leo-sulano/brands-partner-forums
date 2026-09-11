# Schedule Planner Custom Platform Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a custom (user-defined) platform enabled on a tab get real Schedule Planner behavior — auto-generated scheduling (one fixed default rule), auto-pause, and PMS task sync — identical to a built-in platform, with zero further code changes for any future custom platform or tab.

**Architecture:** Widen the scheduler subsystem's platform type from the closed `Platform` union to a runtime string (`SchedulablePlatform = string`), with `getTabPlatforms(tab)` as the single chokepoint that appends a tab's custom platform ids after the 4 built-ins. Every downstream scheduler function already operates generically over "whatever `getTabPlatforms` returns," so widening that one function's output — plus turning the `Record<Platform, X>` lookup tables into resolver functions with a custom-platform fallback — is what makes everything else "just work." `Platform` itself and its 218 usages outside the scheduler are completely untouched.

**Tech Stack:** React 19, TypeScript, Supabase (Postgres + supabase-js + Deno Edge Functions), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-schedule-planner-custom-platform-support-design.md`

## Global Constraints

- `Platform` (`'tp'|'ag'|'cg'|'wo'`, in `src/lib/removedPlatformBrands.ts`) is NEVER modified and its 218 existing usages outside `src/lib/scheduler/`, `src/lib/tab-configs.ts`, `src/lib/tabIcons.ts`, and `supabase/functions/generate-weekly-schedule`/`sync-schedule-pms` stay completely untouched.
- A custom platform's identity in every scheduler-owned table and in-memory structure is `custom_platforms.id` (a uuid string) — never `platform_key` (that field is never exposed to the frontend; see the spec's correction note).
- A custom platform's fixed scheduling rule is `{ postsPerWeek: 1, preferredDays: [] }` — no per-platform configuration UI, matching CG's existing built-in cadence.
- Every generalized lookup function must produce byte-identical output to the current `Record<Platform, X>` for all 4 built-in keys — this is the regression-safety bar; write a test proving it for each one.
- `tab-configs.ts` must never import from `customPlatformRegistry.ts`/`customPlatforms.ts` directly — `customPlatformRegistry.ts` already imports FROM `tab-configs.ts`, and a reverse import closes a real circular-import cycle. Use the existing resolver-injection pattern (`setDynamicColumnsResolver`/`setCustomPlatformColumnsResolver`) for the new wiring.
- Verify with `npm run build`, not `tsc --noEmit` — the root tsconfig is references-only.
- `npx vitest run` for JS/TS tests; `deno check`/`deno test` for the two Deno Edge Functions this plan touches (`generate-weekly-schedule`, `sync-schedule-pms`).

---

### Task 1: Migration — drop the platform enum CHECK constraint on 9 tables

**Files:**
- Create: `supabase/migrations/20260911140000_widen_schedule_platform_columns.sql`

**Interfaces:**
- Produces: 9 tables whose `platform`/`allowed_platform` column accepts any text value (still `not null` where it already was) — consumed by every later task that writes a custom platform's id into one of these columns.

- [ ] **Step 1: Write the migration**

First, find each table's exact constraint name (Postgres auto-names an inline `check` as `<table>_<column>_check` unless the origin migration named it explicitly — verify against each origin file listed below before writing the `drop constraint` line, since a wrong name makes the migration a no-op that fails silently in `IF EXISTS` form or errors without it). The 9 tables and their origin migrations:

| Table | Column | Origin migration |
|---|---|---|
| `brand_schedule` | `platform` | `20260801090000_add_schedule_platform_and_pause.sql` |
| `brand_platform_pause` | `platform` | `20260801090000_add_schedule_platform_and_pause.sql` |
| `brand_platform_override` | `platform` | `20260807110000_add_flagged_platform_brands_and_override.sql` |
| `schedule_platform_restrictions` | `allowed_platform` | `20260811150000_add_schedule_brand_visibility.sql` |
| `schedule_pms_links` | `platform` | `20260817120000_add_schedule_pms_links.sql` |
| `tab_hidden_platforms` | `platform` | `20260818140000_add_tab_hidden_platforms.sql` |
| `brand_agent_assignments` | `platform` | `20260819120000_add_brand_agent_assignments.sql` |
| `schedule_cancellations` | `platform` | `20260901120000_add_schedule_cancellations.sql` |
| `schedule_manual_pauses` | `platform` | `20260908120000_add_schedule_manual_pauses.sql` |

For each table, read its origin migration file, find the exact `check (...)` clause on the relevant column, and determine the constraint's real name — run this query against the live database (or reason from `information_schema.check_constraints`/`pg_constraint` if you have DB access; if not, use Postgres's default auto-generated name `<table>_<column>_check`, which applies unless the origin file explicitly wrote `constraint <name> check (...)`) to confirm before writing the DROP. Write the migration as:

```sql
-- supabase/migrations/20260911140000_widen_schedule_platform_columns.sql
-- Drops the platform-enum CHECK constraint on every scheduler-owned table so
-- a custom (user-defined) platform's custom_platforms.id (a uuid string) can
-- be stored in the same column alongside the 4 built-in 2-letter codes.
-- Mirrors entries.tab's existing precedent: a free-text identifier column
-- with no DB-level enum enforcement, validated at the app layer instead.
-- Spec: docs/superpowers/specs/2026-09-11-schedule-planner-custom-platform-support-design.md

alter table public.brand_schedule
  drop constraint if exists brand_schedule_platform_check;

alter table public.brand_platform_pause
  drop constraint if exists brand_platform_pause_platform_check;

alter table public.brand_platform_override
  drop constraint if exists brand_platform_override_platform_check;

alter table public.schedule_platform_restrictions
  drop constraint if exists schedule_platform_restrictions_allowed_platform_check;

alter table public.schedule_pms_links
  drop constraint if exists schedule_pms_links_platform_check;

alter table public.tab_hidden_platforms
  drop constraint if exists tab_hidden_platforms_platform_check;

alter table public.brand_agent_assignments
  drop constraint if exists brand_agent_assignments_platform_check;

alter table public.schedule_cancellations
  drop constraint if exists schedule_cancellations_platform_check;

alter table public.schedule_manual_pauses
  drop constraint if exists schedule_manual_pauses_platform_check;
```

Using `if exists` on every drop means an incorrectly-guessed constraint name fails silently (a no-op) rather than erroring the whole migration — if you cannot verify the real names against the live database, note this explicitly in your report as a risk for the controller to verify before `supabase db push` (Task 13), since a silent no-op here would let every later task's code ship while the DB still rejects a custom platform's id with the old CHECK violation.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260911140000_widen_schedule_platform_columns.sql
git commit -m "feat: drop platform enum CHECK constraint on 9 scheduler tables"
```

Do NOT run `supabase db push` yet — deployment happens once, in Task 13.

---

### Task 2: `customPlatformRegistry.ts` — add id-lookup and id-list helpers

**Files:**
- Modify: `src/lib/customPlatformRegistry.ts`
- Test: `src/lib/customPlatformRegistry.test.ts` (check if it exists; extend or create)

**Interfaces:**
- Consumes: existing `byTab: Record<string, CustomPlatformConfig[]>` module state (already in this file).
- Produces: `getCustomPlatformById(id: string): CustomPlatformConfig | undefined`, `getCustomPlatformIds(tab: string): string[]` — consumed by Task 3 (`tab-configs.ts`'s resolver wiring) and Task 5 (`scheduleUtils.ts`'s badge/label resolvers).

- [ ] **Step 1: Write the failing test**

Check whether `src/lib/customPlatformRegistry.test.ts` already exists. If it does, add these tests to it (using its existing `beforeEach`/`afterEach` reset pattern if one exists — call `resetTabCustomPlatforms()` before/after each test either way). If it doesn't exist, create it:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import {
  registerTabCustomPlatforms, resetTabCustomPlatforms,
  getCustomPlatformById, getCustomPlatformIds,
  type CustomPlatformConfig,
} from './customPlatformRegistry';

const YELP: CustomPlatformConfig = {
  id: 'p1', tab: 'BITP', name: 'Yelp', shortLabel: 'YP',
  statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
};
const G2: CustomPlatformConfig = {
  id: 'p2', tab: 'Hanan', name: 'G2', shortLabel: 'G2',
  statusColumn: 'G2 Review Status', dateColumn: 'G2 Review Added', maxScore: null,
};

describe('getCustomPlatformById', () => {
  afterEach(() => resetTabCustomPlatforms());

  it('finds a registered platform by id regardless of which tab registered it', () => {
    registerTabCustomPlatforms([YELP, G2]);
    expect(getCustomPlatformById('p1')).toEqual(YELP);
    expect(getCustomPlatformById('p2')).toEqual(G2);
  });

  it('returns undefined for an unregistered id', () => {
    registerTabCustomPlatforms([YELP]);
    expect(getCustomPlatformById('nonexistent')).toBeUndefined();
  });
});

describe('getCustomPlatformIds', () => {
  afterEach(() => resetTabCustomPlatforms());

  it('returns the ids of every custom platform registered for a tab', () => {
    registerTabCustomPlatforms([YELP, G2]);
    expect(getCustomPlatformIds('BITP')).toEqual(['p1']);
    expect(getCustomPlatformIds('Hanan')).toEqual(['p2']);
  });

  it('returns an empty array for a tab with no custom platforms', () => {
    expect(getCustomPlatformIds('NoCustomTab')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/customPlatformRegistry.test.ts`
Expected: FAIL — `getCustomPlatformById`/`getCustomPlatformIds` are not exported

- [ ] **Step 3: Write the implementation**

Add to `src/lib/customPlatformRegistry.ts`, right after the existing `getTabCustomPlatforms` function (after its closing `}`, before `getCustomPlatformColumns`):

```typescript
// A custom platform's id is globally unique (custom_platforms.id, a uuid
// primary key) even though `byTab` is organized per tab a platform is
// enabled on -- the same custom platform can be enabled on more than one
// tab, so this searches every tab's list rather than assuming a 1:1 mapping.
// Used by scheduler code that only has an id (from a DB row's `platform`
// column) and needs the platform's name/shortLabel for display, without
// needing to also know which tab context it's being rendered in.
export function getCustomPlatformById(id: string): CustomPlatformConfig | undefined {
  for (const rows of Object.values(byTab)) {
    const found = rows.find((r) => r.id === id);
    if (found) return found;
  }
  return undefined;
}

// The scheduler's chokepoint helper -- getTabPlatforms (tab-configs.ts) calls
// this via the resolver-injection pattern below to append a tab's custom
// platform ids to its built-in platform list, without tab-configs.ts ever
// importing this module directly (see the circular-import note at the
// bottom of this file).
export function getCustomPlatformIds(tab: string): string[] {
  return getTabCustomPlatforms(tab).map((p) => p.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/customPlatformRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/customPlatformRegistry.ts src/lib/customPlatformRegistry.test.ts
git commit -m "feat: add getCustomPlatformById/getCustomPlatformIds to customPlatformRegistry"
```

---

### Task 3: `tab-configs.ts` — resolver wiring and the `getTabPlatforms` chokepoint

**Files:**
- Modify: `src/lib/tab-configs.ts`
- Test: `src/lib/tab-configs.test.ts`

**Interfaces:**
- Consumes: nothing from `customPlatformRegistry.ts` directly (resolver-injection only, to avoid the circular import).
- Produces: `setCustomPlatformKeysResolver(fn: (tab: string) => string[]): void`, `getTabPlatforms(tab: string): string[]` (widened return type — was `('tp'|'ag'|'cg'|'wo')[]`), `getTabPlatformsUnfiltered(tab: string): string[]` (same widening), `registerHiddenTabPlatforms(rows: { tab: string; platform: string }[]): void` (widened), `unregisterHiddenTabPlatform(tab: string, platform: string): void` (widened) — consumed by every later task in this plan (this is the chokepoint every scheduler surface already calls).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tab-configs.test.ts` (find its existing `describe('getTabPlatforms', ...)` block if one exists and add alongside it; otherwise add a new `describe` block):

```typescript
import { setCustomPlatformKeysResolver, getTabPlatforms, getTabPlatformsUnfiltered } from './tab-configs';

describe('getTabPlatforms with a custom platform resolver', () => {
  afterEach(() => {
    setCustomPlatformKeysResolver(() => []); // reset to the default no-op
  });

  it('appends custom platform ids after the built-in platforms', () => {
    setCustomPlatformKeysResolver((tab) => (tab === 'BITP' ? ['custom-id-1'] : []));
    const result = getTabPlatforms('BITP');
    expect(result[result.length - 1]).toBe('custom-id-1');
    expect(result).toContain('tp'); // BITP is TP-only per its existing hardcoded config
  });

  it('getTabPlatformsUnfiltered also includes custom platform ids', () => {
    setCustomPlatformKeysResolver((tab) => (tab === 'BITP' ? ['custom-id-1'] : []));
    expect(getTabPlatformsUnfiltered('BITP')).toContain('custom-id-1');
  });

  it('a tab with no resolver-returned ids behaves exactly as before (regression)', () => {
    setCustomPlatformKeysResolver(() => []);
    expect(getTabPlatforms('BITP')).toEqual(['tp']);
  });
});
```

(Check the real hardcoded platform set for `'BITP'` against `TAB_COLUMN_CONFIGS` in this same file before trusting the `['tp']` assertion above — if BITP tracks more than just TP, adjust the assertion to match its real built-in set, keeping the custom-id-at-the-end assertion pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tab-configs.test.ts -t "custom platform resolver"`
Expected: FAIL — `setCustomPlatformKeysResolver` is not exported

- [ ] **Step 3: Write the implementation**

In `src/lib/tab-configs.ts`, right after the existing `customPlatformColumnsResolver`/`setCustomPlatformColumnsResolver` block (after line 238's closing `}`), add:

```typescript
let customPlatformKeysResolver: ((tab: string) => string[]) | null = null;

// Injected by customPlatformRegistry.ts at module load, same resolver-
// injection pattern as setCustomPlatformColumnsResolver above -- lets
// getTabPlatforms/getTabPlatformsUnfiltered append a tab's custom platform
// ids without this file importing customPlatformRegistry.ts directly (which
// already imports FROM this file, so a reverse import would be circular).
// Spec: docs/superpowers/specs/2026-09-11-schedule-planner-custom-platform-support-design.md
export function setCustomPlatformKeysResolver(fn: (tab: string) => string[]): void {
  customPlatformKeysResolver = fn;
}
```

Replace `computeRawTabPlatforms`'s signature and every one of its 3 internal `('tp' | 'ag' | 'cg' | 'wo')[]` type annotations with `string[]` (the function's actual VALUES — the literal `'tp'`/`'ag'`/`'cg'`/`'wo'` strings it pushes — do not change; only its type annotations widen):

```typescript
function computeRawTabPlatforms(tab: string): string[] {
  const cols = getTabColumns(tab);
  const key = resolveHardcodedTabKey(tab);
  if (key === 'Wizard of Odds') return ['wo'];
  if (key in TAB_COLUMN_CONFIGS) {
    const platforms: string[] = ['tp'];
    if (cols) {
      const set = new Set(cols);
      if (set.has('AG Review Status')) platforms.push('ag');
      if (set.has('CG Review Status')) platforms.push('cg');
    }
    return platforms;
  }
  if (!cols) return [];
  const set = new Set(cols);
  const platforms: string[] = [];
  if (set.has('TP Review Status')) platforms.push('tp');
  if (set.has('AG Review Status')) platforms.push('ag');
  if (set.has('CG Review Status')) platforms.push('cg');
  if (set.has('WoO Review Status')) platforms.push('wo');
  return platforms;
}
```

Add a new private helper right after `computeRawTabPlatforms`, and route both `getTabPlatformsUnfiltered` and `getTabPlatforms` through it instead of calling `computeRawTabPlatforms` directly:

```typescript
// The chokepoint every scheduler surface calls (directly or via
// getTabPlatforms below) to learn "what platforms does this tab schedule" --
// appends the tab's registered custom platform ids after its built-in set.
function computeRawTabPlatformsWithCustom(tab: string): string[] {
  const builtIn = computeRawTabPlatforms(tab);
  const custom = customPlatformKeysResolver ? customPlatformKeysResolver(tab) : [];
  return custom.length ? [...builtIn, ...custom] : builtIn;
}
```

Replace `getTabPlatformsUnfiltered` (was `export function getTabPlatformsUnfiltered(tab: string): ('tp' | 'ag' | 'cg' | 'wo')[] { return computeRawTabPlatforms(tab); }`):

```typescript
export function getTabPlatformsUnfiltered(tab: string): string[] {
  return computeRawTabPlatformsWithCustom(tab);
}
```

Widen `hiddenTabPlatforms` and its 2 accessor functions (`registerHiddenTabPlatforms`, `unregisterHiddenTabPlatform`) — replace the existing declarations:

```typescript
const hiddenTabPlatforms: Record<string, Set<string>> = {};
```

```typescript
export function registerHiddenTabPlatforms(rows: { tab: string; platform: string }[]): void {
  for (const row of rows) {
    if (!hiddenTabPlatforms[row.tab]) hiddenTabPlatforms[row.tab] = new Set();
    hiddenTabPlatforms[row.tab].add(row.platform);
  }
  notifyTabPlatformsChanged();
}

export function unregisterHiddenTabPlatform(tab: string, platform: string): void {
  hiddenTabPlatforms[tab]?.delete(platform);
  notifyTabPlatformsChanged();
}
```

Replace `getTabPlatforms` (was returning `('tp' | 'ag' | 'cg' | 'wo')[]`, calling bare `computeRawTabPlatforms`):

```typescript
export function getTabPlatforms(tab: string): string[] {
  const raw = computeRawTabPlatformsWithCustom(tab);
  const hidden = hiddenTabPlatforms[tab];
  return hidden ? raw.filter((p) => !hidden.has(p)) : raw;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tab-configs.test.ts`
Expected: PASS — the 3 new tests, plus every pre-existing `getTabPlatforms`/`getTabPlatformsUnfiltered`/`registerHiddenTabPlatforms` test in this file (all of which pass a resolver-unset/empty-custom-set default, so their behavior is unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "feat: widen getTabPlatforms chokepoint to include custom platform ids"
```

---

### Task 4: Wire `customPlatformRegistry.ts`'s self-registration into the new resolver

**Files:**
- Modify: `src/lib/customPlatformRegistry.ts`

**Interfaces:**
- Consumes: `setCustomPlatformKeysResolver` (Task 3), `getCustomPlatformIds` (Task 2, same file).

- [ ] **Step 1: Add the import and self-registration call**

In `src/lib/customPlatformRegistry.ts`, update the existing import line (currently `import { setCustomPlatformColumnsResolver } from './tab-configs.ts';`):

```typescript
import { setCustomPlatformColumnsResolver, setCustomPlatformKeysResolver } from './tab-configs.ts';
```

Add a second self-registration call right after the existing one at the bottom of the file (currently `setCustomPlatformColumnsResolver(getCustomPlatformColumns);` is the last line):

```typescript
setCustomPlatformColumnsResolver(getCustomPlatformColumns);
setCustomPlatformKeysResolver(getCustomPlatformIds);
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors

- [ ] **Step 3: Manual verification the chokepoint actually connects**

Run: `npx vitest run src/lib/customPlatformRegistry.test.ts src/lib/tab-configs.test.ts`
Expected: both files still pass (this task doesn't add new test cases — the connection between the two modules is exercised implicitly wherever real app code calls `getTabPlatforms` after `customPlatformRegistry.ts` has been imported, which happens at the app's module-graph root; Task 9's integration tests are what actually prove the live wiring end-to-end).

- [ ] **Step 4: Commit**

```bash
git add src/lib/customPlatformRegistry.ts
git commit -m "feat: self-register customPlatformRegistry's id resolver with tab-configs"
```

---

### Task 5: `schedulerRules.ts` — `SchedulablePlatform` type and `getPlatformRule` resolver

**Files:**
- Modify: `src/lib/scheduler/schedulerRules.ts`
- Test: `src/lib/scheduler/schedulerRules.test.ts` (check if it exists; extend or create)

**Interfaces:**
- Produces: `type SchedulablePlatform = string`, `getPlatformRule(platform: SchedulablePlatform): PlatformRule` — consumed by Task 6 (`schedulerEngine.ts`).

- [ ] **Step 1: Write the failing test**

Check whether `src/lib/scheduler/schedulerRules.test.ts` exists; extend it or create it:

```typescript
import { describe, it, expect } from 'vitest';
import { getPlatformRule, PLATFORM_RULES } from './schedulerRules';

describe('getPlatformRule', () => {
  it('returns the exact built-in rule for each of the 4 built-in platforms', () => {
    expect(getPlatformRule('tp')).toEqual(PLATFORM_RULES.tp);
    expect(getPlatformRule('ag')).toEqual(PLATFORM_RULES.ag);
    expect(getPlatformRule('cg')).toEqual(PLATFORM_RULES.cg);
    expect(getPlatformRule('wo')).toEqual(PLATFORM_RULES.wo);
  });

  it('returns the fixed default rule (1 post/week, no preferred days) for any other platform key', () => {
    expect(getPlatformRule('some-custom-platform-uuid')).toEqual({ postsPerWeek: 1, preferredDays: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scheduler/schedulerRules.test.ts`
Expected: FAIL — `getPlatformRule` is not exported

- [ ] **Step 3: Write the implementation**

In `src/lib/scheduler/schedulerRules.ts`, replace the import line (currently `import type { Platform } from '../removedPlatformBrands.ts';`) — keep it, since `PLATFORM_RULES` itself stays `Record<Platform, PlatformRule>` (only the NEW resolver function is widened):

```typescript
import type { Platform } from '../removedPlatformBrands.ts';

export type SchedulablePlatform = string;
```

Add, right after the existing `PLATFORM_RULES` constant (after its closing `};`):

```typescript
// The fixed scheduling rule every custom (user-defined) platform gets --
// no per-platform configuration in v1, matching Casino Guru's existing
// cadence as the least-presumptuous default. See the design spec's
// confirmed-with-user decision.
export const DEFAULT_CUSTOM_PLATFORM_RULE: PlatformRule = { postsPerWeek: 1, preferredDays: [] };

// Resolves a platform's scheduling rule for any SchedulablePlatform (a
// built-in Platform code, or a custom platform's custom_platforms.id) --
// the one place schedulerEngine.ts/schedulerService.ts look up posting
// frequency, so a custom platform gets real scheduling with zero changes
// to the engine itself.
export function getPlatformRule(platform: SchedulablePlatform): PlatformRule {
  return platform in PLATFORM_RULES ? PLATFORM_RULES[platform as Platform] : DEFAULT_CUSTOM_PLATFORM_RULE;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/scheduler/schedulerRules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/schedulerRules.ts src/lib/scheduler/schedulerRules.test.ts
git commit -m "feat: add getPlatformRule resolver with a fixed default for custom platforms"
```

---

### Task 6: `scheduleUtils.ts` — badge/label resolvers and type widening

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts`
- Test: `src/lib/scheduler/scheduleUtils.test.ts`

**Interfaces:**
- Consumes: `getCustomPlatformById` (Task 2), `SchedulablePlatform` (Task 5).
- Produces: `getPlatformBadge(platform: SchedulablePlatform): { label: string; className: string }`, `getPlatformFullLabel(platform: SchedulablePlatform): string`, `getPlatformStatusDateKeys(platform: SchedulablePlatform): { statusKeys: string[]; dateKeys: string[] }` — the first two consumed by `calendarRenderer.tsx` (Task 11) and any other current importer of `PLATFORM_BADGE`/`PLATFORM_FULL_LABEL` (grep for both names across `src/` before starting this task and update every call site found, not just the ones named here — the pre-existing imports of these two names are the reason this task exists); the third consumed by Task 9's fix to `recentStatusesFor`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scheduler/scheduleUtils.test.ts`:

```typescript
import { getPlatformBadge, getPlatformFullLabel, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from './scheduleUtils';
import { registerTabCustomPlatforms, resetTabCustomPlatforms, type CustomPlatformConfig } from '../customPlatformRegistry';

const YELP: CustomPlatformConfig = {
  id: 'p1', tab: 'BITP', name: 'Yelp', shortLabel: 'YP',
  statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
};

describe('getPlatformBadge', () => {
  it('returns the exact built-in badge for each of the 4 built-in platforms', () => {
    expect(getPlatformBadge('tp')).toEqual(PLATFORM_BADGE.tp);
    expect(getPlatformBadge('ag')).toEqual(PLATFORM_BADGE.ag);
    expect(getPlatformBadge('cg')).toEqual(PLATFORM_BADGE.cg);
    expect(getPlatformBadge('wo')).toEqual(PLATFORM_BADGE.wo);
  });

  it('returns a badge built from the custom platform\'s own shortLabel when registered', () => {
    registerTabCustomPlatforms([YELP]);
    try {
      expect(getPlatformBadge('p1')).toEqual({ label: 'YP', className: 'bg-slate-100 text-slate-700' });
    } finally {
      resetTabCustomPlatforms();
    }
  });

  it('falls back to the raw platform key when the id is unregistered', () => {
    expect(getPlatformBadge('unknown-id')).toEqual({ label: 'unknown-id', className: 'bg-slate-100 text-slate-700' });
  });
});

describe('getPlatformFullLabel', () => {
  it('returns the exact built-in label for each of the 4 built-in platforms', () => {
    expect(getPlatformFullLabel('tp')).toBe(PLATFORM_FULL_LABEL.tp);
    expect(getPlatformFullLabel('ag')).toBe(PLATFORM_FULL_LABEL.ag);
    expect(getPlatformFullLabel('cg')).toBe(PLATFORM_FULL_LABEL.cg);
    expect(getPlatformFullLabel('wo')).toBe(PLATFORM_FULL_LABEL.wo);
  });

  it('returns the custom platform\'s own name when registered', () => {
    registerTabCustomPlatforms([YELP]);
    try {
      expect(getPlatformFullLabel('p1')).toBe('Yelp');
    } finally {
      resetTabCustomPlatforms();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts -t "getPlatformBadge|getPlatformFullLabel"`
Expected: FAIL — `getPlatformBadge`/`getPlatformFullLabel` are not exported

- [ ] **Step 3: Write the implementation**

In `src/lib/scheduler/scheduleUtils.ts`, add an import for `getCustomPlatformById` alongside the existing imports (after the existing `import { normalizeBrandKey, type Platform } from '../removedPlatformBrands.ts';` line):

```typescript
import { getCustomPlatformById } from '../customPlatformRegistry.ts';
import type { SchedulablePlatform } from './schedulerRules.ts';
```

Keep `PLATFORM_BADGE`/`PLATFORM_FULL_LABEL` exactly as they are (both `Record<Platform, X>`, lines 7-22) — they stay as the built-in lookup source the new resolvers check first, and existing importers of them for a KNOWN-built-in context can keep using them directly. Add two resolver functions right after `PLATFORM_FULL_LABEL`'s closing `};` (before the `unscheduledPlatforms` function):

```typescript
// A neutral, non-platform-specific className for a custom platform's badge
// -- the 4 built-ins each have their own distinct color; a custom platform
// gets one shared neutral color rather than inventing a per-platform palette
// with no natural mapping.
const CUSTOM_PLATFORM_BADGE_CLASSNAME = 'bg-slate-100 text-slate-700';

// Resolves a platform's badge for any SchedulablePlatform -- built-in codes
// return PLATFORM_BADGE's existing value unchanged; a custom platform's id
// returns a badge built from its own shortLabel. An id with no registered
// config (e.g. a stale schedule row for a since-deleted custom platform)
// falls back to showing the raw id rather than throwing or rendering blank.
export function getPlatformBadge(platform: SchedulablePlatform): { label: string; className: string } {
  if (platform in PLATFORM_BADGE) return PLATFORM_BADGE[platform as Platform];
  const custom = getCustomPlatformById(platform);
  return { label: custom?.shortLabel ?? platform, className: CUSTOM_PLATFORM_BADGE_CLASSNAME };
}

// Resolves a platform's full display name for any SchedulablePlatform,
// mirroring getPlatformBadge above.
export function getPlatformFullLabel(platform: SchedulablePlatform): string {
  if (platform in PLATFORM_FULL_LABEL) return PLATFORM_FULL_LABEL[platform as Platform];
  const custom = getCustomPlatformById(platform);
  return custom?.name ?? platform;
}
```

Add a third resolver, right after `getPlatformFullLabel`. This is not in the spec's original list — found during planning by reading `schedulerService.ts`'s `recentStatusesFor` (the function auto-pause detection depends on), which currently does `PLATFORM_STATUS_KEYS[platform]`/`PLATFORM_DATE_KEYS[platform]` (both `Record<Platform, string[]>` from `scoreSummary.ts`, explicitly out of this plan's scope per Global Constraints) — indexing either with a custom platform's uuid returns `undefined`, silently breaking status/date reads for every custom-platform entry. This resolver is what Task 9 uses to fix that:

```typescript
import { PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS } from '../scoreSummary.ts';

// Resolves which entry.data keys carry a platform's status/date for any
// SchedulablePlatform. Built-in platforms use the existing scoreSummary.ts
// Records unchanged; a custom platform uses its own registered
// statusColumn/dateColumn (each wrapped in a single-element array, matching
// pick()'s "list of candidate keys" signature -- a custom platform has
// exactly one column name, unlike a built-in platform's multi-alias list).
export function getPlatformStatusDateKeys(platform: SchedulablePlatform): { statusKeys: string[]; dateKeys: string[] } {
  if (platform in PLATFORM_STATUS_KEYS) {
    return { statusKeys: PLATFORM_STATUS_KEYS[platform as Platform], dateKeys: PLATFORM_DATE_KEYS[platform as Platform] };
  }
  const custom = getCustomPlatformById(platform);
  return { statusKeys: custom ? [custom.statusColumn] : [], dateKeys: custom ? [custom.dateColumn] : [] };
}
```

(Check whether `scheduleUtils.ts` already imports `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS` from `'../scoreSummary.ts'` at the top of the file — per the file's existing import line `import { PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, isLiveStatus, isPendingStatus, isDoneStatus, parsePostDate, getReviewText } from '../scoreSummary.ts';` it already does, so don't add a duplicate import — this code block above is shown with the import for clarity but the names are already in scope.)

Add a test for it in `scheduleUtils.test.ts` alongside the other two resolver test blocks:

```typescript
describe('getPlatformStatusDateKeys', () => {
  it('returns the exact built-in status/date keys for each of the 4 built-in platforms', () => {
    expect(getPlatformStatusDateKeys('tp')).toEqual({ statusKeys: PLATFORM_STATUS_KEYS.tp, dateKeys: PLATFORM_DATE_KEYS.tp });
    expect(getPlatformStatusDateKeys('ag')).toEqual({ statusKeys: PLATFORM_STATUS_KEYS.ag, dateKeys: PLATFORM_DATE_KEYS.ag });
  });

  it('returns the custom platform\'s own statusColumn/dateColumn, each as a single-element array', () => {
    registerTabCustomPlatforms([YELP]);
    try {
      expect(getPlatformStatusDateKeys('p1')).toEqual({ statusKeys: ['Yelp Review Status'], dateKeys: ['Yelp Review Added'] });
    } finally {
      resetTabCustomPlatforms();
    }
  });

  it('returns empty key arrays for an unregistered platform id (pick() then finds nothing, matching the built-in "no data" behavior)', () => {
    expect(getPlatformStatusDateKeys('unknown-id')).toEqual({ statusKeys: [], dateKeys: [] });
  });
});
```

Add `getPlatformStatusDateKeys` to this task's export list in the Interfaces block above, and add a RED step for it in Step 1/Step 2 alongside the badge/label tests already specified.

Now widen every remaining `Platform`-typed declaration in this file to `SchedulablePlatform` — these are TYPE-ONLY changes (the underlying logic in each function is unchanged; only the type annotation widens from the closed union to a string). Find each occurrence by searching this file for the literal text `Platform` used as a type (not as part of an unrelated identifier like `PlatformRule`) at these locations (search for the line's distinctive surrounding text to find it, since exact line numbers may have shifted after Step 3's insertions above):

- `unscheduledPlatforms`'s 4 parameters (`platforms: Platform[]`, `pausedPlatforms: Partial<Record<Platform, unknown>>`) and return type (`Platform[]`) → `SchedulablePlatform[]`/`Partial<Record<SchedulablePlatform, unknown>>`/`SchedulablePlatform[]`, and its one internal `rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>` parameter → `Partial<Record<SchedulablePlatform, BrandScheduleRow>>`.
- `completedBrandPlatformKey(brandKey: string, platform: Platform): string` → `platform: SchedulablePlatform`.
- `const ALL_PLATFORMS = Object.keys(PLATFORM_STATUS_KEYS) as Platform[];` — **do NOT change this one.** `PLATFORM_STATUS_KEYS` (from `scoreSummary.ts`) stays `Record<Platform, ...>` in this plan's scope (it's outside the scheduler subsystem, per this plan's Global Constraints) — `ALL_PLATFORMS` genuinely IS built-in-only and should stay `Platform[]`. Confirm by reading how `ALL_PLATFORMS` is used nearby before touching it; if it turns out to feed into a scheduler function that now expects `SchedulablePlatform[]`, that call site can pass `ALL_PLATFORMS` as-is (a `Platform[]` is already assignable to `SchedulablePlatform[]` since `SchedulablePlatform = string`).
- `resolveDateEvidenceKind(index: DateStatusIndex, brandKey: string, platform: Platform, iso: string)` → `platform: SchedulablePlatform`.
- `hasDateEvidence(index: DateStatusIndex, brandKey: string, platform: Platform, iso: string)` → `platform: SchedulablePlatform`.
- The `platform: Platform` parameter around line 231 (read the function signature it belongs to before editing, to confirm you're changing the right one) → `platform: SchedulablePlatform`.
- The `platform: Platform;` field around line 415 (an interface/type field — read its containing type definition first) → `platform: SchedulablePlatform;`.
- The `platform: Platform,` parameter around line 438 → `platform: SchedulablePlatform,`.
- The `platforms: Platform[],` parameters around lines 454 and 477 → `platforms: SchedulablePlatform[],`.
- `brandPlatformsFn: (brand: string) => Platform[],` around line 623 → `(brand: string) => SchedulablePlatform[],`.
- `export function filterVisiblePlatforms(platforms: Platform[], visiblePlatforms: Platform[]): Platform[]` around line 653 → all three `Platform[]` → `SchedulablePlatform[]`.

For each of the above, read the function's full body first to confirm no other logic inside it needs to change — every one of these is a pure parameter/return-type widening with the function body untouched, since none of them pattern-match against a specific `'tp'`/`'ag'`/`'cg'`/`'wo'` literal (only `ALL_PLATFORMS` and the two Records do that, and those are handled separately above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`
Expected: PASS — the new resolver tests plus every pre-existing test in this file unmodified

- [ ] **Step 5: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors (this will surface any call site elsewhere in the codebase still expecting the old narrower `Platform[]`/`Record<Platform,...>` shapes from the functions widened above — fix each one by widening its own local type to match, following the same type-only-widening rule)

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: add platform badge/label resolvers, widen scheduleUtils to SchedulablePlatform"
```

---

### Task 7: `tabIcons.ts` — `PLATFORM_FAVICON` resolver

**Files:**
- Modify: `src/lib/tabIcons.ts`
- Test: `src/lib/tabIcons.test.ts` (check if it exists; extend or create)

**Interfaces:**
- Consumes: `SchedulablePlatform` (Task 5).
- Produces: `getPlatformFavicon(platform: SchedulablePlatform): string | undefined` — consumed by Task 11 (`calendarRenderer.tsx`) and Task 12 (UI updates), replacing any current direct `PLATFORM_FAVICON[platform]` indexing in scheduler-related UI code (grep for `PLATFORM_FAVICON` across `src/` before starting and update every call site, same as Task 6's note).

- [ ] **Step 1: Write the failing test**

```typescript
// Add to src/lib/tabIcons.test.ts (create if it doesn't exist)
import { describe, it, expect } from 'vitest';
import { getPlatformFavicon, PLATFORM_FAVICON } from './tabIcons';

describe('getPlatformFavicon', () => {
  it('returns the exact built-in favicon for each of the 4 built-in platforms', () => {
    expect(getPlatformFavicon('tp')).toBe(PLATFORM_FAVICON.tp);
    expect(getPlatformFavicon('ag')).toBe(PLATFORM_FAVICON.ag);
    expect(getPlatformFavicon('cg')).toBe(PLATFORM_FAVICON.cg);
    expect(getPlatformFavicon('wo')).toBe(PLATFORM_FAVICON.wo);
  });

  it('returns undefined for a custom platform (no favicon)', () => {
    expect(getPlatformFavicon('some-custom-platform-uuid')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tabIcons.test.ts`
Expected: FAIL — `getPlatformFavicon` is not exported

- [ ] **Step 3: Write the implementation**

In `src/lib/tabIcons.ts`, read the current `PLATFORM_FAVICON: Record<Platform, string>` declaration first to confirm its exact current shape, then add right after it:

```typescript
import type { SchedulablePlatform } from './scheduler/schedulerRules.ts';

// A custom platform has no favicon source (unlike the 4 built-ins, which
// each resolve to a real domain's Google-favicon URL) -- undefined tells
// callers to render no icon rather than a broken image, matching the
// pattern PlatformRemovedBadge/PlatformRemovedModal already established
// for custom platforms in Task 340 (favicon is an optional prop there too).
export function getPlatformFavicon(platform: SchedulablePlatform): string | undefined {
  return platform in PLATFORM_FAVICON ? PLATFORM_FAVICON[platform as Platform] : undefined;
}
```

(If `Platform` isn't already imported in this file, add `import type { Platform } from './removedPlatformBrands.ts';` alongside the new `SchedulablePlatform` import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tabIcons.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabIcons.ts src/lib/tabIcons.test.ts
git commit -m "feat: add getPlatformFavicon resolver returning undefined for custom platforms"
```

---

### Task 8: `schedulerEngine.ts` — widen to `SchedulablePlatform`, use `getPlatformRule`

**Files:**
- Modify: `src/lib/scheduler/schedulerEngine.ts`
- Test: `src/lib/scheduler/schedulerEngine.test.ts`

**Interfaces:**
- Consumes: `SchedulablePlatform`/`getPlatformRule` (Task 5).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scheduler/schedulerEngine.test.ts`, inside the existing `describe('generateWeekSchedule', () => { ... })` block, following the exact pattern its existing `'assigns CG exactly 1 post'` and `'assigns WO exactly 1 post...'` tests already use (both spread `baseInput` with a narrowed `activePlatforms`, then assert on `slotsFor(generateWeekSchedule(input), 'WinMega', <platform>)`):

```typescript
it('schedules a custom platform (unregistered in PLATFORM_RULES) using the default 1/week rule', () => {
  const input: SchedulerInput = { ...baseInput, activePlatforms: ['custom-platform-id'] };
  expect(slotsFor(generateWeekSchedule(input), 'WinMega', 'custom-platform-id')).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scheduler/schedulerEngine.test.ts -t "custom platform"`
Expected: FAIL — either a type error (before Step 3's widening) or the engine silently drops the unrecognized platform (if it currently does a `PLATFORM_RULES[platform]` lookup that returns `undefined` for an unknown key, crashing or producing 0 slots)

- [ ] **Step 3: Write the implementation**

In `src/lib/scheduler/schedulerEngine.ts`:
1. Replace the import: if the file currently imports `PLATFORM_RULES` and/or `type Platform`, change to also import `type { SchedulablePlatform } from './schedulerRules.ts';` and `getPlatformRule` (replacing any direct `PLATFORM_RULES[...]` indexing with `getPlatformRule(...)` calls).
2. Widen every `platform: Platform` field/parameter found at the interfaces/functions the earlier exploration identified (`ScheduledSlot.platform`, `PinnedCombo.platform`, `CarryoverItem.platform`, `SchedulerInput.activePlatforms: Platform[]`, `hasCombo`'s `platform: Platform` parameter, `assign`'s `platform: Platform` parameter) to `SchedulablePlatform`/`SchedulablePlatform[]` — read each declaration's surrounding context first to confirm the exact current text before editing, since this file wasn't read in full during planning.
3. Anywhere the engine currently does `PLATFORM_RULES[platform]` (or similar direct indexing) to get a platform's posting frequency/preferred days, replace with `getPlatformRule(platform)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/schedulerEngine.test.ts`
Expected: PASS — the new test plus every pre-existing test in this file (all of which use built-in platforms, so `getPlatformRule` returning the exact same `PLATFORM_RULES` value for them keeps their behavior byte-identical)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/schedulerEngine.ts src/lib/scheduler/schedulerEngine.test.ts
git commit -m "feat: widen schedulerEngine to SchedulablePlatform, use getPlatformRule"
```

---

### Task 9: `schedulerService.ts` — fix `recentStatusesFor` to read a custom platform's real columns, widen the rest

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts`
- Test: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes: `SchedulablePlatform` (Task 5), `getPlatformStatusDateKeys` (Task 6), the widened `getTabPlatforms` (Task 3).

This task fixes a real bug found during planning, not just a type-widening: `recentStatusesFor`
(below) currently does `PLATFORM_STATUS_KEYS[platform]`/`PLATFORM_DATE_KEYS[platform]` — both
`Record<Platform, string[]>` from `scoreSummary.ts` — which returns `undefined` for a custom
platform's uuid, silently breaking status/date reads and making auto-pause detection impossible for
any custom platform. `getPlatformStatusDateKeys` (Task 6) is what fixes this.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scheduler/schedulerService.test.ts`, inside the existing `describe('recalculatePauses', () => { ... })` block, following the exact pattern its existing `'pauses a brand+platform after two consecutive Removed/Refused posts'` test already uses (a `TabContext` with `brands`/`activePlatforms`/`entries` built via the file's existing `entry({...})` helper, then an assertion on `queries.upsertBrandPlatformPause`'s call args):

```typescript
it('pauses a custom platform after two consecutive Removed/Refused posts, reading its own registered status/date columns', async () => {
  registerTabCustomPlatforms([{
    id: 'custom-platform-id', tab: 'BITP', name: 'Yelp', shortLabel: 'YP',
    statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
  }]);
  try {
    const ctx: TabContext = {
      brands: ['WinMega'],
      activePlatforms: ['custom-platform-id'],
      entries: [
        entry({ Brands: 'WinMega', 'Yelp Review Status': 'removed', 'Yelp Review Added': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'Yelp Review Status': 'refused', 'Yelp Review Added': '2026-07-24' }),
        entry({ Brands: 'WinMega', 'Yelp Review Status': 'published', 'Yelp Review Added': '2026-07-01' }),
      ],
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith('BITP', 'WinMega', 'custom-platform-id', '2026-08-03', expect.any(String), undefined);
  } finally {
    resetTabCustomPlatforms();
  }
});
```

Add the needed imports at the top of the test file: `registerTabCustomPlatforms, resetTabCustomPlatforms` from `../customPlatformRegistry` (if not already imported).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts -t "custom platform"`
Expected: FAIL — `recentStatusesFor` reads via `PLATFORM_STATUS_KEYS['custom-platform-id']`, which is `undefined`, so `pick(e.data, undefined)` either throws or reads nothing, and no pause is ever recorded.

- [ ] **Step 3: Write the implementation**

Replace `recentStatusesFor` (currently at line 77-94):

```typescript
function recentStatusesFor(entries: Entry[], brandKey: string, platform: SchedulablePlatform): string[] {
  const { statusKeys, dateKeys } = getPlatformStatusDateKeys(platform);
  return entries
    .filter((e) => normalizeBrandKey(brandOf(e)) === brandKey)
    .map((e) => ({
      status: (pick(e.data, statusKeys) ?? '').trim().toLowerCase(),
      date: parsePostDate(pick(e.data, dateKeys)),
    }))
    .filter((x) => x.status !== '')
    .sort((a, b) => {
      if (a.date && b.date) return b.date.getTime() - a.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    })
    .map((x) => x.status);
}
```

Add the import: `import { getPlatformStatusDateKeys } from './scheduleUtils.ts';` (add `SchedulablePlatform` to whatever import already brings in scheduler types, or import it from `./schedulerRules.ts'` alongside). Remove the now-unused `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS` import from `scoreSummary.ts` if nothing else in this file still uses them directly (check first).

Widen this file's other `Platform`-typed spots (a `platform: Platform` field and an `activePlatforms: Platform[]` field — read each one's surrounding context first, since only `recentStatusesFor`'s signature was confirmed during planning) to `SchedulablePlatform`. Confirm `recalculatePauses`/`ensureWeekGenerated`/`buildCarryover` don't contain any OTHER `PLATFORM_STATUS_KEYS[...]`/`PLATFORM_DATE_KEYS[...]`-style direct indexing beyond what this step already fixed — if you find one, apply the same `getPlatformStatusDateKeys` fix and note it in your report, since it wasn't part of the plan's original file inventory.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/schedulerService.test.ts`
Expected: PASS — the new test plus every pre-existing test in this file (all of which use built-in platforms, so `getPlatformStatusDateKeys`'s built-in branch returning the exact same `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS` values keeps their behavior byte-identical)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
git commit -m "fix: recentStatusesFor reads a custom platform's own status/date columns"
```

---

### Task 10: `pmsSync.ts` — PMS label resolver and type widening

**Files:**
- Modify: `src/lib/scheduler/pmsSync.ts`
- Test: `src/lib/scheduler/pmsSync.test.ts`

**Interfaces:**
- Consumes: `getCustomPlatformById` (Task 2), `SchedulablePlatform` (Task 5), the widened `getTabPlatforms` (Task 3).
- Produces: `getPmsPlatformLabel(platform: SchedulablePlatform): string`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scheduler/pmsSync.test.ts`, matching its existing test style:

```typescript
import { getPmsPlatformLabel } from './pmsSync';
import { registerTabCustomPlatforms, resetTabCustomPlatforms, type CustomPlatformConfig } from '../customPlatformRegistry';

const YELP: CustomPlatformConfig = {
  id: 'p1', tab: 'BITP', name: 'Yelp', shortLabel: 'YP',
  statusColumn: 'Yelp Review Status', dateColumn: 'Yelp Review Added', maxScore: null,
};

describe('getPmsPlatformLabel', () => {
  it('returns the exact built-in PMS label for each of the 4 built-in platforms', () => {
    expect(getPmsPlatformLabel('tp')).toBe('TP');
    expect(getPmsPlatformLabel('ag')).toBe('AG');
    expect(getPmsPlatformLabel('cg')).toBe('CG');
    expect(getPmsPlatformLabel('wo')).toBe('WO');
  });

  it('returns the custom platform\'s own shortLabel when registered', () => {
    registerTabCustomPlatforms([YELP]);
    try {
      expect(getPmsPlatformLabel('p1')).toBe('YP');
    } finally {
      resetTabCustomPlatforms();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scheduler/pmsSync.test.ts -t "getPmsPlatformLabel"`
Expected: FAIL — not exported

- [ ] **Step 3: Write the implementation**

In `src/lib/scheduler/pmsSync.ts`, read the current `PMS_PLATFORM_LABEL_NAMES: Record<Platform, string> = { tp: 'TP', ag: 'AG', cg: 'CG', wo: 'WO' };` declaration (currently around line 31) and its one call site (currently around line 240, `PMS_PLATFORM_LABEL_NAMES[item.platform]`) to confirm exact current text, then:

1. Add the import: `import { getCustomPlatformById } from '../customPlatformRegistry.ts';` and `import type { SchedulablePlatform } from './schedulerRules.ts';` alongside this file's existing imports.
2. Keep `PMS_PLATFORM_LABEL_NAMES` as-is (still `Record<Platform, string>`, still private/unexported unless it already has other importers — check first).
3. Add the resolver function right after it:

```typescript
// Resolves a platform's PMS task-label text for any SchedulablePlatform,
// mirroring getPlatformBadge/getPlatformFullLabel (scheduleUtils.ts).
export function getPmsPlatformLabel(platform: SchedulablePlatform): string {
  if (platform in PMS_PLATFORM_LABEL_NAMES) return PMS_PLATFORM_LABEL_NAMES[platform as Platform];
  const custom = getCustomPlatformById(platform);
  return custom?.shortLabel ?? platform;
}
```

4. Replace the one call site (`PMS_PLATFORM_LABEL_NAMES[item.platform]`) with `getPmsPlatformLabel(item.platform)`.
5. Widen the 5 remaining `platform: Platform;`/`platform: Platform` field/parameter declarations found (at the locations the earlier exploration identified — around lines 62, 1000, 1008, 1021, 1058; read each one's surrounding interface/function context first to confirm exact current text) to `platform: SchedulablePlatform;`/`platform: SchedulablePlatform`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/pmsSync.test.ts`
Expected: PASS — the new resolver tests plus every pre-existing test unmodified

- [ ] **Step 5: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler/pmsSync.ts src/lib/scheduler/pmsSync.test.ts
git commit -m "feat: add getPmsPlatformLabel resolver, widen pmsSync to SchedulablePlatform"
```

---

### Task 11: `calendarRenderer.tsx` — use the resolver functions

**Files:**
- Modify: `src/lib/scheduler/calendarRenderer.tsx`

**Interfaces:**
- Consumes: `getPlatformBadge`/`getPlatformFullLabel` (Task 6), `getPlatformFavicon` (Task 7), `SchedulablePlatform` (Task 5).

- [ ] **Step 1: Find and replace every direct `PLATFORM_BADGE[...]`/`PLATFORM_FULL_LABEL[...]`/`PLATFORM_FAVICON[...]` indexing**

Search this file for every occurrence of `PLATFORM_BADGE[`, `PLATFORM_FULL_LABEL[`, and `PLATFORM_FAVICON[` (or their destructured/imported-then-indexed equivalents). For each one, replace the direct Record index with the equivalent resolver call: `PLATFORM_BADGE[p]` → `getPlatformBadge(p)`, `PLATFORM_FULL_LABEL[p]` → `getPlatformFullLabel(p)`, `PLATFORM_FAVICON[p]` → `getPlatformFavicon(p)` (this one can now return `undefined` — find each call site's surrounding JSX and confirm it already handles a possibly-missing favicon gracefully, e.g. `{favicon && <img src={favicon} .../>}`; if it currently assumes a favicon always exists, add that guard). Update the corresponding imports at the top of the file (remove the now-unused `PLATFORM_BADGE`/`PLATFORM_FULL_LABEL`/`PLATFORM_FAVICON` imports if nothing else in the file still uses them directly, add imports for the 3 resolver functions from their respective modules).

Also widen every `Platform`-typed prop/state in this file's component signatures (`ScheduleCell`, `PlatformChip`, and any other component taking a `platform: Platform` prop) to `SchedulablePlatform` — read each component's props interface first to find them.

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduler/calendarRenderer.tsx
git commit -m "feat: use platform resolver functions in calendarRenderer"
```

---

### Task 12: `SchedulePlanner.tsx` and `TabScheduleSection.tsx` — type widening

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`
- Modify: `src/components/TabScheduleSection.tsx`

**Interfaces:**
- Consumes: `SchedulablePlatform` (Task 5), any resolver functions these files directly reference (`getPlatformBadge`/`getPlatformFullLabel`/`getPlatformFavicon`/`getPmsPlatformLabel`).

- [ ] **Step 1: Find and widen every `Platform`-typed declaration in both files**

In each file, search for every `Platform`/`Platform[]` type usage (prop types, state types, function parameters — these pages don't hardcode a 4-item platform list per the design spec's exploration, so every occurrence should be a pure type-only widening to `SchedulablePlatform`/`SchedulablePlatform[]`). Also search for any direct `PLATFORM_BADGE[...]`/`PLATFORM_FULL_LABEL[...]`/`PLATFORM_FAVICON[...]`/`PMS_PLATFORM_LABEL_NAMES[...]` indexing (same replacement pattern as Task 11) and any `Record<Platform, ...>`-typed local state that needs widening to `Record<SchedulablePlatform, ...>` (e.g. a `Partial<Record<Platform, X>>` used to track per-platform UI state like modal selections or override state).

If either file directly imports and iterates `PLATFORM_RULES` (unlikely per the design spec's exploration, but verify) for anything beyond what `schedulerService.ts`/`schedulerEngine.ts` already resolve, replace that iteration with `getTabPlatforms(tab)` (already imported in both files) plus `getPlatformRule` per platform, so these pages never hardcode the built-in 4 either.

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: no TypeScript errors — this is the definitive check that every scheduler-adjacent `Platform`-typed spot across the whole codebase has been found and widened, since these two large page files are the last consumers.

- [ ] **Step 3: Manual verification these pages don't crash with a custom platform present**

There is no dedicated test file for either page (page-level components, verified via build per this project's established convention). Read through each file's platform-rendering logic once more after the build passes clean, confirming visually (by reading the JSX) that a `SchedulablePlatform` string with no special-casing renders through the same code path a built-in platform does — no `if (platform === 'tp' || ...)` branch that would silently exclude a custom platform's id. If you find such a branch, widen its condition to `getTabPlatforms(tab).includes(platform)` or an equivalent generic check, and note it in your report since it's a real gap the plan's original file inventory didn't anticipate.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SchedulePlanner.tsx src/components/TabScheduleSection.tsx
git commit -m "feat: widen SchedulePlanner and TabScheduleSection to SchedulablePlatform"
```

---

### Task 13: `tabRegistryBootstrap.ts` — register custom platforms as the 6th registry

**Files:**
- Modify: `src/lib/tabRegistryBootstrap.ts`
- Test: `src/lib/tabRegistryBootstrap.test.ts`

**Interfaces:**
- Consumes: `registerTabCustomPlatforms`/`resetTabCustomPlatforms` (already exist in `customPlatformRegistry.ts`, unchanged by this plan), `fetchTabCustomPlatforms(client?: SupabaseClient): Promise<CustomPlatformConfig[]>` (`src/lib/queries.ts:2267`, confirmed during planning — already exists, used today by the browser's `AuthContext` bootstrap; this task reuses it for the shared cross-invocation bootstrap, no new query function needed).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tabRegistryBootstrap.test.ts`, inside the existing `describe('bootstrapTabRegistries', () => { ... })` block. `fetchTabCustomPlatforms` (`queries.ts`) queries `tab_custom_platforms` with an embedded `custom_platforms(...)` join, returning rows shaped `{ tab, custom_platforms: { id, name, short_label, status_column, date_column, max_score } }` — the existing `fakeClient` helper (defined at the top of this test file) returns whatever rows you give it verbatim from `.select()`'s own `.then()`, with no `.eq()`/`.is()` filtering needed since the real query doesn't chain either:

```typescript
it('registers custom platforms and makes them visible via getTabPlatforms', async () => {
  const client = fakeClient({
    custom_tabs: [],
    tab_hidden_platforms: [],
    tab_archive_log: [],
    paused_tabs: [],
    hardcoded_tab_renames: [],
    tab_custom_platforms: [{
      tab: 'Rooster Partners',
      custom_platforms: {
        id: 'custom-platform-id', name: 'Yelp', short_label: 'YP',
        status_column: 'Yelp Review Status', date_column: 'Yelp Review Added', max_score: null,
      },
    }],
  });
  await bootstrapTabRegistries(client, 'test');
  expect(getTabPlatforms('Rooster Partners')).toContain('custom-platform-id');
});

it('resets custom platforms on each invocation (no stale accumulation across warm isolates)', async () => {
  const withCustom = fakeClient({
    custom_tabs: [], tab_hidden_platforms: [], tab_archive_log: [], paused_tabs: [], hardcoded_tab_renames: [],
    tab_custom_platforms: [{
      tab: 'Rooster Partners',
      custom_platforms: { id: 'custom-platform-id', name: 'Yelp', short_label: 'YP', status_column: 'Yelp Review Status', date_column: 'Yelp Review Added', max_score: null },
    }],
  });
  await bootstrapTabRegistries(withCustom, 'test');
  expect(getTabPlatforms('Rooster Partners')).toContain('custom-platform-id');

  const withoutCustom = fakeClient({
    custom_tabs: [], tab_hidden_platforms: [], tab_archive_log: [], paused_tabs: [], hardcoded_tab_renames: [],
    tab_custom_platforms: [],
  });
  await bootstrapTabRegistries(withoutCustom, 'test');
  expect(getTabPlatforms('Rooster Partners')).not.toContain('custom-platform-id');
});
```

Add `resetTabCustomPlatforms` to this file's `afterEach` cleanup block (alongside the existing `resetPausedTabs()`/`resetHiddenTabPlatforms()`/`resetHardcodedTabRenames()` calls), importing it from `./customPlatformRegistry`, so a failed assertion in one test can't leak custom-platform state into another test in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tabRegistryBootstrap.test.ts -t "custom platform"`
Expected: FAIL — `bootstrapTabRegistries` doesn't yet fetch/register custom platforms

- [ ] **Step 3: Write the implementation**

In `src/lib/tabRegistryBootstrap.ts`:
1. Add to the existing import line from `./queries.ts` (currently `import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchArchivedTabs, fetchPausedTabs, fetchHardcodedTabRenames } from './queries.ts';`): add `fetchTabCustomPlatforms` (confirm this exact name against the real `queries.ts` export from Task 340's work before using it — if the real name differs, use the real one).
2. Add to the existing import from `./customPlatformRegistry.ts` — this file doesn't currently import from it at all, so add a new import line: `import { registerTabCustomPlatforms, resetTabCustomPlatforms } from './customPlatformRegistry.ts';`
3. Add a 6th registry block inside `bootstrapTabRegistries`, following the exact fail-open pattern every other registry in this function already uses (place it after the existing `hardcodedTabRenames` block, before the function's closing `}`):

```typescript
  // Fail-open, same convention as hiddenPlatforms above: a failed fetch
  // leaves this registry empty for this tick, so getTabPlatforms(tab)
  // simply doesn't include any custom platform until the next successful
  // tick -- the scheduler still functions correctly for every built-in
  // platform in the meantime.
  const customPlatforms = await fetchTabCustomPlatforms(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch tab custom platforms:`, err);
    return [];
  });
  resetTabCustomPlatforms();
  registerTabCustomPlatforms(customPlatforms);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tabRegistryBootstrap.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabRegistryBootstrap.ts src/lib/tabRegistryBootstrap.test.ts
git commit -m "feat: register custom platforms in the shared tab registry bootstrap"
```

---

### Task 14: `generate-weekly-schedule` and `sync-schedule-pms` Edge Functions — Deno verification

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts` (only if Step 1 finds it needs a change)
- Modify: `supabase/functions/sync-schedule-pms/index.ts` (only if Step 1 finds it needs a change)

**Interfaces:**
- Consumes: `bootstrapTabRegistries` (Task 13, already called by both functions per the design spec's exploration — this task verifies, doesn't re-wire).

- [ ] **Step 1: Confirm both functions already call the shared bootstrap**

Read `supabase/functions/generate-weekly-schedule/index.ts` and `supabase/functions/sync-schedule-pms/index.ts` and confirm each calls `bootstrapTabRegistries(client, logPrefix)` once per invocation (the design spec's exploration found `generate-weekly-schedule/index.ts:147-162` already does this). If either function does NOT call it, add the call following the exact pattern the one that does already uses — but per the exploration, this is expected to be a no-op verification step, not a real code change, since Task 13 modifies the shared function both already call.

- [ ] **Step 2: `deno check` both functions**

Run: `deno check supabase/functions/generate-weekly-schedule/index.ts`
Run: `deno check supabase/functions/sync-schedule-pms/index.ts`
Expected: both clean, no type errors — this is the definitive proof that every `SchedulablePlatform`-widened type flows correctly through the Deno-side import graph (`schedulerService.ts`, `pmsSync.ts`, `tab-configs.ts`, `customPlatformRegistry.ts`, `tabRegistryBootstrap.ts` are all imported by these two functions with relative `.ts`-extensioned paths, per this project's established Deno-safety convention).

- [ ] **Step 3: Run each function's own Deno test suite if one exists**

Check for `supabase/functions/generate-weekly-schedule/index_test.ts` and `supabase/functions/sync-schedule-pms/index_test.ts` (both referenced elsewhere in this project's history). If they exist:

Run: `deno test --allow-env --allow-net supabase/functions/generate-weekly-schedule/index_test.ts`
Run: `deno test --allow-env --allow-net supabase/functions/sync-schedule-pms/index_test.ts`
Expected: both pass unmodified (this task doesn't change either function's own logic, only verifies the shared modules they import still type-check and behave correctly under Deno).

- [ ] **Step 4: Commit (only if Step 1 found a real change was needed)**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts supabase/functions/sync-schedule-pms/index.ts
git commit -m "fix: ensure Edge Functions bootstrap custom platform registry"
```

If Step 1 found no change was needed, skip this commit and note "no change needed, verified clean" in your report instead.

---

### Task 15: Full verification and deployment

**Files:** none (verification and deployment only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: every test passes, including all tests added in Tasks 2, 3, 5, 6, 7, 8, 9, 10, 13, and every pre-existing test unmodified.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: clean build, zero TypeScript errors.

- [ ] **Step 3: Deno checks**

Run: `deno check supabase/functions/generate-weekly-schedule/index.ts`
Run: `deno check supabase/functions/sync-schedule-pms/index.ts`
Expected: both clean.

- [ ] **Step 4: Self-review the diff against the spec**

Read through the full branch diff and confirm every item in the spec's Architecture section has a corresponding change: the 9-table migration, the resolver-injection chain (`customPlatformRegistry.ts` → `tab-configs.ts` → `getTabPlatforms`), the 5 resolver functions (`getPlatformRule`, `getPlatformBadge`/`getPlatformFullLabel`, `getPlatformFavicon`, `getPmsPlatformLabel`, `getPlatformStatusDateKeys`), the `recentStatusesFor` fix (Task 9 — this is the one that makes auto-pause detection actually work, not just type-check), the bootstrap registration, and that every UI/engine file's `Platform`-typed declarations were actually found and widened (re-grep for `: Platform\b` and `Platform\[\]` across `src/lib/scheduler/`, `src/lib/tab-configs.ts`, `src/lib/tabIcons.ts`, `src/pages/SchedulePlanner.tsx`, `src/components/TabScheduleSection.tsx` — any remaining hit outside a deliberately-preserved built-in-only spot is a gap to close before calling this done). Two spots are deliberately NOT widened, per the spec's Non-goals — confirm neither accidentally got touched: `ALL_PLATFORMS` in `scheduleUtils.ts` (Task 6), and `buildDateStatusIndex`'s sibling function (the Confirmed/Removed real-entry-evidence overlay) — both stay built-in-platforms-only.

- [ ] **Step 5: Deploy**

```bash
git push origin main
```

Then apply the migration:

```bash
supabase db push
```

Confirm via `supabase migration list` that `20260911140000_widen_schedule_platform_columns` shows as applied on both Local and Remote. **Check the migration timestamp for a collision with anything merged into `main` since this plan was written** (this exact problem happened during Task 340's deploy) before pushing — if a collision exists, rename this migration file to a later, non-colliding timestamp first.

Redeploy both Edge Functions (their bundled `schedulerService.ts`/`pmsSync.ts`/`tab-configs.ts`/`customPlatformRegistry.ts`/`tabRegistryBootstrap.ts` imports now carry the widened types and the new bootstrap registration):

```bash
supabase functions deploy generate-weekly-schedule
supabase functions deploy sync-schedule-pms
```

Confirm both show `ACTIVE` with a new version number via `supabase functions list`.

- [ ] **Step 6: Live verification**

Enable a custom platform on a real tab (or a disposable test tab), open its Schedule Planner section, and confirm: the custom platform's chip appears on the grid for the current week with real scheduled days (not zero); a manually-cycled day for it round-trips through save/reload; if a PMS project is configured for that tab, confirm a task was created for the custom platform's slot with a title using its `shortLabel` (via `getPmsPlatformLabel`). Clean up any test data created during this check.

- [ ] **Step 7: Document in CLAUDE.md**

Add a "Recent Changes" entry under Dynamic State, describing this feature (Schedule Planner now supports custom platforms — real scheduling with a fixed 1/week default rule, auto-pause, and PMS sync, via a `SchedulablePlatform` type generalization at the `getTabPlatforms` chokepoint rather than duplicating the scheduling engine; second of the three Custom Platforms parity sub-projects, following Task 340's removed-flag; Ask AI integration remains the last deferred gap). Update the stale Known Issues bullet from Task 340 (currently states "Custom Platforms... still never appears on the Schedule Planner calendar grid") to reflect this is now resolved. Add a matching `docs/task-history.md` entry with a `## Task 341: <Title>` heading (confirm the real next task number against the current tip of `docs/task-history.md` before writing it — it may have moved since this plan was written) and a divider before it, matching this project's established PMS-sync-safe formatting (a missing heading or missing `---` divider silently drops a task from PMS sync, per this project's own documented history).

```bash
git add CLAUDE.md docs/task-history.md
git commit -m "docs: record Schedule Planner custom platform support in CLAUDE.md and task-history.md"
git push origin main
```
