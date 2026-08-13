# Brand Tabs — Real Counts for Flagged-Removed Brand/Platform on Brand Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Brand filter on a Brand Tabs page is narrowed to one or more specific brands, those brands' KPI cards (per-platform TP/AG/CG cards and the aggregate Total/Live/Removed/Success Rate cards) show real historical Live/Removed counts on their flagged-removed platform(s) instead of the current unconditional 0/exclusion.

**Architecture:** `BrandGroup.tsx` computes its own KPI numbers locally (`displayKpis`, `displayTotals`) rather than through the shared `scoreSummary.ts` functions that power Score Summary/Overview/Ask AI. Both local computations currently skip any row whose brand is flagged removed on the platform being counted (`isPlatformRemoved`), unconditionally. This plan adds a single `brandFilter.length > 0` guard around that skip in both places — nothing else changes.

**Tech Stack:** Vite 6 · React 19 · TypeScript · Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-brand-tabs-removed-platform-count-design.md`

## Global Constraints

- Scope is `src/pages/BrandGroup.tsx` only — `scoreSummary.ts`, Score Summary, Overview, and Ask AI are NOT touched.
- The trigger is `brandFilter.length > 0` (the Brand filter dropdown / `?brand=` deep link) — not narrowed to exactly one brand.
- Empty `brandFilter` (default whole-tab view) must keep today's exclusion behavior identical.
- `matchesPlatform` (table row / status-filter gating) and `PlatformRemovedBadge` rendering are unchanged — this task only affects the KPI card numbers.
- No schema change, no new dependencies.

---

### Task 1: Brand-filter-scoped real counts on `displayKpis` and `displayTotals`

**Files:**
- Modify: `src/pages/BrandGroup.tsx:1409-1429` (`displayKpis`)
- Modify: `src/pages/BrandGroup.tsx:1458-1479` (`displayTotals`)

**Interfaces:**
- Consumes: existing `brandFilter: string[]` component state (already defined at `src/pages/BrandGroup.tsx:558`), existing `isPlatformRemoved(brandName, platform): boolean` (line 1040), existing `brandCol`, `ratingFiltered`, `tabPlatforms`, `platformFilter`.
- Produces: no new exports — `displayKpis: { tp: {live, removed}, ag: {...}, cg: {...} }` and `displayTotals: { total, live, removed }` keep their existing shapes; only the values they compute change under the new condition.

This task has no dedicated unit test to write-first against — `BrandGroup.tsx` has no test file today (confirmed: no `BrandGroup.test.*` exists anywhere in `src/`), matching this project's established pattern of verifying this specific file's page-level computed values via `npm run build` + `npm test` (regression coverage for everything else) + a live Playwright check, not new unit tests. Steps below follow that pattern instead of TDD red/green.

- [ ] **Step 1: Read the current `displayKpis` and `displayTotals` blocks to confirm line numbers still match**

Run: view `src/pages/BrandGroup.tsx` around lines 1406-1480. Confirm the two blocks below still read exactly as shown (the file may have shifted slightly since this plan was written — if so, locate `const displayKpis = (() => {` and `const displayTotals = (() => {` by name instead of line number).

Current `displayKpis` (to be changed):

```ts
  const displayKpis = (() => {
    function countPlatform(key: 'tp' | 'ag' | 'cg') {
      const statusCol = key === 'tp'
        ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
        : (headers.find((h) => h.toLowerCase() === PLATFORM_STATUS_COL[key].toLowerCase()) ?? null);
      if (!statusCol) return { live: 0, removed: 0 };
      let live = 0, removed = 0;
      for (const e of ratingFiltered) {
        // A brand whose page on THIS platform has been delisted entirely
        // shouldn't count toward this card's Live/Removed totals — independent
        // per platform, matching the same exclusion applied in Score Summary.
        if (brandCol && isPlatformRemoved(e.data[brandCol], key)) continue;
        if (dateActive && !passesPlatformDateFilter(e.data, key, dateFrom, dateTo)) continue;
        const v = (e.data[statusCol] ?? '').toLowerCase();
        if (isLive(v)) live++;
        else if (isRemoved(v)) removed++;
      }
      return { live, removed };
    }
    return { tp: countPlatform('tp'), ag: countPlatform('ag'), cg: countPlatform('cg') };
  })();
```

Current `displayTotals` (to be changed):

```ts
  const displayTotals = (() => {
    const matchingSelection = tabPlatforms.filter((p) => platformFilter.includes(p));
    const totalsPlatforms = matchingSelection.length > 0 ? matchingSelection : tabPlatforms;
    let live = 0, removed = 0;
    for (const e of ratingFiltered) {
      const statuses = totalsPlatforms
        .filter((p) => !(brandCol && isPlatformRemoved(e.data[brandCol], p)))
        .filter((p) => !dateActive || passesPlatformDateFilter(e.data, p, dateFrom, dateTo))
        .map((p) => platformStatusCol(headers, p))
        .filter((col): col is string => !!col)
        .map((col) => (e.data[col] ?? '').toLowerCase())
        .filter(Boolean);
      if (statuses.some(isLive)) live++;
      else if (statuses.some(isRemoved)) removed++;
    }
    return { total: live + removed, live, removed };
  })();
```

- [ ] **Step 2: Edit `displayKpis` to add the brand-filter-scoped guard**

Replace the block from Step 1 with:

```ts
  const displayKpis = (() => {
    // When one or more brands are explicitly selected via the Brand filter
    // (or the ?brand= deep link, which sets the same state), the user is
    // deliberately looking at that brand's own page — show its real
    // historical counts on a flagged-removed platform instead of excluding
    // it, same as the rest of the app already does for an unfiltered/global
    // view. Empty brandFilter (default whole-tab view) keeps today's
    // exclusion behavior unchanged.
    const brandScoped = brandFilter.length > 0;
    function countPlatform(key: 'tp' | 'ag' | 'cg') {
      const statusCol = key === 'tp'
        ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
        : (headers.find((h) => h.toLowerCase() === PLATFORM_STATUS_COL[key].toLowerCase()) ?? null);
      if (!statusCol) return { live: 0, removed: 0 };
      let live = 0, removed = 0;
      for (const e of ratingFiltered) {
        // A brand whose page on THIS platform has been delisted entirely
        // shouldn't count toward this card's Live/Removed totals — independent
        // per platform, matching the same exclusion applied in Score Summary —
        // unless the user has explicitly filtered down to specific brand(s)
        // (brandScoped), in which case they're looking at that brand's own
        // page and want its real numbers.
        if (!brandScoped && brandCol && isPlatformRemoved(e.data[brandCol], key)) continue;
        if (dateActive && !passesPlatformDateFilter(e.data, key, dateFrom, dateTo)) continue;
        const v = (e.data[statusCol] ?? '').toLowerCase();
        if (isLive(v)) live++;
        else if (isRemoved(v)) removed++;
      }
      return { live, removed };
    }
    return { tp: countPlatform('tp'), ag: countPlatform('ag'), cg: countPlatform('cg') };
  })();
```

- [ ] **Step 3: Edit `displayTotals` to add the same guard**

Replace the block from Step 1 with:

```ts
  const displayTotals = (() => {
    const matchingSelection = tabPlatforms.filter((p) => platformFilter.includes(p));
    const totalsPlatforms = matchingSelection.length > 0 ? matchingSelection : tabPlatforms;
    // Same brand-filter-scoped rule as displayKpis above — kept as an
    // independent computation here (not shared) since these two blocks
    // already had no earlier shared helper before this change.
    const brandScoped = brandFilter.length > 0;
    let live = 0, removed = 0;
    for (const e of ratingFiltered) {
      const statuses = totalsPlatforms
        .filter((p) => brandScoped || !(brandCol && isPlatformRemoved(e.data[brandCol], p)))
        .filter((p) => !dateActive || passesPlatformDateFilter(e.data, p, dateFrom, dateTo))
        .map((p) => platformStatusCol(headers, p))
        .filter((col): col is string => !!col)
        .map((col) => (e.data[col] ?? '').toLowerCase())
        .filter(Boolean);
      if (statuses.some(isLive)) live++;
      else if (statuses.some(isRemoved)) removed++;
    }
    return { total: live + removed, live, removed };
  })();
```

- [ ] **Step 4: Type-check and build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors. `brandFilter`, `brandCol`, `isPlatformRemoved`, `ratingFiltered`, `tabPlatforms`, `platformFilter` are all pre-existing in-scope identifiers at this point in the component, so no new imports are needed.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: same pass count as before this change (this file has no dedicated tests, so none should newly fail or newly appear — a suite-size change here would indicate an unrelated problem, not something this task introduces).

- [ ] **Step 6: Live verification**

If Supabase login credentials are available in this environment: sign in, find a brand with a real `removed_platform_brands` flag (query the table directly via the Supabase dashboard/REST, or use a brand already known to be flagged from prior task history — e.g. a TP Brand Injection or TP Affiliate brand from the original 14-row seed, or a Hanan brand). On that brand's tab:
  1. With the Brand filter empty, confirm the flagged platform's card (or the tab's aggregate Total/Live/Removed cards on a single-platform tab) still reads 0 / matches today's production behavior.
  2. Select that one brand via the Brand filter dropdown. Confirm the flagged platform's card now shows a non-zero, real count.
  3. Try the `?brand=<name>` URL deep link directly (same mechanism Task 167 already uses) and confirm the same result.
  4. Select that brand plus one or two unflagged brands together. Confirm all selected brands' real platforms count correctly, with no double-counting and no regression on the unflagged brands' numbers.
  5. Clear the Brand filter again and confirm the cards revert to excluding the flagged brand, matching step 1.

If no Supabase credentials are available in this environment: skip this step and note it as a known gap in the changelog entry (Step 7), matching this project's established practice for sessions without DB access (see e.g. Task 178's and Task 152's write-ups).

- [ ] **Step 7: Update the changelog**

Add a new entry at the top of `CLAUDE.md`'s "### Recent Changes" section (below "### Current Tasks", above the existing newest entry) and a matching `## Task 214: ...` section appended to the end of `docs/task-history.md`, describing: what changed (the `brandScoped` guard in `displayKpis`/`displayTotals`), why (user-reported gap — global counts correctly exclude flagged-removed brand/platform pages, but Brand Tabs' own KPI cards had no way to see a flagged brand's real numbers even when explicitly viewing that brand), what stayed unchanged (Score Summary/Overview/`scoreSummary.ts`, `matchesPlatform`, `PlatformRemovedBadge`), test/build results from Steps 4-5, and the live-verification outcome (or its absence) from Step 6. Reference the spec (`docs/superpowers/specs/2026-08-13-brand-tabs-removed-platform-count-design.md`) and this plan file.

- [ ] **Step 8: Commit**

```bash
git add src/pages/BrandGroup.tsx CLAUDE.md docs/task-history.md
git commit -m "$(cat <<'EOF'
Show real counts for flagged-removed brand/platform when Brand-filtered

Brand Tabs' displayKpis/displayTotals now skip the removed_platform_brands
exclusion whenever the Brand filter is non-empty, so viewing a flagged
brand's own page shows its real historical Live/Removed counts instead of
0. Global aggregates (Score Summary/Overview) are unchanged. Task 214.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
