import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchSyncRuns, triggerSync } from '../lib/queries';
import type { SyncRun } from '../types/sync';
import Toast, { type ToastKind } from '../components/Toast';
import { formatDateTime, formatRelative } from '../lib/format';

export default function SyncStatus() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  async function load() {
    try {
      const data = await fetchSyncRuns(10);
      setRuns(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Sheet → Supabase sync</h2>
          <p className="mt-1 text-sm text-slate-500">
            Last successful run: {lastSuccess ? formatRelative(lastSuccess.finished_at ?? lastSuccess.started_at) : '—'}
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

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Started</th>
              <th className="px-4 py-2">Finished</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Seen</th>
              <th className="px-4 py-2 text-right">Upserted</th>
              <th className="px-4 py-2 text-right">Skipped</th>
              <th className="px-4 py-2">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                  No sync runs yet.
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-slate-700">{formatDateTime(r.started_at)}</td>
                  <td className="px-4 py-2 text-slate-500">{formatDateTime(r.finished_at)}</td>
                  <td className="px-4 py-2">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.rows_seen}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.rows_upserted}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.rows_skipped}</td>
                  <td className="px-4 py-2 text-rose-600">{r.error_message ?? '—'}</td>
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

function StatusPill({ status }: { status: SyncRun['status'] }) {
  const map = {
    running: 'bg-amber-100 text-amber-700',
    success: 'bg-emerald-100 text-emerald-700',
    error: 'bg-rose-100 text-rose-700',
  } as const;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}
