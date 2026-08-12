// supabase/functions/notify-brand-removed/index.ts
// Fired client-side right after a Brand Tabs Edit Entry save newly flags a
// platform's page as removed (setBrandPlatformRemoved(..., true) succeeding).
// Deliberately holds no imports from src/lib — a thin proxy to Resend that
// receives every human-readable string it needs already formatted, so it
// can't drift from src/lib's own PLATFORM_LABEL/formatCellValue/tabToSlug.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getEnvVars() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') || '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') || '',
    RESEND_FROM_EMAIL: Deno.env.get('RESEND_FROM_EMAIL') || 'Forums Dashboard <onboarding@resend.dev>',
  };
}

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

export interface NotifyBrandRemovedPayload {
  brand: string;
  tabLabel: string;
  platformShortLabel: string;
}

// One Resend call per recipient, not one call with every recipient in `to` —
// Resend's sandbox sender (no verified domain) 403s the ENTIRE call if `to`
// contains anyone but the account's own verified email, which would silently
// block every approved user's notification, including the account owner's.
// Sending individually means a still-unverified domain only drops the
// recipients Resend itself refuses, instead of failing the whole batch.
export async function sendBrandRemovedNotification(
  payload: NotifyBrandRemovedPayload,
  client: SupabaseClient,
  resendApiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ sent: number; failed: number }> {
  const { data, error } = await client.from('profiles').select('email').eq('approved', true);
  if (error) throw error;
  const emails = ((data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);
  if (emails.length === 0) return { sent: 0, failed: 0 };

  const subject = `Brand Page Removal Notification – ${payload.brand}`;
  const text = [
    'Dear Team,',
    '',
    'This is an automated notification from the Forums Dashboard.',
    '',
    `The brand page ${payload.brand} on ${payload.platformShortLabel}, under ${payload.tabLabel}, has been flagged as Removed.`,
    '',
    'Please review the brand page and take the necessary action.',
    '',
    'Thank you,',
    'Forums Dashboard',
  ].join('\n');

  const env = getEnvVars();
  const results = await Promise.allSettled(
    emails.map((email) =>
      fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [email], subject, text }),
      }).then((res) => {
        if (!res.ok) throw new Error(`Resend ${res.status}`);
      }),
    ),
  );
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  if (sent === 0) throw new Error(`Resend: 0/${emails.length} sent`);
  return { sent, failed };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!req.headers.get('authorization')) return jsonResponse({ error: 'Unauthorized' }, 401);

  const env = getEnvVars();
  if (!env.RESEND_API_KEY) return jsonResponse({ error: 'Notifications not configured' }, 500);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }
  const { brand, tabLabel, platformShortLabel } = body ?? {};
  if (!brand || !tabLabel || !platformShortLabel) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }

  try {
    const client = createClient(env.SUPABASE_URL, env.SERVICE_ROLE);
    const result = await sendBrandRemovedNotification(
      { brand, tabLabel, platformShortLabel },
      client,
      env.RESEND_API_KEY,
    );
    return jsonResponse(result);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Notification failed' }, 500);
  }
});
