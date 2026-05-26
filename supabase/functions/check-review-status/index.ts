import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseReviewStatus, type TpStatus } from './parser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APPS_SCRIPT_URL = Deno.env.get('APPS_SCRIPT_URL')!;
const APPS_SCRIPT_SECRET = Deno.env.get('APPS_SCRIPT_SECRET')!;
const DELAY_MS = 600;
const BATCH_SIZE = 3;
const BUDGET_MS = 120_000; // stop well before Supabase's 150s hard kill
const FETCH_TIMEOUT_MS = 8_000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Maps the value in entry.data['Proxy Used'] (case-insensitive) to a Supabase secret
// that holds the full proxy URL: http://user:pass@host:port
const PROXY_SECRET_MAP: Record<string, string> = {
  proxylite:   'PROXY_PROXYLITE',
  spyderproxy: 'PROXY_SPYDERPROXY',
  enigma:      'PROXY_ENIGMA',
};

function getProxyClient(proxyName: unknown): Deno.HttpClient | null {
  if (!proxyName || typeof proxyName !== 'string') return null;
  const secretKey = PROXY_SECRET_MAP[proxyName.trim().toLowerCase()];
  if (!secretKey) return null;
  const proxyUrl = Deno.env.get(secretKey);
  if (!proxyUrl) return null;
  try {
    return Deno.createHttpClient({ proxy: { url: proxyUrl } });
  } catch {
    return null;
  }
}

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

async function fetchTpStatus(url: string, proxyClient: Deno.HttpClient | null = null): Promise<TpStatus | null> {
  try {
    // deno-lint-ignore no-explicit-any
    const fetchOpts: any = {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
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
    };
    if (proxyClient) fetchOpts.client = proxyClient;

    const res = await fetch(url, fetchOpts);

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
  let query = (admin as any).from('entries').select('id, tab, sheet_row_id, data');
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

        const proxyClient = getProxyClient(entry.data['Proxy Used']);
        const newStatus = await fetchTpStatus(profileUrl, proxyClient);
        proxyClient?.close();

        if (newStatus === null) {
          errors++;
        } else if (newStatus !== currentStatus) {
          const updatedData = { ...entry.data, [statusCol]: newStatus };
          const { error: updateErr } = await admin
            .from('entries')
            .update({ data: updatedData, updated_at: new Date().toISOString(), last_edited_by: 'dashboard' })
            .eq('id', entry.id);

          if (updateErr) {
            errors++;
          } else {
            updated++;
            // Push status change back to Google Sheet
            if (entry.tab && entry.sheet_row_id && APPS_SCRIPT_URL && APPS_SCRIPT_SECRET) {
              try {
                const scriptRes = await fetch(APPS_SCRIPT_URL, {
                  method: 'POST',
                  redirect: 'follow',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    secret: APPS_SCRIPT_SECRET,
                    op: 'upsert_row',
                    tab: entry.tab,
                    sheet_row_id: entry.sheet_row_id,
                    fields: { [statusCol]: newStatus },
                    sync_tag: crypto.randomUUID(),
                  }),
                });
                if (!scriptRes.ok) {
                  console.log(`[check-status] Sheet push failed for ${entry.id}: HTTP ${scriptRes.status}`);
                }
              } catch (pushErr) {
                console.log(`[check-status] Sheet push error for ${entry.id}: ${pushErr}`);
              }
            }
          }
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
