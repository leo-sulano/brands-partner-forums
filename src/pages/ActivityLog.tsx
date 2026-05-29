import { useEffect, useState } from 'react';
import { AlertCircle, Pencil, ShieldCheck, ShieldOff, Trash2, UserCheck, UserX } from 'lucide-react';
import { fetchRecentEdits, fetchAdminLogs, type EditEvent, type AdminLogEvent, type AdminAction } from '../lib/queries';

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

type FeedItem =
  | { kind: 'edit'; data: EditEvent }
  | { kind: 'admin'; data: AdminLogEvent };

const ACTION_META: Record<AdminAction, { label: string; icon: React.ReactNode; color: string }> = {
  approve:      { label: 'User approved',       icon: <UserCheck className="size-4 shrink-0" />,  color: 'text-green-500' },
  revoke:       { label: 'Access revoked',       icon: <UserX className="size-4 shrink-0" />,      color: 'text-amber-500' },
  remove:       { label: 'User removed',         icon: <Trash2 className="size-4 shrink-0" />,     color: 'text-rose-500' },
  make_admin:   { label: 'Promoted to admin',    icon: <ShieldCheck className="size-4 shrink-0" />, color: 'text-violet-500' },
  remove_admin: { label: 'Admin role removed',   icon: <ShieldOff className="size-4 shrink-0" />,  color: 'text-slate-400' },
};

export default function ActivityLog() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The two sources are independent: entry edits always exist, but admin_logs
    // may not be provisioned in every environment. Use allSettled so a missing
    // admin_logs table degrades to an edits-only feed instead of blanking the
    // whole page — only surface an error when BOTH sources fail.
    Promise.allSettled([fetchRecentEdits(100), fetchAdminLogs(100)])
      .then(([editsRes, adminRes]) => {
        if (editsRes.status === 'rejected' && adminRes.status === 'rejected') {
          const reason = editsRes.reason;
          setError(reason instanceof Error ? reason.message : 'Failed to load log');
          return;
        }
        const edits = editsRes.status === 'fulfilled' ? editsRes.value : [];
        const adminLogs = adminRes.status === 'fulfilled' ? adminRes.value : [];
        const items: FeedItem[] = [
          ...edits.map((e): FeedItem => ({ kind: 'edit', data: e })),
          ...adminLogs.map((a): FeedItem => ({ kind: 'admin', data: a })),
        ];
        items.sort((a, b) => {
          const ta = a.kind === 'edit' ? a.data.updated_at : a.data.created_at;
          const tb = b.kind === 'edit' ? b.data.updated_at : b.data.created_at;
          return tb.localeCompare(ta);
        });
        setFeed(items);
      })
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

      {!loading && !error && feed.length === 0 && (
        <p className="text-sm text-slate-400">No activity yet.</p>
      )}

      {!loading && !error && feed.length > 0 && (
        <ul className="space-y-2">
          {feed.map((item) => {
            if (item.kind === 'edit') {
              const edit = item.data;
              return (
                <li
                  key={`edit-${edit.id}`}
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
              );
            }

            const log = item.data;
            const meta = ACTION_META[log.action];
            return (
              <li
                key={`admin-${log.id}`}
                className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm"
              >
                <span className={`mt-0.5 ${meta.color}`}>{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800">{meta.label}</span>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {log.target_email} · by {log.actor_email}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{relativeTime(log.created_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
