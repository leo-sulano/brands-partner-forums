# Portal SSO Callback — Design Spec

**Date:** 2026-07-27
**Status:** Approved

## Purpose

A central "portal" (dashboard-portal-tawny.vercel.app, a separate Supabase project) does cross-dashboard SSO: a user logs into the portal once, clicks this dashboard's card, and should land here already logged in. The portal signs a short-lived JWT asserting the user's email; this dashboard needs one flow that verifies that token and starts a normal session in its own Supabase project, auto-provisioning and auto-approving the user (the portal is treated as the access authority — a user only ever gets a valid token because a portal admin explicitly assigned this dashboard to them).

## Stack Constraint

This app is a Vite + React SPA using plain `@supabase/supabase-js` (`src/lib/supabase.ts:10`, no `@supabase/ssr`, no server). Sessions live in `localStorage`, established via `supabase.auth.setSession(...)`, not cookies. A reference implementation was provided for a Next.js App Router / cookie-based variant of this dashboard — that variant does not apply here and is not used. Every design decision below is the SPA-appropriate equivalent.

## Current State (relevant pieces)

- `src/contexts/AuthContext.tsx`: single `onAuthStateChange` listener drives `session`/`profile`; `isApproved = profile?.approved === true`.
- `src/components/ProtectedRoute.tsx`: no session → `/login`; session but `!isApproved` → inline "Pending Approval" card; otherwise renders `<Outlet/>`.
- `src/App.tsx`: `/login`, `/signup`, `/reset-password` are declared as plain sibling `<Route>`s, outside `AppLayout`/`ProtectedRoute` — the established pattern for a public route.
- `supabase/schema.sql`: `profiles(id, email, approved boolean default false, role default 'member', created_at)`. Trigger `on_auth_user_created` → `handle_new_user()` inserts a `profiles` row automatically whenever a new `auth.users` row is created — so JIT-provisioning already happens for free; the only gap is approving the new row.
- `src/lib/authError.ts`: `AUTH_ERROR_STORAGE_KEY` sessionStorage mechanism, already used for Google OAuth redirect errors — `Login.tsx` reads it on mount and renders it in the existing rose error banner. Reused here instead of inventing a new error-display path.
- `supabase/functions/ai-assistant/index.ts`: existing Edge Function pattern (Deno, CORS headers, `Deno.env.get(...)` for secrets, service-role client) — followed for consistency.

## Concrete Values

- `PORTAL_JWKS_URL` = `https://dashboard-portal-tawny.vercel.app/api/sso/jwks`
- `PORTAL_ISSUER` = `https://dashboard-portal-tawny.vercel.app` (exact, no trailing slash)
- `SSO_AUDIENCE` = `a201dce6-c5fa-479a-badc-e518f1ccb96b` (this dashboard's id in the portal)
- Callback URL the portal is configured to use: `https://brands-partner-forums.vercel.app/auth/portal-callback`

## Design

### Flow

1. Portal redirects to `https://brands-partner-forums.vercel.app/auth/portal-callback?token=<jwt>`.
2. New route `PortalCallback.tsx` reads `?token`. Missing/empty → redirect straight to `/login` (no function call).
3. It calls the new Edge Function via `supabase.functions.invoke('sso-callback', { body: { token } })`.
4. The function:
   a. Verifies the JWT against `PORTAL_JWKS_URL` with `jwtVerify` (issuer + audience checked; `requiredClaims: ['exp', 'email', 'jti']` + `maxTokenAge: '5m'` so expiry is actually enforced rather than merely checked-if-present; env vars read via a `requireEnv` helper so an unset `PORTAL_ISSUER`/`SSO_AUDIENCE` throws instead of silently skipping the check). Extracts `email` and `jti` (rejects if either is not a non-empty string).
   b. **Replay guard** (see Addendum below): claims the token's `jti` in `sso_consumed_tokens` before doing anything else; a second use of the same token is rejected.
   c. Finds-or-creates the `auth.users` row by email using the service-role client (`listUsers` paged, `createUser({ email, email_confirm: true })` if not found).
   d. Runs `.from('profiles').upsert({ id: user.id, email: user.email, approved: true, sso_provisioned: true, sso_last_verified_at: now() }, { onConflict: 'id' })` — unconditionally, every SSO login, per the "portal always wins" policy. **Correction from the original design:** this was originally specified as `.update(...)`, but `.update()` on zero matched rows returns `{error: null}` (a silent no-op, not a failure) rather than an error — a real risk if the row-creation trigger hasn't fired synchronously. `.upsert()` closes that gap structurally. See Addendum for the *bounded* nature of "portal always wins" — it now lapses after 7 days without a fresh SSO login, rather than lasting forever.
   e. Mints a session via `generateLink({ type: 'magiclink', email: user.email })` → `verifyOtp({ type: 'magiclink', token_hash })` on an anon-key client, and returns `{ access_token, refresh_token }` as JSON.
5. On success, `PortalCallback.tsx` calls `supabase.auth.setSession({ access_token, refresh_token })`, then navigates to `/`. `AuthContext`'s existing `onAuthStateChange` listener picks up the new session and fetches the (now-approved) profile normally — no changes needed there.
6. On any failure, the function returns `{ error: "sso" | "replay" | "provision" | "access" | "session" }` — **always with HTTP status 200** (see below), and `PortalCallback.tsx` maps the code to a human-readable message, stashes it via `AUTH_ERROR_STORAGE_KEY`, and redirects to `/login`, where the existing banner renders it.

### Error codes

| Code | Cause |
|---|---|
| `sso` | JWT failed signature/issuer/audience/expiry/required-claims, or no `email`/`jti` claim |
| `replay` | this token's `jti` was already consumed by an earlier request |
| `provision` | `listUsers`/`createUser` failed |
| `access` | the `profiles` upsert failed |
| `session` | `generateLink`/`verifyOtp` failed |

**Response status is always 200 for every handled case above, success or failure.** `supabase-js`'s `functions.invoke()` throws internally on any non-2xx response and does not expose the response body as `data` in that case (confirmed against `@supabase/functions-js`'s `FunctionsClient.js`) — so a non-2xx status would make `completePortalLogin`'s `data.error` branch unreachable and every failure would show the same generic message, defeating the entire point of having distinct codes. This was a real bug caught in final review: the original implementation returned 400/401/500 for handled failures, and it was live in the codebase (though never deployed) before this fix. Non-2xx is reserved for genuinely unexpected crashes outside the function's own error handling.

### Why not verify the JWT client-side

The JWKS is public, so the browser could check it before calling the function — but the function must re-verify regardless (a tampered client can't be trusted with the service-role operations that follow), so client-side verification would be pure duplication with no security benefit, plus it would require bundling `jose` into the frontend for nothing. Rejected.

## Addendum (2026-07-27, final review): Replay Protection + Bounded Revocation

Two gaps surfaced in final whole-branch review, both requiring a human decision on approach (not something a task-level review could resolve, since both are cross-cutting policy questions). Resolutions below.

**Replay protection.** The portal's JWT includes a `jti` claim (confirmed with the user). Nothing previously stopped the same token from being redeemed repeatedly until it expired — a real risk since the token travels as a `?token=` query param on a Vercel-hosted URL, and Vercel's request logs record full query strings by default. Fix: a new table `sso_consumed_tokens(jti primary key, consumed_at, expires_at)`. The function inserts the `jti` there *before* any provisioning/session-minting; a unique-constraint failure means the token was already used, and the request is rejected with `{error: 'replay'}`. Cleanup: a daily `pg_cron` job deletes rows past their `expires_at` (tokens are short-lived, so this table stays small). This is fully self-contained — no portal-side change needed, since the `jti` is already present.

**Bounded revocation.** The original design's "portal always wins" policy had no expiry: once SSO-approved, a user stayed `approved = true` forever, even if a portal admin later unassigned this dashboard — the portal's revocation intent never reached this project (checked: this dashboard also has password and Google-OAuth login, so revoking portal access alone doesn't lock a provisioned user out). A real-time fix would need the portal to expose an assignment-list API or a revoke webhook this dashboard can call — **it does not have one today** (confirmed with the user). Rather than build a reconciliation job with nothing real to call, the accepted interim fix is a **bounded trust window**: SSO-granted approval self-expires after 7 days without a fresh SSO login. New `profiles` columns: `sso_provisioned boolean default false` (marks a profile as SSO-managed, so this policy never touches manually-approved members) and `sso_last_verified_at timestamptz` (refreshed on every successful SSO login). A daily `pg_cron` job flips `approved` back to `false` for any `sso_provisioned` row whose `sso_last_verified_at` is older than 7 days. This directly updates the authoritative `approved` column that RLS's `is_approved()`/`is_admin()` helpers read, so it's real enforcement, not just a UI gate. **Follow-up, not built here:** if the portal later exposes an assignment-list API or revoke webhook, replace this bounded-window job with real-time reconciliation against it.

This claim holds only for members who have never completed an SSO login — a manually-approved member who clicks through the portal even once becomes `sso_provisioned = true` and is subject to the 7-day window from then on. To keep an admin's approval authoritative over the bounded-window policy, the Admin Users approve action also clears `sso_provisioned` back to `false`, taking that row out of SSO-managed lifecycle entirely.

**Deploy ordering.** The migration (`supabase/migrations/20260727150000_add_sso_replay_and_revocation.sql`) must be applied to the live database via `supabase db push` before the `sso-callback` function is deployed — the function's code assumes `sso_consumed_tokens` and the two new `profiles` columns already exist, and will fail on every request otherwise.

## Files

- `supabase/functions/sso-callback/index.ts` (new) — verify, replay-guard, provision, approve, mint session. CORS headers copied from `ai-assistant`'s pattern.
- `src/pages/PortalCallback.tsx` (new) — reads `?token`, calls the function, `setSession`, redirects; renders a loading spinner while in flight.
- `src/App.tsx` — one new sibling `<Route path="/auth/portal-callback" element={<PortalCallback />} />` next to `/login`.
- `.env.example` — comment lines documenting the three new secrets (`supabase secrets set PORTAL_JWKS_URL=... PORTAL_ISSUER=... SSO_AUDIENCE=...`), following the existing `OPENAI_API_KEY` comment pattern.
- `supabase/migrations/20260727150000_add_sso_replay_and_revocation.sql` (new) — `sso_consumed_tokens` table, `profiles.sso_provisioned`/`sso_last_verified_at` columns, two `pg_cron` jobs (stale-approval expiry, consumed-token cleanup).
- `CLAUDE.md` — Recent Changes entry once shipped.

## Explicitly Unchanged / Out of Scope

- No new frontend dependencies — `jose` is only imported inside the Deno Edge Function via `npm:jose`, never touching `package.json`.
- No new `VITE_`/Vercel env vars — `supabase.functions.invoke(...)` already knows the project URL via the existing Supabase client config.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into every Edge Function already; only `PORTAL_JWKS_URL`, `PORTAL_ISSUER`, `SSO_AUDIENCE` need to be set as new secrets.
- `AuthContext.tsx`, `ProtectedRoute.tsx` — unchanged; the new flow produces a normal approved session that both already handle correctly.
- Existing password/Google OAuth login flows — unaffected, purely additive.

## Testing / Verification

There is no existing test harness for Edge Functions in this repo (`ai-assistant` has none either); this follows that precedent rather than introducing a new one.

- `npm run build` must pass.
- Deploy the function (`supabase functions deploy sso-callback`) and set the three secrets.
- Manual check: hitting `/auth/portal-callback` with a deliberately garbage token redirects to `/login` with an error banner (`sso` path) — verifiable without the real portal.
- The full happy path (real portal-signed token) requires one real click-through once both sides are live — the portal owner enables SSO for this dashboard's card and tests it.
