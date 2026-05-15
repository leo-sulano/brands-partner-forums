// Supabase Edge Function: push-to-sheet
//
// Receives a row update from the dashboard, applies it to public.review_entries,
// and relays the same change to the bound Apps Script Web App which writes the
// row back into the Google Sheet.
//
// Required secrets:
//   SUPABASE_URL                          — runtime
//   SUPABASE_SERVICE_ROLE_KEY             — runtime
//   APPS_SCRIPT_WEB_APP_URL               — the /exec URL from the deployment
//   APPS_SCRIPT_SHARED_SECRET             — must match SHARED_SECRET in Code.gs

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(name: string): string | undefined }; serve: (h: (r: Request) => Response | Promise<Response>) => void };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SCRIPT_URL = Deno.env.get('APPS_SCRIPT_WEB_APP_URL')!;
const SCRIPT_SECRET = Deno.env.get('APPS_SCRIPT_SHARED_SECRET')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Order MUST match ENTRY_FIELDS in apps-script/Code.gs.
const ENTRY_FIELDS = [
  'agent', 'account', 'country', 'proxy_used', 'email', 'password',
  'account_name', 'account_surname',
  'process', 'details', 'brand',
  'status_date', 'score_added', 'trustpilot_date', 'profile_url', 'review_status',
  'redirection_search_engine', 'redirection_word', 'review_language',
  'register_from_google', 'leaving_review_after_email', 'sticky_ip_mobile',
  'photo_in_account', 'device', 'opening_via_useful', 'opening_via_register',
  'scrolling_hovering', 'smart_paste', 'mentioning_time_frames',
  'mentioning_amounts', 'mentioning_agent_name', 'review_length', 'native_language',
];

const FIELD_SET = new Set(ENTRY_FIELDS);

interface RequestBody {
  sheet_row_id: string;           // required: existing or new UUID
  fields: Record<string, unknown>; // any subset of ENTRY_FIELDS
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400);
  }
  if (!body.sheet_row_id || typeof body.sheet_row_id !== 'string') {
    return json({ ok: false, error: 'sheet_row_id required' }, 400);
  }

  // Filter fields to known columns only — silently drop anything else.
  const cleanFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body.fields ?? {})) {
    if (FIELD_SET.has(k)) cleanFields[k] = v === '' ? null : v;
  }

  const syncTag = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { data: runRow, error: runErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'db_to_sheet', status: 'running', payload_ref: body.sheet_row_id })
    .select('id')
    .single();
  if (runErr) return json({ ok: false, error: runErr.message }, 500);
  const runId = runRow!.id as string;

  try {
    const { error: upsertErr } = await admin
      .from('review_entries')
      .upsert({
        sheet_row_id: body.sheet_row_id,
        ...cleanFields,
        updated_at: nowIso,
        last_edited_by: 'dashboard',
        last_sync_tag: syncTag,
      }, { onConflict: 'sheet_row_id' });
    if (upsertErr) throw upsertErr;

    const scriptRes = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: SCRIPT_SECRET,
        op: 'upsert_row',
        sheet_row_id: body.sheet_row_id,
        fields: cleanFields,
        sync_tag: syncTag,
      }),
    });
    if (!scriptRes.ok) {
      const text = await scriptRes.text();
      throw new Error(`Apps Script ${scriptRes.status}: ${text}`);
    }

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
    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      status: 'error',
      error_message: msg,
    }).eq('id', runId);
    return json({ ok: false, error: msg }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
