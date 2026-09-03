# Edit Brand Tab — Paused Brands Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Paused brands" section to the Edit Brand Tab modal that pauses/resumes one brand on one platform (reason + optional resume date), reusing the existing `brand_platform_override` mechanism and the existing `PlatformPauseModal`.

**Architecture:** A new pure helper (`src/lib/tabPausedBrands.ts`) shapes `brand_platform_override` rows into display rows, filtered by the same hidden/restricted/removed exclusions Schedule Planner uses (`resolveBrandPlatforms`). A new component (`src/components/TabPausedBrandsSection.tsx`) fetches overrides + exclusion sets, renders the list, and opens `PlatformPauseModal` for adds/edits. It writes straight to `brand_platform_override` via existing query functions and never touches the `brand_platform_pause` weekly cache (that keeps being rebuilt by `recalculatePauses` on Schedule Planner visits / crons). It is mounted in `EditBrandTabModal` and is independent of that modal's Save Changes batch.

**Tech Stack:** Vite 6 · React 19 · TypeScript (strict) · Tailwind v4 · Vitest · Supabase JS

**Spec:** `docs/superpowers/specs/2026-09-03-edit-brand-tab-paused-brands-section-design.md`

## Global Constraints

- TypeScript strict mode. No `any` unless commented why.
- No schema change, no migration, no Edge Function change, no `supabase/functions/ai-assistant/tools.ts` edit. `get_paused_combos` already reads `brand_platform_override`; this adds only a new writer.
- `brand_platform_override` is the single source of truth; do **not** write `brand_platform_pause` from this feature.
- Resume date floor is exactly `toISODate(addDays(mondayOf(new Date()), 7))` (next Monday after the current week's Sunday — `resume_at` expiry is week-granular).
- Exclusions (hidden brands, platform restrictions, flagged-removed combos) must go through the existing `resolveBrandPlatforms` (`src/lib/scheduleBrandConfig.ts`) — no re-derived copies.
- The new section is available to any approved user, not admin-only (matches the Schedule Planner "Pause brand" flow).
- Verification for the two non-pure tasks (2, 3) is `npm run build` + the full Vitest suite + a manual checklist — this project has no component/modal test infra and verifies `EditBrandTabModal`/`BrandGroup` changes by build, per its own established pattern.
- `npx tsc --noEmit` checks nothing here (root tsconfig is references-only) — always use `npm run build`.
- Deploy is frontend only: `git push origin main` → Vercel.

---

### Task 1: `deriveTabPausedBrandRows` pure helper

**Files:**
- Create: `src/lib/tabPausedBrands.ts`
- Test: `src/lib/tabPausedBrands.test.ts`

**Interfaces:**
- Consumes: `Platform` from `src/lib/removedPlatformBrands.ts`.
- Produces:
  ```ts
  export interface TabPausedBrandRow {
    brand: string;
    brandKey: string;
    platform: Platform;
    reason: string;          // '' when the override row's reason is null
    resumeAt: string | null; // null = permanent
    setBy: string | null;
  }

  export function deriveTabPausedBrandRows(
    overrides: {
      brand_key: string;
      platform: Platform;
      override_state: 'pause' | 'active';
      reason: string | null;
      resume_at: string | null;
      set_by: string | null;
    }[],
    brandByKey: Map<string, string>,
    eligible: (brandKey: string, platform: Platform) => boolean,
  ): TabPausedBrandRow[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tabPausedBrands.test.ts
import { describe, it, expect } from 'vitest';
import { deriveTabPausedBrandRows } from './tabPausedBrands';

const brandByKey = new Map([
  ['winmega', 'WinMega'],
  ['pribet.com', 'Pribet.com'],
  ['spinjo', 'Spinjo'],
]);
const allEligible = () => true;

describe('deriveTabPausedBrandRows', () => {
  it('keeps only override_state === "pause" rows', () => {
    const rows = deriveTabPausedBrandRows(
      [
        { brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'Break', resume_at: '2026-10-05', set_by: 'leo@x.com' },
        { brand_key: 'pribet.com', platform: 'ag', override_state: 'active', reason: null, resume_at: null, set_by: null },
      ],
      brandByKey,
      allEligible,
    );
    expect(rows).toEqual([
      { brand: 'WinMega', brandKey: 'winmega', platform: 'tp', reason: 'Break', resumeAt: '2026-10-05', setBy: 'leo@x.com' },
    ]);
  });

  it('drops combos the eligible predicate rejects', () => {
    const rows = deriveTabPausedBrandRows(
      [
        { brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'a', resume_at: null, set_by: null },
        { brand_key: 'winmega', platform: 'ag', override_state: 'pause', reason: 'b', resume_at: null, set_by: null },
      ],
      brandByKey,
      (_bk, p) => p === 'tp',
    );
    expect(rows.map((r) => r.platform)).toEqual(['tp']);
  });

  it('maps null reason to "" and absent resume_at to null (permanent)', () => {
    const [row] = deriveTabPausedBrandRows(
      [{ brand_key: 'spinjo', platform: 'cg', override_state: 'pause', reason: null, resume_at: null, set_by: null }],
      brandByKey,
      allEligible,
    );
    expect(row.reason).toBe('');
    expect(row.resumeAt).toBeNull();
  });

  it('falls back to brand_key when the display name is unknown', () => {
    const [row] = deriveTabPausedBrandRows(
      [{ brand_key: 'ghostbrand', platform: 'tp', override_state: 'pause', reason: 'x', resume_at: null, set_by: null }],
      brandByKey,
      allEligible,
    );
    expect(row.brand).toBe('ghostbrand');
  });

  it('sorts by brand then platform for stable display', () => {
    const rows = deriveTabPausedBrandRows(
      [
        { brand_key: 'spinjo', platform: 'tp', override_state: 'pause', reason: 'x', resume_at: null, set_by: null },
        { brand_key: 'winmega', platform: 'ag', override_state: 'pause', reason: 'x', resume_at: null, set_by: null },
        { brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'x', resume_at: null, set_by: null },
      ],
      brandByKey,
      allEligible,
    );
    expect(rows.map((r) => `${r.brand}/${r.platform}`)).toEqual([
      'Spinjo/tp', 'WinMega/ag', 'WinMega/tp',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tabPausedBrands.test.ts`
Expected: FAIL — `Failed to resolve import "./tabPausedBrands"` / `deriveTabPausedBrandRows is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tabPausedBrands.ts
import type { Platform } from './removedPlatformBrands';

export interface TabPausedBrandRow {
  brand: string;
  brandKey: string;
  platform: Platform;
  reason: string;
  resumeAt: string | null;
  setBy: string | null;
}

// Shapes brand_platform_override rows (override_state === 'pause' only) into
// display rows for the Edit Brand Tab "Paused brands" section. `eligible` is
// the caller's hidden/restricted/removed exclusion check (resolveBrandPlatforms
// in practice) so this list can't drift from the Schedule Planner grid or
// Ask AI's get_paused_combos. Auto-detected pauses have no override row and
// therefore never appear here.
export function deriveTabPausedBrandRows(
  overrides: {
    brand_key: string;
    platform: Platform;
    override_state: 'pause' | 'active';
    reason: string | null;
    resume_at: string | null;
    set_by: string | null;
  }[],
  brandByKey: Map<string, string>,
  eligible: (brandKey: string, platform: Platform) => boolean,
): TabPausedBrandRow[] {
  return overrides
    .filter((o) => o.override_state === 'pause')
    .filter((o) => eligible(o.brand_key, o.platform))
    .map((o) => ({
      brand: brandByKey.get(o.brand_key) ?? o.brand_key,
      brandKey: o.brand_key,
      platform: o.platform,
      reason: o.reason ?? '',
      resumeAt: o.resume_at ?? null,
      setBy: o.set_by ?? null,
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.platform.localeCompare(b.platform));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tabPausedBrands.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabPausedBrands.ts src/lib/tabPausedBrands.test.ts
git commit -m "feat: deriveTabPausedBrandRows helper for Edit Brand Tab pause section"
```

---

### Task 2: `PlatformPauseModal` overlay z-index prop

**Files:**
- Modify: `src/components/PlatformPauseModal.tsx` (Props interface ~line 7-27; component signature ~line 35; overlay div ~line 70)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PlatformPauseModal` accepts an optional `overlayZClass?: string` prop (default `'z-40'`). Existing call sites (`src/components/TabScheduleSection.tsx`) pass nothing and are unaffected.

**Why:** `PlatformPauseModal`'s overlay is `z-40`; `EditBrandTabModal`'s is `z-50`. Opened from inside Edit Brand Tab it must sit above, so Task 3 passes `overlayZClass="z-[60]"`.

- [ ] **Step 1: Add the prop to the interface**

In `src/components/PlatformPauseModal.tsx`, inside `interface Props`, add after `minResumeAt: string;`:

```ts
  // Tailwind z-index class for the full-screen overlay. Default keeps every
  // Schedule Planner call site (z-40) byte-identical; Edit Brand Tab opens
  // this from inside its own z-50 modal and passes z-[60].
  overlayZClass?: string;
```

- [ ] **Step 2: Default it in the component signature**

Change the destructuring in the `export default function PlatformPauseModal({ ... }: Props)` line to include `overlayZClass = 'z-40'`:

```ts
export default function PlatformPauseModal({ brand, platforms, initialCheckedPlatforms, autoPauseReasonByPlatform, initialReason, initialResumeAt, minResumeAt, overlayZClass = 'z-40', busy, onSave, onClose }: Props) {
```

- [ ] **Step 3: Apply the class to the overlay**

Change the outer overlay `<div>` (currently `className="fixed inset-0 z-40 flex items-center justify-center p-4"`) to:

```tsx
    <div className={`fixed inset-0 ${overlayZClass} flex items-center justify-center p-4`}>
```

- [ ] **Step 4: Verify existing call sites still typecheck and build**

Run: `npm run build`
Expected: build succeeds. Confirm `TabScheduleSection.tsx` does NOT pass `overlayZClass`:

Run: `grep -n "overlayZClass" src/components/TabScheduleSection.tsx`
Expected: no output (Schedule Planner keeps the `z-40` default).

- [ ] **Step 5: Commit**

```bash
git add src/components/PlatformPauseModal.tsx
git commit -m "feat: optional overlayZClass prop on PlatformPauseModal"
```

---

### Task 3: `TabPausedBrandsSection` component + Edit Brand Tab / Brand Group wiring

**Files:**
- Create: `src/components/TabPausedBrandsSection.tsx`
- Modify: `src/components/EditBrandTabModal.tsx` (Props interface line 23-27; add `pauseChildOpen` state; Escape effect line 98-104; render the section after the `isAdmin && (...)` Status block, before the Toolbar Filters `<div>`)
- Modify: `src/pages/BrandGroup.tsx` (the `<EditBrandTabModal ... />` render, ~line 2020 — add `brands={uniqueBrands}`)

**Interfaces:**
- Consumes:
  - `deriveTabPausedBrandRows`, `TabPausedBrandRow` from `src/lib/tabPausedBrands.ts` (Task 1).
  - `PlatformPauseModal` with `overlayZClass` prop (Task 2).
  - Existing, unchanged: `fetchBrandPlatformOverrides`, `setBrandPlatformOverride`, `clearBrandPlatformOverride`, `fetchRemovedPlatformBrands`, `fetchScheduleHiddenBrands`, `fetchScheduleRestrictedBrands`, `type BrandPlatformOverride` (`src/lib/queries.ts`); `normalizeBrandKey`, `buildRemovedPlatformBrandSet`, `PLATFORM_FAVICON`, `type Platform` (`src/lib/removedPlatformBrands.ts`); `buildHiddenBrandSet`, `buildPlatformRestrictionMap`, `resolveBrandPlatforms` (`src/lib/scheduleBrandConfig.ts`); `overrideKey`, `buildOverrideMap` (`src/lib/scheduleOverrides.ts`); `PLATFORM_FULL_LABEL` (`src/lib/scheduler/scheduleUtils.ts`); `getTabPlatforms` (`src/lib/tab-configs.ts`); `mondayOf`, `addDays`, `toISODate` (`src/lib/scheduleBrands.ts`).
- Produces:
  ```ts
  interface Props {
    tabName: string;
    brands: string[];
    onChildModalOpenChange: (open: boolean) => void;
  }
  export default function TabPausedBrandsSection(props: Props): JSX.Element
  ```
  `EditBrandTabModal`'s `Props` gains `brands: string[]`.

- [ ] **Step 1: Create the component**

Create `src/components/TabPausedBrandsSection.tsx` with exactly this content:

```tsx
// src/components/TabPausedBrandsSection.tsx
//
// "Paused brands" section inside EditBrandTabModal — a second entry point to
// the per-brand+platform pause that already exists in the Schedule Planner
// (brand_platform_override, spec 2026-09-02-brand-platform-pause-reason).
// Writes straight to brand_platform_override; never touches the
// brand_platform_pause weekly cache (recalculatePauses rebuilds that on the
// next Schedule Planner visit / cron). Not part of EditBrandTabModal's
// "Save Changes" batch — each pause/resume writes immediately, exactly like
// the Schedule Planner flow.
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PlatformPauseModal from './PlatformPauseModal';
import {
  fetchBrandPlatformOverrides,
  fetchRemovedPlatformBrands,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  setBrandPlatformOverride,
  clearBrandPlatformOverride,
  type BrandPlatformOverride,
} from '../lib/queries';
import {
  normalizeBrandKey,
  buildRemovedPlatformBrandSet,
  PLATFORM_FAVICON,
  type Platform,
} from '../lib/removedPlatformBrands';
import {
  buildHiddenBrandSet,
  buildPlatformRestrictionMap,
  resolveBrandPlatforms,
} from '../lib/scheduleBrandConfig';
import { overrideKey, buildOverrideMap } from '../lib/scheduleOverrides';
import { PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
import { getTabPlatforms } from '../lib/tab-configs';
import { mondayOf, addDays, toISODate } from '../lib/scheduleBrands';
import { deriveTabPausedBrandRows } from '../lib/tabPausedBrands';

interface Props {
  tabName: string;
  brands: string[];
  onChildModalOpenChange: (open: boolean) => void;
}

export default function TabPausedBrandsSection({ tabName, brands, onChildModalOpenChange }: Props) {
  const [overrides, setOverrides] = useState<BrandPlatformOverride[]>([]);
  const [removedSet, setRemovedSet] = useState<Set<string>>(() => new Set());
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(() => new Set());
  const [restrictionMap, setRestrictionMap] = useState<Map<string, Platform>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingBrand, setAddingBrand] = useState('');
  const [pickerBrand, setPickerBrand] = useState<string | null>(null);

  const tabPlatforms = useMemo(() => getTabPlatforms(tabName) as Platform[], [tabName]);
  const brandByKey = useMemo(
    () => new Map(brands.map((b) => [normalizeBrandKey(b), b])),
    [brands],
  );
  const overrideMap = useMemo(() => buildOverrideMap(overrides), [overrides]);

  useEffect(() => {
    onChildModalOpenChange(pickerBrand !== null);
  }, [pickerBrand, onChildModalOpenChange]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      const [ov, removed, hidden, restricted] = await Promise.all([
        fetchBrandPlatformOverrides(tabName).catch(() => [] as BrandPlatformOverride[]),
        fetchRemovedPlatformBrands().catch(() => []),
        fetchScheduleHiddenBrands(tabName).catch(() => []),
        fetchScheduleRestrictedBrands(tabName).catch(() => []),
      ]);
      if (canceled) return;
      setOverrides(ov);
      setRemovedSet(buildRemovedPlatformBrandSet(removed));
      setHiddenSet(buildHiddenBrandSet(hidden));
      setRestrictionMap(buildPlatformRestrictionMap(restricted));
      setLoading(false);
    })();
    return () => { canceled = true; };
  }, [tabName]);

  const eligibleFor = (brand: string): Platform[] =>
    resolveBrandPlatforms(tabName, brand, tabPlatforms, hiddenSet, restrictionMap, removedSet);

  const rows = useMemo(
    () =>
      deriveTabPausedBrandRows(overrides, brandByKey, (bk, p) =>
        eligibleFor(brandByKey.get(bk) ?? bk).includes(p),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overrides, brandByKey, hiddenSet, restrictionMap, removedSet, tabPlatforms],
  );

  const pauseableBrands = useMemo(
    () => brands.filter((b) => eligibleFor(b).length > 0).sort((a, b) => a.localeCompare(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brands, hiddenSet, restrictionMap, removedSet, tabPlatforms],
  );

  async function refresh() {
    setOverrides(await fetchBrandPlatformOverrides(tabName));
  }

  async function handleResume(brandKey: string, platform: Platform) {
    setBusy(true);
    setError(null);
    try {
      await clearBrandPlatformOverride(tabName, brandKey, platform);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume');
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePause(
    brand: string,
    checkedPlatforms: Platform[],
    reason: string,
    resumeAt: string | null,
  ) {
    const brandKey = normalizeBrandKey(brand);
    const nowChecked = new Set(checkedPlatforms);
    setBusy(true);
    setError(null);
    try {
      for (const platform of eligibleFor(brand)) {
        const existing = overrideMap.get(overrideKey(tabName, brandKey, platform));
        const wasPaused = existing?.state === 'pause';
        if (nowChecked.has(platform)) {
          const unchanged = wasPaused && existing.reason === reason && existing.resumeAt === resumeAt;
          if (!unchanged) {
            await setBrandPlatformOverride(tabName, brand, platform, 'pause', { reason, resumeAt });
          }
        } else if (wasPaused) {
          await clearBrandPlatformOverride(tabName, brandKey, platform);
        }
      }
      await refresh();
      setPickerBrand(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update pause');
    } finally {
      setBusy(false);
    }
  }

  function pauseModalInitial(brand: string): {
    checkedPlatforms: Platform[];
    initialReason: string;
    initialResumeAt: string | null;
  } {
    const brandKey = normalizeBrandKey(brand);
    const checkedPlatforms: Platform[] = [];
    let initialReason = '';
    let initialResumeAt: string | null = null;
    for (const platform of eligibleFor(brand)) {
      const ov = overrideMap.get(overrideKey(tabName, brandKey, platform));
      if (ov?.state === 'pause') {
        checkedPlatforms.push(platform);
        if (!initialReason && ov.reason) {
          initialReason = ov.reason;
          initialResumeAt = ov.resumeAt;
        }
      }
    }
    return { checkedPlatforms, initialReason, initialResumeAt };
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">Paused brands</label>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-400">No brands paused on this tab.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((r) => (
            <li key={`${r.brandKey}::${r.platform}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium text-slate-800">
                  <img
                    src={PLATFORM_FAVICON[r.platform]}
                    alt={r.platform}
                    className="size-3.5 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="truncate">{r.brand}</span>
                  <span className="text-slate-400">— {PLATFORM_FULL_LABEL[r.platform]}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {r.reason || 'No reason given'}
                  {r.resumeAt ? <> — resumes {r.resumeAt}</> : <> — permanent</>}
                  {r.setBy && <> — set by {r.setBy}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleResume(r.brandKey, r.platform)}
                disabled={busy}
                className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Resume
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && pauseableBrands.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={addingBrand}
            onChange={(e) => setAddingBrand(e.target.value)}
            className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          >
            <option value="">— select a brand to pause —</option>
            {pauseableBrands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!addingBrand}
            onClick={() => { setPickerBrand(addingBrand); setAddingBrand(''); }}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Pause…
          </button>
        </div>
      )}

      <p className="mt-1 text-xs text-slate-400">
        A durable pause for one brand on one platform, with an optional resume date — the same pause the Schedule Planner shows. Auto-detected pauses from underperformance are managed there, not here.
      </p>

      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}

      {pickerBrand && (() => {
        const init = pauseModalInitial(pickerBrand);
        return (
          <PlatformPauseModal
            brand={pickerBrand}
            platforms={eligibleFor(pickerBrand)}
            initialCheckedPlatforms={init.checkedPlatforms}
            autoPauseReasonByPlatform={{}}
            initialReason={init.initialReason}
            initialResumeAt={init.initialResumeAt}
            minResumeAt={toISODate(addDays(mondayOf(new Date()), 7))}
            overlayZClass="z-[60]"
            busy={busy}
            onSave={(checked, reason, resumeAt) => handleSavePause(pickerBrand, checked, reason, resumeAt)}
            onClose={() => setPickerBrand(null)}
          />
        );
      })()}
    </div>
  );
}
```

- [ ] **Step 2: Verify the component typechecks**

Run: `npm run build`
Expected: build succeeds (component is not yet mounted, but must compile).

- [ ] **Step 3: Add the `brands` prop to `EditBrandTabModal`**

In `src/components/EditBrandTabModal.tsx`:

Change the `Props` interface from:

```ts
interface Props {
  tabName: string;
  onUpdated: (renamedTo?: string) => void;
  onClose: () => void;
}
```

to:

```ts
interface Props {
  tabName: string;
  // Distinct brand display strings for this tab (BrandGroup's uniqueBrands),
  // passed straight through to TabPausedBrandsSection so it needs no fetch.
  brands: string[];
  onUpdated: (renamedTo?: string) => void;
  onClose: () => void;
}
```

Change the component signature from `export default function EditBrandTabModal({ tabName, onUpdated, onClose }: Props) {` to:

```ts
export default function EditBrandTabModal({ tabName, brands, onUpdated, onClose }: Props) {
```

- [ ] **Step 4: Add Escape suppression state and the import**

In `src/components/EditBrandTabModal.tsx`, add to the imports:

```ts
import TabPausedBrandsSection from './TabPausedBrandsSection';
```

Add a state hook alongside the others (e.g. right after `const [error, setError] = useState<string | null>(null);`):

```ts
  // True while TabPausedBrandsSection's PlatformPauseModal child is open — the
  // outer modal must not close on Escape then (PlatformPauseModal has its own
  // Escape-to-close).
  const [pauseChildOpen, setPauseChildOpen] = useState(false);
```

Change the Escape effect's condition from:

```ts
      if (e.key === 'Escape' && !submitting) onClose();
```

to:

```ts
      if (e.key === 'Escape' && !submitting && !pauseChildOpen) onClose();
```

and add `pauseChildOpen` to that effect's dependency array (`}, [onClose, submitting, pauseChildOpen]);`).

- [ ] **Step 5: Render the section**

In `src/components/EditBrandTabModal.tsx`, immediately after the closing `)}` of the `{isAdmin && ( ... )}` Status block and before the `<div>` that begins the Toolbar Filters section (`<label ...>Toolbar Filters</label>`), insert:

```tsx
          <TabPausedBrandsSection
            tabName={tabName}
            brands={brands}
            onChildModalOpenChange={setPauseChildOpen}
          />
```

- [ ] **Step 6: Pass `brands` from `BrandGroup.tsx`**

In `src/pages/BrandGroup.tsx`, in the `<EditBrandTabModal ... />` render (~line 2020), add the prop:

```tsx
        <EditBrandTabModal
          tabName={decodedTab}
          brands={uniqueBrands}
          onClose={() => setShowEditPlatformsModal(false)}
          onUpdated={(renamedTo) => {
```

- [ ] **Step 7: Build and run the full suite**

Run: `npm run build`
Expected: succeeds, no type errors.

Run: `npx vitest run`
Expected: full suite passes (only Task 1's new file adds tests; nothing else should change count/results). Note: a pre-existing flaky 5s timeout in `queries.publicHolidays.test.ts` is known to this project and passes in isolation — re-run that file alone if it's the only failure.

- [ ] **Step 8: Manual review checklist (read the diff, confirm each)**

- `TabPausedBrandsSection` is rendered outside the `isAdmin && (...)` block (available to any approved user).
- No call path writes `brand_platform_pause` or calls `recalculatePauses` / `deleteBrandPlatformPause`.
- `resolveBrandPlatforms` is the only exclusion path; no hand-rolled hidden/removed/restriction filtering.
- `minResumeAt` expression is exactly `toISODate(addDays(mondayOf(new Date()), 7))`.
- `PlatformPauseModal` is passed `overlayZClass="z-[60]"`.
- Every `fetch*` in the mount effect has a `.catch(() => [])` (fail-open).
- `BrandGroup.tsx` passes `brands={uniqueBrands}`; no other `EditBrandTabModal` call site exists (`grep -rn "EditBrandTabModal" src` — only the import + this one render).

- [ ] **Step 9: Commit**

```bash
git add src/components/TabPausedBrandsSection.tsx src/components/EditBrandTabModal.tsx src/pages/BrandGroup.tsx
git commit -m "feat: Paused brands section in the Edit Brand Tab modal"
```

---

### Task 4: Verification and documentation

**Files:**
- Modify: `CLAUDE.md` (Dynamic State → Recent Changes: prepend an entry; Known Issues: add the materialization-lag note)
- Modify: `docs/task-history.md` (append a new `## Task N: ...` heading + entry — the literal heading is required or the PMS sync silently skips it)

**Interfaces:** none (documentation + final verification only).

- [ ] **Step 1: Full build + suite one more time from a clean state**

Run: `npm run build && npx vitest run`
Expected: build clean; suite green (modulo the known `queries.publicHolidays.test.ts` flake).

- [ ] **Step 2: Live browser check (if Supabase credentials are available this session)**

`.env` may hold `CAPTURE_EMAIL` / `CAPTURE_PASSWORD` — check first. With `npm run dev` running, log in, open a multi-platform tab (e.g. Revolution Casino), click the pencil (Edit Brand Tab), and:
1. In "Paused brands", pick a brand, click "Pause…", check one platform, choose "Until a date", pick a date ≥ next Monday-after-this-week's-Sunday, enter a reason, Save.
2. Confirm the row appears in the section with the reason + "resumes {date}".
3. Close and reopen the modal — the row persists.
4. Open the Schedule Planner for that tab; confirm the same brand+platform shows paused there (after the page's own `recalculatePauses` runs on load) with the same reason.
5. Back in Edit Brand Tab, click "Resume" on the row; confirm it disappears and the Schedule Planner clears it on next load.
6. Confirm the picker never lists a brand whose only platforms are flagged-removed/hidden/restricted.

If no credentials: note the live check as deferred in the task-history entry, consistent with this project's norm.

- [ ] **Step 3: Prepend the CLAUDE.md Recent Changes entry**

Add as the newest bullet under `### Recent Changes` (adjust the Task number to the next in `docs/task-history.md`):

```markdown
- *2026-09-03 (newest):* The Edit Brand Tab modal (pencil icon on a Brand Tab) gained a
  "Paused brands" section — a second entry point to the per-brand+platform pause that already
  existed only in the Schedule Planner (`brand_platform_override`, reason + optional resume
  date, Task 311). It lists every override-driven pause on the tab (brand — platform — reason —
  resumes/permanent — set by) with a Resume button, and a brand picker that opens the existing
  `PlatformPauseModal` unchanged. New pure `deriveTabPausedBrandRows`
  (`src/lib/tabPausedBrands.ts`, unit-tested) shapes the rows, filtered through the same
  `resolveBrandPlatforms` hidden/restricted/flagged-removed exclusion the Schedule Planner grid
  and Ask AI's `get_paused_combos` use, so it can't drift. New `src/components/TabPausedBrandsSection.tsx`
  is mounted in `EditBrandTabModal` (new `brands` prop, fed by `BrandGroup`'s `uniqueBrands`),
  outside the admin-only block — available to any approved user, matching the Schedule Planner
  flow. Writes go straight to `brand_platform_override` via the existing query functions and are
  independent of the modal's "Save Changes" batch; the section never touches the
  `brand_platform_pause` weekly cache (that keeps being rebuilt by `recalculatePauses` on any
  Schedule Planner visit / the Monday + daily crons). `PlatformPauseModal` got one additive
  `overlayZClass` prop (default `z-40` unchanged; `z-[60]` here so it sits above the z-50 Edit
  Brand Tab modal), and `EditBrandTabModal` suppresses its own Escape-to-close while that child
  is open. No schema, migration, or Edge Function change — `get_paused_combos` already reads
  `brand_platform_override`; this only adds a writer. Full suite + build pass. Deploy: frontend
  only (`git push origin main`). Spec:
  `docs/superpowers/specs/2026-09-03-edit-brand-tab-paused-brands-section-design.md`. Plan:
  `docs/superpowers/plans/2026-09-03-edit-brand-tab-paused-brands-section.md`. Task N.
```

- [ ] **Step 4: Add the CLAUDE.md Known Issues note**

Add under `### Known Issues / Backlog`:

```markdown
- **Edit Brand Tab's "Paused brands" section and the Schedule Planner's own Paused Brands list
  can briefly disagree (2026-09-03, Task N) — accepted, self-healing.** The Edit Brand Tab
  section reads `brand_platform_override` directly, so a pause added there shows instantly; the
  Schedule Planner's list is derived from the materialized `brand_platform_pause` weekly cache,
  which only updates on that tab's next `recalculatePauses` run (a Schedule Planner visit, the
  Monday `generate-weekly-schedule` cron, or the daily `auditAllStatuses` cron). Until then the
  pause is still fully in effect (every reader consults the override first) — only the Schedule
  Planner's summary list lags. Same class of lag already documented for Ask AI's
  `get_paused_combos`. The Edit Brand Tab section also shows only override-driven pauses, never
  auto-detected ones (those have no override row) — auto-pauses stay Schedule-Planner-only by
  design.
```

- [ ] **Step 5: Append the task-history.md entry**

Append to `docs/task-history.md` (keep the `---` divider before it and the literal `## Task N:` heading — the PMS sync script skips entries missing either):

```markdown
---

## Task N: Paused brands section in the Edit Brand Tab modal

**Date:** 2026-09-03

Surfaced the existing per-brand+platform pause (`brand_platform_override`, reason + optional
resume date, Task 311) in the Edit Brand Tab modal, so an operator can pause one brand on one
platform without navigating to the Schedule Planner and finding its row. New "Paused brands"
section: a list of every override-driven pause on the tab (brand — platform — reason —
resumes/permanent — set by) with a Resume button, plus a brand picker that opens the existing
`PlatformPauseModal` unchanged.

New pure `deriveTabPausedBrandRows` (`src/lib/tabPausedBrands.ts`, 5 unit tests) shapes the
rows, filtered through the same `resolveBrandPlatforms` (`src/lib/scheduleBrandConfig.ts`)
hidden/restricted/flagged-removed exclusion the Schedule Planner grid and Ask AI's
`get_paused_combos` already use — no re-derived copy. New
`src/components/TabPausedBrandsSection.tsx` mounts in `EditBrandTabModal` (new `brands` prop
from `BrandGroup`'s `uniqueBrands`), outside the admin-only block — any approved user, matching
the Schedule Planner flow. Writes go straight to `brand_platform_override` via the existing
`setBrandPlatformOverride` / `clearBrandPlatformOverride`, immediately (not part of the modal's
Save Changes batch). The section never writes `brand_platform_pause` — `recalculatePauses`
rebuilds that cache on the next Schedule Planner visit / the Monday + daily crons.

`PlatformPauseModal` gained one additive `overlayZClass` prop (default `z-40` unchanged; `z-[60]`
from here so it sits above the z-50 Edit Brand Tab modal); `EditBrandTabModal` suppresses its own
Escape-to-close while that child is open.

No schema, migration, or Edge Function change — `get_paused_combos` already reads
`brand_platform_override`, so `tools.ts` is untouched and `ai-assistant` needs no redeploy.
Full Vitest suite + `npm run build` pass. Deploy: `git push origin main` (frontend only).

Accepted limitation (see Known Issues): the Edit Brand Tab list (from the override table) and the
Schedule Planner's Paused Brands list (from the materialized `brand_platform_pause` cache) can
briefly disagree until the tab's next `recalculatePauses` run; the pause itself is in effect
immediately. Auto-detected pauses are not shown here (no override row) — they stay
Schedule-Planner-only.

Spec: `docs/superpowers/specs/2026-09-03-edit-brand-tab-paused-brands-section-design.md`
Plan: `docs/superpowers/plans/2026-09-03-edit-brand-tab-paused-brands-section.md`
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/task-history.md
git commit -m "docs: record Edit Brand Tab paused-brands section (Task N)"
```

- [ ] **Step 7: Push**

```bash
git push origin main
```

---

## Self-Review

**1. Spec coverage:**
- New component after Status block, not admin-gated → Task 3 Steps 1, 5.
- Props: `tabName`, `brands` from `BrandGroup.uniqueBrands` → Task 3 Steps 3, 6.
- Fetch overrides + 3 exclusion sets on mount, fail-open → Task 3 Step 1 (mount effect), Step 8 checklist.
- Immediate writes, not in Save Changes batch → Task 3 Step 1 (`handleResume`/`handleSavePause` call queries directly, no `onUpdated`).
- Reuse `PlatformPauseModal` unchanged except z-prop → Task 2 + Task 3 Step 1.
- Escape suppression while child open → Task 3 Step 4.
- Displayed list = `deriveTabPausedBrandRows` filtered by `resolveBrandPlatforms` → Task 1 + Task 3 Step 1 (`rows` memo).
- Add picker excludes ineligible brands → Task 3 Step 1 (`pauseableBrands`).
- Save loop: set/clear per platform, diff on reason/resumeAt → Task 3 Step 1 (`handleSavePause`).
- Resume = `clearBrandPlatformOverride`, no auto-pause branch → Task 3 Step 1 (`handleResume`).
- `minResumeAt` exact expression → Task 3 Step 1 + Step 8 checklist.
- No `brand_platform_pause` write → Task 3 Step 8 checklist; Task 4 Known Issues note.
- No `tools.ts` / migration / edge-function change → Global Constraints; Task 4 entry states it.
- Unit tests on the helper → Task 1.
- `deriveTabPausedBrandRows` signature (`overrides`, `brandByKey`, `eligible`) matches between Task 1 Interfaces, Task 1 Step 3, and Task 3 Step 1 usage. ✓
- `PlatformPauseModal` prop name `overlayZClass` consistent across Task 2 and Task 3. ✓
- Component name `TabPausedBrandsSection` and its 3 props (`tabName`, `brands`, `onChildModalOpenChange`) consistent across Task 3 Interfaces, Step 1, Step 5. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N"/bare "write tests". Task 1 has full test code; Tasks 2-3 give exact strings to change; "Task N" is a deliberate placeholder for the task-history number, flagged as such in Task 4.

**3. Type consistency:**
- `Platform` used everywhere from `src/lib/removedPlatformBrands`. ✓
- `buildPlatformRestrictionMap` returns `Map<string, Platform>` (not `Platform[]`) — matches the `restrictionMap` state type and `resolveBrandPlatforms`' signature in Task 3 Step 1. ✓
- `BrandPlatformOverride` (from `queries.ts`) has `brand_key`, `override_state`, `reason`, `resume_at`, `set_by` — matches both `buildOverrideMap`'s input and `deriveTabPausedBrandRows`' `overrides` param. ✓
- `PlatformPauseModal.onSave` is `(checkedPlatforms: Platform[], reason: string, resumeAt: string | null) => void` — matches `handleSavePause`'s params. ✓
