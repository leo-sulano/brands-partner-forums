// supabase/functions/ai-assistant/tools.ts
// Read-only tools the assistant can call. Pure helpers (field picking, score
// parsing, row mapping, filtering, score summary) are ported from
// src/lib/queries.ts and src/lib/scoreSummary.ts so the assistant sees the same
// data the dashboard does. runTool() is the only impure part — it needs a
// Supabase client.
// deno-lint-ignore-file no-explicit-any

// --- field picking (ported from src/lib/queries.ts + scoreSummary.ts) ---
// KNOWN DIVERGENCE (documented, not fixed — see CLAUDE.md Known Issues): this ported
// pick() trims a value before checking whether it's blank, but the real frontend's
// pick() (src/lib/scoreSummary.ts) checks `v !== ''` with no trim. A whitespace-only
// value (e.g. ' ') in a higher-precedence key is therefore dropped by the frontend
// (excluded from that row entirely) but falls through to the next key here, sometimes
// finding a real value the frontend never sees. Only reachable on TP, the only platform
// with a multi-key precedence list. Not changed here to avoid altering ported behavior
// out of scope for this fix wave.
export function pick(data: Record<string, any>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = data?.[k];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return null;
}

export const SENSITIVE_KEYS = new Set([
  'Password',
  'AG Password',
  'CG Password',
  'Casino Password',
  'Backup Codes',
  'Authenticator Backup',
]);

const SENSITIVE_KEYS_NORM = new Set([...SENSITIVE_KEYS].map((k) => k.trim().toLowerCase()));

export function redactSensitive(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (!SENSITIVE_KEYS_NORM.has(k.trim().toLowerCase())) out[k] = v;
  }
  return out;
}

export function isSensitiveField(field: string): boolean {
  return SENSITIVE_KEYS_NORM.has(field.trim().toLowerCase());
}

export function collectFieldNames(rows: EntryRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.data ?? {})) {
      if (!SENSITIVE_KEYS_NORM.has(k.trim().toLowerCase())) set.add(k);
    }
  }
  return [...set].sort();
}

export function matchesFieldFilters(e: EntryRow, filters: Record<string, string>): boolean {
  for (const [field, value] of Object.entries(filters)) {
    const have = String(e.data?.[field] ?? '').trim().toLowerCase();
    if (have !== value.trim().toLowerCase()) return false;
  }
  return true;
}

export interface FieldGroupCount {
  value: string;
  count: number;
}

export function groupByField(entries: EntryRow[], field: string): FieldGroupCount[] {
  const buckets = new Map<string, number>();
  for (const e of entries) {
    const value = String(e.data?.[field] ?? '').trim();
    if (!value) continue;
    buckets.set(value, (buckets.get(value) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
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

export type Platform = 'tp' | 'ag' | 'cg' | 'wo';

export const PLATFORM_STATUS_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status'],
  ag: ['AG Review Status'],
  cg: ['CG Review Status'],
  wo: ['WoO Review Status'],
};

const PLATFORM_SCORE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: ['AG Score added'],
  cg: ['CG Score added'],
  wo: ['Wizard of OddsScore added'],
};

const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5, wo: 5 };

export type Star = number;

export function parseScore(raw: string | null | undefined, maxScore: number = 5): Star | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored < 1 || floored > maxScore) return null;
  return floored;
}

export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';

export function ratingLabel(avg: number | null, maxScore: number = 5): RatingLabel | null {
  if (avg == null) return null;
  const k = maxScore / 5;
  if (avg >= 4.5 * k) return 'Excellent';
  if (avg >= 4.0 * k) return 'Great';
  if (avg >= 3.0 * k) return 'Average';
  if (avg >= 2.0 * k) return 'Poor';
  if (avg >= 1.0) return 'Bad';
  return null;
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

// Ported from src/lib/scoreSummary.ts — keep in sync manually if either changes,
// same convention as this file's existing ported pick()/BRAND_KEYS/etc.
export function isLiveStatus(s: string): boolean {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}

export function isRemovedStatus(s: string): boolean {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}

// Ported from src/lib/removedPlatformBrands.ts — keep in sync manually if either
// changes, same convention as this file's other ported helpers.
export function normalizeBrandKey(brand: string): string {
  return brand.trim().toLowerCase();
}

export function platformRemovedKey(tab: string, brand: string, platform: Platform): string {
  return `${tab}::${normalizeBrandKey(brand)}::${platform}`;
}

export function buildRemovedPlatformBrandSet(
  rows: { tab: string; brand: string; platform: Platform }[],
): Set<string> {
  return new Set(rows.map((r) => platformRemovedKey(r.tab, r.brand, r.platform)));
}

async function fetchRemovedPlatformBrandSet(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase.from('removed_platform_brands').select('tab, brand, platform');
  if (error) throw error;
  return buildRemovedPlatformBrandSet(data ?? []);
}

const FIELD_KEYS: Record<'proxy' | 'agent' | 'country', string[]> = {
  proxy: ['Proxy Used'],
  agent: ['Agent'],
  country: ['Country'],
};

export interface FieldSuccessRate {
  value: string;
  live: number;
  removed: number;
  total: number;
  rate: number | null;
}

export function successRateByField(
  entries: EntryRow[],
  field: 'proxy' | 'agent' | 'country',
  platform: Platform = 'tp',
  removedPlatformBrands: Set<string> = new Set(),
): FieldSuccessRate[] {
  const fieldKeys = FIELD_KEYS[field];
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const buckets = new Map<string, { live: number; removed: number }>();
  for (const e of entries) {
    const value = (pick(e.data, fieldKeys) ?? '').trim();
    if (!value) continue;
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (brand && removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
    const status = (pick(e.data, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;
    let b = buckets.get(value);
    if (!b) {
      b = { live: 0, removed: 0 };
      buckets.set(value, b);
    }
    if (isLiveStatus(status)) b.live += 1;
    else if (isRemovedStatus(status)) b.removed += 1;
  }
  return [...buckets.entries()]
    .map(([value, { live, removed }]) => {
      const total = live + removed;
      return { value, live, removed, total, rate: total === 0 ? null : (live / total) * 100 };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}

export interface BrandScoreSummary {
  tab: string;
  brand: string;
  counts: Record<number, number>;
  unrated: number;
  publishedTotal: number;
  rated: number;
  average: number | null;
  label: RatingLabel | null;
  live: number;
  removed: number;
  successRate: number | null;
}

// Star rollup (Published-only) AND live/removed Success Rate, grouped by
// `${tab} ${brand}`, computed in one pass per platform. Mirrors
// computeScoreSummary + computeSuccessRates in src/lib/scoreSummary.ts, merged
// into a single result since the assistant only ever needs the combined view.
export function scoreSummary(
  entries: EntryRow[],
  platform: Platform = 'tp',
  removedPlatformBrands: Set<string> = new Set(),
): BrandScoreSummary[] {
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const scoreKeys = PLATFORM_SCORE_KEYS[platform];
  const maxScore = PLATFORM_MAX_SCORE[platform];

  interface Bucket {
    tab: string;
    brand: string;
    counts: Record<number, number>;
    unrated: number;
    live: number;
    removed: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;
    if (removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
    const status = (pick(e.data, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;

    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      const counts: Record<number, number> = {};
      for (let i = 1; i <= maxScore; i++) counts[i] = 0;
      b = { tab: e.tab, brand, counts, unrated: 0, live: 0, removed: 0 };
      buckets.set(key, b);
    }

    if (isLiveStatus(status)) b.live += 1;
    else if (isRemovedStatus(status)) b.removed += 1;

    if (status !== 'published') continue;
    const score = parseScore(pick(e.data, scoreKeys), maxScore);
    if (score == null) b.unrated += 1;
    else b.counts[score] += 1;
  }

  return [...buckets.values()].map((b) => {
    let rated = 0;
    let weighted = 0;
    for (let i = 1; i <= maxScore; i++) {
      rated += b.counts[i];
      weighted += i * b.counts[i];
    }
    const publishedTotal = rated + b.unrated;
    const average = rated === 0 ? null : Math.round((weighted / rated) * 10) / 10;
    const label = ratingLabel(average, maxScore);
    const successTotal = b.live + b.removed;
    const successRate = successTotal === 0 ? null : (b.live / successTotal) * 100;
    return {
      tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated,
      publishedTotal, rated, average, label, live: b.live, removed: b.removed, successRate,
    };
  });
}

// --- OpenAI tool schemas ---
export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'list_fields',
      description:
        'Lists the real data field names tracked for a tab (or across all tabs if ' +
        'tab is omitted) — call this before filtering or grouping by a field whose ' +
        'exact name/casing you are unsure of (e.g. "Email Provider" vs "Email"). ' +
        'Credential fields are never listed.',
      parameters: { type: 'object', properties: { tab: { type: 'string' } } },
    },
  },
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
        'Returns matching rows (each with its full set of non-credential fields under `data` — ' +
        'not just brand/status/score/date, e.g. also Proxy Used, Agent, Country, and any other ' +
        'tracked field for that tab) and total count. ' +
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
      description:
        'Star-rating rollup (Published reviews only) AND live/removed Success Rate ' +
        'per brand, matching the dashboard\'s Score Summary page, for one platform: ' +
        'tp (TrustPilot, default), ag (AskGamblers), cg (CasinoGuru), or wo (Wizard ' +
        'of Odds). All-time only — no date-range filtering yet. Brands whose page on ' +
        'the queried platform was flagged removed (see get_removed_platform_flags) ' +
        'are excluded from these results entirely.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          platform: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_removed_platform_flags',
      description:
        'Lists brands whose review page on a specific platform (TrustPilot, ' +
        'AskGamblers, CasinoGuru, or Wizard of Odds) was taken down entirely, ' +
        'independent of any single review\'s status. This is the direct answer to ' +
        '"is Brand X\'s TP/AG/CG/WO page removed?". Optionally filtered to one tab. ' +
        'An empty list (or a brand not present in the results) means that brand is ' +
        'NOT removed on that platform — absence is a real answer, not missing data.',
      parameters: {
        type: 'object',
        properties: { tab: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_success_rate_by_field',
      description:
        'Computes the same live/removed "Success Rate" shown elsewhere in the dashboard ' +
        '(Published+Live vs Removed+Refused, as a percentage), grouped by one field: proxy, ' +
        'agent, or country, for one platform: tp (TrustPilot, default), ag (AskGamblers), ' +
        'cg (CasinoGuru), or wo (Wizard of Odds). Results are sorted best-rate-first, so the ' +
        'top row answers "which X works best". Rows whose status is pending, paused, or ' +
        'otherwise undecided are not counted (contribute to neither live nor removed) — total ' +
        'may be lower than raw row count for that value. Brands whose page on the queried ' +
        'platform was flagged removed (see get_removed_platform_flags) are excluded from ' +
        'these results entirely.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['proxy', 'agent', 'country'] },
          platform: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] },
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
        },
        required: ['field'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_schedule',
      description:
        'Returns the weekly per-platform posting calendar (active/paused per weekday) ' +
        'for a tab and week. week_start MUST be the Monday of the requested week, in ' +
        'YYYY-MM-DD format — compute it from the current-date system message; passing ' +
        'a non-Monday date will simply match no rows, since stored weeks are always ' +
        'keyed by their Monday. An empty result means nothing has been scheduled for ' +
        'that week yet (the schedule is generated lazily when someone opens that week ' +
        'in the app) — this is not an error. A null platform on a row means a legacy, ' +
        'pre-platform-tracking week. Rows represent the plan, not confirmed history — ' +
        'for a week that has already passed, a row does not by itself confirm a post ' +
        'actually happened; cross-check with query_entries or get_score_summary for ' +
        'real evidence before asserting a past post occurred.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          week_start: { type: 'string', description: 'Monday of the requested week, YYYY-MM-DD' },
        },
        required: ['tab', 'week_start'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_paused_combos',
      description:
        'Lists brand+platform combos currently auto-paused (2 consecutive Removed/' +
        'Refused posts, or an all-time success rate below the pause threshold), with ' +
        'the reason and the week the pause started. Not week-scoped — a pause is a ' +
        'standing state, not tied to one week\'s calendar. Optionally filtered to one tab. ' +
        'A pause row is only cleaned up when someone opens that tab in the app, so a ' +
        'paused_week_start from a week before the current one may be an expired pause no ' +
        'longer actually in effect — compare it against the current-date system message ' +
        'before asserting a combo is still paused.',
      parameters: {
        type: 'object',
        properties: { tab: { type: 'string' } },
      },
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
  if (name === 'list_fields') {
    let q = supabase.from('entries').select('tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { fields: collectFieldNames(data ?? []) };
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
    return {
      total,
      rows: rows.slice(0, limit).map((e) => ({ id: e.id, tab: e.tab, data: redactSensitive(e.data) })),
    };
  }
  if (name === 'get_entry') {
    const { data, error } = await supabase
      .from('entries')
      .select('id, tab, data')
      .eq('id', args?.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: 'not found' };
    return { id: data.id, tab: data.tab, data: redactSensitive(data.data) };
  }
  if (name === 'get_score_summary') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, removedSet] = await Promise.all([q, fetchRemovedPlatformBrandSet(supabase)]);
    if (error) throw error;
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    const platform: Platform = validPlatforms.includes(args?.platform) ? args.platform : 'tp';
    return { brands: scoreSummary(data ?? [], platform, removedSet) };
  }
  if (name === 'get_removed_platform_flags') {
    let q = supabase.from('removed_platform_brands').select('tab, brand, platform');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { flags: data ?? [] };
  }
  if (name === 'get_success_rate_by_field') {
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, removedSet] = await Promise.all([q, fetchRemovedPlatformBrandSet(supabase)]);
    if (error) throw error;
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    const platform: Platform = validPlatforms.includes(args?.platform) ? args.platform : 'tp';
    return { results: successRateByField(data ?? [], args?.field, platform, removedSet) };
  }
  if (name === 'get_schedule') {
    if (!args?.tab || !args?.week_start) {
      return { error: 'Both tab and week_start (Monday, YYYY-MM-DD) are required.' };
    }
    let q = supabase
      .from('brand_schedule')
      .select('tab, brand, platform, week_start, monday, tuesday, wednesday, thursday, friday');
    if (args?.tab) q = q.eq('tab', args.tab);
    if (args?.week_start) q = q.eq('week_start', args.week_start);
    const { data, error } = await q;
    if (error) throw error;
    return { schedule: data ?? [] };
  }
  if (name === 'get_paused_combos') {
    let q = supabase
      .from('brand_platform_pause')
      .select('tab, brand, platform, paused_week_start, reason');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { paused: data ?? [] };
  }
  return { error: `unknown tool: ${name}` };
}
