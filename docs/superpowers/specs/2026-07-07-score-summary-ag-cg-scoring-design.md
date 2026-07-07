# Score Summary: Wire Up AG/CG Scoring (1-5 vs 1-10) — Design

**Date:** 2026-07-07
**Status:** Approved (design); pending implementation plan

## Problem

The Score Summary page (`/score-summary`) has a per-platform breakdown table
(5★/4★/3★/2★/1★ columns, average, and a rating pill) that is fully wired up
for TrustPilot but not for AskGamblers or CasinoGuru:

- `PLATFORM_SCORE_KEYS` in `src/lib/scoreSummary.ts` has real score field
  candidates for `tp` (`TP Score added`, `Score added`, etc.) but an **empty
  array** for `ag` and `cg`. Since `scoreKeys.length > 0` gates the lookup,
  every published AG/CG review is silently bucketed as "Unrated" today —
  switching the platform filter to AskGamblers or CasinoGuru never shows a
  real score breakdown, regardless of what's in the data.
- The `Star` type and every column/color/threshold in the summary table is
  hardcoded to a 1-5 scale. AskGamblers reviews are actually scored 1-10 on
  the site, so even once AG's score field is read, a 1-5-shaped table and
  1-5 rating thresholds would misrepresent it.
- Separately, there is currently **no way to enter an AG or CG score
  anywhere in the app** — not in the Add Review Account form, not in the
  Edit modal, not in any table column whitelist. The only trace of this
  field is a display-label mapping already sitting unused in
  `tab-configs.ts` (`'AG Score added' → 'AG Score'`, `'CG Score added' → 'CG
  Score'`), which was evidently prepared for a feature that was never
  finished.

## Goal

- CasinoGuru reads and summarizes on the same 1-5 scale as TrustPilot.
- AskGamblers reads and summarizes on its own 1-10 scale, with a table,
  color gradient, and rating-label thresholds that scale accordingly.
- Ops can actually enter `AG Score added` / `CG Score added` values through
  the dashboard (Add Review Account form and the Edit modal), the same way
  `Score added` already works for TP today.

## Non-Goals

- No visible table column in the main BrandGroup grid for AG/CG scores.
  TP's `Score added` is edit-only (not in any tab's column whitelist,
  confirmed via `HIDDEN_COLS` / absence from `TAB_COLUMN_CONFIGS`); AG/CG
  scores follow the same convention. Score Summary remains the only place
  scores are surfaced in aggregate.
- No input validation/range enforcement on the new score fields beyond what
  `parseScore` already does for TP (a value outside the valid range is
  simply treated as unrated, not rejected at entry time).
- No backfill or migration — this is a forward-looking data field. Existing
  entries with no `AG Score added` / `CG Score added` value just show as
  Unrated, same as they do today.
- No changes to `tab_schemas`/sync infrastructure. The Google Sheet
  connection is already fully disconnected (2026-07-07); these are
  dashboard-only fields going forward, force-inserted into the Edit modal
  the same way `AG Password`/`CG Password` already are.

## Design

### 1. Score computation — `src/lib/scoreSummary.ts`

- `Star` type generalizes from `1 | 2 | 3 | 4 | 5` to `number`.
- New exported constant:
  ```ts
  export const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5 };
  ```
- `PLATFORM_SCORE_KEYS` gains real keys for the other two platforms:
  ```ts
  ag: ['AG Score added'],
  cg: ['CG Score added'],
  ```
- `parseScore(raw, maxScore)` takes the platform's max as a parameter,
  accepts 1-2 digit numeric strings (so `"10"` parses for AG), and rejects
  anything outside `1..maxScore` — replacing the hardcoded `/^[1-5]$/`
  regex.
- `computeScoreSummary` looks up `maxScore = PLATFORM_MAX_SCORE[platform]`,
  initializes each bucket's `counts` for keys `1..maxScore`, and sums/
  averages generically over that range instead of 5 hardcoded terms.
- `ratingLabel(avg, maxScore = 5)` scales the Excellent/Great/Average/Poor
  cutoffs by `maxScore / 5`, so AG's thresholds come out to 9/8/6/4 (double
  TP/CG's 4.5/4.0/3.0/2.0). The bottom "Bad" tier stays an unscaled `>= 1`
  floor for every platform, since the minimum possible average is always 1
  regardless of scale — scaling it would leave low-but-real averages (e.g.
  1.2 out of 10) rendering as blank instead of "Bad".

### 2. Score Summary UI — `src/components/ScoreSummaryPanel.tsx`

- The star-column list (`STARS`) becomes derived per platform instead of a
  fixed `[5,4,3,2,1]` constant — `10,9,...,1` for AG, `5,4,...,1` for TP/CG.
- `STAR_COLOR`'s fixed 5-entry map generalizes to a tier function bucketing
  any star value into 5 color tiers (`Math.ceil(value / (maxScore / 5))`),
  so AG's 10 columns still read as the same green→amber→red gradient as
  TP/CG's 5.
- `maxScore` (derived once from `PLATFORM_MAX_SCORE[platform]`) threads
  down through `GroupedSummary` → `SummaryTable` / `GrandTotal` /
  `SummaryColgroup` / `computeColumnTotals`, replacing the hardcoded
  5-column assumptions in each.
- No layout changes beyond column count — the panel already wraps tables in
  `overflow-x-auto`, so AG's wider (10-column) table scrolls horizontally
  rather than squeezing column widths.

### 3. Data entry

- **`src/components/AddReviewAccountModal.tsx`**: add to `AG_FIELDS`:
  `{ key: 'AG Score added', label: 'AG Score (1-10)' }`; add to `CG_FIELDS`:
  `{ key: 'CG Score added', label: 'CG Score (1-5)' }`. Both render as plain
  text inputs via the existing generic `renderField` fallback — no new
  field-type flag needed, matching how TP's `Score added` field works.
- **`src/pages/BrandGroup.tsx`**: add two entries to
  `DASHBOARD_ONLY_MODAL_FIELDS`:
  ```ts
  ['AG Review Status', 'AG Score added'],
  ['CG Review Status', 'CG Score added'],
  ```
  This force-inserts the fields into the Edit modal's header list right
  after their respective status field, even though they won't exist in
  `tab_schemas` for any entry yet (same mechanism already used for `AG
  Password` / `CG Password`).
- **`src/components/EditEntryModal.tsx`**: no changes. `sectionOf()`'s
  existing generic fallback (`l.startsWith('ag ')` / `l.startsWith('cg ')`)
  already buckets `AG Score added` / `CG Score added` into the right
  section once they appear in `headers`, and `getColLabel` already resolves
  their display label via the `COLUMN_LABELS` entries that already exist in
  `tab-configs.ts`.
- **`src/lib/tab-configs.ts`**: no changes. The `'AG Score added' → 'AG
  Score'` / `'CG Score added' → 'CG Score'` label mappings already exist;
  no whitelist entry is added (see Non-Goals).

### Files touched

- `src/lib/scoreSummary.ts`
- `src/components/ScoreSummaryPanel.tsx`
- `src/components/AddReviewAccountModal.tsx`
- `src/pages/BrandGroup.tsx`

## Testing

- Manual: add an AG entry with a score via Add Review Account, confirm it
  saves and is editable via the Edit modal; switch Score Summary to
  AskGamblers and confirm the 10-column breakdown, average, and rating
  pill look correct. Repeat for CG on the 1-5 scale. Confirm TP's existing
  behavior is unchanged (regression check on the shared `computeColumnTotals`
  / `ratingLabel` generalization).
- Verify with `npm run build` (per project convention — `tsc --noEmit` alone
  doesn't catch issues here since the root tsconfig is references-only).
