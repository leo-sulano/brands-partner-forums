import { useEffect, useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { fetchSyncRuns } from '../lib/queries';
import type { SyncRun } from '../types/sync';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function SyncStatusBadge({ status }: { status: SyncRun['status'] }) {
  const styles: Record<SyncRun['status'], string> = {
    success: 'bg-emerald-100 text-emerald-700',
    error:   'bg-rose-100 text-rose-700',
    running: 'bg-blue-100 text-blue-700',
    skipped: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export default function ActivityLog() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSyncRuns(100)
      .then(setRuns)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load log'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Log</h1>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && runs.length === 0 && (
        <p className="text-sm text-slate-400">No sync runs yet.</p>
      )}

      {!loading && !error && runs.length > 0 && (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li
              key={run.id}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
            >
              <RefreshCw className="mt-0.5 size-4 shrink-0 text-blue-500" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">Sync run</span>
                  <SyncStatusBadge status={run.status} />
                  {run.tab && (
                    <span className="text-xs text-slate-400">{run.tab}</span>
                  )}
                </div>
                {run.status !== 'running' && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {run.rows_upserted ?? 0} upserted · {run.rows_skipped ?? 0} skipped · {run.rows_seen ?? 0} seen
                    {run.error_message && (
                      <span className="ml-2 text-rose-600">{run.error_message}</span>
                    )}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs text-slate-400">{relativeTime(run.started_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
