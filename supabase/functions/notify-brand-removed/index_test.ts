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
  platformLabel: 'TrustPilot',
  removedBy: 'leo@optinetsolutions.com',
  removedAtLabel: '12/08/2026',
  link: 'https://dashboard.example.com/brands/tp-brand-injection?brand=Prive%20Casino',
};

Deno.test('sendBrandRemovedNotification sends one Resend call to every approved profile email', async () => {
  const client = fakeProfilesClient(['a@example.com', 'b@example.com']);
  const calls: unknown[] = [];
  const fakeFetch = async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ id: 'abc' }), { status: 200 });
  };
  const result = await sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch);
  assertEquals(result.sent, 2);
  assertEquals(calls.length, 1);
  assertEquals((calls[0] as { to: string[] }).to, ['a@example.com', 'b@example.com']);
  assertEquals((calls[0] as { subject: string }).subject, '[Forums Dashboard] Prive Casino — TrustPilot page removed on TP Brand Injection');
});

Deno.test('sendBrandRemovedNotification sends nothing and returns sent:0 when no approved profiles exist', async () => {
  const client = fakeProfilesClient([]);
  let fetchCalled = false;
  const fakeFetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  const result = await sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch);
  assertEquals(result.sent, 0);
  assertEquals(fetchCalled, false);
});

Deno.test('sendBrandRemovedNotification throws when Resend responds non-2xx', async () => {
  const client = fakeProfilesClient(['a@example.com']);
  const fakeFetch = async () => new Response('{"message":"invalid"}', { status: 422 });
  await assertRejects(
    () => sendBrandRemovedNotification(PAYLOAD, client, 're_test_key', fakeFetch as typeof fetch),
    Error,
    'Resend 422',
  );
});
