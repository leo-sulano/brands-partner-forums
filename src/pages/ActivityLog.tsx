import { useEffect, useState } from 'react';
import { RefreshCw, Pencil, AlertCircle } from 'lucide-react';
import { fetchSyncRuns, fetchRecentEdits, type EditEvent } from '../lib/queries';
import type { SyncRun } from '../types/sync';

type ActivityItem =
  | { kind: 'sync'; ts: string; run: SyncRun }
  | { kind: 'edit'; ts: string; event: EditEvent };

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
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchSyncRuns(50), fetchRecentEdits(50)])
      .then(([runs, edits]) => {
        const syncItems: ActivityItem[] = runs.map((run) => ({
          kind: 'sync',
          ts: run.started_at,
          run,
        }));
        const editItems: ActivityItem[] = edits.map((event) => ({
          kind: 'edit',
          ts: event.updated_at,
          event,
        }));
        const merged = [...syncItems, ...editItems].sort(
          (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
        );
        setItems(merged);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load log'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Activity Log</h1>

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

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-slate-400">No activity yet.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.kind === 'sync' ? `sync-${item.run.id}` : `edit-${item.event.id}`}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
            >
              {item.kind === 'sync' ? (
                <>
                  <RefreshCw className="mt-0.5 size-4 shrink-0 text-blue-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">Sync run</span>
                      <SyncStatusBadge status={item.run.status} />
                      {item.run.tab && (
                        <span className="text-xs text-slate-400">{item.run.tab}</span>
                      )}
                    </div>
                    {item.run.status !== 'running' && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.run.rows_upserted ?? 0} upserted · {item.run.rows_skipped ?? 0} skipped · {item.run.rows_seen ?? 0} seen
                        {item.run.error_message && (
                          <span className="ml-2 text-rose-600">{item.run.error_message}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{relativeTime(item.ts)}</span>
                </>
              ) : (
                <>
                  <Pencil className="mt-0.5 size-4 shrink-0 text-violet-500" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-slate-800">Entry edited</span>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {item.event.tab} · {item.event.account ?? '—'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{relativeTime(item.ts)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
