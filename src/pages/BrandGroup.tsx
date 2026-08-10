import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2, XCircle, Circle, Building2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Search, X, Check, CalendarDays, Plus, RefreshCw, Loader2, Star,
} from 'lucide-react';
import KpiCard from '../components/KpiCard';
import SuccessRateBadge from '../components/SuccessRateBadge';
import EditEntryModal from '../components/EditEntryModal';
import AddReviewAccountModal from '../components/AddReviewAccountModal';
import TotalBreakdownModal from '../components/TotalBreakdownModal';
import Toast, { type ToastKind } from '../components/Toast';
import PlatformRemovedBadge from '../components/PlatformRemovedBadge';
import AccountUsageBadges from '../components/AccountUsageBadges';
import BrandFilterDropdown from '../components/BrandFilterDropdown';
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, triggerAgStatusCheck, triggerCgStatusCheck, triggerWoStatusCheck, insertEntry, deleteEntries, moveEntryToTab, fetchRemovedPlatformBrands, setBrandPlatformRemoved, fetchBrandPlatformOverrides, setBrandPlatformOverride, clearBrandPlatformOverride, fetchAllEntries, type StatusCheckScope } from '../lib/queries';
import { platformRemovedKey, buildRemovedPlatformBrandSet, normalizeBrandKey } from '../lib/removedPlatformBrands';
import { overrideKey, buildOverrideMap, type OverrideState } from '../lib/scheduleOverrides';
import { subscribeEntries } from '../lib/realtime';
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount, getBrandGroup, BRAND_COLS, TABLE_HIDDEN_COLS, PLATFORM_SCORE_COLS, accountUsageKey } from '../lib/tab-configs';
import { slugToTab, OPERATIONAL_TABS, tabDisplayName } from '../lib/tabs';
import { parseScore, PLATFORM_MAX_SCORE, computeAccountPlatformUsage, passesPlatformDateFilter, PLATFORM_REVIEW_TEXT_KEYS, type Platform } from '../lib/scoreSummary';
import { canonicalCountryKey, resolveCountryLabel } from '../lib/countryFlags';
import { canonicalProxyKey, canonicalProxyName } from '../lib/proxyAliases';
import { useAuth } from '../contexts/AuthContext';
import { formatCellValue } from '../lib/format';
import type { Entry } from '../types/entry';

// Checked case-insensitively against header names for tabs with no whitelist config.
const HIDDEN_COLS = new Set(['id', 'last_sync_tag', 'score added', 'review status']);
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

// Populated by the Selenium status checkers, not user-editable — never
// surface as a raw Edit Entry modal field (a purpose-built display belongs
// to a separate task). Also excluded from duplication in CLEAR_ON_DUPLICATE.
// Derived from scoreSummary.ts's PLATFORM_REVIEW_TEXT_KEYS (not a second
// hardcoded literal) so the two can't silently drift apart.
const REVIEW_TEXT_KEYS = new Set(Object.values(PLATFORM_REVIEW_TEXT_KEYS).flat());

// Dashboard-only fields with no Sheet column — never come from tab_schemas, so they're
// force-inserted into the edit modal right after their paired "User"/"Status" field.
const DASHBOARD_ONLY_MODAL_FIELDS: Array<[string, string]> = [
  ['AG User', 'AG Password'],
  ['CG User', 'CG Password'],
  ['AG Review Status', 'AG Score added'],
  ['CG Review Status', 'CG Score added'],
];


function isStatusCol(header: string) {
  return header.toLowerCase().includes('status');
}

function isLinkCol(header: string) {
  if (header === 'Brand / TP URL PAGE') return false;
  if (header === 'URL PAGE') return false;
  const h = header.toLowerCase();
  return h.includes('link') || h.includes('url') || h.includes('profile');
}

function isNoSortCol(header: string) {
  const noSortCols = new Set(['Account Name', 'URL PAGE', 'Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE']);
  return isLinkCol(header) || noSortCols.has(header);
}

function StatusPill({ value }: { value: string }) {
  if (!value || value === '—') return <span className="text-slate-400">—</span>;
  const v = value.toLowerCase().trim();
  if (v.includes('live') || (v.includes('publish') && !v.includes('not pub'))) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-3" /> {value}
      </span>
    );
  }
  if (v === 'done') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        <CheckCircle2 className="size-3" /> {value}
      </span>
    );
  }
  if (v.includes('remov') || v.includes('refus') || v.includes('reject')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
        <XCircle className="size-3" /> {value}
      </span>
    );
  }
  if (v === 'pending' || v === 'not published') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        <Circle className="size-3" /> {value}
      </span>
    );
  }
  if (v === 'not done' || v === 'no review') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-900">
        <Circle className="size-3" /> {value}
      </span>
    );
  }
  if (v === 'on pause') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
        <Circle className="size-3" /> {value}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      <Circle className="size-3" /> {value}
    </span>
  );
}


const LINK_STATUS_COL: Record<string, string> = {
  'AG Review Link': 'AG Review Status',
  'CG Review Link': 'CG Review Status',
};

// Refined from Overview.tsx's PLATFORM_ICON_BG hue family per user feedback:
// CG uses its real brand green instead of amber, and WO took CG's old amber.
const PLATFORM_STAR_COLOR: Record<'tp' | 'ag' | 'cg' | 'wo', string> = {
  tp: 'text-emerald-600',
  ag: 'text-red-500',
  cg: 'text-green-500',
  wo: 'text-amber-500',
};

// 'Link to the profile' is TP's link header everywhere except Wizard of
// Odds, which reuses it for that platform instead.
function linkColPlatform(header: string, tab: string): 'tp' | 'ag' | 'cg' | 'wo' | null {
  if (header === 'AG Review Link') return 'ag';
  if (header === 'CG Review Link') return 'cg';
  if (header === 'Link to the profile') return tab === 'Wizard of Odds' ? 'wo' : 'tp';
  return null;
}

// Same flooring behavior as parseScore in lib/scoreSummary.ts, kept separate
// since this one only needs to return a display value, not bucket a count.
function parseStarScore(raw: string | null | undefined, maxScore: number): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored < 1 || floored > maxScore) return null;
  return floored;
}

function CellValue({ header, value, rowData, tab }: { header: string; value: string | null; rowData?: Record<string, string | null>; tab?: string }) {
  if (isDateCol(header) && (!value || value.trim() === '')) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-900">
        No Review
      </span>
    );
  }
  const display = value ? formatCellValue(value) : '—';
  if (isStatusCol(header)) return <StatusPill value={display} />;
  if (isLinkCol(header) && value) {
    const statusCol = LINK_STATUS_COL[header];
    if (statusCol && rowData) {
      const status = rowData[statusCol];
      if (!status || status.trim().toLowerCase() === 'no review') {
        return <span className="text-slate-600">—</span>;
      }
    }
    const href = value.startsWith('http') ? value : `https://${value}`;
    const platform = tab != null ? linkColPlatform(header, tab) : null;
    let score: number | null = null;
    let maxScore = 0;
    if (platform && rowData) {
      maxScore = PLATFORM_MAX_SCORE[platform];
      const raw = PLATFORM_SCORE_COLS[platform].map((c) => rowData[c]).find((v) => v != null && v !== '');
      score = parseStarScore(raw, maxScore);
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors whitespace-nowrap"
      >
        <ExternalLink className="size-3" /> View
        {score != null && platform && (
          <span title={`Score: ${score}/${maxScore}`} className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <Star className={`absolute inset-0 size-4 fill-current ${PLATFORM_STAR_COLOR[platform]}`} />
            <span className="relative text-[8px] font-bold leading-none text-white">{score}</span>
          </span>
        )}
      </a>
    );
  }
  if (isDateCol(header) && value) {
    const d = parseCellDate(value);
    const now = new Date();
    const isToday = d !== null &&
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return <span className={isToday ? 'font-semibold text-slate-900' : 'text-slate-600'}>{display}</span>;
  }
  return <span className="text-slate-600">{display}</span>;
}

// Date column candidates, in priority order.
// 'Score added' intentionally excluded — it stores a numeric rating (1–5), not a date.
const ENTRY_DATE_COLS = [
  'Trust Pilot',
  'Ask Gambler review added',
  'Casino Guru review added',
  'Removed / Not Published / stil published date',
  'Wizard of Odds',
  'Date', 'date', 'Posted At', 'posted_at',
];

const PLATFORM_STATUS_COL = {
  tp: 'TP Review Status',
  ag: 'AG Review Status',
  cg: 'CG Review Status',
  wo: 'WoO Review Status',
} as const;

// Columns that belong to each platform — used to hide non-selected platform cols.
const PLATFORM_OWN_COLS: Record<'tp' | 'ag' | 'cg', Set<string>> = {
  tp: new Set(['Trust Pilot', 'Link to the profile', 'TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status']),
  ag: new Set(['Ask Gambler review added', 'AG Review Status', 'AG Review Link', 'AG User']),
  cg: new Set(['Casino Guru review added', 'CG Review Status', 'CG Review Link', 'CG User']),
};

// Which logical group a column belongs to — identity columns (Account, Brand,
// etc.) vs. each platform's own columns. Drives the equal-spacing gaps between
// groups in the table header/body (see withGroupSpacers/countGroupSpacers).
function colGroup(h: string): 'tp' | 'ag' | 'cg' | 'identity' {
  if (PLATFORM_OWN_COLS.tp.has(h)) return 'tp';
  if (PLATFORM_OWN_COLS.ag.has(h)) return 'ag';
  if (PLATFORM_OWN_COLS.cg.has(h)) return 'cg';
  return 'identity';
}

// Inserts a spacer element (built by spacerFactory) between consecutive
// `headers` entries whenever their column group changes — e.g. once after the
// identity columns end, then again between each platform's own columns.
function withGroupSpacers<T>(headers: string[], cells: T[], spacerFactory: (key: string) => T): T[] {
  const out: T[] = [];
  let prevGroup: string | null = null;
  headers.forEach((h, i) => {
    const g = colGroup(h);
    if (prevGroup !== null && g !== prevGroup) out.push(spacerFactory(`spacer-${i}`));
    out.push(cells[i]);
    prevGroup = g;
  });
  return out;
}

// Number of spacer cells withGroupSpacers would insert for this header list —
// used to keep colSpan totals (empty-state row) in sync.
function countGroupSpacers(headers: string[]): number {
  let count = 0;
  let prevGroup: string | null = null;
  for (const h of headers) {
    const g = colGroup(h);
    if (prevGroup !== null && g !== prevGroup) count++;
    prevGroup = g;
  }
  return count;
}

// All known Trust Pilot status column variants across tabs.
const TP_STATUS_VARIANTS = new Set([
  'TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status',
  'Trust pilot Review Status', 'Review Status',
]);

// The actual header (if present on this tab) that carries a given
// platform's own status.
function platformStatusCol(headers: string[], platform: Platform): string | null {
  if (platform === 'tp') return headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null;
  return headers.find((h) => h.toLowerCase() === PLATFORM_STATUS_COL[platform].toLowerCase()) ?? null;
}

function isDateCol(header: string): boolean {
  const h = header.toLowerCase();
  return ENTRY_DATE_COLS.some((c) => c.toLowerCase() === h);
}

function parseCellDate(value: string): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d;
  return null;
}

type FilterOpt<T extends string> = { value: T; label: string; dot?: string };

function FilterDropdown<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: FilterOpt<T>[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-blue-50 hover:border-blue-200 transition-colors"
      >
        {selected?.dot && <span className={`size-1.5 shrink-0 rounded-full ${selected.dot}`} />}
        {selected?.label}
        <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${opt.value === value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'}`}
            >
              {opt.dot && <span className={`size-1.5 shrink-0 rounded-full ${opt.dot}`} />}
              <span className="flex-1">{opt.label}</span>
              {opt.value === value && <Check className="size-3 text-blue-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_OPTS: FilterOpt<'all' | 'live' | 'removed' | 'done' | 'on-pause' | 'pending' | 'not-done'>[] = [
  { value: 'all',      label: 'All statuses', dot: 'bg-slate-400' },
  { value: 'live',     label: 'Live', dot: 'bg-green-500' },
  { value: 'done',     label: 'Done',             dot: 'bg-blue-500' },
  { value: 'removed',  label: 'Removed', dot: 'bg-rose-500' },
  { value: 'on-pause', label: 'On Pause',     dot: 'bg-slate-500' },
  { value: 'pending',  label: 'Pending',      dot: 'bg-amber-400' },
  { value: 'not-done', label: 'Not Done',     dot: 'bg-orange-500' },
];

const PLATFORM_OPTS: FilterOpt<'all' | 'tp' | 'ag' | 'cg'>[] = [
  { value: 'all', label: 'All platforms' },
  { value: 'tp',  label: 'Trust Pilot',  dot: 'bg-blue-500' },
  { value: 'ag',  label: 'Ask Gambler',  dot: 'bg-amber-500' },
  { value: 'cg',  label: 'Casino Guru',  dot: 'bg-violet-500' },
];

const BRAND_LINK_COLS = ['AG Review Link', 'CG Review Link'];
const NO_BRAND_FILTER_TABS = new Set(['HazEmirates UAE', 'Trybet', 'SilverPlay', 'GRG - Gulf Recovery Group']);

const INLINE_STATUS_OPTIONS = ['Live', 'Done', 'Published', 'Still Published', 'Pending', 'On Pause', 'Not done', 'Refused', 'Removed', 'Not Published'];


const PLATFORM_FAVICON: Record<'tp' | 'ag' | 'cg' | 'wo', string> = {
  tp: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16',
  ag: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16',
  cg: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16',
  wo: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=64',
};

const PLATFORM_CARDS = [
  { key: 'tp' as const, label: 'Trust Pilot', dot: 'bg-blue-500' },
  { key: 'ag' as const, label: 'Ask Gambler', dot: 'bg-amber-500' },
  { key: 'cg' as const, label: 'Casino Guru', dot: 'bg-violet-500' },
];

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function DatePicker({ value, onChange, placeholder, min, max }: {
  value: string; onChange: (v: string) => void;
  placeholder: string; min?: string; max?: string;
}) {
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => value ? +value.slice(0, 4) : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value ? +value.slice(5, 7) - 1 : today.getMonth());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (value) { setViewYear(+value.slice(0, 4)); setViewMonth(+value.slice(5, 7) - 1); }
  }, [value]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayMon = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  function pad(n: number) { return String(n).padStart(2, '0'); }
  function toIso(day: number) { return `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`; }
  function isSelected(day: number) { return toIso(day) === value; }
  function isToday(day: number) { return viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate(); }
  function isDisabled(day: number) {
    const iso = toIso(day);
    return (!!min && iso < min) || (!!max && iso > max);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const active = !!value;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
          active
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50'
        }`}
      >
        <CalendarDays className="size-3.5 shrink-0" />
        <span>{active ? isoToDisplay(value) : placeholder}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onChange(''); }} className="ml-0.5 text-blue-400 hover:text-blue-600 transition-colors">
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[200] mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="rounded-md p-1 text-slate-500 hover:bg-blue-50 transition-colors">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold text-slate-700">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="rounded-md p-1 text-slate-500 hover:bg-blue-50 transition-colors">
              <ChevronRight className="size-4" />
            </button>
          </div>
          {/* Day labels */}
          <div className="mb-1 grid grid-cols-7">
            {DAY_LABELS.map(d => (
              <div key={d} className="py-1 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">{d}</div>
            ))}
          </div>
          {/* Days */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: firstDayMon }, (_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const sel = isSelected(day);
              const dis = isDisabled(day);
              const tod = isToday(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={dis}
                  onClick={() => { onChange(toIso(day)); setOpen(false); }}
                  className={`flex h-8 w-full items-center justify-center rounded-lg text-xs transition-colors ${
                    sel ? 'bg-blue-600 font-semibold text-white'
                    : dis ? 'cursor-not-allowed text-slate-300'
                    : tod ? 'border border-blue-300 font-medium text-blue-600 hover:bg-blue-50'
                    : 'text-slate-700 hover:bg-blue-50'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string | null; sortDir: 'asc' | 'desc' }) {
  if (sortCol !== col) return <ChevronsUpDown className="size-3 text-slate-400 shrink-0" />;
  return sortDir === 'desc'
    ? <ChevronUp className="size-3 text-blue-600 shrink-0" />
    : <ChevronDown className="size-3 text-blue-600 shrink-0" />;
}

function sortStorageKey(tab: string) {
  return `bpf_sort_${tab}`;
}

function readSortFromStorage(tab: string): { col: string | null; dir: 'asc' | 'desc' } {
  try {
    const raw = localStorage.getItem(sortStorageKey(tab));
    if (!raw) return { col: null, dir: 'asc' };
    const parsed = JSON.parse(raw);
    return { col: parsed.col ?? null, dir: parsed.dir === 'desc' ? 'desc' : 'asc' };
  } catch { return { col: null, dir: 'asc' }; }
}

function writeSortToStorage(tab: string, col: string | null, dir: 'asc' | 'desc') {
  if (col) {
    localStorage.setItem(sortStorageKey(tab), JSON.stringify({ col, dir }));
  } else {
    localStorage.removeItem(sortStorageKey(tab));
  }
}

// Remembers the last view (search/filters/date range) per brand tab so that
// leaving a tab (which fully unmounts this route) and coming back restores
// it, instead of the tab always reopening blank.
type StoredBrandFilters = {
  search: string;
  brandFilter: string;
  agentFilter: string;
  proxyFilter: string;
  countryFilter: string;
  statusFilter: string;
  platformFilter: string;
  ratingFilter: number | 'unrated' | 'any' | null;
  dateFrom: string;
  dateTo: string;
};

function filterStorageKey(tab: string) {
  return `bpf_filters_${tab}`;
}

function readFiltersFromStorage(tab: string): Partial<StoredBrandFilters> {
  try {
    const raw = localStorage.getItem(filterStorageKey(tab));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeFiltersToStorage(tab: string, filters: StoredBrandFilters) {
  try {
    localStorage.setItem(filterStorageKey(tab), JSON.stringify(filters));
  } catch {
    // storage unavailable/full — view just won't persist across navigation
  }
}

export default function BrandGroup() {
  const { tab } = useParams<{ tab: string }>();
  // URL carries kebab-case slug (e.g. "tp-brand-injection"); resolve to the
  // canonical tab name ("TP Brand Injection") that the DB and queries expect.
  // Fall back to a decoded raw param so legacy %20-encoded links still work.
  const decodedTab = slugToTab(tab ?? '') ?? decodeURIComponent(tab ?? '');

  const [entries, setEntries] = useState<Entry[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fullHeaders, setFullHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [showTotalModal, setShowTotalModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const STATUS_FILTER_VALUES = ['live', 'removed', 'done', 'on-pause', 'pending', 'not-done'] as const;
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'removed' | 'done' | 'on-pause' | 'pending' | 'not-done'>(
    (STATUS_FILTER_VALUES.includes(searchParams.get('status') as typeof STATUS_FILTER_VALUES[number]) ? searchParams.get('status') as typeof STATUS_FILTER_VALUES[number] : 'all')
  );
  const [platformFilter, setPlatformFilter] = useState<'all' | 'tp' | 'ag' | 'cg' | 'wo'>(
    (['tp', 'ag', 'cg', 'wo'].includes(searchParams.get('platform') ?? '') ? searchParams.get('platform') as 'tp' | 'ag' | 'cg' | 'wo' : 'all')
  );
  const [ratingFilter, setRatingFilter] = useState<number | 'unrated' | 'any' | null>(() => {
    const raw = searchParams.get('rating');
    if (raw === 'unrated') return 'unrated';
    if (raw === 'any') return 'any';
    const r = Number(raw);
    return Number.isInteger(r) && r > 0 ? r : null;
  });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(() => readSortFromStorage(decodedTab).col);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => readSortFromStorage(decodedTab).dir);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [jumpInput, setJumpInput] = useState('');

  const [agentFilter, setAgentFilter] = useState('');
  const [proxyFilter, setProxyFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const { isApproved, session } = useAuth();
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [removedPlatformBrandRows, setRemovedPlatformBrandRows] = useState<{ tab: string; brand: string; platform: Platform }[]>([]);
  const [overrideRows, setOverrideRows] = useState<{ tab: string; brand_key: string; platform: Platform; override_state: OverrideState }[]>([]);
  const [accountUsage, setAccountUsage] = useState<Map<string, Record<Platform, number>>>(new Map());
  const [editingCell, setEditingCell] = useState<{ entryId: string; header: string; value: string } | null>(null);
  const [savingCell, setSavingCell] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const [reloadSeq, setReloadSeq] = useState(0);
  const reloadRef = useRef(() => setReloadSeq((s) => s + 1));
  const lastLoadedTabRef = useRef<string | null>(null);
  // Set right after the tab-change block below restores filters from storage,
  // so the auto-save effect skips the one render where state still holds the
  // previous tab's stale values (state updates from that block haven't
  // committed yet when effects run in the same flush).
  const skipNextFilterSaveRef = useRef(false);
  // Tracks which tab the URL re-sync effect below last processed, so it can
  // tell a genuine tab change (already handled by the effect above) apart
  // from a same-tab query-string change it should still react to.
  const lastResyncedTabRef = useRef<string | null>(null);

  // Sticky toolbar: the column-header row sticks just below this element,
  // offset by its live height. The toolbar's height isn't fixed — it wraps
  // to more lines on narrow viewports and differs in "N selected" mode — so
  // a ResizeObserver keeps the offset correct in every case.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setToolbarHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Drag-to-select state for checkboxes
  const isDraggingRef = useRef(false);
  const dragFirstIdRef = useRef<string | null>(null);
  const dragSessionIdsRef = useRef<Set<string>>(new Set()); // rows selected in current drag
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActiveRef = useRef(false);

  useEffect(() => {
    const stop = () => {
      isDraggingRef.current = false;
      dragFirstIdRef.current = null;
      dragSessionIdsRef.current = new Set();
    };
    document.addEventListener('mouseup', stop);
    return () => document.removeEventListener('mouseup', stop);
  }, []);

  function applyDragToggle(id: string) {
    if (dragSessionIdsRef.current.has(id)) {
      // Dragging back — unselect
      dragSessionIdsRef.current.delete(id);
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    } else {
      // Dragging forward — select
      dragSessionIdsRef.current.add(id);
      setSelectedIds((prev) => { const n = new Set(prev); n.add(id); return n; });
    }
  }

  const [checkingStatus, setCheckingStatus] = useState(false);
  const [refreshingAfterCheck, setRefreshingAfterCheck] = useState(false);
  // Snapshot of the row ids visible on screen when a check was last kicked off, plus the
  // filter/sort/page signature at that moment. While the signature still matches the current
  // one, the table keeps showing exactly those rows (with live cell values) instead of letting
  // a status change silently drop them out of view — the user wants to see what a check just
  // changed. Any filter/sort/search/page interaction changes the signature and lifts the freeze.
  const [checkedViewSnapshot, setCheckedViewSnapshot] = useState<{ ids: string[]; signature: string } | null>(null);
  const [checkDropdownOpen, setCheckDropdownOpen] = useState(false);
  const checkDropdownRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const [lastChecked, setLastChecked] = useState<string | null>(
    () => localStorage.getItem(`lastStatusCheck_${decodedTab}`) ?? null,
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateTargetTab, setDuplicateTargetTab] = useState('');
  const [duplicateBrand, setDuplicateBrand] = useState('');
  const [duplicateAgLink, setDuplicateAgLink] = useState('');
  const [duplicateCgLink, setDuplicateCgLink] = useState('');
  const [crossTabBrandProfiles, setCrossTabBrandProfiles] = useState<Record<string, Record<string, string>>>({});
  const [loadingCrossTab, setLoadingCrossTab] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setLastChecked(localStorage.getItem(`lastStatusCheck_${decodedTab}`) ?? null);
  }, [decodedTab]);

  useEffect(() => {
    let canceled = false;
    fetchRemovedPlatformBrands()
      .then((rows) => { if (!canceled) setRemovedPlatformBrandRows(rows); })
      .catch(() => { /* badge is decorative — a failed fetch just means no badges render */ });
    fetchBrandPlatformOverrides(decodedTab)
      .then((rows) => { if (!canceled) setOverrideRows(rows); })
      .catch(() => { /* same — decorative */ });
    return () => { canceled = true; };
  }, [reloadSeq, decodedTab]);

  useEffect(() => {
    let canceled = false;
    fetchAllEntries()
      .then((all) => { if (!canceled) setAccountUsage(computeAccountPlatformUsage(all)); })
      .catch(() => { /* badges are decorative — a failed fetch just means no badges render */ });
    return () => { canceled = true; };
  }, [reloadSeq]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (checkDropdownRef.current && !checkDropdownRef.current.contains(e.target as Node)) {
        setCheckDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!decodedTab) return;
    let canceled = false;
    // Distinguish an actual tab navigation from a same-tab data reload
    // (reloadSeq bump after an edit/delete/duplicate). Only a real tab change
    // should blank the view and reset filters/sort/page/selection — a same-tab
    // reload must refetch quietly in place so the user's current view sticks.
    const isTabChange = lastLoadedTabRef.current !== decodedTab;

    if (isTabChange) {
      setLoading(true);
      setEntries([]);
      setHeaders([]);
      setFullHeaders([]);
      setError(null);

      // An explicit deep link (e.g. from Score Summary or Overview) always wins
      // over whatever was remembered for this tab. A bare tab URL — including
      // the sidebar's tab links, which never carry a query string — restores
      // the last view instead of always reopening blank.
      const saved = readFiltersFromStorage(decodedTab);
      const hasDeepLinkParams = ['brand', 'platform', 'status', 'rating', 'country'].some((p) => searchParams.has(p));

      setSearch(saved.search ?? '');
      setBrandFilter(hasDeepLinkParams ? (searchParams.get('brand') ?? '') : (saved.brandFilter ?? ''));
      setStatusFilter(hasDeepLinkParams
        ? (STATUS_FILTER_VALUES.includes(searchParams.get('status') as typeof STATUS_FILTER_VALUES[number]) ? searchParams.get('status') as typeof STATUS_FILTER_VALUES[number] : 'all')
        : (STATUS_FILTER_VALUES.includes(saved.statusFilter as typeof STATUS_FILTER_VALUES[number]) ? saved.statusFilter as typeof STATUS_FILTER_VALUES[number] : 'all'));
      setPlatformFilter(hasDeepLinkParams
        ? (['tp', 'ag', 'cg', 'wo'].includes(searchParams.get('platform') ?? '') ? searchParams.get('platform') as 'tp' | 'ag' | 'cg' | 'wo' : 'all')
        : (['tp', 'ag', 'cg', 'wo'].includes(saved.platformFilter ?? '') ? saved.platformFilter as 'tp' | 'ag' | 'cg' | 'wo' : 'all'));
      setRatingFilter(hasDeepLinkParams
        ? (() => {
            const raw = searchParams.get('rating');
            if (raw === 'unrated') return 'unrated';
            if (raw === 'any') return 'any';
            const r = Number(raw);
            return Number.isInteger(r) && r > 0 ? r : null;
          })()
        : (saved.ratingFilter ?? null));
      setAgentFilter(saved.agentFilter ?? '');
      setProxyFilter(saved.proxyFilter ?? '');
      setCountryFilter(hasDeepLinkParams ? (searchParams.get('country') ?? '') : (saved.countryFilter ?? ''));
      setDateFrom(saved.dateFrom ?? '');
      setDateTo(saved.dateTo ?? '');
      setPage(1);
      setJumpInput('');
      setSelectedIds(new Set());
      skipNextFilterSaveRef.current = true;
    }

    (async () => {
      try {
        const [rawEntries, tabHeaders] = await Promise.all([
          fetchRawEntriesByTab(decodedTab),
          fetchTabHeaders(decodedTab),
        ]);
        if (canceled) return;
        const configCols = getTabColumns(decodedTab);
        const visible = configCols
          ? configCols
              .filter((col) => !TABLE_HIDDEN_COLS.has(col))
              .map((col) => {
                const colLower = col.toLowerCase();
                return (
                  // 1. Exact case-insensitive match
                  tabHeaders.find((h) => h.toLowerCase() === colLower) ??
                  // 2. Match via display label
                  tabHeaders.find((h) => (COLUMN_LABELS[h] ?? h).toLowerCase() === colLower) ??
                  // 3. TP status variant fallback (e.g. config says 'TP Review Status'
                  //    but sheet header is 'Trust pilot Review Status')
                  (TP_STATUS_VARIANTS.has(col)
                    ? tabHeaders.find((h) => TP_STATUS_VARIANTS.has(h))
                    : undefined) ??
                  // 4. Fallback to the config col name itself — keeps whitelisted columns
                  //    (e.g. Brands) visible even when tab_schemas is stale and doesn't
                  //    yet include that column. Once a sync runs the tabHeaders match
                  //    takes over; until then the column shows (possibly empty) and the
                  //    brand filter uses it instead of falling back to Account Name.
                  col
                );
              })
          : tabHeaders.filter((h) => !HIDDEN_COLS.has(h.toLowerCase()));
        // For configured tabs (explicit whitelist), show all whitelisted columns even
        // if some have no data yet — prevents Brands from being dropped and falling
        // back to Account Name in the brand filter.
        const populated = configCols
          ? visible
          : visible.filter((h) =>
              rawEntries.some((e) => { const v = e.data[h]; return v != null && v !== ''; }),
            );
        // Filter out ghost rows — sheet auto-generates IDs for blank rows; skip any
        // entry where every data field is null or empty.
        const realEntries = rawEntries.filter((e) =>
          Object.values(e.data).some((v) => v != null && v.trim() !== ''),
        );
        setEntries(realEntries);
        setHeaders(populated);
        setFullHeaders(tabHeaders);
        setError(null);

        // Auto-fill AG/CG links: for each brand, propagate any existing link to
        // rows of the same brand that are still missing it.
        const activeLinkCols = BRAND_LINK_COLS.filter((c) => populated.includes(c));
        const detectedBrandCol = BRAND_COLS.find((c) => populated.includes(c)) ?? null;
        if (activeLinkCols.length > 0 && detectedBrandCol) {
          const brandLinks: Record<string, Record<string, string>> = {};
          for (const entry of rawEntries) {
            const brand = entry.data[detectedBrandCol];
            if (!brand || brand.trim() === '') continue;
            for (const col of activeLinkCols) {
              const link = entry.data[col];
              if (link && link.trim() !== '' && link !== '—') {
                if (!brandLinks[brand]) brandLinks[brand] = {};
                if (!brandLinks[brand][col]) brandLinks[brand][col] = link.trim();
              }
            }
          }
          const toUpdate: Array<{ entry: typeof rawEntries[0]; fields: Record<string, string> }> = [];
          for (const entry of rawEntries) {
            const brand = entry.data[detectedBrandCol];
            if (!brand || !brandLinks[brand]) continue;
            const fields: Record<string, string> = {};
            for (const col of activeLinkCols) {
              const existing = entry.data[col];
              const brandLink = brandLinks[brand][col];
              if (brandLink && (!existing || existing.trim() === '' || existing === '—')) {
                fields[col] = brandLink;
              }
            }
            if (Object.keys(fields).length > 0) toUpdate.push({ entry, fields });
          }
          if (toUpdate.length > 0) {
            let filled = 0;
            await Promise.allSettled(
              toUpdate.map(async ({ entry, fields }) => {
                try {
                  await updateEntryData(entry.id, entry.tab, fields);
                  filled++;
                } catch (err) {
                  console.warn('[auto-fill-links] update failed:', err);
                }
              }),
            );
            if (!canceled && filled > 0) {
              setToast({ message: `${filled} row${filled !== 1 ? 's' : ''} auto-filled`, kind: 'success' });
            }
          }
        }
        lastLoadedTabRef.current = decodedTab;
        if (isTabChange) {
          const saved = readSortFromStorage(decodedTab);
          const validSavedCol = saved.col && populated.includes(saved.col) ? saved.col : null;
          if (validSavedCol) {
            setSortCol(validSavedCol);
            setSortDir(saved.dir);
          } else if (getTabSequence(decodedTab)) {
            // Tabs with a fixed brand-sequence default (TP Brand Injection, TP
            // Affiliate) must land on that sequence order on a fresh load —
            // auto-picking the date column here would immediately defeat the
            // `!sortCol` check the sequence sort relies on.
            setSortCol(null);
            setSortDir('desc');
          } else {
            const defaultDateCol = ENTRY_DATE_COLS.find((col) =>
              populated.some((h) => h.toLowerCase() === col.toLowerCase()),
            );
            const matched = defaultDateCol
              ? populated.find((h) => h.toLowerCase() === defaultDateCol.toLowerCase())
              : undefined;
            setSortCol(matched ?? null);
            setSortDir(matched ? 'desc' : 'asc');
          }
        }
        // Same-tab reload (edit save / delete / duplicate / realtime): preserve
        // current sort, filters, page, and selection — only entries/headers refresh.
      } catch (err) {
        if (canceled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!canceled) {
          setLoading(false);
          setRefreshingAfterCheck(false);
        }
      }
    })();

    return () => { canceled = true; };
  }, [decodedTab, reloadSeq]);

  // Re-sync platform/status/brand/rating from the URL whenever the query string changes on an
  // already-mounted tab — e.g. clicking from one Score Summary star-count link to another
  // for the same brand-group tab. The effect above only re-derives these on an actual tab
  // change; without this, such same-tab navigations would silently keep the old filters.
  useEffect(() => {
    if (lastResyncedTabRef.current !== decodedTab) {
      // An actual tab change (including a fresh mount) is already fully handled
      // by the effect above, which also falls back to the remembered per-tab
      // view when the URL carries no filter params — running the URL-only sync
      // below too would immediately blank out whatever that effect restored.
      lastResyncedTabRef.current = decodedTab;
      return;
    }
    const p = searchParams.get('platform');
    setPlatformFilter(['tp', 'ag', 'cg', 'wo'].includes(p ?? '') ? (p as 'tp' | 'ag' | 'cg' | 'wo') : 'all');
    const s = searchParams.get('status');
    setStatusFilter(STATUS_FILTER_VALUES.includes(s as typeof STATUS_FILTER_VALUES[number]) ? (s as typeof STATUS_FILTER_VALUES[number]) : 'all');
    setBrandFilter(searchParams.get('brand') ?? '');
    setCountryFilter(searchParams.get('country') ?? '');
    const raw = searchParams.get('rating');
    if (raw === 'unrated') {
      setRatingFilter('unrated');
    } else if (raw === 'any') {
      setRatingFilter('any');
    } else {
      const r = Number(raw);
      setRatingFilter(Number.isInteger(r) && r > 0 ? r : null);
    }
  }, [searchParams, decodedTab]);

  // Remember the current view per tab so it can be restored on return (see the
  // tab-change block above). Skipped once right after that block runs: its
  // setState calls haven't committed yet when this effect fires in the same
  // flush, so without the guard it would immediately overwrite the just-read
  // storage with the previous tab's stale values.
  useEffect(() => {
    if (skipNextFilterSaveRef.current) {
      skipNextFilterSaveRef.current = false;
      return;
    }
    if (!decodedTab) return;
    writeFiltersToStorage(decodedTab, {
      search, brandFilter, agentFilter, proxyFilter, countryFilter,
      statusFilter, platformFilter, ratingFilter, dateFrom, dateTo,
    });
  }, [decodedTab, search, brandFilter, agentFilter, proxyFilter, countryFilter, statusFilter, platformFilter, ratingFilter, dateFrom, dateTo]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page]);

  useEffect(() => {
    return subscribeEntries((payload) => {
      // Only react to changes for the current tab — avoids flicker when another
      // tab gets updated by import-tabs's full-sync sweep.
      const tabOfChange = (payload.new?.tab ?? payload.old?.tab) as string | undefined;
      if (tabOfChange && tabOfChange !== decodedTab) return;

      if (payload.eventType === 'UPDATE' && payload.new) {
        const updated = payload.new as Entry;
        setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        return;
      }
      if (payload.eventType === 'DELETE' && payload.old) {
        const deletedId = (payload.old as { id?: string }).id;
        if (deletedId) setEntries((prev) => prev.filter((e) => e.id !== deletedId));
        return;
      }
      // INSERT or unknown event — fall back to a full refetch so newly-added
      // rows respect any current filtering/sorting.
      reloadRef.current();
    });
  }, [decodedTab]);

  // Derived: search → brand → platform → status → date → sort → paginate

  // Which platform cards are relevant for this tab.
  // Check the tab's column config first (definitive); fall back to loaded headers
  // so tabs without a config whitelist still work.
  const activePlatforms = (() => {
    const configCols = getTabColumns(decodedTab);
    const colSet = new Set(configCols ?? headers);
    const result: ('tp' | 'ag' | 'cg')[] = [];
    if ([...TP_STATUS_VARIANTS].some((v) => colSet.has(v))) result.push('tp');
    if (colSet.has('AG Review Status')) result.push('ag');
    if (colSet.has('CG Review Status')) result.push('cg');
    return result;
  })();

  const GUEST_HIDDEN_COLS = new Set(['User Name', 'AG User', 'CG User']);

  // Hide other platforms' columns when a specific platform is selected.
  const visibleHeaders = (platformFilter !== 'all' && activePlatforms.length > 1
    ? headers.filter((h) => {
        for (const [key, cols] of Object.entries(PLATFORM_OWN_COLS) as ['tp' | 'ag' | 'cg', Set<string>][]) {
          if (key !== platformFilter && cols.has(h)) return false;
        }
        return true;
      })
    : headers
  ).filter((h) => session || !GUEST_HIDDEN_COLS.has(h));

  const removedPlatformBrandSet = useMemo(() => buildRemovedPlatformBrandSet(removedPlatformBrandRows), [removedPlatformBrandRows]);
  function isPlatformRemoved(brandName: string | null | undefined, platform: Platform): boolean {
    return !!brandName && removedPlatformBrandSet.has(platformRemovedKey(decodedTab, brandName, platform));
  }
  // Every platform actually active on this tab (getTabPlatforms) that's
  // currently flagged for this brand — drives one badge per flagged platform.
  function removedPlatformsFor(brandName: string | null | undefined): Platform[] {
    if (!brandName) return [];
    return getTabPlatforms(decodedTab).filter((p) => isPlatformRemoved(brandName, p));
  }

  const overrideMap = useMemo(() => buildOverrideMap(overrideRows), [overrideRows]);
  function overridesFor(brandName: string | null | undefined): Partial<Record<Platform, OverrideState>> {
    if (!brandName) return {};
    const brandKey = normalizeBrandKey(brandName);
    const out: Partial<Record<Platform, OverrideState>> = {};
    for (const p of getTabPlatforms(decodedTab)) {
      const state = overrideMap.get(overrideKey(decodedTab, brandKey, p));
      if (state) out[p] = state;
    }
    return out;
  }

  const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? null;
  const uniqueBrands = brandCol
    ? [...new Set(entries.map((e) => e.data[brandCol]).filter((v): v is string => !!v && v.trim() !== ''))].sort()
    : [];
  if (uniqueBrands.length === 0 && TAB_DEFAULT_BRAND[decodedTab]) uniqueBrands.push(TAB_DEFAULT_BRAND[decodedTab]);

  const brandProfiles = useMemo<Record<string, Record<string, string>>>(() => {
    if (!brandCol) return {};
    const LINK_COLS = ['Link to the profile', 'AG Review Link', 'CG Review Link', 'URL PAGE__href', 'Brand Link'];
    // Count occurrences per brand+col so a handful of mistyped/copy-pasted outlier
    // rows can't outrank the value the vast majority of that brand's rows agree on.
    const counts: Record<string, Record<string, Record<string, number>>> = {};
    for (const entry of entries) {
      const brand = entry.data[brandCol]?.trim();
      if (!brand) continue;
      if (!counts[brand]) counts[brand] = {};
      for (const col of LINK_COLS) {
        const val = entry.data[col]?.trim();
        if (!val || val === '—') continue;
        if (!counts[brand][col]) counts[brand][col] = {};
        counts[brand][col][val] = (counts[brand][col][val] ?? 0) + 1;
      }
    }
    const profiles: Record<string, Record<string, string>> = {};
    for (const [brand, cols] of Object.entries(counts)) {
      profiles[brand] = {};
      for (const [col, valueCounts] of Object.entries(cols)) {
        let best = '';
        let bestCount = 0;
        for (const [val, n] of Object.entries(valueCounts)) {
          if (n > bestCount) { best = val; bestCount = n; }
        }
        profiles[brand][col] = best;
      }
    }
    return profiles;
  }, [entries, brandCol]);

  async function saveInlineEdit(entry: Entry, header: string, value: string) {
    const fields: Record<string, string | null> = { [header]: value || null };
    // When AG Added date is set, auto-populate AG Review Link from this brand's profile
    if (header === 'Ask Gambler review added' && value && brandCol) {
      const brand = entry.data[brandCol]?.trim();
      const link = brand ? brandProfiles[brand]?.['AG Review Link'] : undefined;
      if (link) fields['AG Review Link'] = link;
    }
    // When CG Added date is set, auto-populate CG Review Link from this brand's profile
    if (header === 'Casino Guru review added' && value && brandCol) {
      const brand = entry.data[brandCol]?.trim();
      const link = brand ? brandProfiles[brand]?.['CG Review Link'] : undefined;
      if (link) fields['CG Review Link'] = link;
    }
    setSavingCell(true);
    try {
      await updateEntryData(entry.id, entry.tab, fields);
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, data: { ...e.data, ...fields } } : e)),
      );
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to save', kind: 'error' });
    } finally {
      setSavingCell(false);
      setEditingCell(null);
    }
  }

  async function loadCrossTabBrandProfiles(tab: string) {
    if (tab === decodedTab) return;
    setLoadingCrossTab(true);
    try {
      const rawEntries = await fetchRawEntriesByTab(tab);
      const profiles: Record<string, Record<string, string>> = {};
      for (const entry of rawEntries) {
        const brand = BRAND_COLS.map((c) => entry.data[c]).find((v) => v && v.trim()) ?? '';
        if (!brand) continue;
        if (!profiles[brand]) profiles[brand] = {};
        for (const col of ['AG Review Link', 'CG Review Link']) {
          const val = entry.data[col];
          if (val && val.trim() && val !== '—' && !profiles[brand][col]) {
            profiles[brand][col] = val.trim();
          }
        }
      }
      setCrossTabBrandProfiles(profiles);
    } finally {
      setLoadingCrossTab(false);
    }
  }

  function handleDuplicateTabChange(tab: string) {
    setDuplicateTargetTab(tab);
    setDuplicateBrand('');
    setDuplicateAgLink('');
    setDuplicateCgLink('');
    if (tab !== decodedTab) loadCrossTabBrandProfiles(tab);
  }

  function handleDuplicateBrandChange(brand: string) {
    setDuplicateBrand(brand);
    const activeTab = duplicateTargetTab || decodedTab;
    const profiles = activeTab === decodedTab ? brandProfiles : crossTabBrandProfiles;
    const profile = profiles[brand] ?? {};
    setDuplicateAgLink(profile['AG Review Link'] ?? '');
    setDuplicateCgLink(profile['CG Review Link'] ?? '');
  }

  async function handleDuplicate() {
    const toInsert = entries.filter((e) => selectedIds.has(e.id));
    setDuplicating(true);
    let done = 0;
    const d = new Date();
    const todayStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const CLEAR_ON_DUPLICATE = new Set([
      'Redirection work used',
      'Redirection Serch engine',
      'Review Language',
      'Link to the profile',
      'TP Review Status',
      'Trust Pilot Review Status',
      'Trustpilot Review Status',
      'Trust pilot Review Status',
      'Review Status',
      'Agent',
      'Ask Gambler review added',
      'AG Review Status',
      'AG Review Link',
      'Casino Guru review added',
      'CG Review Status',
      'CG Review Link',
      'AG User',
      'CG User',
      ...REVIEW_TEXT_KEYS,
    ]);
    try {
      const targetTab = duplicateTargetTab || decodedTab;
      for (const entry of toInsert) {
        const fields: Record<string, string | null> = {};
        for (const k of Object.keys(entry.data)) {
          if (k === 'Account') fields[k] = entry.data[k] ? `${entry.data[k]} dup` : null;
          else if (k === 'Trust Pilot' || k === 'Wizard of Odds') fields[k] = todayStr;
          else if (CLEAR_ON_DUPLICATE.has(k)) fields[k] = null;
          else fields[k] = entry.data[k] ?? null;
        }
        // Country tracks the duplicated Account text (with its " dup" suffix
        // stripped by getCountryForAccount), not the source row's stored value.
        fields['Country'] = getCountryForAccount(fields['Account'], targetTab) || null;
        // Apply brand override if selected
        if (duplicateBrand && brandCol) fields[brandCol] = duplicateBrand;
        // Apply AG/CG link overrides if provided
        if (duplicateAgLink) fields['AG Review Link'] = duplicateAgLink;
        if (duplicateCgLink) fields['CG Review Link'] = duplicateCgLink;
        await insertEntry(targetTab, fields);
        done++;
      }
      reloadRef.current();
      setSelectedIds(new Set());
      setSortCol(null);
      setPage(1);
      setToast({ message: `${done} row${done === 1 ? '' : 's'} duplicated`, kind: 'success' });
    } catch {
      reloadRef.current();
      setToast({
        message: `Duplicated ${done} of ${toInsert.length} rows — an error occurred`,
        kind: 'error',
      });
    } finally {
      setDuplicating(false);
      setShowDuplicateModal(false);
    }
  }

  async function handleDelete() {
    const ids = [...selectedIds];
    setDeleting(true);
    try {
      await deleteEntries(ids, decodedTab);
      setEntries((prev) => prev.filter((e) => !new Set(ids).has(e.id)));
      reloadRef.current();
      setSelectedIds(new Set());
      setToast({ message: `${ids.length} row${ids.length === 1 ? '' : 's'} deleted`, kind: 'success' });
    } catch {
      setToast({ message: 'Delete failed — please try again', kind: 'error' });
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
      setDeleteConfirmText('');
    }
  }

  const agentCol = headers.includes('Agent') ? 'Agent' : null;
  const uniqueAgents = agentCol
    ? [...new Set(entries.map((e) => e.data[agentCol]).filter((v): v is string => !!v && v.trim() !== ''))].sort()
    : [];

  const uniqueProxies = headers.includes('Proxy Used')
    ? (() => {
        const seen = new Map<string, string>();
        for (const e of entries) {
          const v = e.data['Proxy Used'];
          if (v && v.trim()) {
            const key = canonicalProxyKey(v);
            if (!seen.has(key)) seen.set(key, canonicalProxyName(v));
          }
        }
        return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      })()
    : [];

  const uniqueCountries = headers.includes('Country')
    ? (() => {
        const seen = new Map<string, string>();
        for (const e of entries) {
          const v = getEntryCountry(e.data, decodedTab);
          if (v) {
            const key = v.toLowerCase();
            if (!seen.has(key)) seen.set(key, v);
          }
        }
        return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      })()
    : [];

  const searchFiltered = search.trim()
    ? entries.filter((e) =>
        headers.some((h) => {
          const v = e.data[h];
          return v != null && v.toLowerCase().includes(search.toLowerCase());
        }),
      )
    : entries;

  const brandFiltered = brandFilter && brandCol
    ? (() => {
        const group = getBrandGroup(decodedTab, brandFilter);
        return group
          ? searchFiltered.filter((e) => group.some((v) => v.trim() === (e.data[brandCol] ?? '').trim()))
          : searchFiltered.filter((e) => e.data[brandCol] === brandFilter);
      })()
    : searchFiltered;

  const agentFiltered = agentFilter && agentCol
    ? brandFiltered.filter((e) => e.data[agentCol] === agentFilter)
    : brandFiltered;

  const proxyFiltered = proxyFilter
    ? agentFiltered.filter((e) => canonicalProxyKey(e.data['Proxy Used'] ?? '') === canonicalProxyKey(proxyFilter))
    : agentFiltered;

  const countryFiltered = countryFilter
    ? proxyFiltered.filter((e) => canonicalCountryKey(resolveCountryLabel(e.data, decodedTab)) === canonicalCountryKey(countryFilter))
    : proxyFiltered;

  // Platform filter only affects visible columns, not row filtering.
  const platformFiltered = countryFiltered;

  const statusCols = headers.filter(isStatusCol);
  // When a platform card is selected, only check that platform's status column(s).
  const activeStatusCols = platformFilter === 'all'
    ? statusCols
    : platformFilter === 'tp'
      ? statusCols.filter((h) => TP_STATUS_VARIANTS.has(h))
      : statusCols.filter((h) => h.toLowerCase() === PLATFORM_STATUS_COL[platformFilter].toLowerCase());

  // Rating filter (arrives via Score Summary star-count/Total links): only meaningful when a
  // specific platform is active, since a rating value is only comparable within one
  // platform's score column. Matches Published-status rows only, exactly mirroring what
  // Score Summary counted — not "any status with that score." 'any' matches every Published
  // row for the platform regardless of score, mirroring a Score Summary Total link.
  const activePlatformForRating = platformFilter !== 'all' ? platformFilter : null;
  const ratingFiltered = (() => {
    if (ratingFilter == null || !activePlatformForRating) return platformFiltered;
    const maxScore = PLATFORM_MAX_SCORE[activePlatformForRating];
    const candidates = PLATFORM_SCORE_COLS[activePlatformForRating];
    return platformFiltered.filter((e) => {
      if (!activeStatusCols.some((h) => (e.data[h] ?? '').trim().toLowerCase() === 'published')) return false;
      if (ratingFilter === 'any') return true;
      const raw = candidates.map((c) => e.data[c]).find((v) => v != null && v !== '');
      const score = parseScore(raw, maxScore);
      return ratingFilter === 'unrated' ? score == null : score === ratingFilter;
    });
  })();

  const dateActive = !!(dateFrom || dateTo);
  const relevantPlatforms = platformFilter !== 'all' ? [platformFilter] : getTabPlatforms(decodedTab);

  // A row matches if ANY relevant platform's own status+date state satisfies
  // the current filters — status and date are checked against the SAME
  // platform, not independently (a Live status on AG can no longer "borrow"
  // an unrelated in-range date from TP on the same row). This is the same
  // per-platform coupling the KPI cards (countPlatform/displayTotals) already
  // use, so the table can no longer disagree with the cards above it as
  // platform/date filters change. The flag check only applies to an actual
  // status match (live/removed/etc.) — a flagged platform's date can still
  // place the row in range under "All statuses", matching the pre-existing
  // rule that a flagged brand's row still shows in the table (with its
  // badge), just excluded from the counts.
  function matchesPlatform(e: { data: Record<string, string | null> }, platform: Platform): boolean {
    if (dateActive && !passesPlatformDateFilter(e.data, platform, dateFrom, dateTo)) return false;
    if (statusFilter === 'all') return true;
    if (brandCol && isPlatformRemoved(e.data[brandCol], platform)) return false;
    const col = platformStatusCol(headers, platform);
    if (!col) return false;
    const v = (e.data[col] ?? '').toLowerCase();
    if (statusFilter === 'live') return isLive(v);
    if (statusFilter === 'removed') return isRemoved(v);
    if (statusFilter === 'done') return isDone(v);
    if (statusFilter === 'on-pause') return isOnPause(v);
    if (statusFilter === 'pending') return isPending(v);
    if (statusFilter === 'not-done') return isNotDone(v);
    return false;
  }

  const filtered = ratingFiltered.filter((e) => relevantPlatforms.some((p) => matchesPlatform(e, p)));

  // Platform card counts — computed from ratingFiltered with each platform's
  // own date-range check (passesPlatformDateFilter) so they always reflect
  // active filters without double-applying a second, coarser date filter.
  const displayKpis = (() => {
    function countPlatform(key: 'tp' | 'ag' | 'cg') {
      const statusCol = key === 'tp'
        ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
        : (headers.find((h) => h.toLowerCase() === PLATFORM_STATUS_COL[key].toLowerCase()) ?? null);
      if (!statusCol) return { live: 0, removed: 0 };
      let live = 0, removed = 0;
      for (const e of ratingFiltered) {
        // A brand whose page on THIS platform has been delisted entirely
        // shouldn't count toward this card's Live/Removed totals — independent
        // per platform, matching the same exclusion applied in Score Summary.
        if (brandCol && isPlatformRemoved(e.data[brandCol], key)) continue;
        if (dateActive && !passesPlatformDateFilter(e.data, key, dateFrom, dateTo)) continue;
        const v = (e.data[statusCol] ?? '').toLowerCase();
        if (isLive(v)) live++;
        else if (isRemoved(v)) removed++;
      }
      return { live, removed };
    }
    return { tp: countPlatform('tp'), ag: countPlatform('ag'), cg: countPlatform('cg') };
  })();

  function isLive(v: string) {
    return v.includes('live') || (v.includes('publish') && !v.includes('not pub'));
  }
  function isRemoved(v: string) {
    return v.includes('remov') || v.includes('refus') || v.includes('reject');
  }
  function isDone(v: string) {
    return v === 'done';
  }
  function isNotDone(v: string) {
    return v === 'not done' || v.includes('not done');
  }
  function isOnPause(v: string) {
    return v.includes('pause');
  }
  function isPending(v: string) {
    return v.toLowerCase().includes('pending') || v.toLowerCase() === 'not published';
  }

  // Top KPI card counts — always reflect the active filter combination.
  const displayTotals = (() => {
    if (activePlatforms.length > 1) {
      // Scope to the selected platform card; fall back to all when none chosen.
      const selectedPlatforms =
        platformFilter !== 'all' && activePlatforms.includes(platformFilter as 'tp' | 'ag' | 'cg')
          ? [platformFilter as 'tp' | 'ag' | 'cg']
          : activePlatforms;
      const live = selectedPlatforms.reduce((s, k) => s + displayKpis[k].live, 0);
      const removed = selectedPlatforms.reduce((s, k) => s + displayKpis[k].removed, 0);
      return { total: live + removed, live, removed };
    }
    // Local `activePlatforms` above only ever tracks tp/ag/cg (it never
    // includes 'wo') and is empty for the Wizard of Odds tab specifically —
    // so this branch also covers WO-only tabs, not just TP-only ones. Use the
    // shared getTabPlatforms(tab) helper (which correctly returns ['wo'] for
    // Wizard of Odds) to know which single platform this loop is implicitly
    // counting, instead of assuming 'tp'.
    const soloPlatform: Platform = getTabPlatforms(decodedTab)[0] ?? 'tp';
    let live = 0, removed = 0;
    for (const e of ratingFiltered) {
      if (brandCol && isPlatformRemoved(e.data[brandCol], soloPlatform)) continue;
      if (dateActive && !passesPlatformDateFilter(e.data, soloPlatform, dateFrom, dateTo)) continue;
      const statuses = statusCols.map((h) => (e.data[h] ?? '').toLowerCase()).filter(Boolean);
      if (statuses.some(isLive)) live++;
      else if (statuses.some(isRemoved)) removed++;
    }
    return { total: live + removed, live, removed };
  })();

  // First visible date column — used as implicit default sort when no column is active.
  const implicitDateCol = headers.find((h) => isDateCol(h)) ?? null;

  const sorted = (() => {
    const seq = getTabSequence(decodedTab);
    const seqCol = getTabSequenceCol(decodedTab);
    if (seq && seqCol && !sortCol) {
      const seqLower = seq.map(s => s.toLowerCase());
      return [...filtered].sort((a, b) => {
        // Primary: most recent date first
        if (implicitDateCol) {
          const da = parseCellDate(a.data[implicitDateCol] ?? '');
          const db = parseCellDate(b.data[implicitDateCol] ?? '');
          if (da && db && da.getTime() !== db.getTime()) return db.getTime() - da.getTime();
          if (!da && db) return 1;
          if (da && !db) return -1;
        }
        // Secondary: brand sequence order within the same date
        const aName = (a.data[seqCol] ?? '').trim().toLowerCase();
        const bName = (b.data[seqCol] ?? '').trim().toLowerCase();
        const ai = seqLower.indexOf(aName);
        const bi = seqLower.indexOf(bName);
        const aIdx = ai === -1 ? seq.length : ai;
        const bIdx = bi === -1 ? seq.length : bi;
        return aIdx - bIdx;
      });
    }
    const col = sortCol ?? implicitDateCol;
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const av = col === 'Country' ? getEntryCountry(a.data, decodedTab) : (a.data[col] ?? '');
      const bv = col === 'Country' ? getEntryCountry(b.data, decodedTab) : (b.data[col] ?? '');
      if (isDateCol(col)) {
        const da = parseCellDate(av);
        const db = parseCellDate(bv);
        const acctCmp = (b.data['Account'] ?? '').localeCompare(a.data['Account'] ?? '', undefined, { numeric: true, sensitivity: 'base' });
        if (!da && !db) return acctCmp;
        if (!da) return 1;
        if (!db) return -1;
        const dir = sortCol ? sortDir : 'desc';
        const timeCmp = dir === 'asc' ? da.getTime() - db.getTime() : db.getTime() - da.getTime();
        return timeCmp !== 0 ? timeCmp : acctCmp;
      }
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  })();

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const liveViewSignature = JSON.stringify([
    decodedTab, search, brandFilter, agentFilter, proxyFilter, countryFilter,
    statusFilter, platformFilter, dateFrom, dateTo, sortCol, sortDir, safePage, pageSize,
  ]);
  const checkedViewFrozen = checkedViewSnapshot?.signature === liveViewSignature;
  const pageRows = checkedViewFrozen
    ? checkedViewSnapshot!.ids
        .map((id) => entries.find((e) => e.id === id))
        .filter((e): e is Entry => !!e)
    : sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function handleSort(col: string) {
    if (isNoSortCol(col)) return;
    let newCol: string | null;
    let newDir: 'asc' | 'desc';
    const secondDir = isDateCol(col) ? 'asc' : 'desc';
    if (sortCol === col) {
      if (sortDir === secondDir) {
        // Third click: clear back to this tab's default order (fixed brand
        // sequence when defined, otherwise implicit newest-first date sort).
        newCol = null;
        newDir = 'asc';
      } else {
        newCol = col;
        newDir = secondDir;
      }
    } else {
      newCol = col;
      newDir = isDateCol(col) ? 'desc' : 'asc';
    }
    setSortCol(newCol);
    setSortDir(newDir);
    writeSortToStorage(decodedTab, newCol, newDir);
    setPage(1);
  }

  function handleSearch(val: string) {
    setSearch(val);
    setPage(1);
  }

  function handlePageSize(val: number) {
    setPageSize(val);
    setPage(1);
    setJumpInput('');
  }

  function handleJump(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const n = parseInt(jumpInput, 10);
    if (!isNaN(n)) setPage(Math.min(totalPages, Math.max(1, n)));
    setJumpInput('');
  }

  async function handleCheckStatus(platforms: ('tp' | 'ag' | 'cg' | 'wo')[]) {
    setCheckingStatus(true);
    setCheckDropdownOpen(false);
    // Freeze exactly what's on screen right now so status updates from this check
    // update in place instead of dropping rows out of the current filtered view.
    setCheckedViewSnapshot({ ids: pageRows.map((e) => e.id), signature: liveViewSignature });
    // Every platform normally skips Published/Removed entries to avoid re-scraping
    // every already-resolved account on every run. Filtering the table — by status,
    // brand, agent, proxy, or country — and then clicking Check Status scopes that
    // run to exactly what's currently filtered, for whichever platform(s) it covers.
    const activeStatusFilter = statusFilter !== 'all' ? statusFilter : undefined;
    const filterLabel = activeStatusFilter ? STATUS_OPTS.find((o) => o.value === statusFilter)?.label : undefined;
    const scope: StatusCheckScope = {
      statusFilter: activeStatusFilter,
      brands: brandFilter ? (getBrandGroup(decodedTab, brandFilter) ?? [brandFilter]) : undefined,
      agent: agentFilter || undefined,
      proxy: proxyFilter || undefined,
      country: countryFilter || undefined,
    };
    try {
      const results: { checked?: number; updated: number; errors: number; sheet_errors?: number }[] = [];
      // Populated when the request itself failed (e.g. another check already
      // running on the server) rather than individual entries erroring during
      // the scrape — surfaced directly instead of the generic fallback below.
      const requestErrors: string[] = [];
      for (const p of platforms) {
        try {
          let r: { checked: number; updated: number; errors: number; sheet_errors?: number };
          if (p === 'tp') r = await triggerStatusCheck(decodedTab, scope);
          else if (p === 'ag') r = await triggerAgStatusCheck(decodedTab, scope);
          else if (p === 'cg') r = await triggerCgStatusCheck(decodedTab, scope);
          else r = await triggerWoStatusCheck(decodedTab, scope);
          results.push(r);
        } catch (err) {
          requestErrors.push(err instanceof Error ? err.message : String(err));
          results.push({ updated: 0, errors: 1 });
        }
      }

      let totalChecked = 0;
      let totalUpdated = 0;
      let totalErrors = 0;
      let totalSheetErrors = 0;
      for (const r of results) {
        totalChecked     += r.checked ?? 0;
        totalUpdated     += r.updated ?? 0;
        totalErrors      += r.errors  ?? 0;
        totalSheetErrors += r.sheet_errors ?? 0;
      }

      const now = new Date().toLocaleString();
      localStorage.setItem(`lastStatusCheck_${decodedTab}`, now);
      setLastChecked(now);

      let msg: string;
      let kind: ToastKind;
      if (totalErrors > 0 && totalUpdated === 0) {
        msg = requestErrors.length > 0
          ? [...new Set(requestErrors)].join('; ')
          : `${totalErrors} check${totalErrors !== 1 ? 's' : ''} failed — server may not be running`;
        kind = 'error';
      } else if (totalUpdated > 0 && totalErrors > 0 && totalSheetErrors > 0) {
        msg = `${totalUpdated} updated, ${totalErrors} checks failed, ${totalSheetErrors} sheet sync failed`;
        kind = 'error';
      } else if (totalUpdated > 0 && totalSheetErrors > 0) {
        msg = `${totalUpdated} updated in dashboard but ${totalSheetErrors} failed to sync to Google Sheet`;
        kind = 'error';
      } else if (totalUpdated > 0 && totalErrors > 0) {
        msg = `${totalUpdated} updated, ${totalErrors} failed`;
        kind = 'success';
      } else if (totalUpdated > 0) {
        msg = `${totalUpdated} review${totalUpdated !== 1 ? 's' : ''} updated`;
        kind = 'success';
      } else if (totalChecked > 0) {
        msg = `Checked ${totalChecked} ${filterLabel ? `${filterLabel} ` : ''}entr${totalChecked !== 1 ? 'ies' : 'y'} — no status changes`;
        kind = 'success';
      } else {
        msg = filterLabel ? `No ${filterLabel} entries found to check` : 'No entries found to check';
        kind = 'success';
      }
      setToast({ message: msg, kind });
      setRefreshingAfterCheck(true);
      reloadRef.current();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setToast({ message: `Check failed: ${detail}`, kind: 'error' });
      console.error(err);
    } finally {
      setCheckingStatus(false);
    }
  }

  // The Edit Entry modal's initial per-platform checkbox state for the entry
  // currently being edited. Computed once per render (not inside onSave's
  // closure) so onSave can diff the saved set against it and only call
  // setBrandPlatformRemoved for platforms whose checkbox actually changed —
  // otherwise every routine save of an already-flagged brand's row would
  // re-fire every toggle, silently overwriting removed_by/removed_at for no
  // reason.
  const initialRemovedPlatformsForEditEntry: Platform[] =
    editEntry && brandCol ? removedPlatformsFor(editEntry.data[brandCol]) : [];
  const initialOverridesForEditEntry: Partial<Record<Platform, OverrideState>> =
    editEntry && brandCol ? overridesFor(editEntry.data[brandCol]) : {};

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6 -mt-6 md:-mt-8 pt-[10px]">
      {/* Page actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-[10px]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500 shrink-0">Date range</span>
          <DatePicker
            value={dateFrom}
            onChange={(v) => { setDateFrom(v); setPage(1); }}
            placeholder="From date"
            max={dateTo || undefined}
          />
          <span className="text-xs text-slate-400">→</span>
          <DatePicker
            value={dateTo}
            onChange={(v) => { setDateTo(v); setPage(1); }}
            placeholder="To date"
            min={dateFrom || undefined}
          />
        </div>
        {isApproved && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#000060] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#000060]/90 transition-colors"
          >
            <Plus className="size-4" />
            Add Review Account
          </button>
        )}
      </div>

      {activePlatforms.length <= 1 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 mt-[10px]">
          <KpiCard
            label="Total"
            value={loading ? '…' : displayTotals.total.toLocaleString()}
            icon={<Building2 className="size-4" />}
            onClick={() => setShowTotalModal(true)}
          />
          <KpiCard
            label="Live"
            value={loading ? '…' : displayTotals.live.toLocaleString()}
            hint="Reviews live or published"
            color="emerald"
            onClick={() => { setStatusFilter(statusFilter === 'live' ? 'all' : 'live'); setPage(1); }}
            active={statusFilter === 'live'}
          />
          <KpiCard
            label="Removed"
            value={loading ? '…' : displayTotals.removed.toLocaleString()}
            hint="Reviews removed or refused"
            color="rose"
            onClick={() => { setStatusFilter(statusFilter === 'removed' ? 'all' : 'removed'); setPage(1); }}
            active={statusFilter === 'removed'}
          />
          <KpiCard
            label="Success Rate"
            value={loading ? '…' : <SuccessRateBadge live={displayTotals.live} removed={displayTotals.removed} />}
            hint="Live ÷ (Live + Removed)"
            color="violet"
          />
        </div>
      )}

      {activePlatforms.length > 1 && (() => {
        const visibleCards = PLATFORM_CARDS.filter(({ key }) =>
          activePlatforms.includes(key) && (platformFilter === 'all' || platformFilter === key)
        );
        const cols = visibleCards.length === 1 ? 'sm:grid-cols-1' : visibleCards.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
        return (
        <div className={`grid grid-cols-1 gap-3 ${cols} mt-[10px]`}>
          {visibleCards.map(({ key, label }) => {
            const active = platformFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  const next = active ? 'all' : key;
                  setPlatformFilter(next);
                  setSearchParams((prev) => {
                    const params = new URLSearchParams(prev);
                    if (next === 'all') params.delete('platform');
                    else params.set('platform', next);
                    return params;
                  });
                  setPage(1);
                }}
                className={`rounded-lg border p-4 text-left transition-all shadow-sm ${active ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50'}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <img
                    src={PLATFORM_FAVICON[key]}
                    alt={label}
                    className="size-4 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
                  {!loading && (
                    <span
                      title={`Success rate — ${displayKpis[key].live} live ÷ (${displayKpis[key].live} live + ${displayKpis[key].removed} removed)`}
                      className="ml-auto flex items-center gap-2"
                    >
                      <span className="text-xs font-medium text-slate-500">Success Rate</span>
                      <SuccessRateBadge live={displayKpis[key].live} removed={displayKpis[key].removed} />
                    </span>
                  )}
                  {active && <Check className="size-3 text-blue-500" />}
                </div>
                {loading ? (
                  <div className="h-6 w-20 animate-pulse rounded bg-slate-200" />
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-semibold text-emerald-700">{displayKpis[key].live.toLocaleString()}</span>
                      <span className="text-xs text-slate-400">Live</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-semibold text-rose-600">{displayKpis[key].removed.toLocaleString()}</span>
                      <span className="text-xs text-slate-400">Removed</span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        );
      })()}


      <div className="rounded-b-lg border border-solid border-slate-200 bg-white shadow-sm flex flex-col max-h-[calc(100vh-252px)] md:max-h-[calc(100vh-244px)]">
        {/* Scrollable panel: toolbar + table share one scroll container (both
            axes) so the sticky toolbar/header below stay visible while rows
            scroll underneath, and don't drift when scrolled horizontally.
            Pagination (below) stays outside this div, always visible. The
            KPI/platform cards and everything else above this card are
            outside it too, in normal page flow — always visible, never
            scrolled past. */}
        <div className="overflow-auto flex-1 min-h-0">
        <div ref={toolbarRef} className="sticky top-0 left-0 z-40 bg-white will-change-transform">
        {selectedIds.size > 0 ? (
          <div className="flex items-center gap-3 px-1 py-2">
            <span className="text-sm font-medium text-blue-700">
              ✓ {selectedIds.size} selected
            </span>
            <button
              onClick={() => {
                setDuplicateTargetTab(decodedTab);
                setDuplicateBrand('');
                setDuplicateAgLink('');
                setDuplicateCgLink('');
                setCrossTabBrandProfiles({});
                setShowDuplicateModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Duplicate
            </button>
            <button
              onClick={() => { setDeleteConfirmText(''); setShowDeleteModal(true); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Clear selection
            </button>
          </div>
        ) : (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
          <Search className="size-4 text-slate-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search all columns…"
            className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
          />
          {search && (
            <button onClick={() => handleSearch('')} className="text-slate-400 hover:text-slate-600">
              <X className="size-4" />
            </button>
          )}
          {!loading && (search || brandFilter || statusFilter !== 'all' || platformFilter !== 'all') && (
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
          {(brandFilter || ratingFilter != null) && (
            <div className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 whitespace-nowrap">
              <span>
                Filtered by:
                {brandFilter ? ` ${brandFilter}` : ''}
                {platformFilter !== 'all' ? ` · ${platformFilter.toUpperCase()}` : ''}
                {ratingFilter != null ? ` · ${ratingFilter === 'unrated' ? 'Rating Unrated' : ratingFilter === 'any' ? 'Published' : `Rating ${ratingFilter}`}` : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  setBrandFilter('');
                  setRatingFilter(null);
                  setPlatformFilter('all');
                  setSearchParams({});
                  setPage(1);
                }}
                className="text-blue-500 hover:text-blue-700 transition-colors"
                aria-label="Clear brand/rating filter"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
          <div className="h-4 w-px bg-slate-200 shrink-0" />
          {uniqueBrands.length > 1 && !NO_BRAND_FILTER_TABS.has(decodedTab) && (
            <BrandFilterDropdown
              value={brandFilter}
              onChange={(v) => {
                setBrandFilter(v);
                setSearchParams((prev) => {
                  const params = new URLSearchParams(prev);
                  if (v) params.set('brand', v);
                  else params.delete('brand');
                  return params;
                });
                setPage(1);
              }}
              brands={uniqueBrands}
              noun="brand"
            />
          )}
          {uniqueAgents.length > 1 && (
            <BrandFilterDropdown
              noun="agent"
              value={agentFilter}
              onChange={(v) => { setAgentFilter(v); setPage(1); }}
              brands={uniqueAgents}
            />
          )}
          {uniqueProxies.length > 1 && (
            <BrandFilterDropdown
              noun="proxie"
              value={proxyFilter}
              onChange={(v) => { setProxyFilter(v); setPage(1); }}
              brands={uniqueProxies}
            />
          )}
          {uniqueCountries.length > 1 && (
            <BrandFilterDropdown
              noun="countrie"
              value={countryFilter}
              onChange={(v) => { setCountryFilter(v); setPage(1); }}
              brands={uniqueCountries}
            />
          )}
          <FilterDropdown
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={STATUS_OPTS}
          />
          {activePlatforms.length > 1 && (
            <FilterDropdown
              value={platformFilter}
              onChange={(v) => {
                setPlatformFilter(v);
                setSearchParams((prev) => {
                  const params = new URLSearchParams(prev);
                  if (v === 'all') params.delete('platform');
                  else params.set('platform', v);
                  return params;
                });
                setPage(1);
              }}
              options={PLATFORM_OPTS.filter((o) => o.value === 'all' || (activePlatforms as string[]).includes(o.value))}
            />
          )}
          <div className="h-4 w-px bg-slate-200 shrink-0" />
          {isApproved && (
            <div className="flex items-center gap-2">
              {lastChecked && (
                <span className="text-[5px] text-slate-400 whitespace-nowrap">
                  Last checked: {lastChecked}
                </span>
              )}
              {refreshingAfterCheck && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 whitespace-nowrap">
                  <Loader2 className="size-3 animate-spin" /> Refreshing statuses…
                </span>
              )}
              {getTabPlatforms(decodedTab).length > 1 ? (
                <div className="relative" ref={checkDropdownRef}>
                  <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleCheckStatus(getTabPlatforms(decodedTab))}
                      disabled={checkingStatus}
                      className="inline-flex items-center gap-1.5 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <RefreshCw className={`size-3.5 ${checkingStatus ? 'animate-spin' : ''}`} />
                      {checkingStatus ? 'Checking…' : 'Check Status'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckDropdownOpen((o) => !o)}
                      disabled={checkingStatus}
                      className="border-l border-slate-200 bg-white px-1.5 py-1.5 text-slate-500 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      aria-label="Select platform to check"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                  </div>
                  {checkDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-md border border-slate-200 bg-white shadow-lg py-1">
                      {getTabPlatforms(decodedTab).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleCheckStatus([p])}
                          className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50"
                        >
                          Check {p.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleCheckStatus(getTabPlatforms(decodedTab))}
                  disabled={checkingStatus}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className={`size-3.5 ${checkingStatus ? 'animate-spin' : ''}`} />
                  {checkingStatus ? 'Checking…' : 'Check Status'}
                </button>
              )}
            </div>
          )}
        </div>
        )}
        </div>

          <table className="min-w-max w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <th key={i} className="px-[10px] py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                      </th>
                    ))
                  : <>
                      {isApproved && (
                        <th className="w-8 px-2 py-2 sticky left-0 z-30 bg-slate-50 will-change-transform" style={{ top: toolbarHeight }}>
                          <input
                            type="checkbox"
                            aria-label="Select all on this page"
                            checked={pageRows.length > 0 && pageRows.every((e) => selectedIds.has(e.id))}
                            ref={(el) => {
                              if (el) {
                                const someSelected = pageRows.some((e) => selectedIds.has(e.id));
                                const allSelected = pageRows.every((e) => selectedIds.has(e.id));
                                el.indeterminate = someSelected && !allSelected;
                              }
                            }}
                            onChange={() => {
                              const allSelected = pageRows.every((e) => selectedIds.has(e.id));
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (allSelected) {
                                  pageRows.forEach((e) => next.delete(e.id));
                                } else {
                                  pageRows.forEach((e) => next.add(e.id));
                                }
                                return next;
                              });
                            }}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-400 cursor-pointer"
                          />
                        </th>
                      )}
                      {withGroupSpacers(
                        visibleHeaders,
                        visibleHeaders.map((h) => {
                          const isFrozenCol = h === 'Account' || h === 'Account Name';
                          return (
                          <th
                            key={h}
                            onClick={() => handleSort(h)}
                            style={{ top: toolbarHeight }}
                            className={`px-[10px] py-3 font-medium text-slate-600 whitespace-nowrap select-none sticky bg-slate-50 will-change-transform ${isFrozenCol ? `z-30 ${isApproved ? 'left-8' : 'left-0'}` : 'z-[25]'} ${!isNoSortCol(h) ? 'cursor-pointer hover:text-slate-900' : ''}`}
                          >
                            <span className="inline-flex items-center gap-1">
                              {getColLabel(h, decodedTab)}
                              {!isNoSortCol(h) && <SortIcon col={h} sortCol={sortCol} sortDir={sortDir} />}
                            </span>
                          </th>
                          );
                        }),
                        (key) => (
                          <th
                            key={key}
                            style={{ top: toolbarHeight }}
                            className="w-3 p-0 sticky bg-slate-50 will-change-transform z-[25]"
                          />
                        ),
                      )}
                      {/* Filler column: absorbs leftover table width so a wide
                          container doesn't stretch the widest real column
                          (e.g. Brand) with a disproportionate gap. */}
                      <th className="sticky bg-slate-50 will-change-transform z-[25]" style={{ top: toolbarHeight }} />
                    </>
                }
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-[10px] py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={(isApproved ? visibleHeaders.length + 2 : visibleHeaders.length + 1) + countGroupSpacers(visibleHeaders) || 5} className="px-4 py-8 text-center text-slate-400">
                    {search || brandFilter || statusFilter !== 'all' || platformFilter !== 'all' || dateActive ? 'No entries match your filters.' : 'No entries — run a sync from the Check Status page.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((entry) => {
                  const isRowSelected = selectedIds.has(entry.id);
                  return (
                  <tr
                    key={entry.id}
                    className={`group transition-colors hover:bg-blue-50 ${isRowSelected ? 'relative z-20 outline outline-2 outline-blue-500 -outline-offset-2' : ''}`}
                  >
                    {isApproved && (
                      <td
                        className={`w-8 px-2 py-2 select-none sticky left-0 z-10 group-hover:bg-blue-50 ${isRowSelected ? 'bg-blue-50/60' : 'bg-white'}`}
                        onClick={(e) => e.stopPropagation()}
                        data-drag-id={entry.id}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          isDraggingRef.current = true;
                          dragFirstIdRef.current = entry.id;
                          dragSessionIdsRef.current = new Set();
                        }}
                        onMouseLeave={() => {
                          // User dragged away from the first row — toggle it
                          if (isDraggingRef.current && dragFirstIdRef.current === entry.id) {
                            dragFirstIdRef.current = null;
                            applyDragToggle(entry.id);
                          }
                        }}
                        onMouseEnter={() => {
                          if (isDraggingRef.current) {
                            applyDragToggle(entry.id);
                          }
                        }}
                        onTouchStart={() => {
                          longPressTimerRef.current = setTimeout(() => {
                            longPressActiveRef.current = true;
                            dragSessionIdsRef.current = new Set();
                            navigator.vibrate?.(50);
                            applyDragToggle(entry.id);
                          }, 400);
                        }}
                        onTouchMove={(e) => {
                          if (!longPressActiveRef.current) {
                            if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
                            return;
                          }
                          e.preventDefault();
                          const touch = e.touches[0];
                          const el = document.elementFromPoint(touch.clientX, touch.clientY);
                          const td = el?.closest('[data-drag-id]') as HTMLElement | null;
                          if (td?.dataset.dragId) {
                            applyDragToggle(td.dataset.dragId!);
                          }
                        }}
                        onTouchEnd={() => {
                          if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
                          longPressActiveRef.current = false;
                        }}
                        onTouchCancel={() => {
                          if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
                          longPressActiveRef.current = false;
                        }}
                      >
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={selectedIds.has(entry.id)}
                          onChange={() =>
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) {
                                next.delete(entry.id);
                              } else {
                                next.add(entry.id);
                              }
                              return next;
                            })
                          }
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-400 cursor-pointer"
                        />
                      </td>
                    )}
                    {withGroupSpacers(visibleHeaders, visibleHeaders.map((h) => {
                      // Brand / TP URL PAGE: brand name linked to the brand's TP review page (__href),
                      // falls back to plain text if the hyperlink URL hasn't been synced yet.
                      if (h === 'Brand / TP URL PAGE') {
                        const brandName = entry.data[h];
                        const brandUrl = entry.data['Brand / TP URL PAGE__href'] ?? (brandName ? getBrandTpUrl(brandName, decodedTab) : undefined);
                        if (brandName && brandUrl) {
                          const href = brandUrl.startsWith('http') ? brandUrl : `https://${brandUrl}`;
                          return (
                            <td key={h} className="px-[10px] py-2">
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                              >
                                <ExternalLink className="size-3 shrink-0" />
                                {brandName}
                              </a>
                              {removedPlatformsFor(brandName).map((p) => <PlatformRemovedBadge key={p} platform={p} />)}
                            </td>
                          );
                        }
                        if (brandName) {
                          return (
                            <td key={h} className="px-[10px] py-2">
                              <span className="text-slate-600 text-sm">{brandName}</span>
                              {removedPlatformsFor(brandName).map((p) => <PlatformRemovedBadge key={p} platform={p} />)}
                            </td>
                          );
                        }
                        return <td key={h} className="px-[10px] py-2"><span className="text-slate-400">—</span></td>;
                      }
                      // URL PAGE: show page name as clickable link using __href hyperlink field
                      if (h === 'URL PAGE') {
                        const pageName = entry.data[h];
                        const pageUrl = entry.data['URL PAGE__href'];
                        if (pageName) {
                          if (pageUrl) {
                            const href = pageUrl.startsWith('http') ? pageUrl : `https://${pageUrl}`;
                            return (
                              <td key={h} className="px-[10px] py-2 whitespace-nowrap">
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                                >
                                  <ExternalLink className="size-3 shrink-0" />
                                  {pageName}
                                </a>
                                {removedPlatformsFor(pageName).map((p) => <PlatformRemovedBadge key={p} platform={p} />)}
                              </td>
                            );
                          }
                          return (
                            <td key={h} className="px-[10px] py-2 whitespace-nowrap">
                              <span className="text-slate-600 text-sm">{pageName}</span>
                              {removedPlatformsFor(pageName).map((p) => <PlatformRemovedBadge key={p} platform={p} />)}
                            </td>
                          );
                        }
                        return <td key={h} className="px-[10px] py-2" />;
                      }
                      // Account column: click opens the full edit modal
                      if ((h === 'Account' || h === 'Account Name') && isApproved) {
                        return (
                          <td
                            key={h}
                            className={`px-[10px] py-2 whitespace-nowrap cursor-pointer group-hover:bg-blue-50 select-none sticky left-8 z-10 ${isRowSelected ? 'bg-blue-50/60' : 'bg-white'}`}
                            onClick={() => setEditEntry(entry)}
                          >
                            <CellValue header={h} value={entry.data[h] ?? null} rowData={entry.data} tab={decodedTab} />
                            {h === 'Account' && (
                              <AccountUsageBadges counts={accountUsage.get(accountUsageKey(entry.data['Account']))} />
                            )}
                          </td>
                        );
                      }

                      // Brand identity columns: never editable inline — they key brand grouping.
                      // Render as a clickable TP link when a known URL exists for the brand.
                      if (h === 'Brands' || h === 'Brand Name' || h === 'Brand') {
                        const brandName = entry.data[h] ?? null;
                        const tpUrl = brandName ? getBrandTpUrl(brandName, decodedTab) : undefined;
                        if (brandName && tpUrl) {
                          return (
                            <td key={h} className="px-[10px] py-2">
                              <a
                                href={tpUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                              >
                                <ExternalLink className="size-3 shrink-0" />
                                {brandName}
                              </a>
                              {removedPlatformsFor(brandName).map((p) => <PlatformRemovedBadge key={p} platform={p} />)}
                            </td>
                          );
                        }
                        return (
                          <td key={h} className="px-[10px] py-2">
                            <CellValue header={h} value={brandName} rowData={entry.data} tab={decodedTab} />
                            {removedPlatformsFor(brandName).map((p) => <PlatformRemovedBadge key={p} platform={p} />)}
                          </td>
                        );
                      }

                      // Operational/system columns: read-only, no inline editing
                      if (h === 'Proxy Used' || h === 'Agent' || h === 'User Name') {
                        return (
                          <td key={h} className="px-[10px] py-2">
                            <CellValue header={h} value={entry.data[h] ?? null} rowData={entry.data} tab={decodedTab} />
                          </td>
                        );
                      }

                      // Inline-editable columns: click edits that cell in place
                      if (isApproved) {
                        const isEditing = editingCell?.entryId === entry.id && editingCell.header === h;
                        if (isEditing) {
                          const isStat = isStatusCol(h);
                          return (
                            <td key={h} className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                              {isStat ? (
                                <select
                                  autoFocus
                                  disabled={savingCell}
                                  value={editingCell.value}
                                  onChange={(e) => setEditingCell((c) => c ? { ...c, value: e.target.value } : c)}
                                  onBlur={() => saveInlineEdit(entry, h, editingCell.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.currentTarget.blur(); }
                                    if (e.key === 'Escape') setEditingCell(null);
                                  }}
                                  className="w-full rounded border border-blue-400 px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white disabled:opacity-50"
                                >
                                  <option value="">— select —</option>
                                  {INLINE_STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              ) : isLinkCol(h) ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    autoFocus
                                    type="text"
                                    disabled={savingCell}
                                    value={editingCell.value}
                                    onChange={(e) => setEditingCell((c) => c ? { ...c, value: e.target.value } : c)}
                                    onBlur={() => saveInlineEdit(entry, h, editingCell.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') { e.currentTarget.blur(); }
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    placeholder="https://…"
                                    className="w-full rounded border border-blue-400 px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                                  />
                                  {editingCell.value && (
                                    <a
                                      href={editingCell.value.startsWith('http') ? editingCell.value : `https://${editingCell.value}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="shrink-0 text-blue-500 hover:text-blue-700"
                                      title="Open link"
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.preventDefault()}
                                    >
                                      <ExternalLink className="size-4" />
                                    </a>
                                  )}
                                </div>
                              ) : (
                                <input
                                  autoFocus
                                  type="text"
                                  disabled={savingCell}
                                  value={editingCell.value}
                                  onChange={(e) => setEditingCell((c) => c ? { ...c, value: e.target.value } : c)}
                                  onBlur={() => saveInlineEdit(entry, h, editingCell.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.currentTarget.blur(); }
                                    if (e.key === 'Escape') setEditingCell(null);
                                  }}
                                  placeholder={isDateCol(h) ? 'DD/MM/YYYY' : ''}
                                  className="w-full rounded border border-blue-400 px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                                />
                              )}
                            </td>
                          );
                        }
                        return (
                          <td
                            key={h}
                            className="px-[10px] py-2 cursor-text"
                            onClick={() => {
                              const raw = entry.data[h] ?? '';
                              const display = raw ? formatCellValue(raw) : '';
                              setEditingCell({ entryId: entry.id, header: h, value: display });
                            }}
                          >
                            <CellValue header={h} value={h === 'Country' ? (getEntryCountry(entry.data, decodedTab) || null) : (entry.data[h] ?? null)} rowData={entry.data} tab={decodedTab} />
                          </td>
                        );
                      }

                      return (
                        <td key={h} className={`px-[10px] py-2 ${(h === 'Account' || h === 'Account Name') ? `whitespace-nowrap sticky left-0 z-10 group-hover:bg-blue-50 ${isRowSelected ? 'bg-blue-50/60' : 'bg-white'}` : ''}`}>
                          <CellValue
                            header={h}
                            value={
                              h === 'Country'
                                ? (getEntryCountry(entry.data, decodedTab) || null)
                                : entry.data[h] ?? (h === brandCol ? (TAB_DEFAULT_BRAND[decodedTab] ?? null) : null)
                            }
                            rowData={entry.data}
                            tab={decodedTab}
                          />
                          {h === 'Account' && (
                            <AccountUsageBadges counts={accountUsage.get(accountUsageKey(entry.data['Account']))} />
                          )}
                        </td>
                      );
                    }), (key) => <td key={key} className="w-3 p-0" />)}
                    <td />
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar — outside the scrollable panel, always visible */}
        {!loading && sorted.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            {/* Left: row range + page size */}
            <div className="flex items-center gap-3">
              <span className="font-mono tabular-nums whitespace-nowrap">
                {sorted.length === 0 ? '0' : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)}`} of {sorted.length}
              </span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSize(Number(e.target.value))}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>

            {/* Right: prev / page indicator / jump / next */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-blue-50 transition-colors"
              >
                <ChevronLeft className="size-4" /> Prev
              </button>

              <span className="px-1 font-mono tabular-nums whitespace-nowrap">
                {safePage} / {totalPages}
              </span>

              {/* Jump to page */}
              <input
                type="number"
                min={1}
                max={totalPages}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                onKeyDown={handleJump}
                placeholder="Go"
                className="w-12 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-center text-xs text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-blue-50 transition-colors"
              >
                Next <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {editEntry && (
        <EditEntryModal
          entry={editEntry}
          headers={(() => {
            const filteredFull = fullHeaders.filter((h) => h.toLowerCase() !== 'id' && h !== 'Casino Password');
            const base = new Set(filteredFull);
            const trimmedBase = new Set(filteredFull.map((h) => h.trim()));
            // Legacy sheet-import rows can carry a whitespace-variant key alongside the
            // canonical header (e.g. "Account Surname" vs "Account Surname "). Skip those
            // as extras so they don't render as a second, duplicate field — EditEntryModal
            // falls back to the whitespace-variant value when the canonical key is empty.
            const extras = Object.keys(editEntry.data).filter(
              (k) => k && k.trim() !== '' && k.toLowerCase() !== 'id' && k !== 'last_sync_tag' && k !== 'Casino Password' && !REVIEW_TEXT_KEYS.has(k) && !base.has(k) && !trimmedBase.has(k.trim()),
            );
            const hdrs = [...filteredFull, ...extras];
            // Ensure a tab-configured column always shows, even on entries saved
            // before that column existed (e.g. GRG rows created before Agent was added).
            if (getTabColumns(decodedTab)?.includes('Agent') && !hdrs.includes('Agent')) {
              const anIdx = hdrs.indexOf('Account Name');
              if (anIdx !== -1) hdrs.splice(anIdx + 1, 0, 'Agent');
              else hdrs.push('Agent');
            }
            // Same fix for 'Brand Link' — newly added to tabs whose tab_schemas
            // predates it, so it won't be in fullHeaders until a sync runs.
            if (getTabColumns(decodedTab)?.includes('Brand Link') && !hdrs.includes('Brand Link')) {
              const brandIdx = brandCol ? hdrs.indexOf(brandCol) : -1;
              if (brandIdx !== -1) hdrs.splice(brandIdx + 1, 0, 'Brand Link');
              else hdrs.push('Brand Link');
            }
            // Review text (TP/AG/CG/WO Review Text) has no Sheet/tab_schemas origin at all —
            // it's written only by the Selenium scrapers into entries.data. Force it into
            // headers for every platform this tab actually tracks, whether or not the current
            // entry has a value yet, so EditEntryModal's fields/handleSave (which only ever
            // touches whatever's in headers) can display AND save a manually-typed value.
            for (const p of getTabPlatforms(decodedTab)) {
              const reviewTextKey = PLATFORM_REVIEW_TEXT_KEYS[p][0];
              if (!hdrs.includes(reviewTextKey)) hdrs.push(reviewTextKey);
            }
            for (const [afterCol, field] of DASHBOARD_ONLY_MODAL_FIELDS) {
              const dupIdx = hdrs.indexOf(field);
              if (dupIdx !== -1) hdrs.splice(dupIdx, 1);
              const afterIdx = hdrs.indexOf(afterCol);
              if (afterIdx !== -1) hdrs.splice(afterIdx + 1, 0, field);
            }
            if (decodedTab === 'Wizard of Odds') {
              const unIdx = hdrs.indexOf('User Name');
              const asIdx = hdrs.findIndex((h) => h.trim() === 'Account Surname');
              if (unIdx !== -1 && asIdx !== -1) {
                hdrs.splice(unIdx, 1);
                hdrs.splice(hdrs.findIndex((h) => h.trim() === 'Account Surname') + 1, 0, 'User Name');
              }
            }
            return hdrs;
          })()}
          currentTab={decodedTab}
          availableBrands={uniqueBrands}
          brandCol={brandCol}
          brandProfiles={brandProfiles}
          initialRemovedPlatforms={initialRemovedPlatformsForEditEntry}
          initialOverrides={initialOverridesForEditEntry}
          onClose={() => setEditEntry(null)}
          onSave={async (fields, newTab, removedPlatforms, overrides) => {
            if (newTab && newTab !== editEntry.tab) {
              await moveEntryToTab(editEntry.id, editEntry.tab, newTab);
            }
            await updateEntryData(editEntry.id, newTab ?? editEntry.tab, fields);
            setEntries((prev) =>
              prev.map((e) => (e.id === editEntry.id ? { ...e, data: { ...e.data, ...fields }, tab: newTab ?? e.tab } : e)),
            );
            // Two independent, sibling persistence blocks below — each
            // gated only on its own param's `!== undefined` check, not on
            // the other's.
            if (brandCol) {
              const targetTab = newTab ?? editEntry.tab;
              const brandName = fields[brandCol] ?? editEntry.data[brandCol];
              if (brandName) {
                // Only write a platform's flag when that platform's checkbox
                // actually changed — not on every save of an already-flagged
                // brand's row (see the comment on
                // initialRemovedPlatformsForEditEntry above). Diffed
                // independently per platform so toggling one platform never
                // touches another's flag/removed_by/removed_at.
                if (removedPlatforms !== undefined) {
                  const wasRemoved = new Set(initialRemovedPlatformsForEditEntry);
                  const nowRemoved = new Set(removedPlatforms);
                  // Diff over decodedTab's platforms (the tab the checkboxes were
                  // actually rendered for), not targetTab's — a brand-tab-move
                  // changing which platforms apply mid-save is an edge case this
                  // doesn't attempt to reconcile further (matches the existing
                  // brand-rename-during-save limitation documented near
                  // setBrandPlatformRemoved in src/lib/queries.ts).
                  for (const p of getTabPlatforms(decodedTab)) {
                    if (wasRemoved.has(p) !== nowRemoved.has(p)) {
                      await setBrandPlatformRemoved(targetTab, brandName, p, nowRemoved.has(p));
                    }
                  }
                }

                if (overrides !== undefined) {
                  for (const p of getTabPlatforms(decodedTab)) {
                    const was = initialOverridesForEditEntry[p];
                    const now = overrides[p];
                    if (was === now) continue;
                    if (now === undefined) {
                      await clearBrandPlatformOverride(targetTab, normalizeBrandKey(brandName), p);
                    } else {
                      await setBrandPlatformOverride(targetTab, brandName, p, now);
                    }
                  }
                }
              }
            }
            reloadRef.current();
          }}
        />
      )}

      {showAddModal && (
        <AddReviewAccountModal
          currentTab={decodedTab}
          brandProfiles={brandProfiles}
          onClose={() => setShowAddModal(false)}
          onSaved={() => reloadRef.current()}
        />
      )}

      {showTotalModal && (
        <TotalBreakdownModal
          total={displayTotals.total}
          live={displayTotals.live}
          removed={displayTotals.removed}
          onClose={() => setShowTotalModal(false)}
          onFilterLive={() => { setStatusFilter('live'); setPage(1); }}
          onFilterRemoved={() => { setStatusFilter('removed'); setPage(1); }}
          onFilterTotal={() => { setStatusFilter('all'); setPage(1); }}
        />
      )}

      {showDuplicateModal && (() => {
        const activeTab = duplicateTargetTab || decodedTab;
        const isCurrentTab = activeTab === decodedTab;
        const activeProfiles = isCurrentTab ? brandProfiles : crossTabBrandProfiles;
        const availableBrands = Object.keys(activeProfiles).sort();
        const isMulti = hasMultiPlatform(activeTab);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => { if (!duplicating) setShowDuplicateModal(false); }}
          >
            <div
              className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Duplicate {selectedIds.size} row{selectedIds.size === 1 ? '' : 's'}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Optionally assign a brand tab and brand name to auto-fill links
                  </p>
                </div>
                <button
                  onClick={() => { if (!duplicating) setShowDuplicateModal(false); }}
                  disabled={duplicating}
                  className="ml-4 shrink-0 rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Tab selector */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">
                    Brand Tab
                  </label>
                  <select
                    value={activeTab}
                    onChange={(e) => handleDuplicateTabChange(e.target.value)}
                    disabled={duplicating}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50"
                  >
                    {OPERATIONAL_TABS.map((t) => (
                      <option key={t} value={t}>{tabDisplayName(t)}</option>
                    ))}
                  </select>
                </div>

                {/* Brand name */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">
                    Brand Name
                    {loadingCrossTab && <span className="ml-2 text-slate-400">(loading…)</span>}
                  </label>
                  <select
                    value={duplicateBrand}
                    onChange={(e) => handleDuplicateBrandChange(e.target.value)}
                    disabled={duplicating || loadingCrossTab}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50"
                  >
                    <option value="">— Select brand —</option>
                    {availableBrands.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                {/* AG / CG link preview — shown only for multi-platform tabs */}
                {isMulti && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-500">AG Review Link</label>
                      <input
                        type="text"
                        value={duplicateAgLink}
                        onChange={(e) => setDuplicateAgLink(e.target.value)}
                        disabled={duplicating}
                        placeholder="https://…"
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-500">CG Review Link</label>
                      <input
                        type="text"
                        value={duplicateCgLink}
                        onChange={(e) => setDuplicateCgLink(e.target.value)}
                        disabled={duplicating}
                        placeholder="https://…"
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50"
                      />
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-400">
                  All other fields are copied from the selected row{selectedIds.size > 1 ? 's' : ''}.
                  TP/AG/CG statuses, dates, and agent will be cleared.
                </p>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                <button
                  onClick={() => setShowDuplicateModal(false)}
                  disabled={duplicating}
                  className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDuplicate}
                  disabled={duplicating || loadingCrossTab}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {duplicating && <Loader2 className="size-4 animate-spin" />}
                  {duplicating ? 'Duplicating…' : 'Duplicate'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => { if (!deleting) { setShowDeleteModal(false); setDeleteConfirmText(''); } }}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-slate-900 mb-2">
              Delete {selectedIds.size} row{selectedIds.size === 1 ? '' : 's'}?
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              This will permanently delete {selectedIds.size}{' '}
              {selectedIds.size === 1 ? 'entry' : 'entries'}. This cannot be undone.
            </p>
            <p className="text-sm text-slate-700 mb-2">
              Type <strong>delete</strong> to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && deleteConfirmText === 'delete') handleDelete(); }}
              placeholder="delete"
              disabled={deleting}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/20 mb-4 disabled:opacity-50"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
                disabled={deleting}
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || deleteConfirmText !== 'delete'}
                className="inline-flex items-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                {deleting && <Loader2 className="size-4 animate-spin" />}
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          kind={toast.kind}
          onClose={closeToast}
        />
      )}
    </div>
  );
}
