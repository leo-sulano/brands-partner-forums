# Platform Score Star — Design

## Purpose
On the brand-group table (`BrandGroup.tsx`), the "View" link pill for TP, AG, and CG review-link
columns currently gives no indication of whether that review has a score recorded. Add a small
star icon next to "View" when a valid score exists, colored to match that platform's existing
color used elsewhere in the app.

## Scope
- TP link column (`Link to the profile`, only when the current tab is not `Wizard of Odds`)
- AG link column (`AG Review Link`)
- CG link column (`CG Review Link`)
- Wizard of Odds is explicitly out of scope (it reuses `Link to the profile` for a different
  platform, and was not requested).

## Behavior
1. For each of the three link columns above, resolve the row's score using the existing
   `PLATFORM_SCORE_COLS[platform]` candidate list and `parseScore(raw, PLATFORM_MAX_SCORE[platform])`
   (both already imported into `BrandGroup.tsx` and already used for the Score Summary rating
   filter at `BrandGroup.tsx:1218-1224`).
2. If a valid score is found (1..max for that platform), render a filled `lucide-react` `Star`
   icon immediately after the "View" text inside the same pill.
3. Star color matches the platform's existing color from `PLATFORM_OPTS` (`BrandGroup.tsx:298-303`):
   - TP → `text-blue-500`
   - AG → `text-amber-500`
   - CG → `text-violet-500`
4. The star has a `title` attribute showing the raw score, e.g. `Score: 4/5` (TP/CG) or
   `Score: 7/10` (AG).
5. If no valid score exists, the pill renders exactly as it does today — no star, no layout
   change, no regression to existing behavior (including the existing AG/CG "no review → em dash"
   short-circuit in `CellValue`).

## Implementation notes
- All changes are confined to `src/pages/BrandGroup.tsx`.
- `CellValue` gains a new prop, `tab: string`, so it can distinguish TP's `Link to the profile`
  from Wizard of Odds' use of the same header. All ~6 call sites already have `decodedTab` in
  scope and just need to pass it through.
- A small local helper maps `(header, tab) → platform | null`.
- No changes to Supabase schema, `lib/queries.ts`, or types — this is presentation-only, reusing
  score data that's already fetched as part of `entry.data`.

## Out of scope
- Wizard of Odds link column.
- Any change to how scores are parsed, stored, or summarized (Score Summary page untouched).
- Graduated star coloring by score value (explicitly rejected in favor of binary
  has-score/no-score per user's answer during brainstorming).
