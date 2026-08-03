# Schedule Planner: Legacy Week Platform Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make legacy (pre-platform-tagged) Schedule Planner weeks show real per-platform TP/AG/CG/WO confirmed/removed activity, the same way current weeks already do, instead of a single platform-blind plain checkmark.

**Architecture:** `SchedulePlanner.tsx` currently forks day-cell rendering on `isLegacyWeek`: legacy weeks render a hand-rolled `<div>` reading the old platform-null `brand_schedule` row directly; every other week renders `<ScheduleCell>`, which already consumes the `confirmedByPlatform`/`removedByPlatform` overlay (`buildDateStatusIndex`, built once per tab load off *all* fetched entries, already spanning a brand's full history). Deleting the legacy fork and always rendering `<ScheduleCell>` is sufficient — `scheduleFor(rows, tab, brand, weekStart, platform)` matches `r.platform === platform` exactly, so a legacy row (`platform: null`) never matches a real platform lookup, meaning `rowsByPlatform` already comes back empty for legacy weeks with zero extra code. Read-only behavior is achieved by extending the same `isApproved`-as-gate trick the future-week case already uses (see the existing comment at `SchedulePlanner.tsx:500-511`) rather than adding a new `readOnly` prop to `ScheduleCell` — one boolean expression change covers it.

**Tech Stack:** React 19 + TypeScript, Vitest (node environment, no jsdom/React Testing Library in this repo — component-level changes here are verified by build + full regression suite + live browser check, not new unit tests, consistent with how `ScheduleCell`/`SchedulePlanner.tsx` have always been verified in this codebase).

## Global Constraints

- No new writes to `brand_schedule` — this is a read-only rendering change only.
- No schema changes.
- Non-legacy (current/past/future) week behavior must be byte-for-byte unchanged.
- Legacy weeks stay fully read-only: no click-to-cycle, no "+ Add Platform" button.
- Applies uniformly across all 11 operational tabs, gated per-tab by the existing `getTabPlatforms(tab)` whitelist — no special-casing per tab.
- No changes to `src/lib/scheduler/scheduleUtils.ts`, `src/lib/scoreSummary.ts`, `src/lib/scheduler/schedulerEngine.ts`, `src/lib/scheduler/schedulerRules.ts`, or the `brand_schedule`/`brand_platform_pause` tables — the matching logic already works correctly across full history; this is a rendering unification only.

---

### Task 1: Route legacy weeks through `ScheduleCell` instead of the plain-checkmark branch

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx:458-530` (the `filteredBrands.map((brand) => {...})` row-rendering block)

**Interfaces:**
- Consumes (unchanged, already defined in this file): `computeCellData(brand)` → `{ rowsByPlatform, pausesByPlatform }`; `computeRemovedByPlatform(brand, dayISO)` / `computeConfirmedByPlatform(brand, dayISO)` → `Partial<Record<Platform, boolean>>`; `isLegacyWeek: boolean` (memo at line 325); `isFutureWeek: boolean` (memo at line 338); `activePlatforms: Platform[]` (line 342).
- Consumes (unchanged, from `../lib/scheduler/calendarRenderer`): `ScheduleCell` component with existing props `brand, day, platforms, rowsByPlatform, pausesByPlatform, removedByPlatform, confirmedByPlatform, isApproved, onToggle, onAddPlatform` — no prop signature changes.
- Produces: no new exports. This task only changes what JSX is rendered inside the existing `filteredBrands.map` closure.

- [ ] **Step 1: Remove the now-dead `legacyRow` local variable**

  In `src/pages/SchedulePlanner.tsx`, inside `filteredBrands.map((brand) => { ... })`, delete this line (currently line 460):

  ```tsx
  const legacyRow = isLegacyWeek ? scheduleFor(scheduleRows, tab, brand, weekStartISO) : undefined;
  ```

  It becomes unused once Step 2 removes its only consumer.

- [ ] **Step 2: Replace the legacy/non-legacy ternary with an unconditional `ScheduleCell` render**

  Replace the current per-day cell block:

  ```tsx
  {WEEKDAYS.map((day, dayIndex) => (
    <td key={day} className="px-3 py-2 text-left align-top">
      {isLegacyWeek ? (
        // Legacy weeks are read-only, for every user, always: this
        // grid's ~1,133 imported historical rows are never
        // migrated/edited/regenerated (see CLAUDE.md), so no
        // onClick/cursor-pointer here at all — no
        // `handleCellClick`, since that would create a
        // platform='tp' row and flip `isLegacyWeek` to false on
        // the very next render, silently hiding this week's other
        // platform-null rows.
        <div>
          {legacyRow?.[day] === 'active' && <span className="text-emerald-600 font-semibold">✓</span>}
          {legacyRow?.[day] === 'paused' && (
            <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Pause</span>
          )}
        </div>
      ) : (
        <ScheduleCell
          brand={brand}
          day={day}
          platforms={activePlatforms}
          rowsByPlatform={rowsByPlatform}
          pausesByPlatform={pausesByPlatform}
          removedByPlatform={computeRemovedByPlatform(brand, toISODate(addDays(weekStart, dayIndex)))}
          confirmedByPlatform={computeConfirmedByPlatform(brand, toISODate(addDays(weekStart, dayIndex)))}
          // A future week is read-only: forcing isApproved
          // to false here (rather than threading a
          // separate readOnly prop through ScheduleCell)
          // reuses its existing `clickable = isApproved &&
          // !isPaused` gate, so no chip in a future week
          // ever gets an onClick/cursor-pointer, exactly
          // like the legacy-week branch above. Still
          // renders whatever platform badges/statuses
          // already exist (including none, if the week
          // hasn't been touched) — only the click
          // affordance is removed.
          isApproved={isApproved && !isFutureWeek}
          onToggle={(platform) => handleCellClick(brand, platform, day)}
          onAddPlatform={() => setAddPlatformTarget({ brand, day })}
        />
      )}
    </td>
  ))}
  ```

  with:

  ```tsx
  {WEEKDAYS.map((day, dayIndex) => (
    <td key={day} className="px-3 py-2 text-left align-top">
      <ScheduleCell
        brand={brand}
        day={day}
        platforms={activePlatforms}
        rowsByPlatform={rowsByPlatform}
        pausesByPlatform={pausesByPlatform}
        removedByPlatform={computeRemovedByPlatform(brand, toISODate(addDays(weekStart, dayIndex)))}
        confirmedByPlatform={computeConfirmedByPlatform(brand, toISODate(addDays(weekStart, dayIndex)))}
        // Both legacy weeks (imported platform-null brand_schedule rows,
        // pre-dating per-platform tracking) and future weeks are
        // read-only: forcing isApproved to false here (rather than
        // threading a separate readOnly prop through ScheduleCell) reuses
        // its existing `clickable = isApproved && !isPaused` gate, so no
        // chip in either kind of week ever gets an onClick/cursor-pointer
        // or a "+ Add Platform" button. A legacy week's rowsByPlatform is
        // already empty with zero extra code — scheduleFor's exact
        // `r.platform === platform` match never matches a platform-null
        // row — so every chip that renders for a legacy week comes
        // entirely from the confirmed/removed overlay below, computed
        // from real entry Added-dates. That's what makes a legacy week
        // visually accurate now, replacing the single plain checkmark it
        // used to show.
        isApproved={isApproved && !isFutureWeek && !isLegacyWeek}
        onToggle={(platform) => handleCellClick(brand, platform, day)}
        onAddPlatform={() => setAddPlatformTarget({ brand, day })}
      />
    </td>
  ))}
  ```

- [ ] **Step 3: Verify types and build**

  Run: `npm run build`
  Expected: succeeds with no TypeScript errors (this repo's root `tsconfig.json` is references-only — `tsc --noEmit` alone checks nothing here; `npm run build` is the real check).

- [ ] **Step 4: Run the full test suite to confirm no regressions**

  Run: `npm test`
  Expected: all existing tests pass unchanged — this task adds no new test files, since the changed logic is a JSX branch removal plus a boolean expression reusing an already-established (if previously untested) gating pattern, and this repo has no component-rendering test infrastructure (`vite.config.ts` runs Vitest with `environment: 'node'`, no `@testing-library/react`/jsdom dependency) to unit-test `ScheduleCell`/`SchedulePlanner.tsx` directly.

- [ ] **Step 5: Live-verify in the browser**

  Log into the dashboard (or reuse an already-authenticated session) and open Schedule Planner. Pick a tab/brand/week combination known to predate the 2026-08-03 platform-tagged rollout (any week before late July/early Aug 2026 with imported spreadsheet history — e.g. an early-2026 week on a 3-platform tab like Rooster Partners or Revolution Casino) and confirm:
  - The old single plain checkmark/"Pause" pill no longer renders for that week.
  - A brand with a real Live/Published TP/AG/CG entry on one of that week's weekdays shows a green-confirmed chip (with favicon + ✓ badge) on exactly that day, and a Removed/Refused one shows a red-ringed chip with the ✕ badge — matching only the platforms `getTabPlatforms(tab)` says that tab tracks.
  - No chip in that legacy week responds to click (no toggle), and no "+ Add Platform" button appears on hover.
  - Switch to a current/recent week on the same tab and confirm its existing chip behavior (click-to-cycle, "+ Add Platform", confirmed/removed styling) is completely unchanged.

  If no authenticated session/credentials are available in this environment, note that explicitly rather than claiming this step was performed.

- [ ] **Step 6: Commit**

  ```bash
  git add src/pages/SchedulePlanner.tsx
  git commit -m "$(cat <<'EOF'
  fix: show real per-platform activity on legacy Schedule Planner weeks

  Legacy (pre-platform-tagged) weeks rendered a single plain checkmark with
  no TP/AG/CG/WO breakdown, bypassing the confirmed/removed overlay that
  already works for every other week. Routes them through the same
  ScheduleCell path instead, read-only via the existing isApproved gate.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Self-Review Notes

- **Spec coverage:** All 5 decisions in the spec are covered — applies to legacy weeks (Task 1 Step 2), stays read-only overlay/no new writes (Global Constraints, Step 2's `isApproved` gate), replaces rather than layers on the plain checkmark (Step 2 deletes it outright), stays fully read-only (same gate suppresses `onToggle`/`onAddPlatform`), applies uniformly to all 11 tabs (unchanged `activePlatforms`/`getTabPlatforms` plumbing, untouched by this task).
- **Placeholder scan:** No TBD/TODO; both the removed and added code blocks are shown in full, not summarized.
- **Type consistency:** `ScheduleCell`'s prop names/types (`isApproved: boolean`, etc.) are unchanged from `src/lib/scheduler/calendarRenderer.tsx:12-23` — no new prop was introduced, avoiding a signature mismatch risk entirely.
- **Deviation from spec's literal wording:** the spec described adding a new `readOnly` prop to `ScheduleCell` "(or equivalent gate)". Reading the actual code showed `ScheduleCell` already exposes exactly this gate via `isApproved` (documented at its future-week call site), so this plan reuses that existing mechanism instead of adding a redundant parallel prop — same behavioral outcome, less surface area.
