# Self-Service Brand Tab Creation

**Requested by:** Leo, via chat — after confirming that Brand/Agent/Country/
Proxy values already auto-propagate everywhere (see the 2026-08-14 Proxy
whitelist removal, Task 218), asked whether a brand-new **Brand Tab** could
be made automatic too, i.e. not require a code change + deploy. Scope
narrowed interactively — see decisions below.

## Current behavior (for reference)

- `TAB_COLUMN_CONFIGS` (`src/lib/tab-configs.ts`) is a hardcoded
  `Record<string, string[]>` — the single source of truth for which columns
  a tab has, in what order. `OPERATIONAL_TABS` (`src/lib/tabs.ts`) is
  `Object.keys(TAB_COLUMN_CONFIGS)`, computed once at module load, and is
  imported as a plain static array by ~12 files: `Sidebar.tsx`,
  `Overview.tsx` (×2), `ScoreSummary.tsx`, `BrandTabsModal.tsx`,
  `SchedulePlanner.tsx` (×4), `AddReviewAccountModal.tsx`,
  `EditEntryModal.tsx`, `BrandGroup.tsx`.
- Routing is a single dynamic route (`<Route path="/brands/:tab" ... />` in
  `App.tsx`) — no per-tab route registration exists, so routing itself needs
  no change for a new tab.
- The 11 existing tabs' column names are genuinely inconsistent (e.g.
  `'Review Status'` vs `'TP Review Status'` vs `'Trust pilot Review
  Status'`), a legacy artifact of the disconnected Google Sheet import
  (fully disconnected 2026-07-07). Every tab created since then is
  dashboard-only — entries come only from Add Review Account — and
  `'GRG - Gulf Recovery Group'` is the existing template for that shape: a
  single, TP-only, internally-consistent column list.
- `tab-configs.ts` and `tabs.ts` are both imported by Deno Edge Functions
  (`generate-weekly-schedule`, `ai-assistant`) and must stay free of
  React/npm-package imports and I/O — they are pure, synchronous modules
  today.
- A DB-driven self-service tab creator was considered and **explicitly
  declined** once already (Task 219, 2026-08-14): "new tabs are rare
  structural events, not a frequent operational task." This spec revisits
  that decision at the user's explicit request.

## Decisions (confirmed interactively)

1. **Scope:** Brand Tab creation only. Platform automation (a 5th review
   site beyond TP/AG/CG/WO) is explicitly dropped — the part of the system
   that actually produces status data for a platform is a separate
   Python/Selenium bot on EC2, outside this repo, so a "new platform" is
   worthless without matching scraper work this repo can't automate away
   regardless of how tab-configs.ts is structured.
2. **Column schema:** creator picks which platforms (TP always on, AG/CG
   optional) a new tab tracks; the column list is generated from one fixed,
   canonical template (below) — not freely customizable. This finally gives
   anything created going forward one consistent naming scheme, unlike the
   11 legacy tabs.
3. **Existing 11 tabs:** left exactly as they are in `tab-configs.ts`. No
   migration into the new system, no changes to their column names, brand
   URL maps (`BRAND_TP_URLS`/`BRAND_AG_URLS`/`BRAND_CG_URLS`), brand
   sequences, or label overrides.
4. **Access:** any approved user can create or delete a dynamic tab — same
   gate as Schedule Planner/Score Summary, not admin-only.
5. **Edit:** out of scope for v1. Create and delete only; a mis-created tab
   (wrong name/platforms) is fixed by deleting and re-creating it (only
   possible while it still has zero entries — see delete safeguard).
6. **Delete safeguard:** deleting a dynamic tab is blocked if any `entries`
   row has `tab = <name>` — prevents silently orphaning real data (the
   `entries.tab` column has no FK to the new table, so nothing else would
   stop this). The user must remove/reassign those entries first.
7. **Propagation latency:** accepted trade-off, not fixed in v1 — a
   newly-created tab appears immediately in the creator's own session
   (local registration on submit) but requires a page reload to appear in
   any other already-open session. Symmetric on delete. Judged acceptable
   given how rare tab creation/deletion is expected to remain.

## Data model

New table `custom_tabs`:

```sql
create table custom_tabs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  platforms text[] not null,  -- subset of ('tp','ag','cg'), 'tp' always present
  created_by text,            -- actor email, same pattern as edit_log/delete_log
  created_at timestamptz not null default now()
);
```

Full 4-policy RLS shape this project always uses for new tables (per
`feedback_rls_delete_policy` — anyone can read; approved users can insert,
update, delete), even though the v1 UI only exercises select/insert/delete.
No FK from `entries.tab` — matching how tab identity already works for the
11 hardcoded tabs (a free-text string, not a foreign key).

## Column template

One canonical, deterministic function replaces ad-hoc per-tab column lists
for anything created this way:

```
Base (always included): Account, Country, Proxy Used, Account Name, Agent,
  Brand Name, Brand Link, Trust Pilot, Link to the profile, TP Review Status
+ if 'ag' selected: Ask Gambler review added, AG Review Status,
  AG Review Link, AG User
+ if 'cg' selected: Casino Guru review added, CG Review Status,
  CG Review Link, CG User
```

This is exactly the Hanan/Rooster Partners/Revolution Casino/SilverPlay
shape for multi-platform tabs and GRG's shape for TP-only, so every existing
helper that reads column presence (`getBrandNameCol` via `BRAND_COLS`,
`hasMultiPlatform`, `getTabPlatforms`) works against a generated config with
zero special-casing — no per-tab logic needs to know a tab is
"dynamic" vs. "hardcoded."

## Runtime registry

`tab-configs.ts` and `tabs.ts` stay pure and synchronous. A new sibling
module, `src/lib/dynamicTabRegistry.ts` (same import-safety constraints —
no React/npm, Deno-compatible), holds:

- `let dynamicTabColumns: Record<string, string[]> = {}`
- `registerDynamicTabs(rows: { name: string; platforms: ('tp'|'ag'|'cg')[] }[]): void`
  — builds each row's column list via the template above, sets
  `dynamicTabColumns[name]`, and pushes any name not already present into
  `OPERATIONAL_TABS` (mutating the existing exported array *in place*, not
  reassigning the binding — every one of the ~12 existing importers holds a
  reference to the same array object, so they see new entries without
  changing a single call site).
- `unregisterDynamicTab(name: string): void` — inverse, for the delete flow.

`tab-configs.ts`'s getters (`getTabColumns`, `getBrandNameCol`,
`hasMultiPlatform`, `getTabPlatforms`) each fall back to
`dynamicTabColumns[tab]` when `tab` isn't a key of the static
`TAB_COLUMN_CONFIGS`.

### Loading

- **Frontend:** `registerDynamicTabs` is called once at app boot, gated
  alongside the existing auth-session load in `App.tsx` (same shape as the
  current session-await-before-routes-render gate) — fetches all
  `custom_tabs` rows before any route can mount. The create/delete UI also
  calls `registerDynamicTabs`/`unregisterDynamicTab` directly after a
  successful write, so the *acting* session sees the change immediately
  without a reload (decision 7).
- **Edge Functions:** of the three Edge Functions in this repo,
  `generate-weekly-schedule` is the only one that actually imports
  `tab-configs.ts`/`tabs.ts` (`OPERATIONAL_TABS`, `getTabPlatforms`,
  `getBrandNameCol`, `TAB_DEFAULT_BRAND`, `BRAND_COLS`) — confirmed by
  grepping `supabase/functions` for both import paths. `ai-assistant` and
  `sync-schedule-pms` neither import nor need either module (`ai-assistant`'s
  own hardcoded tab vocabulary in its system prompt is a separate, unrelated
  list, out of scope here). So only `generate-weekly-schedule` fetches
  `custom_tabs` and calls `registerDynamicTabs`, once near the start of its
  handler before `generateAllTabs`/`OPERATIONAL_TABS` is used — same
  dependency-injection-at-invocation pattern already established for the
  injected Supabase client (Task 178).

## UI

**Create:** a "+ Add Brand Tab" entry point in the sidebar's Brand Tabs
section. Form: tab name (validated unique, case-sensitive exact match,
against both `TAB_COLUMN_CONFIGS` keys and existing `custom_tabs.name`
rows) + platform checkboxes (TP locked on and checked, AG/CG optional). On
submit: insert into `custom_tabs`, call `registerDynamicTabs` locally, then
navigate to the new tab. No icon picker — falls back to the existing
`DEFAULT_TAB_ICON`, same as any tab without a configured icon today. Slug
uses the existing generic `tabToSlug` (lowercase, spaces → dashes) with no
new per-tab override needed for a sensibly-named new tab.

**Delete:** a small trash affordance shown only next to dynamically-created
tabs (never the 11 hardcoded ones, which never appear in `custom_tabs`).
Checks `entries` for `tab = <name>` first; if any exist, blocks with a
message to remove/reassign them first (decision 6). On success: deletes the
`custom_tabs` row, calls `unregisterDynamicTab` locally.

## Testing

- Unit tests for the column-template generator (each platform combination →
  expected column list).
- Unit tests for `registerDynamicTabs`/`unregisterDynamicTab`: merge
  precedence (a `custom_tabs` row can never shadow a hardcoded tab name,
  since the uniqueness check at creation time already forbids the
  collision), idempotent re-registration (no duplicate `OPERATIONAL_TABS`
  entries), correct removal on unregister.
- Unit test for the delete-blocked-when-non-empty guard.
- Full existing suite + `npm run build` must still pass (standing
  verification bar for this project).

## Non-goals

- Migrating the 11 existing hardcoded tabs into `custom_tabs`.
- Editing a dynamic tab's name or platforms after creation.
- Any form of platform (5th review site) automation.
- Real-time propagation of a new/deleted tab to other already-open
  sessions without a reload.
