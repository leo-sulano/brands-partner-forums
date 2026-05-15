// Supabase Edge Function: sync-sheet
//
// Pulls rows from a Google Sheet and upserts them into public.mentions.
// Writes a row to public.sync_runs capturing the outcome.
//
// Required secrets (set via `supabase secrets set ...`):
//   SUPABASE_URL                  — provided by the runtime
//   SUPABASE_SERVICE_ROLE_KEY     — provided by the runtime
//   GOOGLE_SHEET_ID               — the sheet to read
//   GOOGLE_SHEET_RANGE            — e.g. "Sheet1!A:Z"
//   GOOGLE_SERVICE_ACCOUNT_JSON   — full service-account JSON as a string
//
// Deploy: supabase functions deploy sync-sheet
// Schedule: configure via Supabase scheduled functions or pg_cron.

// @ts-expect-error: Deno-only import resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(name: string): string | undefined } };

type SheetRow = Record<string, string>;

interface MentionUpsert {
  source_row_id: string;
  forum: string;
  thread_title: string | null;
  mention_text: string;
  url: string;
  author: string | null;
  posted_at: string | null;
  keyword: string | null;
  sentiment: string | null;
  synced_at: string;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHEET_ID = Deno.env.get('GOOGLE_SHEET_ID')!;
const SHEET_RANGE = Deno.env.get('GOOGLE_SHEET_RANGE') ?? 'Sheet1!A:Z';
const SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (_req: Request) => {
  const run = await startRun();
  try {
    const rows = await readSheet();
    const mapped = rows.map(rowToMention).filter((m): m is MentionUpsert => m !== null);

    const skipped = rows.length - mapped.length;
    let upserted = 0;
    if (mapped.length > 0) {
      const { error, count } = await admin
        .from('mentions')
        .upsert(mapped, { onConflict: 'source_row_id', count: 'exact' });
      if (error) throw error;
      upserted = count ?? mapped.length;
    }

    await finishRun(run.id, {
      status: 'success',
      rows_seen: rows.length,
      rows_upserted: upserted,
      rows_skipped: skipped,
    });
    return json({ ok: true, rows_seen: rows.length, rows_upserted: upserted, rows_skipped: skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(run.id, { status: 'error', error_message: message });
    return json({ ok: false, error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Sheet → mention mapping
// ---------------------------------------------------------------------------
// Map Sheet header → mention column. Adjust to the actual Sheet schema.
const COLUMN_MAP: Record<string, keyof MentionUpsert | null> = {
  id: 'source_row_id',
  forum: 'forum',
  thread_title: 'thread_title',
  title: 'thread_title',
  mention: 'mention_text',
  text: 'mention_text',
  url: 'url',
  link: 'url',
  author: 'author',
  posted_at: 'posted_at',
  date: 'posted_at',
  keyword: 'keyword',
  sentiment: 'sentiment',
};

function rowToMention(row: SheetRow): MentionUpsert | null {
  const out: Partial<MentionUpsert> = { synced_at: new Date().toISOString() };
  for (const [rawKey, value] of Object.entries(row)) {
    const key = rawKey.trim().toLowerCase().replace(/\s+/g, '_');
    const target = COLUMN_MAP[key];
    if (!target) continue;
    (out as Record<string, unknown>)[target] = value?.trim() || null;
  }
  // Required fields — skip row if missing.
  if (!out.source_row_id || !out.forum || !out.mention_text || !out.url) return null;
  return {
    source_row_id: out.source_row_id,
    forum: out.forum,
    thread_title: out.thread_title ?? null,
    mention_text: out.mention_text,
    url: out.url,
    author: out.author ?? null,
    posted_at: out.posted_at ?? null,
    keyword: out.keyword ?? null,
    sentiment: out.sentiment ?? null,
    synced_at: out.synced_at!,
  };
}

// ---------------------------------------------------------------------------
// Google Sheets read (service account)
// ---------------------------------------------------------------------------
async function readSheet(): Promise<SheetRow[]> {
  const token = await getGoogleAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API error: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { values?: string[][] };
  const values = body.values ?? [];
  if (values.length < 2) return [];
  const [header, ...rest] = values;
  return rest.map((cols) => {
    const row: SheetRow = {};
    header.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

async function getGoogleAccessToken(): Promise<string> {
  const sa = JSON.parse(SA_JSON) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const header = { alg: 'RS256', typ: 'JWT' };
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${enc(header)}.${enc(claims)}`;

  const keyPem = sa.private_key.replace(/\\n/g, '\n');
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(keyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const jwt = `${signingInput}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token error: ${tokenRes.status} ${await tokenRes.text()}`);
  const tokenBody = (await tokenRes.json()) as { access_token: string };
  return tokenBody.access_token;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ---------------------------------------------------------------------------
// sync_runs helpers
// ---------------------------------------------------------------------------
async function startRun(): Promise<{ id: string }> {
  const { data, error } = await admin
    .from('sync_runs')
    .insert({ status: 'running' })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

interface FinishPatch {
  status: 'success' | 'error';
  rows_seen?: number;
  rows_upserted?: number;
  rows_skipped?: number;
  error_message?: string;
}

async function finishRun(id: string, patch: FinishPatch): Promise<void> {
  await admin
    .from('sync_runs')
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', id);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
