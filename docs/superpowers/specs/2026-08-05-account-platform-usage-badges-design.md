# Account Platform-Usage Badges — Design

## Purpose

An "Account" (the free-text identifier field like `358 | BI TP | Germany`,
stored in `data['Account']`) can be reused across multiple entry rows — the
existing "duplicate row" flow (`BrandGroup.tsx`'s `handleDuplicate`) copies
the same Account text forward (appending `" dup"`) when reusing an account
for another brand or platform. There is currently no way to see, at a
glance, how many times a given account has actually been used across the
whole dashboard, or on which platforms.

This feature adds a small set of icon+count badges next to the Account cell
showing, per platform (TrustPilot, AskGamblers, CasinoGuru, Wizard of Odds),
how many entry rows — anywhere in the dashboard, any tab — that same account
has been used on. Example: an account used on 3 TrustPilot rows, 1
AskGamblers row, 2 CasinoGuru rows, and 1 Wizard of Odds row shows four
badges: the TrustPilot favicon with a small "3", the AskGamblers favicon
with "1", the CasinoGuru favicon with "2", and the Wizard of Odds favicon
with "1". A platform with zero uses shows no badge at all.

## Scope

- Applies only to the `Account` column (`BrandGroup.tsx:2328`, the
  `h === 'Account'` branch). The separate `Account Name` field (the review
  persona's display name) is unaffected — it shares the same cell-rendering
  branch today but is not the identifier this feature counts.
- Counting is dashboard-wide (every tab), not scoped to the tab currently
  being viewed, since accounts are known to be reused across tabs/brands via
  the duplicate flow.
- A blank Account value gets no badges.

## Matching rule ("same account")

Two rows are the same account when their `data['Account']` text is
identical after stripping a trailing `" dup"` suffix (one or more, e.g.
`"358 | BI TP | Germany dup dup"` → `"358 | BI TP | Germany"`). This reuses
the exact stripping regex `deriveCountryFromAccount` already applies in
`tab-configs.ts:265` (`/(?:\s+dup)+$/i`), so the two can't drift apart.
Comparison is otherwise an exact, case-sensitive string match — no
normalization of the id/label/country segments, no fuzzy matching.

## What counts as a "use"

A given entry row counts as one use of platform P if any of that platform's
status-key aliases (`PLATFORM_STATUS_KEYS[P]` in `scoreSummary.ts:64-69`,
read via the existing `pick()` helper at `scoreSummary.ts:85-91`) has a
non-blank value — regardless of what that status actually is (Live,
Removed, Refused, Pending, etc.). A row with values set for more than one
platform's status keys (common on multi-platform tabs like Rooster
Partners) counts as one use of each platform it has a value for.

## Data fetching

New `fetchAccountPlatformUsage()` in `src/lib/queries.ts`:

- Runs one Supabase query against `entries` with **no** `tab` filter
  (dashboard-wide), selecting only the columns needed for this
  computation — `tab`, `data->>Account`, and each of the status-key
  aliases from `PLATFORM_STATUS_KEYS` for all four platforms — not the full
  `data` jsonb blob. This keeps the payload small and, notably, never pulls
  the credential fields (`Password`, `Backup Codes`, `Authenticator Backup`)
  that live in the same `data` column.
- Paginates the same way `fetchAllEntries` already does
  (`queries.ts:268-305`) if the row count requires it, reusing that
  count-then-parallel-page pattern rather than inventing a new one.
- For each row: normalize the Account text per the matching rule above,
  skip blanks, then for each platform check `pick()` across its status-key
  aliases and increment that platform's counter for that normalized account
  if non-blank.
- Returns `Map<string, Record<Platform, number>>` keyed by the normalized
  Account text.

## Wiring into BrandGroup

- `BrandGroup.tsx` fetches this map once on mount and re-fetches on the same
  trigger that already reloads the current tab's entries (tab switch,
  post-save/duplicate/delete refresh) — kept simple, no separate caching
  layer, since the query is lightweight.
- Stored in one new state variable, passed down to `CellValue` (or read via
  the existing per-row `entry`/`decodedTab` closure the Account cell
  renderer already has).
- The Account cell renderer looks up the current row's normalized Account
  text in the map and renders one badge per platform with count ≥ 1, in
  fixed order TP → AG → CG → WO, appended after the existing Account text
  in the same cell (no layout changes elsewhere).

## Visual design

Each badge reuses the existing icon+corner-number pattern already used for
the star-score badge (`BrandGroup.tsx:178-183`): a small favicon image
(`PLATFORM_FAVICON[platform]` from `src/lib/removedPlatformBrands.ts:16`,
`size-4`) with the use-count rendered in a small overlay in the corner
(same relative/absolute positioning as the existing star badge, swapped
from a fixed score-in-a-star to an arbitrary count-in-a-corner-dot), and a
`title` tooltip reading e.g. `"Used 3 times on TrustPilot across the
dashboard"` — same tooltip convention as `RemovedPlatformIcon`
(`SchedulePlanner.tsx:66-85`) and the star badge.

## Error handling

- If the usage query fails, the Account cell falls back to rendering no
  badges (same fail-open behavior as other optional decorations in this
  codebase, e.g. `PlatformRemovedBadge` callers) — it must never block the
  Account cell's existing edit-modal click behavior or crash the table.
- Rows with a malformed/empty Account are simply excluded from the map;
  never an error.

## Testing

- Unit tests for the normalization/matching helper (dup-suffix stripping)
  and the per-platform "use" counting logic, following the existing pattern
  in `scoreBrandUpdate`-style tests
  (co-located with `scoreSummary.test.ts`/`removedPlatformBrands.test.ts`).
- No live browser verification is required to be blocking, but should be
  attempted post-implementation against real Supabase data the same way
  recent features in this codebase have been (see `Recent Changes` in
  `CLAUDE.md`), specifically confirming: badges appear only on `Account`
  (not `Account Name`), a duplicated (" dup") row's badges match its
  original, and a fresh account with zero prior uses on a platform shows no
  badge for that platform.

## Out of scope

- No new database table, column, or migration — this is a purely
  client-computed, read-only overlay on existing `entries` data.
- No change to the duplicate-row flow, Score Summary, or Schedule Planner.
- No admin-only gating beyond the existing `ProtectedRoute`/`isApproved`
  checks the Account cell already has.
