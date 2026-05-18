import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Circle, Building2, ExternalLink } from 'lucide-react';
import KpiCard from '../components/KpiCard';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchTabKpis } from '../lib/queries';
import { subscribeEntries } from '../lib/realtime';
import { getTabColumns, getColLabel, COLUMN_LABELS } from '../lib/tab-configs';
import type { Entry } from '../types/entry';
import type { TabKpis } from '../types/brand-entry';

const HIDDEN_COLS = new Set(['id', 'last_sync_tag']);

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

function formatCellValue(value: string): string {
  // ISO datetime → date only: 2025-02-26T00:00:00.000Z → 2025-02-26
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  return value;
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

export default function BrandGroup() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const decodedTab = decodeURIComponent(tab ?? '');

  const [entries, setEntries] = useState<Entry[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [kpis, setKpis] = useState<TabKpis>({ total: 0, live: 0, removed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean loading state whenever the tab changes so stale
  // columns from the previous tab never flash while the new tab loads.
  useEffect(() => {
    setLoading(true);
    setEntries([]);
    setHeaders([]);
    setKpis({ total: 0, live: 0, removed: 0 });
    setError(null);
  }, [decodedTab]);

  const load = useCallback(async () => {
    if (!decodedTab) return;
    try {
      const [rawEntries, tabHeaders, k] = await Promise.all([
        fetchRawEntriesByTab(decodedTab),
        fetchTabHeaders(decodedTab),
        fetchTabKpis(decodedTab),
      ]);
      setEntries(rawEntries);
      const configCols = getTabColumns(decodedTab);
      // Use whitelist if configured. Two-pass match:
      // 1. Direct case-insensitive match against actual header.
      // 2. Label alias match: whitelist entry may be a display label (from COLUMN_LABELS);
      //    find the actual header whose mapped label equals the config entry.
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
        : tabHeaders.filter((h) => !HIDDEN_COLS.has(h));
      setHeaders(visible);
      setKpis(k);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [decodedTab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    return subscribeEntries(() => {
      clearTimeout(timer);
      timer = setTimeout(() => load(), 400);
    });
  }, [load]);

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

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-x-auto">
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
                    <th key={h} className={`px-3 py-3 font-medium text-slate-600 whitespace-nowrap ${colWidthClass(h)}`}>
                      {getColLabel(h)}
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
            ) : entries.length === 0 ? (
              <tr>
                <td
                  colSpan={headers.length || 5}
                  className="px-4 py-8 text-center text-slate-400"
                >
                  No entries — run a sync from the Sync Status page.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => navigate(`/mentions/${entry.id}`)}
                  className="cursor-pointer hover:bg-slate-50 transition-colors"
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
    </div>
  );
}
