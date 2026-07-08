# Google OAuth Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Continue with Google" as an alternative sign-in method on `Login.tsx` and `Signup.tsx`, alongside the existing email/password flow.

**Architecture:** Supabase's built-in Google OAuth provider handles the entire token exchange server-side; the app calls `supabase.auth.signInWithOAuth({ provider: 'google' })` with an explicit `redirectTo`. The existing `AuthContext`/`ProtectedRoute` session and admin-approval plumbing is reused unchanged — Google sign-ins create a row in `profiles` via the same trigger email/password signups already use.

**Tech Stack:** React 19, TypeScript, Supabase JS v2, Vitest (unit tests for pure logic only — no component-rendering test library is installed in this repo).

## Global Constraints

- Google Client ID/Secret are configured only in Supabase Dashboard → Authentication → Sign In/Providers → Google — never added to any `.env` file in this repo.
- `signInWithOAuth`'s `redirectTo` must always be passed explicitly as `import.meta.env.VITE_SITE_URL || window.location.origin` (same pattern `Login.tsx` already uses for password reset) — never omit it and rely on the SDK default, which is the exact bug already found once in the password-reset flow.
- No changes to `src/contexts/AuthContext.tsx`, `src/components/ProtectedRoute.tsx`, or `supabase/schema.sql`.
- No domain restriction on Google sign-in — open to any Google account, same exposure as today's email/password signup.
- No automated test coverage for the OAuth redirect flow itself (requires a real browser + Google account) — verified manually in Task 6. The one pure-logic unit extracted for testability (hash error parsing) follows this repo's existing `src/lib/*.test.ts` Vitest convention.
- Match existing auth-page styling: `rounded-md border`, slate/violet palette, `Loader2` from `lucide-react` for loading spinners.
- After every code task, run `npm run build` to verify — `tsc --noEmit` alone checks nothing in this repo since the root `tsconfig.json` is references-only.

---

### Task 1: Auth error hash parsing (`src/lib/authError.ts`)

**Files:**
- Create: `src/lib/authError.ts`
- Test: `src/lib/authError.test.ts`

**Interfaces:**
- Produces: `AUTH_ERROR_STORAGE_KEY: string` (sessionStorage key), `parseAuthErrorFromHash(hash: string): string | null` (pure function), `stashAuthErrorFromLocation(): void` (reads `window.location.hash`, writes to `sessionStorage`, strips the hash from the URL — not unit tested, this repo's Vitest config runs in `environment: 'node'` with no DOM).

When Supabase redirects back after a denied/failed OAuth attempt, it appends `#error=...&error_description=...` to the URL. `parseAuthErrorFromHash` extracts a human-readable message from that fragment; `stashAuthErrorFromLocation` is the DOM-touching wrapper called once at app boot (Task 2) before React Router can strip the hash during a redirect to `/login`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/authError.test.ts
import { describe, it, expect } from 'vitest';
import { parseAuthErrorFromHash } from './authError';

describe('parseAuthErrorFromHash', () => {
  it('returns null when the hash has no error', () => {
    expect(parseAuthErrorFromHash('#access_token=abc123&type=recovery')).toBeNull();
  });

  it('returns null for an empty hash', () => {
    expect(parseAuthErrorFromHash('')).toBeNull();
  });

  it('extracts and decodes error_description from the hash', () => {
    const hash = '#error=access_denied&error_code=access_denied&error_description=User+denied+access';
    expect(parseAuthErrorFromHash(hash)).toBe('User denied access');
  });

  it('works whether or not the leading # is present', () => {
    const hash = 'error=server_error&error_description=Something+went+wrong';
    expect(parseAuthErrorFromHash(hash)).toBe('Something went wrong');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/lib/authError.test.ts`
Expected: FAIL with a module-not-found or "parseAuthErrorFromHash is not a function" error (`src/lib/authError.ts` doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/authError.ts
export const AUTH_ERROR_STORAGE_KEY = 'authRedirectError';

export function parseAuthErrorFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get('error_description');
}

export function stashAuthErrorFromLocation(): void {
  const message = parseAuthErrorFromHash(window.location.hash);
  if (!message) return;
  sessionStorage.setItem(AUTH_ERROR_STORAGE_KEY, message);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/lib/authError.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/authError.ts src/lib/authError.test.ts
git commit -m "feat: add auth error hash parsing for OAuth redirect failures"
```

---

### Task 2: Stash OAuth errors before routing (`src/main.tsx`)

**Files:**
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `stashAuthErrorFromLocation()` from `src/lib/authError.ts` (Task 1)

`ProtectedRoute` redirects an unauthenticated session from `/` to `/login` via `<Navigate to="/login" replace />`, which drops any URL hash in the process. Since a failed Google OAuth attempt lands back on the bare `VITE_SITE_URL` (`/`, not `/login`), the error hash must be captured and stashed in `sessionStorage` *before* React Router ever runs — otherwise it's lost during that redirect.

- [ ] **Step 1: Add the stash call before render**

Current `src/main.tsx`:
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

Replace with:
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { stashAuthErrorFromLocation } from './lib/authError';
import './index.css';

stashAuthErrorFromLocation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "feat: stash OAuth redirect errors before routing can drop them"
```

---

### Task 3: Google auth button component (`src/components/GoogleAuthButton.tsx`)

**Files:**
- Create: `src/components/GoogleAuthButton.tsx`

**Interfaces:**
- Produces: default export `GoogleAuthButton({ onClick, loading }: { onClick: () => void; loading: boolean })` — presentational only, no internal state.

- [ ] **Step 1: Create the component**

```tsx
// src/components/GoogleAuthButton.tsx
import { Loader2 } from 'lucide-react';

interface GoogleAuthButtonProps {
  onClick: () => void;
  loading: boolean;
}

export default function GoogleAuthButton({ onClick, loading }: GoogleAuthButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon />}
      {loading ? 'Redirecting…' : 'Continue with Google'}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/GoogleAuthButton.tsx
git commit -m "feat: add GoogleAuthButton presentational component"
```

---

### Task 4: Wire Google sign-in into `Login.tsx`

**Files:**
- Modify: `src/pages/Login.tsx`

**Interfaces:**
- Consumes: `GoogleAuthButton` (Task 3), `AUTH_ERROR_STORAGE_KEY` from `src/lib/authError.ts` (Task 1)

- [ ] **Step 1: Add imports and new state/handler**

Current top of `src/pages/Login.tsx`:
```typescript
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { MessagesSquare, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { session } = useAuth();
  const navigate = useNavigate();
  if (session) return <Navigate to="/" replace />;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
```

Replace with:
```typescript
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { MessagesSquare, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { AUTH_ERROR_STORAGE_KEY } from '../lib/authError';
import GoogleAuthButton from '../components/GoogleAuthButton';

export default function Login() {
  const { session } = useAuth();
  const navigate = useNavigate();
  if (session) return <Navigate to="/" replace />;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    const stashed = sessionStorage.getItem(AUTH_ERROR_STORAGE_KEY);
    if (stashed) {
      setError(stashed);
      sessionStorage.removeItem(AUTH_ERROR_STORAGE_KEY);
    }
  }, []);

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);
    const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: siteUrl },
    });
    if (err) {
      setError(err.message);
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
```

- [ ] **Step 2: Add the button + divider above the sign-in form**

Current (around line 118-121 after Task 1's edits shift line numbers slightly — locate by content, not line number):
```tsx
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
```

Replace with:
```tsx
        ) : (
          <>
            <GoogleAuthButton onClick={handleGoogleSignIn} loading={googleLoading} />

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">or continue with email</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Login.tsx
git commit -m "feat: add Google sign-in option to Login page"
```

---

### Task 5: Wire Google sign-in into `Signup.tsx`

**Files:**
- Modify: `src/pages/Signup.tsx`

**Interfaces:**
- Consumes: `GoogleAuthButton` (Task 3)

- [ ] **Step 1: Add imports and handler**

Current top of `src/pages/Signup.tsx`:
```typescript
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { MessagesSquare, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function Signup() {
  const { session } = useAuth();
  if (session) return <Navigate to="/" replace />;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
```

Replace with:
```typescript
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { MessagesSquare, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import GoogleAuthButton from '../components/GoogleAuthButton';

export default function Signup() {
  const { session } = useAuth();
  if (session) return <Navigate to="/" replace />;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setGoogleError(null);
    setGoogleLoading(true);
    const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: siteUrl },
    });
    if (err) {
      setGoogleError(err.message);
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
```

**Note:** `Signup.tsx` uses its own local `googleError` state (unlike `Login.tsx`, which reuses the sessionStorage stash from Task 2). This is intentional, not an inconsistency to fix: `redirectTo` always points to the bare `VITE_SITE_URL` root regardless of which page initiated the OAuth flow, so a *failed* attempt started from `/signup` still lands back on `/` and gets surfaced via `Login.tsx`'s stash-read on the eventual `/login` redirect. This local `googleError` state only covers the rare case of `signInWithOAuth` itself throwing synchronously (e.g. provider not configured) before any redirect happens.

- [ ] **Step 2: Add the button + divider above the signup form**

Current (around line 68-71):
```tsx
          <p className="text-sm text-slate-500">Create a new account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
```

Replace with:
```tsx
          <p className="text-sm text-slate-500">Create a new account</p>
        </div>

        <GoogleAuthButton onClick={handleGoogleSignIn} loading={googleLoading} />

        {googleError && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {googleError}
          </div>
        )}

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400">or sign up with email</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Signup.tsx
git commit -m "feat: add Google sign-in option to Signup page"
```

---

### Task 6: External provider setup and manual end-to-end verification

**Files:** none (dashboard configuration + manual QA, no commits)

**Interfaces:** none — this task consumes the deployed result of Tasks 1-5.

This task cannot be automated or delegated to a subagent — it requires a real Google account, a real browser, and dashboard access to Google Cloud Console and Supabase. Do this after Tasks 1-5 are merged and deployed.

- [ ] **Step 1: Create the Google OAuth client**

In Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application. Set the Authorized redirect URI to:
```
https://krxnupmhfiduduvvlumc.supabase.co/auth/v1/callback
```
Copy the generated Client ID and Client Secret.

- [ ] **Step 2: Enable the provider in Supabase**

Supabase Dashboard → Authentication → Sign In / Providers → Google → toggle enabled, paste the Client ID and Client Secret from Step 1, save.

- [ ] **Step 3: Confirm the Site URL prerequisite**

Supabase Dashboard → Authentication → URL Configuration → confirm **Site URL** is `https://brands-partner-forums.vercel.app` (not `localhost`). This must already be fixed for the password-reset flow — if it still shows `localhost`, fix that first; Google sign-in depends on the same setting.

- [ ] **Step 4: Verify a brand-new Google account lands on Pending Approval**

From `/login` on the deployed app, click "Continue with Google" and sign in with a Google account never used on this project before. Expected: lands on the "Pending Approval" screen (same screen a brand-new password signup gets).

- [ ] **Step 5: Verify an existing approved user's Google sign-in reuses their profile**

Using an existing approved user's email on a Google Workspace domain, click "Continue with Google" from `/login`. Expected: signed in directly to the dashboard (not Pending Approval), same account/permissions as their password login.

- [ ] **Step 6: Verify a cancelled consent screen shows an error, not a blank page**

Click "Continue with Google", then click "Cancel"/deny on Google's consent screen. Expected: redirected back to `/login` with a visible error banner (not a blank page or silent failure).

---

## Self-Review Notes

- **Spec coverage:** External setup (spec section) → Task 6 Steps 1-3. Components (spec section) → Task 3. Data flow (spec section) → Tasks 2, 4, 5. Error handling (spec section) → Tasks 1, 2, 4. Files Changed table in the spec matches Tasks 1-5 exactly, plus the two additions (`authError.ts`/`.test.ts`, `main.tsx`) needed to make the "surface OAuth errors" requirement actually work given `ProtectedRoute`'s hash-dropping redirect — noted inline in Task 2.
- **Placeholder scan:** none found — every step has complete, runnable code.
- **Type consistency:** `GoogleAuthButtonProps` (`onClick: () => void`, `loading: boolean`) is defined once in Task 3 and consumed identically in Tasks 4 and 5. `AUTH_ERROR_STORAGE_KEY` and `parseAuthErrorFromHash`/`stashAuthErrorFromLocation` are defined once in Task 1 and consumed by name in Tasks 2 and 4.
