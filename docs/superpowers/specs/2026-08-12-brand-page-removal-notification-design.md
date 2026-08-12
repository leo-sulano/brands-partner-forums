# Brand Page Removal — Email Notification + Page Removed Status

**PMS task:** "Brand Removal Email Notification" (`cmsg97y4h000204l97ycegnjg`, To Do) — no
description on the card; scope below was worked out interactively with the user.

**Scope note:** This is about a brand's whole page being delisted from a platform (the
existing `removed_platform_brands` flag, toggled by hand via the Edit Entry modal's
per-platform checkbox) — **not** an individual review's status flipping to
Removed/Refused via Check Status. Those are two different concepts in this codebase;
the first draft of this spec conflated them before the user corrected it.

## Requirement (as clarified with the user)

1. When a user checks a "page removed" checkbox for a platform (TP/AG/CG/WO) on a brand
   and saves, every approved dashboard user gets an email notifying them the page was
   removed. Un-checking (clearing the flag) does not send anything.
2. The Edit Entry modal's per-platform checkbox is relabeled from `{Platform} page
   removed` to `{Platform} Page Removed Status`, and once checked, shows the removal
   date in the label.
3. Brand Tabs' CSV/Excel export gains one new column per platform active on the tab
   (`TP Page Removed Status`, `AG Page Removed Status`, `CG Page Removed Status`, `WO
   Page Removed Status`), holding the removal date (or blank) for that row's brand.

## Current behavior (for reference)

- `removed_platform_brands` (`tab`, `brand`, `brand_key` generated, `platform`,
  `removed_by`, `removed_at timestamptz default now()`) is the sole source of truth for
  "is this brand's page removed on this platform" — a row's existence is the flag.
  `removed_at` already exists on the table (carried over from the original
  `removed_tp_brands` design) but nothing reads it today.
- `setBrandPlatformRemoved(tab, brand, platform, removed)` (`src/lib/queries.ts`) is the
  only write path: `removed=true` upserts a row (`removed_by` = current user's email,
  `removed_at` defaults to `now()`); `removed=false` deletes it. Called only from
  `BrandGroup.tsx`'s Edit Entry save handler, once per platform, diffed against the
  entry's prior flagged state so an unrelated platform's row is never touched.
- `fetchRemovedPlatformBrands()` selects `tab, brand, platform` only (no `removed_at`).
  Used by `BrandGroup.tsx`, `ScoreSummary.tsx`, `SchedulePlanner.tsx` (via
  `queries.test.ts` coverage) — each builds its own `Set`/consumes independently.
- `buildRemovedPlatformBrandSet(rows)` (`src/lib/removedPlatformBrands.ts`) turns those
  rows into a `Set<string>` of `platformRemovedKey(tab, brand, platform)` — membership
  only, no date. **9 files** import from `removedPlatformBrands.ts` — this function's
  signature/return type must not change.
- `EditEntryModal.tsx` renders one checkbox per tab platform directly (not through the
  generic per-header `headers`/`sectionOf` field loop — this state is derived, not part
  of `entries.data`): `checked={removedPlatforms.has(p)}`, label `{PLATFORM_LABEL[p]}
  page removed`. Backed by a plain `Set<Platform>` state seeded from
  `initialRemovedPlatforms` (a bare `Platform[]`, no date carried).
- `BrandGroup.tsx`'s `exportHeaders` (Task 208) is built purely from `entries.data` keys
  (`fullHeaders` ∪ `headers`), bucketed via `entryFieldSections.ts`'s `sectionOf` into
  Account → TP → AG → CG → Behavior Flags. It has no concept of a synthetic,
  non-`entries.data` column — `removed_platform_brands` data isn't reachable from
  `buildBrandRowsForExport` at all today.
- No email-sending infrastructure exists anywhere in this project. Supabase Auth's
  built-in emailer only fires for login/signup/reset — unrelated and not reusable here.

## 1. Email notification

New Edge Function `supabase/functions/notify-brand-removed/index.ts`:

- **Trigger:** called from `BrandGroup.tsx` immediately after `setBrandPlatformRemoved(tab,
  brand, platform, true)` resolves successfully. Not called on `removed=false`. If the
  Edge Function call itself fails, the flag write has already succeeded — no retry
  queue; this is a rare manual action, not a critical pipeline, and the failure is
  surfaced via the existing Toast error pattern this page already uses for other
  best-effort side calls.
- **Request body:** `{ tab, brand, platform, removedBy }` — everything the function
  needs is already known client-side at the moment of the call; no extra DB read
  required (the removal is happening right now, so "now" formatted client-side is used
  as the display timestamp — no need to re-query `removed_at` for the email).
- **Recipients:** `select email from profiles where approved = true` (service-role
  client, same pattern as other Edge Functions in this project).
- **Sending:** Resend's HTTP API (`https://api.resend.com/emails`), auth via a new
  `RESEND_API_KEY` Supabase secret. Requires the user to create a Resend account and
  either verify a sending domain or start with Resend's sandbox sender
  (`onboarding@resend.dev`, deliverable only to the account's own verified email until a
  domain is verified) — this cannot be done by an agent; documented as a manual setup
  step, same as the AI Assistant's `OPENAI_API_KEY` setup note.
- **Email content:**
  - Subject: `[Forums Dashboard] {brand} — {PLATFORM_LABEL[platform]} page removed on {tabDisplayName(tab)}`
  - Body (plain text or minimal HTML): brand, platform, tab, flagged by (`removedBy`),
    removal time, a link back to `/brands/{tabToSlug(tab)}?brand={brand}` (reuses the
    exact deep-link pattern `SchedulePlanner.tsx`'s brand-name link already uses).
- **Failure/edge cases:** an empty `profiles` (approved=true) result sends nothing and
  returns success (nothing to notify, not an error). A Resend API error is caught,
  logged, and returned as a non-2xx so the client's Toast can show a
  "flag saved, but the notification email failed to send" message — the flag itself is
  never rolled back.

## 2. Edit Entry modal

`EditEntryModal.tsx`'s per-platform checkbox block:

- Label changes from `{PLATFORM_LABEL[p]} page removed` to `{PLATFORM_LABEL[p]} Page
  Removed Status`, and — only when `removedPlatforms.has(p)` — appends the formatted
  date: `{PLATFORM_LABEL[p]} Page Removed Status ({formatCellValue(removedDates[p])})`.
- New prop `initialRemovedPlatformDates?: Partial<Record<Platform, string>>` (raw
  `removed_at` ISO strings, keyed by platform), passed alongside the existing
  `initialRemovedPlatforms`. No new state needed beyond storing this prop as-is (it's
  read-only display — the date isn't editable, it's a side effect of when the checkbox
  was checked).
- `BrandGroup.tsx` computes this the same way it already computes
  `initialRemovedPlatformsForEditEntry`, from a new date-lookup (below) keyed by the
  edited entry's own brand name.

## 3. Data layer: exposing `removed_at`

- `fetchRemovedPlatformBrands()` (`src/lib/queries.ts`): select list becomes `'tab,
  brand, platform, removed_at'`; return type gains `removed_at: string`. Purely
  additive — the 3 existing consumers destructure only the fields they use today and
  are unaffected.
- New `buildRemovedPlatformBrandDateMap(rows)` in `src/lib/removedPlatformBrands.ts`,
  alongside (not replacing) `buildRemovedPlatformBrandSet`:
  ```ts
  export function buildRemovedPlatformBrandDateMap(
    rows: { tab: string; brand: string; platform: Platform; removed_at: string }[],
  ): Map<string, string> {
    return new Map(rows.map((r) => [platformRemovedKey(r.tab, r.brand, r.platform), r.removed_at]));
  }
  ```
  `buildRemovedPlatformBrandSet`'s signature and return type are untouched — the 9
  existing importers of this module need zero changes.
- `BrandGroup.tsx` builds `removedPlatformBrandDateMap = useMemo(() =>
  buildRemovedPlatformBrandDateMap(removedPlatformBrandRows), [removedPlatformBrandRows])`
  alongside its existing `removedPlatformBrandSet` memo, from the same fetched rows
  (`removedPlatformBrandRows` state gains `removed_at` in its type).

## 4. Export column

`BrandGroup.tsx`'s `exportHeaders`/`buildBrandRowsForExport` call site:

- For each platform in `getTabPlatforms(decodedTab)` (tp/ag/cg/wo — whichever the tab
  actually has), a synthetic header string `${PLATFORM_SHORT_LABEL[platform]} Page
  Removed Status` (e.g. `"TP Page Removed Status"` — `PLATFORM_SHORT_LABEL`, not
  `PLATFORM_LABEL`, matching the user's own example and the existing short-code
  convention every other export column already uses, e.g. `"TP Review Status"`; the
  modal checkbox and email keep `PLATFORM_LABEL`'s full names, which is what they
  already use today) is added into `exportHeaders`'s `allFields`
  list *before* the existing scoping/bucketing step, not appended after. This isn't just
  simpler — `entryFieldSections.ts`'s `sectionOf()` fallback heuristics already classify
  a string starting with `"tp "`/`"ag "`/`"cg "` into that platform's bucket (confirmed:
  `"tp page removed status"` matches `l.startsWith('tp ')`), and `"wo "` matches no
  branch and falls through to `account` — exactly the placement this spec wants, with
  zero new bucket-placement code. It also means these columns automatically respect the
  existing Platform-filter narrowing (`exportHeaders`' `scoped` filter) the same way TP/AG/CG's
  real columns already do, with no separate logic to keep in sync.
- `buildBrandRowsForExport` (`src/lib/brandExport.ts`) gains an optional 4th parameter
  so it can resolve these synthetic headers without becoming tab/brand-aware itself:
  ```ts
  export function buildBrandRowsForExport(
    entries: Entry[],
    headers: string[],
    tab: string,
    resolvePlatformRemovedDate?: (entry: Entry, header: string) => string | null,
  ): string[][]
  ```
  For each header, if `resolvePlatformRemovedDate` is provided and returns non-null for
  that `(entry, header)` pair, use that value (already formatted); otherwise fall back
  to the existing `entry.data[header]` / `Country` logic unchanged.
- `BrandGroup.tsx` passes a resolver built from a small header→platform reverse map
  (e.g. `{ 'TP Page Removed Status': 'tp', ... }`, only for the tab's active platforms)
  plus `removedPlatformBrandDateMap` + the entry's resolved brand name (same brand-name
  resolution `isPlatformRemoved` already uses) + `formatCellValue` for date formatting.
  Blank (`''`) when the entry's brand+platform isn't in the date map.

## Out of scope

- No change to `removed_platform_brands`' semantics, RLS, or its existing consumers
  (`PlatformRemovedBadge`, Score Summary's per-platform exclusion, Schedule Planner's
  hide logic) beyond the additive `removed_at` select.
- No retry/queue for failed notification emails — best-effort, surfaced via Toast.
- No email preferences/opt-out per user — every approved user gets every notification.
- No notification for the platform-removed flag being *cleared*.
- No change to the individual-review Removed/Refused status path (Check Status) — this
  spec is exclusively about the whole-page-removed flag.
- Brand Tabs' on-screen table is unaffected — these synthetic columns are export-only
  (and the modal label), never rendered as a table column.

## Testing approach

- `removedPlatformBrands.test.ts` — extend with `buildRemovedPlatformBrandDateMap` cases
  (empty input, one row, multiple platforms for the same brand, key format matches
  `buildRemovedPlatformBrandSet`'s).
- `brandExport.test.ts` — extend `buildBrandRowsForExport` cases: no resolver behaves
  exactly as before (regression-lock); a resolver that returns a date for a matching
  header; a resolver that returns null falls back to `entry.data`.
- New `supabase/functions/notify-brand-removed/index.test.ts` (Deno), mocking the
  Supabase client and Resend fetch call: sends to every approved profile's email;
  zero approved profiles → success, no fetch call; Resend API error → non-2xx response,
  no throw.
- Edit Entry modal: manual/live check only (this project doesn't have component-render
  tests for modals) — verify the label text before/after checking a platform, confirm
  the date format matches `formatCellValue`'s existing date rendering.
- Full existing suite must stay green — this is a pure-additive change to
  `removedPlatformBrands.ts`/`queries.ts`/`brandExport.ts`.

## Setup required (cannot be done by an agent)

1. Create a Resend account (resend.dev), get an API key.
2. Either verify a sending domain in Resend, or accept that until one is verified,
   Resend's sandbox sender can only deliver to the account owner's own verified email —
   fine for initial testing, not for real team-wide delivery.
3. `supabase secrets set RESEND_API_KEY=re_...`
4. `supabase functions deploy notify-brand-removed`
