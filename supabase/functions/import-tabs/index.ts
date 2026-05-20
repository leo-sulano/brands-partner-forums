// Supabase Edge Function: import-tabs
//
// Reads all operational tabs from the Apps Script Web App (op=dump) and
// bulk-upserts into public.entries. Skips echo rows (loop prevention via last_sync_tag).
//
// Required secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (runtime)
//   APPS_SCRIPT_URL  — Web App exec URL
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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

interface SheetTab {
  name: string;
  headers: string[];
  rows: string[][];
}

interface DumpResponse {
  ok: boolean;
  tabs?: SheetTab[];
  error?: string;
}

interface Candidate {
  tab: string;
  sheet_row_id: string;
  data: Record<string, string | null>;
  sheetSyncTag: string | null;
}

Deno.serve(async () => {
  const { data: runRow, error: startErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'sheet_to_db', status: 'running' })
    .select('id')
    .single();
  if (startErr) return json({ ok: false, error: startErr.message }, 500);
  const runId = runRow!.id as string;

  let rowsSeen = 0, rowsUpserted = 0, rowsSkipped = 0;
  const tabsFailed: string[] = [];

  try {
    const dumpRes = await fetch(
      `${APPS_SCRIPT_URL}?secret=${encodeURIComponent(APPS_SCRIPT_SECRET)}&op=dump`,
      { redirect: 'follow' },
    );
    if (!dumpRes.ok) throw new Error(`Apps Script ${dumpRes.status}: ${await dumpRes.text()}`);

    const dump = (await dumpRes.json()) as DumpResponse;
    if (!dump.ok) throw new Error(`Apps Script error: ${dump.error}`);

    for (const sheetTab of dump.tabs ?? []) {
      const { name: tabName, headers, rows: dataRows } = sheetTab;
      try {
        await admin.from('tab_schemas').upsert(
          { tab: tabName, headers, refreshed_at: new Date().toISOString() },
          { onConflict: 'tab' },
        );

        // Case-insensitive lookup so 'ID', 'Id', 'id' all work.
        const idColIndex = headers.findIndex((h) => h.toLowerCase() === 'id');
        if (idColIndex === -1) { tabsFailed.push(`${tabName}: no 'id' column`); continue; }
        const syncTagColIndex = headers.findIndex((h) => h === 'last_sync_tag');

        const candidates: Candidate[] = [];
        for (const row of dataRows) {
          rowsSeen++;
          const sheetRowId = String(row[idColIndex] ?? '').trim();
          if (!sheetRowId) { rowsSkipped++; continue; }
          const sheetSyncTag = syncTagColIndex >= 0 && row[syncTagColIndex]
            ? String(row[syncTagColIndex]).trim() || null : null;
          const data: Record<string, string | null> = {};
          for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            if (h.toLowerCase() === 'id' || h === 'last_sync_tag' || h === '') continue;
            const val = row[i];
            data[h] = val == null || val === '' ? null : String(val);
          }
          candidates.push({ tab: tabName, sheet_row_id: sheetRowId, data, sheetSyncTag });
        }

        if (candidates.length === 0) continue;

        // Fetch ALL current DB rows for this tab (not just candidates) so we can
        // deduplicate and delete orphans in one pass.
        const { data: allDbRows } = await admin
          .from('entries')
          .select('id, sheet_row_id, last_edited_by, last_sync_tag, updated_at')
          .eq('tab', tabName)
          .order('updated_at', { ascending: false });

        // --- Step 1: remove duplicate rows (keep the most-recent per sheet_row_id) ---
        const seenSheetIds = new Set<string>();
        const duplicateDbIds: string[] = [];
        const dedupedMap = new Map<string, { last_edited_by: string; last_sync_tag: string | null }>();
        for (const row of allDbRows ?? []) {
          const srid = row.sheet_row_id as string;
          if (seenSheetIds.has(srid)) {
            duplicateDbIds.push(row.id as string);
          } else {
            seenSheetIds.add(srid);
            dedupedMap.set(srid, {
              last_edited_by: row.last_edited_by as string,
              last_sync_tag: row.last_sync_tag as string | null,
            });
          }
        }
        if (duplicateDbIds.length > 0) {
          await admin.from('entries').delete().in('id', duplicateDbIds);
        }

        // --- Step 2: delete orphaned sheet-sourced rows (in DB but absent from sheet) ---
        // Dashboard-created rows (sheet_row_id starts with 'dashboard-') are kept.
        const candidateIdSet = new Set(candidates.map((c) => c.sheet_row_id));
        const orphanSheetRowIds: string[] = [];
        for (const srid of seenSheetIds) {
          if (!srid.startsWith('dashboard-') && !candidateIdSet.has(srid)) {
            orphanSheetRowIds.push(srid);
            dedupedMap.delete(srid);
          }
        }
        if (orphanSheetRowIds.length > 0) {
          await admin.from('entries').delete()
            .eq('tab', tabName)
            .in('sheet_row_id', orphanSheetRowIds);
        }

        // --- Step 3: update existing rows / insert genuinely new rows ---
        const toUpsert: Array<Record<string, unknown>> = [];
        for (const c of candidates) {
          const existing = dedupedMap.get(c.sheet_row_id);
          if (
            existing?.last_edited_by === 'dashboard' &&
            existing.last_sync_tag !== null &&
            c.sheetSyncTag !== null &&
            existing.last_sync_tag === c.sheetSyncTag
          ) { rowsSkipped++; continue; }
          toUpsert.push({
            tab: c.tab,
            sheet_row_id: c.sheet_row_id,
            data: c.data,
            last_edited_by: 'sheet',
            last_sync_tag: null,
          });
        }

        if (toUpsert.length > 0) {
          const existingSet = new Set(dedupedMap.keys());
          const toUpdate = toUpsert.filter((r) => existingSet.has(r.sheet_row_id as string));
          const toInsert = toUpsert.filter((r) => !existingSet.has(r.sheet_row_id as string));

          for (const row of toUpdate) {
            const { error: updErr } = await admin
              .from('entries')
              .update({
                data: row.data,
                updated_at: new Date().toISOString(),
                last_edited_by: row.last_edited_by,
                last_sync_tag: row.last_sync_tag,
              })
              .eq('tab', row.tab as string)
              .eq('sheet_row_id', row.sheet_row_id as string);
            if (updErr) throw updErr;
          }

          if (toInsert.length > 0) {
            const { error: insErr } = await admin.from('entries').insert(toInsert);
            if (insErr) throw insErr;
          }

          rowsUpserted += toUpsert.length;
        }
      } catch (tabErr) {
        tabsFailed.push(`${tabName}: ${tabErr instanceof Error ? tabErr.message : String(tabErr)}`);
      }
    }

    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      rows_seen: rowsSeen,
      rows_upserted: rowsUpserted,
      rows_skipped: rowsSkipped,
      status: tabsFailed.length === 0 ? 'success' : 'error',
      error_message: tabsFailed.length > 0 ? tabsFailed.join('; ') : null,
    }).eq('id', runId);

    return json({ ok: tabsFailed.length === 0, rows_seen: rowsSeen, rows_upserted: rowsUpserted, rows_skipped: rowsSkipped, tabs_failed: tabsFailed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('sync_runs').update({ finished_at: new Date().toISOString(), status: 'error', error_message: msg }).eq('id', runId);
    return json({ ok: false, error: msg }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
