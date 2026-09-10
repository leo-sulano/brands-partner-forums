import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GmailCredentials } from '../_shared/gmail.ts';
import { buildAlertEmail, runCronFailureAlertCheck, type CronFailure } from './index.ts';

const CREDENTIALS: GmailCredentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  senderEmail: 'sandbox@optinetsolutions.com',
};

function fakeClient(opts: { failures: CronFailure[]; emails: string[]; rpcError?: string }): SupabaseClient {
  return {
    rpc: (fn: string) => {
      if (fn !== 'claim_new_cron_failures') throw new Error(`unexpected rpc ${fn}`);
      if (opts.rpcError) return Promise.resolve({ data: null, error: new Error(opts.rpcError) });
      return Promise.resolve({ data: opts.failures, error: null });
    },
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: opts.emails.map((email) => ({ email })), error: null }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

function fakeGmailFetch() {
  return async (url: string) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'fake-access-token' }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'abc' }), { status: 200 });
  };
}

Deno.test('buildAlertEmail: single failed job produces a singular subject listing the one job', () => {
  const failures: CronFailure[] = [
    { jobname: 'generate-weekly-schedule-monday', runid: 42, start_time: '2026-09-08T01:00:00Z', return_message: 'timeout' },
  ];
  const { subject, text } = buildAlertEmail(failures);
  assertEquals(subject, 'Cron job failure: generate-weekly-schedule-monday');
  assertEquals(text.includes('generate-weekly-schedule-monday'), true);
  assertEquals(text.includes('timeout'), true);
  assertEquals(text.includes('run 42'), true);
});

Deno.test('buildAlertEmail: multiple distinct jobs produce a plural subject naming the count', () => {
  const failures: CronFailure[] = [
    { jobname: 'job-a', runid: 1, start_time: '2026-09-08T01:00:00Z', return_message: 'boom' },
    { jobname: 'job-b', runid: 2, start_time: '2026-09-08T01:05:00Z', return_message: null },
  ];
  const { subject, text } = buildAlertEmail(failures);
  assertEquals(subject, '2 cron jobs failed');
  assertEquals(text.includes('job-a'), true);
  assertEquals(text.includes('job-b'), true);
  assertEquals(text.includes('no error message'), true);
});

Deno.test('buildAlertEmail: repeated failures for the same job still count as one job in the subject', () => {
  const failures: CronFailure[] = [
    { jobname: 'job-a', runid: 1, start_time: '2026-09-08T01:00:00Z', return_message: 'boom' },
    { jobname: 'job-a', runid: 2, start_time: '2026-09-08T01:15:00Z', return_message: 'boom again' },
  ];
  const { subject } = buildAlertEmail(failures);
  assertEquals(subject, 'Cron job failure: job-a');
});

Deno.test('runCronFailureAlertCheck: sends nothing when the RPC returns no new failures', async () => {
  const client = fakeClient({ failures: [], emails: ['a@example.com'] });
  let fetchCalled = false;
  const fakeFetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };
  const result = await runCronFailureAlertCheck(client, CREDENTIALS, fakeFetch as unknown as typeof fetch);
  assertEquals(result, { alerted: false, failures: 0 });
  assertEquals(fetchCalled, false);
});

Deno.test('runCronFailureAlertCheck: emails every approved profile when new failures are found', async () => {
  const failures: CronFailure[] = [
    { jobname: 'sync-schedule-pms-status-minutely', runid: 7, start_time: '2026-09-08T02:00:00Z', return_message: 'connection refused' },
  ];
  const client = fakeClient({ failures, emails: ['a@example.com', 'b@example.com'] });
  const result = await runCronFailureAlertCheck(client, CREDENTIALS, fakeGmailFetch() as unknown as typeof fetch);
  assertEquals(result, { alerted: true, failures: 1, sent: 2, failed: 0 });
});

Deno.test('runCronFailureAlertCheck: propagates an RPC error instead of silently sending nothing', async () => {
  const client = fakeClient({ failures: [], emails: [], rpcError: 'permission denied for cron.job_run_details' });
  let threw = false;
  try {
    await runCronFailureAlertCheck(client, CREDENTIALS, fakeGmailFetch() as unknown as typeof fetch);
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, 'permission denied for cron.job_run_details');
  }
  assertEquals(threw, true);
});
