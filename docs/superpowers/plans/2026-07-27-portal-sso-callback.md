# Portal SSO Callback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user who logs into the central SSO portal land in this dashboard already authenticated, via one new Edge Function + one new public route.

**Architecture:** A new Supabase Edge Function (`sso-callback`) verifies the portal's signed JWT (JWKS + issuer + audience + expiry), finds-or-creates the corresponding `auth.users` row, force-approves the `profiles` row, mints a session via the `generateLink`→`verifyOtp` trick, and returns `{access_token, refresh_token}` as JSON. A new public route (`/auth/portal-callback`, a sibling of `/login`) calls that function via `supabase.functions.invoke`, then adopts the session with `supabase.auth.setSession(...)` — the correct mechanism for this `localStorage`-based SPA (no cookies, no Next.js).

**Tech Stack:** Vite + React 19 + TypeScript (strict) + React Router v7 + `@supabase/supabase-js` (frontend, already a dependency) · Deno + `jose` (Edge Function only, via `esm.sh` import, never added to `package.json`) · Vitest (existing test runner).

## Global Constraints

- No new frontend npm dependencies. `jose` is imported only inside the Deno Edge Function via `https://esm.sh/jose@5`.
- No new `VITE_`/Vercel env vars. `supabase.functions.invoke(...)` already resolves the project URL from the existing client config.
- New Edge Function secrets (not auto-injected, must be set via `supabase secrets set`): `PORTAL_JWKS_URL=https://dashboard-portal-tawny.vercel.app/api/sso/jwks`, `PORTAL_ISSUER=https://dashboard-portal-tawny.vercel.app` (no trailing slash), `SSO_AUDIENCE=a201dce6-c5fa-479a-badc-e518f1ccb96b`.
- Route path is fixed at `/auth/portal-callback` — the portal is already configured to redirect to `https://brands-partner-forums.vercel.app/auth/portal-callback`; changing the path breaks the integration.
- Every SSO login force-sets `profiles.approved = true` (portal is the access authority — overrides a manual local revoke). See spec `docs/superpowers/specs/2026-07-27-portal-sso-callback-design.md` for the full rationale.
- No automated tests for the Edge Function itself (no test harness exists for `supabase/functions/*` in this repo — `ai-assistant` has none either); verify by deploying and hitting it manually. Pure/mockable frontend logic (`src/lib/portalSso.ts`) does get Vitest coverage, matching the existing `src/lib/authError.ts` / `src/contexts/AuthContext.ts` pattern.

---

### Task 1: `src/lib/portalSso.ts` — testable login-completion logic

**Files:**
- Create: `src/lib/portalSso.ts`
- Create: `src/lib/portalSso.test.ts`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.ts` (`supabase.functions.invoke`, `supabase.auth.setSession`).
- Produces: `mapSsoErrorCode(code: string | undefined): string`, `completePortalLogin(token: string): Promise<PortalLoginResult>` where `type PortalLoginResult = { ok: true } | { ok: false; message: string }`. Task 2 (`PortalCallback.tsx`) calls `completePortalLogin` directly.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/portalSso.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
const setSession = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke },
    auth: { setSession },
  },
}));

import { mapSsoErrorCode, completePortalLogin } from './portalSso';

describe('mapSsoErrorCode', () => {
  it('maps known codes to distinct messages', () => {
    const sso = mapSsoErrorCode('sso');
    const provision = mapSsoErrorCode('provision');
    const access = mapSsoErrorCode('access');
    const session = mapSsoErrorCode('session');
    const all = [sso, provision, access, session];
    expect(new Set(all).size).toBe(4);
    all.forEach((m) => expect(m.length).toBeGreaterThan(0));
  });

  it('falls back to a default message for an unknown or missing code', () => {
    expect(mapSsoErrorCode('something-new')).toBe(mapSsoErrorCode(undefined));
  });
});

describe('completePortalLogin', () => {
  beforeEach(() => {
    invoke.mockReset();
    setSession.mockReset();
  });

  it('adopts the session and returns ok on success', async () => {
    invoke.mockResolvedValueOnce({
      data: { access_token: 'at', refresh_token: 'rt' },
      error: null,
    });
    setSession.mockResolvedValueOnce({ error: null });

    await expect(completePortalLogin('tok')).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('sso-callback', { body: { token: 'tok' } });
    expect(setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it('returns a mapped error message when the function reports one', async () => {
    invoke.mockResolvedValueOnce({ data: { error: 'provision' }, error: null });

    await expect(completePortalLogin('tok')).resolves.toEqual({
      ok: false,
      message: mapSsoErrorCode('provision'),
    });
    expect(setSession).not.toHaveBeenCalled();
  });

  it('returns a fallback error when invoke itself fails', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });

    await expect(completePortalLogin('tok')).resolves.toEqual({
      ok: false,
      message: mapSsoErrorCode(undefined),
    });
  });

  it('returns a fallback error when the response is missing tokens', async () => {
    invoke.mockResolvedValueOnce({ data: {}, error: null });

    await expect(completePortalLogin('tok')).resolves.toEqual({
      ok: false,
      message: mapSsoErrorCode(undefined),
    });
  });

  it('returns the session error message when setSession fails', async () => {
    invoke.mockResolvedValueOnce({
      data: { access_token: 'at', refresh_token: 'rt' },
      error: null,
    });
    setSession.mockResolvedValueOnce({ error: { message: 'bad tokens' } });

    await expect(completePortalLogin('tok')).resolves.toEqual({
      ok: false,
      message: mapSsoErrorCode('session'),
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/portalSso.test.ts`
Expected: FAIL — `Cannot find module './portalSso'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/portalSso.ts
import { supabase } from './supabase';

const ERROR_MESSAGES: Record<string, string> = {
  sso: 'Single sign-on failed — the login link may be invalid or expired. Try again from the portal.',
  provision: 'Single sign-on failed — we could not set up your account. Contact an admin.',
  access: 'Single sign-on failed — we could not approve your account. Contact an admin.',
  session: 'Single sign-on failed — we could not start your session. Try again from the portal.',
};

const DEFAULT_MESSAGE = ERROR_MESSAGES.sso;

export function mapSsoErrorCode(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) || DEFAULT_MESSAGE;
}

interface SsoCallbackResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

export type PortalLoginResult = { ok: true } | { ok: false; message: string };

export async function completePortalLogin(token: string): Promise<PortalLoginResult> {
  const { data, error } = await supabase.functions.invoke<SsoCallbackResponse>('sso-callback', {
    body: { token },
  });
  if (error) return { ok: false, message: mapSsoErrorCode(undefined) };
  if (data?.error) return { ok: false, message: mapSsoErrorCode(data.error) };
  if (!data?.access_token || !data?.refresh_token) {
    return { ok: false, message: mapSsoErrorCode(undefined) };
  }

  const { error: sessionErr } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionErr) return { ok: false, message: mapSsoErrorCode('session') };

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/portalSso.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portalSso.ts src/lib/portalSso.test.ts
git commit -m "feat: add portal SSO login-completion logic"
```

---

### Task 2: `src/pages/PortalCallback.tsx` — the callback route component

**Files:**
- Create: `src/pages/PortalCallback.tsx`

**Interfaces:**
- Consumes: `completePortalLogin` from `src/lib/portalSso.ts` (Task 1), `AUTH_ERROR_STORAGE_KEY` from `src/lib/authError.ts`.
- Produces: default-exported `PortalCallback` component, consumed by Task 3's route registration.

No test file for this task — this repo has no component-rendering test setup (`src/pages/*.tsx` have no test files today; e.g. `Login.tsx` has none), so this stays consistent with that precedent and gets manual verification instead (Task 5's deploy/verify step).

- [ ] **Step 1: Write the component**

```tsx
// src/pages/PortalCallback.tsx
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completePortalLogin } from '../lib/portalSso';
import { AUTH_ERROR_STORAGE_KEY } from '../lib/authError';

export default function PortalCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }

    completePortalLogin(token).then((result) => {
      if (result.ok) {
        navigate('/', { replace: true });
      } else {
        sessionStorage.setItem(AUTH_ERROR_STORAGE_KEY, result.message);
        navigate('/login', { replace: true });
      }
    });
    // Runs once per mount for the token in the URL at load time; intentionally
    // not re-run on searchParams/navigate identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (this task alone won't be reachable yet since the route isn't registered — Task 3 wires it in; this step just confirms no TypeScript errors in the new file).

- [ ] **Step 3: Commit**

```bash
git add src/pages/PortalCallback.tsx
git commit -m "feat: add PortalCallback page component"
```

---

### Task 3: Wire the route into `src/App.tsx`

**Files:**
- Modify: `src/App.tsx:8-18` (lazy imports), `src/App.tsx:68-70` (public routes)

**Interfaces:**
- Consumes: default export of `src/pages/PortalCallback.tsx` (Task 2).

- [ ] **Step 1: Add the lazy import**

In `src/App.tsx`, alongside the existing `Login`/`Signup`/`ResetPassword` lazy imports (lines 8-10):

```tsx
const Login         = lazy(() => import('./pages/Login'));
const Signup        = lazy(() => import('./pages/Signup'));
const ResetPassword  = lazy(() => import('./pages/ResetPassword'));
const PortalCallback = lazy(() => import('./pages/PortalCallback'));
```

- [ ] **Step 2: Register the public route**

Add it as a sibling of `/login`, `/signup`, `/reset-password` (before the `AppLayout` route), matching their exact `<Suspense>` wrapping:

```tsx
        <Route path="/login" element={<Suspense fallback={null}><Login /></Suspense>} />
        <Route path="/signup" element={<Suspense fallback={null}><Signup /></Suspense>} />
        <Route path="/reset-password" element={<Suspense fallback={null}><ResetPassword /></Suspense>} />
        <Route path="/auth/portal-callback" element={<Suspense fallback={null}><PortalCallback /></Suspense>} />
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript/lint errors.

- [ ] **Step 4: Manually smoke-test the route shell**

Run: `npm run dev`, then open `http://localhost:5173/auth/portal-callback` (no `?token`) in a browser.
Expected: briefly shows the spinner, then redirects to `/login` (no error banner, since a missing token is a silent redirect per the design spec).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: register /auth/portal-callback route"
```

---

### Task 4: `supabase/functions/sso-callback/index.ts` — the Edge Function

**Files:**
- Create: `supabase/functions/sso-callback/index.ts`

**Interfaces:**
- Consumes: env vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (auto-injected by the Supabase Edge Function runtime), `PORTAL_JWKS_URL`, `PORTAL_ISSUER`, `SSO_AUDIENCE` (must be set as secrets — see Task 5).
- Produces: a POST endpoint expecting `{ token: string }` in the JSON body, responding `{ access_token, refresh_token }` (200) or `{ error: "sso" | "provision" | "access" | "session" }` (4xx/5xx) — the exact shape Task 1's `completePortalLogin` expects from `supabase.functions.invoke('sso-callback', ...)`.

No local test for this file (see Global Constraints) — Task 5 deploys it and verifies behavior manually.

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/sso-callback/index.ts
// Verifies a short-lived JWT from the central SSO portal (separate Supabase
// project), JIT-provisions / force-approves the corresponding user in this
// project, and mints a session for the browser to adopt via
// supabase.auth.setSession(). See docs/superpowers/specs/2026-07-27-portal-sso-callback-design.md.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5';

// Fail closed: if PORTAL_ISSUER/SSO_AUDIENCE were unset, jose would treat them
// as "no constraint" and skip the checks — a token minted for a different
// dashboard would be accepted.
function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is required for SSO`);
  return v;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const PORTAL_JWKS_URL = requireEnv('PORTAL_JWKS_URL');
const PORTAL_ISSUER = requireEnv('PORTAL_ISSUER');
const SSO_AUDIENCE = requireEnv('SSO_AUDIENCE');

const JWKS = createRemoteJWKSet(new URL(PORTAL_JWKS_URL));
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function verifyPortalToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: PORTAL_ISSUER,
    audience: SSO_AUDIENCE,
  });
  // typeof check, not String(...): String(undefined) === "undefined" (truthy)
  // would silently defeat this guard.
  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    throw new Error('no email claim');
  }
  return payload.email;
}

// listUsers is paginated; loop a bounded number of pages rather than assume
// a single page covers every user.
async function findOrCreateUser(email: string) {
  const lower = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === lower);
    if (found) return found;
    if (data.users.length < 200) break;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser returned no user');
  return data.user;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'sso' }, 405);

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'sso' }, 400);
  }
  if (!body.token) return jsonResponse({ error: 'sso' }, 400);

  let email: string;
  try {
    email = await verifyPortalToken(body.token);
  } catch {
    return jsonResponse({ error: 'sso' }, 401);
  }

  let user;
  try {
    user = await findOrCreateUser(email);
  } catch {
    return jsonResponse({ error: 'provision' }, 500);
  }

  const { error: approveErr } = await admin.from('profiles').update({ approved: true }).eq('id', user.id);
  if (approveErr) return jsonResponse({ error: 'access' }, 500);

  try {
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) throw linkErr ?? new Error('no hashed_token');

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({
      type: 'magiclink',
      token_hash: link.properties.hashed_token,
    });
    if (otpErr || !otpData.session) throw otpErr ?? new Error('no session');

    return jsonResponse({
      access_token: otpData.session.access_token,
      refresh_token: otpData.session.refresh_token,
    });
  } catch {
    return jsonResponse({ error: 'session' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/sso-callback/index.ts
git commit -m "feat: add sso-callback Edge Function"
```

---

### Task 5: Deploy, configure secrets, document, and verify end-to-end

**Files:**
- Modify: `.env.example` (append secret documentation)
- Modify: `CLAUDE.md` (Recent Changes entry)

**Interfaces:** None — this task deploys and documents the work from Tasks 1-4; no new interfaces produced.

- [ ] **Step 1: Document the new secrets in `.env.example`**

Append after the existing `# Auto-provided by the Supabase Edge Function runtime...` block:

```
# PORTAL_JWKS_URL / PORTAL_ISSUER / SSO_AUDIENCE : cross-dashboard SSO. The sso-callback
#   Edge Function verifies the central portal's signed token against these (set via
#   `supabase secrets set PORTAL_JWKS_URL=... PORTAL_ISSUER=... SSO_AUDIENCE=...`).
# PORTAL_JWKS_URL=https://dashboard-portal-tawny.vercel.app/api/sso/jwks
# PORTAL_ISSUER=https://dashboard-portal-tawny.vercel.app
# SSO_AUDIENCE=a201dce6-c5fa-479a-badc-e518f1ccb96b
```

- [ ] **Step 2: Deploy the function and set secrets**

Run:
```bash
supabase secrets set PORTAL_JWKS_URL=https://dashboard-portal-tawny.vercel.app/api/sso/jwks
supabase secrets set PORTAL_ISSUER=https://dashboard-portal-tawny.vercel.app
supabase secrets set SSO_AUDIENCE=a201dce6-c5fa-479a-badc-e518f1ccb96b
supabase functions deploy sso-callback
```
Expected: each command exits 0; the deploy command prints the function's deployed URL.

- [ ] **Step 3: Verify the failure path against a garbage token**

Run: `npm run dev`, then open `http://localhost:5173/auth/portal-callback?token=not-a-real-jwt` in a browser.
Expected: briefly shows the spinner, then redirects to `/login` showing the rose error banner with the `sso`-code message ("Single sign-on failed — the login link may be invalid or expired…"). Confirms the Edge Function is reachable, `jwtVerify` correctly rejects a malformed token, and the frontend error path (stash + redirect + banner render) works end-to-end.

- [ ] **Step 4: Full build check**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 5: Add the CLAUDE.md changelog entry**

In `CLAUDE.md`, under `### Recent Changes`, add a new entry above the most recent one:

```markdown
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
  `.env.example`) — the portal owner still needs to enable SSO for this
  dashboard's card and test a real click-through once deployed. Spec:
  `docs/superpowers/specs/2026-07-27-portal-sso-callback-design.md`. Plan:
  `docs/superpowers/plans/2026-07-27-portal-sso-callback.md`.
```

- [ ] **Step 6: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: document SSO secrets and log portal callback feature"
```

---

## Self-Review Notes

- **Spec coverage:** Flow steps 1-6 → Tasks 1/2/4. Error-code table → `ERROR_MESSAGES` (Task 1) and the function's `jsonResponse({error: ...})` calls (Task 4). Files list → all five files created/modified across Tasks 1-5. "Why not verify client-side" → honored by keeping `jose` out of `package.json`/frontend entirely. Testing/verification section → Task 5 Steps 3-4.
- **Placeholder scan:** none found — every step has literal code/commands/expected output.
- **Type consistency:** `PortalLoginResult`, `mapSsoErrorCode`, `completePortalLogin` signatures match between Task 1's implementation and Task 2's usage. The Edge Function's response shape (`{access_token, refresh_token}` / `{error}`) matches `SsoCallbackResponse` in Task 1 exactly.
