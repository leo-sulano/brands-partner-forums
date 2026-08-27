/// <reference path="./vite-env-shim.d.ts" />
// supabase/functions/sync-schedule-pms/index.ts
// Thin HTTP wrapper: all real logic lives in src/lib/scheduler/pmsSync.ts,
// shared with generate-weekly-schedule so the two never implement the push/
// pull/status-resolution logic twice. Holds PMS_API_TOKEN as a Supabase
// secret -- the browser never sees it.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pushScheduleToPms, pullScheduleFromPms, resolveAndSyncTabStatuses, cancelScheduleInPms, type PmsSyncItem, type PmsCancelItem, type PmsCredentials, type PmsResolveResult } from '../../../src/lib/scheduler/pmsSync.ts';
import { bootstrapTabRegistries } from '../../../src/lib/tabRegistryBootstrap.ts';
import { getActiveOperationalTabs } from '../../../src/lib/pausedTabRegistry.ts';
import { invalidateTabCache } from '../../../src/lib/queries.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const PMS_API_TOKEN = Deno.env.get('PMS_API_TOKEN') || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

// Mirrors generate-weekly-schedule/index.ts's generateAllTabs exactly: one
// tab's failure (a transient PMS API error, a malformed entry) must never
// block the rest. invalidateTabCache runs after every tab, success or
// failure, for the same reason generateAllTabs already evicts per-tab --
// fetchRawEntriesByTab caches a tab's full entry list with no write-side
// eviction, and this action can run every minute across every active tab.
// resolveFn is injectable so tests can verify this loop's isolation/eviction
// behavior without a real Supabase client or PMS API.
export async function syncAllTabStatuses(
  tabs: readonly string[],
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
  resolveFn: (tab: string, client: SupabaseClient, credentials: PmsCredentials, fetchFn: typeof fetch) => Promise<PmsResolveResult> = resolveAndSyncTabStatuses,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const tab of tabs) {
    try {
      const result = await resolveFn(tab, client, credentials, fetchFn);
      const failures: string[] = [];
      if (result.failed.length > 0) failures.push(`${result.failed.length} link(s) failed to move`);
      if (result.cancelFailed.length > 0) failures.push(`${result.cancelFailed.length} link(s) failed to cancel`);
      results[tab] = failures.length > 0 ? `error: ${failures.join(', ')}` : 'ok';
    } catch (err) {
      console.error(`[sync-schedule-pms] syncAllStatuses ${tab} failed:`, err);
      results[tab] = `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      invalidateTabCache(tab);
    }
  }
  return results;
}

// Extracted so the handler's own routing logic -- bootstrap unconditionally,
// then select which tab(s) to sync -- is directly testable without a real
// Supabase client or PMS API, mirroring how syncAllTabStatuses above was
// already extracted for the same reason. A requested body.tab that isn't a
// real, currently-active tab (a stale/bogus name) falls back to an empty
// tab list rather than being passed through unvalidated -- resolveFn/
// resolveAndSyncTabStatuses already no-ops safely on an unknown tab (its
// fetchSchedulePmsLinks lookup just returns zero links), but validating here
// means an invalid tab produces an explicit empty `results` rather than a
// silent no-op indistinguishable from "nothing needed syncing".
export async function handleSyncAllStatuses(
  body: { tab?: unknown },
  client: SupabaseClient,
  credentials: PmsCredentials,
  fetchFn: typeof fetch,
  bootstrapFn: typeof bootstrapTabRegistries = bootstrapTabRegistries,
  getActiveTabsFn: typeof getActiveOperationalTabs = getActiveOperationalTabs,
): Promise<Record<string, string>> {
  await bootstrapFn(client, 'sync-schedule-pms');
  const activeTabs = getActiveTabsFn();
  const tabs = typeof body.tab === 'string' && body.tab
    ? (activeTabs.includes(body.tab) ? [body.tab] : [])
    : activeTabs;
  return syncAllTabStatuses(tabs, client, credentials, fetchFn);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!req.headers.get('authorization')) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!PMS_API_TOKEN) return jsonResponse({ error: 'PMS sync not configured' }, 500);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const credentials = { apiToken: PMS_API_TOKEN };

  try {
    const client = createClient(SUPABASE_URL, SERVICE_ROLE);
    if (body?.action === 'push') {
      if (!Array.isArray(body.items)) return jsonResponse({ error: 'items must be an array' }, 400);
      const result = await pushScheduleToPms(body.items as PmsSyncItem[], client, credentials);
      return jsonResponse(result);
    }
    if (body?.action === 'pull') {
      if (typeof body.tab !== 'string' || !body.tab) return jsonResponse({ error: 'Missing tab' }, 400);
      const result = await pullScheduleFromPms(body.tab, client, credentials);
      return jsonResponse(result);
    }
    if (body?.action === 'cancelSchedule') {
      if (!Array.isArray(body.items)) return jsonResponse({ error: 'items must be an array' }, 400);
      const result = await cancelScheduleInPms(body.items as PmsCancelItem[], client, credentials);
      return jsonResponse(result);
    }
    if (body?.action === 'syncAllStatuses') {
      const results = await handleSyncAllStatuses(body, client, credentials, fetch);
      return jsonResponse({ results });
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Sync failed' }, 500);
  }
});
