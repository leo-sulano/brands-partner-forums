# Ask AI: Date-Range Reporting Design

**Date:** 2026-08-26
**Status:** Approved, pending implementation plan

## Problem

Ask AI (`supabase/functions/ai-assistant/`) currently has almost no date-range
support:

- `query_entries` accepts only a single `month` string (`"may 2026"` /
  `"2026-05"`) — no week, no year, no arbitrary from/to range, no multiple
  months in one call.
- `get_score_summary` (star ratings + live/removed Success Rate) is
  explicitly **all-time only** — its own tool description says so, and
  `tools.ts` has no per-platform date keys or date-parsing logic at all for
  this path (confirmed by reading the file — no `PLATFORM_DATE_KEYS`,
  `parsePostDate`, or date filter exists anywhere in `tools.ts` today).
- `get_success_rate_by_field` has the same gap.
- There is no single tool that returns a report-shaped bundle (totals +
  per-brand breakdown) for a period — the model would have to chain several
  `query_entries` calls and synthesize the summary itself, with no
  consistent output shape.

The dashboard itself already solved this exact problem for its own pages:
`src/lib/scoreSummary.ts`'s `passesPlatformDateFilter` (and the coarser
`passesDateFilter` it wraps) is the single shared date-range gate used by
Overview, Score Summary, and Brand Tabs' own KPI cards, after this project
shipped a real bug (Task 180, 2026-08-07) from those three surfaces each
having independently-written, disagreeing date logic. Ask AI needs the same
semantics, not a fourth independent implementation.

## Why `tools.ts` hand-ports instead of importing `scoreSummary.ts`

`tools.ts`'s own header comment states the existing policy: most pure logic
(field picking, score parsing, row mapping, score summary) is **ported**
from `src/lib/queries.ts` / `src/lib/scoreSummary.ts` rather than imported,
specifically because a large `src/lib`-rooted import chain broke a real
Supabase deploy before (Task 231's `sync-schedule-pms` deploy failure — see
CLAUDE.md Known Issues). Only a handful of small, self-contained modules
(`proxyAliases.ts`, `scheduleBrandConfig.ts`, `scheduler/scheduleUtils.ts`,
`tab-configs.ts`) are imported directly.

This design follows the existing pattern: **hand-port** the date-filter
logic (a small, self-contained set of pure functions) into `tools.ts`,
mirroring `scoreSummary.ts` exactly, rather than adding a new cross-import
of the much larger `scoreSummary.ts` file (which itself imports
`types/entry.ts` and `removedPlatformBrands.ts`) into a function whose
import-chain deploy-safety has never been proven. This is consistent with
how `PLATFORM_STATUS_KEYS`, `parseScore`, and `ratingLabel` are already
hand-ported copies in this same file.

## Scope

Confined entirely to `supabase/functions/ai-assistant/` (`tools.ts`,
`tools_test.ts`, `index.ts`'s system prompt). No schema/migration change, no
other dashboard surface touched. This is a self-contained deployable unit —
lower cross-surface risk than most Tier 3 work in this project, since
nothing on the dashboard itself changes.

## Design

### 1. Shared date gate (new in `tools.ts`)

Add, mirroring `src/lib/scoreSummary.ts` exactly:

```ts
export const PLATFORM_DATE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['Trust Pilot'],
  ag: ['Ask Gambler review added'],
  cg: ['Casino Guru review added'],
  wo: ['Wizard of Odds'],
};

export function parsePostDate(raw: string | null | undefined): Date | null { ... }
// Same 3-branch parse as scoreSummary.ts: YYYY-MM-DD, DD/MM/YYYY, JS Date.toString() fallback.

export function passesPlatformDateFilter(
  data: Record<string, any>,
  platform: Platform,
  fromISO?: string,
  toISO?: string,
): boolean { ... }
// Same bias as the original: no bounds → always true. A row with no
// parseable date for this platform's date column → always true (never
// excluded by a range — this is what stops date-filtering from silently
// skewing a live/removed rate by dropping undated Removed/Refused rows).
// Otherwise: in [fromISO, toISO] inclusive, day-granularity.
```

A source comment cross-references `src/lib/scoreSummary.ts`'s
`passesPlatformDateFilter`/`parsePostDate` (both directions), matching this
file's existing "keep in sync manually" comment convention used for
`isLiveStatus`/`isRemovedStatus` etc.

This becomes the one date gate every date-aware tool below uses.

### 2. `query_entries` gains `date_from` / `date_to`

New optional params, `YYYY-MM-DD`. Behavior:

- If `tab` is also given: OR `passesPlatformDateFilter` across
  `getTabPlatforms(tab)` (already imported) — a row counts as in-range if
  any of the tab's active platforms has an in-range (or absent) date. This
  matches how multi-platform tab KPIs are already computed elsewhere
  (`computeTabKpisFromEntries`'s per-platform OR).
- If no `tab` (cross-tab query): OR across all 4 platforms — same rule,
  just without narrowing to one tab's platform set first.
- `month` is unchanged and still works standalone. If both `month` and
  `date_from`/`date_to` are passed, they AND together (both must pass) —
  an unusual combination but a safe, predictable one; not specifically
  optimized for.
- Tool description updated to document the new params and steer the model:
  "use date_from/date_to for anything broader than one calendar month —
  weeks, years, quarters, custom ranges; month is still fine for a single
  named month."

### 3. `get_score_summary` gains `date_from` / `date_to`

The existing `scoreSummary()` helper in `tools.ts` gets a `range` param
(`{ from?: string; to?: string }`) threaded through, splitting into the same
two gates the dashboard's `computeScoreSummary`/`computeSuccessRates` use
for the same reason:

- **Live/removed counts** (used for `successRate`): the lenient
  `passesPlatformDateFilter` gate — an undated row still counts.
- **Star-rating breakdown** (only ever computed when exactly one platform is
  requested): the *strict* gate from `computeScoreSummary` — when a range is
  active, a Published row with no parseable date is excluded from the star
  breakdown and counted in a new `excludedRows` field on the response,
  rather than silently included or silently dropped. This mirrors the
  dashboard's own Score Summary page exactly, including the reason
  documented there: rating detail is about "which of these specific dated
  reviews fall in range," a different question from "does this outcome
  count toward the rate at all."

Response gains `dateRange: { from, to } | null` and `excludedRows` (0 when
no range is active or when 2+ platforms are requested) so the model can
disclose the caveat instead of presenting a partial star breakdown as
complete.

### 4. `get_success_rate_by_field` gains `date_from` / `date_to`

Same lenient `passesPlatformDateFilter` gate as `get_score_summary`'s
live/removed path — this tool has no star-rating concept, so there's no
second stricter gate needed here.

### 5. New `get_performance_report` tool

```
get_performance_report(date_from: string, date_to: string, tab?: string, platform?: string[])
```

- `date_from`/`date_to` required, `YYYY-MM-DD`, computed by the model from
  the current-date system message (same pattern `get_schedule`'s
  `week_start` already documents — no new server-side natural-language date
  parsing).
- `tab` optional (all tabs if omitted, one tab if given).
- `platform` optional array (`tp`/`ag`/`cg`/`wo`), same default (`['tp']`)
  and same OR-across-platforms combining semantics as `get_score_summary`.
- Reuses the same archived-tab, paused-tab, and `removed_platform_brands`
  exclusion every other review-data tool already applies.
- Returns:
  ```json
  {
    "period": { "from": "2026-08-01", "to": "2026-08-31" },
    "totals": { "live": 42, "removed": 7, "successRate": 86, "entries": 51 },
    "brands": [
      { "tab": "...", "brand": "...", "live": 5, "removed": 1, "successRate": 83 },
      ...
    ]
  }
  ```
  `brands` sorted by `live + removed` descending (most active brands first —
  the natural read order for "what happened this period," and consistent
  with `query_entries`'s own group-by results already being count-sorted).
- Live/removed accounting reuses the *same* "any decided status, not just
  Published" semantics `computeSuccessRates` uses (not
  `get_score_summary`'s Published-only star gate) — a performance report is
  about outcomes, not just the subset of Published reviews.
- Does not include star-rating detail — that's what `get_score_summary`
  already covers for a single platform.

### 6. System prompt (`index.ts`)

- Add a `date_from`/`date_to` vocabulary line next to the existing `month
  filter format` line: "For a week/year/quarter/custom range, use
  date_from/date_to (YYYY-MM-DD) instead of month — compute the actual
  dates yourself from the current-date system message, the same way you
  already compute week_start for get_schedule."
- Add `get_performance_report` to the tool vocabulary as the first choice
  for "give me a report/summary for <period>" style questions, with
  `query_entries`/`get_score_summary` remaining available for narrower
  follow-ups.

### 7. Tests

New/updated Deno tests in `tools_test.ts`:

- `parsePostDate` / `passesPlatformDateFilter`: the 3 date formats, in/out
  of range, undated-always-passes bias, day-granularity inclusive bounds —
  parity cases with `scoreSummary.test.ts`'s own fixtures where the two
  files' test data overlaps.
- `query_entries`: `date_from`/`date_to` alone, combined with `tab`
  (single-platform gate), combined cross-tab (OR across all 4), combined
  with `month` (AND).
- `get_score_summary`: live/removed lenient gate with an undated row still
  counted; star breakdown strict gate with an undated Published row
  excluded and reflected in `excludedRows`; 2+ platforms zeroes star detail
  same as before.
- `get_success_rate_by_field`: date range narrows the live/removed buckets.
- `get_performance_report`: totals + per-brand breakdown, tab-scoped vs.
  all-tabs, multi-platform OR, archived/paused/removed-platform-brand
  exclusion all still apply.

Run `deno check` and the full Deno suite before considering this done.

### 8. Deploy

`supabase functions deploy ai-assistant` once tests pass. Attempt directly;
if CLI credentials aren't available in the implementing session, document as
a pending manual deploy in `docs/task-history.md`, per this project's
existing pattern for undeployed edge function changes.

## Explicitly out of scope

- Natural-language period parsing server-side (e.g. a `"last month"` string
  resolved in `tools.ts`) — rejected during brainstorming in favor of having
  the model compute ISO dates itself, avoiding a new class of date-parsing
  bugs to maintain.
- Any change to the dashboard frontend itself — this is Ask AI catching up
  to date semantics the dashboard already has, not a new dashboard feature.
- A `group_by` dimension choice on `get_performance_report` (agent/country/
  proxy breakdown) — the per-brand breakdown covers the primary "report" use
  case; a narrower field-level date-scoped breakdown is already reachable
  via `get_success_rate_by_field`'s new `date_from`/`date_to`.
