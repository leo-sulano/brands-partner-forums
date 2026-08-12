// supabase/functions/notify-brand-removed/index.ts
// Fired client-side right after a Brand Tabs Edit Entry save newly flags a
// platform's page as removed (setBrandPlatformRemoved(..., true) succeeding).
// Deliberately holds no imports from src/lib — a thin proxy to Resend that
// receives every human-readable string it needs already formatted, so it
// can't drift from src/lib's own PLATFORM_LABEL/formatCellValue/tabToSlug.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  platformLabel: string;
  removedBy: string | null;
  removedAtLabel: string;
  link: string;
}

export async function sendBrandRemovedNotification(
  payload: NotifyBrandRemovedPayload,
  client: SupabaseClient,
  resendApiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ sent: number }> {
  const { data, error } = await client.from('profiles').select('email').eq('approved', true);
  if (error) throw error;
  const emails = ((data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);
  if (emails.length === 0) return { sent: 0 };

  const subject = `[Forums Dashboard] ${payload.brand} — ${payload.platformLabel} page removed on ${payload.tabLabel}`;
  const text = [
    `${payload.platformLabel}'s page for "${payload.brand}" (${payload.tabLabel}) was flagged as removed.`,
    '',
    `Flagged by: ${payload.removedBy ?? 'unknown'}`,
    `Removed on: ${payload.removedAtLabel}`,
    '',
    `View this brand: ${payload.link}`,
  ].join('\n');

  const env = getEnvVars();
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: emails, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
  return { sent: emails.length };
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
  const { brand, tabLabel, platformLabel, removedBy, removedAtLabel, link } = body ?? {};
  if (!brand || !tabLabel || !platformLabel || !removedAtLabel || !link) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }

  try {
    const client = createClient(env.SUPABASE_URL, env.SERVICE_ROLE);
    const result = await sendBrandRemovedNotification(
      { brand, tabLabel, platformLabel, removedBy: removedBy ?? null, removedAtLabel, link },
      client,
      env.RESEND_API_KEY,
    );
    return jsonResponse(result);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Notification failed' }, 500);
  }
});
