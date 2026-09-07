# Custom Platforms

## Goal

Let any approved user define a new review platform (e.g. a 5th site beyond
TrustPilot/AskGamblers/CasinoGuru/Wizard of Odds) and enable it on any tab —
hardcoded or self-service-created — with **no code change and no deploy**.
Once enabled, that platform gets real status/date fields on entries and its
Live/Removed/Total/Success-Rate counts automatically appear in Overview and
Brand Tabs — both are tab-scoped views, matching how a custom platform is
tab-scoped by construction.

This closes the one genuine gap identified from a direct user question: new
brands, new tabs (Task 232), new proxies (Task 218), and new countries/agents
already propagate everywhere automatically. A new **platform** is the one
concept still fully hardcoded across ~10+ files.

## Non-goals (explicit v1 scope cuts, not silently dropped)

- **Automated status-checking (scraping) for a custom platform.** Each of
  TP/AG/CG/WO's automated Check Status is a hand-written Selenium scraper
  tailored to that exact website's HTML (`check_review_status.py`,
  `check_ag_status.py`, `check_cg_status.py`, `check_wo_status.py`, on EC2).
  There is no generic way to automate this for an unknown future site — a
  custom platform's status is **always** entered by hand via Edit
  Entry/Add Review Account, indefinitely. This is a permanent property of
  the feature, not a v1-only gap.
- **Rewriting TP/AG/CG/WO onto the new mechanism.** The 4 built-in platforms
  stay exactly as they are today (`Platform = 'tp'|'ag'|'cg'|'wo'`,
  `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS` in `scoreSummary.ts`, all
  existing scheduler/removed-flag/Ask AI logic keyed on that union). Custom
  platforms are a fully separate, additive engine that happens to reuse the
  same underlying string-classification helpers.
- **Score Summary** (`ScoreSummaryPanel.tsx`) — deferred, discovered during
  implementation planning to be a bigger architectural mismatch than
  originally scoped. Score Summary is a **cross-tab, combined** view: its
  `platform: Platform[]` multi-select filters ALL entries across every tab
  at once (`computeScoreSummary(entries, range, [], platform,
  removedPlatformBrands)`), strictly typed to the 4 built-in platforms
  everywhere (`PLATFORM_MULTI_OPTS`, `PLATFORM_MAX_SCORE[platform[0]]`,
  etc.). A custom platform is tab-scoped by construction (only certain tabs
  enable it) and has no natural meaning in an "all platforms combined,
  across every tab" computation — folding it in cleanly needs its own
  design (e.g. gating custom-platform options behind an active tab filter),
  not a few lines bolted onto a working, well-tested cross-tab view. Left
  for a dedicated follow-up.
- **Schedule Planner** — no scheduling, auto-pause, or PMS status sync for a
  custom platform. It never appears on the calendar grid.
- **Ask AI** (`supabase/functions/ai-assistant/`) — its tools stay unaware of
  custom platforms; `get_score_summary`/`query_entries`/etc. keep their
  existing `tp|ag|cg|wo` enum. A future phase can extend this once the core
  aggregation slice is proven live.
- **The `removed_platform_brands` flagged-removed exclusion mechanism** — a
  custom platform has no equivalent "page removed, exclude from KPIs" flag
  in v1.
- **Renaming a custom platform.** Its `status_column`/`date_column` are
  derived from its name once, at creation, and then frozen — renaming would
  mean rewriting that key across every entry on every tab that uses it,
  which is a much bigger migration than this feature needs (unlike a Brand
  Tab rename, which already has dedicated machinery for exactly this cost,
  Task 306). Deleting and recreating is the only path to a new name.

All six of these are meant to be revisited as separate, later, independently
-scoped features once this slice is live and proven — not treated as
permanently out of reach (except the scraping one, which is permanent by
nature).

## Data model

Two new tables, migration `supabase/migrations/20260907120000_add_custom_platforms.sql`:

```sql
create table custom_platforms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform_key text generated always as (lower(trim(name))) stored,
  short_label text not null,
  status_column text not null,
  date_column text not null,
  max_score integer,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint custom_platforms_platform_key_unique unique (platform_key),
  constraint custom_platforms_max_score_check check (max_score is null or max_score > 0)
);

create table tab_custom_platforms (
  id uuid primary key default gen_random_uuid(),
  tab text not null,
  platform_id uuid not null references custom_platforms(id) on delete restrict,
  enabled_by text not null,
  enabled_at timestamptz not null default now(),
  constraint tab_custom_platforms_unique unique (tab, platform_id)
);
```

- `platform_key` mirrors the `brand_key`/`platform_key`-style generated
  columns already used by `removed_platform_brands`/`custom_tabs` — one
  canonical case/whitespace-insensitive identity, enforced at the DB level.
- `status_column`/`date_column` are computed once at creation as
  `"<name> Review Status"` / `"<name> Review Added"` and stored, never
  recomputed — see Non-goals on renaming.
- `on delete restrict` on `tab_custom_platforms.platform_id` is a hard DB
  backstop underneath the app-level "can't delete while any tab still has it
  enabled" check (mirrors `custom_tabs`' entries-count guard, Task 232 —
  same TOCTOU caveat accepted there applies here too).
- Both tables get the project's standard 4-policy RLS: anyone can `select`;
  an approved user can `insert`/`delete` (no `update` policy needed — nothing
  in either table is ever edited in place, only inserted/deleted).
- **No RPC change needed for renames.** Both `rename_hardcoded_tab` and
  `rename_custom_tab` already discover every table with a plain `tab text`
  column via `information_schema.columns` and rewrite it automatically
  (confirmed in their migration source, and in `brand_catalog`'s own
  migration comment, which relies on the same mechanism) — as long as
  `tab_custom_platforms.tab` is a plain `text` column literally named `tab`,
  a rename picks it up with zero code change here, exactly like
  `brand_catalog` did.

## Column & registry architecture

`getTabColumns(tab)` (`tab-configs.ts`) currently returns either a hardcoded
tab's static list or, via `setDynamicColumnsResolver`, a dynamic tab's
generated list. Custom platforms plug in as an **overlay appended after
either base list**, so the same function keeps working unchanged for every
caller and both hardcoded and dynamic tabs get identical treatment:

```ts
// tab-configs.ts
let customPlatformColumnsResolver: ((tab: string) => string[]) | null = null;
export function setCustomPlatformColumnsResolver(fn: (tab: string) => string[]): void {
  customPlatformColumnsResolver = fn;
}

export function getTabColumns(tab: string): string[] | null {
  const base = TAB_COLUMN_CONFIGS[resolveHardcodedTabKey(tab)]
    ?? (dynamicColumnsResolver ? dynamicColumnsResolver(tab) : null);
  if (!base) return null;
  const custom = customPlatformColumnsResolver ? customPlatformColumnsResolver(tab) : [];
  return custom.length ? [...base, ...custom] : base;
}
```

New `src/lib/customPlatformRegistry.ts` (same import-safety constraints as
`dynamicTabRegistry.ts` — no React/npm imports, Deno-safe). Nothing in v1
actually imports this module from a Deno context — Schedule Planner and
`generate-weekly-schedule` are explicit non-goals, so that edge function
never needs to know about custom platforms — but keeping it Deno-safe from
day one, matching every sibling registry module in `src/lib`, costs nothing
and avoids foreclosing a future Phase 2 that does need it there:

```ts
export interface CustomPlatformConfig {
  id: string;
  tab: string;
  name: string;
  shortLabel: string;
  statusColumn: string;
  dateColumn: string;
  maxScore: number | null;
}

export function registerTabCustomPlatforms(rows: CustomPlatformConfig[]): void;
export function getCustomPlatformColumns(tab: string): string[];   // [statusColumn, dateColumn] per enabled platform
export function getTabCustomPlatforms(tab: string): CustomPlatformConfig[];
export function resetTabCustomPlatforms(): void; // mirrors resetDynamicTabs's shape; no caller in v1 (nothing runs this registry in a warm-isolate context yet), kept for parity and future reuse
```

Self-registers via `setCustomPlatformColumnsResolver(getCustomPlatformColumns)`
at module load, same synchronous, no-race pattern `dynamicTabRegistry.ts`
already uses for `setDynamicColumnsResolver`. Fires the existing
`tab-platforms-changed` window event on any registration change so
`Sidebar.tsx`'s one listener (already shared by the dynamic-tab and
hidden-platform registries) covers this too.

`getTabPlatforms(tab): ('tp'|'ag'|'cg'|'wo')[]` is **not** touched or widened
— its return type stays the narrow built-in union (this is the "don't
migrate TP/AG/CG/WO" decision made concrete). Every consumer that needs to
know about custom platforms calls the new, separate `getTabCustomPlatforms(tab)`
alongside it.

### Bootstrap wiring (`AuthContext.tsx`)

New `fetchTabCustomPlatforms()` query (joins `tab_custom_platforms` →
`custom_platforms`, one row per enabled combo) added to the existing
`Promise.all([...])` bootstrap block, fail-open (`.catch(() => [])`) like
`fetchCustomTabs`/`fetchHiddenTabPlatforms`. Result passed to
`registerTabCustomPlatforms(rows)`, called after `registerDynamicTabs` (no
strict ordering dependency, but matches the existing block's convention of
tab-registry calls before tab-filtering calls).

### Reserved column names

`createCustomPlatform` (in `queries.ts`) validates the computed
`status_column`/`date_column` against a static `RESERVED_COLUMN_NAMES` set
(every column name appearing anywhere in `TAB_COLUMN_CONFIGS` plus
`dynamicTabRegistry.ts`'s `TP_COLUMNS`/`AG_COLUMNS`/`CG_COLUMNS`/`WO_COLUMNS`)
and against every already-registered custom platform's own two columns,
client-side, before insert — same "validate against a live fetched list
before writing" pattern already used for brand-tab name collisions (Task
232) and hardcoded tab renames (Task 306). Not a DB constraint (the reserved
set isn't representable as a portable SQL check), same acceptable trust
boundary this project already carries for those two precedents.

## Creating & enabling a custom platform

- `AddBrandTabModal.tsx` and `EditBrandTabModal.tsx` both fetch the full
  `custom_platforms` list (name, short label) alongside their existing
  hardcoded `PLATFORM_LIST` checkboxes, rendering one more checkbox per
  existing custom platform, plus a trailing **"+ Add custom platform"**
  link.
- Clicking it opens `AddCustomPlatformModal.tsx`: name, short label (2-4
  chars), optional rating scale (blank / 5 / 10). On save: `createCustomPlatform(...)`
  inserts the `custom_platforms` row, then immediately
  `enableCustomPlatformOnTab(tab, platformId)` inserts the
  `tab_custom_platforms` row for whichever tab the modal was opened from —
  one action creates and enables in the common case, no separate "browse and
  attach" step needed.
- Any other tab's Add/Edit Brand Tab modal — opened afterward, or already
  open and refetching — shows that platform as a plain checkbox from then
  on; checking it just calls `enableCustomPlatformOnTab`, no creation step.
- Unchecking an already-enabled platform calls `disableCustomPlatformOnTab`
  (deletes the `tab_custom_platforms` row). This never touches entry data —
  disabling is reversible and non-destructive, re-enabling later picks the
  same historical values back up.
- Deleting a custom platform entirely (from wherever the checkbox list is
  managed) is blocked with a clear message while any `tab_custom_platforms`
  row references it — the user must disable it on every tab first.

## Entry data & the compute engine

Status vocabulary matches what the existing classification helpers already
key on: **Published, Refused, Removed, Pending, Not Published, Done** — a
fixed dropdown, not free text, so `isLiveStatus`/`isRemovedStatus`/
`isPendingStatus`/`isDoneStatus` (`scoreSummary.ts`) classify a custom
platform's status with **zero new logic**, just called with a different
column key.

New `src/lib/customPlatforms.ts`:

```ts
export interface CustomPlatformCounts {
  total: number;
  live: number;
  removed: number;
  successRate: number | null;   // live / (live + removed), floored %, null if 0 decided
  starCounts: Record<number, number> | null; // only when maxScore is set
}

export function computeCustomPlatformCounts(
  entries: Entry[],
  platform: CustomPlatformConfig,
  range: DateRange,
): CustomPlatformCounts
```

Implementation reuses, unchanged: `pick(data, [platform.statusColumn])`,
`isLiveStatus`/`isRemovedStatus` for total/live/removed,
`passesDateFilter(data, [platform.dateColumn], from, to)` for range
filtering (single-key array — a fresh column has no legacy header aliases to
fold in, unlike TP's 5-variant `PLATFORM_STATUS_KEYS.tp`), and the same
floor-to-whole-percent Success Rate formula `successRatePct` already uses.
When `maxScore` is set, buckets a star distribution the same way
`computeScoreSummary` does, parameterized by `maxScore` instead of
`PLATFORM_MAX_SCORE[platform]`.

### Rendering

- **`EditEntryModal.tsx`/`AddReviewAccountModal.tsx`**: one generic field
  group per `getTabCustomPlatforms(tab)` entry — a status `<select>` (the 6
  values above) and a date field, writing to
  `data[platform.statusColumn]`/`data[platform.dateColumn]`. New shared
  renderer in `entryFieldSections.ts`, driven entirely by
  `CustomPlatformConfig`, not hand-coded per platform like the 4 built-ins.
- **`BrandGroup.tsx`**: one extra Live/Removed KPI card and one extra table
  column per enabled custom platform on the current tab, using
  `computeCustomPlatformCounts` — same visual treatment as the existing
  platform-specific cards, generic data.
- **Overview.tsx**: per-tab KPI card gains one Total/Live/Removed line per
  enabled custom platform, using the same date-range semantics Overview's
  fixed-platform lines already apply (Task 180 parity — the generic engine's
  `passesDateFilter` call is intentionally structured the same way
  `passesPlatformDateFilter` is, so the two families of platforms can't
  silently diverge on what "in range" means).
- **Score Summary**: not touched in v1 — see Non-goals.

## Cross-dashboard check

- **Ask AI** — untouched, per Non-goals. Its tools remain blind to custom
  platforms; no `tools.ts` edit, no `ai-assistant` deploy required by this
  change.
- **Schedule Planner** — untouched, per Non-goals. `getTabPlatforms` (which
  it reads) is unchanged, so no custom platform can appear on the calendar.
- **`removed_platform_brands`** — untouched; no custom-platform equivalent.
- **Overview / Brand Tabs** — the two surfaces this feature actually
  targets; see Rendering above. Both read the same
  `computeCustomPlatformCounts`/`getTabCustomPlatforms` pair, so they cannot
  independently drift on what counts as Live/Removed/in-range for a custom
  platform, the same anti-drift shape Task 180's `passesPlatformDateFilter`
  established for the 4 built-ins.
- **Tab rename (`rename_hardcoded_tab`/`rename_custom_tab`)** — no change
  needed; both already auto-discover any `tab text` column, per Data model
  above.
- **Tab archive/pause (`archivedTabRegistry.ts`/`pausedTabRegistry.ts`)** —
  untouched; an archived or paused tab already drops out of
  Overview/Brand Tabs/Score Summary/Schedule Planner wholesale, so its
  custom platforms (if any) are excluded for free with no new code.

## Testing

- `src/lib/customPlatforms.test.ts` — `computeCustomPlatformCounts` (live/
  removed/total/success-rate for each of the 6 status values, date-range
  in/out-of-bounds, undated-row-always-included parity with the built-in
  engine, star bucketing when `maxScore` is set, `null` counts/rate when
  `maxScore` is unset).
- `src/lib/customPlatformRegistry.test.ts` — register/reset, `getTabColumns`
  overlay ordering (base columns first, custom appended, for both a
  hardcoded and a dynamic tab), `getTabPlatforms` provably unchanged.
- `src/lib/queries.test.ts` additions — `createCustomPlatform` collision
  rejection (name + reserved-column checks), `enableCustomPlatformOnTab`/
  `disableCustomPlatformOnTab`, `deleteCustomPlatform` blocked while in use.
- Component/integration: `npm run build`, then a live browser pass — create
  a custom platform from a dynamic tab, confirm it appears as a checkbox on
  a second (hardcoded) tab's Edit Brand Tab, enable it there too, add an
  entry with a status/date for it on both tabs, and confirm Overview and
  Brand Tabs agree on its Live/Removed count for a matching date range.
- Full suite + `npm run build`; this is Tier 3 scope per this project's own
  rules (touches shared aggregation logic across all three consistency
  surfaces) — full spec → plan → subagent-driven implementation → per-task
  review → whole-branch review → live verification, not a bounded fix.
