/// <reference path="./vite-env-shim.d.ts" />
// supabase/functions/sync-schedule-pms/index.ts
// Thin HTTP wrapper: all real logic lives in src/lib/scheduler/pmsSync.ts,
// shared with generate-weekly-schedule so the two never implement the push/
// pull logic twice. Holds PMS_API_TOKEN as a Supabase secret -- the browser
// never sees it.
import { createClient } from '@supabase/supabase-js';
import { pushScheduleToPms, pullScheduleFromPms, type PmsSyncItem } from '../../../src/lib/scheduler/pmsSync.ts';

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

  const client = createClient(SUPABASE_URL, SERVICE_ROLE);
  const credentials = { apiToken: PMS_API_TOKEN };

  try {
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
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Sync failed' }, 500);
  }
});
