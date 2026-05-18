import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Circle, Building2 } from 'lucide-react';
import KpiCard from '../components/KpiCard';
import { fetchEntriesByTab, fetchTabKpis } from '../lib/queries';
import { subscribeEntries } from '../lib/realtime';
import type { BrandEntry, TabKpis } from '../types/brand-entry';

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s.includes('live')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-3" /> Live
      </span>
    );
  }
  if (s.includes('removed')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
        <XCircle className="size-3" /> Removed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      <Circle className="size-3" /> {status || 'New'}
    </span>
  );
}

export default function BrandGroup() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const decodedTab = decodeURIComponent(tab ?? '');

  const [entries, setEntries] = useState<BrandEntry[]>([]);
  const [kpis, setKpis] = useState<TabKpis>({ total: 0, live: 0, removed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!decodedTab) return;
    try {
      const [e, k] = await Promise.all([
        fetchEntriesByTab(decodedTab),
        fetchTabKpis(decodedTab),
      ]);
      setEntries(e);
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

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-4 py-3 font-medium text-slate-600">Account Name</th>
              <th className="px-4 py-3 font-medium text-slate-600">Brand / TP URL Page</th>
              <th className="px-4 py-3 font-medium text-slate-600">Review Status</th>
              <th className="px-4 py-3 font-medium text-slate-600">Score Added</th>
              <th className="px-4 py-3 font-medium text-slate-600">Link to Profile</th>
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
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
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
                  <td className="px-4 py-3 font-medium text-slate-900">{entry.casino || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{entry.platform || '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={entry.status} /></td>
                  <td className="px-4 py-3 text-slate-500">{entry.date || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{entry.notes || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
