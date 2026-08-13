// supabase/functions/notify-brand-removed/index.ts
// Fired client-side right after a Brand Tabs Edit Entry save newly flags a
// platform's page as removed (setBrandPlatformRemoved(..., true) succeeding).
// Deliberately holds no imports from src/lib — a thin proxy to Gmail that
// receives every human-readable string it needs already formatted, so it
// can't drift from src/lib's own PLATFORM_LABEL/formatCellValue/tabToSlug.
//
// Sends via the Gmail API (not Resend) because Resend's sandbox sender can
// only deliver to the Resend account owner's own verified email — a real
// Gmail account has no such restriction and can reach every approved user.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string;
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64UrlEncode(str: string): string {
  return utf8ToBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// RFC 2822 headers must be ASCII; a header value containing non-ASCII
// characters (e.g. the subject's en dash) gets RFC 2047 encoded-word wrapped.
function encodeMimeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

// Builds a base64url-encoded RFC 2822 message for Gmail API's `raw` field.
// The body is itself base64-encoded (Content-Transfer-Encoding: base64) so
// the outer message is pure ASCII, avoiding any ambiguity about how a raw
// UTF-8 byte inside a header/body boundary should be parsed.
function buildRawMessage(opts: { from: string; to: string; subject: string; text: string }): string {
  const message = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeMimeHeader(opts.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    utf8ToBase64(opts.text),
  ].join('\r\n');
  return base64UrlEncode(message);
}

async function getAccessToken(
  credentials: Pick<GmailCredentials, 'clientId' | 'clientSecret' | 'refreshToken'>,
  fetchFn: typeof fetch,
): Promise<string> {
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) throw new Error(`Gmail OAuth token refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Gmail OAuth token refresh returned no access_token');
  return data.access_token;
}

// One Gmail API call per recipient, not one message with every recipient in
// `to:` — keeps a bad/bounced address from sinking every other recipient's
// delivery, same resilience goal the original Resend implementation had.
export async function sendBrandRemovedNotification(
  payload: NotifyBrandRemovedPayload,
  client: SupabaseClient,
  credentials: GmailCredentials,
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
    `The brand page ${payload.brand} on ${payload.platformShortLabel}, under ${payload.tabLabel}, has been flagged as Removed on ${payload.removedAtLabel}.`,
    '',
    `View it here: ${payload.brandTabUrl}`,
    '',
    'Please review the brand page and take the necessary action.',
    '',
    'Thank you,',
    'Forums Dashboard',
  ].join('\n');

  const accessToken = await getAccessToken(credentials, fetchFn);

  const results = await Promise.allSettled(
    emails.map((email) =>
      fetchFn('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: buildRawMessage({ from: credentials.senderEmail, to: email, subject, text }),
        }),
      }).then((res) => {
        if (!res.ok) throw new Error(`Gmail ${res.status}`);
      }),
    ),
  );
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  if (sent === 0) throw new Error(`Gmail: 0/${emails.length} sent`);
  return { sent, failed };
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
