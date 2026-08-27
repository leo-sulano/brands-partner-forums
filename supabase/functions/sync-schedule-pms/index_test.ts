import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncAllTabStatuses } from './index.ts';

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
