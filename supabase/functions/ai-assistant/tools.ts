// supabase/functions/ai-assistant/tools.ts
// Read-only tools the assistant can call. Pure helpers (field picking, score
// parsing, row mapping, filtering, score summary) are ported from
// src/lib/queries.ts and src/lib/scoreSummary.ts so the assistant sees the same
// data the dashboard does. runTool() is the only impure part — it needs a
// Supabase client.
// deno-lint-ignore-file no-explicit-any

// --- field picking (ported from src/lib/queries.ts + scoreSummary.ts) ---
export function pick(data: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = data?.[k];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return null;
}

const BRAND_KEYS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE'];
const ACCOUNT_KEYS = ['Account Name', 'account_name', 'casino', 'Casino', 'name', 'Name'];
const STATUS_KEYS = [
  'TP Status',
  'AG Status',
  'CG Status',
  'TP Review Status',
  'Trust Pilot Review Status',
  'Trustpilot Review Status',
  'Trust pilot Review Status',
  'Review Status',
  'status',
  'Status',
];
const SCORE_KEYS = ['TP Score added', 'Score added', 'Score Added', 'Score'];
const DATE_KEYS = [
  'TP Added', 'AG Added', 'CG Added',
  'Date Added', 'Date added', 'date_added',
  'Trust Pilot', 'Score added', 'posted_at', 'Posted At', 'date', 'Date',
];

export type Star = 1 | 2 | 3 | 4 | 5;

export function parseScore(raw: string | null | undefined): Star | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^[1-5]$/.test(s)) return null;
  return Number(s) as Star;
}

export interface EntryRow {
  id: string;
  tab: string;
  data: Record<string, any>;
}

export function mapEntrySummary(e: EntryRow) {
  return {
    id: e.id,
    tab: e.tab,
    brand: pick(e.data, BRAND_KEYS),
    account: pick(e.data, ACCOUNT_KEYS),
    status: pick(e.data, STATUS_KEYS),
    score: pick(e.data, SCORE_KEYS),
    date: pick(e.data, DATE_KEYS),
  };
}

// Free-text match across all stringified values in `data`.
export function entryMatches(e: EntryRow, contains: string): boolean {
  const needle = contains.trim().toLowerCase();
  if (!needle) return true;
  for (const v of Object.values(e.data ?? {})) {
    if (v != null && String(v).toLowerCase().includes(needle)) return true;
  }
  return false;
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Matches entries whose date field falls in the requested month.
// `month` accepts: "may", "may 2026", "2026-05".
export function matchesMonth(e: EntryRow, month: string): boolean {
  const raw = pick(e.data, DATE_KEYS);
  if (!raw) return false;
  const m = month.trim().toLowerCase();

  // Parse requested year (optional)
  const yearMatch = m.match(/\b(20\d{2})\b/);
  const wantYear = yearMatch ? parseInt(yearMatch[1]) : null;

  // Parse requested month number
  let wantMonth: number | null = null;
  if (/^\d{4}-(\d{2})$/.test(m)) {
    wantMonth = parseInt(m.split('-')[1]);
  } else {
    for (const [name, num] of Object.entries(MONTH_NAMES)) {
      if (m.includes(name)) { wantMonth = num; break; }
    }
  }
  if (!wantMonth) return false;

  const padded = String(wantMonth).padStart(2, '0');

  // DD/MM/YYYY format (e.g. "11/05/2026") — check /MM/ substring first
  // JS Date() parses this as MM/DD so we must NOT use new Date() for slash formats
  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    const [, , mm, yyyy] = slashMatch;
    return mm === padded && (!wantYear || yyyy === String(wantYear));
  }

  // ISO format "YYYY-MM-DD"
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, yyyy, mm] = isoMatch;
    return mm === padded && (!wantYear || yyyy === String(wantYear));
  }

  // Try JS Date parse for text formats ("May 11, 2026" etc.)
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return (d.getMonth() + 1 === wantMonth) && (!wantYear || d.getFullYear() === wantYear);
  }

  // Last resort: substring check
  return raw.includes(`/${padded}/`) && (!wantYear || raw.includes(String(wantYear)));
}

export function matchesStatus(e: EntryRow, status: string): boolean {
  const want = status.trim().toLowerCase();
  const have = (pick(e.data, STATUS_KEYS) ?? '').trim().toLowerCase();
  return have === want;
}

// Published-only star rollup, grouped by `${tab} ${brand}`. Mirrors computeScoreSummary.
export function scoreSummary(entries: EntryRow[]) {
  const buckets = new Map<
    string,
    { tab: string; brand: string; counts: Record<Star, number>; unrated: number }
  >();
  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;
    const status = (pick(e.data, STATUS_KEYS) ?? '').trim().toLowerCase();
    if (status !== 'published') continue;
    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      b = { tab: e.tab, brand, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, unrated: 0 };
      buckets.set(key, b);
    }
    const sc = parseScore(pick(e.data, SCORE_KEYS));
    if (sc == null) b.unrated += 1;
    else b.counts[sc] += 1;
  }
  return [...buckets.values()].map((b) => {
    const rated = b.counts[1] + b.counts[2] + b.counts[3] + b.counts[4] + b.counts[5];
    const total = rated + b.unrated;
    const average =
      rated === 0
        ? null
        : Math.round(
            ((b.counts[1] + 2 * b.counts[2] + 3 * b.counts[3] + 4 * b.counts[4] + 5 * b.counts[5]) /
              rated) *
              10,
          ) / 10;
    return { tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated, rated, total, average };
  });
}

// --- OpenAI tool schemas ---
export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: 'List the distinct brand-group tabs available.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_entries',
      description:
        'Search forum entries. ' +
        'Filter by tab (exact tab name from list_tabs), ' +
        'status — valid values are exactly: "Published" (= live/approved/active), "Removed", "Refused", "Not Done", "On Pause" — ' +
        'month (e.g. "may 2026" or "2026-05"), and/or a free-text contains match. ' +
        'Returns summary rows and total count. ' +
        'IMPORTANT: when user says "approved", "live", or "active" use status="Published". ' +
        'IMPORTANT: always pass month as "may 2026" style when user mentions a month.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          status: { type: 'string' },
          month: { type: 'string', description: 'filter by month, e.g. "may 2026" or "2026-05"' },
          contains: { type: 'string' },
          limit: { type: 'number', description: 'max rows to return, default 25' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_entry',
      description: 'Fetch one entry by id with its full data, for summarizing or drafting a reply.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_score_summary',
      description: 'Published-only star-rating rollup per brand, optionally filtered to one tab.',
      parameters: { type: 'object', properties: { tab: { type: 'string' } } },
    },
  },
];

// --- tool dispatch (impure: needs a supabase client) ---
export async function runTool(supabase: any, name: string, args: any): Promise<unknown> {
  if (name === 'list_tabs') {
    const { data, error } = await supabase.from('entries').select('tab');
    if (error) throw error;
    return { tabs: [...new Set((data ?? []).map((r: any) => r.tab))].sort() };
  }
  if (name === 'query_entries') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    let rows: EntryRow[] = data ?? [];
    if (args?.status) rows = rows.filter((e) => matchesStatus(e, args.status));
    if (args?.month) rows = rows.filter((e) => matchesMonth(e, args.month));
    if (args?.contains) rows = rows.filter((e) => entryMatches(e, args.contains));
    const total = rows.length;
    const limit = Math.min(Number(args?.limit) || 25, 50);
    return { total, rows: rows.slice(0, limit).map(mapEntrySummary) };
  }
  if (name === 'get_entry') {
    const { data, error } = await supabase
      .from('entries')
      .select('id, tab, data')
      .eq('id', args?.id)
      .maybeSingle();
    if (error) throw error;
    return data ?? { error: 'not found' };
  }
  if (name === 'get_score_summary') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { brands: scoreSummary(data ?? []) };
  }
  return { error: `unknown tool: ${name}` };
}
