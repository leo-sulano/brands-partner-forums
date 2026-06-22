import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2, XCircle, Circle, Building2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Search, X, Check, CalendarDays, Plus, RefreshCw,
} from 'lucide-react';
import KpiCard from '../components/KpiCard';
import EditEntryModal from '../components/EditEntryModal';
import AddReviewAccountModal from '../components/AddReviewAccountModal';
import TotalBreakdownModal from '../components/TotalBreakdownModal';
import Toast, { type ToastKind } from '../components/Toast';
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck } from '../lib/queries';
import { subscribeEntries } from '../lib/realtime';
import { getTabColumns, getColLabel, COLUMN_LABELS } from '../lib/tab-configs';
import { slugToTab } from '../lib/tabs';
import { useAuth } from '../contexts/AuthContext';
import { formatCellValue } from '../lib/format';
import type { Entry } from '../types/entry';

// Checked case-insensitively against header names for tabs with no whitelist config.
const HIDDEN_COLS = new Set(['id', 'last_sync_tag', 'score added', 'review status']);
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;


function isStatusCol(header: string) {
  return header.toLowerCase().includes('status');
}

function isLinkCol(header: string) {
  if (header === 'Brand / TP URL PAGE') return false;
  if (header === 'URL PAGE') return false;
  const h = header.toLowerCase();
  return h.includes('link') || h.includes('url') || h.includes('profile');
}

function colWidthClass(header: string): string {
  if (isLinkCol(header)) return 'w-24';
  if (isStatusCol(header)) return 'w-36';
  const h = header.toLowerCase();
  if (h.includes('account') || h.includes('brand') || h.includes('name')) return 'w-40';
  return 'w-32';
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
  if (v === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        <Circle className="size-3" /> {value}
      </span>
    );
  }
  if (v === 'not done') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
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


function CellValue({ header, value }: { header: string; value: string | null }) {
  if (isDateCol(header) && (!value || value.trim() === '')) {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-500">
        No Review
      </span>
    );
  }
  const display = value ? formatCellValue(value) : '—';
  if (isStatusCol(header)) return <StatusPill value={display} />;
  if (isLinkCol(header) && value) {
    const href = value.startsWith('http') ? value : `https://${value}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors whitespace-nowrap"
      >
        <ExternalLink className="size-3" /> View
      </a>
    );
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
  'Date', 'date', 'Posted At', 'posted_at',
];

// Per-platform date columns used when a specific platform is selected.
const PLATFORM_DATE_COLS = {
  tp: 'Trust Pilot',
  ag: 'Ask Gambler review added',
  cg: 'Casino Guru review added',
} as const;

const PLATFORM_STATUS_COL = {
  tp: 'TP Review Status',
  ag: 'AG Review Status',
  cg: 'CG Review Status',
} as const;

// Columns that belong to each platform — used to hide non-selected platform cols.
const PLATFORM_OWN_COLS: Record<'tp' | 'ag' | 'cg', Set<string>> = {
  tp: new Set(['Trust Pilot', 'Link to the profile', 'TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status', 'Review Status']),
  ag: new Set(['Ask Gambler review added', 'AG Review Status']),
  cg: new Set(['Casino Guru review added', 'CG Review Status']),
};

// All known Trust Pilot status column variants across tabs.
const TP_STATUS_VARIANTS = new Set([
  'TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status',
  'Trust pilot Review Status', 'Review Status',
]);

function getEntryDate(data: Record<string, string | null>): Date | null {
  for (const col of ENTRY_DATE_COLS) {
    const raw = data[col];
    if (!raw) continue;
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Only excludes entries that have a date AND it falls outside the range.
// Entries with no date are always included so pending accounts stay visible.
function inDateRangeInclusive(data: Record<string, string | null>, from: string, to: string): boolean {
  const d = getEntryDate(data);
  if (!d) return true;
  if (from && d < new Date(from + 'T00:00:00')) return false;
  if (to && d > new Date(to + 'T23:59:59')) return false;
  return true;
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
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-colors"
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
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-50 ${opt.value === value ? 'font-medium text-violet-700 bg-violet-50/60' : 'text-slate-600'}`}
            >
              {opt.dot && <span className={`size-1.5 shrink-0 rounded-full ${opt.dot}`} />}
              <span className="flex-1">{opt.label}</span>
              {opt.value === value && <Check className="size-3 text-violet-500" />}
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

const BRAND_COLS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name'];
const NO_BRAND_FILTER_TABS = new Set(['HazEmirates UAE', 'Trybet', 'SilverPlay']);

function BrandFilterDropdown({ value, onChange, brands, noun = 'brand' }: {
  value: string; onChange: (v: string) => void; brands: string[]; noun?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const visible = search.trim()
    ? brands.filter((b) => b.toLowerCase().includes(search.toLowerCase()))
    : brands;

  const active = !!value;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
          active
            ? 'border-violet-300 bg-violet-50 text-violet-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        {active && <span className="size-1.5 shrink-0 rounded-full bg-violet-500" />}
        <span className="max-w-[9rem] truncate">{active ? value : `All ${noun}s`}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onChange(''); }} className="ml-0.5 text-violet-400 hover:text-violet-600 transition-colors">
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
            <Search className="size-3.5 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${noun}s…`}
              className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
            />
            {search && <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600"><X className="size-3" /></button>}
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-50 ${!value ? 'font-medium text-violet-700 bg-violet-50/60' : 'text-slate-600'}`}
            >
              <span className="flex-1">{`All ${noun}s`}</span>
              {!value && <Check className="size-3 text-violet-500" />}
            </button>
            {visible.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No {noun}s match</div>
            )}
            {visible.map((brand) => (
              <button
                key={brand}
                type="button"
                onClick={() => { onChange(brand); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-50 ${brand === value ? 'font-medium text-violet-700 bg-violet-50/60' : 'text-slate-600'}`}
              >
                <span className="flex-1 truncate">{brand}</span>
                {brand === value && <Check className="size-3 text-violet-500" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const PLATFORM_FAVICON: Record<'tp' | 'ag' | 'cg', string> = {
  tp: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16',
  ag: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16',
  cg: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16',
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
            ? 'border-violet-300 bg-violet-50 text-violet-700'
            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <CalendarDays className="size-3.5 shrink-0" />
        <span>{active ? isoToDisplay(value) : placeholder}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onChange(''); }} className="ml-0.5 text-violet-400 hover:text-violet-600 transition-colors">
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 transition-colors">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold text-slate-700">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 transition-colors">
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
                    sel ? 'bg-violet-600 font-semibold text-white'
                    : dis ? 'cursor-not-allowed text-slate-300'
                    : tod ? 'border border-violet-300 font-medium text-violet-600 hover:bg-violet-50'
                    : 'text-slate-700 hover:bg-slate-100'
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
  return sortDir === 'asc'
    ? <ChevronUp className="size-3 text-violet-600 shrink-0" />
    : <ChevronDown className="size-3 text-violet-600 shrink-0" />;
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'removed' | 'done' | 'on-pause' | 'pending' | 'not-done'>('all');
  const [showTotalModal, setShowTotalModal] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<'all' | 'tp' | 'ag' | 'cg'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [jumpInput, setJumpInput] = useState('');

  const [agentFilter, setAgentFilter] = useState('');
  const [proxyFilter, setProxyFilter] = useState('');
  const { isApproved } = useAuth();
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const [reloadSeq, setReloadSeq] = useState(0);
  const reloadRef = useRef(() => setReloadSeq((s) => s + 1));

  const [checkingStatus, setCheckingStatus] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const [lastChecked, setLastChecked] = useState<string | null>(
    () => localStorage.getItem(`lastStatusCheck_${decodedTab}`) ?? null,
  );

  useEffect(() => {
    setLastChecked(localStorage.getItem(`lastStatusCheck_${decodedTab}`) ?? null);
  }, [decodedTab]);

  useEffect(() => {
    if (!decodedTab) return;
    let canceled = false;
    setLoading(true);
    setEntries([]);
    setHeaders([]);
    setFullHeaders([]);
    setError(null);
    setSearch('');
    setBrandFilter('');
    setStatusFilter('all');
    setPlatformFilter('all');
    setAgentFilter('');
    setProxyFilter('');
    setDateFrom('');
    setDateTo('');
    setSortCol(null);
    setSortDir('asc');
    setPage(1);
    setJumpInput('');

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
        setEntries(rawEntries);
        setHeaders(populated);
        setFullHeaders(tabHeaders);
        setError(null);
        const defaultDateCol = ENTRY_DATE_COLS.find((col) =>
          populated.some((h) => h.toLowerCase() === col.toLowerCase()),
        );
        if (defaultDateCol) {
          const matched = populated.find((h) => h.toLowerCase() === defaultDateCol.toLowerCase());
          if (matched) { setSortCol(matched); setSortDir('desc'); }
        }
      } catch (err) {
        if (canceled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => { canceled = true; };
  }, [decodedTab, reloadSeq]);

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

  // Hide other platforms' columns when a specific platform is selected.
  const visibleHeaders = platformFilter !== 'all' && activePlatforms.length > 1
    ? headers.filter((h) => {
        for (const [key, cols] of Object.entries(PLATFORM_OWN_COLS) as ['tp' | 'ag' | 'cg', Set<string>][]) {
          if (key !== platformFilter && cols.has(h)) return false;
        }
        return true;
      })
    : headers;

  const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? null;
  const uniqueBrands = brandCol
    ? [...new Set(entries.map((e) => e.data[brandCol]).filter((v): v is string => !!v && v.trim() !== ''))].sort()
    : [];

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
            const key = v.trim().toLowerCase();
            if (!seen.has(key)) seen.set(key, v.trim());
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
    ? searchFiltered.filter((e) => e.data[brandCol] === brandFilter)
    : searchFiltered;

  const agentFiltered = agentFilter && agentCol
    ? brandFiltered.filter((e) => e.data[agentCol] === agentFilter)
    : brandFiltered;

  const proxyFiltered = proxyFilter
    ? agentFiltered.filter((e) => e.data['Proxy Used']?.trim().toLowerCase() === proxyFilter.toLowerCase())
    : agentFiltered;

  // Platform filter only affects visible columns, not row filtering.
  const platformFiltered = proxyFiltered;

  const statusCols = headers.filter(isStatusCol);
  // When a platform card is selected, only check that platform's status column(s).
  const activeStatusCols = platformFilter === 'all'
    ? statusCols
    : platformFilter === 'tp'
      ? statusCols.filter((h) => TP_STATUS_VARIANTS.has(h))
      : statusCols.filter((h) => h.toLowerCase() === PLATFORM_STATUS_COL[platformFilter].toLowerCase());
  const statusFiltered = statusFilter === 'all'
    ? platformFiltered
    : platformFiltered.filter((e) =>
        activeStatusCols.some((h) => {
          const v = (e.data[h] ?? '').toLowerCase();
          if (statusFilter === 'live') return isLive(v);
          if (statusFilter === 'removed') return isRemoved(v);
          if (statusFilter === 'done') return isDone(v);
          if (statusFilter === 'on-pause') return isOnPause(v);
          if (statusFilter === 'pending') return isPending(v);
          if (statusFilter === 'not-done') return isNotDone(v);
          return false;
        }),
      );

  const dateActive = !!(dateFrom || dateTo);

  function applyDateFilter<T extends { data: Record<string, string | null> }>(rows: T[]): T[] {
    if (!dateActive) return rows;
    return rows.filter((e) => {
      if (platformFilter !== 'all') {
        const col = PLATFORM_DATE_COLS[platformFilter];
        const raw = e.data[col]?.trim();
        if (!raw) return true; // no date — always include
        const d = parseCellDate(raw) ?? new Date(raw);
        if (isNaN(d.getTime())) return true; // unparseable — include rather than hide
        if (dateFrom && d < new Date(dateFrom + 'T00:00:00')) return false;
        if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
        return true;
      }
      return inDateRangeInclusive(e.data, dateFrom, dateTo);
    });
  }

  const filtered = applyDateFilter(statusFiltered);
  // kpiBase skips status filter so platform card counts always show full live/removed totals.
  const kpiBase = applyDateFilter(platformFiltered);


  // Platform card counts — computed from kpiBase so they always reflect active filters.
  const displayKpis = (() => {
    function countPlatform(key: 'tp' | 'ag' | 'cg') {
      const statusCol = key === 'tp'
        ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
        : (headers.find((h) => h.toLowerCase() === PLATFORM_STATUS_COL[key].toLowerCase()) ?? null);
      if (!statusCol) return { live: 0, removed: 0 };
      let live = 0, removed = 0;
      for (const e of kpiBase) {
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
    return v.includes('pending');
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
    let live = 0, removed = 0;
    for (const e of kpiBase) {
      const statuses = statusCols.map((h) => (e.data[h] ?? '').toLowerCase()).filter(Boolean);
      if (statuses.some(isLive)) live++;
      else if (statuses.some(isRemoved)) removed++;
    }
    return { total: live + removed, live, removed };
  })();

  const sorted = sortCol
    ? [...filtered].sort((a, b) => {
        const av = a.data[sortCol] ?? '';
        const bv = b.data[sortCol] ?? '';
        if (isDateCol(sortCol)) {
          const da = parseCellDate(av);
          const db = parseCellDate(bv);
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return sortDir === 'asc' ? da.getTime() - db.getTime() : db.getTime() - da.getTime();
        }
        const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function handleSort(col: string) {
    if (isLinkCol(col)) return;
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
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

  async function handleCheckStatus() {
    setCheckingStatus(true);
    try {
      const result = await triggerStatusCheck(decodedTab);
      const now = new Date().toLocaleString();
      localStorage.setItem(`lastStatusCheck_${decodedTab}`, now);
      setLastChecked(now);
      let msg: string;
      let kind: ToastKind;
      const sheetFail = result.sheet_errors ?? 0;
      if (result.errors > 0 && result.updated === 0) {
        msg = `${result.errors} check${result.errors !== 1 ? 's' : ''} failed — proxy may not be configured`;
        kind = 'error';
      } else if (result.updated > 0 && result.errors > 0 && sheetFail > 0) {
        msg = `${result.updated} updated, ${result.errors} checks failed, ${sheetFail} sheet sync failed`;
        kind = 'error';
      } else if (result.updated > 0 && sheetFail > 0) {
        msg = `${result.updated} updated in dashboard but ${sheetFail} failed to sync to Google Sheet`;
        kind = 'error';
      } else if (result.updated > 0 && result.errors > 0) {
        msg = `${result.updated} updated, ${result.errors} failed`;
        kind = 'success';
      } else if (result.updated > 0) {
        msg = `${result.updated} review${result.updated !== 1 ? 's' : ''} updated`;
        kind = 'success';
      } else {
        msg = 'All reviews up to date';
        kind = 'success';
      }
      setToast({ message: msg, kind });
      reloadRef.current();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setToast({ message: `Check failed: ${detail}`, kind: 'error' });
      console.error(err);
    } finally {
      setCheckingStatus(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 transition-colors"
          >
            <Plus className="size-4" />
            Add Review Account
          </button>
        )}
      </div>

      {activePlatforms.length <= 1 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        </div>
      )}

      {activePlatforms.length > 1 && (() => {
        const visibleCards = PLATFORM_CARDS.filter(({ key }) =>
          activePlatforms.includes(key) && (platformFilter === 'all' || platformFilter === key)
        );
        const cols = visibleCards.length === 1 ? 'sm:grid-cols-1' : visibleCards.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
        return (
        <div className={`grid grid-cols-1 gap-3 ${cols}`}>
          {visibleCards.map(({ key, label }) => {
            const active = platformFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setPlatformFilter(active ? 'all' : key); setPage(1); }}
                className={`rounded-lg border p-4 text-left transition-all shadow-sm ${active ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-200' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <img
                    src={PLATFORM_FAVICON[key]}
                    alt={label}
                    className="size-4 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
                  {active && <Check className="size-3 ml-auto text-violet-500" />}
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


      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {/* Search + filter bar */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
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
          <div className="h-4 w-px bg-slate-200 shrink-0" />
          {uniqueBrands.length > 1 && !NO_BRAND_FILTER_TABS.has(decodedTab) && (
            <BrandFilterDropdown
              value={brandFilter}
              onChange={(v) => { setBrandFilter(v); setPage(1); }}
              brands={uniqueBrands}
              noun={decodedTab === 'TP Affiliate' ? 'URL page' : 'brand'}
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
          <FilterDropdown
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={STATUS_OPTS}
          />
          {activePlatforms.length > 1 && (
            <FilterDropdown
              value={platformFilter}
              onChange={(v) => { setPlatformFilter(v); setPage(1); }}
              options={PLATFORM_OPTS.filter((o) => o.value === 'all' || (activePlatforms as string[]).includes(o.value))}
            />
          )}
          <div className="h-4 w-px bg-slate-200 shrink-0" />
          {isApproved && (
            <div className="flex items-center gap-2">
              {lastChecked && (
                <span className="text-xs text-slate-400 whitespace-nowrap">
                  Last checked: {lastChecked}
                </span>
              )}
              <button
                type="button"
                onClick={handleCheckStatus}
                disabled={checkingStatus}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`size-3.5 ${checkingStatus ? 'animate-spin' : ''}`} />
                {checkingStatus ? 'Checking…' : 'Check Status'}
              </button>
            </div>
          )}
        </div>


        <div className="overflow-x-auto">
          <table className="min-w-max w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <th key={i} className="px-4 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                      </th>
                    ))
                  : visibleHeaders.map((h) => (
                      <th
                        key={h}
                        onClick={() => handleSort(h)}
                        className={`px-3 py-3 font-medium text-slate-600 whitespace-nowrap select-none ${colWidthClass(h)} ${!isLinkCol(h) ? 'cursor-pointer hover:text-slate-900' : ''}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {getColLabel(h, decodedTab)}
                          {!isLinkCol(h) && <SortIcon col={h} sortCol={sortCol} sortDir={sortDir} />}
                        </span>
                      </th>
                    ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={visibleHeaders.length || 5} className="px-4 py-8 text-center text-slate-400">
                    {search || brandFilter || statusFilter !== 'all' || platformFilter !== 'all' || dateActive ? 'No entries match your filters.' : 'No entries — run a sync from the Sync Status page.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={isApproved ? () => setEditEntry(entry) : undefined}
                    className={isApproved ? 'cursor-pointer hover:bg-violet-50/50 transition-colors' : 'transition-colors'}
                  >
                    {visibleHeaders.map((h) => {
                      // Brand / TP URL PAGE: render brand name as a link to the profile URL
                      if (h === 'Brand / TP URL PAGE') {
                        const profileUrl = entry.data['Link to the profile'];
                        const brandName = entry.data[h];
                        if (brandName && profileUrl) {
                          const href = profileUrl.startsWith('http') ? profileUrl : `https://${profileUrl}`;
                          return (
                            <td key={h} className="px-3 py-2.5">
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
                            </td>
                          );
                        }
                      }
                      // URL PAGE: show page name as clickable link using __href hyperlink field
                      if (h === 'URL PAGE') {
                        const pageName = entry.data[h];
                        const pageUrl = entry.data['URL PAGE__href'];
                        if (pageName) {
                          if (pageUrl) {
                            const href = pageUrl.startsWith('http') ? pageUrl : `https://${pageUrl}`;
                            return (
                              <td key={h} className="px-3 py-2.5">
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
                              </td>
                            );
                          }
                          return (
                            <td key={h} className="px-3 py-2.5">
                              <span className="text-slate-600 text-sm">{pageName}</span>
                            </td>
                          );
                        }
                      }
                      return (
                        <td key={h} className="px-3 py-2.5">
                          <CellValue header={h} value={entry.data[h] ?? null} />
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {!loading && sorted.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            {/* Left: row range + page size */}
            <div className="flex items-center gap-3">
              <span className="tabular-nums whitespace-nowrap">
                {sorted.length === 0 ? '0' : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)}`} of {sorted.length}
              </span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSize(Number(e.target.value))}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-400"
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
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-slate-100 transition-colors"
              >
                <ChevronLeft className="size-4" /> Prev
              </button>

              <span className="px-1 tabular-nums whitespace-nowrap">
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
                className="w-12 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-center text-xs text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-40 hover:bg-slate-100 transition-colors"
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
            const base = new Set(fullHeaders);
            const extras = Object.keys(editEntry.data).filter(
              (k) => k && k.trim() !== '' && k !== 'id' && k !== 'last_sync_tag' && !base.has(k),
            );
            return [...fullHeaders, ...extras];
          })()}
          onClose={() => setEditEntry(null)}
          onSave={async (fields) => {
            await updateEntryData(editEntry.id, editEntry.tab, editEntry.sheet_row_id, fields);
            reloadRef.current();
          }}
        />
      )}

      {showAddModal && (
        <AddReviewAccountModal
          currentTab={decodedTab}
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
