# CLAUDE Context — Brands Partner Forum

## Purpose
Internal brand-monitoring dashboard. Entries are created and edited directly in Supabase, the dashboard's sole data store with no external sync, and presented as an overview, per-mention detail, and a sync-status admin page.

## Tech Stack
Vite 6 · React 19 · TypeScript · Tailwind v4 · React Router v7 · Recharts · Supabase (Postgres + Edge Functions) · Vercel

## Project Structure
```
Brands Partner Forum/
├── src/
│   ├── main.tsx, App.tsx, index.css, vite-env.d.ts
│   ├── components/         # Sidebar, Topbar, KpiCard, MentionsTable, TopList, TimeSeriesChart, StatusBadge, Toast
│   ├── pages/              # Overview, MentionDetail, SyncStatus
│   ├── lib/                # supabase (client), queries (data access), format (helpers)
│   └── types/              # mention, entry, brand-entry, audit-log, etc.
├── supabase/
│   ├── schema.sql          # mentions + sync_runs tables, indexes
│   └── functions/          # Supabase Edge Functions (ai-assistant, check-review-status, etc.)
├── docs/superpowers/specs/ # design specs
└── public/
```

## Architecture Rules
- **Data flow:** Supabase is the sole data store — entries are created and edited directly in the dashboard via `supabase-js`. No external sync (the Google Sheet integration was fully disconnected 2026-07-07).
- **Auth:** email+password login via Supabase Auth, gated by admin-approval (`profiles.approved`). `AuthContext` holds session/profile; `ProtectedRoute` wraps every app route except `/login`, `/signup`, `/reset-password`. Vercel password protection also guards the deploy on top of this.
- **Data access:** all Supabase queries live in `src/lib/queries.ts`. Pages and components import from there, never call `supabase.from(...)` directly.
- **Routing:** React Router v7 declarative routes — `/`, `/mentions/:id`, `/brands/:tab`, `/sync`, `/log`, `/score-summary`, `/ask-ai`, `/admin/users`, plus public `/login`, `/signup`, `/reset-password`.
- **Styling:** Tailwind v4 utility classes. No global CSS beyond `index.css` (resets, base tokens).
- **Charts:** Recharts only. Keep chart components in `src/components/` and pass plain data props.

## Data Model
- `mentions(id, source_row_id, forum, thread_title, mention_text, url, author, posted_at, keyword, sentiment, status, synced_at)`
- `sync_runs(id, started_at, finished_at, rows_seen, rows_upserted, rows_skipped, error_message, status)`

## Development Guidelines
- TypeScript strict mode. No `any` unless commented why.
- Pages own data fetching via `lib/queries.ts`; components stay presentational.
- Env vars are read once in `src/lib/supabase.ts`. Never hardcode URLs or keys.

## Deployment
- `npm run build` → `dist/` → Vercel (config in `vercel.json`).
- SPA fallback rewrite handles client-side routing.
- Vercel password protection enabled on the deployment settings.

---

## Dynamic State

### Current Tasks
- [x] Brainstorm + design spec (`docs/superpowers/specs/2026-05-15-forums-dashboard-design.md`)
- [x] Scaffold project structure (config, src, supabase, docs)
- [ ] Implement `lib/queries.ts` against real Supabase schema
- [ ] Wire Overview KPIs, time-series, and top lists
- [ ] Add Vercel password protection on first deploy

### Recent Changes
- *2026-07-29:* Generalized the TP-only "page removed" flag (below) to independently cover
  all 4 review platforms — TrustPilot, AskGamblers, CasinoGuru, and Wizard of Odds —
  superseding that entry. `removed_tp_brands` was renamed to `removed_platform_brands` and
  given a `platform` column (`'tp' | 'ag' | 'cg' | 'wo'`, check-constrained), with the
  original 14 rows backfilled to `platform='tp'` and uniqueness widened to
  `(tab, brand_key, platform)` so the same brand can carry independent flags per platform.
  The old bare-circle `TpRemovedBadge` became a labeled `PlatformRemovedBadge` (a red pill
  reading TP/AG/CG/WO) — `BrandGroup.tsx` now renders one badge per platform actually
  flagged for that brand, side by side. The Edit Entry modal's single "TP page removed"
  checkbox became one checkbox per platform active on the current tab, labeled e.g.
  "AskGamblers page removed" (1 checkbox on TP-only/WO-only tabs, 3 on Hanan/Rooster
  Partners/Revolution Casino/SilverPlay), each diffed and written independently on save via
  `setBrandPlatformRemoved` so toggling one platform never touches another's row.
  `scoreSummary.ts`'s three compute functions exclude brands per-platform (no more TP-only
  special case), and along the way this fixed a latent bug where the Wizard of Odds tab's
  KPI card was checked against a TP-specific flag instead of WO's own. The shared
  `tpRemovedKey`/`buildRemovedTpBrandSet` helpers became `platformRemovedKey`/
  `buildRemovedPlatformBrandSet` in `src/lib/removedPlatformBrands.ts` (also now the
  canonical home of the `Platform` type, re-exported by `scoreSummary.ts` for existing
  importers). Full test suite (81 tests, including `removedPlatformBrands.test.ts` and
  updated `scoreSummary.test.ts`) and build both pass. Live-verified end to end via a
  throwaway headless Playwright run (the shared browser was in use by a concurrent
  session): all 14 originally-seeded brands still show their TP badge and stay excluded
  from Score Summary's TrustPilot view; flagging a fresh Hanan brand (ZodiacBet.com)
  AG-only showed exactly one AG badge and excluded it from the AskGamblers view while
  TrustPilot/CasinoGuru stayed untouched; additionally flagging it TP-removed showed both
  badges with both exclusions applying independently and CG still untouched; flagging a
  Wizard of Odds brand (Lucky7even) showed a WO badge (not TP), excluded it from that tab's
  own KPI view, and its Edit Entry checkbox read "Wizard of Odds page removed"; unchecking
  AG while TP stayed checked cleared only the AG badge/exclusion. All flags added during
  the walkthrough were undone afterward — confirmed via a direct table query that
  `removed_platform_brands` ends at exactly the original 14 rows, all `platform='tp'`.
  Spec: `docs/superpowers/specs/2026-07-29-multi-platform-removed-brands-design.md`. Plan:
  `docs/superpowers/plans/2026-07-29-multi-platform-removed-brands.md`.
- *2026-07-29 (superseded by the entry above):* Added a TP-removed brand flag — Trustpilot can delist a brand's review
  page entirely, independent of any single review's status, and the dashboard now tracks
  that fact per (tab, brand) in a new `removed_tp_brands` table (seeded with 14 known
  cases: 6 in "TP Brand Injection", 5 in "TP Affiliate", 3 in "Hanan"). A red circle-X
  `TpRemovedBadge` renders next to the brand name in every `BrandGroup.tsx` brand cell for
  a flagged brand, and Score Summary's three compute functions (`scoreSummary.ts`) exclude
  flagged brands from brand lists, star counts, and Success Rate — but only in the
  TrustPilot platform view; AG/CG/WO still show the brand's data normally, since a TP page
  being taken down says nothing about the brand's standing on other platforms. Toggled from
  a "TP page removed" checkbox in the Edit Entry modal, wired through `setBrandTpRemoved` in
  `src/lib/queries.ts` (upsert to flag, delete to clear). Matching between the table's
  brand values and imported entries' brand values is case-insensitive/trimmed via the
  shared `tpRemovedKey`/`buildRemovedTpBrandSet` helpers in `src/lib/removedTpBrands.ts` —
  every reader goes through that one helper, which matters because several real imported
  brand values carry a trailing space (e.g. `"Online Casino Deutschland "`) that the seed
  data does not. Full test suite (76 tests, including new `removedTpBrands.test.ts` and
  `scoreSummary.test.ts` additions) and build both pass. Live-verified end to end,
  including the checkbox→badge round trip: toggling "TP page removed" off for a seeded
  brand (Prive Casino) made its badge disappear from all 25 of its rows and made it
  reappear in the TrustPilot Score Summary; toggling back on reversed both. Spec:
  `docs/superpowers/specs/2026-07-29-tp-removed-brands-design.md`.
- *2026-07-27:* Added cross-dashboard SSO — a new public route
  (`/auth/portal-callback`) and Edge Function (`sso-callback`) let a user who
  logs into the central SSO portal land here already authenticated. The
  function verifies the portal's signed JWT (JWKS + issuer + audience +
  expiry), finds-or-creates the user by email, force-approves their
  `profiles` row (the portal is treated as the access authority — a valid
  token only exists because a portal admin assigned this dashboard to that
  user), and mints a session the frontend adopts via
  `supabase.auth.setSession(...)`. Requires three new Edge Function secrets
  (`PORTAL_JWKS_URL`, `PORTAL_ISSUER`, `SSO_AUDIENCE`, documented in
  `.env.example`) — code is complete and reviewed, but the function has NOT
  been deployed yet and the secrets have NOT been set (needs Supabase CLI
  access this session doesn't have); deploy, set secrets, and the portal
  owner enabling SSO for this dashboard's card are still pending. Final
  review added replay protection (each token's `jti` can only be claimed
  once, via `sso_consumed_tokens`) and a 7-day bounded revocation window for
  SSO-provisioned users (`profiles.sso_provisioned`/`sso_last_verified_at`,
  enforced by a daily `pg_cron` job) — migration
  `supabase/migrations/20260727150000_add_sso_replay_and_revocation.sql` must
  be applied via `supabase db push` **before** the function is deployed,
  since the function's code assumes that table/those columns already exist.
  An admin's manual re-approval in Admin Users now also clears
  `sso_provisioned` back to `false`, so an explicit approval isn't silently
  undone by the next day's cron run. Spec:
  `docs/superpowers/specs/2026-07-27-portal-sso-callback-design.md`. Plan:
  `docs/superpowers/plans/2026-07-27-portal-sso-callback.md`.
- *2026-07-10:* Brand Name in Add Review Account (and Edit Entry, since it shares the same
  `BrandSelectDropdown` component) is now creatable — typing a name with no case-insensitive
  match in the existing list shows a `+ Add "<text>"` row that sets it as a free-typed brand,
  on every brand tab. Previously the field only let you pick from brands already seen in that
  tab's data, with no way to add a genuinely new one. Spec:
  `docs/superpowers/specs/2026-07-10-manual-brand-entry-design.md`. Plan:
  `docs/superpowers/plans/2026-07-10-manual-brand-entry.md`.
- *2026-07-08:* Added a "Getting Started" walkthrough to the How It Works page — a numbered
  step list (login → add an entry → edit an entry → run Check Status → see the result) next
  to an animated GIF (`public/getting-started.gif`) captured from the real running app. No
  video/screenshot tool exists in this environment, so the GIF is produced by a one-time,
  human-supervised Playwright script (`scripts/capture-getting-started.mjs`, run via
  `npm run capture:demo`) that logs in, drives the flow against the `GRG - Gulf Recovery
  Group` tab using a disposable demo entry, and deletes it afterward — re-run manually
  whenever the UI changes enough to make the GIF stale (needs `npm run dev` running first,
  plus `CAPTURE_EMAIL`/`CAPTURE_PASSWORD` env vars). Spec:
  `docs/superpowers/specs/2026-07-08-getting-started-walkthrough-design.md`. Plan:
  `docs/superpowers/plans/2026-07-08-getting-started-walkthrough.md`.
- *2026-07-07:* Fully disconnected the Google Sheet from the dashboard — deleted the
  `sync-sheet`, `push-to-sheet`, `import-tabs`, and `backfill-brand-hrefs` Edge Functions
  (repo source + live Supabase deployment) along with the frontend code that only served
  them (`fetchSyncRuns`, `subscribeSyncRuns`, `src/types/sync.ts`). The Sheet→DB direction
  was already disabled 2026-06-26; this removes the now-unused DB→Sheet path and its dead
  readers. `apps-script/Code.gs` and the Sheet itself are untouched. Spec:
  `docs/superpowers/specs/2026-07-07-google-sheet-disconnect-design.md`.
- *2026-06-02:* Added AI assistant (OpenAI **gpt-4o-mini**). Floating chat widget on
  every authenticated page, backed by the `ai-assistant` Edge Function (holds
  `OPENAI_API_KEY`, runs a read-only tool-calling loop over `entries`, streams via SSE).
  Spec: `docs/superpowers/specs/2026-06-02-ai-assistant-design.md`. Plan:
  `docs/superpowers/plans/2026-06-02-ai-assistant.md`.
  **Setup required before it works:**
  1. `supabase secrets set OPENAI_API_KEY=sk-...`
  2. `supabase functions deploy ai-assistant`
  3. Add `VITE_AI_ASSISTANT_URL=<deployed function URL>` to Vercel env, then redeploy.
  Until `VITE_AI_ASSISTANT_URL` is set, the widget shows "Assistant not configured".
- *2026-05-15:* Initial scaffold. Vite + React + TS + Tailwind v4 + React Router + Recharts. Supabase schema + Edge Function stubs. Pages and components stubbed.

### Known Issues / Backlog
- Recharts pinned to v2; revisit if a major upgrade is available at install time.
- No dedicated `/mentions` list view — Overview's recent-mentions table is the only path to detail. Revisit if filtering needs grow.
- Sentiment column is passthrough; classification deferred.
- The Google Sheet disconnect (2026-07-07) deliberately left `check-review-status` untouched: it still pushes changed rows to the Sheet via the Apps Script web app (`APPS_SCRIPT_URL`/`APPS_SCRIPT_SECRET` Supabase secrets) whenever a Check Status run detects a change. Revisit if a truly Sheet-free dashboard is required — either remove that push call or unset those two secrets on the function.
- Trybet's table view shows "—" in its "Brands" column even when an entry's brand value is
  correctly saved (confirmed 2026-07-10 via the raw Supabase insert payload — the value is
  genuinely persisted, this is a read/display-only issue). Likely a key mismatch between the
  column `getBrandNameCol()` resolves for writes (`'Brands'`, from the `TAB_COLUMN_CONFIGS`
  whitelist) and whatever `BrandGroup.tsx` resolves for the rendered header/cell from
  `tab_schemas` (`BrandGroup.tsx:948-952,2216`) — not yet root-caused further. Pre-existing;
  unrelated to the 2026-07-10 manual-brand-entry change (reproduces via the old plain-input
  fallback too). Worth a follow-up look since it makes a correctly-saved new brand look like
  the save silently failed.
- Supabase Auth still uses the default built-in email sender, which caps auth emails (signup confirmation, password reset, magic link) project-wide at a few per hour. Hit in practice 2026-07-08 trying to recover the `sandbox@optinetsolutions.com` account — both signup and password-reset threw "email rate limit exceeded" back to back. Fix: wire up a free custom SMTP provider (e.g. Resend, free tier, no card required) under Authentication → Emails / SMTP Settings to remove the cap. Immediate unblock without waiting: Authentication → Users → select user → Reset Password sets a new password directly, no email sent.
