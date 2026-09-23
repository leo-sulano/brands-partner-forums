# Brand Rename + Editable Brand Links — Design

Date: 2026-09-23 · Tier 3 (touches brand keys shared by every dashboard surface)

## Goal

Let an approved user rename a brand and edit its per-platform page links, with the
new name/links showing up everywhere (Brand Tabs, Overview, Score Summary, Schedule
Planner, Ask AI, Check Status scoping) with no orphaned data.

## Decisions (agreed with user)

| Question | Decision |
|---|---|
| Rename from Edit Entry | Global brand rename (same action as Edit Brand Tab), not a per-entry reassign |
| Tab scope of a rename | **Every tab** carrying that brand name |
| Which links are editable | One link per platform enabled on the tab (TP / AG / CG / WO) |
| Rename to a name that already exists | **Blocked** with an error — never a silent merge. Case-only changes allowed |
| Existing PMS cards | Titles keep the old name (external history); their links keep working since `schedule_pms_links.brand` is renamed |

## Background — where a brand name lives today

A brand has no ID. Its name is the key, stored in:

1. `entries.data` — under whichever of `BRAND_COLS` (`Brands`, `Brand Name`, `Brand`,
   `Brand / TP URL PAGE`, …) the tab uses.
2. Every public table with a `brand text` column: `brand_catalog`, `brand_schedule`,
   `brand_platform_override`, `removed_tp_brands` (generalized removed-platform flags),
   `removed_custom_platform_brands`, `schedule_hidden_brands`/visibility,
   `brand_agent_assignments`, `schedule_cancellations`, `schedule_manual_pauses`,
   `schedule_pms_links`, `full_check_removed_entries`, etc. Most have a generated
   `brand_key = lower(btrim(brand))` with `unique (tab, brand_key …)`.
3. Hardcoded code maps keyed by lowercased brand name: `BRAND_TP_URLS`,
   `TAB_BRAND_URLS`, `BRAND_AG_URLS`, `BRAND_CG_URLS`, `TAB_DEFAULT_BRAND`
   (`src/lib/tab-configs.ts`). These are link *fallbacks* used when an entry's link
   column is empty.

## Approach

A single atomic Postgres RPC, modeled on `rename_hardcoded_tab`
(20260901180000): discover brand-keyed tables via `information_schema` so a future
table is covered automatically. Rejected: client-side multi-step updates (non-atomic,
partial-failure drift) and a brand-ID refactor (too large for this need).

## 1. Database

### `rename_brand(old_name text, new_name text) returns int` (new migration)

- `security definer`, `search_path = public`, raises `'not approved'` unless
  `is_approved()`.
- Trims `new_name`; raises on empty.
- Match is on `lower(btrim(x)) = lower(btrim(old_name))`.
- **Collision guard:** if `lower(btrim(new_name)) <> lower(btrim(old_name))` and any
  entry (any `BRAND_COLS` key) or any `brand`-column row already matches `new_name`,
  raise `'a brand named "%" already exists'`. Nothing changes.
- **Entries:** for each key in the `BRAND_COLS` list (passed as a constant array in
  the SQL, kept in sync with `tab-configs.ts` by a Vitest test that reads the
  migration), update `data = jsonb_set(data, '{key}', to_jsonb(new_name))` where that
  key's value matches. Before updating, insert one `edit_log` row per changed entry
  (`entity_type='entry'`, `before_data` = old data, actor from `auth.uid()`/email) —
  same audit trail as a normal entry edit.
- **Other tables:** loop `information_schema.columns` where
  `column_name = 'brand'` and `table_schema = 'public'`, **excluding** history/log
  tables (`full_check_removed_entries`, `delete_log`, `edit_log`, `tab_archive_log`),
  and run `update … set brand = $1 where lower(btrim(brand)) = lower(btrim($2))`.
  `brand_key` recomputes itself.
- Returns the number of entries changed.
- Grant execute to `authenticated`.

### `count_brand_usage(name text) returns table(entries int, tabs int)`

Read-only helper powering the confirm dialog ("N entries across M tabs").

### Links — no new RPC

Link writes are plain entry updates, done by a new `queries.ts` function (below)
against the existing entries RLS, plus `brand_catalog.link` for the TP link.

## 2. Data access (`src/lib/queries.ts`)

- `renameBrand(oldName, newName)` → calls the RPC, returns changed count; surfaces
  the collision error message verbatim.
- `fetchBrandUsage(name)` → `count_brand_usage`.
- `setBrandLinks(brand, links: Partial<Record<'tp'|'ag'|'cg'|'wo', string>>)` →
  for every entry of that brand on every tab, writes each provided link into that
  tab's column: TP → `getBrandLinkCol(tab)` (skipping `'Link to the profile'`, which
  is WO's), AG → `AG Review Link`, CG → `CG Review Link`, WO → `Link to the profile`
  (WO tab only). Also upserts `brand_catalog.link` for the TP value. Logged to
  `edit_log` per changed entry like the existing entry-update path.
- New pure helper in `tab-configs.ts`: `brandLinkColumnFor(tab, platform)` — the one
  place that maps (tab, platform) → entry column, unit-tested.

### Preserving hardcoded fallback links on rename

Because the fallback maps are keyed by the old name, a rename would silently drop a
brand's fallback link. Before calling `rename_brand`, the client resolves each
enabled platform's current effective link (entry value, else `getBrandTpUrl` /
`getBrandAgUrl` / `getBrandCgUrl`) and, for any entry where the column is empty,
writes it via `setBrandLinks`. After that no entry depends on the old-name fallback.
`TAB_DEFAULT_BRAND` only applies when a tab has zero brands, so it is unaffected in
practice; documented, not changed.

## 3. UI

### Edit Brand Tab — new "Brands" section

- Lists every brand on the tab (the modal's existing `brands` / `localBrands` list,
  including catalog-only brands).
- Each row: name input + one link input per platform enabled on the tab
  (`getTabPlatforms`), pre-filled with the brand's effective link, and a per-row
  **Save** button (enabled only when that row is dirty).
- Saving a changed name opens a confirm: *"Rename 'Librabet Casino' → 'Librabet' on
  N entries across M tabs?"* Then: preserve fallbacks → `renameBrand` → `setBrandLinks`
  (if links also changed) → parent reload (existing `onBrandAdded`-style callback).
- Link-only changes save straight away (no confirm), then reload.
- Errors (collision, RLS) show inline on that row; the row stays dirty.
- The section is independent of the modal's main "Save Changes" button (which keeps
  saving tab name/platforms/status only).

### Edit Entry — rename affordance

- A pencil button next to the Brand Name chip opens an inline input + Save, using
  the same confirm + `renameBrand` flow. On success the modal's form value updates to
  the new name and the parent table reloads.
- The existing chip/picker behavior (assign this entry to a different existing brand)
  is unchanged.

A small shared component `BrandRenameConfirm` holds the confirm dialog + call
sequence so both modals behave identically. New dialogs use `BrandTabsModal`'s
`useEffect` Escape-key pattern (known Escape bug in older modals).

## 4. Cross-dashboard consistency

- Overview, Score Summary, Brand Tabs, Schedule Planner, Check Status scoping, and
  Ask AI all read brand names from `entries` + the tables above at query time, so they
  show the new name after reload. The implementation must grep
  `supabase/functions/ai-assistant/tools.ts` and `supabase/functions/*` for hardcoded
  brand-name maps and update them (with tests) if any exist.
- `pausedTabRegistry`/tab-level structures are keyed by tab, unaffected.
- **Accepted side effects:**
  - External PMS card titles keep the old name.
  - EC2 `schedule_groups.py` hashes `(tab, brand)` for the check rotation, so a
    renamed brand may move to a different rotation week.
  - History tables (`delete_log`, `edit_log`, `tab_archive_log`,
    `full_check_removed_entries`) keep the old name as it was at the time.
  - Any browser `localStorage` brand filters holding the old name simply stop
    matching; users re-pick.

## 5. Testing & verification

- Vitest: `brandLinkColumnFor` mapping per tab/platform; `BRAND_COLS` ↔ migration
  constant sync test; `renameBrand`/`setBrandLinks` query shapes (mocked supabase).
- `npm run build` (not `tsc --noEmit`).
- Live RPC check on a scratch catalog-only brand: rename, query every `brand` table
  + entries for old/new counts, test collision error, rename back.
- Visual check of both modals.
- Final whole-branch review for cross-dashboard drift before merge.

## Out of scope

- Merging two brands.
- Renaming brands in external PMS card titles.
- A brand-ID model.
