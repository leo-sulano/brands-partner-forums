import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseReviewStatus, type TpStatus } from './parser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DELAY_MS = 600;
const BATCH_SIZE = 3;
const BUDGET_MS = 120_000; // stop well before Supabase's 150s hard kill
const FETCH_TIMEOUT_MS = 8_000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      },
      redirect: 'manual',
    });

    // 3xx redirect away from the review URL = review removed/gone
    if (res.status >= 301 && res.status <= 308) {
      console.log(`[check-status] REDIRECT ${res.status} for ${url}`);
      return 'Removed';
    }
    if (res.status === 404) {
      console.log(`[check-status] 404 for ${url}`);
      return 'Removed';
    }
    if (res.status !== 200) {
      console.log(`[check-status] HTTP ${res.status} for ${url}`);
      return null;
    }

    const html = await res.text();
    const parsed = parseReviewStatus(html);
    console.log(`[check-status] ${url} → ${parsed ?? 'null'} (html length: ${html.length})`);
    return parsed;
  } catch (err) {
    console.log(`[check-status] ERROR for ${url}: ${err}`);
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  let tab: string | undefined;
  try {
    const body = await req.json();
    tab = body?.tab;
  } catch {
    // no body or invalid JSON — run against all tabs (scheduled mode)
  }

  // Fetch entries that have a profile URL and are not in a final-refused state
  // deno-lint-ignore no-explicit-any
  let query = (admin as any).from('entries').select('id, data');
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
  let budgetExceeded = false;

  const startTime = Date.now();

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    if (Date.now() - startTime > BUDGET_MS) {
      budgetExceeded = true;
      break;
    }

    const batch = entries.slice(i, i + BATCH_SIZE);

    await Promise.all(
      // deno-lint-ignore no-explicit-any
      batch.map(async (entry: any) => {
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
            .update({ data: updatedData, updated_at: new Date().toISOString() })
            .eq('id', entry.id);

          if (updateErr) errors++;
          else updated++;
        }
      }),
    );

    // Rate-limit between batches (skip after the last batch)
    if (i + BATCH_SIZE < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  return json({ checked, updated, errors, budgetExceeded, total: entries.length });
});
