// Supabase Edge Function: import-tabs
//
// Calls Apps Script doGet(op='dump') and bulk-upserts every operational tab's
// rows into public.entries. Refreshes public.tab_schemas with current headers.
// Skips rows where the Sheet is echoing back our own last_sync_tag (loop prevention).
//
// Required secrets:
//   SUPABASE_URL                — runtime
//   SUPABASE_SERVICE_ROLE_KEY   — runtime
//   APPS_SCRIPT_WEB_APP_URL     — /exec URL
//   APPS_SCRIPT_SHARED_SECRET   — matches Code.gs SHARED_SECRET

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (h: (r: Request) => Response | Promise<Response>) => void;
};

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

interface Candidate {
  tab: string;
  sheet_row_id: string;
  data: Record<string, string | null>;
  sheetSyncTag: string | null; // read from Sheet row; used for echo detection only
}

Deno.serve(async () => {
  const { data: runRow, error: startErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'sheet_to_db', status: 'running' })
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
        await admin.from('tab_schemas').upsert(
          { tab: tab.name, headers: tab.headers, refreshed_at: new Date().toISOString() },
          { onConflict: 'tab' },
        );

        const idColIndex = tab.headers.indexOf('id');
        if (idColIndex === -1) {
          tabsFailed.push(`${tab.name}: no 'id' column`);
          continue;
        }

        const syncTagColIndex = tab.headers.indexOf('last_sync_tag');

        // Build candidate list — extract sheet sync tag alongside the data blob.
        const candidates: Candidate[] = [];
        for (const row of tab.rows) {
          rowsSeen++;
          const sheetRowId = String(row[idColIndex] ?? '').trim();
          if (!sheetRowId) {
            rowsSkipped++;
            continue;
          }

          const sheetSyncTag =
            syncTagColIndex >= 0 && row[syncTagColIndex]
              ? String(row[syncTagColIndex]).trim() || null
              : null;

          const data: Record<string, string | null> = {};
          for (let i = 0; i < tab.headers.length; i++) {
            const h = tab.headers[i];
            if (h === 'id' || h === 'last_sync_tag' || h === '') continue;
            const val = row[i];
            data[h] = val == null || val === '' ? null : String(val);
          }
          candidates.push({ tab: tab.name, sheet_row_id: sheetRowId, data, sheetSyncTag });
        }

        if (candidates.length === 0) continue;

        // Batch-fetch existing rows for this tab to detect echoes.
        const sheetIds = candidates.map((c) => c.sheet_row_id);
        const { data: existingRows } = await admin
          .from('entries')
          .select('sheet_row_id, last_edited_by, last_sync_tag')
          .eq('tab', tab.name)
          .in('sheet_row_id', sheetIds);

        const existingMap = new Map<string, { last_edited_by: string; last_sync_tag: string | null }>();
        for (const row of existingRows ?? []) {
          existingMap.set(row.sheet_row_id as string, {
            last_edited_by: row.last_edited_by as string,
            last_sync_tag: row.last_sync_tag as string | null,
          });
        }

        // Filter echoes and build final upsert batch.
        const toUpsert: Array<Record<string, unknown>> = [];
        for (const c of candidates) {
          const existing = existingMap.get(c.sheet_row_id);
          // Echo: dashboard wrote this exact sync_tag and the Sheet is reflecting it back.
          if (
            existing?.last_edited_by === 'dashboard' &&
            existing.last_sync_tag !== null &&
            c.sheetSyncTag !== null &&
            existing.last_sync_tag === c.sheetSyncTag
          ) {
            rowsSkipped++;
            continue;
          }
          toUpsert.push({
            tab: c.tab,
            sheet_row_id: c.sheet_row_id,
            data: c.data,
            last_edited_by: 'sheet',
            last_sync_tag: null, // clear tag — Sheet is now authoritative for this row
          });
        }

        if (toUpsert.length > 0) {
          const { error: upErr } = await admin
            .from('entries')
            .upsert(toUpsert, { onConflict: 'tab,sheet_row_id' });
          if (upErr) throw upErr;
          rowsUpserted += toUpsert.length;
        }
      } catch (tabErr) {
        tabsFailed.push(`${tab.name}: ${tabErr instanceof Error ? tabErr.message : String(tabErr)}`);
      }
    }

    const finalStatus = tabsFailed.length === 0 ? 'success' : 'error';
    await admin
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        rows_seen: rowsSeen,
        rows_upserted: rowsUpserted,
        rows_skipped: rowsSkipped,
        status: finalStatus,
        error_message: tabsFailed.length > 0 ? tabsFailed.join('; ') : null,
      })
      .eq('id', runId);

    return json({
      ok: tabsFailed.length === 0,
      rows_seen: rowsSeen,
      rows_upserted: rowsUpserted,
      rows_skipped: rowsSkipped,
      tabs_failed: tabsFailed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from('sync_runs')
      .update({ finished_at: new Date().toISOString(), status: 'error', error_message: msg })
      .eq('id', runId);
    return json({ ok: false, error: msg }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
