/// <reference path="./vite-env-shim.d.ts" />
// supabase/functions/sync-schedule-pms/index.ts
// Thin HTTP wrapper: all real logic lives in src/lib/scheduler/pmsSync.ts,
// shared with generate-weekly-schedule so the two never implement the push/
// pull/status-resolution logic twice. Holds PMS_API_TOKEN as a Supabase
// secret -- the browser never sees it.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pushScheduleToPms, pullScheduleFromPms, resolveAndSyncTabStatuses, type PmsSyncItem, type PmsCredentials, type PmsStatusSyncResult } from '../../../src/lib/scheduler/pmsSync.ts';
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
  resolveFn: (tab: string, client: SupabaseClient, credentials: PmsCredentials, fetchFn: typeof fetch) => Promise<PmsStatusSyncResult> = resolveAndSyncTabStatuses,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const tab of tabs) {
    try {
      const result = await resolveFn(tab, client, credentials, fetchFn);
      results[tab] = result.failed.length > 0 ? `error: ${result.failed.length} link(s) failed to move` : 'ok';
    } catch (err) {
      console.error(`[sync-schedule-pms] syncAllStatuses ${tab} failed:`, err);
      results[tab] = `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      invalidateTabCache(tab);
    }
  }
  return results;
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
    if (body?.action === 'syncAllStatuses') {
      await bootstrapTabRegistries(client, 'sync-schedule-pms');
      const tabs = typeof body.tab === 'string' && body.tab ? [body.tab] : getActiveOperationalTabs();
      const results = await syncAllTabStatuses(tabs, client, credentials, fetch);
      return jsonResponse({ results });
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Sync failed' }, 500);
  }
});
