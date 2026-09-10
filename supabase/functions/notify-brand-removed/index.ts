// supabase/functions/notify-brand-removed/index.ts
// Fired client-side right after a Brand Tabs Edit Entry save newly flags a
// platform's page as removed (setBrandPlatformRemoved(..., true) succeeding).
// Deliberately holds no imports from src/lib — a thin proxy to Gmail that
// receives every human-readable string it needs already formatted, so it
// can't drift from src/lib's own PLATFORM_LABEL/formatCellValue/tabToSlug.
//
// Gmail send/retry-per-recipient logic itself lives in ../_shared/gmail.ts,
// shared with cron-failure-alert so the two can't drift from each other.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendToApprovedProfiles, type GmailCredentials } from '../_shared/gmail.ts';

export type { GmailCredentials };

function getEnvVars() {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') || '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    GMAIL_CLIENT_ID: Deno.env.get('GMAIL_CLIENT_ID') || '',
    GMAIL_CLIENT_SECRET: Deno.env.get('GMAIL_CLIENT_SECRET') || '',
    GMAIL_REFRESH_TOKEN: Deno.env.get('GMAIL_REFRESH_TOKEN') || '',
    GMAIL_SENDER_EMAIL: Deno.env.get('GMAIL_SENDER_EMAIL') || '',
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
  removedAtLabel: string;
  brandTabUrl: string;
}

export async function sendBrandRemovedNotification(
  payload: NotifyBrandRemovedPayload,
  client: SupabaseClient,
  credentials: GmailCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<{ sent: number; failed: number }> {
  const subject = `Brand Page Removal Notification – ${payload.brand}`;
  const text = [
    'Dear Team,',
    '',
    'This is an automated notification from the Forums Dashboard.',
    '',
    `The brand page ${payload.brand} on ${payload.platformShortLabel}, under ${payload.tabLabel}, has been flagged as Removed on ${payload.removedAtLabel}.`,
    '',
    `View it here: ${payload.brandTabUrl}`,
    '',
    'Please review the brand page and take the necessary action.',
    '',
    'Thank you,',
    'Forums Dashboard',
  ].join('\n');

  return sendToApprovedProfiles(client, credentials, subject, text, fetchFn);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!req.headers.get('authorization')) return jsonResponse({ error: 'Unauthorized' }, 401);

  const env = getEnvVars();
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN || !env.GMAIL_SENDER_EMAIL) {
    return jsonResponse({ error: 'Notifications not configured' }, 500);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }
  const { brand, tabLabel, platformShortLabel, removedAtLabel, brandTabUrl } = body ?? {};
  if (!brand || !tabLabel || !platformShortLabel || !removedAtLabel || !brandTabUrl) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }

  try {
    const client = createClient(env.SUPABASE_URL, env.SERVICE_ROLE);
    const result = await sendBrandRemovedNotification(
      { brand, tabLabel, platformShortLabel, removedAtLabel, brandTabUrl },
      client,
      {
        clientId: env.GMAIL_CLIENT_ID,
        clientSecret: env.GMAIL_CLIENT_SECRET,
        refreshToken: env.GMAIL_REFRESH_TOKEN,
        senderEmail: env.GMAIL_SENDER_EMAIL,
      },
    );
    return jsonResponse(result);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Notification failed' }, 500);
  }
});
