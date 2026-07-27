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
   a. Verifies the JWT against `PORTAL_JWKS_URL` with `jwtVerify` (issuer + audience + expiry checked; env vars read via a `requireEnv` helper so an unset `PORTAL_ISSUER`/`SSO_AUDIENCE` throws instead of silently skipping the check). Extracts `email` (rejects if not a non-empty string).
   b. Finds-or-creates the `auth.users` row by email using the service-role client (`listUsers` paged, `createUser({ email, email_confirm: true })` if not found).
   c. Runs `.from('profiles').update({ approved: true }).eq('id', user.id)` — unconditionally, every SSO login, per the "portal always wins" policy (an admin's manual revoke in this dashboard is overridden by a later successful SSO login, matching the fact that the portal is the access authority for this path).
   d. Mints a session via `generateLink({ type: 'magiclink', email })` → `verifyOtp({ type: 'magiclink', token_hash })` on an anon-key client, and returns `{ access_token, refresh_token }` as JSON.
5. On success, `PortalCallback.tsx` calls `supabase.auth.setSession({ access_token, refresh_token })`, then navigates to `/`. `AuthContext`'s existing `onAuthStateChange` listener picks up the new session and fetches the (now-approved) profile normally — no changes needed there.
6. On any failure, the function returns `{ error: "sso" | "provision" | "access" | "session" }`; `PortalCallback.tsx` maps the code to a human-readable message, stashes it via `AUTH_ERROR_STORAGE_KEY`, and redirects to `/login`, where the existing banner renders it.

### Error codes

| Code | Cause |
|---|---|
| `sso` | JWT failed signature/issuer/audience/expiry, or no `email` claim |
| `provision` | `listUsers`/`createUser` failed |
| `access` | the `profiles.approved` update failed |
| `session` | `generateLink`/`verifyOtp` failed |

### Why not verify the JWT client-side

The JWKS is public, so the browser could check it before calling the function — but the function must re-verify regardless (a tampered client can't be trusted with the service-role operations that follow), so client-side verification would be pure duplication with no security benefit, plus it would require bundling `jose` into the frontend for nothing. Rejected.

## Files

- `supabase/functions/sso-callback/index.ts` (new) — verify, provision, approve, mint session. CORS headers copied from `ai-assistant`'s pattern.
- `src/pages/PortalCallback.tsx` (new) — reads `?token`, calls the function, `setSession`, redirects; renders a loading spinner while in flight.
- `src/App.tsx` — one new sibling `<Route path="/auth/portal-callback" element={<PortalCallback />} />` next to `/login`.
- `.env.example` — comment lines documenting the three new secrets (`supabase secrets set PORTAL_JWKS_URL=... PORTAL_ISSUER=... SSO_AUDIENCE=...`), following the existing `OPENAI_API_KEY` comment pattern.
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
