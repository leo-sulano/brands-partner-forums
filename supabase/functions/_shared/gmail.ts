// supabase/functions/_shared/gmail.ts
// Shared Gmail-API sending logic used by notify-brand-removed and
// cron-failure-alert, so the two functions' send/retry-per-recipient
// behavior can't drift from each other.
//
// Sends via the Gmail API (not Resend) because Resend's sandbox sender can
// only deliver to the Resend account owner's own verified email -- a real
// Gmail account has no such restriction and can reach every approved user.
import type { SupabaseClient } from '@supabase/supabase-js';

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
// characters (e.g. an en dash) gets RFC 2047 encoded-word wrapped.
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

export async function getAccessToken(
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
// `to:` -- keeps a bad/bounced address from sinking every other recipient's
// delivery.
export async function sendToApprovedProfiles(
  client: SupabaseClient,
  credentials: GmailCredentials,
  subject: string,
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ sent: number; failed: number }> {
  const { data, error } = await client.from('profiles').select('email').eq('approved', true);
  if (error) throw error;
  const emails = ((data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);
  if (emails.length === 0) return { sent: 0, failed: 0 };

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
