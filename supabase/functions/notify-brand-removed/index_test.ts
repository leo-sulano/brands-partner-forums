import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendBrandRemovedNotification, type GmailCredentials, type NotifyBrandRemovedPayload } from './index.ts';

function fakeProfilesClient(emails: string[]): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: emails.map((email) => ({ email })), error: null }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

const PAYLOAD: NotifyBrandRemovedPayload = {
  brand: 'Prive Casino',
  tabLabel: 'TP Brand Injection',
  platformShortLabel: 'TP',
  removedAtLabel: '12/08/2026',
};

const CREDENTIALS: GmailCredentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  senderEmail: 'sandbox@optinetsolutions.com',
};

function decodeBase64ToString(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

function decodeMimeHeader(value: string): string {
  const match = value.match(/^=\?UTF-8\?B\?(.+)\?=$/);
  if (!match) return value;
  return decodeBase64ToString(match[1]);
}

function decodeRawMessage(raw: string): { to: string; subject: string; text: string } {
  const standard = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const message = decodeBase64ToString(padded);
  const [headerBlock, ...bodyParts] = message.split('\r\n\r\n');
  const bodyBase64 = bodyParts.join('\r\n\r\n');
  const headers: Record<string, string> = {};
  headerBlock.split('\r\n').forEach((line) => {
    const idx = line.indexOf(': ');
    if (idx > -1) headers[line.slice(0, idx)] = line.slice(idx + 2);
  });
  return {
    to: headers['To'],
    subject: decodeMimeHeader(headers['Subject']),
    text: decodeBase64ToString(bodyBase64),
  };
}

function fakeGmailFetch(onSend: (url: string, body: { raw: string }) => Response) {
  return async (url: string, init: RequestInit) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'fake-access-token' }), { status: 200 });
    }
    const body = JSON.parse(init.body as string) as { raw: string };
    return onSend(url, body);
  };
}

Deno.test('sendBrandRemovedNotification sends one Gmail API call per approved profile email', async () => {
  const client = fakeProfilesClient(['a@example.com', 'b@example.com']);
  const calls: { to: string; subject: string; text: string }[] = [];
  const fakeFetch = fakeGmailFetch((_url, body) => {
    calls.push(decodeRawMessage(body.raw));
    return new Response(JSON.stringify({ id: 'abc' }), { status: 200 });
  });
  const result = await sendBrandRemovedNotification(PAYLOAD, client, CREDENTIALS, fakeFetch as unknown as typeof fetch);
  assertEquals(result, { sent: 2, failed: 0 });
  assertEquals(calls.length, 2);
  assertEquals(calls.map((c) => c.to).sort(), ['a@example.com', 'b@example.com']);
  assertEquals(calls[0].subject, 'Brand Page Removal Notification – Prive Casino');
  assertEquals(
    calls[0].text,
    [
      'Dear Team,',
      '',
      'This is an automated notification from the Forums Dashboard.',
      '',
      'The brand page Prive Casino on TP, under TP Brand Injection, has been flagged as Removed on 12/08/2026.',
      '',
      'Please review the brand page and take the necessary action.',
      '',
      'Thank you,',
      'Forums Dashboard',
    ].join('\n'),
  );
});

Deno.test('sendBrandRemovedNotification sends nothing and returns sent:0 when no approved profiles exist', async () => {
  const client = fakeProfilesClient([]);
  let fetchCalled = false;
  const fakeFetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };
  const result = await sendBrandRemovedNotification(PAYLOAD, client, CREDENTIALS, fakeFetch as unknown as typeof fetch);
  assertEquals(result, { sent: 0, failed: 0 });
  assertEquals(fetchCalled, false);
});

Deno.test('sendBrandRemovedNotification delivers to recipients Gmail accepts and only throws if all fail', async () => {
  const client = fakeProfilesClient(['ok@example.com', 'bounced@example.com']);
  const fakeFetch = fakeGmailFetch((_url, body) => {
    const { to } = decodeRawMessage(body.raw);
    return new Response('{}', { status: to === 'ok@example.com' ? 200 : 500 });
  });
  const result = await sendBrandRemovedNotification(PAYLOAD, client, CREDENTIALS, fakeFetch as unknown as typeof fetch);
  assertEquals(result, { sent: 1, failed: 1 });
});

Deno.test('sendBrandRemovedNotification throws when every recipient fails', async () => {
  const client = fakeProfilesClient(['a@example.com']);
  const fakeFetch = fakeGmailFetch(() => new Response('{"error":"invalid"}', { status: 422 }));
  await assertRejects(
    () => sendBrandRemovedNotification(PAYLOAD, client, CREDENTIALS, fakeFetch as unknown as typeof fetch),
    Error,
    'Gmail: 0/1 sent',
  );
});

Deno.test('sendBrandRemovedNotification throws when the OAuth token refresh fails', async () => {
  const client = fakeProfilesClient(['a@example.com']);
  const fakeFetch = async (url: string) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response('{"error":"invalid_grant"}', { status: 400 });
    }
    throw new Error('should not reach Gmail send without a token');
  };
  await assertRejects(
    () => sendBrandRemovedNotification(PAYLOAD, client, CREDENTIALS, fakeFetch as unknown as typeof fetch),
    Error,
    'Gmail OAuth token refresh failed: 400',
  );
});
