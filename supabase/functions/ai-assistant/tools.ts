// supabase/functions/ai-assistant/tools.ts
// Read-only tools the assistant can call. Most pure helpers (field picking, score
// parsing, row mapping, filtering, score summary) are ported from src/lib/queries.ts
// and src/lib/scoreSummary.ts so the assistant sees the same data the dashboard does.
// A few (proxy "No Proxy"/case-fold resolution, schedule hidden/restricted-brand
// filtering) are real imports from src/lib instead of ported copies, deliberately —
// see the imports below and CLAUDE.md's cross-dashboard-consistency rule. runTool()
// is the only impure part — it needs a Supabase client.
// deno-lint-ignore-file no-explicit-any

import { resolveProxyLabel, canonicalProxyKey, canonicalProxyName } from '../../../src/lib/proxyAliases.ts';
import { buildHiddenBrandSet, buildPlatformRestrictionMap, scheduleBrandKey } from '../../../src/lib/scheduleBrandConfig.ts';
import { buildAgentIndex, buildAgentAssignmentMap, resolveAgentForBrand } from '../../../src/lib/scheduler/scheduleUtils.ts';
import { getTabPlatforms } from '../../../src/lib/tab-configs.ts';

// --- field picking (ported from src/lib/queries.ts + scoreSummary.ts) ---
// Matches src/lib/scoreSummary.ts's pick() exactly: blank is `v === ''`, no trim —
// a whitespace-only value counts as present, same as the frontend. Keep in sync
// manually if either changes.
export function pick(data: Record<string, any>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = data?.[k];
    if (v != null && String(v) !== '') return String(v);
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
  return SENSITIVE_KEYS_NORM.has(String(field ?? '').trim().toLowerCase());
}

// Normalizes a tool's `platform` arg (bare string, array, or omitted) into a
// validated Platform[], defaulting to ['tp'] when omitted or when every
// supplied value is invalid — the one place this parsing logic lives, used
// by get_score_summary, get_success_rate_by_field, and get_performance_report.
export function resolvePlatformArg(rawPlatform: unknown): Platform[] {
  const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
  const requestedPlatforms: string[] = Array.isArray(rawPlatform)
    ? rawPlatform
    : (typeof rawPlatform === 'string' && rawPlatform ? [rawPlatform] : []);
  const filteredPlatforms = requestedPlatforms.filter((p): p is Platform => validPlatforms.includes(p as Platform));
  return rawPlatform == null ? ['tp'] : (filteredPlatforms.length > 0 ? filteredPlatforms : ['tp']);
}

export function collectFieldNames(rows: EntryRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.data ?? {})) {
      if (!isSensitiveField(k)) set.add(k);
    }
  }
  return [...set].sort();
}

export function matchesFieldFilters(e: EntryRow, filters: Record<string, unknown>): boolean {
  for (const [field, value] of Object.entries(filters)) {
    const have = String(e.data?.[field] ?? '').trim().toLowerCase();
    const want = String(value ?? '').trim().toLowerCase();
    if (have !== want) return false;
  }
  return true;
}

export interface FieldGroupCount {
  value: string;
  count: number;
}

export function groupByField(entries: EntryRow[], field: string, resolvedAgentLabels?: Map<string, string>): FieldGroupCount[] {
  // "Proxy Used" is grouped case-insensitively (canonicalProxyKey/canonicalProxyName),
  // matching every other proxy-grouping path in the codebase. Every other field stays
  // a plain case-sensitive raw-value group. "Agent" resolves through
  // resolvedAgentLabels when the caller supplies one (see resolveAgentLabels below) —
  // omitting it keeps the original raw-per-entry-column behavior.
  const buckets = new Map<string, { label: string; count: number }>();
  for (const e of entries) {
    const raw = field === 'Agent' && resolvedAgentLabels
      ? (resolvedAgentLabels.get(e.id) ?? '')
      : String(e.data?.[field] ?? '').trim();
    if (!raw) continue;
    const bucketKey = field === 'Proxy Used' ? canonicalProxyKey(raw) : raw;
    const label = field === 'Proxy Used' ? canonicalProxyName(raw) : raw;
    const existing = buckets.get(bucketKey);
    if (existing) existing.count += 1;
    else buckets.set(bucketKey, { label, count: 1 });
  }
  return [...buckets.values()]
    .map(({ label, count }) => ({ value: label, count }))
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

// Ported from src/lib/scoreSummary.ts's PLATFORM_DATE_KEYS/parsePostDate/
// passesPlatformDateFilter — keep in sync manually if any of the three
// change, same convention as this file's other ported constants
// (PLATFORM_STATUS_KEYS above). Shared date gate every date-aware tool in
// this file uses (query_entries, get_score_summary,
// get_success_rate_by_field, get_performance_report).
export const PLATFORM_DATE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['Trust Pilot'],
  ag: ['Ask Gambler review added'],
  cg: ['Casino Guru review added'],
  wo: ['Wizard of Odds'],
};

function buildDate(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

// Same 3-branch parse as src/lib/scoreSummary.ts's parsePostDate: YYYY-MM-DD
// (also used for date_from/date_to, which are always this format), DD/MM/YYYY
// (sheet format), then a native Date() fallback for JS Date.toString() values.
export function parsePostDate(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return buildDate(y, mo, d);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    return buildDate(y, mo, d);
  }
  const native = new Date(s);
  if (!isNaN(native.getTime())) {
    return new Date(native.getFullYear(), native.getMonth(), native.getDate());
  }
  return null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// Shared date-range param shape for scoreSummary/successRateByField/performanceReport.
export interface DateRangeArgs {
  from?: string;
  to?: string;
}

// Ranged date-gate for a single platform's date column, mirroring
// src/lib/scoreSummary.ts's passesPlatformDateFilter (+ the passesDateFilter
// it wraps) exactly. No bounds -> always true. A row with no parseable date
// for this platform's date column -> always true (never excluded by a
// range) -- this is what stops date-filtering from skewing a live/removed
// rate by dropping undated Removed/Refused rows. Bounds are inclusive, at
// day granularity.
export function passesPlatformDateFilter(
  data: Record<string, any>,
  platform: Platform,
  fromISO?: string,
  toISO?: string,
): boolean {
  const { fromBound, toBound } = resolveDateBounds({ from: fromISO, to: toISO });
  if (!fromBound && !toBound) return true;
  const raw = pick(data, PLATFORM_DATE_KEYS[platform]);
  if (raw == null) return true;
  const date = parsePostDate(raw);
  if (date == null) return true;
  if (fromBound && date < fromBound) return false;
  if (toBound && date > toBound) return false;
  return true;
}

// Resolves a DateRangeArgs into inclusive Date bounds, shared by
// passesPlatformDateFilter and scoreSummary's stricter star-breakdown gate —
// the one place "from"/"to" ISO strings become comparable Date objects, so
// the two gates can't silently drift on how a bound is computed.
export function resolveDateBounds(range: DateRangeArgs): { fromBound: Date | null; toBound: Date | null } {
  const fromDate = range.from ? parsePostDate(range.from) : null;
  const toDate = range.to ? parsePostDate(range.to) : null;
  return {
    fromBound: fromDate ? startOfDay(fromDate) : null,
    toBound: toDate ? endOfDay(toDate) : null,
  };
}

const STRICT_ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

// Validates a raw date_from/date_to arg pair before it's used anywhere.
// Deliberately stricter than parsePostDate: parsePostDate also accepts
// DD/MM/YYYY (the sheet format) and a lenient native-Date() fallback, both
// needed for parsing whatever format a stored review-post date happens to be
// in — but every date_from/date_to tool description in this file documents
// the arg as always YYYY-MM-DD, so a shorthand like '2026' or 'may 2026'
// should be rejected here, not silently accepted via parsePostDate's native
// fallback into an unintended single-day/month range. Returns an error
// string naming the bad field(s) if either is present-but-unparseable, or if
// both are present and from > to. Returns null when the pair is usable
// (including when both are simply absent — no range requested is not an
// error).
export function validateDateRangeArgs(dateFrom: unknown, dateTo: unknown): string | null {
  const isValidIsoDate = (v: unknown): boolean => {
    const s = String(v).trim();
    const m = STRICT_ISO_DATE_RE.exec(s);
    if (!m) return false;
    return buildDate(+m[1], +m[2], +m[3]) != null;
  };
  const badFields: string[] = [];
  if (dateFrom != null && dateFrom !== '' && !isValidIsoDate(dateFrom)) badFields.push('date_from');
  if (dateTo != null && dateTo !== '' && !isValidIsoDate(dateTo)) badFields.push('date_to');
  if (badFields.length > 0) {
    return `${badFields.join(' and ')} must be a valid YYYY-MM-DD date.`;
  }
  if (dateFrom && dateTo) {
    const from = parsePostDate(String(dateFrom));
    const to = parsePostDate(String(dateTo));
    if (from && to && from > to) {
      return 'date_from must not be after date_to.';
    }
  }
  return null;
}

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

export interface AgentAssignmentRow {
  tab: string;
  brand: string;
  platform: Platform;
  agent: string | null;
}

// Real import, not a ported copy (buildAgentIndex/buildAgentAssignmentMap/
// resolveAgentForBrand from src/lib/scheduler/scheduleUtils.ts) — resolves one
// representative Agent label per entry, the SAME brand-level rule Schedule
// Planner's tooltip/filter use (buildResolvedAgentIndex), keyed by entry id so
// successRateByField/groupByField can look a label up without re-deriving it
// per bucket. Requires each entry's own `updated_at` (buildAgentIndex's
// most-recently-updated-entry fallback needs it) — EntryRow itself intentionally
// stays narrower (id/tab/data only, unchanged, so every other function/test in
// this file is unaffected); callers of this helper pass the wider shape directly.
export function resolveAgentLabels(
  entries: { id: string; tab: string; data: Record<string, any>; updated_at: string }[],
  assignmentRows: AgentAssignmentRow[],
): Map<string, string> {
  const entriesByTab = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = entriesByTab.get(e.tab);
    if (list) list.push(e);
    else entriesByTab.set(e.tab, [e]);
  }
  const assignmentsByTab = new Map<string, AgentAssignmentRow[]>();
  for (const row of assignmentRows) {
    const list = assignmentsByTab.get(row.tab);
    if (list) list.push(row);
    else assignmentsByTab.set(row.tab, [row]);
  }
  const result = new Map<string, string>();
  for (const [tab, tabEntries] of entriesByTab) {
    const fallbackEntries = tabEntries.map((e) => ({
      id: e.id,
      tab: e.tab,
      sheet_row_id: e.id,
      data: e.data,
      updated_at: e.updated_at,
      last_edited_by: 'dashboard' as const,
      last_sync_tag: null,
    }));
    const fallback = buildAgentIndex(fallbackEntries);
    const assignments = buildAgentAssignmentMap(assignmentsByTab.get(tab) ?? []);
    const platforms = getTabPlatforms(tab);
    for (const e of tabEntries) {
      const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
      if (!brand) continue;
      const label = resolveAgentForBrand(normalizeBrandKey(brand), platforms, assignments, fallback);
      if (label) result.set(e.id, label);
    }
  }
  return result;
}

// No tab filter -- the table is small (~70 rows total across all 11 tabs) and
// query_entries/get_success_rate_by_field can both span multiple tabs in one
// call, so resolveAgentLabels groups these by row.tab itself rather than this
// function issuing one fetch per distinct tab present in the entries.
async function fetchAgentAssignmentRows(supabase: any): Promise<AgentAssignmentRow[]> {
  const { data, error } = await supabase.from('brand_agent_assignments').select('tab, brand, platform, agent');
  if (error) throw error;
  return (data ?? []) as AgentAssignmentRow[];
}

// Archived-tab exclusion (Brand Tab archive feature). Applied to the 8 tools
// that return review data or tab names: list_tabs, query_entries,
// get_score_summary, get_success_rate_by_field, get_schedule,
// get_paused_combos, get_review_texts, get_review_analyses.
// Deliberately NOT applied to three tools:
//   - get_removed_platform_flags: lists removed_platform_brands rows, not
//     review data — a stale flag on an archived tab is low-impact trivia.
//   - get_entry: single-row lookup by id, not tab-scoped from the caller's
//     perspective.
//   - list_fields: returns field *names* only, never row data, so
//     archived-tab exposure risk there is negligible.
// None of the three carry the "model asserts an archived tab doesn't exist"
// or "returns an archived tab's data as current" hallucination risk that
// motivated the exclusion in the other 7.
export function buildArchivedTabNameSet(rows: { tab: string; restored_at: string | null }[]): Set<string> {
  return new Set(rows.filter((r) => !r.restored_at).map((r) => r.tab));
}

async function fetchArchivedTabNameSet(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase.from('tab_archive_log').select('tab, restored_at');
  if (error) throw error;
  return buildArchivedTabNameSet(data ?? []);
}

// Paused-tab exclusion (Brand Tab Pause feature,
// docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md). Applied
// alongside archivedSet at the exact same 8 filter points archived-tab
// exclusion already covers: list_tabs, query_entries, get_score_summary,
// get_success_rate_by_field, get_schedule, get_paused_combos,
// get_review_texts, get_review_analyses. paused_tabs is current-state-only (no restored_at
// column) -- every row it returns is an active pause, unlike
// tab_archive_log which mixes active and historical rows.
export function buildPausedTabNameSet(rows: { tab: string }[]): Set<string> {
  return new Set(rows.map((r) => r.tab));
}

async function fetchPausedTabNameSet(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase.from('paused_tabs').select('tab');
  if (error) throw error;
  return buildPausedTabNameSet(data ?? []);
}

async function fetchScheduleHiddenSet(supabase: any): Promise<Set<string>> {
  const { data, error } = await supabase.from('schedule_hidden_brands').select('tab, brand');
  if (error) throw error;
  return buildHiddenBrandSet(data ?? []);
}

async function fetchScheduleRestrictionMap(supabase: any): Promise<Map<string, Platform>> {
  const { data, error } = await supabase
    .from('schedule_platform_restrictions')
    .select('tab, brand, allowed_platform');
  if (error) throw error;
  return buildPlatformRestrictionMap(data ?? []);
}

function filterHiddenOrRestricted<T extends { tab: string; brand: string; platform: string | null }>(
  rows: T[],
  hiddenSet: Set<string>,
  restrictionMap: Map<string, Platform>,
  removedSet: Set<string>,
): T[] {
  return rows.filter((row) => {
    const key = scheduleBrandKey(row.tab, row.brand);
    if (hiddenSet.has(key)) return false;
    const restriction = restrictionMap.get(key);
    if (restriction && row.platform && row.platform !== restriction) return false;
    if (row.platform && removedSet.has(platformRemovedKey(row.tab, row.brand, row.platform as Platform))) return false;
    return true;
  });
}

// (Task 242, closing the gap Task 241 documented) The 'agent' field's raw
// per-entry Agent column is still the base value read here, but callers that
// pass a `resolvedAgentLabels` map (see `resolveAgentLabels` below) get each
// entry's Agent resolved the SAME way Schedule Planner's tooltip/filter/PMS-push
// do: `brand_agent_assignments` first (even an explicit-null "N/A" row is
// authoritative), falling back to this per-entry column only when the table has
// no row for that brand+platform. Both live tool handlers (get_success_rate_by_field,
// query_entries) build and pass this map; a caller that omits it (every existing
// test, and any future direct caller of these two functions) gets the original,
// unresolved per-entry behavior unchanged — this is opt-in, not a breaking change
// to either function's default behavior.
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
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  resolvedAgentLabels?: Map<string, string>,
  range: DateRangeArgs = {},
): FieldSuccessRate[] {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  const fieldKeys = FIELD_KEYS[field];
  const buckets = new Map<string, { label: string; live: number; removed: number }>();
  for (const e of entries) {
    const label = field === 'proxy'
      ? resolveProxyLabel(pick(e.data, fieldKeys))
      : field === 'agent' && resolvedAgentLabels
        ? (resolvedAgentLabels.get(e.id) ?? '')
        : (pick(e.data, fieldKeys) ?? '').trim();
    if (!label) continue;
    const bucketKey = field === 'proxy' ? canonicalProxyKey(label) : label;
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();

    // matchedAny mirrors the frontend's computeSuccessRates gate (Task 5) —
    // a bucket exists for any non-blank status, not only a live/removed one.
    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    for (const platform of resolved) {
      if (brand && removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesPlatformDateFilter(e.data, platform, range.from, range.to)) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
    }
    if (!matchedAny) continue;

    let b = buckets.get(bucketKey);
    if (!b) {
      b = { label, live: 0, removed: 0 };
      buckets.set(bucketKey, b);
    }
    if (matchedLive) b.live += 1;
    else if (matchedRemoved) b.removed += 1;
  }
  return [...buckets.values()]
    .map(({ label, live, removed }) => {
      const total = live + removed;
      return { value: label, live, removed, total, rate: total === 0 ? null : (live / total) * 100 };
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

export interface ScoreSummaryResult {
  brands: BrandScoreSummary[];
  excludedRows: number;
}

// Star rollup (Published-only) AND live/removed Success Rate, grouped by
// `${tab} ${brand}`, computed in one pass per platform. Mirrors
// computeScoreSummary + computeSuccessRates in src/lib/scoreSummary.ts, merged
// into a single result since the assistant only ever needs the combined view.
// `range` (YYYY-MM-DD from/to, both optional) applies two different gates,
// matching the dashboard exactly: live/removed counts use the lenient
// passesPlatformDateFilter gate (an undated row always counts, so a date
// range can't skew Success Rate by silently dropping undated Removed/Refused
// rows); the star-rating breakdown (single-platform only) uses the stricter
// gate from computeScoreSummary — when a range is active, a Published row
// with no parseable date is excluded from the breakdown and tallied in
// excludedRows instead of silently counted or silently dropped.
// Deliberate divergence from the dashboard, worth knowing: src/lib's
// computeScoreSummary creates a brand's bucket from status alone, before any
// date gate, so a brand whose rows are all outside the requested range still
// appears in the result (with zero rated) — this ported version gates
// bucket existence on the date filter too (via the matchedAny check below),
// so such a brand disappears from `brands` entirely when a range is active.
// This is a documented choice for this tool, not a bug.
export function scoreSummary(
  entries: EntryRow[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  range: DateRangeArgs = {},
): ScoreSummaryResult {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  // Same rule as computeScoreSummary (Task 5): the star/score breakdown only
  // ever applies for exactly one platform — 2+ platforms still combine
  // live/removed but report zeroed counts/unrated (the caller should treat
  // a >1-length platforms array as "combined totals only, no star detail").
  const showStars = resolved.length === 1;
  const maxScore = showStars ? PLATFORM_MAX_SCORE[resolved[0]] : 0;
  const dateFilterActive = !!(range.from || range.to);
  const { fromBound: rangeFromBound, toBound: rangeToBound } = resolveDateBounds(range);

  interface Bucket {
    tab: string;
    brand: string;
    counts: Record<number, number>;
    unrated: number;
    live: number;
    removed: number;
  }
  const buckets = new Map<string, Bucket>();
  let excludedRows = 0;

  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    let solePublished = false;
    for (const platform of resolved) {
      if (removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesPlatformDateFilter(e.data, platform, range.from, range.to)) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
      if (showStars && status === 'published') solePublished = true;
    }
    if (!matchedAny) continue;

    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      const counts: Record<number, number> = {};
      for (let i = 1; i <= maxScore; i++) counts[i] = 0;
      b = { tab: e.tab, brand, counts, unrated: 0, live: 0, removed: 0 };
      buckets.set(key, b);
    }

    if (matchedLive) b.live += 1;
    else if (matchedRemoved) b.removed += 1;

    if (showStars && solePublished) {
      const date = parsePostDate(pick(e.data, PLATFORM_DATE_KEYS[resolved[0]]));
      let shouldCount = true;
      if (dateFilterActive) {
        if (date == null) {
          excludedRows++;
          shouldCount = false;
        } else if ((rangeFromBound && date < rangeFromBound) || (rangeToBound && date > rangeToBound)) {
          shouldCount = false;
        }
      }
      if (shouldCount) {
        const score = parseScore(pick(e.data, PLATFORM_SCORE_KEYS[resolved[0]]), maxScore);
        if (score == null) b.unrated += 1;
        else b.counts[score] += 1;
      }
    }
  }

  const brandsOut = [...buckets.values()].map((b) => {
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
    // Floored to a whole percent (except exactly 100 stays 100), matching
    // src/lib/scoreSummary.ts's successRatePct. Keep in sync manually if either changes.
    const rawRate = successTotal === 0 ? null : (b.live / successTotal) * 100;
    const successRate = rawRate == null ? null : (rawRate === 100 ? 100 : Math.floor(rawRate));
    return {
      tab: b.tab, brand: b.brand, counts: b.counts, unrated: b.unrated,
      publishedTotal, rated, average, label, live: b.live, removed: b.removed, successRate,
    };
  });

  return { brands: brandsOut, excludedRows };
}

export interface PerformanceReportBrand {
  tab: string;
  brand: string;
  live: number;
  removed: number;
  successRate: number | null;
}

export interface PerformanceReportResult {
  totals: { live: number; removed: number; successRate: number | null; entries: number };
  brands: PerformanceReportBrand[];
}

// Period totals + per-brand live/removed breakdown for "give me a report for
// <period>" questions. Reuses the same "any decided status, not just
// Published" live/removed semantics as successRateByField (not
// scoreSummary's Published-only star gate — a performance report is about
// outcomes, not the subset of Published reviews), gated by the same lenient
// passesPlatformDateFilter (an undated row still counts, so a date range
// can't skew the rate by silently dropping undated Removed/Refused rows).
// `entries` in totals counts every row that matched a non-blank, in-range
// status for the requested platform(s) — including an undecided one like
// Pending — mirroring the bucket-existence rule successRateByField/
// scoreSummary already use, not just rows that had a live/removed outcome.
export function performanceReport(
  entries: EntryRow[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  range: DateRangeArgs = {},
): PerformanceReportResult {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  const buckets = new Map<string, { tab: string; brand: string; live: number; removed: number }>();
  let totalLive = 0;
  let totalRemoved = 0;
  let totalEntries = 0;

  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    for (const platform of resolved) {
      if (removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
      const status = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesPlatformDateFilter(e.data, platform, range.from, range.to)) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
    }
    if (!matchedAny) continue;

    const key = `${e.tab} ${brand}`;
    let b = buckets.get(key);
    if (!b) {
      b = { tab: e.tab, brand, live: 0, removed: 0 };
      buckets.set(key, b);
    }
    totalEntries += 1;
    if (matchedLive) { b.live += 1; totalLive += 1; }
    else if (matchedRemoved) { b.removed += 1; totalRemoved += 1; }
  }

  const brandsOut: PerformanceReportBrand[] = [...buckets.values()]
    .map((b) => {
      const total = b.live + b.removed;
      const rawRate = total === 0 ? null : (b.live / total) * 100;
      const successRate = rawRate == null ? null : (rawRate === 100 ? 100 : Math.floor(rawRate));
      return { tab: b.tab, brand: b.brand, live: b.live, removed: b.removed, successRate };
    })
    .sort((a, b) => (b.live + b.removed) - (a.live + a.removed));

  const totalDecided = totalLive + totalRemoved;
  const totalRawRate = totalDecided === 0 ? null : (totalLive / totalDecided) * 100;
  const totalSuccessRate = totalRawRate == null ? null : (totalRawRate === 100 ? 100 : Math.floor(totalRawRate));

  return {
    totals: { live: totalLive, removed: totalRemoved, successRate: totalSuccessRate, entries: totalEntries },
    brands: brandsOut,
  };
}

export interface ReviewTextRow {
  brand: string;
  text: string;
}

const REVIEW_TEXT_MAX_CHARS = 2000;

// Aggregate character budget across a single reviewTextsByStatus() call's
// returned reviews — worst case (limit: 50 x 2000 chars each) is ~100KB
// re-sent on every one of up to 5 tool-loop iterations. total still reflects
// every real match, not just what fit inside the budget.
const REVIEW_TEXT_BUDGET_CHARS = 30000;

// Ported from src/lib/scoreSummary.ts's PLATFORM_REVIEW_TEXT_KEYS — keep in
// sync manually if either changes, same convention as this file's other
// ported constants (FIELD_KEYS, PLATFORM_STATUS_KEYS).
const PLATFORM_REVIEW_TEXT_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Text'],
  ag: ['AG Review Text'],
  cg: ['CG Review Text'],
  wo: ['WO Review Text'],
};

export function reviewTextsByStatus(
  entries: EntryRow[],
  platform: Platform,
  status: string,
  removedPlatformBrands: Set<string> = new Set(),
): { reviews: ReviewTextRow[]; total: number } {
  const wantStatus = status.trim().toLowerCase();
  const results: ReviewTextRow[] = [];
  let total = 0;
  let budgetUsed = 0;
  for (const e of entries) {
    const brand = (pick(e.data, BRAND_KEYS) ?? '').trim();
    if (brand && removedPlatformBrands.has(platformRemovedKey(e.tab, brand, platform))) continue;
    const haveStatus = (pick(e.data, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
    if (haveStatus !== wantStatus) continue;
    const text = pick(e.data, PLATFORM_REVIEW_TEXT_KEYS[platform]);
    if (!text) continue;
    total++;
    if (budgetUsed >= REVIEW_TEXT_BUDGET_CHARS) continue;
    const truncated = text.length > REVIEW_TEXT_MAX_CHARS
      ? text.slice(0, REVIEW_TEXT_MAX_CHARS) + ' […truncated]'
      : text;
    results.push({ brand, text: truncated });
    // Budgeted on the pre-truncation length, not truncated.length: this is
    // strictly more conservative (truncated <= raw) so it still bounds the
    // final payload size, while also protecting against a single
    // pathologically long field's cost before REVIEW_TEXT_MAX_CHARS is applied.
    budgetUsed += text.length;
  }
  return { reviews: results, total };
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
      description: 'List the distinct brand-group tabs available. An archived or paused tab is ' +
        'silently excluded — if a user asks about a tab not in this list, say it may have been ' +
        'archived or paused rather than concluding it never existed.',
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
        'month (e.g. "may 2026" or "2026-05"), a free-text contains match, and/or ' +
        'field_filters (exact-match on any real field name — call list_fields first ' +
        'if unsure of a field\'s exact name/casing, e.g. "Email Provider"). ' +
        'Pass group_by (a field name) to get counts grouped by that field\'s distinct ' +
        'values instead of raw rows — use this for "how many X by Y" or "most common Y" ' +
        'questions (e.g. group_by="Brands" with field_filters={"Agent":"ANN"} answers ' +
        '"which brands does agent ANN have accounts on"). ' +
        'When group_by is set, the response also includes distinctValues (the true ' +
        'number of distinct values seen, which may exceed the returned groups array if ' +
        'the limit cap truncated it — state "top N of M" rather than presenting groups ' +
        'as exhaustive) and ungrouped (the count of matching rows excluded from ' +
        'grouping because that field was blank/missing for them — total equals ' +
        'ungrouped plus the sum of every group\'s count, not just the returned page). ' +
        'Without group_by, returns matching rows (each with its full set of ' +
        'non-credential fields under `data`) and total count. ' +
        'Rows belonging to a tab that has been archived or paused are silently excluded — if a ' +
        'tab-scoped query returns nothing, say the tab may have been archived or paused rather ' +
        'than concluding it doesn\'t exist. ' +
        'IMPORTANT: when user says "approved", "live", or "active" use status="Published". ' +
        'IMPORTANT: always pass month as "may 2026" style when user mentions a month. ' +
        'For anything broader than one calendar month — a week, a year, a quarter, or a ' +
        'custom range — use date_from/date_to (YYYY-MM-DD, inclusive) instead of month. ' +
        'When tab is also given, only that tab\'s own active platform(s) are checked; ' +
        'otherwise all 4 platforms are checked, but only the ones a given row actually has ' +
        'a status recorded for — a row counts if ANY of ITS applicable platforms\' dates is ' +
        'in range. A row with no parseable date for an applicable platform still counts ' +
        '(never silently excluded by the range, same as every other date-filtered tool here). ' +
        'month and date_from/date_to can be combined (both must pass) but this is rarely ' +
        'useful — prefer one or the other. ' +
        'An unparseable date_from/date_to, or date_from after date_to, returns an error instead ' +
        'of silently ignoring the filter.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          status: { type: 'string' },
          month: { type: 'string', description: 'filter by month, e.g. "may 2026" or "2026-05"' },
          date_from: { type: 'string', description: 'YYYY-MM-DD, inclusive start of a date range — use for a week/year/quarter/custom range instead of month' },
          date_to: { type: 'string', description: 'YYYY-MM-DD, inclusive end of a date range' },
          contains: { type: 'string' },
          field_filters: {
            type: 'object',
            description: 'exact-match filters keyed by real field name, e.g. {"Agent": "ANN"} — must be an object, not a JSON string',
            additionalProperties: { type: 'string' },
          },
          group_by: { type: 'string', description: 'a real field name to group counts by, e.g. "Brands"' },
          limit: { type: 'number', description: 'max entries to return, default 25, max 50 — applies to both raw rows and, when group_by is set, the groups array' },
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
        'per brand, matching the dashboard\'s Score Summary page, for one or more ' +
        'platforms: tp (TrustPilot, default), ag (AskGamblers), cg (CasinoGuru), or wo ' +
        '(Wizard of Odds). Passing multiple platforms combines their live/removed ' +
        'counts into one total, the same OR-across-platforms rule the dashboard\'s own ' +
        'multi-select filters use — it does not average or intersect them. Star-rating ' +
        'detail is only meaningful for exactly one platform at a time — when 2+ ' +
        'platforms are passed, the response still includes combined live/removed/' +
        'successRate but zeroes out the star breakdown. ' +
        'date_from/date_to (YYYY-MM-DD, inclusive) apply two different gates: ' +
        'live/removed counts and successRate never drop an undated row (a range can\'t ' +
        'silently skew the rate), but the star-rating breakdown DOES exclude an undated ' +
        'Published row when a range is set — its count is reported separately as ' +
        'excludedRows, so say "N reviews had no recorded date and are not reflected in ' +
        'the star breakdown" rather than presenting the breakdown as complete when ' +
        'excludedRows is nonzero. The response echoes the applied range as dateRange ' +
        '({from, to}), or null when no range was requested. ' +
        'Brands whose page on the queried platform was flagged removed ' +
        '(see get_removed_platform_flags) are excluded from these results entirely. ' +
        'A tab that has been archived or paused is excluded the same way — an empty or missing ' +
        'result for that tab may mean it\'s archived or paused, not that it never existed. ' +
        'An unparseable date_from/date_to, or date_from after date_to, returns an error instead ' +
        'of silently ignoring the filter.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          platform: { type: 'array', items: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }, description: 'One or more platforms. Passing multiple platforms combines their live/removed counts into one total (OR semantics — a brand counts as live if ANY listed platform says so, not an intersection). Omitting this parameter defaults to TrustPilot only, matching this tool\'s existing single-platform behavior — explicitly list platforms (including all 4) to get a combined total.' },
          date_from: { type: 'string', description: 'YYYY-MM-DD, inclusive start of a date range' },
          date_to: { type: 'string', description: 'YYYY-MM-DD, inclusive end of a date range' },
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
        'agent, or country, for one or more platforms: tp (TrustPilot, default), ag ' +
        '(AskGamblers), cg (CasinoGuru), or wo (Wizard of Odds). Passing multiple platforms ' +
        'combines their live/removed counts into one total, the same OR-across-platforms rule ' +
        'the dashboard\'s own multi-select filters use — it does not average or intersect them. ' +
        'Results are sorted best-rate-first, so the top row answers "which X works best". Rows ' +
        'whose status is pending, paused, or otherwise undecided are not counted (contribute to ' +
        'neither live nor removed) — total may be lower than raw row count for that value. ' +
        'Brands whose page on the queried platform was flagged removed (see ' +
        'get_removed_platform_flags) are excluded from these results entirely. ' +
        'A tab that has been archived or paused is excluded the same way — an empty result for ' +
        'that tab may mean it\'s archived or paused, not that it never existed. ' +
        'The "agent" field is resolved per-brand the same way the dashboard\'s Schedule ' +
        'Planner does (an authoritative brand-agent mapping first, falling back to each ' +
        'account\'s own recorded Agent value only when that mapping has no answer for the ' +
        'brand), so it agrees with what Schedule Planner shows even for tabs whose accounts ' +
        'have no Agent field recorded at all. ' +
        'date_from/date_to (YYYY-MM-DD, inclusive) narrow the live/removed counts to that ' +
        'period — a row with no parseable date for a checked platform still counts (never ' +
        'silently excluded by the range, same as every other date-filtered tool here). ' +
        'An unparseable date_from/date_to, or date_from after date_to, returns an error instead ' +
        'of silently ignoring the filter.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['proxy', 'agent', 'country'] },
          platform: { type: 'array', items: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }, description: 'One or more platforms. Passing multiple platforms combines their live/removed counts into one total (OR semantics — a brand counts as live if ANY listed platform says so, not an intersection). Omitting this parameter defaults to TrustPilot only, matching this tool\'s existing single-platform behavior — explicitly list platforms (including all 4) to get a combined total.' },
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
          date_from: { type: 'string', description: 'YYYY-MM-DD, inclusive start of a date range' },
          date_to: { type: 'string', description: 'YYYY-MM-DD, inclusive end of a date range' },
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
        'real evidence before asserting a past post occurred. Rows are also silently ' +
        'filtered: a brand+platform combo that is hidden from Schedule Planner, ' +
        'restricted to a different platform, or has a flagged-removed page (see ' +
        'get_removed_platform_flags) will never appear here, even in a week it would ' +
        'otherwise be scheduled. If a user asks about a combo missing from the results, ' +
        'say it may be hidden, platform-restricted, or removed rather than concluding ' +
        'it was never scheduled or doesn\'t exist. A tab that has been archived or paused ' +
        'returns no rows at all here, for the same reason — say it may have been archived ' +
        'or paused rather than concluding it has no schedule or doesn\'t exist.',
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
        'before asserting a combo is still paused. The same hidden/restricted/removed ' +
        'filtering as get_schedule applies here too — a combo missing from this list may ' +
        'be excluded for one of those reasons rather than genuinely not paused. A tab that ' +
        'has been archived or paused is excluded entirely too — an empty result for that ' +
        'tab may mean it\'s archived or paused, not that it was never tracked.',
      parameters: {
        type: 'object',
        properties: { tab: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_review_texts',
      description:
        'Returns real review text for a platform + status, for reading and comparing content ' +
        '(e.g. "what tends to separate a Published TrustPilot review from a Removed one?"). ' +
        'Prefer this over query_entries for any question about review content — query_entries ' +
        'can technically surface the same review-text field, but without this tool\'s ' +
        'platform-scoped status matching, removed-brand exclusion, or the data-quality caveats ' +
        'below. ' +
        'One platform and one status per call — call it again with a different status (or ' +
        'platform) to compare groups; results are never combined across platforms since each ' +
        'has a different review format/audience. status uses the same values as query_entries ' +
        '("Published", "Removed", "Refused", "Not Done", "On Pause"). Rows with no recorded text ' +
        'for that platform are skipped, and brands flagged removed on that platform (see ' +
        'get_removed_platform_flags) are excluded. Known data-quality caveats to keep in mind ' +
        'when reading results: TrustPilot text can occasionally be a review title rather than ' +
        'the body; AskGamblers text can carry a trailing "Helpful (N)" vote-count line; ' +
        'CasinoGuru text can carry an appended casino owner-reply, or be missing entirely on an ' +
        'ambiguous page match — treat these as scraper noise, not a real content signal. Each ' +
        'review is capped at 2000 characters (flagged with " […truncated]" if cut). total is ' +
        'the match count within the rows scanned (up to 1000 per call, ordered by id — if a ' +
        'tab/platform/status combination has more than that, total may undercount the true ' +
        'dataset), before the limit cap; a capped result should be presented as "showing N of ' +
        'total", not as exhaustive. A tab that has been archived or paused returns no reviews ' +
        'here either — say it may have been archived or paused rather than concluding it never ' +
        'had review data.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
          platform: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] },
          status: { type: 'string', description: 'exact status value, e.g. "Published" or "Removed" — same vocabulary as query_entries' },
          limit: { type: 'number', description: 'max reviews to return, default 20, max 50' },
        },
        required: ['platform', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_review_analyses',
      description:
        'Returns AI-generated review-removal-risk assessments from the dashboard\'s per-entry ' +
        '"🤖 Analyze Review" feature. Coverage is SPARSE and OPPORTUNISTIC: only entries someone ' +
        'has manually clicked "Analyze Review" on exist here — this is not run automatically or ' +
        'on every removed/refused review. An empty or small result means "not yet analyzed", ' +
        'never "no removal-risk issues found" — do not imply broader coverage than what is ' +
        'actually returned. Without group_by, returns individual analyzed entries (tab, brand, ' +
        'agent, platform, overall_result, risk_score, confidence, root_cause, analyzed_at). With ' +
        'group_by ("agent", "brand", "platform", or "overall_result"), returns exact counts per ' +
        'group plus how many were "likely_removal_risk", sorted most-common-first — prefer this ' +
        'over manually counting rows yourself for "which X has the most" questions. The "agent" ' +
        'field/group is resolved per-brand the same way get_success_rate_by_field and Schedule ' +
        'Planner do (an authoritative brand-agent mapping first, falling back to each entry\'s own ' +
        'recorded Agent value). Brands flagged removed on the queried platform (see ' +
        'get_removed_platform_flags) are excluded, as are archived/paused tabs — same exclusions ' +
        'as every other tool here.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
          platform: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] },
          agent: { type: 'string', description: 'optional: restrict to one resolved agent name' },
          group_by: { type: 'string', enum: ['agent', 'brand', 'platform', 'overall_result'] },
          limit: { type: 'number', description: 'max rows or groups to return, default 25, max 50' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_performance_report',
      description:
        'One-call performance report for a date range: period totals (live, removed, ' +
        'Success Rate, entries) plus a per-brand breakdown, sorted by volume (most active ' +
        'brand first). This is the first choice for "give me a report/summary for <period>" ' +
        'questions — for a narrower follow-up (raw rows, review text, a single brand\'s star ' +
        'rating), use query_entries/get_review_texts/get_score_summary instead. ' +
        'date_from and date_to are both required, YYYY-MM-DD — compute the actual dates ' +
        'yourself from the current-date system message (e.g. "last month" -> the 1st and ' +
        'last day of the previous calendar month), the same way you already compute ' +
        'week_start for get_schedule. Live/removed counts use the same "any decided status" ' +
        'rule as get_success_rate_by_field (not get_score_summary\'s Published-only star ' +
        'gate) — a row with no parseable date for the platform being checked still counts ' +
        '(never silently dropped by the range, matching every other date-filtered tool here). ' +
        'totals.entries counts every row that matched a non-blank, in-range status for the ' +
        'requested platform(s) — including undecided ones like Pending or On Pause — so it can ' +
        'be larger than live + removed; that is not an inconsistency, it just means some ' +
        'matched rows have no decided outcome yet. ' +
        'platform accepts one or more of tp (TrustPilot, default), ag (AskGamblers), cg ' +
        '(CasinoGuru), wo (Wizard of Odds) — multiple platforms combine into one OR\'d total, ' +
        'same as get_score_summary. tab optionally restricts to one tab (all tabs if omitted). ' +
        'Brands whose page on the queried platform was flagged removed (see ' +
        'get_removed_platform_flags), and any archived or paused tab, are excluded — the same ' +
        'exclusions every other review-data tool here applies. ' +
        'brands is capped at limit (default 50, max 100), sorted by volume — totalBrands ' +
        'reports the true count so you can say "top N of M" if it was truncated; totals are ' +
        'never affected by the cap. ' +
        'An unparseable date_from/date_to, or date_from after date_to, returns an error instead ' +
        'of silently ignoring the filter.',
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'YYYY-MM-DD, start of the report period (inclusive)' },
          date_to: { type: 'string', description: 'YYYY-MM-DD, end of the report period (inclusive)' },
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
          platform: { type: 'array', items: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] }, description: 'One or more platforms. Passing multiple platforms combines their live/removed counts into one total (OR semantics). Omitting this parameter defaults to TrustPilot only.' },
          limit: { type: 'number', description: 'max brands to return in the breakdown, default 50, max 100' },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
];

// --- tool dispatch (impure: needs a supabase client) ---
export async function runTool(supabase: any, name: string, args: any): Promise<unknown> {
  if (name === 'list_tabs') {
    const q = supabase.from('entries').select('tab');
    const [{ data, error }, archivedSet, pausedSet] = await Promise.all([q, fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase)]);
    if (error) throw error;
    const tabs = [...new Set(((data ?? []) as any[]).map((r: any) => r.tab))].filter((t: string) => !archivedSet.has(t) && !pausedSet.has(t));
    return { tabs: tabs.sort() };
  }
  if (name === 'list_fields') {
    // Field *names* repeat heavily across rows — a capped scan is enough to
    // discover them all without pulling every row in the table.
    let q = supabase.from('entries').select('tab, data').limit(500);
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { fields: collectFieldNames(data ?? []) };
  }
  if (name === 'query_entries') {
    const dateError = validateDateRangeArgs(args?.date_from, args?.date_to);
    if (dateError) return { error: dateError };
    if (args?.field_filters !== undefined) {
      const ff = args.field_filters;
      if (typeof ff !== 'object' || ff === null || Array.isArray(ff)) {
        return { error: 'field_filters must be an object mapping field names to values, e.g. {"Agent": "ANN"} — not a JSON string.' };
      }
    }
    if (args?.group_by !== undefined && typeof args.group_by !== 'string') {
      return { error: 'group_by must be a single field name (string), e.g. "Brands".' };
    }
    if (args?.group_by && isSensitiveField(args.group_by)) {
      return { error: `Cannot group by "${args.group_by}" — this field is redacted for security.` };
    }
    const badFilterField = Object.keys(args?.field_filters ?? {}).find(isSensitiveField);
    if (badFilterField) {
      return { error: `Cannot filter by "${badFilterField}" — this field is redacted for security.` };
    }
    let q = supabase.from('entries').select('id, tab, data, updated_at');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, archivedSet, pausedSet, assignmentRows] = await Promise.all([
      q,
      fetchArchivedTabNameSet(supabase),
      fetchPausedTabNameSet(supabase),
      fetchAgentAssignmentRows(supabase),
    ]);
    if (error) throw error;
    let rows: EntryRow[] = (data ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
    if (args?.status) rows = rows.filter((e) => matchesStatus(e, args.status));
    if (args?.month) rows = rows.filter((e) => matchesMonth(e, args.month));
    if (args?.date_from || args?.date_to) {
      const tabPlatforms = args?.tab ? getTabPlatforms(args.tab) : [];
      const platformsToCheck: Platform[] = tabPlatforms.length > 0 ? tabPlatforms : (['tp', 'ag', 'cg', 'wo'] as Platform[]);
      rows = rows.filter((e) => {
        // Only check a platform's date if the row actually has a status
        // recorded for it — otherwise an irrelevant platform's simply-absent
        // date key would trigger passesPlatformDateFilter's "undated ->
        // always true" bias and silently defeat the range for almost every
        // row (most rows only ever populate 1-2 of the 4 platforms' fields).
        // If the row has no status for ANY checked platform, fall back to
        // checking them all anyway — same "unsure, include" bias as the rest
        // of this file, just applied one level up.
        const applicable = platformsToCheck.filter((p) => !!(pick(e.data, PLATFORM_STATUS_KEYS[p]) ?? '').trim());
        const checkPlatforms = applicable.length > 0 ? applicable : platformsToCheck;
        return checkPlatforms.some((p) => passesPlatformDateFilter(e.data, p, args.date_from, args.date_to));
      });
    }
    if (args?.contains) rows = rows.filter((e) => entryMatches(e, args.contains));
    if (args?.field_filters) rows = rows.filter((e) => matchesFieldFilters(e, args.field_filters));
    const limit = Math.min(Number(args?.limit) || 25, 50);
    if (args?.group_by) {
      const agentLabels = args.group_by === 'Agent'
        ? resolveAgentLabels(rows as (EntryRow & { updated_at: string })[], assignmentRows)
        : undefined;
      const allGroups = groupByField(rows, args.group_by, agentLabels);
      const groupedCount = allGroups.reduce((sum, g) => sum + g.count, 0);
      return {
        total: rows.length,
        groups: allGroups.slice(0, limit),
        distinctValues: allGroups.length,
        ungrouped: rows.length - groupedCount,
      };
    }
    const total = rows.length;
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
    const dateError = validateDateRangeArgs(args?.date_from, args?.date_to);
    if (dateError) return { error: dateError };
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data: rawData, error }, removedSet, archivedSet, pausedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const data = (rawData ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
    const platforms = resolvePlatformArg(args?.platform);
    const range: DateRangeArgs = { from: args?.date_from, to: args?.date_to };
    const { brands, excludedRows } = scoreSummary(data ?? [], platforms, removedSet, range);
    return {
      brands,
      excludedRows,
      dateRange: (args?.date_from || args?.date_to) ? { from: args?.date_from ?? null, to: args?.date_to ?? null } : null,
    };
  }
  if (name === 'get_removed_platform_flags') {
    let q = supabase.from('removed_platform_brands').select('tab, brand, platform');
    if (args?.tab) q = q.eq('tab', args.tab);
    const { data, error } = await q;
    if (error) throw error;
    return { flags: data ?? [] };
  }
  if (name === 'get_success_rate_by_field') {
    const dateError = validateDateRangeArgs(args?.date_from, args?.date_to);
    if (dateError) return { error: dateError };
    let q = supabase.from('entries').select('id, tab, data, updated_at');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data: rawData, error }, removedSet, archivedSet, pausedSet, assignmentRows] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase), fetchAgentAssignmentRows(supabase),
    ]);
    if (error) throw error;
    const data = (rawData ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
    const platforms = resolvePlatformArg(args?.platform);
    const agentLabels = args?.field === 'agent'
      ? resolveAgentLabels(data as (EntryRow & { updated_at: string })[], assignmentRows)
      : undefined;
    const range: DateRangeArgs = { from: args?.date_from, to: args?.date_to };
    return { results: successRateByField(data ?? [], args?.field, platforms, removedSet, agentLabels, range) };
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
    const [{ data, error }, hiddenSet, restrictionMap, removedSet, archivedSet, pausedSet] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
      fetchRemovedPlatformBrandSet(supabase),
      fetchArchivedTabNameSet(supabase),
      fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((r: any) => !archivedSet.has(r.tab) && !pausedSet.has(r.tab));
    return { schedule: filterHiddenOrRestricted(rows, hiddenSet, restrictionMap, removedSet) };
  }
  if (name === 'get_paused_combos') {
    let q = supabase
      .from('brand_platform_pause')
      .select('tab, brand, platform, paused_week_start, reason');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data, error }, hiddenSet, restrictionMap, removedSet, archivedSet, pausedSet] = await Promise.all([
      q,
      fetchScheduleHiddenSet(supabase),
      fetchScheduleRestrictionMap(supabase),
      fetchRemovedPlatformBrandSet(supabase),
      fetchArchivedTabNameSet(supabase),
      fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((r: any) => !archivedSet.has(r.tab) && !pausedSet.has(r.tab));
    return { paused: filterHiddenOrRestricted(rows, hiddenSet, restrictionMap, removedSet) };
  }
  if (name === 'get_review_texts') {
    if (!args?.platform || !args?.status || !String(args.status).trim()) {
      return { error: 'platform and status are both required.' };
    }
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    if (!validPlatforms.includes(args.platform)) {
      return { error: `platform must be one of: ${validPlatforms.join(', ')}` };
    }
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    q = q.order('id').limit(1000);
    const [{ data, error }, removedSet, archivedSet, pausedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const rows = (data ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
    const { reviews, total } = reviewTextsByStatus(rows, args.platform, args.status, removedSet);
    const limit = Math.min(Number(args?.limit) || 20, 50);
    return { reviews: reviews.slice(0, limit), total };
  }
  if (name === 'get_review_analyses') {
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    if (args?.platform && !validPlatforms.includes(args.platform)) {
      return { error: `platform must be one of: ${validPlatforms.join(', ')}` };
    }
    const validGroupBy = ['agent', 'brand', 'platform', 'overall_result'];
    if (args?.group_by && !validGroupBy.includes(args.group_by)) {
      return { error: `group_by must be one of: ${validGroupBy.join(', ')}` };
    }

    let q = supabase.from('entry_review_analyses').select('entry_id, tab, platform, analysis, analyzed_at');
    if (args?.tab) q = q.eq('tab', args.tab);
    if (args?.platform) q = q.eq('platform', args.platform);

    const [{ data: analysisRows, error }, removedSet, archivedSet, pausedSet, assignmentRows] = await Promise.all([
      q,
      fetchRemovedPlatformBrandSet(supabase),
      fetchArchivedTabNameSet(supabase),
      fetchPausedTabNameSet(supabase),
      fetchAgentAssignmentRows(supabase),
    ]);
    if (error) throw error;

    const filteredAnalysisRows = (analysisRows ?? []).filter((r: any) => !archivedSet.has(r.tab) && !pausedSet.has(r.tab));
    if (filteredAnalysisRows.length === 0) return { total: 0, rows: [] };

    const entryIds = [...new Set(filteredAnalysisRows.map((r: any) => r.entry_id))];
    const { data: entryRows, error: entryError } = await supabase
      .from('entries')
      .select('id, tab, data, updated_at')
      .in('id', entryIds);
    if (entryError) throw entryError;

    const entryById = new Map<string, any>((entryRows ?? []).map((e: any) => [e.id, e]));
    const agentLabels = resolveAgentLabels(entryRows ?? [], assignmentRows);

    let combined = filteredAnalysisRows
      .map((r: any) => {
        const entry = entryById.get(r.entry_id);
        const brand = (entry ? (pick(entry.data, BRAND_KEYS) ?? '').trim() : '');
        const agent = agentLabels.get(r.entry_id) ?? '';
        return {
          id: r.entry_id,
          tab: r.tab,
          platform: r.platform,
          brand,
          agent,
          overall_result: r.analysis?.overall_result ?? null,
          risk_score: r.analysis?.risk_score ?? null,
          confidence: r.analysis?.confidence ?? null,
          root_cause: r.analysis?.root_cause?.label ?? null,
          analyzed_at: r.analyzed_at,
        };
      })
      .filter((row: any) => !(row.brand && removedSet.has(platformRemovedKey(row.tab, row.brand, row.platform as Platform))));

    if (args?.agent) {
      const wantAgent = String(args.agent).trim().toLowerCase();
      combined = combined.filter((row: any) => row.agent.toLowerCase() === wantAgent);
    }

    const limit = Math.min(Number(args?.limit) || 25, 50);

    if (args?.group_by) {
      const buckets = new Map<string, { value: string; count: number; likely_removal_risk_count: number }>();
      for (const row of combined) {
        const key = args.group_by === 'agent' ? (row.agent || '(unassigned)')
          : args.group_by === 'brand' ? (row.brand || '(unknown)')
          : args.group_by === 'platform' ? row.platform
          : (row.overall_result ?? '(unknown)');
        const isRisk = row.overall_result === 'likely_removal_risk';
        const existing = buckets.get(key);
        if (existing) {
          existing.count++;
          if (isRisk) existing.likely_removal_risk_count++;
        } else {
          buckets.set(key, { value: key, count: 1, likely_removal_risk_count: isRisk ? 1 : 0 });
        }
      }
      const groups = [...buckets.values()].sort((a, b) => b.count - a.count);
      return { total: combined.length, groups: groups.slice(0, limit) };
    }

    return { total: combined.length, rows: combined.slice(0, limit) };
  }
  if (name === 'get_performance_report') {
    const dateError = validateDateRangeArgs(args?.date_from, args?.date_to);
    if (dateError) return { error: dateError };
    if (!args?.date_from || !args?.date_to) {
      return { error: 'Both date_from and date_to (YYYY-MM-DD) are required.' };
    }
    let q = supabase.from('entries').select('id, tab, data');
    if (args?.tab) q = q.eq('tab', args.tab);
    const [{ data: rawData, error }, removedSet, archivedSet, pausedSet] = await Promise.all([
      q, fetchRemovedPlatformBrandSet(supabase), fetchArchivedTabNameSet(supabase), fetchPausedTabNameSet(supabase),
    ]);
    if (error) throw error;
    const data = (rawData ?? []).filter((e: EntryRow) => !archivedSet.has(e.tab) && !pausedSet.has(e.tab));
    const platforms = resolvePlatformArg(args?.platform);
    const report = performanceReport(data ?? [], platforms, removedSet, { from: args.date_from, to: args.date_to });
    const limit = Math.min(Number(args?.limit) || 50, 100);
    return {
      period: { from: args.date_from, to: args.date_to },
      totals: report.totals,
      brands: report.brands.slice(0, limit),
      totalBrands: report.brands.length,
    };
  }
  return { error: `unknown tool: ${name}` };
}
