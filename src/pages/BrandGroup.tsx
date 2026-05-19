import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2, XCircle, Circle, Building2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Search, X, Check, CalendarDays,
} from 'lucide-react';
import KpiCard from '../components/KpiCard';
import EditEntryModal from '../components/EditEntryModal';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchTabKpis, updateEntryData } from '../lib/queries';
import { subscribeEntries } from '../lib/realtime';
import { getTabColumns, getColLabel, COLUMN_LABELS } from '../lib/tab-configs';
import { formatCellValue } from '../lib/format';
import type { Entry } from '../types/entry';
import type { TabKpis } from '../types/brand-entry';

// Checked case-insensitively against header names for tabs with no whitelist config.
const HIDDEN_COLS = new Set(['id', 'last_sync_tag', 'score added', 'review status']);
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;


function isStatusCol(header: string) {
  return header.toLowerCase().includes('status');
}

function isLinkCol(header: string) {
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
  const v = value.toLowerCase();
  if (v.includes('live')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-3" /> {value}
      </span>
    );
  }
  if (v.includes('removed')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
        <XCircle className="size-3" /> {value}
      </span>
    );
  }
  if (!value || value === '—') {
    return <span className="text-slate-400">—</span>;
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

// All known Trust Pilot status column variants across tabs.
const TP_STATUS_VARIANTS = new Set([
  'TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status',
  'Trust pilot Review Status', 'Review Status',
]);

function getEntryDate(data: Record<string, string | null>): Date | null {
  for (const col of ENTRY_DATE_COLS) {
    const raw = data[col];
    if (!raw) continue;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const p = new Date(+m[3], +m[2] - 1, +m[1]);
      if (!isNaN(p.getTime())) return p;
    }
  }
  return null;
}

function inDateRange(data: Record<string, string | null>, from: string, to: string): boolean {
  const d = getEntryDate(data);
  if (!d) return false;
  if (from && d < new Date(from)) return false;
  if (to && d > new Date(to + 'T23:59:59')) return false;
  return true;
}

function isDateCol(header: string): boolean {
  const h = header.toLowerCase();
  return ENTRY_DATE_COLS.some((c) => c.toLowerCase() === h);
}

function parseCellDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const p = new Date(+m[3], +m[2] - 1, +m[1]);
    if (!isNaN(p.getTime())) return p;
  }
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

const STATUS_OPTS: FilterOpt<'all' | 'live' | 'removed'>[] = [
  { value: 'all',     label: 'All statuses', dot: 'bg-slate-400' },
  { value: 'live',    label: 'Live',         dot: 'bg-emerald-500' },
  { value: 'removed', label: 'Removed',      dot: 'bg-rose-500' },
];

const PLATFORM_OPTS: FilterOpt<'all' | 'tp' | 'ag' | 'cg'>[] = [
  { value: 'all', label: 'All platforms' },
  { value: 'tp',  label: 'Trust Pilot',  dot: 'bg-blue-500' },
  { value: 'ag',  label: 'Ask Gambler',  dot: 'bg-amber-500' },
  { value: 'cg',  label: 'Casino Guru',  dot: 'bg-violet-500' },
];

const BRAND_COLS = ['Account Name', 'Brands', 'Brand Name', 'Brand'];

function BrandFilterDropdown({ value, onChange, brands }: {
  value: string; onChange: (v: string) => void; brands: string[];
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
        <span className="max-w-[9rem] truncate">{active ? value : 'All brands'}</span>
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
              placeholder="Search brands…"
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
              <span className="flex-1">All brands</span>
              {!value && <Check className="size-3 text-violet-500" />}
            </button>
            {visible.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No brands match</div>
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
  const decodedTab = decodeURIComponent(tab ?? '');

  const [entries, setEntries] = useState<Entry[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [kpis, setKpis] = useState<TabKpis>({ total: 0, live: 0, removed: 0, tp: { live: 0, removed: 0 }, ag: { live: 0, removed: 0 }, cg: { live: 0, removed: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'removed'>('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'tp' | 'ag' | 'cg'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [jumpInput, setJumpInput] = useState('');

  const [editEntry, setEditEntry] = useState<Entry | null>(null);

  const [reloadSeq, setReloadSeq] = useState(0);
  const reloadRef = useRef(() => setReloadSeq((s) => s + 1));

  useEffect(() => {
    if (!decodedTab) return;
    let canceled = false;
    setLoading(true);
    setEntries([]);
    setHeaders([]);
    setKpis({ total: 0, live: 0, removed: 0, tp: { live: 0, removed: 0 }, ag: { live: 0, removed: 0 }, cg: { live: 0, removed: 0 } });
    setError(null);
    setSearch('');
    setBrandFilter('');
    setStatusFilter('all');
    setPlatformFilter('all');
    setDateFrom('');
    setDateTo('');
    setSortCol(null);
    setSortDir('asc');
    setPage(1);
    setJumpInput('');

    (async () => {
      try {
        const [rawEntries, tabHeaders, k] = await Promise.all([
          fetchRawEntriesByTab(decodedTab),
          fetchTabHeaders(decodedTab),
          fetchTabKpis(decodedTab),
        ]);
        if (canceled) return;
        const configCols = getTabColumns(decodedTab);
        const visible = configCols
          ? configCols
              .map((col) => {
                const colLower = col.toLowerCase();
                return (
                  tabHeaders.find((h) => h.toLowerCase() === colLower) ??
                  tabHeaders.find((h) => (COLUMN_LABELS[h] ?? h).toLowerCase() === colLower)
                );
              })
              .filter((h): h is string => h !== undefined)
          : tabHeaders.filter((h) => !HIDDEN_COLS.has(h.toLowerCase()));
        const populated = visible.filter((h) =>
          rawEntries.some((e) => { const v = e.data[h]; return v != null && v !== ''; }),
        );
        setEntries(rawEntries);
        setHeaders(populated);
        setKpis(k);
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
    let timer: ReturnType<typeof setTimeout>;
    return subscribeEntries(() => {
      clearTimeout(timer);
      timer = setTimeout(() => reloadRef.current(), 400);
    });
  }, []);

  // Derived: search → brand → platform → status → date → sort → paginate

  // Which platform cards are relevant for this tab, based on loaded headers.
  const activePlatforms = (() => {
    const result: ('tp' | 'ag' | 'cg')[] = [];
    if (headers.some((h) => TP_STATUS_VARIANTS.has(h))) result.push('tp');
    if (headers.includes('AG Review Status')) result.push('ag');
    if (headers.includes('CG Review Status')) result.push('cg');
    return result;
  })();

  const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? null;
  const uniqueBrands = brandCol
    ? [...new Set(entries.map((e) => e.data[brandCol]).filter((v): v is string => !!v && v.trim() !== ''))].sort()
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

  const platformFiltered = platformFilter === 'all' || activePlatforms.length <= 1
    ? brandFiltered
    : brandFiltered.filter((e) => {
        const col = platformFilter === 'tp'
          ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
          : PLATFORM_STATUS_COL[platformFilter];
        if (!col) return false;
        const v = e.data[col];
        return v != null && v !== '';
      });

  const statusCols = headers.filter(isStatusCol);
  const statusFiltered = statusFilter === 'all'
    ? platformFiltered
    : platformFiltered.filter((e) =>
        statusCols.some((h) => {
          const v = (e.data[h] ?? '').toLowerCase();
          if (statusFilter === 'live') return v.includes('live') || v.includes('published');
          if (statusFilter === 'removed') return v.includes('removed');
          return false;
        }),
      );

  const dateActive = !!(dateFrom || dateTo);
  const filtered = dateActive
    ? statusFiltered.filter((e) => {
        if (platformFilter !== 'all') {
          const col = PLATFORM_DATE_COLS[platformFilter];
          const raw = e.data[col];
          if (!raw) return false;
          const d = parseCellDate(raw) ?? new Date(raw);
          if (isNaN(d.getTime())) return false;
          if (dateFrom && d < new Date(dateFrom)) return false;
          if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
          return true;
        }
        return inDateRange(e.data, dateFrom, dateTo);
      })
    : statusFiltered;


  // Platform card counts — date-filtered when a range is active, otherwise use server-side kpis.
  const displayKpis = (() => {
    if (!dateActive) return { tp: kpis.tp, ag: kpis.ag, cg: kpis.cg };
    function countPlatform(key: 'tp' | 'ag' | 'cg') {
      const dateCol = PLATFORM_DATE_COLS[key];
      const statusCol = key === 'tp'
        ? (headers.find((h) => TP_STATUS_VARIANTS.has(h)) ?? null)
        : PLATFORM_STATUS_COL[key];
      if (!statusCol) return { live: 0, removed: 0 };
      let live = 0, removed = 0;
      for (const e of entries) {
        const raw = e.data[dateCol];
        if (!raw) continue;
        const d = parseCellDate(raw) ?? new Date(raw);
        if (isNaN(d.getTime())) continue;
        if (dateFrom && d < new Date(dateFrom)) continue;
        if (dateTo && d > new Date(dateTo + 'T23:59:59')) continue;
        const v = (e.data[statusCol] ?? '').toLowerCase();
        if (v.includes('live') || v.includes('published')) live++;
        else if (v.includes('removed')) removed++;
      }
      return { live, removed };
    }
    return { tp: countPlatform('tp'), ag: countPlatform('ag'), cg: countPlatform('cg') };
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

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total"
          value={loading ? '…' : kpis.total.toLocaleString()}
          icon={<Building2 className="size-4" />}
        />
        <KpiCard
          label="Live"
          value={loading ? '…' : kpis.live.toLocaleString()}
          hint="Reviews currently published"
        />
        <KpiCard
          label="Removed"
          value={loading ? '…' : kpis.removed.toLocaleString()}
          hint="Reviews taken down"
        />
      </div>

      {activePlatforms.length > 0 && (
        <div className={`grid grid-cols-1 gap-3 ${activePlatforms.length === 1 ? 'sm:grid-cols-1 max-w-xs' : activePlatforms.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          {PLATFORM_CARDS.filter(({ key }) => activePlatforms.includes(key)).map(({ key, label, dot }) => {
            const active = platformFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setPlatformFilter(active ? 'all' : key); setPage(1); }}
                className={`rounded-lg border p-4 text-left transition-all shadow-sm ${active ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-200' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className={`size-2 shrink-0 rounded-full ${dot}`} />
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
                  {active && <Check className="size-3 ml-auto text-violet-500" />}
                </div>
                {loading ? (
                  <div className="h-6 w-20 animate-pulse rounded bg-slate-200" />
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-semibold text-emerald-700">{displayKpis[key].live.toLocaleString()}</span>
                      <span className="text-xs text-slate-400">live</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-semibold text-rose-600">{displayKpis[key].removed.toLocaleString()}</span>
                      <span className="text-xs text-slate-400">removed</span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Date range filter */}
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-slate-500 shrink-0">Date range</span>
          <div className="flex items-center gap-2">
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

        </div>
      </div>

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
          {uniqueBrands.length > 1 && (
            <BrandFilterDropdown
              value={brandFilter}
              onChange={(v) => { setBrandFilter(v); setPage(1); }}
              brands={uniqueBrands}
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
                  : headers.map((h) => (
                      <th
                        key={h}
                        onClick={() => handleSort(h)}
                        className={`px-3 py-3 font-medium text-slate-600 whitespace-nowrap select-none ${colWidthClass(h)} ${!isLinkCol(h) ? 'cursor-pointer hover:text-slate-900' : ''}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {getColLabel(h)}
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
                  <td colSpan={headers.length || 5} className="px-4 py-8 text-center text-slate-400">
                    {search || brandFilter || statusFilter !== 'all' || platformFilter !== 'all' || dateActive ? 'No entries match your filters.' : 'No entries — run a sync from the Sync Status page.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => setEditEntry(entry)}
                    className="cursor-pointer hover:bg-violet-50/50 transition-colors"
                  >
                    {headers.map((h) => (
                      <td key={h} className="px-3 py-2.5">
                        <CellValue header={h} value={entry.data[h] ?? null} />
                      </td>
                    ))}
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
          headers={headers}
          onClose={() => setEditEntry(null)}
          onSave={async (fields) => {
            await updateEntryData(editEntry.id, editEntry.tab, editEntry.sheet_row_id, fields);
            reloadRef.current();
          }}
        />
      )}
    </div>
  );
}
