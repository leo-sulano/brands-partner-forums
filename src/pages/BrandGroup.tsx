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
import { getTabColumns, getColLabel, COLUMN_LABELS, hasMultiPlatform } from '../lib/tab-configs';
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

// Date column candidates, in priority order
const ENTRY_DATE_COLS = [
  'Score added',
  'Ask Gambler review added',
  'Casino Guru review added',
  'Removed / Not Published / stil published date',
  'Date', 'date', 'Posted At', 'posted_at',
];

// All possible status column names across tabs
const ALL_STATUS_COLS = [
  'TP Review Status', 'Trust Pilot Review Status', 'Trustpilot Review Status', 'Trust pilot Review Status',
  'AG Review Status', 'CG Review Status',
  'Review Status', 'Status', 'status',
];

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

function categorizeStatus(v: string): 'published' | 'removed' | 'refused' | null {
  const l = v.toLowerCase();
  if (!l) return null;
  if (l.includes('not pub') || l.includes('refused')) return 'refused';
  if (l.includes('removed')) return 'removed';
  if (l.includes('live') || l.includes('published')) return 'published';
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

const PLATFORM_CARDS = [
  { key: 'tp' as const, label: 'Trust Pilot', dot: 'bg-blue-500' },
  { key: 'ag' as const, label: 'Ask Gambler', dot: 'bg-amber-500' },
  { key: 'cg' as const, label: 'Casino Guru', dot: 'bg-violet-500' },
];

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

  // Derived: filter → platform filter → status filter → sort → paginate
  const PLATFORM_STATUS_COLS = { tp: 'TP Review Status', ag: 'AG Review Status', cg: 'CG Review Status' };

  const searchFiltered = search.trim()
    ? entries.filter((e) =>
        headers.some((h) => {
          const v = e.data[h];
          return v != null && v.toLowerCase().includes(search.toLowerCase());
        }),
      )
    : entries;

  const platformFiltered = platformFilter === 'all' || !hasMultiPlatform(decodedTab)
    ? searchFiltered
    : searchFiltered.filter((e) => {
        const col = PLATFORM_STATUS_COLS[platformFilter];
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
    ? statusFiltered.filter((e) => inDateRange(e.data, dateFrom, dateTo))
    : statusFiltered;

  // Counts for the date range section — computed from ALL entries, only date-filtered
  const dateRangeCounts = (() => {
    if (!dateActive) return null;
    let published = 0, removed = 0, refused = 0;
    for (const e of entries) {
      if (!inDateRange(e.data, dateFrom, dateTo)) continue;
      for (const col of ALL_STATUS_COLS) {
        const v = e.data[col];
        if (!v) continue;
        const cat = categorizeStatus(v);
        if (cat === 'published') published++;
        else if (cat === 'removed') removed++;
        else if (cat === 'refused') refused++;
      }
    }
    return { published, removed, refused };
  })();

  const sorted = sortCol
    ? [...filtered].sort((a, b) => {
        const av = a.data[sortCol] ?? '';
        const bv = b.data[sortCol] ?? '';
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

      {hasMultiPlatform(decodedTab) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PLATFORM_CARDS.map(({ key, label, dot }) => {
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
                      <span className="text-xl font-semibold text-emerald-700">{kpis[key].live.toLocaleString()}</span>
                      <span className="text-xs text-slate-400">live</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-semibold text-rose-600">{kpis[key].removed.toLocaleString()}</span>
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
          <div className="flex items-center gap-2 shrink-0">
            <CalendarDays className="size-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-500">Date range</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
            />
            {dateActive && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="size-3" /> Clear
              </button>
            )}
          </div>

          {dateRangeCounts && !loading && (
            <div className="flex flex-wrap items-center gap-4 ml-auto">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-xs text-slate-500">Published</span>
                <span className="text-sm font-semibold text-slate-800">{dateRangeCounts.published.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-rose-500 shrink-0" />
                <span className="text-xs text-slate-500">Removed</span>
                <span className="text-sm font-semibold text-slate-800">{dateRangeCounts.removed.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-500 shrink-0" />
                <span className="text-xs text-slate-500">Refused</span>
                <span className="text-sm font-semibold text-slate-800">{dateRangeCounts.refused.toLocaleString()}</span>
              </div>
            </div>
          )}
          {dateActive && loading && (
            <div className="ml-auto flex gap-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-4 w-20 animate-pulse rounded bg-slate-200" />)}
            </div>
          )}
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
          {!loading && (search || statusFilter !== 'all' || platformFilter !== 'all') && (
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
          <div className="h-4 w-px bg-slate-200 shrink-0" />
          <FilterDropdown
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={STATUS_OPTS}
          />
          {hasMultiPlatform(decodedTab) && (
            <FilterDropdown
              value={platformFilter}
              onChange={(v) => { setPlatformFilter(v); setPage(1); }}
              options={PLATFORM_OPTS}
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
                    {search || statusFilter !== 'all' || platformFilter !== 'all' || dateActive ? 'No entries match your filters.' : 'No entries — run a sync from the Sync Status page.'}
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
