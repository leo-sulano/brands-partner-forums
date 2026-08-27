import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase, SUPABASE_ANON_KEY, CHECK_STATUS_URL, CHECK_STATUS_BASE_URL, CHECK_STATUS_TOKEN, CHECK_AG_STATUS_URL, CHECK_AG_STATUS_BASE_URL } from './supabase.ts';
import { inDateRange } from './dateUtils.ts';
import { passesPlatformDateFilter } from './scoreSummary.ts';
import { getTabColumns, getBrandNameCol, getTabPlatforms, ALL_TOOLBAR_FILTERS, type ToolbarFilterKey } from './tab-configs.ts';
import { canonicalCountryKey, canonicalCountryName, resolveCountryLabel } from './countryFlags.ts';
import { canonicalProxyKey, canonicalProxyName, resolveProxyLabel } from './proxyAliases.ts';
import { platformRemovedKey, normalizeBrandKey, type Platform } from './removedPlatformBrands.ts';
import type { BrandScheduleRow, BrandScheduleUpsertRow, Weekday, DayStatus } from './scheduleBrands.ts';
import type { DynamicTabPlatform } from './dynamicTabRegistry.ts';
import type { Mention, MentionStatus } from '../types/mention.ts';
import type { Entry } from '../types/entry.ts';
import type { Profile } from '../types/profile.ts';
import type { BrandEntry, TabKpis, BrandKpis, CountBreakdown } from '../types/brand-entry.ts';
import type { AuditEntityType, AuditLogEntry } from '../types/audit-log.ts';
import type { ReviewRemovalAssessmentResult } from './reviewRemovalAssessment.ts';
import type { RemovalEvidence } from './reviewRemovalEvidence.ts';
import { extractCredentials, type EntryCredentials } from './entryCredentials.ts';

// ---------------------------------------------------------------------------
// Adapter — maps an Entry row to the Mention shape the UI expects.
// Column names in `data` must match the exact column headers.
// Falls back through common variants so minor header-name differences don't
// break the display.
// ---------------------------------------------------------------------------
function getField(data: Record<string, string | null>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (v != null) return v;
  }
  return null;
}

function entryToMention(entry: Entry): Mention {
  const d = entry.data ?? {};
  return {
    id: entry.id,
    tab: entry.tab,
    source_row_id: entry.sheet_row_id,
    forum: getField(d, 'forum', 'Forum') ?? '',
    thread_title: getField(d, 'thread_title', 'Thread Title', 'title', 'Title'),
    mention_text: getField(d, 'mention_text', 'Mention Text', 'text', 'Text', 'body', 'Body') ?? '',
    url: getField(d, 'url', 'URL', 'Url', 'link', 'Link') ?? '',
    author: getField(d, 'author', 'Author', 'username', 'Username'),
    posted_at: getField(d, 'posted_at', 'Posted At', 'date', 'Date'),
    keyword: getField(d, 'keyword', 'Keyword'),
    sentiment: getField(d, 'sentiment', 'Sentiment') as Mention['sentiment'],
    status: (getField(d, 'status', 'Status') ?? 'new') as MentionStatus,
    synced_at: entry.updated_at,
  };
}

function entryToBrandEntry(entry: Entry): BrandEntry {
  const d = entry.data ?? {};
  return {
    id: entry.id,
    tab: entry.tab,
    source_row_id: entry.sheet_row_id,
    casino: getField(d, 'Account Name', 'account_name', 'casino', 'Casino', 'casino_name', 'Casino Name', 'name', 'Name') ?? '',
    platform: getField(d, 'Brand / TP URL PAGE', 'brand', 'Brand', 'platform', 'Platform'),
    status: getField(d, 'Review Status', 'review_status', 'status', 'Status') ?? 'new',
    date: getField(d, 'Score added', 'score_added', 'score', 'Score', 'date', 'Date', 'posted_at', 'Posted At'),
    notes: getField(d, 'Link to the profile', 'link_to_profile', 'profile_link', 'notes', 'Notes', 'note', 'Note'),
  };
}

// ---------------------------------------------------------------------------
// Read queries
// ---------------------------------------------------------------------------

export async function fetchRecentMentions(limit = 20): Promise<Mention[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => entryToMention(row as Entry));
}

export async function fetchMentionById(id: string): Promise<Mention | null> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? entryToMention(data as Entry) : null;
}

export interface MentionCounts {
  total: number;
  last7d: number;
}

export async function fetchMentionCounts(): Promise<MentionCounts> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [totalRes, recentRes] = await Promise.all([
    supabase.from('entries').select('id', { count: 'exact', head: true }),
    supabase
      .from('entries')
      .select('id', { count: 'exact', head: true })
      .gte('updated_at', sevenDaysAgo),
  ]);
  if (totalRes.error) throw totalRes.error;
  if (recentRes.error) throw recentRes.error;
  return { total: totalRes.count ?? 0, last7d: recentRes.count ?? 0 };
}

export interface DailyCount {
  day: string;
  count: number;
}

export async function fetchMentionsPerDay(days = 30): Promise<DailyCount[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('entries')
    .select('updated_at')
    .gte('updated_at', since);
  if (error) throw error;
  const buckets = new Map<string, number>();
  for (const row of data ?? []) {
    const d = (row.updated_at as string).slice(0, 10);
    buckets.set(d, (buckets.get(d) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export interface TopItem {
  label: string;
  count: number;
}

export async function fetchTopForums(limit = 5): Promise<TopItem[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('entries')
    .select('data')
    .gte('updated_at', since);
  if (error) throw error;
  const forums = (data ?? []).map((row) => {
    const d = row.data as Record<string, string | null>;
    return getField(d, 'forum', 'Forum') ?? '';
  });
  return tallyTop(forums, limit);
}

export async function fetchTrendingKeywords(limit = 5): Promise<TopItem[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('entries')
    .select('data')
    .gte('updated_at', since);
  if (error) throw error;
  const keywords = (data ?? [])
    .map((row) => {
      const d = row.data as Record<string, string | null>;
      return getField(d, 'keyword', 'Keyword');
    })
    .filter((k): k is string => k != null && k !== '');
  return tallyTop(keywords, limit);
}

function tallyTop(values: string[], limit: number): TopItem[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export interface EditEvent {
  id: string;
  tab: string;
  account: string | null;
  editor: string | null;
  updated_at: string;
}

export async function fetchRecentEdits(limit = 50): Promise<EditEvent[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('id, tab, data, last_edited_email, updated_at')
    .eq('last_edited_by', 'dashboard')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const d = (row.data ?? {}) as Record<string, string | null>;
    const account = getField(d, 'Account Name', 'Account', 'Brand Name', 'Brand');
    return {
      id: row.id as string,
      tab: row.tab as string,
      account,
      editor: (row.last_edited_email as string | null) ?? null,
      updated_at: row.updated_at as string,
    };
  });
}

export interface TabCreatedEvent {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
}

// Reads custom_tabs directly for the "Recent Activity" feed, the same
// "read the live table, don't log it separately" pattern fetchRecentEdits
// already uses for entry edits — a tab creation has no "before" state to
// snapshot into edit_log/delete_log, so it's purely informational (no
// restore action), unlike a tab archival (which is recorded in its own
// tab_archive_log table and IS restorable, see archiveTab/unarchiveTab
// — tabs are no longer hard-deleted, so they never go through delete_log).
export async function fetchRecentTabCreations(limit = 50): Promise<TabCreatedEvent[]> {
  const { data, error } = await supabase
    .from('custom_tabs')
    .select('id, name, created_by, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export async function fetchAvailableTabs(): Promise<string[]> {
  const { data, error } = await supabase
    .from('tab_schemas')
    .select('tab')
    .order('tab', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.tab as string);
}

export async function fetchRemovedPlatformBrands(
  client: SupabaseClient = supabase,
): Promise<{ tab: string; brand: string; platform: Platform; removed_at: string }[]> {
  const { data, error } = await client
    .from('removed_platform_brands')
    .select('tab, brand, platform, removed_at');
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string; platform: Platform; removed_at: string }[];
}

export async function fetchScheduleHiddenBrands(
  tab: string,
  client: SupabaseClient = supabase,
): Promise<{ tab: string; brand: string }[]> {
  const { data, error } = await client
    .from('schedule_hidden_brands')
    .select('tab, brand')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string }[];
}

export async function fetchScheduleRestrictedBrands(
  tab: string,
  client: SupabaseClient = supabase,
): Promise<{ tab: string; brand: string; allowed_platform: Platform }[]> {
  const { data, error } = await client
    .from('schedule_platform_restrictions')
    .select('tab, brand, allowed_platform')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as { tab: string; brand: string; allowed_platform: Platform }[];
}

export interface BrandAgentAssignmentRow {
  tab: string;
  brand: string;
  platform: Platform;
  agent: string | null;
}

export async function fetchBrandAgentAssignments(
  tab: string,
  client: SupabaseClient = supabase,
): Promise<BrandAgentAssignmentRow[]> {
  const { data, error } = await client
    .from('brand_agent_assignments')
    .select('tab, brand, platform, agent')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as BrandAgentAssignmentRow[];
}

export async function fetchEntriesByTab(tab: string): Promise<BrandEntry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('tab', tab)
    .order('row_index', { ascending: true, nullsFirst: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => entryToBrandEntry(row as Entry));
}

// Simple in-memory cache for tab entries — avoids re-fetching on every navigation.
const tabEntryCache = new Map<string, { entries: Entry[]; ts: number }>();
const TAB_CACHE_TTL = 60_000; // 60 seconds

export function invalidateTabCache(tab: string) {
  tabEntryCache.delete(tab);
}

// Fetches all rows for a tab, paginating in 1 000-row batches to bypass Supabase's default limit.
async function fetchAllTabEntries(tab: string, client: SupabaseClient = supabase): Promise<Entry[]> {
  const cached = tabEntryCache.get(tab);
  if (cached && Date.now() - cached.ts < TAB_CACHE_TTL) return cached.entries;

  const PAGE = 1000;
  const all: Entry[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from('entries')
      .select('*')
      .eq('tab', tab)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as Entry[]));
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }

  tabEntryCache.set(tab, { entries: all, ts: Date.now() });
  return all;
}

export async function fetchRawEntriesByTab(tab: string, client: SupabaseClient = supabase): Promise<Entry[]> {
  return fetchAllTabEntries(tab, client);
}

// Fetches every entry across the given tabs, paginated. When `tabs` is omitted
// (or empty), returns every row in the entries table. Used by the Score
// Summary admin page to scope to the 9 operational brand-group tabs.
export async function fetchAllEntries(tabs?: readonly string[]): Promise<Entry[]> {
  const PAGE = 1000;

  // Each row carries a heavy `data` JSONB, so a single tab set can span several
  // 1000-row pages. Page sequentially and the round-trips add up (4k+ rows took
  // ~18s). Instead: one cheap count query, then fetch every page in parallel.
  // Order by the unique primary key so parallel ranges never overlap or gap —
  // the caller aggregates regardless of order, so updated_at sorting isn't needed.
  function pageQuery(head: boolean) {
    let query = head
      ? supabase.from('entries').select('id', { count: 'exact', head: true })
      : supabase.from('entries').select('*').order('id', { ascending: true });
    if (tabs && tabs.length > 0) {
      query = query.in('tab', tabs as string[]);
    }
    return query;
  }

  const { count, error: countError } = await pageQuery(true);
  if (countError) throw countError;
  const total = count ?? 0;
  if (total === 0) return [];

  const pages = Math.ceil(total / PAGE);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, p) => {
      const from = p * PAGE;
      return pageQuery(false).range(from, from + PAGE - 1);
    }),
  );

  const all: Entry[] = [];
  for (const { data, error } of results) {
    if (error) throw error;
    all.push(...((data ?? []) as Entry[]));
  }
  return all;
}

export async function fetchTabHeaders(tab: string, client: SupabaseClient = supabase): Promise<string[]> {
  const { data, error } = await client
    .from('tab_schemas')
    .select('headers')
    .eq('tab', tab)
    .maybeSingle();
  if (error) throw error;
  const headers = (data?.headers ?? []) as string[];
  const filtered = headers.filter((h) => h !== 'id' && h !== 'last_sync_tag' && h !== '');
  // Dashboard-only tabs (no Google Sheet backing) never get a tab_schemas row —
  // fall back to the tab's configured column whitelist so KPI/status queries
  // still find their status columns instead of silently zeroing out.
  if (filtered.length === 0) return getTabColumns(tab) ?? [];
  return Array.from(new Set(filtered));
}

function isLiveStatus(s: string) {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}
function isRemovedStatus(s: string) {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}
// Mirrored (by hand) in src/lib/scoreSummary.ts as isPendingStatus/isDoneStatus — keep in sync if either changes.
export function isDoneStatus(s: string) { return s === 'done'; }
function isPendingStatus(s: string) { return s.includes('pending') || s === 'not published'; }
function isOnPauseStatus(s: string) { return s.includes('pause'); }
function isNotDoneStatus(s: string) { return s === 'not done' || s.includes('not done'); }

function uniqueDisplayValues(
  raw: (string | null | undefined)[],
  keyFn: (v: string) => string = (v) => v.toLowerCase(),
  labelFn: (v: string) => string = (v) => v,
): string[] {
  const seen = new Map<string, string>();
  for (const v of raw) {
    const trimmed = (v ?? '').trim();
    if (!trimmed) continue;
    const key = keyFn(trimmed);
    if (!seen.has(key)) seen.set(key, labelFn(trimmed));
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function addToBreakdown(
  map: Record<string, CountBreakdown>,
  rawValue: string | null | undefined,
  kind: 'live' | 'removed',
  keyFn: (v: string) => string = (v) => v.toLowerCase(),
  labelFn: (v: string) => string = (v) => v,
) {
  const trimmed = (rawValue ?? '').trim();
  if (!trimmed) return;
  const key = keyFn(trimmed);
  if (!map[key]) map[key] = { label: labelFn(trimmed), live: 0, removed: 0 };
  map[key][kind]++;
}

function resolveReviewColumns(rawHeaders: string[], tab: string): {
  tpCol: string | null; agCol: string | null; cgCol: string | null; woCol: string | null; genericCol: string | null;
  activePlatforms: ('tp' | 'ag' | 'cg' | 'wo')[];
} {
  function resolveHeader(...variants: string[]): string | null {
    for (const v of variants) {
      const found = rawHeaders.find((h) => h.toLowerCase() === v.toLowerCase());
      if (found) return found;
    }
    return null;
  }

  const rawTpCol = resolveHeader('TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status');
  const rawAgCol = resolveHeader('AG Review Status');
  const rawCgCol = resolveHeader('CG Review Status');
  const rawWoCol = resolveHeader('WoO Review Status');
  const genericCol = resolveHeader('Review Status', 'status', 'Status');

  // A platform hidden via the Edit Platforms modal (src/lib/tab-configs.ts's
  // hidden-platform registry) must stop contributing to this tab's KPI
  // totals here too, not just on BrandGroup.tsx's own cards — otherwise
  // Overview and BrandGroup silently disagree on the same tab's numbers the
  // moment a platform is hidden. Nulling the column reference makes
  // classifyEntry (below) treat a hidden platform exactly like one this tab
  // never tracked at all — no other code path needs to change.
  const visible = new Set(getTabPlatforms(tab));
  const tpCol = visible.has('tp') ? rawTpCol : null;
  const agCol = visible.has('ag') ? rawAgCol : null;
  const cgCol = visible.has('cg') ? rawCgCol : null;
  const woCol = visible.has('wo') ? rawWoCol : null;

  const activePlatforms: ('tp' | 'ag' | 'cg' | 'wo')[] = [];
  if (tpCol) activePlatforms.push('tp');
  if (agCol) activePlatforms.push('ag');
  if (cgCol) activePlatforms.push('cg');
  if (woCol) activePlatforms.push('wo');

  return { tpCol, agCol, cgCol, woCol, genericCol, activePlatforms };
}

type ReviewColumns = ReturnType<typeof resolveReviewColumns>;

interface EntryClassification {
  tp: 'live' | 'removed' | null;
  ag: 'live' | 'removed' | null;
  cg: 'live' | 'removed' | null;
  wo: 'live' | 'removed' | null;
  overall: 'live' | 'removed' | 'done' | 'pending' | 'onPause' | 'notDone' | null;
}

// Single source of truth for "what is this one entry, per-platform and
// overall" — computeTabKpisFromEntries (whole-tab total) and
// computeBrandKpisFromEntries (per-brand breakdown) both call this so the
// two views can never disagree about what counts as live/removed/etc.
function classifyEntry(
  d: Record<string, string | null>,
  tab: string,
  brandCol: string,
  cols: ReviewColumns,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  removedPlatformBrands: Set<string>,
  platformFilter: Platform[] | undefined,
): EntryClassification {
  const { tpCol, agCol, cgCol, woCol, genericCol } = cols;
  const tp = tpCol ? (d[tpCol] ?? '').toLowerCase() : '';
  const ag = agCol ? (d[agCol] ?? '').toLowerCase() : '';
  const cg = cgCol ? (d[cgCol] ?? '').toLowerCase() : '';
  const wo = woCol ? (d[woCol] ?? '').toLowerCase() : '';
  const generic = (!tp && !ag && !cg && !wo && genericCol) ? (d[genericCol] ?? '').toLowerCase() : '';

  const brand = (d[brandCol] ?? '').trim();
  const isPlatformFlagged = (platform: Platform) =>
    brand !== '' && removedPlatformBrands.has(platformRemovedKey(tab, brand, platform));

  const tpDateOk = !!tp && passesPlatformDateFilter(d, 'tp', dateFrom, dateTo);
  const agDateOk = !!ag && passesPlatformDateFilter(d, 'ag', dateFrom, dateTo);
  const cgDateOk = !!cg && passesPlatformDateFilter(d, 'cg', dateFrom, dateTo);
  const woDateOk = !!wo && passesPlatformDateFilter(d, 'wo', dateFrom, dateTo);
  const genericInRange = !!generic && ((!dateFrom && !dateTo) || inDateRange(d, dateFrom ?? '', dateTo ?? ''));

  const tpOk = tpDateOk && !isPlatformFlagged('tp');
  const agOk = agDateOk && !isPlatformFlagged('ag');
  const cgOk = cgDateOk && !isPlatformFlagged('cg');
  const woOk = woDateOk && !isPlatformFlagged('wo');

  const platformOutcome = (ok: boolean, value: string): 'live' | 'removed' | null => {
    if (!ok) return null;
    if (isLiveStatus(value)) return 'live';
    if (isRemovedStatus(value)) return 'removed';
    return null;
  };

  const platformValue: Record<'tp' | 'ag' | 'cg' | 'wo', string> = { tp, ag, cg, wo };
  const platformOk: Record<'tp' | 'ag' | 'cg' | 'wo', boolean> = { tp: tpOk, ag: agOk, cg: cgOk, wo: woOk };

  // Union the selected platforms' own date/flag-gated status values into the
  // same statuses array the omitted-filter (all-platform) branch already
  // used — this is the combined-total rule: a row counts as live if ANY
  // selected platform's status says so.
  const statuses: string[] = platformFilter?.length
    ? platformFilter
        .map((p) => (platformOk[p] ? platformValue[p] : ''))
        .filter(Boolean)
    : [
        tpOk ? tp : '',
        agOk ? ag : '',
        cgOk ? cg : '',
        woOk ? wo : '',
        genericInRange ? generic : '',
      ].filter(Boolean);

  let overall: EntryClassification['overall'] = null;
  if (statuses.length > 0) {
    if (statuses.some(isLiveStatus)) overall = 'live';
    else if (statuses.some(isRemovedStatus)) overall = 'removed';
    else if (statuses.some(isDoneStatus)) overall = 'done';
    else if (statuses.some(isPendingStatus)) overall = 'pending';
    else if (statuses.some(isOnPauseStatus)) overall = 'onPause';
    else if (statuses.some(isNotDoneStatus)) overall = 'notDone';
  }

  return {
    tp: platformOutcome(tpOk, tp),
    ag: platformOutcome(agOk, ag),
    cg: platformOutcome(cgOk, cg),
    wo: platformOutcome(woOk, wo),
    overall,
  };
}

function filterByCountryAndProxy(entries: Entry[], tab: string, countryFilter?: string[], proxyFilter?: string[]): Entry[] {
  if (!countryFilter?.length && !proxyFilter?.length) return entries;
  return entries.filter((e) => {
    if (countryFilter?.length && !countryFilter.some((cf) => canonicalCountryKey(resolveCountryLabel(e.data, tab)) === canonicalCountryKey(cf))) return false;
    if (proxyFilter?.length && !proxyFilter.some((pf) => canonicalProxyKey(resolveProxyLabel(e.data['Proxy Used'])) === canonicalProxyKey(pf))) return false;
    return true;
  });
}

export function computeTabKpisFromEntries(
  entries: Entry[],
  rawHeaders: string[],
  tab: string,
  brandCol: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  removedPlatformBrands: Set<string>,
  countryFilter?: string[],
  proxyFilter?: string[],
  platformFilter?: Platform[],
): TabKpis | null {
  const cols = resolveReviewColumns(rawHeaders, tab);
  const { activePlatforms } = cols;

  // A tab is excluded only if it tracks NONE of the selected platforms — it's
  // included (and scoped to just the tracked subset below) if it tracks at
  // least one, which is what makes "TP + AG selected" a combined total
  // rather than an intersection.
  if (platformFilter?.length && !platformFilter.some((p) => activePlatforms.includes(p))) {
    return null;
  }

  let live = 0, removed = 0, done = 0, pending = 0, onPause = 0, notDone = 0;
  let tpLive = 0, tpRemoved = 0;
  let agLive = 0, agRemoved = 0;
  let cgLive = 0, cgRemoved = 0;
  let woLive = 0, woRemoved = 0;

  const filteredEntries = filterByCountryAndProxy(entries, tab, countryFilter, proxyFilter);

  const countries = uniqueDisplayValues(entries.map((e) => resolveCountryLabel(e.data, tab)), canonicalCountryKey, canonicalCountryName);
  const proxies = uniqueDisplayValues(entries.map((e) => resolveProxyLabel(e.data['Proxy Used'])), canonicalProxyKey, canonicalProxyName);
  const byCountry: Record<string, CountBreakdown> = {};
  const byProxy: Record<string, CountBreakdown> = {};

  for (const entry of filteredEntries) {
    const d = entry.data;
    const c = classifyEntry(d, tab, brandCol, cols, dateFrom, dateTo, removedPlatformBrands, platformFilter);

    if (c.tp === 'live') tpLive++; else if (c.tp === 'removed') tpRemoved++;
    if (c.ag === 'live') agLive++; else if (c.ag === 'removed') agRemoved++;
    if (c.cg === 'live') cgLive++; else if (c.cg === 'removed') cgRemoved++;
    if (c.wo === 'live') woLive++; else if (c.wo === 'removed') woRemoved++;

    if (c.overall === 'live') {
      live++;
      addToBreakdown(byCountry, resolveCountryLabel(d, tab), 'live', canonicalCountryKey, canonicalCountryName);
      addToBreakdown(byProxy, resolveProxyLabel(d['Proxy Used']), 'live', canonicalProxyKey, canonicalProxyName);
    } else if (c.overall === 'removed') {
      removed++;
      addToBreakdown(byCountry, resolveCountryLabel(d, tab), 'removed', canonicalCountryKey, canonicalCountryName);
      addToBreakdown(byProxy, resolveProxyLabel(d['Proxy Used']), 'removed', canonicalProxyKey, canonicalProxyName);
    }
    else if (c.overall === 'done') done++;
    else if (c.overall === 'pending') pending++;
    else if (c.overall === 'onPause') onPause++;
    else if (c.overall === 'notDone') notDone++;
  }

  // activePlatforms drives which platform rows Overview renders per tab/brand
  // card — when a platform filter is active, only the selected platform(s)
  // should render, not every platform the tab structurally tracks.
  const visiblePlatforms = platformFilter?.length
    ? activePlatforms.filter((p) => platformFilter.includes(p))
    : activePlatforms;

  return {
    total: live + removed,
    live, removed, done, pending, onPause, notDone,
    tp: { live: tpLive, removed: tpRemoved },
    ag: { live: agLive, removed: agRemoved },
    cg: { live: cgLive, removed: cgRemoved },
    wo: { live: woLive, removed: woRemoved },
    activePlatforms: visiblePlatforms, byCountry, byProxy, countries, proxies,
  };
}

export async function fetchTabKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedPlatformBrands: Set<string> = new Set(),
  countryFilter?: string[],
  proxyFilter?: string[],
  platformFilter?: Platform[],
): Promise<TabKpis | null> {
  const [allEntries, rawHeaders] = await Promise.all([
    fetchAllTabEntries(tab),
    fetchTabHeaders(tab),
  ]);
  const brandCol = getBrandNameCol(tab);
  return computeTabKpisFromEntries(allEntries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter, proxyFilter, platformFilter);
}

// Same per-entry classification as computeTabKpisFromEntries, bucketed by
// brand name instead of collapsed into one tab-wide total — powers
// Overview's "Brands" view. Brand names are grouped case/whitespace-
// insensitively via normalizeBrandKey (the same key removed-platform-brand
// flags already match on), and the first-seen casing is kept as the display
// label. Sorted alphabetically for a stable, scannable list.
export function computeBrandKpisFromEntries(
  entries: Entry[],
  rawHeaders: string[],
  tab: string,
  brandCol: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  removedPlatformBrands: Set<string>,
  countryFilter?: string[],
  proxyFilter?: string[],
  platformFilter?: Platform[],
): { brand: string; kpis: BrandKpis }[] {
  const cols = resolveReviewColumns(rawHeaders, tab);
  const { activePlatforms } = cols;

  if (platformFilter?.length && !platformFilter.some((p) => activePlatforms.includes(p))) {
    return [];
  }

  const filteredEntries = filterByCountryAndProxy(entries, tab, countryFilter, proxyFilter);

  interface Bucket {
    label: string;
    live: number; removed: number;
    tpLive: number; tpRemoved: number;
    agLive: number; agRemoved: number;
    cgLive: number; cgRemoved: number;
    woLive: number; woRemoved: number;
    flaggedPlatforms: Set<Platform>;
  }
  const buckets = new Map<string, Bucket>();

  for (const entry of filteredEntries) {
    const d = entry.data;
    const brandRaw = (d[brandCol] ?? '').trim();
    if (!brandRaw) continue;

    const key = normalizeBrandKey(brandRaw);
    let bucket = buckets.get(key);
    if (!bucket) {
      // A brand's flagged platforms don't depend on any one row, so this is
      // computed once per brand rather than per entry.
      const flaggedPlatforms = new Set(
        activePlatforms.filter((p) => removedPlatformBrands.has(platformRemovedKey(tab, brandRaw, p))),
      );
      bucket = { label: brandRaw, live: 0, removed: 0, tpLive: 0, tpRemoved: 0, agLive: 0, agRemoved: 0, cgLive: 0, cgRemoved: 0, woLive: 0, woRemoved: 0, flaggedPlatforms };
      buckets.set(key, bucket);
    }

    const c = classifyEntry(d, tab, brandCol, cols, dateFrom, dateTo, removedPlatformBrands, platformFilter);
    if (c.tp === 'live') bucket.tpLive++; else if (c.tp === 'removed') bucket.tpRemoved++;
    if (c.ag === 'live') bucket.agLive++; else if (c.ag === 'removed') bucket.agRemoved++;
    if (c.cg === 'live') bucket.cgLive++; else if (c.cg === 'removed') bucket.cgRemoved++;
    if (c.wo === 'live') bucket.woLive++; else if (c.wo === 'removed') bucket.woRemoved++;
    if (c.overall === 'live') bucket.live++;
    else if (c.overall === 'removed') bucket.removed++;
  }

  // Same reasoning as computeTabKpisFromEntries: a brand card's rows should
  // only ever cover platforms actually selected by the filter, not every
  // platform the tab structurally tracks.
  const visiblePlatforms = platformFilter?.length
    ? activePlatforms.filter((p) => platformFilter.includes(p))
    : activePlatforms;

  return Array.from(buckets.values())
    // A brand whose every *visible* (filter-scoped) platform is flagged
    // page-removed has nothing left to show — drop it from the "Brands" view
    // entirely rather than rendering an empty card. A brand with only SOME
    // visible platforms flagged still shows, just without those specific
    // platform rows (below).
    .filter((b) => visiblePlatforms.some((p) => !b.flaggedPlatforms.has(p)))
    .map((b) => ({
      brand: b.label,
      kpis: {
        live: b.live, removed: b.removed,
        tp: { live: b.tpLive, removed: b.tpRemoved },
        ag: { live: b.agLive, removed: b.agRemoved },
        cg: { live: b.cgLive, removed: b.cgRemoved },
        wo: { live: b.woLive, removed: b.woRemoved },
        activePlatforms: visiblePlatforms.filter((p) => !b.flaggedPlatforms.has(p)),
      },
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
}

export async function fetchBrandKpis(
  tab: string,
  dateFrom?: string,
  dateTo?: string,
  removedPlatformBrands: Set<string> = new Set(),
  countryFilter?: string[],
  proxyFilter?: string[],
  platformFilter?: Platform[],
): Promise<{ brand: string; kpis: BrandKpis }[]> {
  const [allEntries, rawHeaders] = await Promise.all([
    fetchAllTabEntries(tab),
    fetchTabHeaders(tab),
  ]);
  const brandCol = getBrandNameCol(tab);
  return computeBrandKpisFromEntries(allEntries, rawHeaders, tab, brandCol, dateFrom, dateTo, removedPlatformBrands, countryFilter, proxyFilter, platformFilter);
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

// Email of the signed-in user, for attributing dashboard edits in the Log.
// Returns null if there's no session (shouldn't happen behind auth, but the
// column is nullable so unattributed edits degrade gracefully).
async function currentUserEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}

interface Actor {
  id: string | null;
  email: string | null;
}

// Session id + email in one call, for stamping delete_log/edit_log rows.
async function currentActor(): Promise<Actor> {
  const { data } = await supabase.auth.getSession();
  return { id: data.session?.user.id ?? null, email: data.session?.user.email ?? null };
}

// Snapshots a row into delete_log or edit_log immediately before it's
// deleted/updated, so it can be restored later.
async function logChange(
  table: 'delete_log' | 'edit_log',
  entityType: AuditEntityType,
  entityId: string,
  beforeData: object,
  actor: Actor,
  tab?: string,
): Promise<void> {
  const { error } = await supabase.from(table).insert({
    entity_type: entityType,
    entity_id: entityId,
    tab: tab ?? null,
    before_data: beforeData,
    actor_id: actor.id,
    actor_email: actor.email ?? '',
  });
  if (error) throw error;
}

// Upserts whichever credential fields are actually present in `credentials`
// (a field is absent, not merely null, when that tab has no header for it at
// all — see extractCredentials) — columns omitted from the upsert payload
// keep their existing stored value rather than being reset, so a save on one
// tab can never wipe a concept only some other tab's entries carry.
async function upsertEntryCredentials(
  entryId: string,
  tab: string,
  credentials: EntryCredentials,
  client: SupabaseClient = supabase,
): Promise<void> {
  if (Object.keys(credentials).length === 0) return;
  const { error } = await client
    .from('entry_credentials')
    .upsert({ entry_id: entryId, tab, ...credentials, updated_at: new Date().toISOString() }, { onConflict: 'entry_id' });
  if (error) throw error;
}

// Paginates in 1 000-row batches like fetchAllTabEntries above — a tab with
// more than 1 000 entries (e.g. Rooster Partners' 1791) would otherwise be
// silently truncated to Postgrest's default page size, dropping whichever
// rows happen to sort past the cutoff. Caught live: an unpaginated version of
// this function shipped first and silently omitted a real entry's credentials
// on exactly this tab.
export async function fetchEntryCredentials(tab: string, client: SupabaseClient = supabase): Promise<Record<string, EntryCredentials>> {
  const PAGE = 1000;
  const all: (EntryCredentials & { entry_id: string })[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from('entry_credentials')
      .select('entry_id, password, casino_password, backup_codes, authenticator_backup, ag_password, cg_password')
      .eq('tab', tab)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as (EntryCredentials & { entry_id: string })[]));
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }
  const byEntryId: Record<string, EntryCredentials> = {};
  for (const row of all) {
    const { entry_id, ...rest } = row;
    byEntryId[entry_id] = rest;
  }
  return byEntryId;
}

export async function updateEntryData(
  id: string,
  tab: string,
  fields: Record<string, string | null>,
): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const actor = await currentActor();
  await logChange('edit_log', 'entry', id, existing, actor, existing.tab as string);

  // Credential-shaped fields never reach entries.data (public via the anon
  // key) — they're upserted into entry_credentials instead. Without this,
  // every Edit Entry save (which resends the full form, including whatever
  // the credential inputs currently hold) would write them straight back
  // into the public table on the very next edit.
  const { credentials, rest } = extractCredentials(fields);
  const mergedData = { ...(existing.data as Record<string, string | null>), ...rest };
  const syncTag = crypto.randomUUID();
  const { error: upErr } = await supabase
    .from('entries')
    .update({ data: mergedData, last_edited_by: 'dashboard', last_edited_email: actor.email, last_sync_tag: syncTag })
    .eq('id', id);
  if (upErr) throw upErr;

  await upsertEntryCredentials(id, tab, credentials);
  invalidateTabCache(tab);
}

export interface EntryReviewAnalysisRow {
  entry_id: string;
  platform: Platform;
  analysis: ReviewRemovalAssessmentResult;
  evidence: RemovalEvidence;
  hash: string;
  model: string;
  analyzed_at: string;
}

// Caches a generated AI Review Removal Assessment, one row per (entry, platform) — a
// multi-platform entry (Rooster Partners, Revolution Casino, SilverPlay, Hanan) can have
// independent cached analyses for TP/AG/CG without one overwriting another. Deliberately
// not routed through logChange/edit_log — this is a derived/cached artifact regenerated
// from the entry's own existing fields, not a user edit to business data.
export async function saveReviewAnalysis(
  entryId: string,
  tab: string,
  platform: Platform,
  analysis: ReviewRemovalAssessmentResult,
  evidence: RemovalEvidence,
  hash: string,
  model: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client
    .from('entry_review_analyses')
    .upsert(
      { entry_id: entryId, tab, platform, analysis, evidence, hash, model, analyzed_at: new Date().toISOString() },
      { onConflict: 'entry_id,platform' },
    );
  if (error) throw error;
  invalidateTabCache(tab);
}

export async function fetchEntryReviewAnalyses(tab: string, client: SupabaseClient = supabase): Promise<EntryReviewAnalysisRow[]> {
  const { data, error } = await client
    .from('entry_review_analyses')
    .select('entry_id, platform, analysis, evidence, hash, model, analyzed_at')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as EntryReviewAnalysisRow[];
}

export async function updateMentionStatus(id: string, status: MentionStatus): Promise<void> {
  // Read existing entry to get current data blob, tab, and sheet_row_id.
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const actor = await currentActor();
  await logChange('edit_log', 'entry', id, existing, actor, existing.tab as string);

  const mergedData = {
    ...(existing.data as Record<string, string | null>),
    status,
  };

  const syncTag = crypto.randomUUID();
  const { error: upErr } = await supabase
    .from('entries')
    .update({ data: mergedData, last_edited_by: 'dashboard', last_edited_email: actor.email, last_sync_tag: syncTag })
    .eq('id', id);
  if (upErr) throw upErr;
}

export async function insertEntry(
  tab: string,
  fields: Record<string, string | null>,
): Promise<void> {
  const sheetRowId = `dashboard-${crypto.randomUUID()}`;
  const syncTag = crypto.randomUUID();
  // See updateEntryData's matching comment — credential-shaped fields go to
  // entry_credentials, never into entries.data.
  const { credentials, rest } = extractCredentials(fields);
  const { data: inserted, error } = await supabase
    .from('entries')
    .insert({
      tab,
      sheet_row_id: sheetRowId,
      data: rest,
      last_edited_by: 'dashboard',
      last_edited_email: await currentUserEmail(),
      last_sync_tag: syncTag,
    })
    .select('id')
    .single();
  if (error) throw error;
  await upsertEntryCredentials(inserted.id, tab, credentials);
  invalidateTabCache(tab);
}

export async function deleteEntries(ids: string[], tab: string): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('*')
    .in('id', ids);
  if (selErr) throw selErr;

  const actor = await currentActor();
  if (existing && existing.length > 0) {
    const { error: logErr } = await supabase.from('delete_log').insert(
      existing.map((row) => ({
        entity_type: 'entry' as const,
        entity_id: row.id,
        tab: row.tab,
        before_data: row,
        actor_id: actor.id,
        actor_email: actor.email ?? '',
      })),
    );
    if (logErr) throw logErr;
  }

  const { error } = await supabase.from('entries').delete().in('id', ids);
  if (error) throw error;
  invalidateTabCache(tab);
}

export async function moveEntryToTab(id: string, oldTab: string, newTab: string): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const actor = await currentActor();
  await logChange('edit_log', 'entry', id, existing, actor, oldTab);

  const { error } = await supabase.from('entries').update({ tab: newTab }).eq('id', id);
  if (error) throw error;
  // Keep entry_credentials.tab (denormalized for fetchEntryCredentials'
  // per-tab lookup) from silently going stale — a no-op if this entry has no
  // credentials row at all.
  await supabase.from('entry_credentials').update({ tab: newTab }).eq('entry_id', id);
  invalidateTabCache(oldTab);
  invalidateTabCache(newTab);
}

// Toggle-off is a hard DELETE and toggle-on is a fresh INSERT/upsert — so
// removed_by/removed_at always reflect the most recent (re-)flagging, not the
// original flagger/time; re-enabling loses that history. Accepted tradeoff of
// the "row existence = flagged" model (see the migration's header comment),
// not a bug. Also: if a brand is renamed on the same Edit Entry save that also
// toggles the flag, the flag is written against the *new* name — the old
// name's flag row (if any) is left untouched. Accepted, documented limitation;
// no rename-detection logic is planned for it.
//
// Matching is done via the generated `brand_key` column (lower+trim of
// `brand`, see the 20260729140000 migration), not the raw `brand` value —
// this mirrors platformRemovedKey in src/lib/removedPlatformBrands.ts so a
// stored brand value that differs only in case/whitespace from the one
// passed in here still matches the existing row instead of silently no-oping.
export async function setBrandPlatformRemoved(tab: string, brand: string, platform: Platform, removed: boolean): Promise<void> {
  const brandKey = normalizeBrandKey(brand);
  if (removed) {
    const { error } = await supabase
      .from('removed_platform_brands')
      .upsert({ tab, brand, platform, removed_by: await currentUserEmail() }, { onConflict: 'tab,brand_key,platform' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('removed_platform_brands')
      .delete()
      .eq('tab', tab)
      .eq('brand_key', brandKey)
      .eq('platform', platform);
    if (error) throw error;
  }
}

export interface BrandPlatformOverride {
  tab: string;
  brand_key: string;
  platform: Platform;
  override_state: 'pause' | 'active';
  // Who set the override (currentUserEmail() at set time) — surfaced in the
  // Schedule Planner tooltip so a forced pause/active can say who forced it,
  // not just that it's forced.
  set_by: string | null;
}

export async function fetchBrandPlatformOverrides(tab: string, client: SupabaseClient = supabase): Promise<BrandPlatformOverride[]> {
  const { data, error } = await client
    .from('brand_platform_override')
    .select('tab, brand_key, platform, override_state, set_by')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as BrandPlatformOverride[];
}

export async function setBrandPlatformOverride(tab: string, brand: string, platform: Platform, state: 'pause' | 'active'): Promise<void> {
  const { error } = await supabase
    .from('brand_platform_override')
    .upsert({ tab, brand, platform, override_state: state, set_by: await currentUserEmail() }, { onConflict: 'tab,brand_key,platform' });
  if (error) throw error;
}

export async function clearBrandPlatformOverride(tab: string, brandKey: string, platform: Platform): Promise<void> {
  const { error } = await supabase
    .from('brand_platform_override')
    .delete()
    .eq('tab', tab)
    .eq('brand_key', brandKey)
    .eq('platform', platform);
  if (error) throw error;
}

export async function fetchBrandSchedule(tab: string, weekStart: string, client: SupabaseClient = supabase): Promise<BrandScheduleRow[]> {
  const { data, error } = await client
    .from('brand_schedule')
    .select('tab, brand_key, week_start, platform, monday, tuesday, wednesday, thursday, friday')
    .eq('tab', tab)
    .eq('week_start', weekStart);
  if (error) throw error;
  return (data ?? []) as BrandScheduleRow[];
}

// Upserts on (tab, brand_key, platform, week_start) — only the one `day`
// column (plus updated_at) is included in the payload, so PostgREST's
// generated ON CONFLICT ... DO UPDATE SET only touches that column, leaving
// the other four weekdays on that row exactly as they were. `platform` is
// always a real platform here — manual clicks (the only caller) always
// target one specific platform's cell, never a legacy platform-less row.
export async function setBrandScheduleDay(
  tab: string,
  brand: string,
  weekStart: string,
  platform: Platform,
  day: Weekday,
  status: DayStatus,
): Promise<void> {
  const { error } = await supabase
    .from('brand_schedule')
    .upsert(
      { tab, brand, week_start: weekStart, platform, [day]: status, updated_at: new Date().toISOString() },
      { onConflict: 'tab,brand_key,platform,week_start' },
    );
  if (error) throw error;
}

// Bulk-writes generation output in one round trip. Each row supplies all
// five day columns (nulls included) so a freshly-generated row is written in
// full, unlike setBrandScheduleDay's single-column partial upsert.
export async function bulkUpsertBrandSchedule(rows: BrandScheduleUpsertRow[], client: SupabaseClient = supabase): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client
    .from('brand_schedule')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'tab,brand_key,platform,week_start' },
    );
  if (error) throw error;
}

export interface BrandPlatformPause {
  tab: string;
  brand_key: string;
  platform: Platform;
  paused_week_start: string;
  reason: string;
}

export async function fetchActiveBrandPlatformPauses(tab: string, client: SupabaseClient = supabase): Promise<BrandPlatformPause[]> {
  const { data, error } = await client
    .from('brand_platform_pause')
    .select('tab, brand_key, platform, paused_week_start, reason')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as BrandPlatformPause[];
}

export async function upsertBrandPlatformPause(
  tab: string,
  brand: string,
  platform: Platform,
  pausedWeekStart: string,
  reason: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client
    .from('brand_platform_pause')
    .upsert(
      { tab, brand, platform, paused_week_start: pausedWeekStart, reason },
      { onConflict: 'tab,brand_key,platform' },
    );
  if (error) throw error;
}

export async function deleteBrandPlatformPause(tab: string, brandKey: string, platform: Platform, client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client
    .from('brand_platform_pause')
    .delete()
    .eq('tab', tab)
    .eq('brand_key', brandKey)
    .eq('platform', platform);
  if (error) throw error;
}

export interface SchedulePmsLink {
  id: string;
  tab: string;
  brand: string;
  brand_key: string;
  platform: Platform;
  date: string;
  pms_task_id: string;
  synced_status: string;
}

export async function fetchSchedulePmsLinks(tab: string, client: SupabaseClient = supabase): Promise<SchedulePmsLink[]> {
  const { data, error } = await client
    .from('schedule_pms_links')
    .select('id, tab, brand, brand_key, platform, date, pms_task_id, synced_status')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as SchedulePmsLink[];
}

export async function insertSchedulePmsLink(
  tab: string,
  brand: string,
  platform: Platform,
  date: string,
  pmsTaskId: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client
    .from('schedule_pms_links')
    .insert({ tab, brand, platform, date, pms_task_id: pmsTaskId });
  if (error) throw error;
}

export async function updateSchedulePmsLinkDate(id: string, date: string, client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client.from('schedule_pms_links').update({ date }).eq('id', id);
  if (error) throw error;
}

export async function updateSchedulePmsLinkStatus(id: string, status: string, client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client.from('schedule_pms_links').update({ synced_status: status }).eq('id', id);
  if (error) throw error;
}

export async function deleteSchedulePmsLink(id: string, client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client.from('schedule_pms_links').delete().eq('id', id);
  if (error) throw error;
}

// Cheap stand-in for "has anything changed for this tab since we last
// resolved it" -- entries_tab_updated_idx (schema.sql) makes this an
// index-only scan, unlike fetchAllTabEntries's full `select *` jsonb pull.
// Returns null when the tab has no entries at all.
export async function fetchTabEntriesWatermark(tab: string, client: SupabaseClient = supabase): Promise<string | null> {
  const { data, error } = await client
    .from('entries')
    .select('updated_at')
    .eq('tab', tab)
    .order('updated_at', { ascending: false })
    .range(0, 0);
  if (error) throw error;
  return (data ?? [])[0]?.updated_at ?? null;
}

export async function fetchSyncWatermark(tab: string, client: SupabaseClient = supabase): Promise<string | null> {
  const { data, error } = await client
    .from('schedule_pms_sync_watermarks')
    .select('last_seen_max_updated_at')
    .eq('tab', tab)
    .maybeSingle();
  if (error) throw error;
  return data?.last_seen_max_updated_at ?? null;
}

export async function upsertSyncWatermark(tab: string, value: string, client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client.from('schedule_pms_sync_watermarks').upsert({ tab, last_seen_max_updated_at: value }, { onConflict: 'tab' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// TP/AG/CG/WO review status check triggers
// ---------------------------------------------------------------------------

// Every field mirrors one of the dashboard's own multi-select filter dropdowns
// — set to opt into re-checking entries a platform normally skips (e.g.
// statusFilters:['live'] re-checks Published entries for a Published ->
// Removed transition) or to scope a check to exactly what's currently
// filtered in the table. Each field matches an entry if it hits ANY of the
// given values (OR within a field, AND across fields) — same semantics as the
// dashboard's own filter chain. Omit a field (or the whole object) for the
// platform's normal default sweep.
export interface StatusCheckScope {
  includePublished?: boolean;
  statusFilters?: string[];
  brands?: string[];
  agents?: string[];
  proxies?: string[];
  countries?: string[];
  // 'YYYY-MM-DD', same shape the dashboard's own DatePicker/dateFrom+dateTo
  // state already uses. Matched against the platform's own post-date column
  // (mirrors passesPlatformDateFilter in scoreSummary.ts) — an entry with no
  // date, or an unparseable one, is still included rather than excluded.
  dateFrom?: string;
  dateTo?: string;
}

function statusCheckBody(tab: string, scope: StatusCheckScope, extra?: Record<string, unknown>) {
  return {
    tab,
    include_published: scope.includePublished ?? false,
    status_filters: scope.statusFilters,
    brands: scope.brands,
    agents: scope.agents,
    proxies: scope.proxies,
    countries: scope.countries,
    date_from: scope.dateFrom,
    date_to: scope.dateTo,
    ...extra,
  };
}

// A 504 here means whatever fronts status_server.py (ngrok/load balancer) gave
// up waiting for a response — it says nothing about the check itself. The
// check runs synchronously and only releases _global_run_lock when the scrape
// truly finishes, so a large/unscoped run can easily outlast the proxy's
// timeout while still succeeding server-side. Callers should treat this
// distinctly from a real app-level failure (409 already-running, 500, etc.),
// since /active-checks will correctly keep reporting it as running.
export class StatusCheckTimeoutError extends Error {}
const STATUS_CHECK_TIMEOUT_MESSAGE =
  'No response — the request timed out waiting for the server, but the check may still be running in the background.';

export async function triggerStatusCheck(
  tab: string,
  scope: StatusCheckScope = {},
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number; skipped_group?: number }> {
  if (!CHECK_STATUS_URL) {
    throw new Error(
      'VITE_CHECK_STATUS_URL is not configured — check .env',
    );
  }
  const res = await fetch(CHECK_STATUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHECK_STATUS_TOKEN || SUPABASE_ANON_KEY}`,
      // Skip ngrok's free-tier browser-warning interstitial so we always get JSON.
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify(statusCheckBody(tab, scope)),
  });
  if (!res.ok) {
    if (res.status === 504) throw new StatusCheckTimeoutError(STATUS_CHECK_TIMEOUT_MESSAGE);
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Status check failed: HTTP ${res.status}`);
  }
  invalidateTabCache(tab);
  return res.json();
}

export async function triggerAgStatusCheck(
  tab: string,
  scope: StatusCheckScope = {},
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number; skipped_group?: number }> {
  if (!CHECK_AG_STATUS_URL) throw new Error('VITE_CHECK_AG_STATUS_URL (or VITE_CHECK_STATUS_URL) is not configured — check .env');
  const res = await fetch(CHECK_AG_STATUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHECK_STATUS_TOKEN || SUPABASE_ANON_KEY}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify(statusCheckBody(tab, scope, { platform: 'ag' })),
  });
  if (!res.ok) {
    if (res.status === 504) throw new StatusCheckTimeoutError(STATUS_CHECK_TIMEOUT_MESSAGE);
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  invalidateTabCache(tab);
  return res.json();
}

export async function triggerCgStatusCheck(
  tab: string,
  scope: StatusCheckScope = {},
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number; skipped_group?: number }> {
  if (!CHECK_AG_STATUS_URL) throw new Error('VITE_CHECK_AG_STATUS_URL (or VITE_CHECK_STATUS_URL) is not configured — check .env');
  const res = await fetch(CHECK_AG_STATUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHECK_STATUS_TOKEN || SUPABASE_ANON_KEY}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify(statusCheckBody(tab, scope, { platform: 'cg' })),
  });
  if (!res.ok) {
    if (res.status === 504) throw new StatusCheckTimeoutError(STATUS_CHECK_TIMEOUT_MESSAGE);
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  invalidateTabCache(tab);
  return res.json();
}

export async function triggerWoStatusCheck(
  tab: string,
  scope: StatusCheckScope = {},
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number; skipped_group?: number }> {
  if (!CHECK_AG_STATUS_URL) throw new Error('VITE_CHECK_AG_STATUS_URL (or VITE_CHECK_STATUS_URL) is not configured — check .env');
  const res = await fetch(CHECK_AG_STATUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CHECK_STATUS_TOKEN || SUPABASE_ANON_KEY}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify(statusCheckBody(tab, scope, { platform: 'wo' })),
  });
  if (!res.ok) {
    if (res.status === 504) throw new StatusCheckTimeoutError(STATUS_CHECK_TIMEOUT_MESSAGE);
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  invalidateTabCache(tab);
  return res.json();
}

export async function getActiveChecks(): Promise<string[]> {
  const poll = async (baseUrl: string) => {
    if (!baseUrl) return [];
    try {
      const res = await fetch(`${baseUrl}/active-checks`, {
        headers: {
          Authorization: `Bearer ${CHECK_STATUS_TOKEN || SUPABASE_ANON_KEY}`,
          'ngrok-skip-browser-warning': 'true',
        },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.active ?? []) as string[];
    } catch {
      return [];
    }
  };

  const [tp, ag] = await Promise.all([
    poll(CHECK_STATUS_BASE_URL),
    CHECK_AG_STATUS_BASE_URL !== CHECK_STATUS_BASE_URL ? poll(CHECK_AG_STATUS_BASE_URL) : Promise.resolve([] as string[]),
  ]);
  return [...new Set([...tp, ...ag])];
}

// Mirrors status_server.py's `tab_key` construction exactly (see check_status()/
// check_ag_status()/check_cg_status()/check_wo_status()) — TP keeps its legacy
// bare-tab key, AG/CG/WO are namespaced by platform. Used to match this tab's own
// entries in getActiveChecks()'s result so the UI can tell whether a check it (or
// another session) started is still running server-side, independent of whether
// the client that triggered it is still around to see its own request resolve.
export function statusCheckTabKeys(tab: string, platforms: ('tp' | 'ag' | 'cg' | 'wo')[]): string[] {
  return platforms.map((p) => (p === 'tp' ? tab || '__all__' : `${p}__${tab || '__all__'}`));
}

// ---------------------------------------------------------------------------
// Admin — profile management
// ---------------------------------------------------------------------------

export async function getProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, 'approved' | 'role' | 'sso_provisioned'>>,
): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Account not found — it may have been deleted.');

  const actor = await currentActor();
  await logChange('edit_log', 'account', id, existing, actor);

  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteProfile(id: string): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Account not found — it may already be deleted.');

  const actor = await currentActor();
  await logChange('delete_log', 'account', id, existing, actor);

  const { error, count } = await supabase
    .from('profiles')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) throw error;
  if (count === 0) throw new Error('Delete had no effect — the "admins can delete profiles" RLS policy may not be applied in your Supabase project.');
}

export type AdminAction = 'approve' | 'revoke' | 'remove' | 'make_admin' | 'remove_admin';

export interface AdminLogEvent {
  id: string;
  actor_email: string;
  action: AdminAction;
  target_email: string;
  created_at: string;
}

export async function insertAdminLog(
  actorId: string,
  actorEmail: string,
  action: AdminAction,
  targetEmail: string,
): Promise<void> {
  const { error } = await supabase
    .from('admin_logs')
    .insert({ actor_id: actorId, actor_email: actorEmail, action, target_email: targetEmail });
  if (error) throw error;
}

export async function fetchAdminLogs(limit = 50): Promise<AdminLogEvent[]> {
  const { data, error } = await supabase
    .from('admin_logs')
    .select('id, actor_email, action, target_email, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AdminLogEvent[];
}

export async function uploadAvatar(userId: string, file: Blob): Promise<string> {
  const path = `${userId}/avatar`;
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '0' });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function updateOwnAvatar(avatarUrl: string): Promise<void> {
  const { error } = await supabase.rpc('update_own_avatar', { new_avatar_url: avatarUrl });
  if (error) throw error;
}

export async function fetchEditLog(limit = 200): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('edit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditLogEntry[];
}

export async function fetchDeleteLog(limit = 200): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('delete_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditLogEntry[];
}

export interface WatchdogEvent {
  id: string;
  occurred_at: string;
  outcome: 'restarted' | 'restart_failed';
  detail: string;
}

export async function fetchWatchdogEvents(limit = 50): Promise<WatchdogEvent[]> {
  const { data, error } = await supabase
    .from('watchdog_events')
    .select('id, occurred_at, outcome, detail')
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WatchdogEvent[];
}

export async function restoreDeletedEntity(logId: string): Promise<void> {
  const { data: log, error: selErr } = await supabase
    .from('delete_log')
    .select('*')
    .eq('id', logId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!log) throw new Error('Log entry not found.');
  if (log.restored_at) throw new Error('This item has already been restored.');

  const actor = await currentActor();
  const table = log.entity_type === 'account' ? 'profiles' : log.entity_type === 'tab' ? 'custom_tabs' : 'entries';

  // Accounts and tabs have no sync-related bookkeeping fields, so the
  // snapshot can be reinserted verbatim. Entries do — restoring should
  // refresh those to reflect the restore happening now, not backdate them to
  // the deleted row's old state (same rationale as restoreEditedEntity).
  const insertPayload =
    log.entity_type === 'account' || log.entity_type === 'tab'
      ? log.before_data
      : {
          ...(log.before_data as Record<string, unknown>),
          updated_at: new Date().toISOString(),
          last_edited_by: 'dashboard',
          last_edited_email: actor.email,
          last_sync_tag: crypto.randomUUID(),
        };

  const { error: insErr } = await supabase.from(table).insert(insertPayload);
  if (insErr) throw insErr;

  const { error: updErr, count } = await supabase
    .from('delete_log')
    .update({ restored_at: new Date().toISOString(), restored_by_email: actor.email }, { count: 'exact' })
    .eq('id', logId)
    .is('restored_at', null);
  if (updErr) throw updErr;
  if (!count) throw new Error('This item was already restored by someone else.');

  if (log.entity_type === 'entry') invalidateTabCache(log.tab as string);
}

export async function restoreEditedEntity(logId: string): Promise<void> {
  const { data: log, error: selErr } = await supabase
    .from('edit_log')
    .select('*')
    .eq('id', logId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!log) throw new Error('Log entry not found.');
  if (log.restored_at) throw new Error('This item has already been restored.');

  const table = log.entity_type === 'account' ? 'profiles' : 'entries';
  const { data: current, error: curErr } = await supabase
    .from(table)
    .select('*')
    .eq('id', log.entity_id)
    .maybeSingle();
  if (curErr) throw curErr;
  if (!current) throw new Error('This row no longer exists — restore the delete first.');

  const actor = await currentActor();

  // Snapshot the state right before the restore so the restore itself can be undone later.
  await logChange('edit_log', log.entity_type as AuditEntityType, log.entity_id, current, actor, log.tab ?? undefined);

  // Only revert the fields an edit can actually change — never blindly copy
  // back sync-internal bookkeeping (last_sync_tag, updated_at, sheet_row_id):
  // an old last_sync_tag could confuse the Sheet sync's echo-loop protection,
  // and updated_at should reflect the restore happening now, not the past.
  const beforeData = log.before_data as Record<string, unknown>;
  const patchFields =
    log.entity_type === 'account'
      ? { approved: beforeData.approved, role: beforeData.role }
      : {
          data: beforeData.data,
          tab: beforeData.tab,
          updated_at: new Date().toISOString(),
          last_edited_by: 'dashboard',
          last_edited_email: actor.email,
        };

  const { error: restoreErr } = await supabase
    .from(table)
    .update(patchFields)
    .eq('id', log.entity_id);
  if (restoreErr) throw restoreErr;

  const { error: updErr, count } = await supabase
    .from('edit_log')
    .update({ restored_at: new Date().toISOString(), restored_by_email: actor.email }, { count: 'exact' })
    .eq('id', logId)
    .is('restored_at', null);
  if (updErr) throw updErr;
  if (!count) throw new Error('This item was already restored by someone else.');

  if (log.entity_type === 'entry') {
    invalidateTabCache(current.tab as string);
    invalidateTabCache(beforeData.tab as string);
  }
}

export interface CustomTabRow {
  name: string;
  platforms: DynamicTabPlatform[];
}

export async function fetchCustomTabs(client: SupabaseClient = supabase): Promise<CustomTabRow[]> {
  const { data, error } = await client.from('custom_tabs').select('name, platforms');
  if (error) throw error;
  return (data ?? []) as CustomTabRow[];
}

export async function createCustomTab(
  name: string,
  platforms: DynamicTabPlatform[],
  enabledFilters?: ToolbarFilterKey[],
): Promise<void> {
  const actor = await currentActor();
  const { error } = await supabase
    .from('custom_tabs')
    .insert({ name, platforms, created_by: actor.email });
  if (error) {
    if (error.code === '23505') throw new Error(`A tab named "${name}" already exists.`);
    throw error;
  }
  // Only write a tab_toolbar_filters row when the creator actually narrowed
  // from the default — keeps the table sparse, matching tab_hidden_platforms'
  // "no row means default" shape, and means most tab creations (which never
  // touch this section of the modal) write nothing extra at all.
  if (enabledFilters && !isDefaultFilterSet(enabledFilters)) {
    await setToolbarFilters(name, enabledFilters);
  }
}

function isDefaultFilterSet(filters: ToolbarFilterKey[]): boolean {
  return filters.length === ALL_TOOLBAR_FILTERS.length
    && ALL_TOOLBAR_FILTERS.every((f) => filters.includes(f));
}

// Updates which platforms a dynamic Brand Tab tracks. Never touches
// `entries.data` — a removed platform's columns simply stop being generated
// by buildDynamicTabColumns (dynamicTabRegistry.ts), so any values already
// saved under them are preserved but hidden, and reappear if the platform is
// re-added later. Callers must also call registerDynamicTabs([{ name,
// platforms }]) afterward to refresh the in-memory column registry for the
// current session — this function only writes the DB row.
export async function updateCustomTabPlatforms(name: string, platforms: DynamicTabPlatform[]): Promise<void> {
  const { error } = await supabase
    .from('custom_tabs')
    .update({ platforms })
    .eq('name', name);
  if (error) throw error;
}

export async function renameCustomTab(oldName: string, newName: string): Promise<void> {
  const { error } = await supabase.rpc('rename_custom_tab', { old_name: oldName, new_name: newName });
  if (error) throw error;
}

export interface ToolbarFilterRow {
  tab: string;
  enabled_filters: ToolbarFilterKey[];
}

export async function fetchToolbarFilters(client: SupabaseClient = supabase): Promise<ToolbarFilterRow[]> {
  const { data, error } = await client.from('tab_toolbar_filters').select('tab, enabled_filters');
  if (error) throw error;
  return (data ?? []) as ToolbarFilterRow[];
}

export async function setToolbarFilters(tab: string, enabledFilters: ToolbarFilterKey[]): Promise<void> {
  const { error } = await supabase
    .from('tab_toolbar_filters')
    .upsert({ tab, enabled_filters: enabledFilters, updated_by: await currentUserEmail() }, { onConflict: 'tab' });
  if (error) throw error;
}

export async function archiveTab(tab: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('tab_archive_log')
    .insert({ tab, reason, actor_email: (await currentUserEmail()) ?? '' });
  if (error) {
    if (error.code === '23505') throw new Error(`"${tab}" is already archived.`);
    throw error;
  }
}

export async function unarchiveTab(logId: string): Promise<void> {
  const actorEmail = await currentUserEmail();
  const { error, count } = await supabase
    .from('tab_archive_log')
    .update({ restored_at: new Date().toISOString(), restored_by_email: actorEmail }, { count: 'exact' })
    .eq('id', logId)
    .is('restored_at', null);
  if (error) throw error;
  if (!count) throw new Error('This tab has already been unarchived.');
}

export interface ArchivedTabRow {
  tab: string;
}

export async function fetchArchivedTabs(client: SupabaseClient = supabase): Promise<ArchivedTabRow[]> {
  const { data, error } = await client
    .from('tab_archive_log')
    .select('tab')
    .is('restored_at', null);
  if (error) throw error;
  return (data ?? []) as ArchivedTabRow[];
}

export interface TabArchivedEvent {
  id: string;
  tab: string;
  reason: string;
  actorEmail: string;
  createdAt: string;
  restoredAt: string | null;
  restoredByEmail: string | null;
}

export async function fetchRecentTabArchives(limit = 50): Promise<TabArchivedEvent[]> {
  const { data, error } = await supabase
    .from('tab_archive_log')
    .select('id, tab, reason, actor_email, created_at, restored_at, restored_by_email')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    tab: row.tab as string,
    reason: row.reason as string,
    actorEmail: row.actor_email as string,
    createdAt: row.created_at as string,
    restoredAt: (row.restored_at as string | null) ?? null,
    restoredByEmail: (row.restored_by_email as string | null) ?? null,
  }));
}

// Brand Tab Pause (docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md):
// a lightweight, reversible, current-state-only toggle -- deliberately
// distinct from archiveTab/unarchiveTab above (no reason, no history, no
// UPDATE policy on paused_tabs -- see that table's migration comment).
export async function pauseTab(tab: string): Promise<void> {
  const { error } = await supabase
    .from('paused_tabs')
    .insert({ tab, paused_by_email: (await currentUserEmail()) ?? '' });
  if (error && error.code !== '23505') throw error;
}

export async function unpauseTab(tab: string): Promise<void> {
  // Deliberately no affected-row check here, unlike some other delete
  // helpers in this file: an RLS-blocked delete and a legitimate no-op
  // (the tab was already unpaused) both return zero affected rows with no
  // error, and are indistinguishable at the API level -- the admin-only UI
  // gate (EditBrandTabModal.tsx) is the actual defense against the former.
  const { error } = await supabase
    .from('paused_tabs')
    .delete()
    .eq('tab', tab);
  if (error) throw error;
}

export interface PausedTabRow {
  tab: string;
}

export async function fetchPausedTabs(client: SupabaseClient = supabase): Promise<PausedTabRow[]> {
  const { data, error } = await client
    .from('paused_tabs')
    .select('tab');
  if (error) throw error;
  return (data ?? []) as PausedTabRow[];
}

export async function fetchHiddenTabPlatforms(client: SupabaseClient = supabase): Promise<{ tab: string; platform: Platform }[]> {
  const { data, error } = await client
    .from('tab_hidden_platforms')
    .select('tab, platform');
  if (error) throw error;
  return (data ?? []) as { tab: string; platform: Platform }[];
}

// Hides or un-hides one platform on one tab (any tab, though in practice
// only ever called for a hardcoded tab — a dynamic tab keeps using
// updateCustomTabPlatforms/registerDynamicTabs instead, see Task 236).
// Never touches entries.data: a hidden platform's columns still exist and
// still hold real data, they simply stop being reported by
// getTabPlatforms() (src/lib/tab-configs.ts) until un-hidden again.
export async function setTabPlatformHidden(tab: string, platform: Platform, hidden: boolean): Promise<void> {
  if (hidden) {
    const { error } = await supabase
      .from('tab_hidden_platforms')
      .upsert({ tab, platform, hidden_by: await currentUserEmail() }, { onConflict: 'tab,platform' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('tab_hidden_platforms')
      .delete()
      .eq('tab', tab)
      .eq('platform', platform);
    if (error) throw error;
  }
}
