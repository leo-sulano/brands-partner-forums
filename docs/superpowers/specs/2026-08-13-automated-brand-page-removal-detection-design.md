# Automated Brand Page Removal Detection

**Requested by:** Leo, via chat ("schedule daily to check the platform brand
page on all platforms, so we know if it's removed"). Scope worked out
interactively — see decisions below.

**Relationship to the 2026-08-12 spec** (`2026-08-12-brand-page-removal-notification-design.md`):
that spec added an email notification that fires when a *human* checks the
per-platform "page removed" checkbox in the Edit Entry modal. It does not
change how removal is detected — a human still has to notice it first. This
spec adds the missing piece: an automated daily check that detects the
removal itself and writes the same flag, so the email fires without anyone
having to notice manually. It depends on that spec's Edge Function
(`notify-brand-removed`) but does not require it to be deployed to be useful
on its own — see "Setup required."

## Current behavior (for reference)

- `removed_platform_brands` (`tab`, `brand`, `brand_key` generated,
  `platform`, `removed_by`, `removed_at timestamptz default now()`) is the
  sole source of truth for "is this brand's page removed on this platform."
  Written only via `setBrandPlatformRemoved(tab, brand, platform, removed)`
  (`src/lib/queries.ts`), called from `BrandGroup.tsx`'s Edit Entry save
  handler — `removed=true` upserts a row, `removed=false` deletes it.
- Real per-brand page URLs already exist in `src/lib/tab-configs.ts`:
  `BRAND_TP_URLS` (50 unique URLs, ~70 name-variant keys), `BRAND_AG_URLS`
  (22 unique URLs), `BRAND_CG_URLS` (21 unique URLs), and `TAB_BRAND_URLS`
  (per-tab overrides, e.g. Wizard of Odds' 7 URLs) — resolved via
  `getBrandTpUrl`/`getBrandAgUrl`/`getBrandCgUrl`.
- Automated scraping infrastructure already exists on an EC2 box
  ("scraper-leo", `docs/ec2-scraper-runbook.md`): `check_review_status.py`
  (TP), `check_ag_status.py`, `check_cg_status.py`, `check_wo_status.py` run
  weekly via cron (`0 1 * * 1`, Mon 09:00 Manila,
  `~/run_weekly_all_platforms.sh`). They check **individual review status**
  (Live/Removed/Refused) — a different, narrower concept from a brand's
  *entire page* disappearing from the platform. They use
  `undetected-chromedriver` (Selenium stealth) with per-entry proxy rotation
  (`build_driver`/`_build_proxy_extension` in `check_review_status.py`) —
  necessary because a plain HTTP request to TrustPilot returns HTTP 403
  (confirmed live during this spec's research).
- These scripts read/write Supabase directly via `requests` against the
  PostgREST API (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars, GET
  `/rest/v1/entries`, PATCH `/rest/v1/entries`) — no supabase-js, no
  frontend involvement.
- No automated check today detects a whole brand page being removed. This is
  a new capability, not an extension of an existing one.

## Detection signature: TrustPilot (verified against real data)

Confirmed live during this spec's research by loading a known-removed brand
(Prive Casino, flagged removed 2026-07-29) and a known-live brand
(Lucky7even) with an actual stealth browser session:

- **The naive approach is a trap.** Searching raw page HTML for
  "not found" / "404" / "doesn't exist" / "Sorry" matches on **both** pages —
  those strings sit unused inside TrustPilot's own JS i18n translation bundle
  on every page load, removed or not (e.g.
  `"business-profile-page/errors/parasiticseo/header":"This profile has been removed"`
  is present in the JSON blob even on a fully live page).
- **The real signal:** a rendered `<h1>` element whose text is exactly
  **"This profile has been removed"** — verified present only in the actual
  rendered DOM (via Selenium element `.text`, e.g.
  `driver.find_element(By.TAG_NAME, "h1").text`) on the removed page, and
  absent from the live page's rendered DOM despite the phrase existing
  unrendered in both pages' HTML source. Detection must read rendered
  element text, never `driver.page_source` substring matching — the latter
  would false-positive on every single brand, live or not.

## Detection signature: AskGamblers / CasinoGuru / Wizard of Odds (unverified — out of scope for this rollout)

Zero brands are currently flagged removed on any of these three platforms —
there is no real removed-page example to derive or verify a signature
against. Guessing a signature and shipping it untested risks either missing
real removals (under-detection) or, worse, false-positive removals that fire
a team-wide email about a brand that was never actually delisted. **This
spec ships TrustPilot detection only.** AG/CG/WO are added in a follow-up
once a real removed-page example exists on that platform to test against
(either a brand gets delisted for real and someone notices, or a low-risk
brand's page is deliberately used to test once one predictably disappears —
whichever comes first; not designed further here).

## Requirement (as clarified with the user)

1. A new daily scheduled job checks every brand's TrustPilot page (from
   `BRAND_TP_URLS`/`TAB_BRAND_URLS`) for the removed-page signature above.
2. On detecting removal for a `(tab, brand)` pair not already flagged
   removed for `platform='tp'`, the job **directly writes**
   `removed_platform_brands` (`removed_by = 'Automated Check'`) — the same
   effect as a human checking the box — then calls the `notify-brand-removed`
   Edge Function (2026-08-12 spec) with the same payload shape the frontend
   sends, so the existing email path fires without any app-side code change.
3. A `(tab, brand, platform)` already flagged removed is skipped entirely —
   no re-check, no repeat notification. This is a one-way, additive job.
4. The job **never clears** a flag, even if a later check finds the page
   live again. Un-flagging remains a manual, human-only action via the
   existing Edit Entry checkbox — matching the existing rule that clearing
   the flag never sends a notification either. A false negative here (the
   job wrongly thinks a genuinely-removed page is back) can therefore never
   un-flag a brand that should stay flagged; the failure mode is silence, not
   an incorrect automatic reversal.
5. A failed page load (network error, CAPTCHA/anti-bot challenge, proxy
   failure) is logged and skipped — **never** treated as "removed." This
   matters more here than in the existing per-review checkers: a false
   positive here immediately fires a team-wide email, not just an internal
   status change.

## Implementation

### New script: `scripts/check_brand_page_removed.py` (TP only)

Mirrors `check_review_status.py`'s structure and conventions
(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` env vars, `build_driver` stealth
Chrome + proxy rotation, `--tab`/`--dry-run` CLI flags, same error logging to
`status_check_errors.log`):

1. Resolve the distinct `(tab, brand)` pairs across all tabs from `entries`
   (same grouping every other cross-tab feature already computes) whose
   brand resolves to a URL via `BRAND_TP_URLS`/`TAB_BRAND_URLS`.
2. Fetch existing `removed_platform_brands` rows for `platform='tp'` (GET
   `/rest/v1/removed_platform_brands?platform=eq.tp`) and skip any
   `(tab, brand)` already present.
3. For each remaining `(tab, brand)`, load its TP URL with the stealth
   driver, check for the rendered "This profile has been removed" `<h1>`.
   - Found → upsert `removed_platform_brands` (POST with
     `Prefer: resolution=merge-duplicates`), then POST to
     `notify-brand-removed` with `{ tab, brand, platform: 'tp', removedBy:
     'Automated Check' }`. If the notify call fails, log it and continue —
     the flag write already succeeded and is never rolled back (matching the
     2026-08-12 spec's own best-effort framing, just logged instead of
     Toast-shown since this runs headless).
   - Not found (page loads normally, no removed heading) → no write, move
     on.
   - Load/detection error → log to `status_check_errors.log`, move on. Same
     brand is retried on the next day's run since no flag was written.
4. Print a summary (checked / newly flagged / skipped-already-flagged /
   errored counts) — same style as the existing scripts' run output.

### Brand-URL source: single source of truth, no duplicated map

`BRAND_TP_URLS`/`TAB_BRAND_URLS` live in TypeScript
(`src/lib/tab-configs.ts`); the Python script needs the same data. Rather
than hand-maintaining a second copy that can silently drift, a small export
step (`npm run export:brand-urls`, a short Node script using the existing
`getBrandTpUrl` logic) writes a JSON snapshot
(`scripts/brand_urls.generated.json`) the Python script reads. Re-run
whenever `tab-configs.ts`'s URL maps change; committed to the repo so the
EC2 box doesn't need a Node toolchain to consume it.

### Scheduling

New crontab entry on `scraper-leo`, daily (proposed `0 1 * * *`, 09:00
Manila, same time-of-day convention as the existing Monday weekly job, just
every day instead of once a week), running
`python3 check_brand_page_removed.py` directly — no shared script with the
weekly per-review checkers, since this checks a different, smaller set of
URLs (one page per brand, not one page per review) on a different cadence.

### Scale

50 unique TrustPilot brand pages today. At roughly 10-15 seconds per page
(navigation + settle time, matching the existing scripts' pacing) plus
sequential proxy rotation, a full run is on the order of 10-15 minutes —
comfortably fits a daily cron slot.

## Out of scope

- AskGamblers, CasinoGuru, Wizard of Odds detection (no verified signature
  yet — see above).
- Any change to `removed_platform_brands`' schema, RLS, or existing
  consumers (`PlatformRemovedBadge`, Score Summary, Schedule Planner) — this
  is purely a new writer using the existing write shape.
- Auto-clearing a flag when a page is later found live again (manual-only,
  per the user's explicit decision).
- Retrying a failed `notify-brand-removed` call — best-effort, logged, same
  as the 2026-08-12 spec's own frontend failure handling.
- Any change to the existing per-review `check_review_status.py` /
  `check_ag_status.py` / `check_cg_status.py` / `check_wo_status.py` scripts
  or their weekly schedule.

## Testing approach

- Unit tests for the removed-page detection function: real saved HTML/DOM
  fixtures from this spec's own research (the removed Prive Casino page and
  the live Lucky7even page) as regression fixtures, so the "must read
  rendered text, not raw HTML" requirement can't silently regress back to
  the naive substring-matching trap.
- Unit tests for the skip-already-flagged logic and the upsert payload
  shape, mocking the Supabase REST calls (matching this repo's existing
  Python test style, e.g. `test_check_review_status.py`).
- Dry-run flag (`--dry-run`, matching existing scripts) prints what would be
  flagged/notified without writing — first real run against production
  should use this to sanity-check the count of newly-detected removals
  before trusting it unattended.
- No component/integration test changes needed on the frontend side — this
  script writes into an existing, already-tested data shape
  (`removed_platform_brands`) via the existing write path's exact effect.

## Setup required (cannot be done by an agent)

1. This feature's email step depends on `notify-brand-removed` being
   deployed (2026-08-12 spec's own pending setup: Resend account, API key,
   `supabase secrets set RESEND_API_KEY`, `supabase functions deploy
   notify-brand-removed`) — until then, the daily job still correctly writes
   `removed_platform_brands` (so the dashboard's existing badges/exclusions
   work immediately), it just logs a failed notify call every time until
   that Edge Function exists.
2. New crontab entry on `scraper-leo` (`crontab -e`, per
   `docs/ec2-scraper-runbook.md`'s existing pattern) — needs to be added by
   hand on the actual EC2 box, same as the pending `generate-weekly-schedule`
   cron from the 2026-08-06 task.
3. First live run should be `--dry-run` first, reviewed by a human, before
   ever being trusted to auto-flag and email unattended.
