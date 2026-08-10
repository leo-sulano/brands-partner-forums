# Design: Manual Review Text Entry in Edit Modal

**Date:** 2026-08-10

## Scope

Extends the just-shipped "Original Review Content + On-Demand English Translation" feature
(PMS Task 1, merged to `main` earlier today) so review text in the Edit Entry modal can be
manually typed/edited by a human, not just auto-populated by the Selenium scrapers. Requested
as a prerequisite before running the scrapers live against real production data, so a team
member has a way to fill in or correct review text directly if a scrape comes back empty or
wrong.

## Current state

- `ReviewTextBlock.tsx` is display-only — the earlier design spec explicitly listed "Editing
  review text through this modal" as out of scope.
- Review text lives in `entries.data` jsonb as `TP/AG/CG/WO Review Text` keys, written only by
  the four Python Selenium scrapers via `update_entry()`'s merge-PATCH (a key is included in
  the write payload only when extraction succeeds and differs from the current value).
- `EditEntryModal.tsx`'s save flow only ever writes fields present in its `headers` prop.
  `BrandGroup.tsx`'s `REVIEW_TEXT_KEYS` constant explicitly excludes the four keys from both the
  modal's dynamic "extras" fallback and duplicate-entry copying — there is currently no code
  path that could save a manually-typed review-text value even if someone tried.
- `BrandGroup.tsx` already has an established pattern for adding a dashboard-only field with no
  Sheet/`tab_schemas` origin into the modal's `headers` array (`DASHBOARD_ONLY_MODAL_FIELDS`,
  plus ad-hoc `if (!hdrs.includes(x)) hdrs.push(x)` checks for `'Agent'`/`'Brand Link'`) — this
  design reuses that same mechanism rather than inventing a new one.

## Decisions

- **The scraper always wins.** If a human manually edits review text and saves it, and the
  scraper later successfully extracts real text from the live page, it overwrites the manual
  value exactly as it already does for every other scraped field today. No new "locked"/"manual"
  flag, no scraper-side changes at all — manual entry is a stopgap until the real scrape lands,
  not a permanent override.
- **Always an editable textarea**, not a read-only view with an edit toggle — consistent with
  every other field in this modal, no extra UI state to build.
- **Editing clears any shown translation.** Since translation is already ephemeral (never
  persisted, per the original design), typing in the textarea immediately clears `translated`/
  `error` state so a stale translation never sits next to edited original text.
- Applies uniformly to all four platforms via the same `ReviewTextBlock` component — no
  per-platform special-casing beyond what already exists (the TP/WO section ternary).

## Design

### 1. `BrandGroup.tsx` — include review-text keys in the modal's `headers`

For each platform in `getTabPlatforms(decodedTab)` (already imported), push that platform's
canonical review-text key — `PLATFORM_REVIEW_TEXT_KEYS[p][0]` (already imported) — onto the
`hdrs` array being built for `EditEntryModal`'s `headers` prop, if not already present. Placed
alongside the existing `'Agent'`/`'Brand Link'` "always show this column" checks. No positional
splicing needed (unlike `DASHBOARD_ONLY_MODAL_FIELDS`) since `ReviewTextBlock` renders via its
own explicit JSX call site, not the generic per-header loop — only inclusion in `headers` matters,
not position.

### 2. `EditEntryModal.tsx` — exclude from generic rendering, wire to `fields` state

Extend the existing `visibleHeaders` filter (which already excludes `brandCol` from the generic
`sections.X.map(renderField)` loop) to also exclude the four canonical review-text key names, so
they don't render a second time as a plain `<input>`. The three existing `ReviewTextBlock` call
sites (TP/WO, AG, CG sections) switch from a one-way `text={getReviewText(entry.data, platform)}`
read to a controlled pair: `value={fields[key] ?? ''}` and
`onChange={(v) => setFields((f) => ({ ...f, [key]: v }))}` — the exact key string already used
elsewhere (`'TP Review Text'`, `'AG Review Text'`, `'CG Review Text'`, `'WO Review Text'`).
Because `fields` already initializes from `entry.data[h]` for any header via the existing init
loop, and `handleSave` already writes `out[h] = fields[h] || null` for every header, this needs
no new save logic — inclusion in `headers` (Section 1) is what makes the existing mechanism pick
these keys up automatically. `getReviewText`/`PLATFORM_REVIEW_TEXT_KEYS` imports are no longer
needed in this file specifically (still used elsewhere, e.g. `scoreSummary.ts` itself and any
future analysis-overview consumer) since there's only ever one canonical key name per platform
for review text (no multi-variant fallback like TP's status column has).

### 3. `ReviewTextBlock.tsx` — editable textarea, clear translation on edit

Props change from `{ text: string | null }` to `{ value: string; onChange: (v: string) => void;
disabled?: boolean }` (the `disabled` prop matching the `disabled={saving}` pattern every other
field in this modal already receives). The read-only styled `<div>` becomes a `<textarea>` bound
to `value`/a wrapped `onChange` handler that both calls the passed-in `onChange` and clears
`translated`/`error` local state. The static "No review content available." message is replaced
by the textarea's own `placeholder` attribute (e.g. "No review content yet — type one here") —
an empty editable textarea already communicates absence, a separate paragraph is no longer
needed. The Translate button, language-detection gate, and error/translation display all stay
as-is, operating on the live `value` prop instead of the old static `text` prop.

### Explicitly out of scope

- Any scraper-side change (Python files untouched — the "scraper always wins" decision means no
  new flag, no new merge logic).
- Persisting translations (unchanged from the original design).
- Any change to the review table or duplicate-entry exclusion — those stay exactly as Task 1
  left them; this task only changes what happens inside the modal.

## Testing

`ReviewTextBlock`'s translation-clears-on-edit behavior and placeholder text are pure JSX/state
changes with no new pure-logic function to unit test (matching this repo's established
convention — no component-rendering test precedent, not introduced here either). Verify via
`npm test` + `npm run build` for regressions, and a live check (credentials permitting) that
typing in the textarea and saving actually persists to `entries.data`.
