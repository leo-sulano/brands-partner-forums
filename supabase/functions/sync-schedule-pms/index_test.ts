import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncAllTabStatuses, handleSyncAllStatuses, handleAuditAllStatuses, handleReconcileColumns, buildParityAlertEmail } from './index.ts';
import type { SchedulePmsParityIssue } from '../../../src/lib/scheduler/pmsSync.ts';
import type { GmailCredentials } from '../_shared/gmail.ts';

Deno.test('syncAllTabStatuses processes every given tab independently, isolating one failure', async () => {
  const calls: string[] = [];
  const fakeResolve = async (tab: string) => {
    calls.push(tab);
    if (tab === 'Trybet') throw new Error('boom');
    return { synced: [], failed: [], cancelled: [], cancelFailed: [], pageRemoved: [], pageRemovedFailed: [] };
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
    pageRemoved: [],
    pageRemovedFailed: [],
  });
  const results = await syncAllTabStatuses([{ tab: 'BITP', paused: false }], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(results['BITP'], 'error: 1 link(s) failed to move, 2 link(s) failed to cancel');
});

Deno.test('syncAllTabStatuses reports a page-removed move failure alongside the other two failure counts', async () => {
  const fakeResolve = async () => ({
    synced: [],
    failed: [],
    cancelled: [],
    cancelFailed: [],
    pageRemoved: [],
    pageRemovedFailed: [{ item: {} as any, error: 'move-to-page-removed boom' }],
  });
  const results = await syncAllTabStatuses([{ tab: 'BITP', paused: false }], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(results['BITP'], 'error: 1 link(s) failed to move to Page Removed');
});

Deno.test('syncAllTabStatuses reports ok when only cancelled/pageRemoved items are non-empty, with zero failures', async () => {
  const fakeResolve = async () => ({
    synced: [],
    failed: [],
    cancelled: [{ tab: 'BITP', brand: 'X', platform: 'tp' as const, date: '2026-08-27' }],
    cancelFailed: [],
    pageRemoved: [{ tab: 'BITP', brand: 'Y', platform: 'tp' as const, date: '2026-08-27' }],
    pageRemovedFailed: [],
  });
  const results = await syncAllTabStatuses([{ tab: 'BITP', paused: false }], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(results['BITP'], 'ok');
});

Deno.test('syncAllTabStatuses processes only the given tab when the list has one entry', async () => {
  const calls: string[] = [];
  const fakeResolve = async (tab: string) => {
    calls.push(tab);
    return { synced: [], failed: [], cancelled: [], cancelFailed: [], pageRemoved: [], pageRemovedFailed: [] };
  };
  const results = await syncAllTabStatuses([{ tab: 'Wizard of Odds', paused: false }], {} as SupabaseClient, { apiToken: 'test-token' }, fetch, fakeResolve as any);
  assertEquals(calls, ['Wizard of Odds']);
  assertEquals(Object.keys(results), ['Wizard of Odds']);
});

Deno.test('syncAllTabStatuses passes each tab\'s paused flag through to resolveFn as the 5th argument', async () => {
  const calls: { tab: string; paused: unknown }[] = [];
  const fakeResolve = async (tab: string, _c: unknown, _cr: unknown, _f: unknown, paused: unknown) => {
    calls.push({ tab, paused });
    return { synced: [], failed: [], cancelled: [], cancelFailed: [], pageRemoved: [], pageRemovedFailed: [] };
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

// backfillActiveTabs wiring: reached by handleSyncAllStatuses too (Task 325
// follow-up) so the "missing link" gap self-heals on the 1-minute cron and
// the on-visit browser trigger, not only the once-daily audit below.
// backfillFn is injectable so these never touch a real Supabase client or
// PMS API, same pattern as the handleAuditAllStatuses tests further down.

Deno.test('handleSyncAllStatuses calls backfillFn for every active tab in an unscoped sweep', async () => {
  const backfillCalls: string[] = [];
  await handleSyncAllStatuses(
    {},
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => ['GRG - Gulf Recovery Group'],
    async (tab: string) => {
      backfillCalls.push(tab);
      return { created: [], skipped: [], failed: [] };
    },
  );
  // Active tabs only -- the paused GRG never gets a backfill call.
  assertEquals(backfillCalls.sort(), ['BITP', 'Hanan']);
});

Deno.test('handleSyncAllStatuses calls backfillFn for a single requested active tab, and folds a non-empty result into it', async () => {
  const backfillCalls: string[] = [];
  const results = await handleSyncAllStatuses(
    { tab: 'Hanan' },
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => [],
    async (tab: string) => {
      backfillCalls.push(tab);
      return {
        created: [{ tab: 'Hanan', tabLabel: 'Hanan', brand: 'WinMega', platform: 'tp', date: '2026-09-07' }],
        skipped: [],
        failed: [],
      };
    },
    async () => ({ created: [], failed: [] }),
  );
  assertEquals(backfillCalls, ['Hanan']);
  assertEquals(results['Hanan'].endsWith('; backfilled 1 missing link(s)'), true);
});

Deno.test('handleSyncAllStatuses never calls backfillFn when the requested body.tab is currently paused', async () => {
  const backfillCalls: string[] = [];
  await handleSyncAllStatuses(
    { tab: 'GRG - Gulf Recovery Group' },
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => ['GRG - Gulf Recovery Group'],
    async (tab: string) => {
      backfillCalls.push(tab);
      return { created: [], skipped: [], failed: [] };
    },
  );
  assertEquals(backfillCalls, []);
});


// handleAuditAllStatuses tests: the once-daily audit ('auditAllStatuses'
// action) always covers every active+paused tab (no body.tab scoping, unlike
// handleSyncAllStatuses) -- see the doc comment above the real function in
// index.ts for why it's kept as its own action even though
// resolveAndSyncTabStatuses no longer has a watermark short-circuit to force
// past (Tasks 287/288/302 in docs/task-history.md).

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

Deno.test('handleAuditAllStatuses delegates to the real syncAllTabStatuses loop, same as handleSyncAllStatuses', async () => {
  // No resolveFn injection at this layer (handleAuditAllStatuses has none,
  // same as handleSyncAllStatuses) -- proves this reaches the real
  // resolveAndSyncTabStatuses call through the real syncAllTabStatuses, not
  // just that handleAuditAllStatuses's own signature is well-formed.
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

// backfillMissingScheduledLinks step: runs once per active tab after the
// status sweep (Task 325, docs/task-history.md -- closes the "Schedule
// Planner shows more scheduled slots than the PMS board has cards for" gap,
// where a per-item push failure during generation/a page visit is never
// retried anywhere). backfillFn is injectable so these tests never touch a
// real Supabase client or PMS API.

Deno.test('handleAuditAllStatuses calls backfillFn once per active tab, never for a paused tab', async () => {
  const backfillCalls: string[] = [];
  await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => ['GRG - Gulf Recovery Group'],
    async (tab: string) => {
      backfillCalls.push(tab);
      return { created: [], skipped: [], failed: [] };
    },
  );
  assertEquals(backfillCalls.sort(), ['BITP', 'Hanan']);
});

// The fake {} client has no .from, so syncAllTabStatuses' own real resolve
// step (handleAuditAllStatuses exposes no resolveFn injection, unlike
// syncAllTabStatuses itself -- see the "delegates to the real
// syncAllTabStatuses loop" test above) always leaves results['BITP'] as an
// 'error: ...' string before backfill even runs here -- so these three
// assert the backfill note is appended (joined with '; '), not that it
// replaces an 'ok' this fixture can't produce at this layer.

Deno.test('handleAuditAllStatuses appends a non-empty backfill result onto that tab\'s existing result string', async () => {
  const results = await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP'],
    () => [],
    async () => ({
      created: [{ tab: 'BITP', tabLabel: 'BITP', brand: 'Alf Casino', platform: 'tp', date: '2026-09-07' }],
      skipped: [],
      failed: [],
    }),
    undefined,
    undefined,
    undefined,
    async () => ({ created: [], failed: [] }),
  );
  assertEquals(results['BITP'].endsWith('; backfilled 1 missing link(s)'), true);
});

Deno.test('handleAuditAllStatuses isolates one tab\'s backfill failure from the rest', async () => {
  const results = await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => [],
    async (tab: string) => {
      if (tab === 'BITP') throw new Error('boom');
      return { created: [], skipped: [], failed: [] };
    },
    undefined,
    undefined,
    undefined,
    async () => ({ created: [], failed: [] }),
  );
  assertEquals(results['BITP'].endsWith('; backfill error: boom'), true);
  // Hanan's backfill returns nothing to report, so only its own (real,
  // fake-client-induced) resolve error remains -- no backfill suffix.
  assertEquals(results['Hanan'].includes('backfill'), false);
});

Deno.test('handleAuditAllStatuses leaves a tab\'s result string untouched when its backfill has nothing to report', async () => {
  const results = await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP'],
    () => [],
    async () => ({ created: [], skipped: [], failed: [] }),
    undefined,
    undefined,
    undefined,
    async () => ({ created: [], failed: [] }),
  );
  assertEquals(results['BITP'].includes('backfill'), false);
});

// Schedule Planner <-> PMS parity check (Task 341, docs/task-history.md): a
// defense-in-depth guard, run once per active tab after the status sweep and
// backfill, that flags any date where the calendar's active-plan count and
// the linked PMS cards' active-status count still disagree even after both
// of those already ran. parityFn is injectable so these never touch a real
// Supabase client or PMS API, same pattern as backfillFn's own tests above.

Deno.test('handleAuditAllStatuses calls parityFn once per active tab, never for a paused tab, and appends a non-empty result', async () => {
  const parityCalls: string[] = [];
  const results = await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => ['GRG - Gulf Recovery Group'],
    async () => ({ created: [], skipped: [], failed: [] }),
    async (tab: string) => {
      parityCalls.push(tab);
      return tab === 'BITP'
        ? [{ tab, date: '2026-09-16', plannerActiveCount: 15, pmsActiveLinkCount: 14, pmsTotalLinkCount: 15 }]
        : [];
    },
  );
  assertEquals(parityCalls.sort(), ['BITP', 'Hanan']);
  assertEquals(results['BITP'].endsWith('; parity mismatch on 1 date(s)'), true);
  assertEquals(results['Hanan'].includes('parity'), false);
});

Deno.test('handleAuditAllStatuses isolates one tab\'s parity-check failure from the rest', async () => {
  const results = await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP', 'Hanan'],
    () => [],
    async () => ({ created: [], skipped: [], failed: [] }),
    async (tab: string) => {
      if (tab === 'BITP') throw new Error('boom');
      return [];
    },
  );
  // A thrown parityFn is caught and logged, never surfaced into results --
  // unlike a backfill failure (which IS surfaced, see the dedicated test
  // above), a parity-check failure has nothing actionable to report beyond
  // what the console.error already captures, and must never make a tab's
  // otherwise-healthy sync/backfill result look like it failed too.
  assertEquals(results['BITP'].includes('parity'), false);
  assertEquals(results['Hanan'].includes('parity'), false);
});

Deno.test('handleAuditAllStatuses sends one alert email when parity issues are found and Gmail credentials are configured', async () => {
  const sendCalls: { subject: string; text: string }[] = [];
  await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP'],
    () => [],
    async () => ({ created: [], skipped: [], failed: [] }),
    async () => [{ tab: 'BITP', date: '2026-09-16', plannerActiveCount: 15, pmsActiveLinkCount: 14, pmsTotalLinkCount: 15 }],
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', senderEmail: 'bot@example.com' } as GmailCredentials,
    async (_client, _creds, subject: string, text: string) => {
      sendCalls.push({ subject, text });
      return { sent: 1, failed: 0 };
    },
  );
  assertEquals(sendCalls.length, 1);
  assertEquals(sendCalls[0].text.includes('BITP / 2026-09-16'), true);
});

Deno.test('handleAuditAllStatuses never sends an alert email when no parity issues are found', async () => {
  let sendCalls = 0;
  await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP'],
    () => [],
    async () => ({ created: [], skipped: [], failed: [] }),
    async () => [],
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', senderEmail: 'bot@example.com' } as GmailCredentials,
    async () => {
      sendCalls++;
      return { sent: 1, failed: 0 };
    },
  );
  assertEquals(sendCalls, 0);
});

Deno.test('handleAuditAllStatuses skips the alert email when Gmail credentials are not configured, without failing the action', async () => {
  const results = await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP'],
    () => [],
    async () => ({ created: [], skipped: [], failed: [] }),
    async () => [{ tab: 'BITP', date: '2026-09-16', plannerActiveCount: 15, pmsActiveLinkCount: 14, pmsTotalLinkCount: 15 }],
    undefined,
    async () => {
      throw new Error('should never be called with no gmailCredentials');
    },
  );
  assertEquals(results['BITP'].endsWith('; parity mismatch on 1 date(s)'), true);
});

Deno.test('handleAuditAllStatuses swallows a send-email failure without throwing', async () => {
  const results = await handleAuditAllStatuses(
    {} as SupabaseClient,
    { apiToken: 'test-token' },
    fetch,
    async () => {},
    () => ['BITP'],
    () => [],
    async () => ({ created: [], skipped: [], failed: [] }),
    async () => [{ tab: 'BITP', date: '2026-09-16', plannerActiveCount: 15, pmsActiveLinkCount: 14, pmsTotalLinkCount: 15 }],
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', senderEmail: 'bot@example.com' } as GmailCredentials,
    async () => {
      throw new Error('Gmail 500');
    },
  );
  assertEquals(results['BITP'].endsWith('; parity mismatch on 1 date(s)'), true);
});

Deno.test('buildParityAlertEmail lists each issue with its tab, date, and counts, and names every affected tab in the subject', () => {
  const issues: SchedulePmsParityIssue[] = [
    { tab: 'BITP', date: '2026-09-16', plannerActiveCount: 15, pmsActiveLinkCount: 14, pmsTotalLinkCount: 15 },
    { tab: 'Hanan', date: '2026-09-17', plannerActiveCount: 12, pmsActiveLinkCount: 13, pmsTotalLinkCount: 13 },
  ];
  const { subject, text } = buildParityAlertEmail(issues);
  assertEquals(subject.includes('2 date(s)'), true);
  assertEquals(subject.includes('2 tab(s)'), true);
  assertEquals(text.includes('BITP / 2026-09-16: Schedule Planner shows 15 active, PMS shows 14 active of 15 linked card(s)'), true);
  assertEquals(text.includes('Hanan / 2026-09-17: Schedule Planner shows 12 active, PMS shows 13 active of 13 linked card(s)'), true);
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
