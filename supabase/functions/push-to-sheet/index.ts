// Supabase Edge Function: push-to-sheet
//
// Receives { tab, sheet_row_id, fields } from the dashboard, merges into
// public.entries, then writes the same fields to Google Sheets via the
// Apps Script Web App (op=upsert_row).
//
// Required secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (runtime)
//   APPS_SCRIPT_URL   — Web App exec URL
//   APPS_SCRIPT_SECRET — shared secret configured in Code.gs

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (h: (r: Request) => Response | Promise<Response>) => void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APPS_SCRIPT_URL = Deno.env.get('APPS_SCRIPT_URL')!;
const APPS_SCRIPT_SECRET = Deno.env.get('APPS_SCRIPT_SECRET')!;

const OPERATIONAL_TABS = new Set([
  'TP Brand Injection',
  'TP Affiliate',
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited',
  'HazEmirates UAE',
  'Hanan',
  'Wizard of Odds',
]);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

interface RequestBody {
  tab: string;
  sheet_row_id: string;
  fields: Record<string, string | null>;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  let body: RequestBody;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON' }, 400); }

  if (!body.tab || typeof body.tab !== 'string') return json({ ok: false, error: 'tab required' }, 400);
  if (!OPERATIONAL_TABS.has(body.tab)) return json({ ok: false, error: 'unknown tab' }, 400);
  if (!body.sheet_row_id) return json({ ok: false, error: 'sheet_row_id required' }, 400);

  const cleanFields: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(body.fields ?? {})) {
    if (k === 'id' || k === 'last_sync_tag' || k === '') continue;
    cleanFields[k] = v === '' || v === undefined ? null : (v as string | null);
  }

  const syncTag = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { data: runRow, error: runErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'db_to_sheet', tab: body.tab, status: 'running', payload_ref: body.sheet_row_id })
    .select('id')
    .single();
  if (runErr) return json({ ok: false, error: runErr.message }, 500);
  const runId = runRow!.id as string;

  try {
    const { data: existing, error: selErr } = await admin
      .from('entries')
      .select('data')
      .eq('tab', body.tab)
      .eq('sheet_row_id', body.sheet_row_id)
      .maybeSingle();
    if (selErr) throw selErr;

    const mergedData: Record<string, string | null> = {
      ...(existing?.data as Record<string, string | null> | null ?? {}),
      ...cleanFields,
    };

    if (existing) {
      const { error: updErr } = await admin.from('entries')
        .update({ data: mergedData, updated_at: nowIso, last_sync_tag: syncTag })
        .eq('tab', body.tab)
        .eq('sheet_row_id', body.sheet_row_id);
      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await admin.from('entries').insert({
        tab: body.tab,
        sheet_row_id: body.sheet_row_id,
        data: mergedData,
        updated_at: nowIso,
        last_edited_by: 'push-to-sheet',
        last_edited_email: 'system',
        last_sync_tag: syncTag,
      });
      if (insErr) throw insErr;
    }

    // col_map intentionally left empty — Apps Script uses its own header-row lookup,
    // which is the only reliable source for column positions once the header-read
    // bug (getLastColumn vs getMaxColumns) is fixed in Code.gs.
    const colMap: Record<string, number> = {};
    const syncTagCol = 0;

    const payload = JSON.stringify({
      secret: APPS_SCRIPT_SECRET,
      op: 'upsert_row',
      tab: body.tab,
      sheet_row_id: body.sheet_row_id,
      fields: cleanFields,
      col_map: colMap,
      sync_tag: syncTag,
      sync_tag_col: syncTagCol,
    });
    const scriptBody = await callAppsScript(payload);
    if (!scriptBody.ok) throw new Error(`Apps Script error: ${scriptBody.error}`);

    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      rows_seen: 1,
      rows_upserted: 1,
      rows_skipped: 0,
      status: 'success',
    }).eq('id', runId);

    return json({ ok: true, sync_tag: syncTag });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('sync_runs').update({ finished_at: new Date().toISOString(), status: 'error', error_message: msg }).eq('id', runId);
    return json({ ok: false, error: msg }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

// Calls the Apps Script web app with retries. Uses `text/plain` content-type — a
// documented workaround for Apps Script POST handling that often resolves
// intermittent HTML-instead-of-JSON responses. Retries up to 2 times on HTML
// responses to handle transient Apps Script flakiness.
async function callAppsScript(payload: string): Promise<{ ok: boolean; error?: string; row?: number }> {
  const MAX_ATTEMPTS = 3;
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload,
    });
    const text = await res.text();
    const trimmed = text.trimStart();
    if (res.ok && !trimmed.startsWith('<')) {
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        lastError = `JSON parse failed (HTTP ${res.status}): ${text.slice(0, 200)}`;
      }
    } else {
      // Apps Script error pages bury the real cause in the <body>. Strip tags
      // and keep more text so the sync_runs error_message is actually useful.
      const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      lastError = `Apps Script returned non-JSON (HTTP ${res.status}, attempt ${attempt}/${MAX_ATTEMPTS}): ${stripped.slice(0, 1500)}`;
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw new Error(lastError);
}
