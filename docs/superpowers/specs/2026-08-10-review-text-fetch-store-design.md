# Design: Fetch & Store Written Review Text (PMS Task 5)

**Date:** 2026-08-10
**PMS task:** "Fetch and store written review text from account links; feed Ask AI trend detection" (`cmsj4nvou000i0ai45y5rbwpa`)

## Scope

This task covers **fetch + store only**. The PMS description's "feed Ask AI trend detection"
follow-on is deliberately deferred to its own future task — designing an analysis feature
against review text that doesn't exist in the database yet would be guesswork. Once real
text is flowing, a follow-on task can design the Ask AI extension against real data.

This task was reordered to run *before* PMS Task 1 ("Add Original Review Content with
On-Demand English Translation in Edit Modal") because Task 1 has nothing to display or
translate without this landing first. Task 7 ("Build Review Accounts analysis overview")
is also a downstream consumer of the data this task stores.

## Current state (confirmed by reading the code, not assumed)

- `entries.data` (jsonb) has **zero** field for written review text today — every existing
  TP/AG/CG/WO field is a status, date, score, link, or username column
  (`src/lib/tab-configs.ts`'s `TAB_COLUMN_CONFIGS`, `src/lib/scoreSummary.ts`'s
  `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS`).
- The existing Selenium checkers (`scripts/check_review_status.py` [TP],
  `scripts/check_ag_status.py` [AG], `scripts/check_cg_status.py` [CG],
  `scripts/check_wo_status.py` [WO]) already navigate to each account's review page/link
  to determine Live/Removed/Refused status, but none of them ever isolate or read the
  actual review body text:
  - **TP**: `_from_next_data()` parses a structured `review` object out of the page's
    `__NEXT_DATA__` JSON blob to read `state`/`status`/`stars` — this object likely also
    carries the review text, but the code today never reads that field.
  - **AG/CG/WO**: prove a review exists via a whole-page `body.text` substring search for
    the account's username, then slice raw HTML `[idx-500:idx+1500]` around the match
    purely to regex-extract a star rating. No DOM element is ever isolated; the slice is
    discarded after the rating regex.
- Only TP runs unattended (daily cron, all tabs, `docs/ec2-scraper-runbook.md`). AG/CG/WO
  only run when a human clicks "Check Status" in the dashboard.
- Writes go via `update_entry()` in `check_review_status.py` (shared pattern across all
  four scripts): `PATCH /rest/v1/entries?id=eq.<id>` with `payload.data = {**data, **updates}`
  — a **merge**, not a replace. Any key omitted from `updates` is left untouched in `data`.

## Data model

New jsonb keys on `entries.data`, matching the existing per-platform field naming exactly:

- `TP Review Text`
- `AG Review Text`
- `CG Review Text`
- `WO Review Text`

No migration needed — jsonb requires no schema change, consistent with how every other
per-platform field (`AG Review Link`, `CG User`, etc.) already lives inside `data` with no
dedicated column. No history/versioning table — a single "latest known text" value per
platform is sufficient for correlation analysis against final status and for Task 1/Task 7's
display needs; the PMS description's edit-history angle isn't a stated requirement.

These keys are **not** added to any tab's `TAB_COLUMN_CONFIGS` — they stay invisible in
`BrandGroup.tsx`'s table. This matches Task 1's explicit requirement that review content
never appears in the table, only in a modal.

### Frontend accessor

Add to `src/lib/scoreSummary.ts`, mirroring `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS`:

```ts
export const PLATFORM_REVIEW_TEXT_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Text'],
  ag: ['AG Review Text'],
  cg: ['CG Review Text'],
  wo: ['WO Review Text'],
};

export function getReviewText(data: Record<string, string | null>, platform: Platform): string | null {
  return pick(data, PLATFORM_REVIEW_TEXT_KEYS[platform]);
}
```

Task 1 and Task 7 both read through `getReviewText()` rather than each hardcoding the key
name — this repo has hit multiple bugs from independently-written accessors silently
diverging (PMS Task 180, 174, 173 per `CLAUDE.md`'s task history).

## Extraction approach per platform

None of the four checkers isolate a review-card element today — this is genuinely new
logic per platform, and the exact selectors/JSON keys below are confirmed by inspecting
real live pages during implementation (via the dry-run mode, before any writes go live),
not guessed in advance:

- **TrustPilot**: extend `_from_next_data()` to also read the review body field from the
  same `review` object it already parses for `state`/`stars` (exact field name — `text`,
  `body`, or `title` — confirmed live). If the page falls back to the text-signals path
  (no `__NEXT_DATA__` present), there's no structured text to extract for that fetch —
  text stays unset; status detection is unaffected either way.
- **AskGamblers / CasinoGuru / Wizard of Odds**: once the existing username substring
  match succeeds, locate the DOM element containing the match (`driver.find_elements` /
  XPath text search), walk up to the enclosing review-card container, and extract that
  container's clean rendered text. CasinoGuru's existing guard against the
  `tooltip-user-row` "helpful" widget false-positive (`_find_authored_context`) is kept
  and reused for the new extraction, not just the rating regex.
- **All platforms**: extraction is wrapped in its own try/except, independent of
  status/rating parsing. A text-extraction failure never blocks or corrupts the existing
  status write — status/rating behavior is unchanged by this task.

## Write path & re-fetch behavior

Reuses `update_entry()` unchanged in shape — the review-text key is simply included in
`updates` when extraction succeeds, and **omitted** when it doesn't (blocked page, review
removed, no structured text found). Because `update_entry()` merges (`{**data, **updates}`),
omitting the key leaves whatever was previously stored untouched — no explicit "don't
overwrite" branch needed.

Cadence:
- **TP**: refreshes automatically every day (existing unattended cron, all tabs) for every
  live/pending review — catches text edits made after the first successful fetch.
- **AG/CG/WO**: only refreshes on a manual "Check Status" click for that tab, same
  limitation the existing status/rating checks already have. Not a new gap this task
  introduces.
- Once a review is Removed/Refused and the page no longer shows the text, the
  last-known text stays stored (via the omit-from-updates behavior above) — this is the
  exact text correlation analysis needs to keep.

### `--dry-run` parity

`check_review_status.py` already has a `--dry-run` flag (prints intended changes, no
write). `check_ag_status.py`/`check_cg_status.py`/`check_wo_status.py` don't — add the same
flag to all three so every platform can be validated locally before any writes happen.

## Validation & rollout (this session)

1. Implement extraction in all 4 scripts + the frontend accessor.
2. Run each script locally with `--dry-run --tab <one real tab>` against real live
   accounts (local Selenium/Chrome setup already confirmed working). Inspect the printed
   extracted text for a handful of real entries per platform for cleanliness (no
   timestamps/"helpful"-widget noise bleeding in).
3. Iterate on selectors locally until dry-run output looks right. No Supabase writes
   during this step.
4. Once satisfied, run one real (non-dry-run) pass locally against a small `--tab` scope
   to confirm writes land correctly in `entries.data` — checked via a direct Supabase read.
5. **No commit, no push, no EC2 deploy this session** — per standing instruction, this
   stays local until reviewed. EC2 deployment (the `scp` + crontab restart flow in
   `docs/ec2-scraper-runbook.md`) is an explicit later step, same as other pending EC2
   changes already tracked in this repo's history.
6. A real pytest suite already exists (`scripts/test_check_*.py`, 63 passing tests) for the
   pure/helper logic in these scripts (URL normalization, status resolution, bot-block
   detection, Supabase pagination, etc.) — corrected from this design's earlier assumption
   that no test suite existed. New pure functions this task adds (the TP `__NEXT_DATA__`
   text parser, the shared XPath-literal helper) get unit tests in that same suite; the
   Selenium DOM-walking extraction itself is not unit-tested, matching how `fetch_status`/
   `fetch_ag_review`/`fetch_cg_review`/`fetch_wo_review` have never been unit-tested either —
   validation for that piece is the dry-run + live-account spot-check above.

## Explicitly out of scope

- Ask AI trend detection / writing-improvement suggestions (separate future task).
- Backfilling review text for every already-checked historical entry in one pass — TP's
  daily cron will backfill naturally within a day; AG/CG/WO only backfill as each tab is
  manually re-checked. A dedicated one-time backfill run is an operational decision for
  EC2 deploy time, not designed here.
- Translation UI (PMS Task 1, separate task — this task only guarantees one canonical
  original-language text field per platform for Task 1 to consume).
