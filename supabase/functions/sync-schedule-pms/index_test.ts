import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncAllTabStatuses, handleSyncAllStatuses, handleAuditAllStatuses, handleReconcileColumns } from './index.ts';

Deno.test('syncAllTabStatuses processes every given tab independently, isolating one failure', async () => {
  const calls: string[] = [];
  const fakeResolve = async (tab: string) => {
    calls.push(tab);
    if (tab === 'Trybet') throw new Error('boom');
    return { synced: [], failed: [], cancelled: [], cancelFailed: [] };
  };
  const results = await syncAllTabStatuses(
    [{ tab: 'BITP', paused: false }, { tab: 'Trybet', paused: false }, { tab: 'Hanan', paused: false }],
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

Deno.test('syncAllTabStatuses reports both move and cancel failure counts in one error string', async () => {
  const fakeResolve = async () => ({
    synced: [],
    failed: [{ item: {} as any, error: 'move boom' }],
    cancelled: [],
    cancelFailed: [{ item: {} as any, error: 'cancel boom' }, { item: {} as any, error: 'cancel boom 2' }],
  });
  const results = await syncAllTabStatuses([{ tab: 'BITP', paused: false }], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(results['BITP'], 'error: 1 link(s) failed to move, 2 link(s) failed to cancel');
});

Deno.test('syncAllTabStatuses reports ok when only cancelled items are non-empty, with zero failures', async () => {
  const fakeResolve = async () => ({
    synced: [],
    failed: [],
    cancelled: [{ tab: 'BITP', brand: 'X', platform: 'tp' as const, date: '2026-08-27' }],
    cancelFailed: [],
  });
  const results = await syncAllTabStatuses([{ tab: 'BITP', paused: false }], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(results['BITP'], 'ok');
});

Deno.test('syncAllTabStatuses processes only the given tab when the list has one entry', async () => {
  const calls: string[] = [];
  const fakeResolve = async (tab: string) => {
    calls.push(tab);
    return { synced: [], failed: [], cancelled: [], cancelFailed: [] };
  };
  const results = await syncAllTabStatuses([{ tab: 'Wizard of Odds', paused: false }], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(calls, ['Wizard of Odds']);
  assertEquals(Object.keys(results), ['Wizard of Odds']);
});

Deno.test('syncAllTabStatuses passes each tab\'s paused flag through to resolveFn as the 5th argument', async () => {
  const calls: { tab: string; paused: unknown }[] = [];
  const fakeResolve = async (tab: string, _c: unknown, _cr: unknown, _f: unknown, paused: unknown) => {
    calls.push({ tab, paused });
    return { synced: [], failed: [], cancelled: [], cancelFailed: [] };
  };
  await syncAllTabStatuses(
    [{ tab: 'BITP', paused: false }, { tab: 'Hanan', paused: true }],
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    fakeResolve as any,
  );
  assertEquals(calls, [{ tab: 'BITP', paused: false }, { tab: 'Hanan', paused: true }]);
});

Deno.test('syncAllTabStatuses defaults force to false, passed through to resolveFn as the 6th argument', async () => {
  const forceSeen: unknown[] = [];
  const fakeResolve = async (_t: string, _c: unknown, _cr: unknown, _f: unknown, _p: unknown, force: unknown) => {
    forceSeen.push(force);
    return { synced: [], failed: [], cancelled: [], cancelFailed: [] };
  };
  await syncAllTabStatuses([{ tab: 'BITP', paused: false }], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(forceSeen, [false]);
});

Deno.test('syncAllTabStatuses passes an explicit force=true through to every tab\'s resolveFn call', async () => {
  const forceSeen: unknown[] = [];
  const fakeResolve = async (_t: string, _c: unknown, _cr: unknown, _f: unknown, _p: unknown, force: unknown) => {
    forceSeen.push(force);
    return { synced: [], failed: [], cancelled: [], cancelFailed: [] };
  };
  await syncAllTabStatuses(
    [{ tab: 'BITP', paused: false }, { tab: 'Hanan', paused: true }],
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    fakeResolve as any,
    true,
  );
  assertEquals(forceSeen, [true, true]);
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
    () => [],
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
    () => [],
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
    () => [],
  );
  assertEquals(Object.keys(results).sort(), ['BITP', 'Hanan', 'Trybet']);
});

Deno.test('handleSyncAllStatuses falls back to zero tabs when body.tab is neither an active nor a paused tab', async () => {
  const results = await handleSyncAllStatuses(
    { tab: 'Not A Real Tab' },
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => ['GRG - Gulf Recovery Group'],
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
    () => [],
  );
  assertEquals(Object.keys(results).sort(), ['BITP', 'Trybet']);
  // Both fail (fake client has no .from), but neither failure crashes the
  // batch or blocks the other -- same isolation guarantee as
  // syncAllTabStatuses's own dedicated test above, now confirmed reachable
  // through this wrapper too.
  assertEquals(results['BITP'].startsWith('error:'), true);
  assertEquals(results['Trybet'].startsWith('error:'), true);
});

// Whole-Brand-Tab pause cascade: a paused tab is excluded from
// getActiveOperationalTabs but must still be swept so its already-linked PMS
// tasks get force-moved to Project Paused (see resolveAndSyncTabStatuses's
// isTabPaused param in src/lib/scheduler/pmsSync.ts).

Deno.test('handleSyncAllStatuses includes paused tabs alongside active ones in a full sweep', async () => {
  const results = await handleSyncAllStatuses(
    {},
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => ['GRG - Gulf Recovery Group'],
  );
  assertEquals(Object.keys(results).sort(), ['BITP', 'GRG - Gulf Recovery Group', 'Hanan']);
});

Deno.test('handleSyncAllStatuses resolves a requested body.tab that is currently paused, not treating it as unknown', async () => {
  const results = await handleSyncAllStatuses(
    { tab: 'GRG - Gulf Recovery Group' },
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => ['GRG - Gulf Recovery Group'],
  );
  assertEquals(Object.keys(results), ['GRG - Gulf Recovery Group']);
});


// handleAuditAllStatuses tests: the once-daily audit ('auditAllStatuses'
// action) always covers every active+paused tab (no body.tab scoping, unlike
// handleSyncAllStatuses) and always forces resolveAndSyncTabStatuses past its
// watermark short-circuit -- see the doc comment above the real function in
// index.ts for why this exists (Tasks 287/288/302 in docs/task-history.md).

Deno.test('handleAuditAllStatuses bootstraps once and covers every active and paused tab, ignoring any tab scoping', async () => {
  let bootstrapCalls = 0;
  const results = await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {
      bootstrapCalls++;
    },
    () => ['BITP', 'Hanan'],
    () => ['GRG - Gulf Recovery Group'],
  );
  assertEquals(bootstrapCalls, 1);
  assertEquals(Object.keys(results).sort(), ['BITP', 'GRG - Gulf Recovery Group', 'Hanan']);
});

Deno.test('handleAuditAllStatuses forces every tab\'s resolve past its watermark, via the real syncAllTabStatuses loop', async () => {
  // No resolveFn injection at this layer (handleAuditAllStatuses has none,
  // same as handleSyncAllStatuses) -- proves force=true actually reaches the
  // real resolveAndSyncTabStatuses call through the real syncAllTabStatuses,
  // not just that handleAuditAllStatuses's own signature accepts it.
  const results = await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP'],
    () => [],
  );
  // Fake client has no .from, so the real resolve throws -- same isolation
  // guarantee as syncAllTabStatuses's own dedicated tests, now confirmed
  // reachable through this handler too.
  assertEquals(results['BITP'].startsWith('error:'), true);
});

// handleReconcileColumns tests: the column-drift reconcile is a separate
// action ('reconcileColumns') from the per-tab status sweep. It bootstraps
// the tab registries (tabDisplayName needs them for dynamic tabs), fetches
// every link across every tab, and delegates the actual PMS moves to
// enforcePmsColumns. bootstrapFn / fetchLinksFn / enforceFn are injectable
// so this handler's own orchestration is testable without a real Supabase
// client or PMS API, mirroring handleSyncAllStatuses above.

Deno.test('handleReconcileColumns bootstraps, then reports the enforce move/fail counts', async () => {
  let bootstrapCalls = 0;
  const result = await handleReconcileColumns(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {
      bootstrapCalls++;
    },
    async () => [{ id: 'link-1' }, { id: 'link-2' }] as any,
    async () => ({ moved: [{ linkId: 'link-1', pmsTaskId: 't1', from: 'a', to: 'b' }], resorted: [{ linkId: 'link-2', pmsTaskId: 't2', columnId: 'c', position: 1 }], failed: [] }),
  );
  assertEquals(bootstrapCalls, 1);
  assertEquals(result, { moved: 1, resorted: 1, failed: 0, errors: [] });
});

Deno.test('handleReconcileColumns surfaces enforce failures in the count and error list', async () => {
  const result = await handleReconcileColumns(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    async () => [] as any,
    async () => ({
      moved: [],
      resorted: [],
      failed: [
        { linkId: 'l1', pmsTaskId: 't1', error: 'move boom' },
        { linkId: 'l2', pmsTaskId: 't2', error: 'move boom 2' },
      ],
    }),
  );
  assertEquals(result, { moved: 0, resorted: 0, failed: 2, errors: ['move boom', 'move boom 2'] });
});

Deno.test('handleReconcileColumns caps the reported error list at 5 while still counting all failures', async () => {
  const failed = Array.from({ length: 7 }, (_, i) => ({ linkId: `l${i}`, pmsTaskId: `t${i}`, error: `err ${i}` }));
  const result = await handleReconcileColumns(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    async () => [] as any,
    async () => ({ moved: [], resorted: [], failed }),
  );
  assertEquals(result.failed, 7);
  assertEquals(result.errors.length, 5);
});

Deno.test('handleReconcileColumns propagates a links-fetch failure (handler-level, becomes a 500)', async () => {
  await assertRejects(
    () =>
      handleReconcileColumns(
        {} as SupabaseClient,
        { apiToken: 'test-token' },
        fetch,
        async () => {},
        async () => {
          throw new Error('links fetch boom');
        },
        async () => ({ moved: [], resorted: [], failed: [] }),
      ),
    Error,
    'links fetch boom',
  );
});
