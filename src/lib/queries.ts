import { supabase, SYNC_FUNCTION_URL, PUSH_TO_SHEET_URL, SUPABASE_ANON_KEY, CHECK_STATUS_URL } from './supabase';
import { inDateRange } from './dateUtils';
import type { Mention, MentionStatus } from '../types/mention';
import type { SyncRun } from '../types/sync';
import type { Entry } from '../types/entry';
import type { Profile } from '../types/profile';
import type { BrandEntry, TabKpis } from '../types/brand-entry';

// ---------------------------------------------------------------------------
// Adapter — maps an Entry row to the Mention shape the UI expects.
// Column names in `data` must match the exact headers from the Google Sheet.
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

export async function fetchSyncRuns(limit = 500): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from('sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SyncRun[];
}

export interface EditEvent {
  id: string;
  tab: string;
  account: string | null;
  updated_at: string;
}

export async function fetchRecentEdits(limit = 50): Promise<EditEvent[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('id, tab, data, updated_at')
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
      updated_at: row.updated_at as string,
    };
  });
}

export async function fetchAvailableTabs(): Promise<string[]> {
  const { data, error } = await supabase
    .from('tab_schemas')
    .select('tab')
    .order('tab', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.tab as string);
}

export async function fetchEntriesByTab(tab: string): Promise<BrandEntry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('tab', tab)
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
async function fetchAllTabEntries(tab: string): Promise<Entry[]> {
  const cached = tabEntryCache.get(tab);
  if (cached && Date.now() - cached.ts < TAB_CACHE_TTL) return cached.entries;

  const PAGE = 1000;
  const all: Entry[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
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

export async function fetchRawEntriesByTab(tab: string): Promise<Entry[]> {
  return fetchAllTabEntries(tab);
}

// Fetches every entry across every tab, paginated. Used by the Score Summary
// admin page which aggregates per-brand counts across all brand-group tabs.
export async function fetchAllEntries(): Promise<Entry[]> {
  const PAGE = 1000;
  const all: Entry[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as Entry[]));
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function fetchTabHeaders(tab: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('tab_schemas')
    .select('headers')
    .eq('tab', tab)
    .maybeSingle();
  if (error) throw error;
  const headers = (data?.headers ?? []) as string[];
  return headers.filter((h) => h !== 'id' && h !== 'last_sync_tag' && h !== '');
}

function isLiveStatus(s: string) {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}
function isRemovedStatus(s: string) {
  return s.includes('remove') || s.includes('not pub') || s.includes('refused');
}
function isDoneStatus(s: string) { return s === 'done'; }
function isPendingStatus(s: string) { return s.includes('pending'); }
function isOnPauseStatus(s: string) { return s.includes('pause'); }
function isNotDoneStatus(s: string) { return s === 'not done' || s.includes('not done'); }

export async function fetchTabKpis(tab: string, dateFrom?: string, dateTo?: string): Promise<TabKpis> {
  const [allEntries, rawHeaders] = await Promise.all([
    fetchAllTabEntries(tab),
    fetchTabHeaders(tab),
  ]);

  const entries = (dateFrom || dateTo)
    ? allEntries.filter(e => inDateRange(e.data, dateFrom ?? '', dateTo ?? ''))
    : allEntries;

  // Resolve the actual sheet column name case-insensitively so minor casing
  // differences between tabs don't cause zeroed-out counts.
  function resolveHeader(...variants: string[]): string | null {
    for (const v of variants) {
      const found = rawHeaders.find((h) => h.toLowerCase() === v.toLowerCase());
      if (found) return found;
    }
    return null;
  }

  const tpCol = resolveHeader('TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status');
  const agCol = resolveHeader('AG Review Status');
  const cgCol = resolveHeader('CG Review Status');
  const genericCol = resolveHeader('Review Status', 'status', 'Status');

  let live = 0, removed = 0, done = 0, pending = 0, onPause = 0, notDone = 0;
  let tpLive = 0, tpRemoved = 0;
  let agLive = 0, agRemoved = 0;
  let cgLive = 0, cgRemoved = 0;

  for (const entry of entries) {
    const d = entry.data;
    const tp = tpCol ? (d[tpCol] ?? '').toLowerCase() : '';
    const ag = agCol ? (d[agCol] ?? '').toLowerCase() : '';
    const cg = cgCol ? (d[cgCol] ?? '').toLowerCase() : '';
    const generic = (!tp && !ag && !cg && genericCol) ? (d[genericCol] ?? '').toLowerCase() : '';

    if (tp) { if (isLiveStatus(tp)) tpLive++; else if (isRemovedStatus(tp)) tpRemoved++; }
    if (ag) { if (isLiveStatus(ag)) agLive++; else if (isRemovedStatus(ag)) agRemoved++; }
    if (cg) { if (isLiveStatus(cg)) cgLive++; else if (isRemovedStatus(cg)) cgRemoved++; }

    const agg = tp || ag || cg || generic;
    if (agg) {
      const statuses = [tp, ag, cg, generic].filter(Boolean);
      if (statuses.some(isLiveStatus)) live++;
      else if (statuses.some(isRemovedStatus)) removed++;
      else if (statuses.some(isDoneStatus)) done++;
      else if (statuses.some(isPendingStatus)) pending++;
      else if (statuses.some(isOnPauseStatus)) onPause++;
      else if (statuses.some(isNotDoneStatus)) notDone++;
    }
  }

  return {
    total: entries.length,
    live,
    removed,
    done,
    pending,
    onPause,
    notDone,
    tp: { live: tpLive, removed: tpRemoved },
    ag: { live: agLive, removed: agRemoved },
    cg: { live: cgLive, removed: cgRemoved },
  };
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export async function updateEntryData(
  id: string,
  tab: string,
  sheetRowId: string,
  fields: Record<string, string | null>,
): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('data')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const mergedData = { ...(existing.data as Record<string, string | null>), ...fields };
  const syncTag = crypto.randomUUID();
  const { error: upErr } = await supabase
    .from('entries')
    .update({ data: mergedData, last_edited_by: 'dashboard', last_sync_tag: syncTag })
    .eq('id', id);
  if (upErr) throw upErr;

  invalidateTabCache(tab);

  pushEntryToSheet(tab, sheetRowId, fields).catch(
    (err) => console.warn('[push-to-sheet] entry update failed (non-blocking):', err),
  );
}

export async function updateMentionStatus(id: string, status: MentionStatus): Promise<void> {
  // Read existing entry to get current data blob, tab, and sheet_row_id.
  const { data: existing, error: selErr } = await supabase
    .from('entries')
    .select('tab, sheet_row_id, data')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error('Entry not found — it may have been deleted.');

  const mergedData = {
    ...(existing.data as Record<string, string | null>),
    status,
  };

  const syncTag = crypto.randomUUID();
  const { error: upErr } = await supabase
    .from('entries')
    .update({ data: mergedData, last_edited_by: 'dashboard', last_sync_tag: syncTag })
    .eq('id', id);
  if (upErr) throw upErr;

  // Fire-and-forget: push the status change to the Sheet without blocking the UI.
  // If push-to-sheet is not configured, the error is only logged.
  pushEntryToSheet(existing.tab as string, existing.sheet_row_id as string, { status }).catch(
    (err) => console.warn('[push-to-sheet] status update failed (non-blocking):', err),
  );
}

export async function pushEntryToSheet(
  tab: string,
  sheetRowId: string,
  fields: Record<string, string | null>,
): Promise<void> {
  if (!PUSH_TO_SHEET_URL) throw new Error('VITE_PUSH_TO_SHEET_URL is not configured');
  const res = await fetch(PUSH_TO_SHEET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ tab, sheet_row_id: sheetRowId, fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Push to sheet failed: ${res.status} ${body}`);
  }
}

export async function insertEntry(
  tab: string,
  fields: Record<string, string | null>,
): Promise<void> {
  const sheetRowId = `dashboard-${crypto.randomUUID()}`;
  const syncTag = crypto.randomUUID();
  const { error } = await supabase
    .from('entries')
    .insert({
      tab,
      sheet_row_id: sheetRowId,
      data: fields,
      last_edited_by: 'dashboard',
      last_sync_tag: syncTag,
    });
  if (error) throw error;

  pushEntryToSheet(tab, sheetRowId, fields).catch(
    (err) => console.warn('[push-to-sheet] new entry push failed (non-blocking):', err),
  );
}

// ---------------------------------------------------------------------------
// Sync trigger
// ---------------------------------------------------------------------------

export async function triggerSync(): Promise<void> {
  if (!SYNC_FUNCTION_URL) throw new Error('VITE_IMPORT_TABS_URL is not configured — check .env');
  const res = await fetch(SYNC_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sync failed: ${res.status} ${body}`);
  }
}

// ---------------------------------------------------------------------------
// TP review status check trigger
// ---------------------------------------------------------------------------

export async function triggerStatusCheck(
  tab: string,
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }> {
  if (!CHECK_STATUS_URL) {
    throw new Error(
      'VITE_CHECK_STATUS_URL is not configured — check .env',
    );
  }
  const res = await fetch(CHECK_STATUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ tab }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Status check failed: ${res.status} ${body}`);
  }
  return res.json();
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
  patch: Partial<Pick<Profile, 'approved' | 'role'>>,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteProfile(id: string): Promise<void> {
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
