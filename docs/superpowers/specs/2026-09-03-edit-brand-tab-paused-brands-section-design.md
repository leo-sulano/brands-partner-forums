# Edit Brand Tab — Paused Brands Section

## Goal

Surface the existing per-brand+platform pause (reason + "until a date",
stored in `brand_platform_override`) inside the **Edit Brand Tab** modal, so
an operator managing a tab's settings can pause a specific brand on a
specific platform — with its own resume date — without navigating to the
Schedule Planner and finding the brand's row.

This is **not** a new pause mechanism. It is a second entry point to the one
that already exists (spec
`2026-09-02-brand-platform-pause-reason-design.md`, Task 311):
`brand_platform_override` rows with `override_state = 'pause'`, `reason`,
`resume_at`. Those rows are already the durable source of truth that
`recalculatePauses` (`schedulerService.ts`) and Ask AI's `get_paused_combos`
read first. No schema change, no migration, no Edge Function change.

## Non-goals

- Materializing `brand_platform_pause` (the per-week cache) from this modal.
  That cache keeps being rebuilt by its existing triggers — any Schedule
  Planner tab visit's `recalculatePauses`, the Monday `generate-weekly-schedule`
  cron, the daily `auditAllStatuses` cron. A pause added here is effective
  the moment the override row is written (every reader consults the override
  first); the cache lag only affects the Schedule Planner's own "Paused
  Brands" list, which self-heals on its next visit/cron. Same class of lag
  the project already documents for `get_paused_combos`.
- Managing **auto-detected** pauses (2 consecutive Removed/Refused, or a low
  rolling-30-day success rate). Those have no `brand_platform_override` row,
  so they never appear in this section — they stay Schedule-Planner-only,
  noted in the section's own helper text.
- Any change to how the tab-level pause (`paused_tabs`, the modal's existing
  Status/Reason/Paused-until block) works.

## Architecture

### New component: `src/components/TabPausedBrandsSection.tsx`

Rendered inside `EditBrandTabModal.tsx`'s scrollable body as its own
section, **after** the admin-only Status block and before Toolbar Filters.
It is **not** nested in the `isAdmin &&` block — the Schedule Planner's
"Pause brand" flow is available to any approved user (`isApproved`, not
`isAdmin`), and this entry point matches that.

Props:

- `tabName: string`
- `brands: string[]` — the tab's distinct brand display strings, passed down
  from `BrandGroup.tsx`'s existing `uniqueBrands` (no new fetch).

State:

- `overrides: BrandPlatformOverride[]` — from `fetchBrandPlatformOverrides(tabName)`
  on mount.
- `exclusions` — the three sets in §"Exclusions" below, fetched once on mount
  alongside `overrides` (fail-open: a failed exclusion fetch logs and falls
  back to empty, so the section still renders — matching the project's
  `withFlagFallback` / `fetchCustomTabs` precedent).
- `busy: boolean` — a write (resume, or PlatformPauseModal save) is in flight.
- `pickerBrand: string | null` — the brand chosen from the "+ Add pause"
  select; non-null renders `<PlatformPauseModal>`.
- `error: string | null`.

The section **writes immediately** on Resume / PlatformPauseModal save — it
is not part of `EditBrandTabModal`'s "Save Changes" batch, and does not call
`onUpdated` or trigger `BrandGroup`'s reload (the brand table shows no pause
state; Schedule Planner is a separate page). This keeps it fully decoupled
from the modal's rename/platform/icon/filter diff logic.

### Reused unchanged

- **`PlatformPauseModal.tsx`** — opened with the chosen brand, its eligible
  platform list, its current override-pause state, `initialReason` /
  `initialResumeAt` pre-filled from any existing override, and
  `minResumeAt`. One small additive change only (see below).
- **`fetchBrandPlatformOverrides` / `setBrandPlatformOverride` /
  `clearBrandPlatformOverride`** (`src/lib/queries.ts`) — as-is.

### `PlatformPauseModal` — one additive change

`PlatformPauseModal`'s overlay is `z-40`; `EditBrandTabModal`'s is `z-50`, so
a child opened from inside it would render behind. Add an optional
`overlayZClass?: string` prop (default `'z-40'`, so every existing Schedule
Planner call site is byte-identical) and pass `overlayZClass="z-[60]"` from
`TabPausedBrandsSection`.

### `EditBrandTabModal` — Escape suppression

`EditBrandTabModal`'s existing `keydown` handler closes the whole modal on
Escape. While `TabPausedBrandsSection`'s child (`PlatformPauseModal`, or the
brand-picker select in its open state) is on screen, the outer Escape must
not fire. `TabPausedBrandsSection` takes an `onChildModalOpenChange(open:
boolean)` callback; `EditBrandTabModal` holds a `pauseChildOpen` state and
early-returns from its Escape handler when it's true. (`PlatformPauseModal`
keeps its own Escape-to-close.)

## Data flow

### Displayed list

```
fetchBrandPlatformOverrides(tab)                     // all rows for the tab
  → deriveTabPausedBrandRows(overrides, brandByKey, eligible)
      // filters to override_state === 'pause' AND eligible(brandKey, platform)
  → rows: { brand, brandKey, platform, reason, resumeAt|null, setBy|null }
```

where `eligible = (bk, p) => eligiblePlatformsForBrand(brandByKey.get(bk)!,
tabPlatforms, tab, removedSet, hiddenSet, restrictionMap).includes(p)`.

Each row renders like `PausedBrandsModal`'s:
`{brand} — {PLATFORM_FULL_LABEL[platform]} · {reason} · resumes {resumeAt}`
(or `· permanent` when `resumeAt` is null) `· set by {setBy}`, with a
**Resume** button. Empty state: "No brands paused on this tab."

### Add flow

`+ Add pause` → a `<select>` of `brands` (those with at least one
pause-eligible platform). Choosing one sets `pickerBrand` and opens
`PlatformPauseModal`. On its `onSave(checkedPlatforms, reason, resumeAt)`:

For each platform in that brand's eligible list:

- checked, and (no existing override-pause **or** `reason` / `resumeAt`
  changed) → `setBrandPlatformOverride(tab, brand, platform, 'pause',
  { reason, resumeAt })`
- unchecked, and previously an override-pause → `clearBrandPlatformOverride(tab,
  brandKey, platform)`

Then `fetchBrandPlatformOverrides` again → refresh the list. No
`brand_platform_pause` write (see Non-goals). Differs deliberately from
Schedule Planner's `handleSavePauseModal`, which also deletes the cache row
for immediacy on its own grid — this section has no grid to keep in sync.

### Resume

`clearBrandPlatformOverride(tab, brandKey, platform)` → refetch. No
auto-detected-pause branch (Schedule Planner's `handleResumeNow` needs one
because its list includes auto-pauses; this list, sourced from
`override_state = 'pause'` rows, never does).

### `minResumeAt`

`toISODate(addDays(mondayOf(new Date()), 7))` — the next Monday after the
real current week's Sunday, byte-identical to the expression Schedule
Planner passes (`resume_at` expiry is week-granular; any date inside the
current week self-expires the instant `recalculatePauses` next evaluates it).
`mondayOf` / `addDays` / `toISODate` from `src/lib/scheduleBrands.ts`.

## Exclusions

New pure helper `src/lib/tabPausedBrands.ts`:

```ts
export interface TabPausedBrandRow {
  brand: string;
  brandKey: string;
  platform: Platform;
  reason: string;
  resumeAt: string | null;
  setBy: string | null;
}

// Rows to display (paused overrides, minus excluded combos).
export function deriveTabPausedBrandRows(
  overrides: BrandPlatformOverride[],
  brandByKey: Map<string, string>,   // brand_key → display string
  eligible: (brandKey: string, platform: Platform) => boolean,
): TabPausedBrandRow[]

// Per-brand pause-eligible platform list for the Add picker + save loop.
export function eligiblePlatformsForBrand(
  brand: string,
  tabPlatforms: Platform[],
  tab: string,
  removedSet: Set<string>,           // platformRemovedKey(tab, brand, platform)
  hiddenSet: Set<string>,            // scheduleBrandKey(tab, brand)
  restrictionMap: Map<string, Platform[]>,
): Platform[]
```

`eligible` in `deriveTabPausedBrandRows` is `eligiblePlatformsForBrand(...)`
`.includes(platform)`, so the displayed list and the Add picker apply the
**same** exclusion — a hidden / platform-restricted / flagged-removed combo
can't be listed or newly paused. Reuses the existing
`scheduleBrandConfig.ts` (`scheduleBrandKey`, `buildHiddenBrandSet`,
`buildPlatformRestrictionMap`) and `removedPlatformBrands.ts`
(`normalizeBrandKey`, `platformRemovedKey`, the removed-set builder)
helpers — no re-derived copies — so this can't drift from Schedule Planner's
`brandPlatforms()` or Ask AI's `get_paused_combos`.

`tabPlatforms` = `getTabPlatforms(tabName)` (already imported by
`EditBrandTabModal`; respects hidden platforms).

## `BrandGroup.tsx`

One line: pass `brands={uniqueBrands}` to `<EditBrandTabModal>`.
`EditBrandTabModal` threads it straight to `TabPausedBrandsSection`.

## Cross-dashboard check

- **Ask AI `supabase/functions/ai-assistant/tools.ts`** — `get_paused_combos`
  reads `brand_platform_pause` and consults `brand_platform_override` for
  staleness. This change adds a **new writer** to `brand_platform_override`
  but changes nothing about what that table means or how it's read. No
  `tools.ts` edit, no `ai-assistant` deploy.
- **`recalculatePauses`** — already treats an override-pause as
  authoritative over auto-detection; an override written here is picked up on
  its next run with no change to that function.
- **Schedule Planner** — its "Paused Brands" list is derived from the
  materialized `brand_platform_pause` cache, so a pause added from Edit Brand
  Tab appears there after the next `recalculatePauses` (tab visit / cron),
  not instantly. Accepted, self-healing, documented in Known Issues.
- **PMS status sync** — reacts to `brand_platform_pause` materialization, not
  to the override directly, so it too picks the pause up on the next
  Schedule Planner visit / cron. No new PMS call from this modal.

## Testing

- `src/lib/tabPausedBrands.test.ts` — `deriveTabPausedBrandRows` (permanent
  vs. periodic `resumeAt`, `setBy` passthrough, brand_key→display fallback,
  excluded combos dropped) and `eligiblePlatformsForBrand` (each of the
  three exclusion sets removes the right platform; a brand with every
  platform excluded returns `[]`).
- `PlatformPauseModal` `overlayZClass` — default path unchanged; assert the
  overlay class string in the existing modal render, or just rely on
  `npm run build` + the Schedule Planner live path being untouched.
- Component: `npm run build` + a live browser check (open Edit Brand Tab,
  add a pause for one brand+platform with an until-date, confirm it lists,
  reload the modal, Resume it, then confirm the same combo shows/clears in
  the Schedule Planner's Paused Brands list after a tab visit). No modal
  test infra exists in this project (`EditBrandTabModal` has none today).
- Full suite + build. Deploy: `git push origin main` only.
