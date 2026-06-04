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

// Column names that check-review-status can update. When the DB row was last
// edited by that function, these columns are authoritative in the DB and must
// not be overwritten by a stale Sheet value (the Sheet sync may have failed).
const STATUS_SCORE_COLS = new Set([
  'TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status',
  'Trust pilot Review Status', 'Review Status',
  'Score added', 'Score Added', 'score added', 'Score',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

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
    const dumpRes = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: APPS_SCRIPT_SECRET, op: 'dump' }),
    });
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
        // deduplicate and delete orphans in one pass. Paginate to avoid the
        // default 1000-row cap which would leave orphans undetected.
        const allDbRows: Record<string, unknown>[] = [];
        const DB_PAGE = 1000;
        let dbFrom = 0;
        while (true) {
          const { data: page, error: pageErr } = await admin
            .from('entries')
            .select('id, sheet_row_id, last_edited_by, last_sync_tag, updated_at, data')
            .eq('tab', tabName)
            .order('updated_at', { ascending: false })
            .range(dbFrom, dbFrom + DB_PAGE - 1);
          if (pageErr) throw pageErr;
          allDbRows.push(...(page ?? []));
          if ((page ?? []).length < DB_PAGE) break;
          dbFrom += DB_PAGE;
        }

        // --- Step 1: remove duplicate rows (keep the most-recent per sheet_row_id) ---
        const seenSheetIds = new Set<string>();
        const duplicateDbIds: string[] = [];
        const dedupedMap = new Map<string, {
          last_edited_by: string;
          last_sync_tag: string | null;
          data: Record<string, string | null>;
        }>();
        for (const row of allDbRows ?? []) {
          const srid = row.sheet_row_id as string;
          if (seenSheetIds.has(srid)) {
            duplicateDbIds.push(row.id as string);
          } else {
            seenSheetIds.add(srid);
            dedupedMap.set(srid, {
              last_edited_by: row.last_edited_by as string,
              last_sync_tag: row.last_sync_tag as string | null,
              data: (row.data as Record<string, string | null> | null) ?? {},
            });
          }
        }
        if (duplicateDbIds.length > 0) {
          const CHUNK = 100;
          for (let i = 0; i < duplicateDbIds.length; i += CHUNK) {
            const chunk = duplicateDbIds.slice(i, i + CHUNK);
            const { error: delErr } = await admin.from('entries').delete().in('id', chunk);
            if (delErr) throw delErr;
          }
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
          const CHUNK = 100;
          for (let i = 0; i < orphanSheetRowIds.length; i += CHUNK) {
            const chunk = orphanSheetRowIds.slice(i, i + CHUNK);
            const { error: delErr } = await admin.from('entries').delete()
              .eq('tab', tabName)
              .in('sheet_row_id', chunk);
            if (delErr) throw delErr;
          }
        }

        // --- Step 3: update existing rows / insert genuinely new rows ---
        // Echo / no-op detection: if the Sheet's values exactly match the DB's
        // values, nothing to apply. This catches the loop where push-to-sheet's
        // own write comes back through onEdit → import-tabs. Any genuine
        // difference (manual Sheet edit) is applied — Sheet wins.
        //
        // Exception: rows last edited by check-review-status have authoritative
        // status/score values in the DB (the Sheet sync may have failed). Merge
        // those columns from the DB so import-tabs never reverts them.
        const toUpsert: Array<Record<string, unknown>> = [];
        for (const c of candidates) {
          const existing = dedupedMap.get(c.sheet_row_id);

          let mergedData = c.data;
          if (existing && existing.last_edited_by === 'check-review-status') {
            mergedData = { ...c.data };
            for (const col of STATUS_SCORE_COLS) {
              if (col in existing.data) {
                mergedData[col] = existing.data[col];
              }
            }
          }

          if (existing && dataEquals(existing.data, mergedData)) {
            rowsSkipped++;
            continue;
          }
          toUpsert.push({
            tab: c.tab,
            sheet_row_id: c.sheet_row_id,
            data: mergedData,
            last_edited_by: existing?.last_edited_by === 'check-review-status' ? 'check-review-status' : 'sheet',
            last_sync_tag: null,
          });
        }

        if (toUpsert.length > 0) {
          // Bulk upsert in chunks — dedup+orphan deletion above ensures
          // (tab, sheet_row_id) is unique so onConflict is safe.
          const CHUNK = 500;
          for (let i = 0; i < toUpsert.length; i += CHUNK) {
            const chunk = toUpsert.slice(i, i + CHUNK);
            const { error: upsErr } = await admin
              .from('entries')
              .upsert(chunk, { onConflict: 'tab,sheet_row_id' });
            if (upsErr) {
              // Attach account names so the error shows which rows failed.
              const samples = chunk.slice(0, 5).map((r) => {
                const d = r.data as Record<string, string | null>;
                return d['Account Name'] ?? d['Account'] ?? String(r.sheet_row_id);
              }).join(', ');
              throw new Error(`upsert failed (accounts: ${samples}): ${upsErr.message}`);
            }
          }
          rowsUpserted += toUpsert.length;
        }
      } catch (tabErr) {
        tabsFailed.push(`[${tabName}] ${tabErr instanceof Error ? tabErr.message : String(tabErr)}`);
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
    const fullMsg = `[All tabs affected] ${msg}`;
    await admin.from('sync_runs').update({ finished_at: new Date().toISOString(), status: 'error', error_message: fullMsg }).eq('id', runId);
    return json({ ok: false, error: fullMsg }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Returns true if two data objects represent the same row values. Empty string,
// null, and undefined are all treated as "no value", so we don't treat them as
// differences (matches how import-tabs and push-to-sheet normalize cells).
function dataEquals(
  a: Record<string, string | null>,
  b: Record<string, string | null>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    const an = av == null || av === '' ? null : av;
    const bn = bv == null || bv === '' ? null : bv;
    if (an !== bn) return false;
  }
  return true;
}
