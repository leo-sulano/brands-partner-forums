# Google OAuth Login — Design Spec

**Date:** 2026-07-08
**Status:** Approved

## Overview

Add "Continue with Google" as an alternative sign-in method on `Login.tsx` and `Signup.tsx`, alongside the existing email/password flow (not a replacement). Google sign-in is open to any Google account — same exposure as today's open email/password signup — and is gated by the existing admin-approval flow with no schema or `AuthContext` changes, since `profiles.approved` is set via a trigger on `auth.users` insert that already fires for any provider.

## External Setup (not code)

1. Google Cloud Console → APIs & Services → Credentials → create an OAuth 2.0 Client ID (Web application). Authorized redirect URI: `https://krxnupmhfiduduvvlumc.supabase.co/auth/v1/callback`.
2. Supabase Dashboard → Authentication → Sign In / Providers → Google: enable, paste Client ID + Client Secret.
3. Depends on **Site URL** in Authentication → URL Configuration being correctly set to `https://brands-partner-forums.vercel.app` (the bug being fixed elsewhere in this session) — Supabase implicitly trusts the Site URL as a valid OAuth redirect target, so no separate Redirect URLs entry is needed for this feature specifically.

No new repo secrets: the Google Client ID/Secret live only in the Supabase dashboard, not in `.env`.

## Components

New `src/components/GoogleAuthButton.tsx` — presentational, takes an `onClick` handler and `loading` boolean, renders the Google "G" icon + "Continue with Google" label matching existing button styling conventions (`rounded-md border`, slate/violet palette). Used by both `Login.tsx` and `Signup.tsx`, placed above the existing form with an "or continue with email" divider below it. Google OAuth doesn't distinguish sign-in vs. sign-up, so `Signup.tsx` needs no separate handling — same button, same call.

## Data Flow

1. Click → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: import.meta.env.VITE_SITE_URL } })`. `redirectTo` is passed explicitly (reusing the existing `VITE_SITE_URL` env var, same pattern as `Login.tsx`'s password-reset flow) rather than left to default to `window.location.origin` — the exact class of bug already found and fixed once in the reset-password flow.
2. Google consent screen → redirect to Supabase's fixed callback URL → Supabase exchanges the code, auto-linking to an existing identity if the OAuth email matches an already-verified user (safe because Google verifies email ownership before returning it) → redirect to `VITE_SITE_URL` with a session in the URL.
3. `AuthContext`'s existing `onAuthStateChange` listener picks up the new session exactly as it does today for password logins. No changes to `AuthContext.tsx`.
4. `ProtectedRoute` shows the existing "Pending Approval" screen if `profiles.approved` is still false — identical to today's behavior for a brand-new password signup.

## Error Handling

If the user cancels/denies at Google's consent screen, Supabase redirects back to `VITE_SITE_URL` with `error`/`error_description` in the URL hash. `Login.tsx` gets a `useEffect` on mount that checks `window.location.hash` for an `error` param and surfaces it in the same error banner already used for password sign-in errors, instead of silently landing on a blank-looking login page.

## Files Changed

| File | Change |
|---|---|
| `src/components/GoogleAuthButton.tsx` | New presentational button component |
| `src/pages/Login.tsx` | Add Google button + divider above the form; add `useEffect` to surface OAuth errors from the URL hash |
| `src/pages/Signup.tsx` | Add Google button + divider above the form |

No changes to `AuthContext.tsx`, `ProtectedRoute.tsx`, `supabase/schema.sql`, or any `.env` file.

## Out of Scope

- Domain restriction (allow-listing specific email domains for Google sign-in) — open to any Google account, matching today's open password signup.
- Account-linking UI (e.g. "link your Google account" from within a logged-in session) — this spec only covers signing in with Google from the logged-out state.
- Google One Tap / Identity Services popup flow — using Supabase's standard OAuth redirect instead (see conversation trade-off: simpler, reuses existing session plumbing, acceptable UX for an internal admin-approval-gated tool).
- Automated test coverage — OAuth redirects require a real Google account and browser; verification is manual (see below).

## Manual Verification Plan

1. Fresh Google email never seen by this project → click "Continue with Google" from `/login` → lands on "Pending Approval" screen.
2. An existing approved user's email (on a Google Workspace domain) → click "Continue with Google" → lands signed in as their existing approved profile, no re-approval needed.
3. Cancel the Google consent screen → redirected back to `/login` with a visible error banner, not a blank page.
