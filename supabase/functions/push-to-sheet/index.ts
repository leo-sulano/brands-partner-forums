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
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited',
]);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

interface RequestBody {
  tab: string;
  sheet_row_id: string;
  fields: Record<string, string | null>;
}

Deno.serve(async (req: Request) => {
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

    const { error: upsertErr } = await admin.from('entries').upsert({
      tab: body.tab,
      sheet_row_id: body.sheet_row_id,
      data: mergedData,
      updated_at: nowIso,
      last_edited_by: 'dashboard',
      last_sync_tag: syncTag,
    }, { onConflict: 'tab,sheet_row_id' });
    if (upsertErr) throw upsertErr;

    const scriptRes = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: APPS_SCRIPT_SECRET,
        op: 'upsert_row',
        tab: body.tab,
        sheet_row_id: body.sheet_row_id,
        fields: cleanFields,
        sync_tag: syncTag,
      }),
    });
    if (!scriptRes.ok) throw new Error(`Apps Script ${scriptRes.status}: ${await scriptRes.text()}`);

    const scriptBody = (await scriptRes.json()) as { ok: boolean; error?: string };
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
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
