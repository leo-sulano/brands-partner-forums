# Hardcoded Brand Tab Rename — Design

## Problem

Edit Brand Tab currently lets a *dynamic* (`custom_tabs`-backed) tab be renamed in place — the
tab's real identity (DB rows, URL slug, `OPERATIONAL_TABS` entry) all move atomically via the
`rename_custom_tab` RPC. The 11 *hardcoded* tabs (keys of `TAB_COLUMN_CONFIGS` in
`src/lib/tab-configs.ts`) show a locked box instead: "Hardcoded tabs can't be renamed." A user
editing e.g. BITP (`TP Brand Injection`, 536 live entries) has no way to change the name at all.

This is a **true full rename**, not a cosmetic label swap: the tab's real name (as stored in
`entries.tab` and every other tab-keyed table, and as reflected in its URL slug) changes, exactly
like a dynamic tab rename does today.

## Why this is architectural, not bounded

`TAB_COLUMN_CONFIGS`'s keys are literal source-code identifiers, re-used as literal keys or
string-equality checks in roughly 15 other places across the frontend (see "Touch list" below).
None of those can have their source-code key renamed without a code change + deploy. Making a
hardcoded tab's *live* name mutable therefore requires decoupling "the permanent internal identity
a data key" from "the current name shown to and edited by users" — a new indirection layer, not a
one-file fix.

## Core mechanism

**The original `TAB_COLUMN_CONFIGS` key never changes.** It becomes the tab's permanent internal
identity. A new mapping from that permanent key to the tab's *current live name* is introduced,
DB-backed so it survives reloads and is shared across sessions/edge functions, mirroring the
existing `tab_icon_overrides` precedent (a table "keyed by tab name... because hardcoded tabs have
no `custom_tabs` row").

### New table: `hardcoded_tab_renames`

```sql
create table public.hardcoded_tab_renames (
  original_name text primary key,   -- the permanent TAB_COLUMN_CONFIGS key, never changes
  current_name  text not null unique, -- the tab's live name today; starts equal to original_name
  updated_by    text,
  updated_at    timestamptz not null default now()
);
```

Same 4-policy RLS shape as `tab_icon_overrides`/`tab_toolbar_filters` (anyone can read; approved
users can insert/update/delete). A hardcoded tab that has never been renamed has **no row** in this
table at all (same "absent = default" convention `hiddenTabPlatforms`/`toolbarFilterOverrides`
already use) — the resolver below treats "no row" as "current name == original name."

### New RPC: `rename_hardcoded_tab(old_name text, new_name text)`

A sibling to the existing `rename_custom_tab` RPC — **not** a modification of it, since every
existing dynamic-tab rename already depends on that function working exactly as it does today.
Reuses the same `information_schema`-driven "find every table with a `tab` text column and rewrite
it" technique:

```sql
create or replace function public.rename_hardcoded_tab(old_name text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_original text;
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;

  -- Resolve old_name to its permanent original key: if old_name is already
  -- someone's current_name, reuse that row's original_name (this is at
  -- least the second rename of this tab); otherwise old_name IS the
  -- original key (first-ever rename).
  select original_name into v_original
  from public.hardcoded_tab_renames
  where current_name = old_name;

  if v_original is null then
    v_original := old_name;
  end if;

  if exists (select 1 from public.hardcoded_tab_renames where current_name = new_name)
     or exists (select 1 from public.custom_tabs where name = new_name) then
    raise exception 'a tab named "%" already exists', new_name;
  end if;

  insert into public.hardcoded_tab_renames (original_name, current_name)
  values (v_original, new_name)
  on conflict (original_name) do update set current_name = excluded.current_name, updated_at = now();

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

grant execute on function public.rename_hardcoded_tab(text, text) to authenticated;
```

Note this RPC does **not** independently validate that `old_name` really is one of the 11
hardcoded tabs — same trust boundary `rename_custom_tab` already accepts (it trusts the frontend's
`validateNewTabName` for name-shape/collision checks and only enforces its own narrower
invariants). The frontend never calls this RPC for a tab it doesn't already know is hardcoded.

### New frontend registry: `src/lib/hardcodedTabRenameRegistry.ts`

Dependency-free (no React/npm imports), mirroring `tabIconOverrideRegistry.ts` exactly, so it's
safe to import from Deno edge functions and from `tab-configs.ts`/`tabs.ts`/`tabIcons.ts` without
creating an import cycle (none of those modules are imported *by* this one).

```ts
const originalToCurrentMap: Record<string, string> = {};
const currentToOriginalMap: Record<string, string> = {};

export function registerHardcodedTabRenames(
  rows: { original_name: string; current_name: string }[],
): void {
  for (const row of rows) {
    originalToCurrentMap[row.original_name] = row.current_name;
    currentToOriginalMap[row.current_name] = row.original_name;
  }
}

// Called locally right after a successful rename_hardcoded_tab RPC call, the
// same "server call, then local registry update" two-step every other
// tab-scoped registry in this codebase already uses.
export function renameHardcodedTabLocally(oldCurrentName: string, newCurrentName: string): void {
  const original = currentToOriginalMap[oldCurrentName] ?? oldCurrentName;
  delete currentToOriginalMap[oldCurrentName];
  currentToOriginalMap[newCurrentName] = original;
  originalToCurrentMap[original] = newCurrentName;
}

// The one function every hardcoded-name-keyed map lookup in the codebase
// must resolve `tab` through before indexing. A no-op passthrough for any
// tab never renamed (the common case for 9 of the 11 hardcoded tabs, and
// every dynamic tab).
export function resolveHardcodedTabKey(tab: string): string {
  return currentToOriginalMap[tab] ?? tab;
}

// True once `tab` (a live/current name) is known to be the result of at
// least one real rename — used by tabDisplayName() to let a true rename
// supersede the older TAB_DISPLAY_NAMES cosmetic-alias mechanism (see
// "Interaction with TAB_DISPLAY_NAMES" below).
export function isRenamedHardcodedTab(tab: string): boolean {
  return tab in currentToOriginalMap;
}
```

### `src/lib/queries.ts`

New `fetchHardcodedTabRenames`/`renameHardcodedTab` functions, mirroring the existing
`fetchTabIconOverrides`/`renameCustomTab` shape exactly (plain `supabase.from(...).select(...)` /
`supabase.rpc('rename_hardcoded_tab', { old_name, new_name })`).

### `src/lib/tabs.ts`

New `renameOperationalTab(oldName: string, newName: string): void` — an in-place `OPERATIONAL_TABS`
splice, structurally identical to `dynamicTabRegistry.ts`'s existing `renameDynamicTab`'s splice
logic (find index of `oldName`, replace with `newName` at the same position, so sidebar/nav order
is preserved). This is what lets all ~12 existing `OPERATIONAL_TABS` importers (Sidebar, Overview,
Score Summary, Schedule Planner, both entry modals, BrandGroup) pick up a hardcoded rename with
zero call-site changes — the same guarantee dynamic tabs already have.

`tabToSlug`'s `SLUG_OVERRIDES` lookup and `tabDisplayName`'s `TAB_DISPLAY_NAMES` lookup both need
to resolve through `resolveHardcodedTabKey` first (see the full touch list below).

### `AuthContext.tsx` bootstrap

Gains one more parallel fetch, alongside the existing `tab_icon_overrides`/`custom_tabs`/
`tab_toolbar_filters`/`paused_tabs`/`tab_hidden_platforms` fetches: `fetchHardcodedTabRenames()` →
`registerHardcodedTabRenames(...)`.

### Edge functions

Any Deno function that imports `tab-configs.ts`'s getters or `tabIcons.ts` and needs to see a
renamed hardcoded tab must, per invocation, fetch `hardcoded_tab_renames` and call
`registerHardcodedTabRenames` — the same "gotcha" already documented for `dynamicTabRegistry.ts`'s
self-registration side effect. Concretely this is `generate-weekly-schedule` (the only such
function today). Verified `ai-assistant` and `review-removal-assessment` have **no** literal
hardcoded-tab-name checks — their only matches for tab-name strings were the unrelated
`wo: 'Wizard of Odds'` *platform display label* constant, not a tab-identity comparison — so they
need no changes.

## Interaction with `TAB_DISPLAY_NAMES` (the existing FTP/BITP cosmetic alias)

`tabs.ts` already has a narrower, pre-existing mechanism: `TAB_DISPLAY_NAMES` hardcodes `'TP
Affiliate' → 'FTP'` and `'TP Brand Injection' → 'BITP'` as a **display-only** rename — the tab in
this feature's originating screenshot. Left untouched, a true rename of `TP Brand Injection` would
otherwise get silently overridden back to "BITP" by this older mechanism at every `tabDisplayName`
call site (Sidebar, page titles, breadcrumbs) — the tab most likely to be the first one someone
tries this feature on.

Resolution: once a hardcoded tab has been truly renamed at least once, its live current name always
wins over `TAB_DISPLAY_NAMES` — no data migration, no change to `TAB_DISPLAY_NAMES` itself:

```ts
export function tabDisplayName(tab: string): string {
  if (isRenamedHardcodedTab(tab)) return tab;
  return TAB_DISPLAY_NAMES[tab as OperationalTab] ?? tab;
}
```

Until someone actually renames BITP or FTP, both continue behaving exactly as they do today.

## Full touch list (every hardcoded-name-keyed lookup needing `resolveHardcodedTabKey`)

All found by grepping for literal hardcoded tab-name strings across `src/` and
`supabase/functions/` and reading each hit in context.

| File | Symbol(s) | Change |
|---|---|---|
| `src/lib/tab-configs.ts` | `getTabColumns` (`TAB_COLUMN_CONFIGS[tab]`) | resolve `tab` first |
| `src/lib/tab-configs.ts` | `getColLabel` (`TAB_COLUMN_LABELS[tab]`) | resolve `tab` first |
| `src/lib/tab-configs.ts` | `getTabSequence`/`getTabSequenceCol` (`TAB_BRAND_SEQUENCE`/`TAB_SEQUENCE_COL`) | resolve `tab` first |
| `src/lib/tab-configs.ts` | `deriveTabBrands` (`TAB_DEFAULT_BRAND[tab]`) | resolve `tab` first |
| `src/lib/tab-configs.ts` | `getCountryForAccount` (`TAB_DEFAULT_COUNTRY[tab]`) | resolve `tab` first |
| `src/lib/tab-configs.ts` | `getBrandGroup` (`TAB_BRAND_GROUPS[tab]`) | resolve `tab` first |
| `src/lib/tab-configs.ts` | `getBrandTpUrl`/`resolveBrandLink` (`TAB_BRAND_URLS[tab]`) | resolve `tab` first |
| `src/lib/tab-configs.ts` | `getBrandLinkCol` (`tab === 'TP Brand Injection'` etc., 3 checks) | compare resolved key |
| `src/lib/tab-configs.ts` | `computeRawTabPlatforms` (`tab === 'Wizard of Odds'`, `tab in TAB_COLUMN_CONFIGS`) | compare resolved key |
| `src/lib/tabIcons.ts` | `resolveTabIconKind` (`TAB_ICONS[tab]`) | resolve `tab` first |
| `src/lib/tabs.ts` | `tabToSlug` (`SLUG_OVERRIDES[tab]`) | resolve `tab` first |
| `src/lib/tabs.ts` | `tabDisplayName` (`TAB_DISPLAY_NAMES[tab]`) | see rule above |
| `src/components/EditEntryModal.tsx` | 2× `currentTab === 'Wizard of Odds'` | compare resolved key |
| `src/components/AddReviewAccountModal.tsx` | 1× `selectedTab === 'Wizard of Odds'` | compare resolved key |

Every one of these functions already receives the tab's **current live name** as its `tab`
parameter (it comes from route params, `entries.tab`, or `OPERATIONAL_TABS`) — the only change is
inserting `const key = resolveHardcodedTabKey(tab);` and using `key` for the specific hardcoded-map
lookup, while continuing to use the original `tab` for anything about live identity (DB writes,
URL, display).

**Explicitly verified clean** (grepped, no literal hardcoded-tab-name identity checks found):
`scoreSummary.ts`, `scheduler/scheduleUtils.ts`, `dateUtils.ts`, `ai-assistant/tools.ts`,
`review-removal-assessment/index.ts` — these either operate on platform/column identity (already
rename-safe) or only contain the unrelated `wo: 'Wizard of Odds'` platform-label constant.

## Generic multi-table rewrite coverage

The RPC's `information_schema`-driven loop (identical technique to `rename_custom_tab`) covers
every table with a `tab` text column automatically — `entries`, `tab_schemas`,
`removed_platform_brands`, `brand_schedule`, `schedule_pms_links`, `schedule_hidden_brands`,
`schedule_platform_restrictions`, `brand_platform_pause`, `brand_platform_override`,
`entry_review_analyses`, `schedule_cancellations`, `tab_delete_log`, `tab_archive_log`,
`paused_tabs`, `tab_toolbar_filters`, `tab_icon_overrides`, `brand_agent_assignments` — no
per-table code needed, and a future table with a `tab` column is covered automatically too.
`entry_credentials` (keyed by `entry_id`, no `tab` column) and the `bif_review_accounts` view
(reads `entries` live, not a stored copy) are unaffected by construction.

## UI: `EditBrandTabModal.tsx`

The `dynamic ? <input> : <locked paragraph>` branch is removed — **every** tab (hardcoded or
dynamic) gets the same editable text input for its name. Submit logic keeps branching only on *how*
the rename is persisted:

```ts
const isRename = trimmedName !== tabName; // no longer gated on `dynamic`
...
if (isRename) {
  const nameError = validateNewTabName(trimmedName); // unchanged function, no logic change needed
  ...
}
...
if (isRename) {
  if (dynamic) {
    await renameCustomTab(tabName, trimmedName);
    renameDynamicTab(tabName, trimmedName, platforms);
  } else {
    await renameHardcodedTab(tabName, trimmedName);
    renameHardcodedTabLocally(tabName, trimmedName);
    renameOperationalTab(tabName, trimmedName);
  }
  renameTabIconOverride(tabName, trimmedName); // unchanged — already generic
  currentTabName = trimmedName;
}
```

`validateNewTabName` needs no logic change: its existing `OPERATIONAL_TABS.includes(...)` collision
check already works correctly once `OPERATIONAL_TABS` is properly mutated by `renameOperationalTab`
— the same way it already works for dynamic-tab renames today. One rule carried over unchanged: a
hardcoded tab's *original* name stays permanently reserved (the existing `trimmed in
TAB_COLUMN_CONFIGS` check already enforces this) — it can never be reused by a new dynamic tab or a
later rename, even after the tab itself has been renamed away from it, so the reverse lookup in
`hardcodedTabRenameRegistry.ts` never has to disambiguate two different current names claiming the
same original key.

**New warning copy**, shown only for a hardcoded tab (which typically has hundreds of live
entries, unlike a freshly-created dynamic tab): a plain sentence under the name field, e.g. *"This
tab has existing entries — renaming it updates every one of them and every dashboard link that
points to it."* No separate confirmation step — same modal, same Save button, consistent with how
this modal already surfaces other consequential changes (e.g. the Paused-status note just below
it).

## Accepted, out-of-scope limitations

- **Static text already baked before a rename doesn't retroactively update** — a PMS task
  title/label already created in the external tool for a scheduled slot, or an email already sent
  containing the old tab name in its body/link, stays as it was. Same class of limitation this
  project already accepts for brand-name edits (see CLAUDE.md's Known Issues history); not addressed
  here.
- **No undo.** A rename is immediate and atomic across every `tab`-column table; reverting means
  renaming back to the old name, which works exactly like any other rename (no special "undo"
  affordance).

## Testing

- New unit tests: `hardcodedTabRenameRegistry.test.ts` (mirrors `tabIconOverrideRegistry.test.ts`'s
  shape), plus a `resolveHardcodedTabKey`/`renameHardcodedTabLocally` round-trip test.
- Existing test files needing updates for the new resolver call: `tab-configs.test.ts`,
  `tabs.test.ts`, `tabIcons.test.ts`.
- `queries.test.ts`: new `renameHardcodedTab`/`fetchHardcodedTabRenames` tests, mirroring the
  existing `renameCustomTab` describe block.
- `tabValidation.test.ts`: a regression test confirming a hardcoded tab's original name stays
  blocked as a collision target even after that tab has been renamed away from it.
- Manual/live verification once deployed: rename a hardcoded tab with real entries (recommend a
  low-traffic one first, not BITP/FTP), confirm the URL slug changes, the sidebar/Overview/Score
  Summary/Schedule Planner all show the new name with zero stale references, and that the tab's
  data (entries, schedule, PMS links) all followed the rename. Then verify the `TAB_DISPLAY_NAMES`
  interaction directly on BITP or FTP: rename one, confirm the new name — not the old cosmetic
  alias — is what now renders everywhere.

## Process

Given the touch list spans `queries.ts`, shared tab-identity logic read by nearly every page, and
one edge function, this is Tier 3 under this project's own process rules (CLAUDE.md) — full spec →
plan → subagent-driven implementation → per-task review → final whole-branch review, the same
pipeline Task 232 (self-service Brand Tab creation) went through.
