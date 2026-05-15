// Supabase Edge Function: import-tabs
//
// Calls Apps Script doGet(op='dump') and bulk-upserts every operational tab's
// rows into public.entries. Refreshes public.tab_schemas with current headers.
//
// Required secrets:
//   SUPABASE_URL                — runtime
//   SUPABASE_SERVICE_ROLE_KEY   — runtime
//   APPS_SCRIPT_WEB_APP_URL     — /exec URL
//   APPS_SCRIPT_SHARED_SECRET   — matches Code.gs SHARED_SECRET

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(name: string): string | undefined }; serve: (h: (r: Request) => Response | Promise<Response>) => void };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SCRIPT_URL = Deno.env.get('APPS_SCRIPT_WEB_APP_URL')!;
const SCRIPT_SECRET = Deno.env.get('APPS_SCRIPT_SHARED_SECRET')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

interface DumpedTab {
  name: string;
  headers: string[];
  rows: string[][];
}

Deno.serve(async () => {
  const { data: runRow, error: startErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'initial_import', status: 'running' })
    .select('id')
    .single();
  if (startErr) return json({ ok: false, error: startErr.message }, 500);
  const runId = runRow!.id as string;

  let rowsSeen = 0;
  let rowsUpserted = 0;
  let rowsSkipped = 0;
  const tabsFailed: string[] = [];

  try {
    const dumpUrl = `${SCRIPT_URL}?secret=${encodeURIComponent(SCRIPT_SECRET)}&op=dump`;
    const res = await fetch(dumpUrl);
    if (!res.ok) throw new Error(`doGet ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { ok: boolean; tabs?: DumpedTab[]; error?: string };
    if (!body.ok || !body.tabs) throw new Error(body.error ?? 'doGet returned not-ok');

    for (const tab of body.tabs) {
      try {
        await admin.from('tab_schemas').upsert({
          tab: tab.name,
          headers: tab.headers,
          refreshed_at: new Date().toISOString(),
        }, { onConflict: 'tab' });

        const idColIndex = tab.headers.indexOf('id');
        if (idColIndex === -1) {
          tabsFailed.push(`${tab.name}: no 'id' column`);
          continue;
        }

        const entries: Array<Record<string, unknown>> = [];
        for (const row of tab.rows) {
          rowsSeen++;
          const sheetRowId = String(row[idColIndex] ?? '').trim();
          if (!sheetRowId) {
            rowsSkipped++;
            continue;
          }
          const data: Record<string, string | null> = {};
          for (let i = 0; i < tab.headers.length; i++) {
            const h = tab.headers[i];
            if (h === 'id' || h === 'last_sync_tag' || h === '') continue;
            const val = row[i];
            data[h] = val == null || val === '' ? null : String(val);
          }
          entries.push({
            tab: tab.name,
            sheet_row_id: sheetRowId,
            data,
          });
        }

        if (entries.length > 0) {
          const { error: upErr } = await admin
            .from('entries')
            .upsert(entries, { onConflict: 'tab,sheet_row_id' });
          if (upErr) throw upErr;
          rowsUpserted += entries.length;
        }
      } catch (tabErr) {
        tabsFailed.push(`${tab.name}: ${tabErr instanceof Error ? tabErr.message : String(tabErr)}`);
      }
    }

    const finalStatus = tabsFailed.length === 0 ? 'success' : 'error';
    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      rows_seen: rowsSeen,
      rows_upserted: rowsUpserted,
      rows_skipped: rowsSkipped,
      status: finalStatus,
      error_message: tabsFailed.length > 0 ? tabsFailed.join('; ') : null,
    }).eq('id', runId);

    return json({
      ok: tabsFailed.length === 0,
      rows_seen: rowsSeen,
      rows_upserted: rowsUpserted,
      rows_skipped: rowsSkipped,
      tabs_failed: tabsFailed,
    });
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