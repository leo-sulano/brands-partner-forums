# Brand Tab Rename + Customizable Toolbar Filters

**Requested by:** Leo, via chat — on the existing "Edit Platforms" pencil
button (`BrandGroup.tsx`), asked for two additions: (1) the tab's own name
becomes editable, not just its platforms; (2) which filter dropdowns appear
on a tab's toolbar (Brand/Agent/Proxy/Country/Status/Platform) becomes
selectable, both when editing an existing tab and when creating a new one via
"+ Add Brand Tab". Scope narrowed interactively — see decisions below.

## Current behavior (for reference)

- The pencil "Edit Platforms" button (`BrandGroup.tsx`) is shown for every
  tab (`isApproved` gate only, per Task 237/hardcoded-tab-platform-visibility)
  and opens `EditBrandTabPlatformsModal`, which lets a user toggle which
  platforms (TP/AG/CG/WO) a tab tracks — for a dynamic tab via
  `custom_tabs.platforms` + column regeneration (Task 236), for a hardcoded
  tab via the `tab_hidden_platforms` visibility overlay (Task 237). Neither
  path touches the tab's *name*.
- `AddBrandTabModal` creates a new dynamic tab (`custom_tabs` row) with a name
  and a platform set. Once created, a dynamic tab's name is permanent — there
  is no rename path anywhere in the app today.
- A dynamic tab's name is not just a display label — it is the literal
  string key stored in `custom_tabs.name` and the `tab` column of every other
  tab-scoped table: `entries`, `tab_schemas`, `brand_schedule`,
  `brand_platform_pause`, `brand_platform_override`, `flagged_platform_brands`,
  `removed_platform_brands`, `schedule_hidden_brands`,
  `schedule_platform_restrictions`, `schedule_pms_links`,
  `tab_hidden_platforms`, plus the historical `delete_log`/`edit_log` (both
  have a nullable `tab` column used to attribute a logged change to a tab).
  It is also the input to `tabToSlug()`, which derives the tab's URL.
- `BrandGroup.tsx`'s toolbar shows up to 6 `MultiSelectDropdown` filters —
  Brand, Agent, Proxy, Country, Status, Platform. Today each one (except
  Status) auto-hides individually based on live data cardinality (e.g.
  `uniqueBrands.length > 1`); there is no way to configure which filters a
  tab's toolbar offers independent of its data.

## Decisions (confirmed interactively)

1. **Rename scope: dynamic tabs only.** Renaming one of the 11 hardcoded tabs
   would mean migrating its name across the same tables listed above, but
   those tables also hold `entries.tab` values imported over months of real
   history under a name baked into `TAB_COLUMN_CONFIGS`, PMS integrations,
   and icon maps (`tabIcons.ts`) — out of scope. Hardcoded tabs keep their
   permanent names.
2. **Rename mechanics: cascade everywhere, atomically.** A rename updates
   `custom_tabs.name` and the `tab` column of every dependent table in one
   transaction, rather than either leaving history behind under the old name
   or blocking rename once a tab has real data.
3. **Toolbar filter customization: all tabs, hardcoded + dynamic.** Unlike
   rename, this carries no cascade risk — it is a simple visibility overlay
   (same shape as `tab_hidden_platforms`), so it ships uniformly through the
   same pencil button already used by every tab.
4. **Filter customization semantics: explicit allow-list, layered on top of
   the existing auto-hide rule.** A filter left off a tab's allow-list never
   shows, even if the data would otherwise support it. A filter left on can
   still auto-hide if the tab's live data has fewer than 2 distinct values —
   the allow-list narrows what's possible, it doesn't force a dropdown to
   show for data that can't support it.
5. **Migration default: all 6 filters enabled for every tab that has never
   been customized.** No backfill row is written for any existing tab — the
   table stays sparse (mirroring `tab_hidden_platforms`), and "no row" means
   "all 6 enabled," so no tab's toolbar changes on deploy day.
6. **UI: one combined "Edit Brand Tab" modal**, not a separate rename modal.
   `EditBrandTabPlatformsModal` broadens (and is renamed) into
   `EditBrandTabModal`, gaining a "Tab name" field and a "Toolbar Filters"
   checkbox group alongside its existing "Platforms" section.
7. **Access:** same gate as everything else on this button/modal — any
   `isApproved` user, not admin-only.

## Data model

### New table: `tab_toolbar_filters`

Sparse opt-in overlay, same shape as `tab_hidden_platforms` — a row's
existence means that tab's toolbar is restricted to exactly the filters
listed; no row means all 6 are allowed (still subject to per-filter
auto-hide).

```sql
create table tab_toolbar_filters (
  tab              text primary key,
  enabled_filters  text[] not null,
  updated_by       text,
  updated_at       timestamptz not null default now(),
  constraint tab_toolbar_filters_valid_keys check (
    enabled_filters <@ array['brand','agent','proxy','country','status','platform']::text[]
  )
);
```

Full 4-policy RLS shape this project always uses for a new table (anyone can
read; approved users can insert, update, delete).

No FK from `tab` to `custom_tabs` — a hardcoded tab's identity is a free-text
string here exactly like `tab_hidden_platforms.tab`/`entries.tab`.

### New RPC: `rename_custom_tab(old_name text, new_name text)`

```sql
create or replace function public.rename_custom_tab(old_name text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;

  if not exists (select 1 from public.custom_tabs where name = old_name) then
    raise exception '"%" is not a custom tab', old_name;
  end if;
  if exists (select 1 from public.custom_tabs where name = new_name) then
    raise exception 'a tab named "%" already exists', new_name;
  end if;

  update public.custom_tabs set name = new_name where name = old_name;

  -- Every other table keyed by a free-text `tab` column gets the same
  -- rename, discovered via information_schema rather than a hardcoded
  -- list — this project has already renamed tab-scoped tables/columns
  -- more than once (removed_tp_brands -> removed_platform_brands,
  -- flagged_platform_brands added alongside it), and a hardcoded list
  -- here would silently stop covering a newly added table.
  for rec in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'tab'
      and table_name <> 'custom_tabs'
  loop
    execute format('update public.%I set tab = $1 where tab = $2', rec.table_name)
      using new_name, old_name;
  end loop;
end;
$$;

grant execute on function public.rename_custom_tab(text, text) to authenticated;
```

`tab_schemas` (primary key `tab`, not `id`) is covered by the same loop since
its column is also named `tab` — `update ... set tab = $1 where tab = $2`
works identically against a PK column.

## Frontend changes

### `queries.ts`

- `renameCustomTab(oldName: string, newName: string): Promise<void>` — calls
  `supabase.rpc('rename_custom_tab', { old_name: oldName, new_name: newName })`,
  translating a raised exception's message into a thrown `Error` the modal can
  display (same pattern `createCustomTab` already uses for the `23505`
  unique-violation case).
- `createCustomTab` gains an `enabledFilters?: ToolbarFilterKey[]` param,
  passed through to seed `tab_toolbar_filters` in a second insert — only
  performed when the selection differs from all-6-default, keeping the table
  sparse. A failure on this second insert must not roll back the tab
  creation that already succeeded; report it as a non-fatal warning the same
  way other best-effort follow-up writes in this codebase already do (e.g.
  `pushScheduleActivations`'s fire-and-forget posture).
- `fetchToolbarFilters(client): Promise<{ tab: string; enabled_filters: string[] }[]>`
  and `setToolbarFilters(tab, filters): Promise<void>` (upsert), mirroring
  `fetchHiddenTabPlatforms`/`setTabPlatformHidden`.

### `tab-configs.ts`

- `ToolbarFilterKey = 'brand' | 'agent' | 'proxy' | 'country' | 'status' | 'platform'`
- `ALL_TOOLBAR_FILTERS: ToolbarFilterKey[]` (the 6 keys, single source of
  truth for both modals' checkbox lists).
- In-memory registry `toolbarFilterOverrides: Record<string, Set<ToolbarFilterKey>>`,
  populated the same way `hiddenTabPlatforms` already is.
- `getEnabledToolbarFilters(tab): ToolbarFilterKey[]` — returns
  `[...ALL_TOOLBAR_FILTERS]` if the tab has no override row, else the tab's
  own list. `registerToolbarFilters`/`unregisterToolbarFilters` mirror the
  existing hidden-platforms registry functions.

### `dynamicTabRegistry.ts`

- `renameDynamicTab(oldName, newName, platforms)`: removes the old key from
  `dynamicTabColumns`/`OPERATIONAL_TABS`, adds the new one (reusing
  `buildDynamicTabColumns`), and fires the existing `tab-platforms-changed`
  event — the in-memory equivalent of `unregisterDynamicTab` +
  `registerDynamicTabs` done atomically so no intermediate render sees the
  tab missing entirely.

### `EditBrandTabModal.tsx` (renamed from `EditBrandTabPlatformsModal.tsx`)

- New "Tab name" field at the top. Editable only when `isDynamicTab(tabName)`;
  for a hardcoded tab it renders as read-only text with a one-line note
  ("Hardcoded tabs can't be renamed"). Reuses `AddBrandTabModal`'s existing
  validation (collision with `OPERATIONAL_TABS`/`TAB_COLUMN_CONFIGS`, slug
  collision, forbidden `/?#` chars) — factor that validation out of
  `AddBrandTabModal` into a small shared helper (e.g.
  `validateNewTabName(name): string | null`) so the two call sites can't
  drift.
- Existing "Platforms" section unchanged.
- New "Toolbar Filters" checkbox group (`ALL_TOOLBAR_FILTERS`, all tabs),
  seeded from `getEnabledToolbarFilters(tabName)`.
- Save flow: if the name changed, call `renameCustomTab` first (before any
  platform/filter writes, which must target the *new* name), then
  `renameDynamicTab` to update the in-memory registry, then navigate the
  page to `/brands/${tabToSlug(newName)}` — the current URL still points at
  the old slug. Platform and filter changes then proceed exactly as today,
  against whichever name is now current. A failure at any step surfaces via
  the modal's existing error state; a rename failure specifically must not
  proceed to platform/filter writes against a name that was never actually
  applied.

### `AddBrandTabModal.tsx`

- New "Toolbar Filters" checkbox group (`ALL_TOOLBAR_FILTERS`, default: all
  checked), passed to `createCustomTab`.
- Reuses the shared `validateNewTabName` helper described above instead of
  its own inline checks (no behavior change, just deduplication once the
  rename modal needs the identical logic).

### `BrandGroup.tsx`

Each of the 6 toolbar `MultiSelectDropdown` blocks gets an added
`enabledFilters.includes('brand')`-style guard (via
`getEnabledToolbarFilters(decodedTab)`) alongside its existing condition:

```tsx
{uniqueBrands.length > 1 && !NO_BRAND_FILTER_TABS.has(decodedTab)
  && enabledFilters.includes('brand') && (
  <MultiSelectDropdown ... />
)}
```

Status's dropdown (currently unconditional) gains the same
`enabledFilters.includes('status')` guard as its only condition, since it has
no existing cardinality check to layer onto.

### Loading (`AuthContext.tsx` / `generate-weekly-schedule`)

- `AuthContext.tsx`'s existing bootstrap `Promise.all` gains a parallel fetch
  of `tab_toolbar_filters`, same fail-open `.catch(() => [])` pattern as
  `custom_tabs`/`tab_hidden_platforms`, feeding
  `registerToolbarFilters`. `tab_toolbar_filters` and `rename_custom_tab`
  are both purely frontend-facing config (toolbar rendering, a client-side
  modal action) — `generate-weekly-schedule` and `ai-assistant` never render
  a toolbar or need to resolve a tab's current name mid-invocation, so
  neither Edge Function needs any changes for this feature.

## Error handling

- **Rename collision:** `rename_custom_tab` raises before mutating anything
  if `new_name` is already taken by another `custom_tabs` row; client-side
  validation catches the far more common case (collision with a hardcoded
  tab name, or a slug collision) before the RPC is ever called.
- **Rename mid-flight failure:** the RPC's `security definer` transaction
  means a failure partway through the introspection loop rolls back
  everything — no table is left with a mismatched tab name relative to the
  others.
- **Toolbar filter write failure:** does not block or roll back a rename or
  platform-set change saved in the same modal submission — each is its own
  independent write, matching this app's established "a sync-adjacent
  write's failure surfaces as its own error, not a rollback of the primary
  action" posture.
- **Zero enabled filters:** the modal must allow saving zero filters checked
  (a tab whose toolbar shows no filter dropdowns at all is a valid, if
  unusual, configuration) — unlike Platforms, there is no "at least one"
  floor here, since a toolbar with no filters just means unfiltered browsing,
  not a broken tab.

## Testing

- Unit tests in `queries.test.ts` for `renameCustomTab` (success, collision
  error message, not-approved rejection surfaced) and
  `fetchToolbarFilters`/`setToolbarFilters`, mirroring existing
  `custom_tabs`/`tab_hidden_platforms` test coverage.
- Unit tests in `tab-configs.test.ts`: a tab with no override row returns all
  6 filter keys; registering/unregistering an override narrows/restores the
  list; `ALL_TOOLBAR_FILTERS` stays the single source both modals read from.
- Unit tests in `dynamicTabRegistry.test.ts` for `renameDynamicTab`:
  `OPERATIONAL_TABS` reflects the new name and not the old one in the same
  synchronous call, columns carry over unchanged.
- A `validateNewTabName` unit test suite covering the collision/slug/char
  cases already covered informally by `AddBrandTabModal`'s inline comments,
  now centralized.
- Full existing suite + `npm run build` must still pass.
- Live verification (per this project's standing bar for UI changes),
  against a low-traffic dynamic tab created for this purpose (not an
  existing production tab with real entries, given the number of tables a
  rename touches):
  1. Create a throwaway dynamic tab with a couple of unchecked toolbar
     filters via the updated `AddBrandTabModal`; confirm its toolbar shows
     only the checked filters immediately after creation.
  2. Add a couple of entries to it, then rename it via the updated modal;
     confirm the URL updates, the Sidebar link updates with no reload, the
     entries are still visible under the new name, and Schedule
     Planner/Score Summary (if the tab has any schedule/score data) still
     resolve it correctly.
  3. Edit its toolbar filters again post-rename to confirm the override row
     followed the rename (not left behind keyed to the old name — this is
     the one thing the information_schema loop's atomicity claim above needs
     to actually prove live).
  4. Toggle filters on a real hardcoded tab (e.g. a low-entry-count one) to
     confirm the allow-list correctly suppresses a dropdown regardless of
     that tab's real data cardinality, then restore it to all-6 afterward.
  5. Delete the throwaway tab via the existing delete flow to clean up.

## Non-goals

- Renaming any of the 11 hardcoded tabs.
- A rename UI/RPC for anything other than a `custom_tabs`-backed dynamic tab
  (e.g. no generic "rename any free-text key" utility).
- Custom, user-defined filter types beyond the existing 6 (Brand, Agent,
  Proxy, Country, Status, Platform) — this is a visibility allow-list over
  the fixed existing set, not a new filter-builder.
- Propagating tab renames or toolbar-filter state into Ask AI
  (`ai-assistant/tools.ts`) — it does not read `tab-configs.ts`'s filter
  registry and has no toolbar of its own to configure.
- Changing the existing per-filter auto-hide-on-sparse-data thresholds.
