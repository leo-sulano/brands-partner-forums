import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2, XCircle, Circle, Building2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown,
  Search, X, Filter,
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
  const filtered = statusFilter === 'all'
    ? platformFiltered
    : platformFiltered.filter((e) =>
        statusCols.some((h) => {
          const v = (e.data[h] ?? '').toLowerCase();
          if (statusFilter === 'live') return v.includes('live') || v.includes('published');
          if (statusFilter === 'removed') return v.includes('removed');
          return false;
        }),
      );

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
          breakdown={loading || !hasMultiPlatform(decodedTab) ? undefined : [
            { label: 'TP', count: kpis.tp.live },
            { label: 'AG', count: kpis.ag.live },
            { label: 'CG', count: kpis.cg.live },
          ]}
        />
        <KpiCard
          label="Removed"
          value={loading ? '…' : kpis.removed.toLocaleString()}
          hint="Reviews taken down"
          breakdown={loading || !hasMultiPlatform(decodedTab) ? undefined : [
            { label: 'TP', count: kpis.tp.removed },
            { label: 'AG', count: kpis.ag.removed },
            { label: 'CG', count: kpis.cg.removed },
          ]}
        />
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
          <Filter className="size-3.5 text-slate-400 shrink-0" />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
            className="bg-transparent text-xs text-slate-600 outline-none cursor-pointer"
          >
            <option value="all">All statuses</option>
            <option value="live">Live</option>
            <option value="removed">Removed</option>
          </select>
          {hasMultiPlatform(decodedTab) && (
            <>
              <div className="h-4 w-px bg-slate-200 shrink-0" />
              <select
                value={platformFilter}
                onChange={(e) => { setPlatformFilter(e.target.value as typeof platformFilter); setPage(1); }}
                className="bg-transparent text-xs text-slate-600 outline-none cursor-pointer"
              >
                <option value="all">All platforms</option>
                <option value="tp">Trust Pilot</option>
                <option value="ag">Ask Gambler</option>
                <option value="cg">Casino Guru</option>
              </select>
            </>
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
                    {search || statusFilter !== 'all' || platformFilter !== 'all' ? 'No entries match your filters.' : 'No entries — run a sync from the Sync Status page.'}
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
