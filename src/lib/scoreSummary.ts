import type { Entry } from '../types/entry';
import { tpRemovedKey } from './removedTpBrands';

export type Star = number;
export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';
export type Platform = 'tp' | 'ag' | 'cg' | 'wo';

// TrustPilot and CasinoGuru score reviews 1-5; AskGamblers scores 1-10.
export const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5, wo: 5 };

export interface BrandSummary {
  tab: string;
  brand: string;
  counts: Record<Star, number>;
  unrated: number;
  total: number;
  rated: number;
  average: number | null;
  label: RatingLabel | null;
}

export interface ScoreSummaryResult {
  brands: BrandSummary[];
  excludedRows: number;
}

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

// Kept aligned with BRAND_COLS / TP_STATUS_VARIANTS in BrandGroup.tsx so the
// summary works on any brand-group tab. 'Account Name' is intentionally NOT
// here — it would bucket one row per account, which isn't a useful summary.
const BRAND_KEYS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE'] as const;

const PLATFORM_STATUS_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status'],
  ag: ['AG Review Status'],
  cg: ['CG Review Status'],
  wo: ['WoO Review Status'],
};

const PLATFORM_DATE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['Trust Pilot'],
  ag: ['Ask Gambler review added'],
  cg: ['Casino Guru review added'],
  wo: ['Wizard of Odds'],
};

const PLATFORM_SCORE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: ['AG Score added'],
  cg: ['CG Score added'],
  wo: ['Wizard of OddsScore added'],
};

function pick(data: Record<string, string | null>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (v != null && v !== '') return v;
  }
  return null;
}

// Floors fractional scores to their whole-star bucket (e.g. a recorded 4.5
// counts as 4-star) instead of dropping them to "unrated" — matches the
// per-row star badge's parseStarScore in BrandGroup.tsx.
export function parseScore(raw: string | null | undefined, maxScore: number): Star | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored < 1 || floored > maxScore) return null;
  return floored;
}

// Date format used in the sheet/dashboard is DD/MM/YYYY (European, matches
// parseCellDate in src/lib/dateUtils.ts). The DatePicker emits YYYY-MM-DD.
export function parsePostDate(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD (DatePicker output, or ISO from elsewhere)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return buildDate(y, mo, d);
  }
  // DD/MM/YYYY or D/M/YYYY (sheet format)
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    return buildDate(y, mo, d);
  }
  // Fallback for JS Date.toString() values written by the sheet/Apps Script,
  // e.g. "Wed Oct 15 2025 07:00:00 GMT+0800 (Philippine Standard Time)".
  // Mirrors parseCellDate in src/lib/dateUtils.ts so the score summary filters
  // the same rows the rest of the app does. Normalized to local midnight so the
  // value compares cleanly against the day-granularity range bounds.
  const native = new Date(s);
  if (!isNaN(native.getTime())) {
    return new Date(native.getFullYear(), native.getMonth(), native.getDate());
  }
  return null;
}

function buildDate(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

export function ratingLabel(avg: number | null, maxScore: number = 5): RatingLabel | null {
  if (avg == null) return null;
  const k = maxScore / 5;
  if (avg >= 4.5 * k) return 'Excellent';
  if (avg >= 4.0 * k) return 'Great';
  if (avg >= 3.0 * k) return 'Average';
  if (avg >= 2.0 * k) return 'Poor';
  // Unscaled floor: the minimum possible average is always 1, regardless of
  // scale, so scaling this cutoff would leave low-but-real averages (e.g.
  // 1.2 out of 10) rendering as blank instead of "Bad".
  if (avg >= 1.0) return 'Bad';
  return null;
}

// Shared by computeScoreSummary (per-brand) and ScoreSummaryPanel's
// computeColumnTotals (per-group/grand totals) so the weighted-average math
// can't drift between the two call sites.
export function summarizeCounts(
  counts: Record<number, number>,
  unrated: number,
  maxScore: number,
): { total: number; rated: number; average: number | null; label: RatingLabel | null } {
  let rated = 0;
  let weighted = 0;
  for (let i = 1; i <= maxScore; i++) {
    const c = counts[i] ?? 0;
    rated += c;
    weighted += i * c;
  }
  const total = rated + unrated;
  const average = rated === 0 ? null : Math.round((weighted / rated) * 10) / 10;
  return { total, rated, average, label: ratingLabel(average, maxScore) };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function computeScoreSummary(
  entries: Entry[],
  range: DateRange,
  pinnedFirst: string[] = [],
  platform: Platform = 'tp',
  removedTpBrands: Set<string> = new Set(),
): ScoreSummaryResult {
  const fromBound = range.from ? startOfDay(range.from) : null;
  const toBound = range.to ? endOfDay(range.to) : null;

  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const dateKeys = PLATFORM_DATE_KEYS[platform];
  const scoreKeys = PLATFORM_SCORE_KEYS[platform];
  const maxScore = PLATFORM_MAX_SCORE[platform];

  interface Bucket {
    tab: string;
    brand: string;
    counts: Record<Star, number>;
    unrated: number;
  }

  function emptyCounts(): Record<Star, number> {
    const counts: Record<Star, number> = {};
    for (let i = 1; i <= maxScore; i++) counts[i] = 0;
    return counts;
  }

  const buckets = new Map<string, Bucket>();
  let excludedRows = 0;
  const dateFilterActive = fromBound !== null || toBound !== null;

  for (const e of entries) {
    const d = e.data ?? {};

    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    const tab = e.tab ?? '';

    const status = (pick(d, statusKeys) ?? '').trim().toLowerCase();
    if (status !== 'published') continue;

    if (platform === 'tp' && removedTpBrands.has(tpRemovedKey(tab, brand))) continue;

    const date = parsePostDate(pick(d, dateKeys));

    if (dateFilterActive) {
      if (date == null) {
        excludedRows++;
        continue;
      }
      if (fromBound && date < fromBound) continue;
      if (toBound && date > toBound) continue;
    }

    const key = `${tab} ${brand}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tab, brand, counts: emptyCounts(), unrated: 0 };
      buckets.set(key, bucket);
    }

    const score = scoreKeys.length > 0 ? parseScore(pick(d, scoreKeys), maxScore) : null;
    if (score == null) {
      bucket.unrated += 1;
    } else {
      bucket.counts[score] += 1;
    }
  }

  const summaries: BrandSummary[] = [...buckets.values()].map((b) => {
    const { total, rated, average, label } = summarizeCounts(b.counts, b.unrated, maxScore);
    return {
      tab: b.tab,
      brand: b.brand,
      counts: b.counts,
      unrated: b.unrated,
      total,
      rated,
      average,
      label,
    };
  });

  const pinnedSet = new Set(pinnedFirst);
  summaries.sort((a, b) => {
    const aPinned = pinnedSet.has(a.brand);
    const bPinned = pinnedSet.has(b.brand);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (aPinned && bPinned) {
      return pinnedFirst.indexOf(a.brand) - pinnedFirst.indexOf(b.brand);
    }
    const byTab = a.tab.localeCompare(b.tab);
    if (byTab !== 0) return byTab;
    return a.brand.localeCompare(b.brand);
  });

  return { brands: summaries, excludedRows };
}

export interface SuccessRate {
  live: number;
  removed: number;
  rate: number | null; // null when live + removed === 0 (no decided outcome yet)
}

// Mirrors isLiveStatus/isRemovedStatus in src/lib/queries.ts (duplicated here
// rather than imported since that module is Supabase-coupled and this one is
// a pure data transform — keep these two definitions in sync if either changes).
function isLiveStatus(s: string): boolean {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}
function isRemovedStatus(s: string): boolean {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}

// Per-brand Success Rate for Score Summary: live / (live + removed) across
// ALL entries for that brand on the selected platform, not just the
// currently-Published ones computeScoreSummary counts. Deliberately has no
// date-range parameter — a Removed/Refused row frequently has no post-date
// recorded at all, so applying the page's date filter here would silently
// exclude it from the denominator and skew the rate upward.
export function computeSuccessRates(
  entries: Entry[],
  platform: Platform,
  removedTpBrands: Set<string> = new Set(),
): Map<string, SuccessRate> {
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const buckets = new Map<string, { live: number; removed: number }>();

  for (const e of entries) {
    const d = e.data ?? {};

    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    const status = (pick(d, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;

    const tab = e.tab ?? '';
    if (platform === 'tp' && removedTpBrands.has(tpRemovedKey(tab, brand))) continue;

    const key = `${tab} ${brand}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { live: 0, removed: 0 };
      buckets.set(key, bucket);
    }

    if (isLiveStatus(status)) bucket.live += 1;
    else if (isRemovedStatus(status)) bucket.removed += 1;
  }

  const result = new Map<string, SuccessRate>();
  for (const [key, { live, removed }] of buckets) {
    const total = live + removed;
    result.set(key, { live, removed, rate: total === 0 ? null : (live / total) * 100 });
  }
  return result;
}

// Per-tab Success Rate: live / (live + removed) across ALL entries for that
// tab on the selected platform, regardless of brand. Unlike computeSuccessRates,
// this does NOT require a brand field — a brand with zero Published entries
// (and therefore no BrandSummary row) would otherwise be silently dropped from
// a naive per-brand aggregation, biasing a tab-level total upward. Used for the
// Score Summary group Total row's Success Rate so it reflects the whole tab.
export function computeTabSuccessRates(
  entries: Entry[],
  platform: Platform,
  removedTpBrands: Set<string> = new Set(),
): Map<string, SuccessRate> {
  const statusKeys = PLATFORM_STATUS_KEYS[platform];
  const buckets = new Map<string, { live: number; removed: number }>();

  for (const e of entries) {
    const d = e.data ?? {};
    const status = (pick(d, statusKeys) ?? '').trim().toLowerCase();
    if (!status) continue;

    const tab = e.tab ?? '';
    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (platform === 'tp' && brand && removedTpBrands.has(tpRemovedKey(tab, brand))) continue;

    let bucket = buckets.get(tab);
    if (!bucket) {
      bucket = { live: 0, removed: 0 };
      buckets.set(tab, bucket);
    }

    if (isLiveStatus(status)) bucket.live += 1;
    else if (isRemovedStatus(status)) bucket.removed += 1;
  }

  const result = new Map<string, SuccessRate>();
  for (const [key, { live, removed }] of buckets) {
    const total = live + removed;
    result.set(key, { live, removed, rate: total === 0 ? null : (live / total) * 100 });
  }
  return result;
}

export type PresetKey = 'today' | 'this-week' | 'this-month' | 'last-7' | 'last-30' | 'all';

export function resolvePreset(key: PresetKey, now: Date = new Date()): DateRange {
  const today = startOfDay(now);
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'this-week': {
      const dow = today.getDay();
      const offsetToMonday = (dow + 6) % 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - offsetToMonday);
      return { from: monday, to: today };
    }
    case 'this-month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: first, to: today };
    }
    case 'last-7': {
      const from = new Date(today);
      from.setDate(today.getDate() - 6);
      return { from, to: today };
    }
    case 'last-30': {
      const from = new Date(today);
      from.setDate(today.getDate() - 29);
      return { from, to: today };
    }
    case 'all':
    default:
      return { from: null, to: null };
  }
}

export function dateToIso(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoToDate(s: string): Date | null {
  if (!s) return null;
  return parsePostDate(s);
}
