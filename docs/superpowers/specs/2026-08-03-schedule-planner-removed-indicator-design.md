# Schedule Planner: Removed-Post Indicator

## Purpose
The Schedule Planner grid shows a colored platform chip (TP/AG/CG/WO) on each day a
brand's post was scheduled or scheduler-paused. It currently has no way to show that a
specific day's post was later found removed/refused on that platform — a chip looks
identical whether the post is still live or was taken down. This adds a visual indicator
to a day's platform chip when the post scheduled for that exact date is Removed/Refused,
reusing status data the app already tracks per entry (no new schema).

## Data Source
Each brand's review-account entry already carries, per platform, a status field
(`PLATFORM_STATUS_KEYS`) and an "added" date field (`PLATFORM_DATE_KEYS`), both defined
in `src/lib/scoreSummary.ts` and already read elsewhere (score summary computation,
scheduler auto-pause detection). This feature reads the same fields — it does not
introduce a new concept of "removed."

## Matching Logic
A schedule-grid day cell is matched to a specific entry by **exact date match**: for a
given brand + platform + calendar date (e.g. TrustPilot on Tue Jul 28), look for an entry
of that brand whose platform "added" date, parsed via `parsePostDate`, equals that exact
date. If a match exists and its status is Removed/Refused (`isRemovedStatus`), that day's
chip is flagged as removed.

This intentionally does not fall back to fuzzy/nearest-date or "most recent status"
matching. If no entry's recorded date lines up exactly with the scheduled day, the chip
renders normally (no false positive) — the trade-off is that a removed post whose
recorded add-date doesn't match the schedule exactly won't be flagged. That's acceptable:
under-flagging is safer than mislabeling the wrong day as removed.

## Implementation

### New helper: `buildRemovedOnDateIndex`
Added to `src/lib/scheduler/scheduleUtils.ts`, alongside the module's other
scheduler-specific helpers (`PLATFORM_BADGE`, `unscheduledPlatforms`, etc.):

```ts
function buildRemovedOnDateIndex(entries: Entry[]): Set<string>
```

- Scans `entries` once (not per brand/day/platform — this runs at tab-load time, same
  frequency as the existing `tabCtx` fetch, not per render).
- For each entry, resolves the brand via `BRAND_COLS` (matching how `tabCtx.brands` and
  `schedulerService.ts`'s `brandOf` already resolve brand — keeps this feature's brand-key
  resolution consistent with the rest of the scheduler, not `scoreSummary.ts`'s separate
  `BRAND_KEYS` list, which is documented as being a different list — see the existing note
  in `schedulerService.ts`'s `normalizedRates`).
- For each of the four platforms, reads `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS` via
  `pick`, and if `isRemovedStatus(status)` and the date parses successfully via
  `parsePostDate`, inserts a key into the returned `Set<string>`:
  `` `${normalizeBrandKey(brand)}::${platform}::${toISODate(date)}` ``.

### Wiring: `SchedulePlanner.tsx`
- Memoizes `buildRemovedOnDateIndex(tabCtx.entries)` off `tabCtx` (recomputed only when
  the tab's entries change, i.e. on tab switch — not on every render or week navigation).
- The per-brand/per-day render loop already computes each day's real calendar date (used
  today for the `Mon Jul 27` header labels via `formatWeekdayDate`/`addDays`). That same
  date, converted to ISO, is used to look up
  `removedIndex.has(`${brandKey}::${platform}::${dayISO}`)` for each active platform,
  producing a `removedByPlatform: Partial<Record<Platform, boolean>>` map passed into
  `ScheduleCell` as a new prop.

### Rendering: `calendarRenderer.tsx`'s `ScheduleCell`
- New prop `removedByPlatform: Partial<Record<Platform, boolean>>`.
- A platform chip that is both rendered (scheduled or scheduler-paused, per the existing
  `if (!isPaused && status == null) return null;` guard) and flagged removed:
  - Gets `ring-1 ring-rose-500` added to its existing className.
  - Gains a small `✕` rendered as an absolute-positioned corner overlay (the badge
    `<span>` becomes `relative` to anchor it).
  - Its tooltip `title` gains a `" — Removed"` suffix appended to the existing
    `${PLATFORM_FULL_LABEL[platform]}: ${statusLabel}` text.
- No change to click behavior — a removed-flagged chip keeps whatever clickability it
  already had (still cycles via `onToggle` if not scheduler-paused and the week is
  editable). This is a read-only visual overlay, not a new interactive state.
- Legacy (pre-platform, `platform IS NULL`) weeks are untouched — they don't render
  `ScheduleCell` at all today (see `SchedulePlanner.tsx`'s `isLegacyWeek` branch), and this
  feature doesn't change that.

## Out of Scope
- No new table, column, or migration.
- No manual "mark as removed" interaction — this is derived entirely from existing entry
  status/date data, same as the scheduler's existing auto-pause detection.
- No change to legacy-week rendering.
- No change to the page-level "platform removed" flag (`removed_platform_brands`) or its
  badge — that remains a separate, non-date-specific concept.

## Testing
- Unit tests for `buildRemovedOnDateIndex` in `scheduleUtils.test.ts`: entry with matching
  date + Removed status → key present; entry with matching date + Live status → key
  absent; entry with non-matching date → key absent; entry with unparseable/missing date →
  no key (no crash); multiple entries for the same brand+platform on different dates → all
  matching ones indexed independently.
- Component-level check that `ScheduleCell` renders the ring/✕/tooltip suffix when
  `removedByPlatform[platform]` is true, and renders normally when false/absent, for both
  the `active` and scheduler-paused chip states.
