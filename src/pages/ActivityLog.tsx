import { useEffect, useState } from 'react';
import { Pencil, AlertCircle } from 'lucide-react';
import { fetchRecentEdits, type EditEvent } from '../lib/queries';

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

export default function ActivityLog() {
  const [edits, setEdits] = useState<EditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecentEdits(100)
      .then(setEdits)
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

      {!loading && !error && edits.length === 0 && (
        <p className="text-sm text-slate-400">No edits yet.</p>
      )}

      {!loading && !error && edits.length > 0 && (
        <ul className="space-y-2">
          {edits.map((edit) => (
            <li
              key={edit.id}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
            >
              <Pencil className="mt-0.5 size-4 shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800">Entry edited</span>
                <p className="mt-0.5 text-xs text-slate-500">
                  {edit.tab} · {edit.account ?? '—'}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{relativeTime(edit.updated_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
