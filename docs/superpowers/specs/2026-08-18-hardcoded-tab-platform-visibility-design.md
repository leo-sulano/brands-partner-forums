# Hardcoded Brand Tab Platform Visibility

**Requested by:** Leo, via chat — immediately after Task 236 (Edit Platforms
for self-service Brand Tabs) shipped, asked to "apply this to the existing
brand tab also." Scope narrowed interactively — see decisions below.

## Current behavior (for reference)

- `getTabPlatforms(tab)` (`src/lib/tab-configs.ts`) is the single canonical
  function every real consumer calls to learn which platforms a tab tracks:
  `Sidebar.tsx`, `BrandGroup.tsx`, `SchedulePlanner.tsx`,
  `TabScheduleSection.tsx`, `Overview.tsx`, `Topbar.tsx`,
  `EditEntryModal.tsx`, and the `generate-weekly-schedule` Deno Edge
  Function's `buildTabContext` — confirmed by grepping every import site.
  For the 11 hardcoded tabs it derives platforms from `TAB_COLUMN_CONFIGS`
  plus live column presence (e.g. checks for `'AG Review Status'`); for a
  dynamic (self-service) tab it derives them from whatever
  `buildDynamicTabColumns` generated.
- Task 236 (same day, earlier) added editable platforms for *dynamic* tabs
  only: an "Edit Platforms" button on `BrandGroup.tsx`, gated on
  `isDynamicTab(tab)`, that updates `custom_tabs.platforms` and regenerates
  that tab's column list via `buildDynamicTabColumns` — a platform that's
  unchecked has its columns stop being generated at all, so its data (still
  sitting in `entries.data`) simply has no header to render against.
- The 11 hardcoded tabs have no equivalent: their column list is a static
  `Record<string, string[]>` in code. There's no DB row per hardcoded tab to
  toggle, and removing a hardcoded tab's *column config* would break the
  many things that depend on those exact column names already existing
  (entry field mapping, brand URL maps, Edit Entry modal, exports, Selenium
  scraper writes). Columns must stay exactly as they are; what varies is
  only whether a platform that already has real columns and real data
  should currently be *shown*.
- `ai-assistant/tools.ts` does not call `getTabPlatforms` at all (confirmed
  by grep) — it has its own, independent logic for reporting per-tab
  platform data to the model.
- `hasMultiPlatform(tab)` (used only by `BrandGroup.tsx`'s Duplicate-row
  modal, to decide which platform-specific fields to show when duplicating
  rows) checks column *existence*, not visibility — a separate, narrower
  concern from `getTabPlatforms`.

## Decisions (confirmed interactively)

1. **Scope:** all 11 hardcoded tabs, same UI entry point (the pencil "Edit
   Platforms" button already shipped on `BrandGroup.tsx` in Task 236), now
   shown regardless of tab type.
2. **Capability:** hide/show a platform the tab *already tracks* only. A
   hardcoded tab can never gain a platform it has never had columns for —
   the checkbox list itself is built from the tab's real, unfiltered
   platform set, never a free choice of all 4.
3. **Mechanism stays separate from the dynamic-tab one.** Dynamic tabs keep
   using `custom_tabs.platforms` + column regeneration (Task 236, unchanged)
   — that mechanism also controls which columns exist at all for a brand
   new tab, which hardcoded tabs don't need since their columns are fixed
   forever. Hardcoded tabs get a new, purely-visibility overlay instead of
   being migrated onto the dynamic-tab mechanism.
4. **Access:** same gate as everything else on this button — any approved
   user (`isApproved`), not admin-only.
5. **Out of scope, documented not fixed:** Ask AI's independent platform
   logic (`ai-assistant/tools.ts`) won't reflect a hidden platform in this
   pass — it never consulted `getTabPlatforms` to begin with, so this isn't
   a regression, just an existing gap this task doesn't close. The
   Duplicate-row modal's field selection (`hasMultiPlatform`) is unrelated
   (checks column existence, not visibility) and is untouched.

## Data model

New table `tab_hidden_platforms` — a row's existence means that platform is
currently hidden for that tab (same shape as `removed_platform_brands` /
`schedule_hidden_brands`, both already in this project):

```sql
create table tab_hidden_platforms (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  platform   text not null check (platform in ('tp','ag','cg','wo')),
  hidden_by  text,           -- actor email, same pattern as custom_tabs.created_by
  hidden_at  timestamptz not null default now(),
  unique (tab, platform)
);
```

Full 4-policy RLS shape this project always uses for a new table (anyone can
read; approved users can insert, update, delete) even though the UI only
ever exercises select/insert/delete — matching `custom_tabs`' own precedent.

No FK from `tab` to anything — a hardcoded tab's identity is a free-text
string here exactly like everywhere else in this project (`entries.tab`,
`custom_tabs.name`).

## Core change: `getTabPlatforms`

`tab-configs.ts` gains a small in-memory registry, `hiddenTabPlatforms:
Record<string, Set<Platform>>`, populated the same way
`dynamicTabColumns` already is:

- `registerHiddenTabPlatforms(rows: { tab: string; platform: Platform }[]): void`
- `resetHiddenTabPlatforms(): void` (mirrors `resetDynamicTabs`, for the
  per-invocation Edge Function reset)

`getTabPlatforms(tab)` keeps its existing logic to compute the real,
unfiltered platform list, then filters out anything present in
`hiddenTabPlatforms[tab]` before returning. A tab with no hidden rows is a
byte-for-byte no-op — this is what makes the change safe to ship against 11
tabs' worth of real production data: nothing changes for any tab until a
user explicitly hides something on it.

A second, unfiltered getter (`getTabPlatformsUnfiltered`, or equivalent
internal refactor exposing the pre-filter list) is needed for the Edit
Platforms modal itself — it must always offer the tab's *real* platform set
as checkboxes, including ones currently hidden, so a hidden platform can be
un-hidden again.

Because `getTabPlatforms` is the one function every real consumer already
calls (see list above), this reaches Sidebar's icon list, Schedule Planner's
generation/chip display, Overview's per-tab badges, Topbar, the Edit Entry
modal's field list, and the `generate-weekly-schedule` Edge Function's
scheduling input — all with zero further call-site changes, the same
"mutate the one shared thing" pattern Task 232 already used successfully.

## Loading

- **Frontend:** `AuthContext.tsx`'s existing session-bootstrap `Promise.all`
  (which already fetches `custom_tabs` and calls `registerDynamicTabs`)
  gains a second parallel fetch of `tab_hidden_platforms`, same fail-open
  `.catch(() => [])` pattern, feeding `registerHiddenTabPlatforms`.
- **Edge Functions:** `generate-weekly-schedule` already fetches
  `custom_tabs` and calls `resetDynamicTabs()`/`registerDynamicTabs()` once
  per invocation (Deno isolates are reused, so state must be rebuilt fresh
  every time). It gains the equivalent `resetHiddenTabPlatforms()` +
  fetch-and-`registerHiddenTabPlatforms()` calls alongside those, so a
  hidden platform is respected by the weekly cron once that function is
  actually deployed (it remains undeployed today — a pre-existing, already
  documented pending-deploy item, not something this task changes).
  `ai-assistant` doesn't import `tab-configs.ts` at all, so nothing to wire
  there (matches decision 5).

## UI

The pencil "Edit Platforms" button (`BrandGroup.tsx`) drops its
`isDynamicTab(decodedTab)` gate — shown for every tab, gated only on
`isApproved`. The existing `EditBrandTabPlatformsModal` gains a second mode:

- **Dynamic tab** (`isDynamicTab(tab)` true): unchanged from Task 236 —
  checkboxes seeded from `getTabPlatforms(tab)`, save calls
  `updateCustomTabPlatforms` + `registerDynamicTabs`.
- **Hardcoded tab:** checkboxes seeded from the *unfiltered* getter
  (showing every platform the tab has ever had columns for, including
  currently-hidden ones), pre-checked = not currently in the hidden set.
  Saving diffs the checked state against the tab's real platform set and,
  for each platform whose checked-state changed, calls a new
  `setTabPlatformHidden(tab, platform, hidden: boolean)` (insert to hide /
  delete to un-hide). At least one platform must stay visible — same
  "can't go to zero" guard as the dynamic-tab modal already enforces.

Both branches call the existing `notifyDynamicTabsChanged`-style event
(renamed `tab-platforms-changed`, since it no longer only fires for dynamic
tab creation/deletion) after a successful save, so `Sidebar.tsx`'s existing
listener refreshes its icon list live for a hardcoded tab's hide/unhide too,
with no further Sidebar changes needed.

## Testing

- Unit tests for `fetchHiddenTabPlatforms`/`setTabPlatformHidden` in
  `queries.test.ts`, mirroring the existing `custom_tabs` query tests.
- Unit tests in `tab-configs.test.ts`: registering a hidden platform filters
  it out of `getTabPlatforms`; unregistering restores it; a tab with zero
  hidden rows returns the exact same list as today for all 11 hardcoded
  tabs (regression lock — this is the test that proves the "no-op by
  default" safety claim above); the unfiltered getter always returns the
  real set regardless of hidden state.
- Full existing suite + `npm run build` must still pass.
- Live verification (per this project's standing bar for UI changes): hide
  a platform on a real hardcoded tab — confirm it disappears from that
  tab's KPI cards, table columns, Check Status dropdown, and the Sidebar's
  icon list without a reload; un-hide it and confirm full restoration.
  Given the blast radius (11 tabs' worth of live production data reachable
  through one shared function), verify on a tab whose data won't be
  disrupted if something goes wrong — prefer a low-entry-count tab (e.g.
  the disposable "Testing" tab used for Task 236's own verification, if it
  still has a hideable platform) over a high-traffic one like Rooster
  Partners, and restore state afterward either way.

## Non-goals

- Adding a platform a hardcoded tab has never tracked before (no column
  generation for hardcoded tabs — their schema is permanently fixed).
- Migrating the 11 hardcoded tabs onto the `custom_tabs`/dynamic-tab
  mechanism.
- Propagating a hidden platform into Ask AI's answers (`ai-assistant`
  doesn't consult `getTabPlatforms` today; out of scope here).
- Changing `hasMultiPlatform`/the Duplicate-row modal's field selection.
