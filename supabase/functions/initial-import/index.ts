// Supabase Edge Function: initial-import
//
// One-shot: fetches the published CSV of the source Google Sheet and bulk-upserts
// rows into public.review_entries. Run this once during cutover, after the
// Apps Script backfillIds() has populated column A with UUIDs.
//
// Required secrets:
//   SUPABASE_URL                — runtime
//   SUPABASE_SERVICE_ROLE_KEY   — runtime
//   SHEET_CSV_URL               — published CSV URL

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(name: string): string | undefined }; serve: (h: (r: Request) => Response | Promise<Response>) => void };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CSV_URL = Deno.env.get('SHEET_CSV_URL')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Sheet header → DB column. Exact match (case-sensitive after trim).
const HEADER_TO_COLUMN: Record<string, string> = {
  'id': 'sheet_row_id',
  'Agent': 'agent',
  'Account': 'account',
  'Country': 'country',
  'Proxy Used': 'proxy_used',
  'Email': 'email',
  'Password': 'password',
  'Account Name': 'account_name',
  'Account Surname': 'account_surname',
  'Process': 'process',
  'Details': 'details',
  'Brand / TP URL PAGE': 'brand',
  'Removed / Not Published / stil published date': 'status_date',
  'Score added': 'score_added',
  'Trust Pilot': 'trustpilot_date',
  'Link to the profile': 'profile_url',
  'Review Status': 'review_status',
  'Redirection from Search Engine (which one?)': 'redirection_search_engine',
  'Redirection Word used (Casino, Trustpilot)': 'redirection_word',
  'Reveiw Language': 'review_language',
  'Register from Google acount': 'register_from_google',
  'Leaving Review After redirected from  welcome Email': 'leaving_review_after_email',
  'Sticky IP (Mobile) (Y/N)': 'sticky_ip_mobile',
  'Photo in Account?': 'photo_in_account',
  'Mobile or deskstop ?': 'device',
  'Opening the account via "usefull"': 'opening_via_useful',
  'Opening the account via "Register" when leaving review': 'opening_via_register',
  'Scrolling and houvering?': 'scrolling_hovering',
  'Smart Paste?/ Paste as human typing?': 'smart_paste',
  'Mentioning time frames': 'mentioning_time_frames',
  'Mentioning Amounts?': 'mentioning_amounts',
  'Mentioning Agent name?': 'mentioning_agent_name',
  'Short review  / Long': 'review_length',
  '`Native Language?': 'native_language',
};

const DATE_COLUMNS = new Set(['status_date', 'trustpilot_date']);
const INT_COLUMNS = new Set(['score_added']);

Deno.serve(async () => {
  const { data: runRow, error: startErr } = await admin
    .from('sync_runs')
    .insert({ direction: 'initial_import', status: 'running' })
    .select('id')
    .single();
  if (startErr) {
    return json({ ok: false, error: startErr.message }, 500);
  }
  const runId = runRow!.id as string;

  try {
    const csv = await fetchCsv(CSV_URL);
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new Error('CSV had no data rows');

    const header = rows[0];
    const mapped: Array<Record<string, unknown>> = [];
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = sheetRowToEntry(header, rows[i]);
      if (!row || !row.sheet_row_id) {
        skipped++;
        continue;
      }
      mapped.push(row);
    }

    if (mapped.length === 0) throw new Error('No rows mapped — check column A is populated by backfillIds()');

    const { error: upsertErr } = await admin
      .from('review_entries')
      .upsert(mapped, { onConflict: 'sheet_row_id' });
    if (upsertErr) throw upsertErr;

    await admin.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      rows_seen: rows.length - 1,
      rows_upserted: mapped.length,
      rows_skipped: skipped,
      status: 'success',
    }).eq('id', runId);

    return json({ ok: true, rows_seen: rows.length - 1, rows_upserted: mapped.length, rows_skipped: skipped });
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

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  return res.text();
}

// Minimal CSV parser — handles quoted fields with commas and escaped quotes.
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function sheetRowToEntry(header: string[], cols: string[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < header.length; i++) {
    const key = header[i].trim();
    const dbCol = HEADER_TO_COLUMN[key];
    if (!dbCol) continue;
    const raw = (cols[i] ?? '').trim();
    if (raw === '') {
      out[dbCol] = null;
    } else if (DATE_COLUMNS.has(dbCol)) {
      out[dbCol] = parseSheetDate(raw);
    } else if (INT_COLUMNS.has(dbCol)) {
      const n = parseInt(raw, 10);
      out[dbCol] = Number.isFinite(n) ? n : null;
    } else {
      out[dbCol] = raw;
    }
  }
  return out;
}

// Sheet dates are formatted DD/MM/YYYY. Convert to ISO 'YYYY-MM-DD' or null.
function parseSheetDate(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
