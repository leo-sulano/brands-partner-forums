import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchSyncRuns, triggerSync } from '../lib/queries';
import type { SyncRun, SyncRunStatus } from '../types/sync';
import { subscribeSyncRuns } from '../lib/realtime';
import Toast, { type ToastKind } from '../components/Toast';
import { formatRelative } from '../lib/format';

interface DaySummary {
  dateKey: string;
  label: string;
  total: number;
  success: number;
  running: number;
  error: number;
  skipped: number;
}

function groupByDate(runs: SyncRun[]): DaySummary[] {
  const map = new Map<string, DaySummary>();
  for (const r of runs) {
    const d = new Date(r.started_at);
    const dateKey = d.toISOString().slice(0, 10); // YYYY-MM-DD for sorting
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (!map.has(dateKey)) {
      map.set(dateKey, { dateKey, label, total: 0, success: 0, running: 0, error: 0, skipped: 0 });
    }
    const s = map.get(dateKey)!;
    s.total++;
    s[r.status as SyncRunStatus]++;
  }
  return Array.from(map.values()).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

export default function SyncStatus() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  async function load() {
    try {
      const data = await fetchSyncRuns();
      setRuns(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    return subscribeSyncRuns(() => { load(); });
  }, []);

  async function handleRunNow() {
    setRunning(true);
    try {
      await triggerSync();
      setToast({ message: 'Sync triggered', kind: 'success' });
      await load();
    } catch (err) {
      setToast({ message: (err as Error).message, kind: 'error' });
    } finally {
      setRunning(false);
    }
  }

  const lastSuccess = runs.find((r) => r.status === 'success');
  const days = groupByDate(runs);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Sheet → Supabase sync</h2>
          <p className="mt-1 text-sm text-slate-500">
            Last successful run:{' '}
            {lastSuccess ? formatRelative(lastSuccess.finished_at ?? lastSuccess.started_at) : '—'}
          </p>
        </div>
        <button
          onClick={handleRunNow}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Running…' : 'Run sync now'}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* Grouped history table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Total syncs</th>
              <th className="px-4 py-3 text-right">Success</th>
              <th className="px-4 py-3 text-right">Running</th>
              <th className="px-4 py-3 text-right">Error</th>
              <th className="px-4 py-3 text-right">Skipped</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : days.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                  No sync runs yet.
                </td>
              </tr>
            ) : (
              days.map((d) => (
                <tr key={d.dateKey} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{d.label}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{d.total}</td>
                  <td className="px-4 py-3 text-right">
                    {d.success > 0 ? (
                      <span className="inline-flex items-center justify-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 tabular-nums">
                        {d.success}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {d.running > 0 ? (
                      <span className="inline-flex items-center justify-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 tabular-nums">
                        {d.running}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {d.error > 0 ? (
                      <span className="inline-flex items-center justify-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 tabular-nums">
                        {d.error}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {d.skipped > 0 ? (
                      <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 tabular-nums">
                        {d.skipped}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {toast ? (
        <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}
