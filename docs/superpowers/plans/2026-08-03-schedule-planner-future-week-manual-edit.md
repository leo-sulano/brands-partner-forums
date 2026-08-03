# Schedule Planner: Future-Week Manual Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users manually click-to-cycle and "+ Add Platform" in any future Schedule Planner week (full parity with the current week), while making sure a manual future-week edit can never block auto-generation or pause-detection for any other brand+platform combo once that week becomes current.

**Architecture:** Two independent changes, in dependency order. First, `src/lib/scheduler/schedulerService.ts`'s two no-op guards (`ensureWeekGenerated`, `recalculatePauses`) move from week-level ("does *any* platform row exist for this week?") to per-combo ("does *this* brand+platform already have a row for this week?"). This must land first — it's what makes future-week edits safe. Second, `src/pages/SchedulePlanner.tsx` removes the `isFutureWeek` gate that currently forces the whole grid read-only for any week after the current one; `isLegacyWeek` remains the only read-only gate. Scheduler invocation itself stays gated to `isCurrentWeek` (unchanged) — a future week's edits are just data sitting in `brand_schedule` until that week's own turn to generate arrives.

**Tech Stack:** React 19 + TypeScript, Vitest (node environment, no jsdom/React Testing Library in this repo — `SchedulePlanner.tsx` changes are verified by build + full regression suite + live browser check, not new unit tests, consistent with how this file has always been verified; see Task 169/170 plans).

## Global Constraints

- No schema changes — `brand_schedule` and `brand_platform_pause` are untouched.
- Auto-generation/pause-recalculation must continue to run only for the actual current week (`isCurrentWeek` in `SchedulePlanner.tsx`'s schedule-loading effect) — never for a past or future week, unchanged from today.
- Protection against overwriting a manual edit is per `(brand, platform, week)`, not per exact day — this is a deliberate, spec-confirmed consequence of the one-row-per-combo data model, not a bug to work around.
- Task 2 depends on Task 1 already being merged — do not unlock the UI before the combo-level guards are in place and tested.

---

### Task 1: Combo-level guards in `ensureWeekGenerated` and `recalculatePauses`

**Files:**
- Modify: `src/lib/scheduler/schedulerService.ts:88-101` (doc comment above `recalculatePauses`)
- Modify: `src/lib/scheduler/schedulerService.ts:102-160` (`recalculatePauses` body)
- Modify: `src/lib/scheduler/schedulerService.ts:219-249` (`ensureWeekGenerated` doc comment + body)
- Test: `src/lib/scheduler/schedulerService.test.ts`

**Interfaces:**
- Consumes (unchanged): `fetchBrandSchedule(tab, weekStart): Promise<BrandScheduleRow[]>` where `BrandScheduleRow.platform: Platform | null` and `BrandScheduleRow.brand_key: string` (`src/lib/scheduleBrands.ts`); `PinnedCombo { brandKey: string; platform: Platform }` (`src/lib/scheduler/schedulerEngine.ts`); `generateWeekSchedule(input: SchedulerInput): ScheduledSlot[]` where `SchedulerInput.pinnedBrandPlatforms: PinnedCombo[]` is an existing field that the engine already fully honors (skips any combo present in it, in both its priority-2 and priority-3 assignment loops) — currently always called with `[]`.
- Produces: no signature changes to either exported function — `recalculatePauses(tab: string, weekStart: string, ctx: TabContext): Promise<PinnedCombo[]>` and `ensureWeekGenerated(tab: string, weekStart: string, ctx: TabContext, resumedThisWeek: PinnedCombo[]): Promise<void>` keep their existing signatures. Task 2 does not call either function directly, so it has no interface dependency on this task beyond "the guards are now safe."

- [ ] **Step 1: Write the failing tests for combo-level `ensureWeekGenerated`**

  Add to `src/lib/scheduler/schedulerService.test.ts`, inside the existing `describe('ensureWeekGenerated', ...)` block, after the last test:

  ```ts
  // Regression test for future-week manual editing: a manually-created row
  // for one brand+platform combo must not block generation for every OTHER
  // combo in the same week — only that exact combo should be skipped.
  it('generates rows only for combos that do not already have one, leaving existing combos untouched', async () => {
    queries.fetchBrandSchedule.mockResolvedValue([
      { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-10', platform: 'cg', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ]);
    const ctx: TabContext = { brands: ['WinMega', 'BrandB'], activePlatforms: ['cg'], entries: [] };
    await ensureWeekGenerated('BITP', '2026-08-10', ctx, []);
    expect(queries.bulkUpsertBrandSchedule).toHaveBeenCalledTimes(1);
    const rows = queries.bulkUpsertBrandSchedule.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tab: 'BITP', brand: 'BrandB', week_start: '2026-08-10', platform: 'cg' });
  });
  ```

- [ ] **Step 2: Write the failing test for combo-level `recalculatePauses`**

  Add to `src/lib/scheduler/schedulerService.test.ts`, inside `describe('recalculatePauses', ...)`, directly after the existing `'does not insert a pause for a week that is already generated'` test:

  ```ts
  // Regression test for future-week manual editing: an existing row for one
  // brand+platform combo must not block pause-detection for a DIFFERENT
  // combo in the same week.
  it('still detects a pause for one combo when a different combo already has a row for the week', async () => {
    queries.fetchBrandSchedule.mockResolvedValue([
      { tab: 'BITP', brand_key: 'winmega', week_start: '2026-08-03', platform: 'tp', monday: 'active', tuesday: null, wednesday: null, thursday: null, friday: null },
    ]);
    const ctx: TabContext = {
      brands: ['WinMega', 'BrandB'],
      activePlatforms: ['tp'],
      entries: [
        // Both brands independently qualify for the consecutive-removed pause trigger.
        entry({ Brands: 'WinMega', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'WinMega', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
        entry({ Brands: 'BrandB', 'TP Review Status': 'removed', 'Trust Pilot': '2026-07-28' }),
        entry({ Brands: 'BrandB', 'TP Review Status': 'refused', 'Trust Pilot': '2026-07-24' }),
      ],
    };
    await recalculatePauses('BITP', '2026-08-03', ctx);
    // WinMega/tp already has a row for this week (a manual future-week edit,
    // in the scenario this guards) -- skipped even though it would otherwise
    // qualify. BrandB/tp has no existing row and still gets paused.
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledTimes(1);
    expect(queries.upsertBrandPlatformPause).toHaveBeenCalledWith('BITP', 'BrandB', 'tp', '2026-08-03', expect.any(String));
  });
  ```

- [ ] **Step 3: Run the new tests to verify they fail**

  Run: `npm test -- schedulerService`
  Expected: both new tests FAIL — with today's week-level guards, WinMega's existing row makes the whole week look "already generated," so `ensureWeekGenerated` never even reaches `bulkUpsertBrandSchedule` (test 1 gets 0 calls, not 1) and `recalculatePauses` skips BrandB too (test 2 gets 0 calls, not 1).

- [ ] **Step 4: Change `recalculatePauses` to a per-combo guard**

  In `src/lib/scheduler/schedulerService.ts`, replace the doc comment directly above `recalculatePauses`:

  ```ts
  // Evaluates every active brand+platform combination for this tab: pauses one
  // if its two most recent posts are both Removed/Refused-classified and it
  // isn't already paused; resumes (deletes) any pause whose week has passed.
  // Returns the combos that resumed on this call, for the caller to pass into
  // ensureWeekGenerated as `resumedThisWeek`.
  //
  // A new pause is only ever inserted for a week that hasn't been generated
  // yet (mirroring ensureWeekGenerated's own no-op check). Once a week's
  // schedule is already written, inserting a pause for that same week can
  // never actually affect it — the pause would just sit in the table inert,
  // and its mere existence would corrupt the *next* week's resume logic (it
  // would look like a real pause that "expired" and get reported as resumed
  // even though it never took effect). The resume/delete path stays
  // unconditional: deleting an expired pause is always safe and idempotent.
  ```

  with:

  ```ts
  // Evaluates every active brand+platform combination for this tab: pauses one
  // if its two most recent posts are both Removed/Refused-classified and it
  // isn't already paused; resumes (deletes) any pause whose week has passed.
  // Returns the combos that resumed on this call, for the caller to pass into
  // ensureWeekGenerated as `resumedThisWeek`.
  //
  // A new pause is only ever inserted for a brand+platform combo that doesn't
  // already have a row for this week — checked per combo, not per week, so a
  // manually pre-filled combo (e.g. a future week edited ahead of time) can
  // never block pause-detection for every OTHER combo that week. Once a
  // combo's row for that week already exists, inserting a pause for it can
  // never actually affect that row — the pause would just sit in the table
  // inert, and its mere existence would corrupt the *next* week's resume
  // logic (it would look like a real pause that "expired" and get reported as
  // resumed even though it never took effect). The resume/delete path stays
  // unconditional: deleting an expired pause is always safe and idempotent.
  ```

  Then, still in `recalculatePauses`, remove this line:

  ```ts
    const weekAlreadyGenerated = existingRows.some((r) => r.platform != null);
  ```

  And replace this line inside the `for (const platform of ctx.activePlatforms) { ... }` loop:

  ```ts
        if (weekAlreadyGenerated) continue;
  ```

  with:

  ```ts
        const alreadyHasRow = existingRows.some((r) => r.platform === platform && r.brand_key === brandKey);
        if (alreadyHasRow) continue;
  ```

- [ ] **Step 5: Change `ensureWeekGenerated` to a per-combo guard**

  In `src/lib/scheduler/schedulerService.ts`, replace:

  ```ts
  // Generates and writes this week's schedule exactly once — a no-op if any
  // platform-tagged row already exists for (tab, weekStart), so navigating
  // back to an already-generated week never regenerates it.
  export async function ensureWeekGenerated(
    tab: string,
    weekStart: string,
    ctx: TabContext,
    resumedThisWeek: PinnedCombo[],
  ): Promise<void> {
    const existingRows = await fetchBrandSchedule(tab, weekStart);
    if (existingRows.some((r) => r.platform != null)) return;

    const pauses = await fetchActiveBrandPlatformPauses(tab);
    const pausedBrandPlatforms: PinnedCombo[] = pauses
      .filter((p) => p.paused_week_start === weekStart)
      .map((p) => ({ brandKey: p.brand_key, platform: p.platform }));

    const carryover = await buildCarryover(tab, weekStart, ctx);

    const slots = generateWeekSchedule({
      brands: ctx.brands,
      activePlatforms: ctx.activePlatforms,
      pinnedBrandPlatforms: [],
      pausedBrandPlatforms,
      resumingBrandPlatforms: resumedThisWeek,
      carryover,
    });

    if (slots.length === 0) return;
    await bulkUpsertBrandSchedule(groupSlotsIntoRows(tab, weekStart, slots));
  }
  ```

  with:

  ```ts
  // Generates and writes this week's schedule for every brand+platform combo
  // that doesn't already have a row for (tab, weekStart) — any combo that
  // already has one is passed to the engine as "pinned" and left completely
  // untouched. This is checked per combo, not per week: navigating back to
  // an already-fully-generated week still writes nothing (every combo is
  // pinned, so the generator produces zero slots), but a week with only SOME
  // combos manually pre-filled (e.g. a future week edited ahead of time)
  // still gets every other combo generated normally once it becomes current.
  export async function ensureWeekGenerated(
    tab: string,
    weekStart: string,
    ctx: TabContext,
    resumedThisWeek: PinnedCombo[],
  ): Promise<void> {
    const existingRows = await fetchBrandSchedule(tab, weekStart);
    const alreadyHasRowCombos: PinnedCombo[] = existingRows
      .filter((r) => r.platform != null)
      .map((r) => ({ brandKey: r.brand_key, platform: r.platform as Platform }));

    const pauses = await fetchActiveBrandPlatformPauses(tab);
    const pausedBrandPlatforms: PinnedCombo[] = pauses
      .filter((p) => p.paused_week_start === weekStart)
      .map((p) => ({ brandKey: p.brand_key, platform: p.platform }));

    const carryover = await buildCarryover(tab, weekStart, ctx);

    const slots = generateWeekSchedule({
      brands: ctx.brands,
      activePlatforms: ctx.activePlatforms,
      pinnedBrandPlatforms: alreadyHasRowCombos,
      pausedBrandPlatforms,
      resumingBrandPlatforms: resumedThisWeek,
      carryover,
    });

    if (slots.length === 0) return;
    await bulkUpsertBrandSchedule(groupSlotsIntoRows(tab, weekStart, slots));
  }
  ```

  Note: `Platform` is already imported in this file (`import { normalizeBrandKey, type Platform } from '../removedPlatformBrands';`) — no new import needed.

- [ ] **Step 6: Run the new tests to verify they pass**

  Run: `npm test -- schedulerService`
  Expected: PASS, including the two new tests from Steps 1–2.

- [ ] **Step 7: Run the full test suite to confirm no regressions**

  Run: `npm test`
  Expected: all tests pass, including every pre-existing `ensureWeekGenerated`/`recalculatePauses` test — each of those uses a single brand+platform combo, so the new per-combo guard produces byte-for-byte the same result as the old week-level guard in every one of those cases (verify this by reading the diff in results, not just the pass/fail count).

- [ ] **Step 8: Commit**

  ```bash
  git add src/lib/scheduler/schedulerService.ts src/lib/scheduler/schedulerService.test.ts
  git commit -m "$(cat <<'EOF'
  fix: guard scheduler generation/pause-detection per combo, not per week

  ensureWeekGenerated and recalculatePauses both treated "any platform row
  exists for this week" as "this week is already generated," which is only
  safe while manual edits can't happen ahead of generation. Moves both
  guards to per-brand+platform so a future manual edit to one combo can
  never block generation or pause-detection for any other combo that week.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Unlock future-week editing in `SchedulePlanner.tsx`

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx:312-323` (`handleSetDayStatus`)
- Modify: `src/pages/SchedulePlanner.tsx:325-342` (`isLegacyWeek`/`isFutureWeek` memos + `activePlatforms`)
- Modify: `src/pages/SchedulePlanner.tsx:479-505` (the `ScheduleCell` render call's `isApproved` prop)

**Interfaces:**
- Consumes (unchanged): `ScheduleCell` props from `src/lib/scheduler/calendarRenderer.tsx` — no prop signature changes, only the boolean expression passed to the existing `isApproved` prop changes.
- Produces: no new exports. `isFutureWeek` is deleted entirely — confirm (via Grep) it has no other references in the file before deleting.

- [ ] **Step 1: Remove the `isFutureWeek` guard from `handleSetDayStatus`**

  In `src/pages/SchedulePlanner.tsx`, replace:

  ```tsx
  async function handleSetDayStatus(brand: string, platform: Platform, day: Weekday, status: 'active' | 'paused') {
    if (!isApproved || isFutureWeek) return;
  ```

  with:

  ```tsx
  async function handleSetDayStatus(brand: string, platform: Platform, day: Weekday, status: 'active' | 'paused') {
    if (!isApproved) return;
  ```

- [ ] **Step 2: Delete the `isFutureWeek` memo and its comment**

  Replace:

  ```tsx
    const isLegacyWeek = useMemo(
      () => scheduleRows.length > 0 && scheduleRows.every((r) => r.platform == null),
      [scheduleRows],
    );

    // Any week strictly after the current one is read-only in the UI: nothing
    // gates a manual cell click against a future week today, and a stray click
    // there would create a platform-tagged row that permanently blocks
    // ensureWeekGenerated's no-op guard once that week actually becomes
    // current (the guard only checks "does any platform row already exist for
    // this (tab, weekStart)", with no way to tell a real generation apart from
    // one stray manual row). Deliberately `>` not `>=` — the current week
    // (weekStartISO === today's Monday) must stay fully interactive.
    const isFutureWeek = useMemo(
      () => weekStartISO > toISODate(mondayOf(new Date())),
      [weekStartISO],
    );
    const activePlatforms = tabCtx?.activePlatforms ?? [];
  ```

  with:

  ```tsx
    const isLegacyWeek = useMemo(
      () => scheduleRows.length > 0 && scheduleRows.every((r) => r.platform == null),
      [scheduleRows],
    );

    const activePlatforms = tabCtx?.activePlatforms ?? [];
  ```

- [ ] **Step 3: Update the `ScheduleCell` `isApproved` prop and its comment**

  Replace:

  ```tsx
                              <ScheduleCell
                                brand={brand}
                                day={day}
                                platforms={activePlatforms}
                                rowsByPlatform={rowsByPlatform}
                                pausesByPlatform={pausesByPlatform}
                                removedByPlatform={removedByPlatform}
                                confirmedByPlatform={confirmedByPlatform}
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
                                // entirely from the confirmed/removed overlay above, computed
                                // from real entry Added-dates. That's what makes a legacy week
                                // visually accurate now, replacing the single plain checkmark it
                                // used to show.
                                isApproved={isApproved && !isFutureWeek && !isLegacyWeek}
                                onToggle={(platform) => handleCellClick(brand, platform, day)}
                                onAddPlatform={() => setAddPlatformTarget({ brand, day })}
                              />
  ```

  with:

  ```tsx
                              <ScheduleCell
                                brand={brand}
                                day={day}
                                platforms={activePlatforms}
                                rowsByPlatform={rowsByPlatform}
                                pausesByPlatform={pausesByPlatform}
                                removedByPlatform={removedByPlatform}
                                confirmedByPlatform={confirmedByPlatform}
                                // Legacy weeks (imported platform-null brand_schedule rows,
                                // pre-dating per-platform tracking) are read-only: forcing
                                // isApproved to false here (rather than threading a separate
                                // readOnly prop through ScheduleCell) reuses its existing
                                // `clickable = isApproved && !isPaused` gate, so no chip in a
                                // legacy week ever gets an onClick/cursor-pointer or a "+ Add
                                // Platform" button. A legacy week's rowsByPlatform is already
                                // empty with zero extra code — scheduleFor's exact
                                // `r.platform === platform` match never matches a platform-null
                                // row — so every chip that renders for a legacy week comes
                                // entirely from the confirmed/removed overlay above, computed
                                // from real entry Added-dates. Future weeks are fully
                                // interactive — see schedulerService.ts's per-combo
                                // ensureWeekGenerated/recalculatePauses guards for why a manual
                                // edit here stays safe once the week becomes current.
                                isApproved={isApproved && !isLegacyWeek}
                                onToggle={(platform) => handleCellClick(brand, platform, day)}
                                onAddPlatform={() => setAddPlatformTarget({ brand, day })}
                              />
  ```

- [ ] **Step 4: Confirm no other references to `isFutureWeek` remain**

  Run: `rtk grep -n isFutureWeek "src/pages/SchedulePlanner.tsx"` (or a plain grep if `rtk` is unavailable)
  Expected: no matches.

- [ ] **Step 5: Build**

  Run: `npm run build`
  Expected: succeeds with no TypeScript errors (this repo's root `tsconfig.json` is references-only — `tsc --noEmit` alone checks nothing here; `npm run build` is the real check).

- [ ] **Step 6: Run the full test suite**

  Run: `npm test`
  Expected: all tests pass unchanged — this task adds no new test files, since `SchedulePlanner.tsx` has no component-rendering test infrastructure in this repo (no jsdom/React Testing Library), consistent with how this file has always been verified.

- [ ] **Step 7: Live-verify in the browser**

  Log into the dashboard (or reuse an already-authenticated session) and open Schedule Planner. Pick any tab and navigate to a week after the current one (Next week, or further), then confirm:
  - Clicking a blank day cell's platform chip cycles blank → active (✓) → paused → blank, exactly like the current week, and the change survives a page reload.
  - The "+ Add Platform" button appears on hover/focus for a day with unscheduled platforms, and using it to add a platform as Active or Paused persists correctly.
  - Navigating back to the current week and to a legacy (pre-platform-tagged) week confirms both are unaffected: current week still auto-generates/paused as before, legacy week is still fully read-only with no click-to-cycle or "+ Add Platform" button.
  - If practical, set a future week several weeks out for one brand+platform, then (in a lower environment, or by reasoning from the Task 1 tests) confirm that when that week becomes current, only the untouched brands/platforms get auto-generated — this is already proven by Task 1's automated tests, so this step is a sanity spot-check, not the primary verification.

  If no authenticated session/credentials are available in this environment, note that explicitly rather than claiming this step was performed.

- [ ] **Step 8: Commit**

  ```bash
  git add src/pages/SchedulePlanner.tsx
  git commit -m "$(cat <<'EOF'
  feat: allow manual editing of future Schedule Planner weeks

  Future weeks were fully read-only in the UI to prevent a stray manual row
  from permanently blocking that week's own auto-generation. Now safe to
  unlock (schedulerService.ts's guards are per-combo, not per-week, as of
  the prior commit) -- future weeks get full click-to-cycle/"+ Add Platform"
  parity with the current week. Legacy weeks remain read-only.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (auto-gen fills in everything else, skips only manually-set combos) → Task 1. Decision 2 (no horizon limit) → Task 2 removes the gate entirely rather than capping it, so every week the grid can already navigate to is editable. Decision 3 (full interaction parity) → Task 2 Steps 1–3 unlock both click-to-cycle (`handleSetDayStatus`/`handleCellClick` via the `isApproved` prop) and "+ Add Platform" (same `isApproved` prop gates `onAddPlatform`'s visibility inside `ScheduleCell`). The "bug this surfaces" section (per-combo guards in both `ensureWeekGenerated` and `recalculatePauses`) → Task 1 in full. The granularity note (protection is per combo, not per day) → captured in Global Constraints and in Task 1's updated code comments.
- **Placeholder scan:** No TBD/TODO; every changed code block is shown in full (old and new), not summarized or referenced by "similar to above."
- **Type consistency:** `PinnedCombo { brandKey: string; platform: Platform }` (Task 1's `alreadyHasRowCombos`) matches the exact shape already used for `pausedBrandPlatforms`/`resumingBrandPlatforms` in the same function — no new type introduced. `ScheduleCell`'s `isApproved: boolean` prop (Task 2) is unchanged from its existing usage; only the boolean expression feeding it changes.
- **Sequencing:** Task 1 must land before Task 2 per the Global Constraints — Task 2's live-verification step relies on Task 1's guards already being correct, since there's no automated component test that would otherwise catch a live regression from unlocking the UI first.
