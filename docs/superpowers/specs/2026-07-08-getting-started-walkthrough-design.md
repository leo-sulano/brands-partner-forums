# Getting Started Walkthrough — Design Spec

**Date:** 2026-07-08
**Status:** Approved

## Overview

Add a "Getting Started" walkthrough to the top of the How It Works page ([src/pages/HowItWorks.tsx](../../../src/pages/HowItWorks.tsx)), above the existing Features grid. It covers the four flows a new user needs first: logging in, adding an entry, editing an entry, and running Check Status. Since there's no video/screen-recording tool available, the walkthrough is illustrated with one animated GIF captured from the real app via a one-time Playwright script, checked into the repo as a static asset and re-run manually whenever the UI changes enough to make it stale.

## Page Content: `src/pages/HowItWorks.tsx`

New section inserted before the `Features` section, following existing card conventions (`rounded-xl border border-slate-200 bg-white shadow-sm`, eyebrow text `text-xs font-semibold uppercase tracking-widest text-slate-400`):

- Eyebrow: "Getting Started"
- The GIF (`public/getting-started.gif`), full width within the card, `<img>` with `alt` text summarizing the flow for accessibility
- Numbered steps below/beside the GIF, roughly:
  1. Log in with your approved account
  2. Open a brand tab from the sidebar
  3. Click **Add Review Account** to create a new entry
  4. Click an entry's account name to open **Edit Entry** and update it
  5. Click **Check Status** to run an automated check against the tracked platforms
  6. Watch the status column update once the check completes (Live / Removed / Pending / Done)

Data-driven as a small const array (mirrors the `FEATURES` pattern already in the file), not hardcoded JSX, so steps can be edited without touching layout.

## Capture Script: `scripts/capture-getting-started.mjs`

One-time, human-supervised dev script — not part of `npm run build`, not run in CI.

**New devDependencies:** `playwright` (browser automation) and `gifenc` (pure-JS animated GIF encoder — no ffmpeg/native binary dependency, keeping this runnable on Windows without extra tooling).

**New script command:** `"capture:demo": "node scripts/capture-getting-started.mjs"` in `package.json`.

**Inputs:** `CAPTURE_EMAIL` / `CAPTURE_PASSWORD` env vars (a real approved account, provided ad hoc at run time — never committed). Runs against `http://localhost:5173`, so `npm run dev` must already be running in another terminal.

**Demo tab:** a single constant (e.g. `DEMO_TAB = 'SilverPlay'`) hardcoded in the script, chosen during implementation by checking live row counts across the 11 tabs in [src/lib/tabs.ts](../../../src/lib/tabs.ts) and picking the smallest single-platform one (avoids the multi-platform Check Status dropdown and keeps the table screenshot uncluttered).

**Flow driven (fixed 1280×800 viewport for frame consistency):**

1. Navigate to `/login`, fill email/password (`input[type=email]`, `input[type=password]`), click **Sign In** → screenshot.
2. Land on Overview (`/`) → screenshot.
3. Navigate to the demo tab (`/brands/<slug>`) → screenshot.
4. Click **Add Review Account**, fill a clearly-marked entry (account name `"Demo Entry — safe to delete"`), screenshot the filled form, click **Add Account** → screenshot the new row in the table.
5. Click the new entry's account cell to open **Edit Entry**, change one field, screenshot, click **Save Changes** → screenshot the updated row.
6. Click **Check Status**, screenshot the `"Checking…"` / spinner state.
7. Screenshot an existing (non-demo) row in the same table that already shows a resolved status pill, as the "result" frame — real Check Status runs take too long and a demo entry has no real forum listing to resolve, so this frame illustrates the outcome without waiting on a live scrape.
8. **Cleanup (try/finally, always runs):** delete the demo entry via the UI's existing delete action so no demo data is left behind, regardless of whether earlier steps succeeded.

**GIF assembly:** the ~9 PNG frames are encoded into a single looping GIF via `gifenc`, with longer hold times (~1.5–2s) on frames that carry text to read (e.g. the filled form, the status result) and shorter holds (~0.8s) on transitional frames. Output written to `public/getting-started.gif`.

## Data Safety

- No production data is edited except the disposable demo entry, which is deleted at the end of every run (success or failure).
- The GIF will show real (non-demo) row data from the chosen demo tab in the background of table screenshots — this is the same data any approved user already sees in the app today, so it introduces no new exposure. Field values known to be sensitive (passwords) are already masked by the existing UI and will render masked in the screenshots too.
- Credentials are read from environment variables at run time only, never written to disk or committed.

## Files Changed

| File | Change |
|---|---|
| `src/pages/HowItWorks.tsx` | New "Getting Started" section (steps array + GIF) above the Features grid |
| `public/getting-started.gif` | New static asset, generated by the capture script |
| `scripts/capture-getting-started.mjs` | New one-time Playwright capture script |
| `package.json` | New `playwright` + `gifenc` devDependencies, new `capture:demo` script |

## Out of Scope

- Real narrated video — no tooling available for this; animated GIF is the closest equivalent.
- CI integration or automated re-capture on every deploy — this is a manual, human-supervised command re-run only when the UI changes enough to make the GIF stale.
- Masking/blurring background row data in the screenshots — not needed since it's data the viewer already has access to.
- Covering flows beyond login/add/edit/check-status (e.g. Score Summary, Ask AI, Admin Users) — those remain covered only by the existing Features grid blurbs.
