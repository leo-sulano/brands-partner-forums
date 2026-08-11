import type { Entry } from '../types/entry.ts';
import { platformRemovedKey } from './removedPlatformBrands.ts';
import type { Platform } from './removedPlatformBrands.ts';
import { accountUsageKey } from './tab-configs.ts';

// Re-exported (not just imported) so every existing `import type { Platform }
// from '../lib/scoreSummary'` across the codebase (BrandGroup.tsx,
// ScoreSummaryPanel.tsx, EditEntryModal.tsx) keeps working unchanged, even
// though the canonical definition now lives in removedPlatformBrands.ts.
// NOTE: `export type { Platform } from './removedPlatformBrands'` alone would
// NOT work here — a re-export statement forwards the binding to external
// importers but does not introduce a local `Platform` identifier usable
// elsewhere in *this* file (e.g. `Record<Platform, number>` below would fail
// to compile). The separate `import type` above is what makes `Platform`
// usable locally; the `export type { Platform };` after it is what re-exports
// that same local binding.
export type { Platform };

export type Star = number;
export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';

// TrustPilot and CasinoGuru score reviews 1-5; AskGamblers scores 1-10.
export const PLATFORM_MAX_SCORE: Record<Platform, number> = { tp: 5, ag: 10, cg: 5, wo: 5 };

export const PLATFORM_LABEL: Record<Platform, string> = {
  tp: 'TrustPilot',
  ag: 'AskGamblers',
  cg: 'CasinoGuru',
  wo: 'Wizard of Odds',
};

export const PLATFORM_SHORT_LABEL: Record<Platform, string> = {
  tp: 'TP',
  ag: 'AG',
  cg: 'CG',
  wo: 'WO',
};

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
  showStars: boolean;
}

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

// Kept aligned with BRAND_COLS / TP_STATUS_VARIANTS in BrandGroup.tsx so the
// summary works on any brand-group tab. 'Account Name' is intentionally NOT
// here — it would bucket one row per account, which isn't a useful summary.
const BRAND_KEYS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE'] as const;

export const PLATFORM_STATUS_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status'],
  ag: ['AG Review Status'],
  cg: ['CG Review Status'],
  wo: ['WoO Review Status'],
};

export const PLATFORM_DATE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['Trust Pilot'],
  ag: ['Ask Gambler review added'],
  cg: ['Casino Guru review added'],
  wo: ['Wizard of Odds'],
};

export const PLATFORM_REVIEW_TEXT_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Review Text'],
  ag: ['AG Review Text'],
  cg: ['CG Review Text'],
  wo: ['WO Review Text'],
};

const PLATFORM_SCORE_KEYS: Record<Platform, readonly string[]> = {
  tp: ['TP Score added', 'Score added', 'Score Added', 'Score'],
  ag: ['AG Score added'],
  cg: ['CG Score added'],
  wo: ['Wizard of OddsScore added'],
};

export function pick(data: Record<string, string | null>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (v != null && v !== '') return v;
  }
  return null;
}

export function getReviewText(data: Record<string, string | null>, platform: Platform): string | null {
  return pick(data, PLATFORM_REVIEW_TEXT_KEYS[platform]);
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

// Date-range gate for computeSuccessRates/computeTabSuccessRates. Deliberately
// INCLUDES a row when it has no date at all (missing key, or unparseable
// value) rather than excluding it — mirrors BrandGroup.tsx's applyDateFilter
// (the brand tab's own KPI cards), which is why a Removed/Refused row with no
// recorded post-date still counts toward the denominator in any date range,
// instead of silently vanishing and skewing the rate upward. This is what
// lets Success Rate be date-filtered without reintroducing the exact problem
// that originally justified making it all-time.
function passesDateFilter(
  data: Record<string, string | null>,
  dateKeys: readonly string[],
  fromBound: Date | null,
  toBound: Date | null,
): boolean {
  if (!fromBound && !toBound) return true;
  const raw = pick(data, dateKeys);
  if (raw == null) return true;
  const date = parsePostDate(raw);
  if (date == null) return true;
  if (fromBound && date < fromBound) return false;
  if (toBound && date > toBound) return false;
  return true;
}

// Ranged, ISO-string-based sibling of passesDateFilter, for callers that hold
// plain 'YYYY-MM-DD' strings (Overview's fetchTabKpis, BrandGroup.tsx's KPI
// cards) rather than pre-parsed Date bounds — the single source of truth for
// "is this row, for THIS platform, inside the selected date range", so
// Overview/BrandGroup/Score Summary can no longer each answer that question
// their own slightly-different way.
export function passesPlatformDateFilter(
  data: Record<string, string | null>,
  platform: Platform,
  fromISO?: string,
  toISO?: string,
): boolean {
  const fromDate = fromISO ? isoToDate(fromISO) : null;
  const toDate = toISO ? isoToDate(toISO) : null;
  const fromBound = fromDate ? startOfDay(fromDate) : null;
  const toBound = toDate ? endOfDay(toDate) : null;
  return passesDateFilter(data, PLATFORM_DATE_KEYS[platform], fromBound, toBound);
}

export function computeScoreSummary(
  entries: Entry[],
  range: DateRange,
  pinnedFirst: string[] = [],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
): ScoreSummaryResult {
  const fromBound = range.from ? startOfDay(range.from) : null;
  const toBound = range.to ? endOfDay(range.to) : null;

  // Empty selection means "all 4 platforms combined" (same convention as
  // every other filter); the ['tp'] default above only applies when the
  // caller passes nothing at all, preserving today's initial-load behavior.
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  // The star-rating histogram is scale- and column-dependent per platform
  // (TP is 1-5, AG is 1-10; even same-scale platforms have independent
  // review-text columns) — it only ever renders for exactly one platform.
  const showStars = resolved.length === 1;
  const soleStatusKeys = showStars ? PLATFORM_STATUS_KEYS[resolved[0]] : null;
  const soleDateKeys = showStars ? PLATFORM_DATE_KEYS[resolved[0]] : null;
  const soleScoreKeys = showStars ? PLATFORM_SCORE_KEYS[resolved[0]] : null;
  const maxScore = showStars ? PLATFORM_MAX_SCORE[resolved[0]] : 0;

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

    if (showStars) {
      // Single-platform path: unchanged from before this task, just reading
      // the one selected platform's keys instead of a bare `platform` param.
      if (removedPlatformBrands.has(platformRemovedKey(tab, brand, resolved[0]))) continue;

      const status = (pick(d, soleStatusKeys!) ?? '').trim().toLowerCase();
      if (!status) continue;

      // Bucket presence is keyed off ANY resolvable status (matching
      // computeSuccessRates' gate), not just Published — otherwise a brand
      // that's entirely Removed/Refused never gets a row at all, silently
      // hiding its all-time Success Rate too (which ScoreSummaryPanel looks up
      // by this same tab+brand key, independent of the Published filter below).
      const key = `${tab} ${brand}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tab, brand, counts: emptyCounts(), unrated: 0 };
        buckets.set(key, bucket);
      }

      if (status !== 'published') continue;

      const date = parsePostDate(pick(d, soleDateKeys!));

      if (dateFilterActive) {
        if (date == null) {
          excludedRows++;
          continue;
        }
        if (fromBound && date < fromBound) continue;
        if (toBound && date > toBound) continue;
      }

      const score = soleScoreKeys!.length > 0 ? parseScore(pick(d, soleScoreKeys!), maxScore) : null;
      if (score == null) {
        bucket.unrated += 1;
      } else {
        bucket.counts[score] += 1;
      }
    } else {
      // Multi-platform path: only the tab/brand bucket needs to exist (so the
      // brand list is complete) — no star counts are ever shown, so no
      // per-platform score/date processing runs here. A bucket exists if any
      // NON-flagged selected platform has any resolvable status at all,
      // mirroring the single-platform gate's "any resolvable status" rule.
      const hasAnyStatus = resolved.some((p) => {
        if (removedPlatformBrands.has(platformRemovedKey(tab, brand, p))) return false;
        return !!(pick(d, PLATFORM_STATUS_KEYS[p]) ?? '').trim();
      });
      if (!hasAnyStatus) continue;
      const key = `${tab} ${brand}`;
      if (!buckets.has(key)) buckets.set(key, { tab, brand, counts: {}, unrated: 0 });
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

  return { brands: summaries, excludedRows, showStars };
}

export interface SuccessRate {
  live: number;
  removed: number;
  rate: number | null; // null when live + removed === 0 (no decided outcome yet)
}

// Mirrors isLiveStatus/isRemovedStatus in src/lib/queries.ts (duplicated here
// rather than imported since that module is Supabase-coupled and this one is
// a pure data transform — keep these two definitions in sync if either changes).
export function isLiveStatus(s: string): boolean {
  if (s.includes('not pub') || s.includes('refused')) return false;
  return s.includes('published') || s.includes('live');
}
export function isRemovedStatus(s: string): boolean {
  return s.includes('remove') || s.includes('refus') || s.includes('reject');
}

// Per-brand Success Rate for Score Summary: live / (live + removed) across
// entries for that brand on the selected platform, not just the
// currently-Published ones computeScoreSummary counts. When `range` is set,
// matches BrandGroup.tsx's brand-tab KPI cards exactly: a row with no
// recorded post-date always counts regardless of the range (see
// passesDateFilter) — this is what avoids skewing the rate by dropping
// undated Removed/Refused rows, so date-filtering here is safe. `range`
// defaults to all-time (no filtering) when omitted.
export function computeSuccessRates(
  entries: Entry[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  range: DateRange = { from: null, to: null },
): Map<string, SuccessRate> {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  const fromBound = range.from ? startOfDay(range.from) : null;
  const toBound = range.to ? endOfDay(range.to) : null;
  const buckets = new Map<string, { live: number; removed: number }>();

  for (const e of entries) {
    const d = e.data ?? {};
    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;
    const tab = e.tab ?? '';

    // matchedAny tracks "does at least one selected, unflagged platform have
    // a non-blank, in-range status" — this is the bucket-existence gate,
    // matching the original single-platform function's "if (!status)
    // continue" (a bucket exists even for a status that's neither live nor
    // removed, e.g. "pending" — only matchedLive/matchedRemoved decide what
    // it increments). Getting this gate wrong silently drops such rows from
    // the result map entirely instead of leaving them at rate: null.
    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    for (const platform of resolved) {
      if (removedPlatformBrands.has(platformRemovedKey(tab, brand, platform))) continue;
      const status = (pick(d, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesDateFilter(d, PLATFORM_DATE_KEYS[platform], fromBound, toBound)) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
    }
    if (!matchedAny) continue;

    const key = `${tab} ${brand}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { live: 0, removed: 0 };
      buckets.set(key, bucket);
    }
    if (matchedLive) bucket.live += 1;
    else if (matchedRemoved) bucket.removed += 1;
  }

  const result = new Map<string, SuccessRate>();
  for (const [key, { live, removed }] of buckets) {
    const total = live + removed;
    result.set(key, { live, removed, rate: total === 0 ? null : (live / total) * 100 });
  }
  return result;
}

// Per-tab Success Rate: live / (live + removed) across entries for that
// tab on the selected platform, regardless of brand. Unlike computeSuccessRates,
// this does NOT require a brand field — a brand with zero Published entries
// (and therefore no BrandSummary row) would otherwise be silently dropped from
// a naive per-brand aggregation, biasing a tab-level total upward. Used for the
// Score Summary group Total row's Success Rate so it reflects the whole tab.
// `range` (see computeSuccessRates) defaults to all-time when omitted, and
// otherwise matches BrandGroup.tsx's brand-tab KPI cards via passesDateFilter.
export function computeTabSuccessRates(
  entries: Entry[],
  platforms: Platform[] = ['tp'],
  removedPlatformBrands: Set<string> = new Set(),
  range: DateRange = { from: null, to: null },
): Map<string, SuccessRate> {
  const resolved = platforms.length === 0 ? (['tp', 'ag', 'cg', 'wo'] as Platform[]) : platforms;
  const fromBound = range.from ? startOfDay(range.from) : null;
  const toBound = range.to ? endOfDay(range.to) : null;
  const buckets = new Map<string, { live: number; removed: number }>();

  for (const e of entries) {
    const d = e.data ?? {};
    const tab = e.tab ?? '';
    const brand = (pick(d, BRAND_KEYS) ?? '').trim();

    let matchedAny = false;
    let matchedLive = false;
    let matchedRemoved = false;
    for (const platform of resolved) {
      if (brand && removedPlatformBrands.has(platformRemovedKey(tab, brand, platform))) continue;
      const status = (pick(d, PLATFORM_STATUS_KEYS[platform]) ?? '').trim().toLowerCase();
      if (!status) continue;
      if (!passesDateFilter(d, PLATFORM_DATE_KEYS[platform], fromBound, toBound)) continue;
      matchedAny = true;
      if (isLiveStatus(status)) matchedLive = true;
      else if (isRemovedStatus(status)) matchedRemoved = true;
    }
    if (!matchedAny) continue;

    let bucket = buckets.get(tab);
    if (!bucket) {
      bucket = { live: 0, removed: 0 };
      buckets.set(tab, bucket);
    }
    if (matchedLive) bucket.live += 1;
    else if (matchedRemoved) bucket.removed += 1;
  }

  const result = new Map<string, SuccessRate>();
  for (const [key, { live, removed }] of buckets) {
    const total = live + removed;
    result.set(key, { live, removed, rate: total === 0 ? null : (live / total) * 100 });
  }
  return result;
}

// One row = one "use" of whichever platform(s) it has a non-blank status
// value for (Live, Removed, Refused, Pending — the actual outcome doesn't
// matter, only that the account was used), tallied per normalized Account
// text across every tab, not just one. Powers AccountUsageBadges
// (src/components/AccountUsageBadges.tsx), shown next to the Account cell
// in BrandGroup.tsx. Matching is via accountUsageKey (strips the dup suffix,
// then trims whitespace) — see accountUsageKey in tab-configs.ts for why
// those are the only two things safe to normalize; case and the
// id/label/country segments' content are still compared exactly.
export function computeAccountPlatformUsage(entries: Entry[]): Map<string, Record<Platform, number>> {
  const platforms = Object.keys(PLATFORM_STATUS_KEYS) as Platform[];
  const result = new Map<string, Record<Platform, number>>();

  for (const e of entries) {
    const d = e.data ?? {};
    const account = accountUsageKey(d['Account']);
    if (!account) continue;

    let counts = result.get(account);
    if (!counts) {
      counts = { tp: 0, ag: 0, cg: 0, wo: 0 };
      result.set(account, counts);
    }
    for (const p of platforms) {
      if (pick(d, PLATFORM_STATUS_KEYS[p])) counts[p] += 1;
    }
  }

  return result;
}

// Success Rate for a single already-computed live/removed pair — used by
// BrandGroup.tsx's summary cards, which derive live/removed from page state
// (displayTotals/displayKpis) rather than raw entries, unlike
// computeSuccessRates/computeTabSuccessRates above which do their own entry
// iteration and date filtering.
export function rateFromCounts(live: number, removed: number): number | null {
  const total = live + removed;
  return total === 0 ? null : (live / total) * 100;
}

// Whole-number percent for display: floored, except a rate of exactly 100
// stays 100. Mirrors successRatePct in ScoreSummaryPanel.tsx so the same
// underlying rate renders as the same integer on both pages (kept in sync
// manually — verify before assuming still aligned if either changes).
export function successRatePct(rate: number | null): number | null {
  if (rate == null) return null;
  return rate === 100 ? 100 : Math.floor(rate);
}

// Convenience wrapper combining rateFromCounts + successRatePct into the exact
// display string BrandGroup.tsx's summary cards show — single source of truth
// for the '—'/'N%' decision so both the single-platform card and the
// multi-platform badge can never drift from each other.
export function formatRatePct(live: number, removed: number): string {
  const pct = successRatePct(rateFromCounts(live, removed));
  return pct == null ? '—' : `${pct}%`;
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
