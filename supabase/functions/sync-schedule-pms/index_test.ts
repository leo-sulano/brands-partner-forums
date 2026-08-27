import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncAllTabStatuses, handleSyncAllStatuses } from './index.ts';

Deno.test('syncAllTabStatuses processes every given tab independently, isolating one failure', async () => {
  const calls: string[] = [];
  const fakeResolve = async (tab: string) => {
    calls.push(tab);
    if (tab === 'Trybet') throw new Error('boom');
    return { synced: [], failed: [] };
  };
  const results = await syncAllTabStatuses(
    ['BITP', 'Trybet', 'Hanan'],
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    fakeResolve as any,
  );
  assertEquals(calls, ['BITP', 'Trybet', 'Hanan']);
  assertEquals(results['BITP'], 'ok');
  assertEquals(results['Trybet'], 'error: boom');
  assertEquals(results['Hanan'], 'ok');
});

Deno.test('syncAllTabStatuses processes only the given tab when the list has one entry', async () => {
  const calls: string[] = [];
  const fakeResolve = async (tab: string) => {
    calls.push(tab);
    return { synced: [], failed: [] };
  };
  const results = await syncAllTabStatuses(['Wizard of Odds'], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(calls, ['Wizard of Odds']);
  assertEquals(Object.keys(results), ['Wizard of Odds']);
});

// handleSyncAllStatuses tests below cover the Deno.serve handler's own
// routing logic (bootstrap-then-select-tabs), which previously had zero
// direct test coverage -- only the per-tab loop it delegates to
// (syncAllTabStatuses, above) was tested. A deliberately-invalid fake
// SupabaseClient ({} as SupabaseClient, `.from` undefined) is used
// throughout: the real (non-injected) syncAllTabStatuses/
// resolveAndSyncTabStatuses will throw synchronously trying to call
// `client.from(...)`, which syncAllTabStatuses's own per-tab try/catch turns
// into an 'error: ...' result rather than letting it escape -- so
// Object.keys(results) still faithfully reports exactly which tabs were
// selected and processed, without needing a resolveFn injection point on
// handleSyncAllStatuses itself (it has none; only bootstrapFn/
// getActiveTabsFn are injectable, matching the two behaviors this handler
// itself is responsible for).

Deno.test('handleSyncAllStatuses runs bootstrap even when body.tab names a real active tab', async () => {
  let bootstrapCalls = 0;
  const results = await handleSyncAllStatuses(
    { tab: 'BITP' },
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {
      bootstrapCalls++;
    },
    () => ['BITP', 'Hanan'],
  );
  assertEquals(bootstrapCalls, 1);
  assertEquals(Object.keys(results), ['BITP']);
});

Deno.test('handleSyncAllStatuses processes only the requested tab, not every active tab', async () => {
  const results = await handleSyncAllStatuses(
    { tab: 'Hanan' },
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan', 'Trybet'],
  );
  assertEquals(Object.keys(results), ['Hanan']);
});

Deno.test('handleSyncAllStatuses processes every active tab when body.tab is omitted', async () => {
  const results = await handleSyncAllStatuses(
    {},
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan', 'Trybet'],
  );
  assertEquals(Object.keys(results).sort(), ['BITP', 'Hanan', 'Trybet']);
});

Deno.test('handleSyncAllStatuses falls back to zero tabs when body.tab is not a real active tab', async () => {
  const results = await handleSyncAllStatuses(
    { tab: 'Not A Real Tab' },
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
  );
  assertEquals(results, {});
});

Deno.test('handleSyncAllStatuses still isolates one tab failure from the rest via the real syncAllTabStatuses loop', async () => {
  // No resolveFn injection at this layer -- proves the wrapper delegates to
  // the real syncAllTabStatuses (whose own isolation/eviction behavior is
  // already covered by the tests above) rather than reimplementing the loop.
  const results = await handleSyncAllStatuses(
    {},
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Trybet'],
  );
  assertEquals(Object.keys(results).sort(), ['BITP', 'Trybet']);
  // Both fail (fake client has no .from), but neither failure crashes the
  // batch or blocks the other -- same isolation guarantee as
  // syncAllTabStatuses's own dedicated test above, now confirmed reachable
  // through this wrapper too.
  assertEquals(results['BITP'].startsWith('error:'), true);
  assertEquals(results['Trybet'].startsWith('error:'), true);
});
