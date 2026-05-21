import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseReviewStatus, type TpStatus } from './parser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DELAY_MS = 600;

const TP_STATUS_COLS = [
  'TP Review Status',
  'Trust Pilot Review Status',
  'Trustpilot Review Status',
  'Trust pilot Review Status',
  'Review Status',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function findStatusCol(data: Record<string, unknown>): string | null {
  return TP_STATUS_COLS.find((col) => col in data) ?? null;
}

async function fetchTpStatus(url: string): Promise<TpStatus | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'manual',
    });

    // 3xx redirect away from the review URL = review removed/gone
    if (res.status >= 301 && res.status <= 308) return 'Removed';
    if (res.status === 404) return 'Removed';
    if (res.status !== 200) return null; // unexpected — skip

    const html = await res.text();
    return parseReviewStatus(html);
  } catch {
    return null; // network error — skip, don't corrupt DB
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  let tab: string | undefined;
  try {
    const body = await req.json();
    tab = body?.tab;
  } catch {
    // no body or invalid JSON — run against all tabs (scheduled mode)
  }

  // Fetch entries that have a profile URL and are not in a final-refused state
  // deno-lint-ignore no-explicit-any
  let query = (admin as any).from('entries').select('id, tab, data');
  if (tab) query = query.eq('tab', tab);

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) return json({ error: fetchErr.message }, 500);

  // deno-lint-ignore no-explicit-any
  const entries: any[] = (rows ?? []).filter((e: any) => {
    const profileUrl = e.data?.['Link to the profile'];
    const statusCol = findStatusCol(e.data ?? {});
    if (!profileUrl || profileUrl.trim() === '') return false;
    if (!statusCol) return false; // no recognisable TP status column
    return e.data[statusCol] !== 'Refused';
  });

  let checked = 0;
  let updated = 0;
  let errors = 0;

  for (const entry of entries) {
    checked++;

    const rawUrl: string = entry.data['Link to the profile'].trim();
    const profileUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const statusCol = findStatusCol(entry.data)!;
    const currentStatus: string = entry.data[statusCol] ?? '';

    const newStatus = await fetchTpStatus(profileUrl);

    if (newStatus === null) {
      errors++;
    } else if (newStatus !== currentStatus) {
      const updatedData = { ...entry.data, [statusCol]: newStatus };
      const { error: updateErr } = await admin
        .from('entries')
        .update({ data: updatedData })
        .eq('id', entry.id);

      if (updateErr) errors++;
      else updated++;
    }

    // Rate-limit: wait between requests (skip after the last one)
    if (checked < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  return json({ checked, updated, errors });
});
