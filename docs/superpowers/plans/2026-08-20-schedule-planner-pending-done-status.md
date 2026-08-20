# Schedule Planner: Pending/Done Status Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule Planner day cells automatically show a real entry's current Pending or Done status, the same way they already show Published (✓) and Removed (✕) — closing the one gap the existing evidence overlay explicitly skips.

**Architecture:** A new `buildCurrentStatusIndex` in `src/lib/scheduler/scheduleUtils.ts` resolves one "right now" status per (brand, platform) from the most-recently-updated entry — mirroring `buildAgentIndex`'s existing resolution rule, but per-platform. `TabScheduleSection.tsx` overlays it onto a day cell only when that exact brand+platform+day already has an active/paused plan slot **and** the currently-displayed week is the real current week (Pending/Done have no date, so they can't mean anything on a past/future week). `ScheduleCell`/`PlatformChip` (`calendarRenderer.tsx`) grow two more corner-badge states (amber "P", blue "D"), subordinate to the existing exact-date Published/Removed evidence when both would apply to the same cell.

**Tech Stack:** React 19, TypeScript, Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-20-schedule-planner-pending-done-status-design.md`

## Global Constraints

- Pending/Done classification lives in `src/lib/scoreSummary.ts` as `isPendingStatus`/`isDoneStatus`, mirroring `src/lib/queries.ts`'s existing (unexported/exported) functions of the same name **exactly**: `isPendingStatus(s) = s.includes('pending') || s === 'not published'`, `isDoneStatus(s) = s === 'done'`. Do not change `queries.ts`'s own copies.
- Pending/Done overlay only applies to a day that already has an `active` or `paused` plan slot for that exact brand+platform+day (`rowsByPlatform[platform]?.[day] != null`) — never creates a chip on an otherwise-empty cell.
- Pending/Done overlay only applies while viewing the real current week (`isCurrentWeek` in `TabScheduleSection.tsx`) — never on a past or future week.
- Exact-date Published/Removed evidence (the existing `confirmedByPlatform`/`removedByPlatform`) always takes priority over Pending/Done when both would apply to the same cell.
- Visual style: Pending corner badge is `bg-amber-400 text-slate-900` with the letter "P" (dark text — amber-400 is too light for white text to read clearly); Done corner badge is `bg-blue-500 text-white` with the letter "D". Neither gets a ring (matching how "Confirmed" has no ring today — only "Removed" does, as the one state signaling a problem). These colors intentionally match `EditEntryModal.tsx`'s existing `STATUS_OPTS` dot colors for Pending (`bg-amber-400`) and Done (`bg-blue-500`).
- Pending/Done evidence exempts a chip from the existing past-day "ghosting" effect, the same way Confirmed/Removed evidence already does.
- Out of scope, matching existing precedent: `scheduleExport.ts` (CSV/Excel export) and `SchedulePlanner.tsx`'s landing-grid mini-calendar preview cards. Neither shows Confirmed/Removed today either — don't add Pending/Done to them.

---

### Task 1: `isPendingStatus`/`isDoneStatus` in `scoreSummary.ts`

**Files:**
- Modify: `src/lib/scoreSummary.ts:387-396`
- Test: `src/lib/scoreSummary.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isPendingStatus(s: string): boolean` and `isDoneStatus(s: string): boolean`, both exported from `src/lib/scoreSummary.ts`, for Task 2 to import.

- [ ] **Step 1: Write the failing tests**

Open `src/lib/scoreSummary.test.ts`. Add `isPendingStatus, isDoneStatus` to the existing import on line 2, so it reads:

```ts
import { computeScoreSummary, computeSuccessRates, computeTabSuccessRates, computeAccountPlatformUsage, parseScore, ratingLabel, rateFromCounts, successRatePct, formatRatePct, PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, PLATFORM_REVIEW_TEXT_KEYS, pick, getReviewText, isRemovedStatus, isPendingStatus, isDoneStatus, passesPlatformDateFilter } from './scoreSummary';
```

Then, inside the `describe('exported platform helpers (scheduler module reuse)', ...)` block, immediately after the existing `it('isRemovedStatus matches removed, refused, and rejected', ...)` test (around line 315, right before that describe block's closing `});`), add:

```ts
  it('isPendingStatus matches "pending" and the literal "not published"', () => {
    expect(isPendingStatus('pending')).toBe(true);
    expect(isPendingStatus('not published')).toBe(true);
    expect(isPendingStatus('done')).toBe(false);
    expect(isPendingStatus('published')).toBe(false);
  });

  it('isDoneStatus matches only the exact string "done"', () => {
    expect(isDoneStatus('done')).toBe(true);
    expect(isDoneStatus('not done')).toBe(false);
    expect(isDoneStatus('pending')).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/scoreSummary.test.ts`
Expected: FAIL — `isPendingStatus`/`isDoneStatus` are not exported from `./scoreSummary`.

- [ ] **Step 3: Implement**

Open `src/lib/scoreSummary.ts`. Find this existing block (currently lines 387-396):

```ts
// Mirrors isLiveStatus/isRemovedStatus in src/lib/queries.ts (duplicated here
// rather than imported since that module is Supabase-coupled and this one is
// a pure data transform — keep these two definitions in sync if either changes).
export function isLiveStatus(s: string): boolean {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}
export function isRemovedStatus(s: string): boolean {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}
```

Replace it with (adding the two new functions, same mirroring pattern):

```ts
// Mirrors isLiveStatus/isRemovedStatus in src/lib/queries.ts (duplicated here
// rather than imported since that module is Supabase-coupled and this one is
// a pure data transform — keep these two definitions in sync if either changes).
export function isLiveStatus(s: string): boolean {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}
export function isRemovedStatus(s: string): boolean {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}
// Mirrors isPendingStatus/isDoneStatus in src/lib/queries.ts (same
// Supabase-coupled-vs-pure-module split as isLiveStatus/isRemovedStatus
// above — keep these two definitions in sync with queries.ts if either
// changes).
export function isPendingStatus(s: string): boolean {
  return s.includes('pending') || s === 'not published';
}
export function isDoneStatus(s: string): boolean {
  return s === 'done';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/scoreSummary.test.ts`
Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts
git commit -m "feat: add isPendingStatus/isDoneStatus to scoreSummary.ts"
```

---

### Task 2: `buildCurrentStatusIndex` in `scheduleUtils.ts`

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts:1-5, 102-122`
- Test: `src/lib/scheduler/scheduleUtils.test.ts`

**Interfaces:**
- Consumes: `isPendingStatus`, `isDoneStatus` from `src/lib/scoreSummary.ts` (Task 1).
- Produces: `export interface CurrentStatusIndex { pending: Set<string>; done: Set<string> }` and `export function buildCurrentStatusIndex(entries: Entry[]): CurrentStatusIndex`, both from `src/lib/scheduler/scheduleUtils.ts`, keyed by `` `${brandKey}::${platform}` `` (no date). Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Open `src/lib/scheduler/scheduleUtils.test.ts`. Add `buildCurrentStatusIndex` to the existing import on line 2, so it reads:

```ts
import { leastLoadedDay, weeklyCompletion, completedBrandPlatformKey, PLATFORM_BADGE, PLATFORM_FULL_LABEL, unscheduledPlatforms, buildDateStatusIndex, buildCurrentStatusIndex, buildAgentIndex, trailingManualPauseDays, hasNoScheduleThisWeek, buildAgentAssignmentMap, resolveAgentForPlatform, resolveAgentForBrand, buildResolvedAgentIndex } from './scheduleUtils';
```

Then add a new `describe` block right after the existing `describe('buildDateStatusIndex', ...)` block closes (after line 220, before `describe('buildAgentIndex', ...)` on line 222):

```ts
describe('buildCurrentStatusIndex', () => {
  const entry = (data: Record<string, string | null>, updatedAt: string): Entry => ({
    id: 'x', tab: 'BITP', sheet_row_id: '1', data, updated_at: updatedAt, last_edited_by: 'dashboard', last_sync_tag: null,
  });

  it('indexes a brand+platform whose latest status is Pending into pending, not done', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Pending' }, '2026-08-01T00:00:00Z')];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(pending.has('winmega::tp')).toBe(true);
    expect(done.has('winmega::tp')).toBe(false);
  });

  it('indexes a brand+platform whose latest status is Done into done, not pending', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Done' }, '2026-08-01T00:00:00Z')];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(done.has('winmega::tp')).toBe(true);
    expect(pending.has('winmega::tp')).toBe(false);
  });

  it('indexes neither set for a status that is neither pending nor done (e.g. Published)', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Published' }, '2026-08-01T00:00:00Z')];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(pending.size).toBe(0);
    expect(done.size).toBe(0);
  });

  it('picks the most-recently-updated entry\'s status per brand+platform when multiple entries disagree', () => {
    const entries = [
      entry({ Brands: 'WinMega', 'TP Review Status': 'Pending' }, '2026-07-01T00:00:00Z'),
      entry({ Brands: 'WinMega', 'TP Review Status': 'Done' }, '2026-08-10T00:00:00Z'),
      entry({ Brands: 'WinMega', 'TP Review Status': 'Pending' }, '2026-07-15T00:00:00Z'),
    ];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(done.has('winmega::tp')).toBe(true);
    expect(pending.has('winmega::tp')).toBe(false);
  });

  it('resolves each platform on the same entry independently', () => {
    const entries = [entry({ Brands: 'WinMega', 'TP Review Status': 'Pending', 'AG Review Status': 'Done' }, '2026-08-01T00:00:00Z')];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(pending.has('winmega::tp')).toBe(true);
    expect(done.has('winmega::ag')).toBe(true);
  });

  it('skips a blank status in favor of an older non-blank one for the same brand+platform', () => {
    const entries = [
      entry({ Brands: 'WinMega', 'TP Review Status': 'Pending' }, '2026-07-01T00:00:00Z'),
      entry({ Brands: 'WinMega', 'TP Review Status': '' }, '2026-08-10T00:00:00Z'),
    ];
    const { pending, done } = buildCurrentStatusIndex(entries);
    expect(pending.has('winmega::tp')).toBe(true);
  });

  it('returns empty sets for no entries', () => {
    const { pending, done } = buildCurrentStatusIndex([]);
    expect(pending.size).toBe(0);
    expect(done.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`
Expected: FAIL — `buildCurrentStatusIndex` is not exported from `./scheduleUtils`.

- [ ] **Step 3: Implement**

Open `src/lib/scheduler/scheduleUtils.ts`. Update the import on line 3 to add `isPendingStatus, isDoneStatus`:

```ts
import { PLATFORM_STATUS_KEYS, PLATFORM_DATE_KEYS, pick, isRemovedStatus, isLiveStatus, isPendingStatus, isDoneStatus, parsePostDate } from '../scoreSummary.ts';
```

Then, immediately after `buildDateStatusIndex`'s closing brace (after line 122, before the `// Resolves one Agent name per brand...` comment that precedes `buildAgentIndex` on line 124), insert:

```ts

export interface CurrentStatusIndex {
  // brandKey::platform keys whose most-recently-updated entry's status is
  // currently Pending.
  pending: Set<string>;
  // brandKey::platform keys whose most-recently-updated entry's status is
  // currently Done.
  done: Set<string>;
}

// A brand+platform's single "right now" status, independent of any date —
// unlike buildDateStatusIndex above (which needs a real post date to anchor
// a Removed/Live entry to one exact calendar day), Pending has no date to
// anchor to at all: it means "not yet decided." Resolves the same way
// buildAgentIndex/buildCountryIndex below resolve Agent/Country — the
// most-recently-updated entry wins — but per (brand, platform) rather than
// per brand, since a brand's platforms can each be at a different stage
// independently. Only Pending/Done are surfaced; a latest status that's
// something else (Live, Removed, On Pause, Not Done, blank) has no key in
// either set — this function isn't meant to represent every status, only
// the two Schedule Planner has no other way to show (Live/Removed already
// have buildDateStatusIndex above).
export function buildCurrentStatusIndex(entries: Entry[]): CurrentStatusIndex {
  const latestByKey = new Map<string, { status: string; updatedAt: string }>();
  for (const entry of entries) {
    const brand = (pick(entry.data, BRAND_COLS) ?? '').trim();
    if (!brand) continue;
    const brandKey = normalizeBrandKey(brand);
    for (const platform of ALL_PLATFORMS) {
      const status = (pick(entry.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      const key = `${brandKey}::${platform}`;
      const existing = latestByKey.get(key);
      if (!existing || entry.updated_at > existing.updatedAt) {
        latestByKey.set(key, { status, updatedAt: entry.updated_at });
      }
    }
  }
  const pending = new Set<string>();
  const done = new Set<string>();
  for (const [key, { status }] of latestByKey) {
    if (isPendingStatus(status)) pending.add(key);
    else if (isDoneStatus(status)) done.add(key);
  }
  return { pending, done };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`
Expected: PASS (all tests in the file, including the 7 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: add buildCurrentStatusIndex for Pending/Done resolution"
```

---

### Task 3: Pending/Done chip states in `calendarRenderer.tsx`

**Files:**
- Modify: `src/lib/scheduler/calendarRenderer.tsx` (whole file — see exact line references below)

**Interfaces:**
- Consumes: nothing new from other tasks (pure presentational change; the new props are typed `Partial<Record<Platform, boolean>>`, the same shape `removedByPlatform`/`confirmedByPlatform` already use).
- Produces: `ScheduleCellProps` gains `pendingByPlatform: Partial<Record<Platform, boolean>>` and `doneByPlatform: Partial<Record<Platform, boolean>>`, both required props. Consumed by Task 4.

No dedicated test file exists for this component (no `.test.tsx` files exist anywhere in `src/` in this codebase — presentational components here are verified via `npm run build` + live browser check, not React Testing Library). This task is build-verified.

- [ ] **Step 1: Update `PlatformChipProps` and `PlatformChip`**

In `src/lib/scheduler/calendarRenderer.tsx`, find the `PlatformChipProps` interface (currently lines 58-69):

```tsx
interface PlatformChipProps {
  platform: Platform;
  stateClassName: string;
  isRemoved: boolean;
  isConfirmed: boolean;
  clickable: boolean;
  planUnverified: boolean;
  label: string;
  agent?: string;
  country?: string;
  onClick: () => void;
}
```

Replace it with:

```tsx
interface PlatformChipProps {
  platform: Platform;
  stateClassName: string;
  isRemoved: boolean;
  isConfirmed: boolean;
  isPending: boolean;
  isDone: boolean;
  clickable: boolean;
  planUnverified: boolean;
  label: string;
  agent?: string;
  country?: string;
  onClick: () => void;
}
```

Find the `PlatformChip` function signature (currently line 80):

```tsx
function PlatformChip({ platform, stateClassName, isRemoved, isConfirmed, clickable, planUnverified, label, agent, country, onClick }: PlatformChipProps) {
```

Replace it with:

```tsx
function PlatformChip({ platform, stateClassName, isRemoved, isConfirmed, isPending, isDone, clickable, planUnverified, label, agent, country, onClick }: PlatformChipProps) {
```

Find the `isConfirmed` corner-badge block inside `PlatformChip`'s JSX (currently lines 112-119):

```tsx
        {isConfirmed && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-emerald-600 text-[8px] font-bold leading-none text-white"
          >
            ✓
          </span>
        )}
```

Immediately after that block (still inside the same `<span ...>...</span>` wrapper, before the closing `</span>` on the line that currently reads just `</span>` at line 120), add two more corner-badge blocks:

```tsx
        {isPending && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-amber-400 text-[8px] font-bold leading-none text-slate-900"
          >
            P
          </span>
        )}
        {isDone && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-blue-500 text-[8px] font-bold leading-none text-white"
          >
            D
          </span>
        )}
```

- [ ] **Step 2: Update `ScheduleCellProps`**

Find the `ScheduleCellProps` interface (currently lines 29-56). Locate this section:

```tsx
  removedByPlatform: Partial<Record<Platform, boolean>>;
  confirmedByPlatform: Partial<Record<Platform, boolean>>;
```

Replace it with:

```tsx
  removedByPlatform: Partial<Record<Platform, boolean>>;
  confirmedByPlatform: Partial<Record<Platform, boolean>>;
  // Pending/Done, resolved from buildCurrentStatusIndex — unlike
  // removed/confirmedByPlatform above (which are matched to this exact
  // calendar day), these have no date component: the caller
  // (TabScheduleSection.tsx) only populates them for the real current week,
  // and only for a day that already has an active/paused plan slot for that
  // platform. See buildCurrentStatusIndex's own doc comment for why.
  pendingByPlatform: Partial<Record<Platform, boolean>>;
  doneByPlatform: Partial<Record<Platform, boolean>>;
```

- [ ] **Step 3: Update `ScheduleCell`'s function signature and body**

Find the `ScheduleCell` function signature (currently line 163):

```tsx
export function ScheduleCell({ brand, day, platforms, rowsByPlatform, pausesByPlatform, removedByPlatform, confirmedByPlatform, agent, country, isPastDay, isApproved, onToggle, onAddPlatform }: ScheduleCellProps) {
```

Replace it with:

```tsx
export function ScheduleCell({ brand, day, platforms, rowsByPlatform, pausesByPlatform, removedByPlatform, confirmedByPlatform, pendingByPlatform, doneByPlatform, agent, country, isPastDay, isApproved, onToggle, onAddPlatform }: ScheduleCellProps) {
```

Find this block inside the `platforms.map((platform) => { ... })` callback (currently lines 168-176):

```tsx
        const isPaused = !!pausesByPlatform[platform];
        const row = rowsByPlatform[platform];
        const status: DayStatus = row?.[day] ?? null;
        const isConfirmed = !!confirmedByPlatform[platform];
        const isRemoved = !!removedByPlatform[platform];
        const hasEvidence = isConfirmed || isRemoved;
        if (!isPaused && status == null && !hasEvidence) return null;
        const badge = PLATFORM_BADGE[platform];
        const isActiveLook = status === 'active' || (status == null && hasEvidence);
```

Replace it with:

```tsx
        const isPaused = !!pausesByPlatform[platform];
        const row = rowsByPlatform[platform];
        const status: DayStatus = row?.[day] ?? null;
        const isConfirmed = !!confirmedByPlatform[platform];
        const isRemoved = !!removedByPlatform[platform];
        const hasDateEvidence = isConfirmed || isRemoved;
        // Exact-date Published/Removed evidence always wins over the
        // dateless Pending/Done overlay for the same cell — see this
        // component's own doc comment on ScheduleCellProps above.
        const isPending = !hasDateEvidence && !!pendingByPlatform[platform];
        const isDone = !hasDateEvidence && !isPending && !!doneByPlatform[platform];
        const hasEvidence = hasDateEvidence || isPending || isDone;
        if (!isPaused && status == null && !hasEvidence) return null;
        const badge = PLATFORM_BADGE[platform];
        const isActiveLook = status === 'active' || (status == null && hasEvidence);
```

Find the `label` computation and the `<PlatformChip .../>` call (currently lines 182-203):

```tsx
        const clickable = isApproved && !isPaused;
        const planUnverified = isPastDay && !isPaused && !hasEvidence && status != null;
        const label = hasEvidence
          ? (isRemoved ? 'Removed' : 'Published')
          : isPaused
            ? 'Paused (scheduler)'
            : statusLabel(status);
        return (
          <PlatformChip
            key={platform}
            platform={platform}
            stateClassName={stateClassName}
            isRemoved={isRemoved}
            isConfirmed={isConfirmed}
            clickable={clickable}
            planUnverified={planUnverified}
            label={label}
            agent={agent}
            country={country}
            onClick={() => onToggle(platform)}
          />
        );
```

Replace it with:

```tsx
        const clickable = isApproved && !isPaused;
        const planUnverified = isPastDay && !isPaused && !hasEvidence && status != null;
        const label = hasDateEvidence
          ? (isRemoved ? 'Removed' : 'Published')
          : isPending
            ? 'Pending'
            : isDone
              ? 'Done'
              : isPaused
                ? 'Paused (scheduler)'
                : statusLabel(status);
        return (
          <PlatformChip
            key={platform}
            platform={platform}
            stateClassName={stateClassName}
            isRemoved={isRemoved}
            isConfirmed={isConfirmed}
            isPending={isPending}
            isDone={isDone}
            clickable={clickable}
            planUnverified={planUnverified}
            label={label}
            agent={agent}
            country={country}
            onClick={() => onToggle(platform)}
          />
        );
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors. (This step will fail if `TabScheduleSection.tsx`, which still passes only the old props at this point, no longer satisfies `ScheduleCellProps` — that's expected and gets fixed in Task 4. If this task is executed standalone, temporarily confirm via `npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep calendarRenderer` that `calendarRenderer.tsx` itself has no new errors, since the caller-side error in `TabScheduleSection.tsx` is Task 4's responsibility.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/calendarRenderer.tsx
git commit -m "feat: add Pending/Done chip states to ScheduleCell"
```

---

### Task 4: Wire `buildCurrentStatusIndex` into `TabScheduleSection.tsx`

**Files:**
- Modify: `src/components/TabScheduleSection.tsx`

**Interfaces:**
- Consumes: `buildCurrentStatusIndex` from `src/lib/scheduler/scheduleUtils.ts` (Task 2); `ScheduleCellProps`'s new `pendingByPlatform`/`doneByPlatform` fields (Task 3).
- Produces: nothing further downstream — this is the final wiring point.

No dedicated test file exists for this component either — build-verified, same as Task 3.

- [ ] **Step 1: Import `buildCurrentStatusIndex`**

In `src/components/TabScheduleSection.tsx`, find the import on line 27:

```tsx
import { unscheduledPlatforms, buildDateStatusIndex, buildAgentIndex, buildAgentAssignmentMap, resolveAgentForPlatform, buildResolvedAgentIndex, buildCountryIndex, trailingManualPauseDays, hasNoScheduleThisWeek, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
```

Replace it with:

```tsx
import { unscheduledPlatforms, buildDateStatusIndex, buildCurrentStatusIndex, buildAgentIndex, buildAgentAssignmentMap, resolveAgentForPlatform, buildResolvedAgentIndex, buildCountryIndex, trailingManualPauseDays, hasNoScheduleThisWeek, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
```

- [ ] **Step 2: Add the `currentStatusIndex` memo**

Find the existing `dateStatusIndex` memo (currently lines 303-309):

```tsx
  // Built once per tab load (off tabCtx.entries), not per render — see
  // buildDateStatusIndex's own doc comment for why brand-key resolution here
  // must match BRAND_COLS, not scoreSummary.ts's separate BRAND_KEYS.
  const dateStatusIndex = useMemo(
    () => buildDateStatusIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );
```

Immediately after it, add:

```tsx

  // Built once per tab load off the same tabCtx.entries as dateStatusIndex
  // above, but keyed by brand+platform only (no date) — see
  // buildCurrentStatusIndex's own doc comment for why Pending/Done can't use
  // the same exact-date matching Confirmed/Removed use.
  const currentStatusIndex = useMemo(
    () => buildCurrentStatusIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );
```

- [ ] **Step 3: Add `computePendingByPlatform`/`computeDoneByPlatform`**

Find the existing `computeConfirmedByPlatform` function (currently lines 383-390):

```tsx
  function computeConfirmedByPlatform(brand: string, dayISO: string): Partial<Record<Platform, boolean>> {
    const brandKey = normalizeBrandKey(brand);
    const confirmedByPlatform: Partial<Record<Platform, boolean>> = {};
    for (const platform of brandPlatforms(brand)) {
      if (dateStatusIndex.confirmed.has(`${brandKey}::${platform}::${dayISO}`)) confirmedByPlatform[platform] = true;
    }
    return confirmedByPlatform;
  }
```

Immediately after it, add:

```tsx

  // Pending/Done have no date to match against (see buildCurrentStatusIndex's
  // own doc comment), so unlike computeRemovedByPlatform/
  // computeConfirmedByPlatform above these take a Weekday + rowsByPlatform
  // instead of a dayISO. They read `isCurrentWeek`, a const declared further
  // below in this component — safe because these are plain functions only
  // ever invoked from JSX during render, after every top-level const here has
  // already been assigned (same reasoning as brandPlatforms/
  // flaggedRemovedPlatforms above, which read tabCtx the same way). Gated to
  // isCurrentWeek because Pending/Done describe "what's true right now," with
  // no date to anchor them to a specific past/future week. Gated to a day
  // that already has an active/paused plan slot
  // (rowsByPlatform[platform]?.[day] != null) so this never creates a chip
  // where none exists today — it only changes what an existing chip says.
  function computePendingByPlatform(brand: string, day: Weekday, rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>): Partial<Record<Platform, boolean>> {
    const pendingByPlatform: Partial<Record<Platform, boolean>> = {};
    if (!isCurrentWeek) return pendingByPlatform;
    const brandKey = normalizeBrandKey(brand);
    for (const platform of brandPlatforms(brand)) {
      if (rowsByPlatform[platform]?.[day] == null) continue;
      if (currentStatusIndex.pending.has(`${brandKey}::${platform}`)) pendingByPlatform[platform] = true;
    }
    return pendingByPlatform;
  }

  function computeDoneByPlatform(brand: string, day: Weekday, rowsByPlatform: Partial<Record<Platform, BrandScheduleRow>>): Partial<Record<Platform, boolean>> {
    const doneByPlatform: Partial<Record<Platform, boolean>> = {};
    if (!isCurrentWeek) return doneByPlatform;
    const brandKey = normalizeBrandKey(brand);
    for (const platform of brandPlatforms(brand)) {
      if (rowsByPlatform[platform]?.[day] == null) continue;
      if (currentStatusIndex.done.has(`${brandKey}::${platform}`)) doneByPlatform[platform] = true;
    }
    return doneByPlatform;
  }
```

- [ ] **Step 4: Pass the new props to `ScheduleCell`**

Find the day-cell rendering block inside the `filteredBrands.map((brand) => { ... })` callback (currently lines 608-641):

```tsx
                    {WEEKDAYS.map((day, dayIndex) => {
                      const dayISO = toISODate(addDays(weekStart, dayIndex));
                      const removedByPlatform = computeRemovedByPlatform(brand, dayISO);
                      const confirmedByPlatform = computeConfirmedByPlatform(brand, dayISO);
                      return (
                        <td key={day} className="px-3 py-2 text-left align-top">
                          <ScheduleCell
                            brand={brand}
                            day={day}
                            platforms={brandPlatforms(brand)}
                            rowsByPlatform={rowsByPlatform}
                            pausesByPlatform={pausesByPlatform}
                            removedByPlatform={removedByPlatform}
                            confirmedByPlatform={confirmedByPlatform}
                            agent={agent}
                            country={country}
                            isPastDay={dayISO < todayISO}
                            // Legacy weeks (imported platform-null brand_schedule rows,
                            // pre-dating per-platform tracking) are read-only: forcing
                            // isApproved to false here (rather than threading a separate
                            // readOnly prop through ScheduleCell) reuses its existing
                            // `clickable = isApproved && !isPaused` gate, so no chip in a
                            // legacy week ever gets an onClick/cursor-pointer or a "+ Add
                            // Platform" button. Future weeks are fully interactive — see
                            // schedulerService.ts's per-combo ensureWeekGenerated/
                            // recalculatePauses guards for why a manual edit here stays
                            // safe once the week becomes current.
                            isApproved={isApproved && !isLegacyWeek}
                            onToggle={(platform) => handleCellClick(brand, platform, day)}
                            onAddPlatform={() => setAddPlatformTarget({ brand, day })}
                          />
                        </td>
                      );
                    })}
```

Replace it with:

```tsx
                    {WEEKDAYS.map((day, dayIndex) => {
                      const dayISO = toISODate(addDays(weekStart, dayIndex));
                      const removedByPlatform = computeRemovedByPlatform(brand, dayISO);
                      const confirmedByPlatform = computeConfirmedByPlatform(brand, dayISO);
                      const pendingByPlatform = computePendingByPlatform(brand, day, rowsByPlatform);
                      const doneByPlatform = computeDoneByPlatform(brand, day, rowsByPlatform);
                      return (
                        <td key={day} className="px-3 py-2 text-left align-top">
                          <ScheduleCell
                            brand={brand}
                            day={day}
                            platforms={brandPlatforms(brand)}
                            rowsByPlatform={rowsByPlatform}
                            pausesByPlatform={pausesByPlatform}
                            removedByPlatform={removedByPlatform}
                            confirmedByPlatform={confirmedByPlatform}
                            pendingByPlatform={pendingByPlatform}
                            doneByPlatform={doneByPlatform}
                            agent={agent}
                            country={country}
                            isPastDay={dayISO < todayISO}
                            // Legacy weeks (imported platform-null brand_schedule rows,
                            // pre-dating per-platform tracking) are read-only: forcing
                            // isApproved to false here (rather than threading a separate
                            // readOnly prop through ScheduleCell) reuses its existing
                            // `clickable = isApproved && !isPaused` gate, so no chip in a
                            // legacy week ever gets an onClick/cursor-pointer or a "+ Add
                            // Platform" button. Future weeks are fully interactive — see
                            // schedulerService.ts's per-combo ensureWeekGenerated/
                            // recalculatePauses guards for why a manual edit here stays
                            // safe once the week becomes current.
                            isApproved={isApproved && !isLegacyWeek}
                            onToggle={(platform) => handleCellClick(brand, platform, day)}
                            onAddPlatform={() => setAddPlatformTarget({ brand, day })}
                          />
                        </td>
                      );
                    })}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (this is the step that proves Task 3's `ScheduleCellProps` change and this task's call site agree).

- [ ] **Step 6: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "feat: overlay Pending/Done status onto Schedule Planner day cells"
```

---

### Task 5: Full suite, live verification, and whole-branch review

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite and build**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass (no regressions in the existing suite, plus the 9 new tests from Tasks 1-2).

- [ ] **Step 2: Live-verify in the browser via Playwright**

Start the dev server (`npm run dev`) if not already running, sign in using the credentials in `.env` (`CAPTURE_EMAIL`/`CAPTURE_PASSWORD`), and using the Playwright MCP tools:

1. Open Schedule Planner, select a tab with brands scheduled in the current week (e.g. **BITP**, matching the screenshot in this feature's original request). Note a brand+platform+day that currently shows a plain "Scheduled" (no ✓/✕ badge) chip — that's the target cell.
2. In a separate tab, open that brand's row in Brand Tabs (or via the day cell's own "View in Brand Tabs" link) and use Edit Entry to set that platform's Review Status to **Pending**. Save.
3. Return to Schedule Planner and reload. Confirm the target day cell's chip now shows the amber "P" corner badge and its tooltip reads "Pending" (not "Scheduled").
4. Edit the same entry again, this time setting the status to **Done**. Reload Schedule Planner and confirm the chip now shows the blue "D" badge and "Done" in its tooltip (not "Pending" — confirming the update, not just the initial set, propagates).
5. Navigate to the previous week (Prev button) and confirm that same brand's cell shows no Pending/Done badge there, even though the underlying entry's status is still Done — confirming the current-week gate.
6. Revert the entry's status back to its original value (whatever it was before step 2) via Edit Entry, so no test data is left behind.
7. Confirm a cell that already shows the existing green ✓ (Confirmed/Published) or red ✕ (Removed) badge from real dated evidence is unaffected by this change (still shows ✓/✕, not P/D), on any brand where one is currently visible.

- [ ] **Step 3: Whole-branch review**

Review the full diff across all 4 prior tasks together (`git diff main...HEAD` or equivalent), checking specifically for:
- `scoreSummary.ts`'s new `isPendingStatus`/`isDoneStatus` match `queries.ts`'s existing `isPendingStatus`/`isDoneStatus` character-for-character (grep both files, compare the two function bodies directly).
- `buildCurrentStatusIndex` in `scheduleUtils.ts` uses `BRAND_COLS` (matching `buildDateStatusIndex`/`buildAgentIndex` in the same file) and not `scoreSummary.ts`'s separate `BRAND_KEYS` — a mismatch here would silently make Pending/Done resolve against a different brand-name vocabulary than Confirmed/Removed/Agent/Country do.
- `calendarRenderer.tsx`'s new `isPending`/`isDone` computation is gated on `!hasDateEvidence` (and `isDone` additionally on `!isPending`) so a cell can never show more than one of Removed/Confirmed/Pending/Done at once.
- `TabScheduleSection.tsx`'s `computePendingByPlatform`/`computeDoneByPlatform` are only ever called with the day loop's own `rowsByPlatform` (not a stale or differently-scoped variable), and both correctly return an empty object outside `isCurrentWeek` — grep for their two call sites to confirm.
- No other Schedule Planner surface (export, landing-grid preview, `AddPlatformModal`) was touched — confirm the diff only touches the 4 files from Tasks 1-4.

- [ ] **Step 4: Update `docs/task-history.md` and `CLAUDE.md`**

The current highest task number in `docs/task-history.md` is 242 (confirm this is still true — `grep -oE "Task [0-9]+" docs/task-history.md | sort -t' ' -k2 -n -u | tail -1` — in case a concurrent session has since added more) — this feature is **Task 243**. `docs/task-history.md` does not currently end with a trailing `---` divider before EOF, so prepend one before the new entry (see `feedback_pms_sync_missing_divider_gotcha` — a missing divider silently merges a new entry into the prior one). Append an entry documenting: the Pending/Done overlay's data model (`buildCurrentStatusIndex`, most-recently-updated-entry resolution per brand+platform), the current-week-only + already-scheduled-slot attachment rule and why (no date to anchor Pending/Done to), the amber "P"/blue "D" visual treatment, that exact-date Confirmed/Removed evidence still wins when both would apply, the explicit exclusion from export/landing-grid (matching existing Confirmed/Removed precedent), real test counts from Step 1, and the live-verification steps performed in Step 2 — follow the exact prose style and level of detail of the most recent entries in that file (see e.g. the Task 231/232 entries for the expected shape: root cause/rationale, what changed, what was deliberately left alone, and what was verified live). This repo's Stop hook auto-syncs `docs/task-history.md` entries to the PMS Review/QA column; no manual PMS API calls are needed.

Also add a matching, shorter entry to `CLAUDE.md`'s own "Recent Changes" section under Dynamic State (that section is more selectively curated than `task-history.md` — check `grep -n "Task 2" CLAUDE.md` first to confirm the current latest entry there, then add this one above it following the same dated-bullet format).

- [ ] **Step 5: Commit the documentation update**

```bash
git add docs/task-history.md CLAUDE.md
git commit -m "docs: record Task 243 (Schedule Planner Pending/Done status overlay)"
```
