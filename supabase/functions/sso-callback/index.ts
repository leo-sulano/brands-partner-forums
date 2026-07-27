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

async function verifyPortalToken(token: string): Promise<{ email: string; jti: string; exp: number }> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: PORTAL_ISSUER,
    audience: SSO_AUDIENCE,
    requiredClaims: ['exp', 'email', 'jti'],
    maxTokenAge: '5m',
  });
  // typeof check, not String(...): String(undefined) === "undefined" (truthy)
  // would silently defeat this guard.
  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    throw new Error('no email claim');
  }
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
    throw new Error('no jti claim');
  }
  // requiredClaims guarantees payload.exp is present at runtime; jose's type
  // only narrows to number|undefined, hence the assertion.
  return { email: payload.email, jti: payload.jti, exp: payload.exp as number };
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
  // Handled failures all return HTTP 200: supabase-js's functions.invoke()
  // throws FunctionsHttpError on any non-2xx response and does not surface
  // the JSON body as `data` in that case (see
  // node_modules/@supabase/functions-js/dist/main/FunctionsClient.js). A 200
  // response with an {error: ...} body is the only way the specific error
  // code reaches the client.
  if (req.method !== 'POST') {
    console.error('[sso-callback] method-not-allowed', req.method);
    return jsonResponse({ error: 'sso' }, 200);
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch (err) {
    console.error('[sso-callback] parse-body', err);
    return jsonResponse({ error: 'sso' }, 200);
  }
  if (!body.token) {
    console.error('[sso-callback] missing-token');
    return jsonResponse({ error: 'sso' }, 200);
  }

  let email: string, jti: string, exp: number;
  try {
    ({ email, jti, exp } = await verifyPortalToken(body.token));
    // Number.isFinite alone lets through a technically-finite but
    // out-of-range exp (JS Date only spans ~±8.64e15ms); validate the
    // Date it actually produces so `expires_at` below can't throw.
    if (!Number.isFinite(exp) || Number.isNaN(new Date(exp * 1000).getTime())) {
      throw new Error('invalid exp claim');
    }
  } catch (err) {
    console.error('[sso-callback] jwt-verify', err);
    return jsonResponse({ error: 'sso' }, 200);
  }

  // Claim the token's jti before doing anything else — a unique-constraint
  // failure means this exact token was already redeemed.
  const { error: replayErr } = await admin
    .from('sso_consumed_tokens')
    .insert({ jti, expires_at: new Date(exp * 1000).toISOString() });
  if (replayErr) {
    if (replayErr.code === '23505') {
      console.error('[sso-callback] replay-check', replayErr);
      return jsonResponse({ error: 'replay' }, 200);
    }
    console.error('[sso-callback] replay-check-unexpected', replayErr);
    return jsonResponse({ error: 'provision' }, 200);
  }

  let user;
  try {
    user = await findOrCreateUser(email);
  } catch (err) {
    console.error('[sso-callback] find-or-create-user', err);
    return jsonResponse({ error: 'provision' }, 200);
  }

  const { error: approveErr } = await admin.from('profiles').upsert(
    {
      id: user.id,
      email: user.email ?? email,
      approved: true,
      sso_provisioned: true,
      sso_last_verified_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (approveErr) {
    console.error('[sso-callback] approve-profile', approveErr);
    return jsonResponse({ error: 'access' }, 200);
  }

  try {
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email as string,
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
  } catch (err) {
    console.error('[sso-callback] mint-session', err);
    return jsonResponse({ error: 'session' }, 200);
  }
});
