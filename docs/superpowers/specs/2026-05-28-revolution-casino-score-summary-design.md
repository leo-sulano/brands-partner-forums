# Revolution Casino — Score Summary Panel

**Date:** 2026-05-28
**Scope:** A per-brand TrustPilot star-rating summary panel on the Revolution Casino tab page. First brand-group only; config-driven so adding more later is a one-line change.

---

## 1. Problem

The Revolution Casino tab lists individual reviewer-account entries. There is no in-app way to see, for each sub-brand under the tab (Revolution Casino, Midarion, …), how many published TrustPilot reviews exist at each star level (1–5), what the average rating is, or how those numbers change over a chosen date range. Today this report is maintained by hand in a separate Google Sheet ("Revolution Casino - Forum score monitoring"). The goal is to compute and display the same summary directly from the dashboard's existing entries data.

## 2. Goals / Non-goals

**In scope:**
- Per-brand star-count breakdown (5★, 4★, 3★, 2★, 1★) for the Revolution Casino tab.
- Total review count, average rating (1 decimal), and TrustPilot-style rating label per brand.
- Date-range filter applied to the review's TrustPilot post date, with quick presets.
- Counts include only entries whose `TP Review Status` is "Published".

**Out of scope (explicit non-goals):**
- AskGamblers / CasinoGuru summaries.
- Bar charts of star distribution.
- Period-over-period comparison ("vs. last week" deltas).
- CSV export.
- Other brand-group tabs (Rooster, Hanan, SuprPlay, …). The implementation is config-driven so future expansion is trivial; this spec does not enable them.
- Schema changes, new Supabase queries, or Edge Function changes.

## 3. User Experience

A new **Score Summary** panel appears above the existing entries table on `/brands/revolution-casino`. The panel is collapsible with a chevron toggle; it is open by default. On any tab not in the allowlist the panel is not rendered at all (no header, no whitespace).

Panel layout, top to bottom:

1. **Header row.** Title "Score Summary" on the left; collapse chevron on the right.
2. **Filter toolbar.** Two date inputs (`From`, `To`) reusing the existing `DatePicker` component, followed by preset chips: `Today`, `This week`, `This month`, `Last 7 days`, `Last 30 days`, `All time`. Default preset is `All time`. A small "Reset" text link appears next to the chips when any non-default preset or custom range is active.
3. **Brand cards.** One card per distinct non-empty `Brands` value among the entries. Cards are ordered alphabetically, with **Revolution Casino pinned first** when present. Each card shows:
   - Brand name (card title).
   - Left column: five rows, one per star level — `5★`, `4★`, `3★`, `2★`, `1★` — each with its count. All five rows always render, including zeros, for consistent vertical alignment across brands.
   - Right column: three label/value pairs:
     - `Total reviews` — sum of all five counts.
     - `Average` — weighted mean, one decimal place, or `—` when total is zero.
     - `Rating` — coloured pill with the TrustPilot label (see §4).
4. **Empty state.** If no brand has any qualifying review in the active range, the brand-card grid is replaced by a single muted line: "No published reviews in this range."
5. **Excluded-rows note.** When at least one entry was skipped because its star score or date could not be parsed, a small muted footer line reads: `N row(s) excluded (missing or unreadable score/date).`

The panel's filter state is local — changing it does not affect the entries table below.

## 4. Counting rules

For each entry on the Revolution Casino tab, read four fields from the entry's `data` object using the same fallback pattern as the rest of `lib/queries.ts`:

| Concept | Field keys tried in order |
|---|---|
| Brand | `Brands` |
| Status | `TP Review Status`, `Review Status` |
| Star score | `Score added`, `Score Added`, `Score` |
| Post date | `Trust Pilot` |

An entry is **counted** iff all of the following hold:

1. Brand value is a non-empty string after trimming. (Entries with blank brand are silently skipped — they do not appear as an "(Unassigned)" bucket.)
2. Status value, when lowercased and trimmed, equals `published`.
3. Star score parses to an integer in `1..5` inclusive. Non-numeric, decimals, zero, or out-of-range values cause the entry to be skipped and counted toward the excluded-rows footer.
4. Post date parses to a valid local date and falls within `[from, to]` inclusive when a custom range is active. Accepted input formats: `MM/DD/YYYY`, `M/D/YYYY`, `YYYY-MM-DD`. Anything else is treated as unparseable → entry skipped, excluded-rows footer incremented.

Average rating per brand: `sum(score_i × count_i) / total_count`, rounded to one decimal (`toFixed(1)`).

Rating label, applied to the average:

| Average range | Label | Pill colour (Tailwind) |
|---|---|---|
| 4.5 ≤ avg ≤ 5.0 | Excellent | `bg-emerald-50 text-emerald-700` |
| 4.0 ≤ avg < 4.5 | Great | `bg-green-50 text-green-700` |
| 3.0 ≤ avg < 4.0 | Average | `bg-amber-50 text-amber-700` |
| 2.0 ≤ avg < 3.0 | Poor | `bg-orange-50 text-orange-700` |
| 1.0 ≤ avg < 2.0 | Bad | `bg-rose-50 text-rose-700` |
| total = 0 | — (em dash, no pill) | n/a |

These bands match TrustPilot's public TrustScore labels.

## 5. Date range semantics

- The filter operates on the entry's TrustPilot post date only. `Status date` is intentionally ignored.
- `All time` (default) means no date constraint — every parseable date passes.
- Presets resolve relative to the user's local timezone (the dashboard already operates in local time elsewhere):
  - `Today` → from = to = today.
  - `This week` → from = Monday of current week, to = today.
  - `This month` → from = first of current month, to = today.
  - `Last 7 days` → from = today − 6, to = today (inclusive).
  - `Last 30 days` → from = today − 29, to = today (inclusive).
- Bounds are **inclusive** on both ends.
- Custom `from`/`to` values from the date inputs override any active preset; selecting a preset overwrites both inputs.

## 6. Code structure

### New files

- **`src/lib/scoreSummary.ts`** — pure module, no DOM and no Supabase imports.
  - `parseScore(raw: string | null | undefined): number | null` — returns 1–5 or null.
  - `parsePostDate(raw: string | null | undefined): Date | null` — handles the formats listed in §4.
  - `ratingLabel(avg: number | null): RatingLabel | null` — applies the bands in §4.
  - `computeScoreSummary(entries: Entry[], range: { from: Date | null; to: Date | null }): { brands: BrandSummary[]; excludedRows: number }` — the workhorse.
  - Type exports: `RatingLabel`, `BrandSummary` (`{ brand: string; counts: Record<1|2|3|4|5, number>; total: number; average: number | null; label: RatingLabel | null }`).
- **`src/components/ScoreSummaryPanel.tsx`** — presentational panel.
  - Props: `{ entries: Entry[]; tab: string }`. Returns `null` when `tab` is not in the allowlist.
  - Owns local state: `collapsed: boolean`, `from: Date | null`, `to: Date | null`, `activePreset: PresetKey | 'custom' | null`.
  - Calls `computeScoreSummary` in a `useMemo` keyed on entries + range.
  - Allowlist: `const SCORE_SUMMARY_TABS = new Set(['Revolution Casino']);` — exported from the same file so future expansion is one line.

### Modified files

- **`src/pages/BrandGroup.tsx`** — import `ScoreSummaryPanel` and render it once, just above the entries section, passing the entries already loaded by `fetchRawEntriesByTab` and the resolved tab name. No other changes.

No changes to: `src/lib/queries.ts`, `src/lib/supabase.ts`, `src/lib/realtime.ts`, `supabase/schema.sql`, any Edge Function, any types under `src/types/` other than (possibly) re-using `Entry`.

## 7. Testing

Pure-function tests for `src/lib/scoreSummary.ts` only — the UI panel is light and exercised manually. Covers:

- `parseScore`: accepts `'1'`–`'5'` and `1`–`5` numerics; rejects `'0'`, `'6'`, `'4.5'`, `''`, `null`, `'abc'`.
- `parsePostDate`: accepts `'05/18/2026'`, `'5/8/2026'`, `'2026-05-18'`; rejects `''`, `null`, `'not a date'`, `'2026-13-01'`.
- `ratingLabel`: boundary values 4.5, 4.49, 4.0, 3.99, 3.0, 2.99, 2.0, 1.99, 1.0; null avg → null label.
- `computeScoreSummary`:
  - Groups by `Brands`, skipping blank-brand rows.
  - Counts only `Published` rows (case-insensitive).
  - Respects `from`/`to` inclusivity (boundary dates included).
  - Returns the expected counts/total/average for a handcrafted fixture that matches the spreadsheet screenshot (Revolution Casino: 32/10/2/0/41 → 85 total → avg 3.3 → "Average"; Midarion: 29/15/3/1/8 → 56 total → avg 4.0 → "Great").
  - Increments `excludedRows` correctly for unparseable scores and dates, never for status-mismatched rows.
  - Empty input returns `{ brands: [], excludedRows: 0 }`.

UI: manual smoke check that the panel renders, presets update both date inputs, collapse toggle works, empty state appears when the range excludes all reviews, and the panel does not render on any other tab.

## 8. Risks & open questions

- **Sub-brand naming drift.** If the same brand is entered as "Revolution Casino" in some rows and "RevolutionCasino" / "revolution casino" in others, they will appear as separate cards. We trim and group case-sensitively for now; this matches how the entries table already presents the field. Normalising belongs in a separate cleanup if it becomes a problem.
- **Date-format drift.** If a future sheet column introduces another date format, parseable rows will start showing up in the excluded-rows footer. The footer makes that visible without breaking the UI.
- **Performance.** The Revolution Casino tab is far below the size where a client-side group-and-count over `entries` is a concern (well under 10k rows in any realistic future). No memoisation beyond `useMemo` on the filter+entries inputs is needed.
