import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendBrandRemovedNotification, type NotifyBrandRemovedPayload } from './index.ts';

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

Deno.test('sendBrandRemovedNotification sends one Resend call per approved profile email', async () => {
  const client = fakeProfilesClient(['a@example.com', 'b@example.com']);
  const calls: { to: string[]; subject: string; text: string }[] = [];
  const fakeFetch = async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ id: 'abc' }), { status: 200 });
  };
  const result = await sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch);
  assertEquals(result, { sent: 2, failed: 0 });
  assertEquals(calls.length, 2);
  assertEquals(calls.map((c) => c.to[0]).sort(), ['a@example.com', 'b@example.com']);
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
  const fakeFetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  const result = await sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch);
  assertEquals(result, { sent: 0, failed: 0 });
  assertEquals(fetchCalled, false);
});

Deno.test('sendBrandRemovedNotification delivers to recipients Resend accepts and only throws if all fail', async () => {
  const client = fakeProfilesClient(['ok@example.com', 'sandbox-blocked@example.com']);
  const fakeFetch = async (_url: string, init: RequestInit) => {
    const { to } = JSON.parse(init.body as string) as { to: string[] };
    return new Response('{}', { status: to[0] === 'ok@example.com' ? 200 : 403 });
  };
  const result = await sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch);
  assertEquals(result, { sent: 1, failed: 1 });
});

Deno.test('sendBrandRemovedNotification throws when every recipient fails', async () => {
  const client = fakeProfilesClient(['a@example.com']);
  const fakeFetch = async () => new Response('{"message":"invalid"}', { status: 422 });
  await assertRejects(
    () => sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch),
    Error,
    'Resend: 0/1 sent',
  );
});
